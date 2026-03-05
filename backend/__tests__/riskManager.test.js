'use strict';

/**
 * Unit tests for services/riskManager.js
 *
 * External dependencies (Redis, MongoDB Trade/DailySnapshot, emitter,
 * telegram, binance) are all mocked. Tests exercise pure logic paths:
 *  - canTrade lock + halted + position checks
 *  - recordTradePnL accumulation and drawdown halt
 *  - persistDailySnapshot correctness
 *  - sendDailySummary message format
 */

// ── Mock external deps before requiring the module ────────────────────────────
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../config/constants', () => ({
  REDIS_KEYS: {
    TRADING_HALTED: 'TRADING_HALTED',
    DAILY_PNL: 'daily_pnl',
    DAILY_PNL_USDT: 'daily_pnl_usdt',
    WEEKLY_PNL: 'weekly_pnl',
    WEEKLY_REVIEW_FLAG: 'WEEKLY_REVIEW_FLAG',
    POSITION: (s) => `position:${s}`,
  },
  MAX_OPEN_POSITIONS: 3,
  MAX_CAPITAL_PCT: 0.2,
}));

jest.mock('../models/Trade', () => ({
  countDocuments: jest.fn(),
  find: jest.fn(),
  aggregate: jest.fn(),
}));

jest.mock('../models/DailySnapshot', () => ({
  findOneAndUpdate: jest.fn(),
}));

jest.mock('../socket/emitter', () => ({ emit: jest.fn() }));
jest.mock('./telegram', () => ({ send: jest.fn() }), { virtual: true });
jest.mock('../services/telegram', () => ({ send: jest.fn() }));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockRedis(store = {}) {
  const _store = { ...store };
  return {
    get: jest.fn(async (key) => _store[key] ?? null),
    set: jest.fn(async (key, val) => { _store[key] = val; return 'OK'; }),
    del: jest.fn(async (key) => { delete _store[key]; return 1; }),
    keys: jest.fn(async (pattern) =>
      Object.keys(_store).filter((k) => k.startsWith(pattern.replace('*', '')))
    ),
    _store,
  };
}

const Trade = require('../models/Trade');
const DailySnapshot = require('../models/DailySnapshot');

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('canTrade — halted flag', () => {
  it('returns false when TRADING_HALTED is set', async () => {
    const redis = makeMockRedis({ TRADING_HALTED: '1' });
    const rm = require('../services/riskManager');
    rm.init(redis);
    const result = await rm.canTrade('BTCUSDT');
    expect(result).toBe(false);
  });
});

describe('canTrade — concurrency lock', () => {
  it('returns false when order_placement_lock is already held', async () => {
    const redis = makeMockRedis({});
    // All 4 retry attempts must fail — use mockResolvedValue (not Once) so the
    // retry loop never acquires the lock and canTrade correctly returns false.
    redis.set.mockResolvedValue(null);
    const rm = require('../services/riskManager');
    rm.init(redis);
    const result = await rm.canTrade('BTCUSDT');
    expect(result).toBe(false);
  }, 10000); // 4 retries × 1.5s each requires > 5s default Jest timeout

  it('returns false when max open positions reached', async () => {
    const redis = makeMockRedis({});
    redis.set.mockResolvedValueOnce('OK'); // lock acquired
    Trade.countDocuments.mockResolvedValueOnce(3); // at max
    const rm = require('../services/riskManager');
    rm.init(redis);
    const result = await rm.canTrade('BTCUSDT');
    expect(result).toBe(false);
  });

  it('returns false when symbol already has an open position in Redis', async () => {
    const redis = makeMockRedis({ 'position:BTCUSDT': '{"entryPrice":40000}' });
    redis.set.mockResolvedValueOnce('OK'); // lock acquired
    Trade.countDocuments.mockResolvedValueOnce(1);
    const rm = require('../services/riskManager');
    rm.init(redis);
    const result = await rm.canTrade('BTCUSDT');
    expect(result).toBe(false);
  });

  it('returns true and holds the lock when all checks pass', async () => {
    const redis = makeMockRedis({});
    redis.set.mockResolvedValueOnce('OK'); // lock acquired
    Trade.countDocuments.mockResolvedValueOnce(0);
    const rm = require('../services/riskManager');
    rm.init(redis);
    const result = await rm.canTrade('BTCUSDT');
    expect(result).toBe(true);
  });
});

describe('getDailyPnl / getDailyPnlUsdt / getWeeklyPnl', () => {
  it('returns 0 when Redis keys are missing', async () => {
    const redis = makeMockRedis({});
    const rm = require('../services/riskManager');
    rm.init(redis);
    expect(await rm.getDailyPnl()).toBe(0);
    expect(await rm.getDailyPnlUsdt()).toBe(0);
    expect(await rm.getWeeklyPnl()).toBe(0);
  });

  it('returns parsed float from Redis', async () => {
    const redis = makeMockRedis({
      daily_pnl: '1.5',
      daily_pnl_usdt: '30.25',
      weekly_pnl: '-2.0',
    });
    const rm = require('../services/riskManager');
    rm.init(redis);
    expect(await rm.getDailyPnl()).toBe(1.5);
    expect(await rm.getDailyPnlUsdt()).toBe(30.25);
    expect(await rm.getWeeklyPnl()).toBe(-2.0);
  });
});

