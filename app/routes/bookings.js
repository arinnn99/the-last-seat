const express = require('express');
const { query, transaction } = require('../database');
const { HttpError } = require('../errors');

const router = express.Router();

router.post('/confirm', async (req, res, next) => {
  try {
    const { reservationId, userId } = req.body;
    if (!reservationId || !userId) throw new HttpError(400, 'reservationId and userId are required');
    const result = await transaction(async client => {
      const initial = await client.query('SELECT seat_id FROM reservations WHERE id = $1', [reservationId]);
      if (!initial.rowCount) throw new HttpError(404, 'Reservation not found');
      await client.query('SELECT id FROM seats WHERE id = $1 FOR UPDATE', [initial.rows[0].seat_id]);
      const reservationResult = await client.query('SELECT * FROM reservations WHERE id = $1 FOR UPDATE', [reservationId]);
      const reservation = reservationResult.rows[0];
      if (reservation.user_id !== userId) throw new HttpError(403, 'Reservation belongs to another user');
      if (reservation.status === 'confirmed') {
        const existing = await client.query('SELECT * FROM bookings WHERE reservation_id = $1', [reservationId]);
        return existing.rows[0];
      }
      if (reservation.status !== 'pending' || new Date(reservation.expires_at) <= new Date()) {
        if (reservation.status === 'pending') await client.query("UPDATE reservations SET status = 'expired', updated_at = NOW() WHERE id = $1", [reservationId]);
        throw new HttpError(409, 'Reservation expired or is no longer active');
      }
      const payment = await client.query("SELECT id FROM payments WHERE reservation_id = $1 AND status = 'succeeded'", [reservationId]);
      if (!payment.rowCount) throw new HttpError(409, 'A successful payment is required before confirmation');
      const booking = await client.query("INSERT INTO bookings (reservation_id, seat_id, user_id, status) VALUES ($1, $2, $3, 'confirmed') ON CONFLICT (reservation_id) DO UPDATE SET status = 'confirmed', updated_at = NOW() RETURNING *", [reservationId, reservation.seat_id, userId]);
      await client.query("UPDATE reservations SET status = 'confirmed', updated_at = NOW() WHERE id = $1", [reservationId]);
      return booking.rows[0];
    });
    res.status(201).json({ booking: result });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/cancel', async (req, res, next) => {
  try {
    const booking = await transaction(async client => {
      const initial = await client.query('SELECT seat_id FROM bookings WHERE id = $1', [req.params.id]);
      if (!initial.rowCount) throw new HttpError(404, 'Booking not found');
      await client.query('SELECT id FROM seats WHERE id = $1 FOR UPDATE', [initial.rows[0].seat_id]);
      const found = await client.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [req.params.id]);
      const current = found.rows[0];
      if (current.user_id !== req.body.userId) throw new HttpError(403, 'Booking belongs to another user');
      if (current.status !== 'confirmed') throw new HttpError(409, 'Booking is not active');
      const updated = await client.query("UPDATE bookings SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING *", [req.params.id]);
      await client.query("UPDATE reservations SET status = 'cancelled', updated_at = NOW() WHERE id = $1", [current.reservation_id]);
      return updated.rows[0];
    });
    res.json({ booking });
  } catch (error) {
    next(error);
  }
});

router.get('/history/:userId', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT b.*, s.seat_number, r.expires_at
      FROM bookings b
      JOIN seats s ON s.id = b.seat_id
      JOIN reservations r ON r.id = b.reservation_id
      WHERE b.user_id = $1
      ORDER BY b.created_at DESC
    `, [req.params.userId]);
    res.json({ bookings: result.rows });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const result = await query(`SELECT b.*, s.seat_number FROM bookings b JOIN seats s ON s.id = b.seat_id WHERE b.id = $1`, [req.params.id]);
    if (!result.rowCount) throw new HttpError(404, 'Booking not found');
    res.json({ booking: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
