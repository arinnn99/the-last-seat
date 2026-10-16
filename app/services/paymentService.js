const { transaction, query } = require('../database');
const { HttpError } = require('../errors');

const maxDelayMs = Number(process.env.PAYMENT_MAX_DELAY_MS || 15000);

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processPayment({ reservationId, userId, outcome, delayMs = 0, idempotencyKey }) {
  if (!reservationId || !userId || !idempotencyKey) {
    throw new HttpError(400, 'reservationId, userId, and Idempotency-Key are required');
  }
  if (!['success', 'failure', 'delayed'].includes(outcome)) {
    throw new HttpError(400, 'outcome must be success, failure, or delayed');
  }
  const delay = outcome === 'delayed' ? Number(delayMs || 5000) : 0;
  if (!Number.isFinite(delay) || delay < 0 || delay > maxDelayMs) {
    throw new HttpError(400, `delayMs must be between 0 and ${maxDelayMs}`);
  }

  const reservationOwner = await query('SELECT user_id FROM reservations WHERE id = $1', [reservationId]);
  if (!reservationOwner.rowCount) throw new HttpError(404, 'Reservation not found');
  if (reservationOwner.rows[0].user_id !== userId) throw new HttpError(403, 'Reservation belongs to another user');

  const existing = await query('SELECT * FROM payments WHERE idempotency_key = $1', [idempotencyKey]);
  if (existing.rowCount) {
    const payment = existing.rows[0];
    if (payment.reservation_id !== reservationId || payment.user_id !== userId) {
      throw new HttpError(409, 'Idempotency key was already used for a different request');
    }
    return { payment, replayed: true };
  }

  const created = await query(
    "INSERT INTO payments (reservation_id, user_id, status, outcome_requested, idempotency_key) VALUES ($1, $2, 'processing', $3, $4) ON CONFLICT (idempotency_key) DO NOTHING RETURNING *",
    [reservationId, userId, outcome, idempotencyKey]
  );
  if (!created.rowCount) {
    const duplicate = await query('SELECT * FROM payments WHERE idempotency_key = $1', [idempotencyKey]);
    return { payment: duplicate.rows[0], replayed: true };
  }

  if (delay) await wait(delay);

  const reservationSnapshot = await query('SELECT seat_id FROM reservations WHERE id = $1', [reservationId]);
  const result = await transaction(async client => {
    await client.query('SELECT id FROM seats WHERE id = $1 FOR UPDATE', [reservationSnapshot.rows[0].seat_id]);
    const reservationResult = await client.query('SELECT * FROM reservations WHERE id = $1 FOR UPDATE', [reservationId]);
    const paymentResult = await client.query('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [created.rows[0].id]);
    const payment = paymentResult.rows[0];
    if (!reservationResult.rowCount) {
      const updated = await client.query("UPDATE payments SET status = 'failed', failure_reason = 'Reservation not found', updated_at = NOW() WHERE id = $1 RETURNING *", [payment.id]);
      return { payment: updated.rows[0], booking: null };
    }

    const reservation = reservationResult.rows[0];
    if (reservation.status !== 'pending' || new Date(reservation.expires_at) <= new Date()) {
      if (reservation.status === 'pending') {
        await client.query("UPDATE reservations SET status = 'expired', updated_at = NOW() WHERE id = $1", [reservationId]);
      }
      const updated = await client.query("UPDATE payments SET status = 'failed', failure_reason = 'Reservation expired or is no longer active', updated_at = NOW() WHERE id = $1 RETURNING *", [payment.id]);
      return { payment: updated.rows[0], booking: null };
    }

    if (outcome === 'failure') {
      await client.query("UPDATE reservations SET status = 'cancelled', updated_at = NOW() WHERE id = $1", [reservationId]);
      const updated = await client.query("UPDATE payments SET status = 'failed', failure_reason = 'Simulated payment failure', updated_at = NOW() WHERE id = $1 RETURNING *", [payment.id]);
      return { payment: updated.rows[0], booking: null };
    }

    const conflict = await client.query("SELECT id FROM bookings WHERE seat_id = $1 AND status = 'confirmed'", [reservation.seat_id]);
    if (conflict.rowCount) {
      await client.query("UPDATE reservations SET status = 'cancelled', updated_at = NOW() WHERE id = $1", [reservationId]);
      const updated = await client.query("UPDATE payments SET status = 'failed', failure_reason = 'Seat is already booked', updated_at = NOW() WHERE id = $1 RETURNING *", [payment.id]);
      return { payment: updated.rows[0], booking: null };
    }

    const bookingResult = await client.query(
      "INSERT INTO bookings (reservation_id, seat_id, user_id, status) VALUES ($1, $2, $3, 'confirmed') ON CONFLICT (reservation_id) DO UPDATE SET status = 'confirmed', updated_at = NOW() RETURNING *",
      [reservationId, reservation.seat_id, userId]
    );
    await client.query("UPDATE reservations SET status = 'confirmed', updated_at = NOW() WHERE id = $1", [reservationId]);
    const updatedPayment = await client.query("UPDATE payments SET status = 'succeeded', updated_at = NOW() WHERE id = $1 RETURNING *", [payment.id]);
    return { payment: updatedPayment.rows[0], booking: bookingResult.rows[0] };
  });

  return { ...result, replayed: false };
}

module.exports = { processPayment };
