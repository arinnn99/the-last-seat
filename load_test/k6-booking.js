import http from 'k6/http';
import { check } from 'k6';
import { randomUUID } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

export const options = {
  scenarios: {
    booking_burst: {
      executor: 'constant-arrival-rate',
      rate: 100,
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 100,
      maxVUs: 500
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.5'],
    http_req_duration: ['p(95)<1000']
  }
};

const baseUrl = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const seatNumber = `S${String(Math.floor(Math.random() * 500) + 1).padStart(3, '0')}`;
  const seatResponse = http.get(`${baseUrl}/seats`);
  check(seatResponse, { 'seat list responds': response => response.status === 200 });
  const seats = seatResponse.json('seats') || [];
  const seat = seats.find(item => item.seat_number === seatNumber);
  if (!seat) return;
  const response = http.post(`${baseUrl}/reservations`, JSON.stringify({ seatId: seat.id, userId: `load-${__VU}-${__ITER}` }), {
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }
  });
  check(response, { 'reservation accepted or conflict': result => [201, 200, 409].includes(result.status) });
}