describe('recordTradePnL — accumulation', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    jest.mock('../config/constants', () => ({
      REDIS_KEYS: { TRADING_HALTED: 'TRADING_HALTED', DAILY_PNL: 'daily_pnl', DAILY_PNL_USDT: 'daily_pnl_usdt', WEEKLY_PNL: 'weekly_pnl', WEEKLY_REVIEW_FLAG: 'WEEKLY_REVIEW_FLAG', POSITION: (s) => `position:${s}` },
      MAX_OPEN_POSITIONS: 3,
      MAX_CAPITAL_PCT: 0.2,
    }));
    jest.mock('../models/Trade', () => ({ countDocuments: jest.fn().mockResolvedValue(0) }));
    jest.mock('../models/DailySnapshot', () => ({ findOneAndUpdate: jest.fn() }));
    jest.mock('../socket/emitter', () => ({ emit: jest.fn() }));
    jest.mock('../services/telegram', () => ({ send: jest.fn() }));
  });

  it('sets TRADING_HALTED when daily drawdown exceeds MAX_DAILY_DRAWDOWN', async () => {
    process.env.MAX_DAILY_DRAWDOWN = '2';
    const redis = makeMockRedis({ daily_pnl: '-1.9', daily_pnl_usdt: '-100', weekly_pnl: '-1.9' });
    const rm = require('../services/riskManager');
    rm.init(redis);
    await rm.recordTradePnL(-0.5, -25); // total becomes -2.4 → breaches -2
    // Actual ioredis call includes EX + TTL — assert with expect.any(Number)
    expect(redis.set).toHaveBeenCalledWith('TRADING_HALTED', '1', 'EX', expect.any(Number));
  });

  it('does NOT halt when daily drawdown is within limit', async () => {
    process.env.MAX_DAILY_DRAWDOWN = '2';
    const redis = makeMockRedis({ daily_pnl: '0', daily_pnl_usdt: '0', weekly_pnl: '0' });
    const rm = require('../services/riskManager');
    rm.init(redis);
    await rm.recordTradePnL(-0.5, -25);
    const haltCall = redis.set.mock.calls.find((c) => c[0] === 'TRADING_HALTED' && c[1] === '1');
    expect(haltCall).toBeUndefined();
  });

  it('cumulates P&L across multiple trades', async () => {
    process.env.MAX_DAILY_DRAWDOWN = '10';
    const store = { daily_pnl: '1.0', daily_pnl_usdt: '50', weekly_pnl: '1.0' };
    const redis = makeMockRedis(store);
    const rm = require('../services/riskManager');
    rm.init(redis);
    await rm.recordTradePnL(0.5, 25);
    // After trade: daily_pnl should be written as '1.5000'
    const setCall = redis.set.mock.calls.find((c) => c[0] === 'daily_pnl');
    expect(parseFloat(setCall[1])).toBeCloseTo(1.5, 3);
  });
});

describe('persistDailySnapshot', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    jest.mock('../config/constants', () => ({
      REDIS_KEYS: { TRADING_HALTED: 'TRADING_HALTED', DAILY_PNL: 'daily_pnl', DAILY_PNL_USDT: 'daily_pnl_usdt', WEEKLY_PNL: 'weekly_pnl', WEEKLY_REVIEW_FLAG: 'WEEKLY_REVIEW_FLAG', POSITION: (s) => `position:${s}` },
      MAX_OPEN_POSITIONS: 3,
      MAX_CAPITAL_PCT: 0.2,
    }));
    jest.mock('../models/Trade', () => ({ countDocuments: jest.fn() }));
    jest.mock('../models/DailySnapshot', () => ({ findOneAndUpdate: jest.fn().mockResolvedValue({}) }));
    jest.mock('../socket/emitter', () => ({ emit: jest.fn() }));
    jest.mock('../services/telegram', () => ({ send: jest.fn() }));
  });

  it('calls DailySnapshot.findOneAndUpdate with upsert:true', async () => {
    const DSnap = require('../models/DailySnapshot');
    const Trade = require('../models/Trade');
    Trade.countDocuments.mockResolvedValue(5);
    const redis = makeMockRedis({ daily_pnl: '1.2', daily_pnl_usdt: '60', TRADING_HALTED: null });
    const rm = require('../services/riskManager');
    rm.init(redis);
    await rm.persistDailySnapshot();
    expect(DSnap.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }),
      expect.objectContaining({ dailyPnlPct: 1.2, dailyPnlUsdt: 60 }),
      expect.objectContaining({ upsert: true, new: true })
    );
  });
});
