require('dotenv').config();
const express = require('express');
const seats = require('./routes/seats');
const reservations = require('./routes/reservations');
const payments = require('./routes/payments');
const bookings = require('./routes/bookings');
const { expireReservations } = require('./services/reservationService');
const { pool } = require('./database');

const app = express();
app.use(express.json({ limit: '100kb' }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/seats', seats);
app.use('/reservations', reservations);
app.use('/payments', payments);
app.use('/bookings', bookings);

app.use((req, res) => res.status(404).json({ error: 'Route not found', code: 'NOT_FOUND' }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.status || (error.code === '23505' ? 409 : 500);
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : error.message,
    code: error.code || 'INTERNAL_ERROR'
  });
});

let expiryTimer;
function startExpiryWorker() {
  expiryTimer = setInterval(() => {
    expireReservations().catch(error => process.stderr.write(`${error.message}\n`));
  }, 5000);
  if (expiryTimer.unref) expiryTimer.unref();
}

async function start() {
  await pool.query('SELECT 1');
  startExpiryWorker();
  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, () => process.stdout.write(`The Last Seat API listening on port ${port}\n`));
  const shutdown = async () => {
    server.close(async () => {
      clearInterval(expiryTimer);
      await pool.end();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  start().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}

app.start = start;
module.exports = app;
