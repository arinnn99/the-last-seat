const express = require('express');
const { query } = require('../database');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT s.id, s.seat_number,
        CASE
          WHEN EXISTS (SELECT 1 FROM bookings b WHERE b.seat_id = s.id AND b.status = 'confirmed') THEN 'booked'
          WHEN EXISTS (SELECT 1 FROM reservations r WHERE r.seat_id = s.id AND r.status = 'pending' AND r.expires_at > NOW()) THEN 'reserved'
          ELSE 'available'
        END AS status
      FROM seats s
      ORDER BY s.seat_number
    `);
    res.json({ seats: result.rows });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
