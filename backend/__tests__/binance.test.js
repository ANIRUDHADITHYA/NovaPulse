'use strict';

/**
 * Unit tests for the pure helper functions in services/binance.js
 * All external I/O (WebSocket, Redis, MongoDB, HTTP) is mocked so that
 * only the deterministic logic is exercised.
 */

// ── Mock all external deps before requiring the module ───────────────────────
jest.mock('ws');
jest.mock('axios');
jest.mock('ioredis', () => jest.fn(() => ({})));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../config/constants', () => ({
  SYMBOLS: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
  CANDLE_INTERVAL: '15m',
  CANDLE_BUFFER_MAX: 200,
  CANDLE_BUFFER_MIN: 50,
  REDIS_KEYS: {
    CANDLE_BUFFER: (s) => `candle_buffer:${s}`,
    EXCHANGE_INFO: (s) => `exchangeInfo:${s}`,
    SIGNAL_LOCK: (s) => `signal_lock:${s}`,
    POSITION: (s) => `position:${s}`,
    OI: (s) => `oi:${s}`,
    TAAPI: (s) => `taapi:${s}`,
    INDICATORS: (s) => `indicators:${s}`,
    DAILY_PNL: 'daily_pnl',
    WEEKLY_PNL: 'weekly_pnl',
    TRADING_HALTED: 'TRADING_HALTED',
    WEEKLY_REVIEW_FLAG: 'WEEKLY_REVIEW_FLAG',
    IP_BANNED: 'IP_BANNED',
    NEWS_VETO: 'NEWS_VETO',
    SENTIMENT: 'sentiment',
    BUFFER_READY: (s) => `buffer_ready:${s}`,
  },
}));

// Set minimal env vars so config/env.js validation does not throw
process.env.BINANCE_API_KEY = 'test_key';
process.env.BINANCE_SECRET_KEY = 'test_secret';
process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_SECRET = 'test_jwt_secret';
process.env.DASHBOARD_PASSWORD = 'test_password';
process.env.BINANCE_ENV = 'testnet';
process.env.BINANCE_BASE_URL = 'https://testnet.binance.vision';
process.env.BINANCE_WS_BASE = 'wss://testnet.binance.vision/ws';

const { parseKlinesToCandles, roundToTickSize, roundToStepSize } = require('../services/binance');

// ─── parseKlinesToCandles ─────────────────────────────────────────────────────

describe('parseKlinesToCandles', () => {
  // Raw Binance REST klines format:  [openTime, open, high, low, close, volume, ...]
  const rawKlines = [
    [1672531200000, '16547.20', '16600.00', '16480.00', '16555.50', '123.456', 1672531799999],
    [1672532100000, '16555.50', '16620.00', '16540.00', '16588.00', '98.123', 1672532699999],
  ];

  it('returns an array with the same length as the raw input', () => {
    const result = parseKlinesToCandles(rawKlines, 'BTCUSDT');
    expect(result).toHaveLength(2);
  });

  it('attaches the correct symbol to every candle', () => {
    const result = parseKlinesToCandles(rawKlines, 'ETHUSDT');
    result.forEach((c) => expect(c.symbol).toBe('ETHUSDT'));
  });

  it('parses OHLCV fields as numbers (not strings)', () => {
    const [candle] = parseKlinesToCandles(rawKlines, 'BTCUSDT');
    expect(typeof candle.open).toBe('number');
    expect(typeof candle.high).toBe('number');
    expect(typeof candle.low).toBe('number');
    expect(typeof candle.close).toBe('number');
    expect(typeof candle.volume).toBe('number');
  });

  it('parses OHLCV values correctly', () => {
    const [candle] = parseKlinesToCandles(rawKlines, 'BTCUSDT');
    expect(candle.open).toBe(16547.2);
    expect(candle.high).toBe(16600.0);
    expect(candle.low).toBe(16480.0);
    expect(candle.close).toBe(16555.5);
    expect(candle.volume).toBeCloseTo(123.456, 3);
  });

  it('converts the open-time integer to a Date object', () => {
    const [candle] = parseKlinesToCandles(rawKlines, 'BTCUSDT');
    expect(candle.timestamp).toBeInstanceOf(Date);
    expect(candle.timestamp.getTime()).toBe(1672531200000);
  });

  it('handles an empty input array without throwing', () => {
    const result = parseKlinesToCandles([], 'BTCUSDT');
    expect(result).toEqual([]);
  });

  it('handles a single-candle array', () => {
    const single = [[1672531200000, '20000.00', '20100.00', '19900.00', '20050.00', '50.0', 1672531799999]];
    const result = parseKlinesToCandles(single, 'BTCUSDT');
    expect(result).toHaveLength(1);
    expect(result[0].close).toBe(20050.0);
  });
});

// ─── roundToTickSize ──────────────────────────────────────────────────────────

describe('roundToTickSize', () => {
  it('rounds to nearest tick below for values already on the grid', () => {
    expect(roundToTickSize(43219.37, 0.01)).toBeCloseTo(43219.37, 5);
  });

  it('rounds to nearest tick for a value just above a tick boundary', () => {
    // 43219.375 with tickSize=0.01 → round → 43219.38
    expect(roundToTickSize(43219.375, 0.01)).toBeCloseTo(43219.38, 5);
  });

  it('handles whole-number tick sizes correctly', () => {
    expect(roundToTickSize(84253, 1)).toBe(84253);
    expect(roundToTickSize(84253.7, 1)).toBe(84254);
  });

  it('handles small tick sizes used on altcoins', () => {
    // SOL price ~150, tickSize=0.001
    expect(roundToTickSize(150.1234, 0.001)).toBeCloseTo(150.123, 3);
  });

  it('handles very small tick sizes (8 decimal places)', () => {
    const result = roundToTickSize(0.000018765, 0.00000001);
    expect(result).toBeCloseTo(0.00001877, 8); // rounds last digit
  });

  it('returns a finite number for any positive price + tickSize', () => {
    expect(isFinite(roundToTickSize(100, 0.1))).toBe(true);
  });
});

// ─── roundToStepSize ──────────────────────────────────────────────────────────

describe('roundToStepSize', () => {
  it('floors to the nearest step (never rounds up — prevents over-spend)', () => {
    // qty=0.001789, step=0.001 → floor → 0.001  (NOT 0.002)
    expect(roundToStepSize(0.001789, 0.001)).toBeCloseTo(0.001, 3);
  });

  it('returns the quantity unchanged when already on a step boundary', () => {
    expect(roundToStepSize(0.005, 0.001)).toBeCloseTo(0.005, 3);
  });

  it('handles integer step sizes', () => {
    expect(roundToStepSize(3.9, 1)).toBe(3);
    expect(roundToStepSize(5.0, 1)).toBe(5);
  });

  it('handles fractional quantities with large step sizes', () => {
    // BTC stepSize=0.00001; qty=0.001234567 → floor → 0.00123
    expect(roundToStepSize(0.001234567, 0.00001)).toBeCloseTo(0.00123, 5);
  });

  it('returns 0 for a quantity smaller than one step', () => {
    // qty=0.0004, step=0.001 → floor → 0
    expect(roundToStepSize(0.0004, 0.001)).toBe(0);
  });

  it('returns a finite number for any positive qty + stepSize', () => {
    expect(isFinite(roundToStepSize(1.5, 0.5))).toBe(true);
  });
});
