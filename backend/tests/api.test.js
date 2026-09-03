import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters';
process.env.DATABASE_URL = 'postgres://fluxo:fluxo@localhost:5432/fluxo';
const { app } = await import('../src/server.js');

describe('API security boundary', () => {
  it('rejects protected endpoints without a token', async () => {
    const response = await request(app).get('/api/products');
    expect(response.status).toBe(401);
  });

  it('rejects agent-only endpoints for anonymous users', async () => {
    const response = await request(app).post('/api/products').send({ name: 'Teste', price: 10, stock: 1 });
    expect(response.status).toBe(401);
  });
});

afterAll(async () => { const { pool } = await import('../src/db.js'); await pool.end(); });
