const request = require('supertest');
const app = require('../app/main');

describe('health endpoint', () => {
  test('returns the API health status', async () => {
    const response = await request(app).get('/health');
    expect(response.statusCode).toBe(200);
    expect(response.body.status).toBe('ok');
  });
});
