const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { app } = require('../server');
const { connectDB, disconnectDB } = require('../config/db');

test('Relink route should require auth', async () => {
  await connectDB();
  const res = await request(app).post('/api/cases/CASE-123/relink');
  // Assuming authMiddleware blocks it without a token
  assert.strictEqual(res.status, 401, 'Should block unauthorized requests');
  await disconnectDB();
});
