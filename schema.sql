CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seat_number VARCHAR(12) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seat_id UUID NOT NULL REFERENCES seats(id),
  user_id VARCHAR(120) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'confirmed', 'expired', 'cancelled')),
  expires_at TIMESTAMPTZ NOT NULL,
  idempotency_key VARCHAR(200) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reservations_seat_status_expiry_idx ON reservations(seat_id, status, expires_at);
CREATE INDEX IF NOT EXISTS reservations_user_created_idx ON reservations(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL UNIQUE REFERENCES reservations(id),
  seat_id UUID NOT NULL REFERENCES seats(id),
  user_id VARCHAR(120) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('confirmed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS one_confirmed_booking_per_seat ON bookings(seat_id) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS bookings_user_created_idx ON bookings(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id),
  user_id VARCHAR(120) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('processing', 'succeeded', 'failed')),
  outcome_requested VARCHAR(20) NOT NULL CHECK (outcome_requested IN ('success', 'failure', 'delayed')),
  idempotency_key VARCHAR(200) NOT NULL UNIQUE,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payments_reservation_status_idx ON payments(reservation_id, status);

INSERT INTO seats (seat_number)
SELECT 'S' || LPAD(n::TEXT, 3, '0')
FROM generate_series(1, 500) AS n
ON CONFLICT (seat_number) DO NOTHING;
