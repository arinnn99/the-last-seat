const { transaction, query } = require('../database');
const { HttpError } = require('../errors');

const ttlSeconds = Number(process.env.RESERVATION_TTL_SECONDS || 300);

async function reserveSeat({ seatId, userId, idempotencyKey }) {
  if (!seatId || !userId || !idempotencyKey) {
    throw new HttpError(400, 'seatId, userId, and Idempotency-Key are required');
  }

  return transaction(async client => {
    const previous = await client.query(
      'SELECT * FROM reservations WHERE idempotency_key = $1',
      [idempotencyKey]
    );
    if (previous.rowCount) {
      const existing = previous.rows[0];
      if (existing.user_id !== userId || existing.seat_id !== seatId) {
        throw new HttpError(409, 'Idempotency key was already used for a different request');
      }
      return { reservation: existing, replayed: true };
    }

    const seatResult = await client.query('SELECT * FROM seats WHERE id = $1 FOR UPDATE', [seatId]);
    if (!seatResult.rowCount) throw new HttpError(404, 'Seat not found', 'SEAT_NOT_FOUND');

    await client.query(
      "UPDATE reservations SET status = 'expired', updated_at = NOW() WHERE seat_id = $1 AND status = 'pending' AND expires_at <= NOW()",
      [seatId]
    );

    const booked = await client.query(
      "SELECT id FROM bookings WHERE seat_id = $1 AND status = 'confirmed'",
      [seatId]
    );
    if (booked.rowCount) throw new HttpError(409, 'Seat is already booked', 'SEAT_UNAVAILABLE');

    const active = await client.query(
      "SELECT id FROM reservations WHERE seat_id = $1 AND status = 'pending' AND expires_at > NOW()",
      [seatId]
    );
    if (active.rowCount) throw new HttpError(409, 'Seat is temporarily reserved', 'SEAT_UNAVAILABLE');

    const inserted = await client.query(
      "INSERT INTO reservations (seat_id, user_id, status, expires_at, idempotency_key) VALUES ($1, $2, 'pending', NOW() + ($3 * INTERVAL '1 second'), $4) RETURNING *",
      [seatId, userId, ttlSeconds, idempotencyKey]
    );
    return { reservation: inserted.rows[0], replayed: false };
  });
}

async function getReservation(id) {
  const result = await query('SELECT * FROM reservations WHERE id = $1', [id]);
  if (!result.rowCount) throw new HttpError(404, 'Reservation not found');
  const reservation = result.rows[0];
  if (reservation.status === 'pending' && new Date(reservation.expires_at) <= new Date()) {
    await query("UPDATE reservations SET status = 'expired', updated_at = NOW() WHERE id = $1 AND status = 'pending'", [id]);
    reservation.status = 'expired';
  }
  return reservation;
}

async function expireReservations() {
  const result = await query(
    "UPDATE reservations SET status = 'expired', updated_at = NOW() WHERE status = 'pending' AND expires_at <= NOW() RETURNING id"
  );
  return result.rowCount;
}

module.exports = { reserveSeat, getReservation, expireReservations };
