'use strict';

/**
 * Integration tests for backend routes:
 *  - POST /api/auth/login  (valid / invalid / missing password)
 *  - POST /api/auth/logout
 *  - GET  /api/auth/me     (authenticated vs unauthenticated)
 *  - GET  /api/performance
 *  - GET  /api/performance/history
 *  - GET  /api/trades/stats
 */

// ── Setup: mock env before any requires ───────────────────────────────────────
process.env.JWT_SECRET = 'test_jwt_secret_for_tests_32chars!';
process.env.DASHBOARD_PASSWORD = 'testpassword123';
process.env.NODE_ENV = 'test';

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('bcryptjs', () => ({
  compare: jest.fn(async (plaintext, hash) => plaintext === hash),
}));

jest.mock('../models/Trade', () => ({
  countDocuments: jest.fn().mockResolvedValue(0),
  find: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue([]),  // direct .lean() calls in performance route
    sort: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    }),
  }),
  aggregate: jest.fn().mockResolvedValue([]),
}));

jest.mock('../models/DailySnapshot', () => ({
  find: jest.fn().mockReturnValue({
    sort: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    }),
  }),
}));

jest.mock('../services/riskManager', () => ({
  getDailyPnl: jest.fn().mockResolvedValue(0),
  getDailyPnlUsdt: jest.fn().mockResolvedValue(0),
  getWeeklyPnl: jest.fn().mockResolvedValue(0),
}));

// ── Test setup ────────────────────────────────────────────────────────────────

const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');  // will be skipped if not installed
const jwt = require('jsonwebtoken');

// Lazily build the app only when supertest is available
let app;
let supertestAvailable = true;

try {
  require.resolve('supertest');
} catch {
  supertestAvailable = false;
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', require('../routes/auth'));
  app.use('/api', require('../routes/performance'));
  const trade = require('../routes/trades');
  trade.init(null);
  app.use('/api', trade.router);
  return app;
}

// ── Auth route tests ───────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  beforeAll(() => {
    if (supertestAvailable) app = buildApp();
  });

  const runTest = (fn) => {
    if (!supertestAvailable) return it.skip('supertest not installed')();
    return fn();
  };

  it('returns 200 and sets httpOnly cookie for correct password', async () => {
    if (!supertestAvailable) return;
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'testpassword123' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('returns 401 for wrong password', async () => {
    if (!supertestAvailable) return;
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when password field is missing', async () => {
    if (!supertestAvailable) return;
    const res = await request(app)
      .post('/api/auth/login')
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/logout', () => {
  it('returns 200 and clears the cookie', async () => {
    if (!supertestAvailable) return;
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 when no token cookie is present', async () => {
    if (!supertestAvailable) return;
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 200 and authenticated:true when valid JWT cookie is provided', async () => {
    if (!supertestAvailable) return;
    const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
  });

  it('returns 401 for an expired token', async () => {
    if (!supertestAvailable) return;
    const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '-1s' });
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `token=${token}`);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/performance', () => {
  it('returns 401 without auth', async () => {
    if (!supertestAvailable) return;
    const res = await request(app).get('/api/performance');
    expect(res.status).toBe(401);
  });

  it('returns 200 with expected fields when authenticated', async () => {
    if (!supertestAvailable) return;
    const Trade = require('../models/Trade');
    Trade.countDocuments.mockResolvedValue(10);
    Trade.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([]), // for .find({}).lean() in monthly trades
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      }),
    });
    Trade.aggregate.mockResolvedValue([{ _id: null, avgPnl: 0.5 }]);

    const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const res = await request(app)
      .get('/api/performance')
      .set('Cookie', `token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalTrades');
    expect(res.body).toHaveProperty('winRate');
    expect(res.body).toHaveProperty('dailyPnlPct');
    expect(res.body).toHaveProperty('weeklyPnlPct');
  });
});

describe('GET /api/performance/history', () => {
  it('returns 401 without auth', async () => {
    if (!supertestAvailable) return;
    const res = await request(app).get('/api/performance/history');
    expect(res.status).toBe(401);
  });

  it('returns 200 and an array when authenticated', async () => {
    if (!supertestAvailable) return;
    const DailySnapshot = require('../models/DailySnapshot');
    DailySnapshot.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            { date: '2026-03-01', dailyPnlPct: 1.2, dailyPnlUsdt: 60, totalTrades: 5, wins: 3 },
          ]),
        }),
      }),
    });

    const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const res = await request(app)
      .get('/api/performance/history')
      .set('Cookie', `token=${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('respects the limit query parameter (max 365)', async () => {
    if (!supertestAvailable) return;
    const DailySnapshot = require('../models/DailySnapshot');
    const limitSpy = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    DailySnapshot.find.mockReturnValue({ sort: jest.fn().mockReturnValue({ limit: limitSpy }) });

    const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    await request(app)
      .get('/api/performance/history?limit=1000') // over 365 cap
      .set('Cookie', `token=${token}`);
    expect(limitSpy).toHaveBeenCalledWith(365);
  });
});

describe('GET /api/trades/stats', () => {
  it('returns 401 without auth', async () => {
    if (!supertestAvailable) return;
    const res = await request(app).get('/api/trades/stats');
    expect(res.status).toBe(401);
  });

  it('returns 200 with stats when authenticated', async () => {
    if (!supertestAvailable) return;
    const Trade = require('../models/Trade');
    Trade.aggregate.mockResolvedValue([{ _id: 'CLOSED_TP', count: 5 }]);
    Trade.countDocuments.mockResolvedValue(8);

    const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const res = await request(app)
      .get('/api/trades/stats')
      .set('Cookie', `token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('winRate');
    expect(res.body).toHaveProperty('total');
  });
});
