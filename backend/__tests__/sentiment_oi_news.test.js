'use strict';

/**
 * Unit tests for:
 *  - services/sentiment.js  (scoreSentiment, fetchSentiment)
 *  - services/oi.js         (scoreOI)
 *  - services/news.js       (fetchAndCheckNews — keyword veto logic)
 */

// ── Mock shared deps ──────────────────────────────────────────────────────────
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../config/constants', () => ({
  REDIS_KEYS: {
    SENTIMENT: 'sentiment',
    OI: (s) => `oi:${s}`,
    NEWS_VETO: 'NEWS_VETO',
  },
  SYMBOLS: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
  OI_DELTA_THRESHOLD: 0.02,
  FUNDING_RATE_THRESHOLD: 0.001,
  FEAR_GREED_BUY_MAX: 45,
  FEAR_GREED_VETO: 80,
  CANDLE_INTERVAL: '15m',
}));

jest.mock('../socket/emitter', () => ({ emit: jest.fn() }));
jest.mock('../models/OI', () => ({ create: jest.fn().mockResolvedValue({}) }));
jest.mock('axios');
const axiosMock = require('axios');

// ─────────────────────────────────────────────────────────────────────────────
// SENTIMENT
// ─────────────────────────────────────────────────────────────────────────────

describe('scoreSentiment', () => {
  const { scoreSentiment } = require('../services/sentiment');

  it('returns 0 when sentimentData is null', () => {
    expect(scoreSentiment(null)).toBe(0);
  });

  it('returns 1 (buy zone) for Fear & Greed < FEAR_GREED_BUY_MAX (45)', () => {
    expect(scoreSentiment({ value: 20 })).toBe(1);
    expect(scoreSentiment({ value: 44 })).toBe(1);
  });

  it('returns "veto" when value >= FEAR_GREED_VETO (80)', () => {
    expect(scoreSentiment({ value: 80 })).toBe('veto');
    expect(scoreSentiment({ value: 95 })).toBe('veto');
  });

  it('returns 0 (neutral) for values 45–55', () => {
    expect(scoreSentiment({ value: 45 })).toBe(0);
    expect(scoreSentiment({ value: 55 })).toBe(0);
  });

  it('returns -1 (avoid) for values 56–79', () => {
    expect(scoreSentiment({ value: 60 })).toBe(-1);
    expect(scoreSentiment({ value: 79 })).toBe(-1);
  });
});

