
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    seat_browsing: {
      executor: 'constant-vus',
      vus: 100,
      duration: '30s'
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<1000']
  }
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const response = http.get(`${BASE_URL}/seats`);

  check(response, {
    'status is 200': r => r.status === 200,
    'response contains seats': r => r.body.includes('S001')
  });

  sleep(1);
}
