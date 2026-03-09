'use strict';

/**
 * Unit tests for services/orderManager.js
 *
 * Regression suite covering the SEV-1 defect where all trades were stuck in
 * PENDING status on testnet because the STOP_LOSS order was sent with an
 * invalid `timeInForce` parameter (Binance error -1106), causing onBuyFilled
 * to throw and never transition PENDING → OPEN.
 *
 * Key assertions:
 *  1. STOP_LOSS (SL) order must NOT include `timeInForce` in the POST body.
 *  2. LIMIT (TP) order must include `timeInForce: 'GTC'`.
 *  3. Trade status transitions PENDING → OPEN after onBuyFilled succeeds.
 *  4. onBuyFilled resolves even when binance.restPost for SL omits timeInForce.
 *  5. placeMarketBuyOrder end-to-end: MARKET buy → TP+SL placed → PENDING→OPEN.
 */

// ── Env setup (before any requires) ──────────────────────────────────────────
process.env.NODE_ENV = 'test';
process.env.BINANCE_BASE_URL = 'https://testnet.binance.vision';
process.env.BINANCE_SECRET_KEY = 'testsecret';
process.env.BINANCE_API_KEY = 'testapikey';
process.env.REDIS_URL = 'redis://localhost:6379';

// ── Mock external deps ────────────────────────────────────────────────────────
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../config/constants', () => ({
  REDIS_KEYS: {
    POSITION: (s) => `position:${s}`,
    EXCHANGE_INFO: (s) => `exchangeInfo:${s}`,
    IP_BANNED: 'IP_BANNED',
  },
  ORDER_TIMEOUT_MS: 60000,
  TAKE_PROFIT_PCT: 0.015,   // 1.5 %
  STOP_LOSS_PCT: 0.005,     // 0.5 %
  SYMBOLS: ['BTCUSDT'],
}));

jest.mock('../models/Trade', () => ({
  create: jest.fn(),
  updateOne: jest.fn(),
}));

jest.mock('../socket/emitter', () => ({ emit: jest.fn() }));
jest.mock('../services/telegram', () => ({ send: jest.fn() }));
jest.mock('../services/riskManager', () => ({
  canTrade: jest.fn().mockResolvedValue(true),
  getPositionSize: jest.fn().mockResolvedValue(20),
  releaseLock: jest.fn().mockResolvedValue(undefined),
  recordTradePnL: jest.fn().mockResolvedValue(undefined),
}));

// Bull queue mock — prevent real Redis connections
jest.mock('bull', () => {
  const EventEmitter = require('events');
  return jest.fn().mockImplementation(() => {
    const ee = new EventEmitter();
    const mock = {
      process: jest.fn(),
      resume: jest.fn().mockResolvedValue(undefined),
      pause: jest.fn().mockResolvedValue(undefined),
      on: ee.on.bind(ee),
      add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
      getJob: jest.fn().mockResolvedValue(null),
    };
    return mock;
  });
});