describe('fetchSentiment — Redis caching', () => {
  const sentiment = require('../services/sentiment');

  beforeEach(() => jest.clearAllMocks());

  it('stores result in Redis with 65-minute TTL on success', async () => {
    axiosMock.get.mockResolvedValue({
      data: { data: [{ value: '42', value_classification: 'Fear' }] },
    });

    const redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };
    sentiment.init(redis);

    const result = await sentiment.fetchSentiment();
    expect(result).toMatchObject({ value: 42, classification: 'Fear' });
    expect(redis.set).toHaveBeenCalledWith(
      'sentiment',
      expect.any(String),
      'EX',
      3900
    );
  });

  it('returns null and does not throw when API call fails', async () => {
    axiosMock.get.mockRejectedValue(new Error('Network error'));

    const redis = { get: jest.fn(), set: jest.fn() };
    sentiment.init(redis);

    const result = await sentiment.fetchSentiment();
    expect(result).toBeNull();
    expect(redis.set).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OI
// ─────────────────────────────────────────────────────────────────────────────

describe('scoreOI', () => {
  const { scoreOI } = require('../services/oi');

  it('returns 0 when oiData is null', () => {
    expect(scoreOI(null, true)).toBe(0);
  });

  it('returns "veto" when |fundingRate| > FUNDING_RATE_THRESHOLD (0.001)', () => {
    expect(scoreOI({ fundingRate: 0.002, oiDeltaPct: 0.05 }, true)).toBe('veto');
    expect(scoreOI({ fundingRate: -0.002, oiDeltaPct: 0.05 }, true)).toBe('veto');
  });

  it('returns 1 (long buildup) when OI delta > threshold and price is rising', () => {
    expect(scoreOI({ fundingRate: 0.0005, oiDeltaPct: 0.03 }, true)).toBe(1);
  });

  it('returns 0 (neutral) when OI delta > threshold but price is NOT rising and funding is flat', () => {
    // fundingRate: 0 keeps the tiebreaker neutral; 0.0005 would trigger bearish tiebreaker
    expect(scoreOI({ fundingRate: 0, oiDeltaPct: 0.03 }, false)).toBe(0);
  });

  it('returns -1 when OI delta < -threshold (short buildup)', () => {
    expect(scoreOI({ fundingRate: 0.0005, oiDeltaPct: -0.05 }, false)).toBe(-1);
  });

  it('returns 0 when OI delta is within the neutral band and funding is flat', () => {
    // fundingRate: 0 keeps the tiebreaker neutral — the neutral-band assertion
    // is only meaningful when there is no funding-rate pressure either way
    expect(scoreOI({ fundingRate: 0, oiDeltaPct: 0.01 }, true)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NEWS — keyword veto logic
// ─────────────────────────────────────────────────────────────────────────────

describe('fetchAndCheckNews — veto keyword detection', () => {
  const VETO_TTL_S = 15 * 60; // must match VETO_TTL_S in services/news.js
  const news = require('../services/news');

  function makeArticle(title, publishedSecondsAgo = 60) {
    return {
      title,
      body: '',
      published_on: Math.floor((Date.now() - publishedSecondsAgo * 1000) / 1000),
    };
  }

  function makeRedis() {
    return {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue(null),
    };
  }

  beforeEach(() => jest.clearAllMocks());

  it('sets NEWS_VETO when a FOMC article was published within 30 minutes', async () => {
    axiosMock.get.mockResolvedValue({
      status: 200,
      data: { Data: [makeArticle('Fed announces FOMC decision on interest rates')] },
    });
    const redis = makeRedis();
    news.init(redis);
    const result = await news.fetchAndCheckNews();
    expect(result).toMatchObject({ vetoed: true });
    expect(redis.set).toHaveBeenCalledWith('NEWS_VETO', '1', 'EX', VETO_TTL_S);
  });

  it('does NOT set NEWS_VETO when matching article is older than 30 minutes', async () => {
    axiosMock.get.mockResolvedValue({
      status: 200,
      data: { Data: [makeArticle('CPI inflation report released', 35 * 60)] },
    });
    const redis = makeRedis();
    news.init(redis);
    const result = await news.fetchAndCheckNews();
    expect(result).toMatchObject({ vetoed: false });
    expect(redis.set).not.toHaveBeenCalledWith('NEWS_VETO', '1', 'EX', VETO_TTL_S);
  });

  it('returns null (fail-open) and does NOT set veto when API call fails', async () => {
    axiosMock.get.mockRejectedValue(new Error('API timeout'));
    const redis = makeRedis();
    news.init(redis);
    const result = await news.fetchAndCheckNews();
    expect(result).toBeNull();
    expect(redis.set).not.toHaveBeenCalledWith('NEWS_VETO', '1', expect.anything(), expect.anything());
  });

  it('does NOT veto for benign articles', async () => {
    axiosMock.get.mockResolvedValue({
      status: 200,
      data: { Data: [makeArticle('Bitcoin price reaches new monthly high')] },
    });
    const redis = makeRedis();
    news.init(redis);
    const result = await news.fetchAndCheckNews();
    expect(result).toMatchObject({ vetoed: false });
  });

  it('detects case-insensitive veto keywords (lowercase "hack")', async () => {
    axiosMock.get.mockResolvedValue({
      status: 200,
      data: { Data: [makeArticle('Major exchange suffers hack losing $100M')] },
    });
    const redis = makeRedis();
    news.init(redis);
    const result = await news.fetchAndCheckNews();
    expect(result).toMatchObject({ vetoed: true });
  });
});
