# The Last Seat

A concert ticket booking backend built with Node.js, Express and PostgreSQL.

The system allows users to view seats, reserve them temporarily, make simulated payments, and manage their bookings. It also handles duplicate booking requests and reservation expiry.

## Tech Stack

- Node.js and Express
- PostgreSQL
- Docker Compose
- Jest and Supertest
- k6

## Getting Started

Make sure Docker Desktop is installed and running.

Clone the repository and open the project folder, then run:

```bash
docker compose up --build
```

Once the containers start, open:

- `http://localhost:3000/health`
- `http://localhost:3000/seats`

The database is initialized with 500 seats automatically.

## Main Features

- View available seats
- Create temporary reservations
- Simulate successful, failed and delayed payments
- Confirm and cancel bookings
- View reservation status and booking history
- Handle repeated requests using idempotency keys
- Prevent multiple users from booking the same seat
- Automatically expire reservations

## Testing

Run the automated tests:

```bash
npm test
```

Test concurrent reservations:

```bash
node load_test/concurrency-test.js
```

Run the load test with k6:

```bash
k6 run load_test/k6-booking.js
```

## Concurrency Handling

PostgreSQL transactions and row-level locks are used to manage simultaneous reservations. Database constraints provide an additional safeguard against duplicate confirmed bookings.

## Project Structure

- `app/` — API routes and services
- `tests/` — Automated tests
- `load_test/` — Concurrency and load tests
- `schema.sql` — Database schema and initial seat data
- `docker-compose.yml` — Application and database setup

## Notes

Payments are simulated; no real payment gateway is connected.

This project was built as a backend development task for a concert ticket booking system.
