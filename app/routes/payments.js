const express = require('express');
const { processPayment } = require('../services/paymentService');

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const result = await processPayment({ ...req.body, idempotencyKey: req.get('Idempotency-Key') });
    res.status(result.payment.status === 'processing' ? 202 : 200).json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
