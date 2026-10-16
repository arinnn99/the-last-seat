const express = require('express');
const { reserveSeat, getReservation } = require('../services/reservationService');
const { query } = require('../database');
const { HttpError } = require('../errors');

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const idempotencyKey = req.get('Idempotency-Key');
    const result = await reserveSeat({ ...req.body, idempotencyKey });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    res.json({ reservation: await getReservation(req.params.id) });
  } catch (error) {
    next(error);
  }
});

router.get('/user/:userId', async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM reservations WHERE user_id = $1 ORDER BY created_at DESC', [req.params.userId]);
    res.json({ reservations: result.rows });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/cancel', async (req, res, next) => {
  try {
    const result = await query(
      "UPDATE reservations SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND user_id = $2 AND status = 'pending' AND expires_at > NOW() RETURNING *",
      [req.params.id, req.body.userId]
    );
    if (!result.rowCount) throw new HttpError(409, 'Reservation not found, not owned by user, or no longer active');
    res.json({ reservation: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
