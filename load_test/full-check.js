
const { execFileSync } = require('node:child_process');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const results = [];

async function request(path, method = 'GET', body, key) {
  const headers = { 'Content-Type': 'application/json' };

  if (key) headers['Idempotency-Key'] = key;

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = { message: text };
  }

  return { status: response.status, data };
}

function check(name, condition, details = '') {
  const passed = Boolean(condition);
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${details ? `: ${details}` : ''}`);
  return passed;
}

function expireReservation(id) {
  const sql = `UPDATE reservations SET expires_at = NOW() - INTERVAL '1 second' WHERE id = '${id}'`;
  execFileSync('docker', [
    'compose', 'exec', '-T', 'db',
    'psql', '-U', 'postgres', '-d', 'lastseat', '-c', sql
  ], { stdio: 'ignore' });
}

async function availableSeat(exclude = []) {
  const response = await request('/seats');
  if (response.status !== 200) throw new Error('Could not fetch seats');

  return response.data.seats.find(
    seat => seat.status === 'available' && !exclude.includes(seat.id)
  );
}

async function reserve(seat, userId, key) {
  return request('/reservations', 'POST', {
    seatId: seat.id,
    userId
  }, key);
}

async function payment(reservationId, userId, outcome, key, delayMs) {
  return request('/payments', 'POST', {
    reservationId,
    userId,
    outcome,
    ...(delayMs ? { delayMs } : {})
  }, key);
}

async function run() {
  console.log('\nTHE LAST SEAT - AUTOMATED CHECKS\n');

  const health = await request('/health');
  check('Health endpoint', health.status === 200);

  const seatResponse = await request('/seats');
  check(
    'Seat inventory',
    seatResponse.status === 200 && seatResponse.data.seats.length === 500
  );

  const usedSeats = [];
  const failedSeat = await availableSeat(usedSeats);
  if (!failedSeat) throw new Error('No available seat for failed-payment test');
  usedSeats.push(failedSeat.id);

  const failedReservation = await reserve(
    failedSeat, 'check-failed-user', `check-failed-${Date.now()}`
  );

  const failedReservationId = failedReservation.data.reservation?.id;

  check('Create reservation for failed payment', 
    failedReservation.status === 201 && Boolean(failedReservationId));

  if (failedReservationId) {
    const failedPayment = await payment(
      failedReservationId, 'check-failed-user', 'failure',
      `check-failed-payment-${Date.now()}`
    );

    check(
      'Failed payment rejected',
      failedPayment.data.payment?.status === 'failed'
    );

    const seats = await request('/seats');
    const seat = seats.data.seats.find(item => item.id === failedSeat.id);

    check('Failed payment releases seat', seat?.status === 'available');
  }

  const replaySeat = await availableSeat(usedSeats);
  if (!replaySeat) throw new Error('No seat for idempotency test');
  usedSeats.push(replaySeat.id);

  const replayKey = `check-replay-${Date.now()}`;
  const first = await reserve(replaySeat, 'check-replay-user', replayKey);
  const second = await reserve(replaySeat, 'check-replay-user', replayKey);

  check(
    'Reservation idempotency',
    first.data.reservation?.id === second.data.reservation?.id &&
    second.data.replayed === true
  );

  const expirySeat = await availableSeat(usedSeats);
  if (!expirySeat) throw new Error('No seat for expiry test');
  usedSeats.push(expirySeat.id);

  const expiryReservation = await reserve(
    expirySeat, 'check-expiry-user', `check-expiry-${Date.now()}`
  );

  const expiryId = expiryReservation.data.reservation?.id;

  if (expiryId) {
    expireReservation(expiryId);

    const expired = await request(`/reservations/${expiryId}`);
    check('Reservation expiry', expired.data.reservation?.status === 'expired');

    const latePayment = await payment(
      expiryId, 'check-expiry-user', 'success', `check-late-${Date.now()}`
    );

    check(
      'Late payment cannot confirm booking',
      latePayment.data.payment?.status === 'failed' &&
      !latePayment.data.booking
    );

    const seats = await request('/seats');
    const seat = seats.data.seats.find(item => item.id === expirySeat.id);

    check('Expired seat becomes available', seat?.status === 'available');
  }

  const cancelSeat = await availableSeat(usedSeats);
  if (!cancelSeat) throw new Error('No seat for cancellation test');
  usedSeats.push(cancelSeat.id);

  const cancelReservation = await reserve(
    cancelSeat, 'check-cancel-user', `check-cancel-reserve-${Date.now()}`
  );

  const cancelReservationId = cancelReservation.data.reservation?.id;

  if (cancelReservationId) {
    const paid = await payment(
      cancelReservationId, 'check-cancel-user', 'success',
      `check-cancel-payment-${Date.now()}`
    );

    const bookingId = paid.data.booking?.id;

    check('Successful payment confirms booking',
      paid.data.payment?.status === 'succeeded' &&
      paid.data.booking?.status === 'confirmed');

    if (bookingId) {
      const cancelled = await request(
        `/bookings/${bookingId}/cancel`,
        'POST',
        { userId: 'check-cancel-user' }
      );

      check('Booking cancellation',
        cancelled.status === 200 &&
        cancelled.data.booking?.status === 'cancelled');

      const seats = await request('/seats');
      const seat = seats.data.seats.find(item => item.id === cancelSeat.id);

      check('Cancelled seat becomes available', seat?.status === 'available');
    }

    const history = await request('/bookings/history/check-cancel-user');
    check('Booking history endpoint', history.status === 200);
  }

  const concurrencySeat = await availableSeat(usedSeats);
  if (!concurrencySeat) throw new Error('No seat for concurrency test');

  const count = 25;
  const responses = await Promise.all(
    Array.from({ length: count }, (_, index) =>
      reserve(
        concurrencySeat,
        `check-concurrent-${index}`,
        `check-concurrent-${Date.now()}-${index}`
      )
    )
  );

  const created = responses.filter(response => response.status === 201).length;
  const conflicts = responses.filter(response => response.status === 409).length;

  check(
    'Concurrent booking protection',
    created === 1 && conflicts === count - 1,
    `${created} created, ${conflicts} conflicts`
  );

  console.log('\nSUMMARY');
  console.log(`${results.filter(result => result.passed).length} passed`);
  console.log(`${results.filter(result => !result.passed).length} failed`);

  if (results.some(result => !result.passed)) process.exitCode = 1;
}

run().catch(error => {
  console.error('\nTEST RUN FAILED:', error.message);
  process.exitCode = 1;
});