// binance service mock — controlled per-test
jest.mock('../services/binance', () => ({
  restPost: jest.fn(),
  restGet: jest.fn(),
  restDelete: jest.fn(),
  roundToTickSize: jest.fn((price) => parseFloat(price.toFixed(2))),
  roundToStepSize: jest.fn((qty) => parseFloat(qty.toFixed(6))),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockRedis(store = {}) {
  const _store = { ...store };
  return {
    get: jest.fn(async (key) => _store[key] ?? null),
    set: jest.fn(async (key, val) => { _store[key] = val; return 'OK'; }),
    del: jest.fn(async (key) => { delete _store[key]; return 1; }),
    incrby: jest.fn().mockResolvedValue(1),
    pexpire: jest.fn().mockResolvedValue(1),
    keys: jest.fn(async () => []),
    pipeline: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    _store,
  };
}

const SYMBOL = 'BTCUSDT';
const ENTRY_PRICE = 50000;
const FILLED_QTY = 0.0004;
const TICK_SIZE = 0.01;
const STEP_SIZE = 0.00001;
const MIN_NOTIONAL = 10;

const EXCHANGE_INFO = JSON.stringify({ tickSize: TICK_SIZE, stepSize: STEP_SIZE, minNotional: MIN_NOTIONAL });

const TP_ORDER_ID = 111;
const SL_ORDER_ID = 222;
const BUY_ORDER_ID = 100;

// ── Module access ─────────────────────────────────────────────────────────────

// orderManager is stateful (redisClient, queue). Re-require fresh per describe
// block using jest.isolateModules so each suite starts clean.

// ── SEV-1 Regression: STOP_LOSS must NOT have timeInForce ─────────────────────

describe('SEV-1 regression — STOP_LOSS order must not include timeInForce', () => {
  let binance;
  let Trade;
  let redis;

  beforeEach(() => {
    jest.resetModules();
    binance = require('../services/binance');
    Trade = require('../models/Trade');

    redis = makeMockRedis({
      [`exchangeInfo:${SYMBOL}`]: EXCHANGE_INFO,
    });

    // restPost side-effects:
    //  call 1 → TP LIMIT order
    //  call 2 → SL STOP_LOSS order
    binance.restPost
      .mockResolvedValueOnce({ orderId: TP_ORDER_ID, status: 'NEW' })
      .mockResolvedValueOnce({ orderId: SL_ORDER_ID, status: 'NEW' });

    binance.roundToTickSize.mockImplementation((price) => parseFloat(price.toFixed(2)));
    binance.roundToStepSize.mockImplementation((qty) => parseFloat(qty.toFixed(6)));

    Trade.create = jest.fn().mockResolvedValue({ _id: 'trade-id-1' });
    Trade.updateOne = jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  });

  it('does NOT pass timeInForce when placing the STOP_LOSS order', async () => {
    const orderManager = require('../services/orderManager');
    orderManager.init(redis);

    const pos = {
      tradeId: 'trade-id-1',
      buyOrderId: String(BUY_ORDER_ID),
      entryPrice: ENTRY_PRICE,
      quantity: FILLED_QTY,
      aiTp: null,
      aiSl: null,
    };

    // Expose the internal onBuyFilled via the module's test-only path
    // by calling placeMarketBuyOrder's downstream: simulate it directly.
    // We drive onBuyFilled by pre-seeding the position key and calling
    // the REST-poll fill path.

    await redis.set(`position:${SYMBOL}`, JSON.stringify(pos));

    // Call onBuyFilled indirectly through the module's exported interface
    // by accessing the internal via the restPost mock inspection.
    // Use the reconcileOpenPositions workaround: inject a filled buyOrder
    // scenario and observe restPost call args.

    // Direct approach: re-export onBuyFilled for white-box testing.
    // Since it's not exported we invoke placeMarketBuyOrder by mocking
    // the MARKET buy response, then inspecting all restPost calls.
    binance.restPost
      .mockReset()
      .mockResolvedValueOnce({
        // MARKET BUY response
        orderId: BUY_ORDER_ID,
        status: 'FILLED',
        executedQty: String(FILLED_QTY),
        cummulativeQuoteQty: String(ENTRY_PRICE * FILLED_QTY),
      })
      .mockResolvedValueOnce({ orderId: TP_ORDER_ID, status: 'NEW' })   // TP LIMIT
      .mockResolvedValueOnce({ orderId: SL_ORDER_ID, status: 'NEW' });  // SL STOP_LOSS

    redis._store[`exchangeInfo:${SYMBOL}`] = JSON.stringify({ tickSize: TICK_SIZE, stepSize: STEP_SIZE, minNotional: MIN_NOTIONAL });

    const riskManager = require('../services/riskManager');
    riskManager.canTrade.mockResolvedValue(true);
    riskManager.getPositionSize.mockResolvedValue(ENTRY_PRICE * FILLED_QTY);

    await orderManager.onBuySignal(SYMBOL, ENTRY_PRICE, 0.85, null);

    // restPost should have been called 3 times: MARKET BUY, TP LIMIT, SL STOP_LOSS
    expect(binance.restPost).toHaveBeenCalledTimes(3);

    const slCall = binance.restPost.mock.calls[2][1]; // third call params
    expect(slCall.type).toBe('STOP_LOSS');
    expect(slCall).not.toHaveProperty('timeInForce');
  });

  it('LIMIT (TP) order still carries timeInForce: GTC', async () => {
    const orderManager = require('../services/orderManager');
    orderManager.init(redis);

    binance.restPost
      .mockReset()
      .mockResolvedValueOnce({
        orderId: BUY_ORDER_ID,
        status: 'FILLED',
        executedQty: String(FILLED_QTY),
        cummulativeQuoteQty: String(ENTRY_PRICE * FILLED_QTY),
      })
      .mockResolvedValueOnce({ orderId: TP_ORDER_ID, status: 'NEW' })
      .mockResolvedValueOnce({ orderId: SL_ORDER_ID, status: 'NEW' });

    redis._store[`exchangeInfo:${SYMBOL}`] = EXCHANGE_INFO;

    const riskManager = require('../services/riskManager');
    riskManager.canTrade.mockResolvedValue(true);
    riskManager.getPositionSize.mockResolvedValue(ENTRY_PRICE * FILLED_QTY);

    await orderManager.onBuySignal(SYMBOL, ENTRY_PRICE, 0.85, null);

    const tpCall = binance.restPost.mock.calls[1][1]; // second call params
    expect(tpCall.type).toBe('LIMIT');
    expect(tpCall.timeInForce).toBe('GTC');
  });
});

// ── Trade status: PENDING → OPEN after successful onBuyFilled ─────────────────

describe('Trade status transitions PENDING → OPEN when TP/SL orders succeed', () => {
  let binance;
  let Trade;
  let redis;

  beforeEach(() => {
    jest.resetModules();
    binance = require('../services/binance');
    Trade = require('../models/Trade');

    redis = makeMockRedis({
      [`exchangeInfo:${SYMBOL}`]: EXCHANGE_INFO,
    });

    binance.roundToTickSize.mockImplementation((price) => parseFloat(price.toFixed(2)));
    binance.roundToStepSize.mockImplementation((qty) => parseFloat(qty.toFixed(6)));
    Trade.create = jest.fn().mockResolvedValue({ _id: 'trade-id-2' });
    Trade.updateOne = jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  });

  it('calls Trade.updateOne with status OPEN after placing TP and SL', async () => {
    const orderManager = require('../services/orderManager');
    orderManager.init(redis);

    binance.restPost
      .mockResolvedValueOnce({
        orderId: BUY_ORDER_ID,
        status: 'FILLED',
        executedQty: String(FILLED_QTY),
        cummulativeQuoteQty: String(ENTRY_PRICE * FILLED_QTY),
      })
      .mockResolvedValueOnce({ orderId: TP_ORDER_ID, status: 'NEW' })
      .mockResolvedValueOnce({ orderId: SL_ORDER_ID, status: 'NEW' });

    const riskManager = require('../services/riskManager');
    riskManager.canTrade.mockResolvedValue(true);
    riskManager.getPositionSize.mockResolvedValue(ENTRY_PRICE * FILLED_QTY);

    await orderManager.onBuySignal(SYMBOL, ENTRY_PRICE, 0.85, null);

    // Trade.updateOne must have been called to flip PENDING → OPEN
    const updateCalls = Trade.updateOne.mock.calls;
    const openCall = updateCalls.find(
      ([, update]) => update.status === 'OPEN'
    );
    expect(openCall).toBeDefined();
    expect(openCall[1].tpOrderId).toBe(String(TP_ORDER_ID));
    expect(openCall[1].slOrderId).toBe(String(SL_ORDER_ID));
  });

  it('trade remains PENDING if the SL order throws (to detect regressions)', async () => {
    const orderManager = require('../services/orderManager');
    orderManager.init(redis);

    // Simulate the old bug: SL restPost throws (e.g. Binance -1106)
    binance.restPost
      .mockResolvedValueOnce({
        orderId: BUY_ORDER_ID,
        status: 'FILLED',
        executedQty: String(FILLED_QTY),
        cummulativeQuoteQty: String(ENTRY_PRICE * FILLED_QTY),
      })
      .mockResolvedValueOnce({ orderId: TP_ORDER_ID, status: 'NEW' })
      .mockRejectedValueOnce(Object.assign(new Error('Invalid parameter'), {
        response: { status: 400, data: { code: -1106, msg: "Parameter 'timeInForce' sent when not required." } },
      }));

    const riskManager = require('../services/riskManager');
    riskManager.canTrade.mockResolvedValue(true);
    riskManager.getPositionSize.mockResolvedValue(ENTRY_PRICE * FILLED_QTY);

    // Should not throw at the onBuySignal level (error is caught internally)
    await orderManager.onBuySignal(SYMBOL, ENTRY_PRICE, 0.85, null);

    // Trade.updateOne with status OPEN must NOT have been called
    const openCall = Trade.updateOne.mock.calls.find(
      ([, update]) => update.status === 'OPEN'
    );
    expect(openCall).toBeUndefined();
  });
});

// ── SL order params correctness ───────────────────────────────────────────────

describe('SL order parameters are correct', () => {
  let binance;
  let Trade;
  let redis;

  beforeEach(() => {
    jest.resetModules();
    binance = require('../services/binance');
    Trade = require('../models/Trade');

    redis = makeMockRedis({
      [`exchangeInfo:${SYMBOL}`]: EXCHANGE_INFO,
    });

    binance.roundToTickSize.mockImplementation((price) => parseFloat(price.toFixed(2)));
    binance.roundToStepSize.mockImplementation((qty) => parseFloat(qty.toFixed(6)));
    Trade.create = jest.fn().mockResolvedValue({ _id: 'trade-id-3' });
    Trade.updateOne = jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  });

  it('SL order has side=SELL, correct stopPrice, and correct quantity', async () => {
    const { STOP_LOSS_PCT } = require('../config/constants');
    const orderManager = require('../services/orderManager');
    orderManager.init(redis);

    binance.restPost
      .mockResolvedValueOnce({
        orderId: BUY_ORDER_ID,
        status: 'FILLED',
        executedQty: String(FILLED_QTY),
        cummulativeQuoteQty: String(ENTRY_PRICE * FILLED_QTY),
      })
      .mockResolvedValueOnce({ orderId: TP_ORDER_ID, status: 'NEW' })
      .mockResolvedValueOnce({ orderId: SL_ORDER_ID, status: 'NEW' });

    const riskManager = require('../services/riskManager');
    riskManager.canTrade.mockResolvedValue(true);
    riskManager.getPositionSize.mockResolvedValue(ENTRY_PRICE * FILLED_QTY);

    await orderManager.onBuySignal(SYMBOL, ENTRY_PRICE, 0.85, null);

    const slParams = binance.restPost.mock.calls[2][1];
    const expectedStopPrice = parseFloat((ENTRY_PRICE * (1 - STOP_LOSS_PCT)).toFixed(2));

    expect(slParams.side).toBe('SELL');
    expect(slParams.type).toBe('STOP_LOSS');
    expect(slParams.stopPrice).toBe(expectedStopPrice);
    expect(slParams.quantity).toBe(FILLED_QTY);
    expect(slParams).not.toHaveProperty('timeInForce');
    expect(slParams).not.toHaveProperty('price'); // no limit price for market-stop
  });

  it('TP order has side=SELL, type=LIMIT, price, quantity and timeInForce=GTC', async () => {
    const { TAKE_PROFIT_PCT } = require('../config/constants');
    const orderManager = require('../services/orderManager');
    orderManager.init(redis);

    binance.restPost
      .mockResolvedValueOnce({
        orderId: BUY_ORDER_ID,
        status: 'FILLED',
        executedQty: String(FILLED_QTY),
        cummulativeQuoteQty: String(ENTRY_PRICE * FILLED_QTY),
      })
      .mockResolvedValueOnce({ orderId: TP_ORDER_ID, status: 'NEW' })
      .mockResolvedValueOnce({ orderId: SL_ORDER_ID, status: 'NEW' });

    const riskManager = require('../services/riskManager');
    riskManager.canTrade.mockResolvedValue(true);
    riskManager.getPositionSize.mockResolvedValue(ENTRY_PRICE * FILLED_QTY);

    await orderManager.onBuySignal(SYMBOL, ENTRY_PRICE, 0.85, null);

    const tpParams = binance.restPost.mock.calls[1][1];
    const expectedTpPrice = parseFloat((ENTRY_PRICE * (1 + TAKE_PROFIT_PCT)).toFixed(2));

    expect(tpParams.side).toBe('SELL');
    expect(tpParams.type).toBe('LIMIT');
    expect(tpParams.price).toBe(expectedTpPrice);
    expect(tpParams.timeInForce).toBe('GTC');
    expect(tpParams.quantity).toBe(FILLED_QTY);
  });
});
