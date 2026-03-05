'use strict';

const axios = require('axios');
const crypto = require('crypto');
const WebSocket = require('ws');
const logger = require('../utils/logger');
const { REDIS_KEYS, SYMBOLS, CANDLE_INTERVAL, CANDLE_BUFFER_MAX, CANDLE_BUFFER_MIN } = require('../config/constants');

let redisClient;
let wsConnections = {};
let pingIntervals = {};
let onCandleClose; // callback registered by server.js

function init(redis, candleCloseCallback) {
  redisClient = redis;
  onCandleClose = candleCloseCallback;
}

// ──────────────────────────────────────────────────────────
// Weight tracker
// ──────────────────────────────────────────────────────────
const WEIGHT_KEY = 'binance_weight';
const WEIGHT_WINDOW_MS = 60000;
const WEIGHT_CEILING = 1100; // conservative ceiling below 1200

async function trackWeight(weight = 1) {
  // Use INCRBY so the counter accumulates atomically across concurrent calls.
  // PEXPIRE is only set on the first increment — subsequent calls leave the
  // existing TTL untouched, matching Binance's real rolling-60s window.
  const next = await redisClient.incrby(WEIGHT_KEY, weight);
  if (next === weight) {
    await redisClient.pexpire(WEIGHT_KEY, WEIGHT_WINDOW_MS);
  }
  if (next >= WEIGHT_CEILING) {
    logger.warn(`[Binance] Weight ceiling reached (${next}). Pausing 10s.`);
    await new Promise((r) => setTimeout(r, 10000));
  }
}

// ──────────────────────────────────────────────────────────
// Shared HTTP error handler — 418 IP ban + 429 rate limit
// Called from every REST method so the logic lives in one place.
// ──────────────────────────────────────────────────────────
async function handleHttpError(err) {
  if (err.response) {
    const status = err.response.status;
    const retryAfter = parseInt(err.response.headers['retry-after'] || '60', 10);
    if (status === 418) {
      logger.error(`FATAL: Binance 418 IP ban — pausing for ${retryAfter}s`);
      await redisClient.set(REDIS_KEYS.IP_BANNED, '1', 'EX', retryAfter);
      const telegram = require('./telegram');
      telegram.send(`⛔ NOVAPULSE IP BANNED by Binance — all requests paused for ${retryAfter}s`);
    } else if (status === 429) {
      logger.warn(`[Binance] 429 rate limit — backing off ${retryAfter}s`);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
    }
  }
  throw err;
}

// ──────────────────────────────────────────────────────────
// REST client
// ──────────────────────────────────────────────────────────
async function restGet(path, params = {}, weight = 1, signed = false) {
  const ipBanned = await redisClient.get(REDIS_KEYS.IP_BANNED);
  if (ipBanned) {
    throw new Error('Binance IP banned — all requests paused');
  }
  await trackWeight(weight);

  if (signed) {
    params.timestamp = Date.now();
    const query = new URLSearchParams(params).toString();
    params.signature = crypto
      .createHmac('sha256', process.env.BINANCE_SECRET_KEY)
      .update(query)
      .digest('hex');
  }

  try {
    const res = await axios.get(`${process.env.BINANCE_BASE_URL}${path}`, {
      params,
      headers: { 'X-MBX-APIKEY': process.env.BINANCE_API_KEY },
    });
    return res.data;
  } catch (err) {
    await handleHttpError(err);
  }
}

async function restPost(path, params = {}, weight = 1) {
  const ipBanned = await redisClient.get(REDIS_KEYS.IP_BANNED);
  if (ipBanned) throw new Error('Binance IP banned');
  await trackWeight(weight);

  params.timestamp = Date.now();
  const query = new URLSearchParams(params).toString();
  params.signature = crypto
    .createHmac('sha256', process.env.BINANCE_SECRET_KEY)
    .update(query)
    .digest('hex');

  try {
    const res = await axios.post(
      `${process.env.BINANCE_BASE_URL}${path}`,
      new URLSearchParams(params),
      { headers: { 'X-MBX-APIKEY': process.env.BINANCE_API_KEY } }
    );
    return res.data;
  } catch (err) {
    await handleHttpError(err);
  }
}

// API-key-only POST (no timestamp / signature) — used for /api/v3/userDataStream
async function restPostUnsigned(path, weight = 1) {
  const ipBanned = await redisClient.get(REDIS_KEYS.IP_BANNED);
  if (ipBanned) throw new Error('Binance IP banned');
  await trackWeight(weight);

  try {
    const res = await axios.post(
      `${process.env.BINANCE_BASE_URL}${path}`,
      null,
      { headers: { 'X-MBX-APIKEY': process.env.BINANCE_API_KEY } }
    );
    return res.data;
  } catch (err) {
    await handleHttpError(err);
  }
}

// API-key-only PUT (no signature) — used for /api/v3/userDataStream keepalive
async function restPut(path, params = {}, weight = 1) {
  const ipBanned = await redisClient.get(REDIS_KEYS.IP_BANNED);
  if (ipBanned) throw new Error('Binance IP banned');
  await trackWeight(weight);

  try {
    const res = await axios.put(
      `${process.env.BINANCE_BASE_URL}${path}`,
      null,
      {
        params,
        headers: { 'X-MBX-APIKEY': process.env.BINANCE_API_KEY },
      }
    );
    return res.data;
  } catch (err) {
    await handleHttpError(err);
  }
}

async function restDelete(path, params = {}, weight = 1) {
  const ipBanned = await redisClient.get(REDIS_KEYS.IP_BANNED);
  if (ipBanned) throw new Error('Binance IP banned');
  await trackWeight(weight);

  params.timestamp = Date.now();
  const query = new URLSearchParams(params).toString();
  params.signature = crypto
    .createHmac('sha256', process.env.BINANCE_SECRET_KEY)
    .update(query)
    .digest('hex');

  try {
    const res = await axios.delete(`${process.env.BINANCE_BASE_URL}${path}`, {
      params,
      headers: { 'X-MBX-APIKEY': process.env.BINANCE_API_KEY },
    });
    return res.data;
  } catch (err) {
    await handleHttpError(err);
  }
}

// ──────────────────────────────────────────────────────────
// Exchange info & helpers
// ──────────────────────────────────────────────────────────
async function fetchAndCacheExchangeInfo() {
  const data = await restGet('/api/v3/exchangeInfo', {}, 10);
  for (const symbol of SYMBOLS) {
    const info = data.symbols.find((s) => s.symbol === symbol);
    if (!info) continue;
    const filters = {};
    for (const f of info.filters) {
      if (f.filterType === 'PRICE_FILTER') filters.tickSize = parseFloat(f.tickSize);
      if (f.filterType === 'LOT_SIZE') filters.stepSize = parseFloat(f.stepSize);
      if (f.filterType === 'NOTIONAL') filters.minNotional = parseFloat(f.minNotional);
    }
    await redisClient.set(REDIS_KEYS.EXCHANGE_INFO(symbol), JSON.stringify(filters));
    logger.info(`[Binance] exchangeInfo cached for ${symbol}: ${JSON.stringify(filters)}`);
  }
}

function roundToTickSize(price, tickSize) {
  // Use log10 to count decimal places — safe for values in scientific notation
  // (e.g. 1e-8 === 0.00000001 but "1e-8".split('.')[1] would give wrong count)
  const decimals = Math.max(0, -Math.floor(Math.log10(tickSize)));
  return parseFloat((Math.round(price / tickSize) * tickSize).toFixed(decimals));
}

function roundToStepSize(qty, stepSize) {
  // Floor (never round up) to prevent placing orders for more than available capital
  const decimals = Math.max(0, -Math.floor(Math.log10(stepSize)));
  return parseFloat((Math.floor(qty / stepSize) * stepSize).toFixed(decimals));
}

// ──────────────────────────────────────────────────────────
// API key validation
// ──────────────────────────────────────────────────────────
async function validateApiKey() {
  try {
    await restGet('/api/v3/account', {}, 10, true);
    logger.info('[Binance] API key validated successfully');
  } catch (err) {
    logger.error(`FATAL: Binance API key invalid or missing permissions: ${err.message}`);
    process.exit(1);
  }
}

// ──────────────────────────────────────────────────────────
// Historical OHLCV fetch
// ──────────────────────────────────────────────────────────
async function fetchHistoricalCandles(symbol, interval, limit = 200, endTime = null, startTime = null) {
  const params = { symbol, interval, limit };
  if (endTime) params.endTime = endTime;
  if (startTime) params.startTime = startTime;
  return restGet('/api/v3/klines', params, 2);
}

/**
 * Paginate back `months` months of 15m candles and bulk-upsert into MongoDB.
 * Used for ML training data collection (Feature 9) and cold-start history.
 * Fetches 1000 candles per request, advances the window forward until caught up.
 */
async function fetchAndStoreHistoricalCandles(symbol, months = 6) {
  const Candle = require('../models/Candle');
  const intervalMs = 15 * 60 * 1000; // 15 minutes in ms
  const startTime = Date.now() - months * 30 * 24 * 60 * 60 * 1000;
  let currentStart = startTime;
  let totalSaved = 0;

  logger.info(`[Binance] Starting paginated history fetch for ${symbol} — ${months} months back`);

  while (currentStart < Date.now() - intervalMs) {
    let raw;
    try {
      raw = await fetchHistoricalCandles(symbol, CANDLE_INTERVAL, 1000, null, currentStart);
    } catch (err) {
      logger.error(`[Binance] Paginated fetch error for ${symbol} at ${currentStart}: ${err.message}`);
      break;
    }
    if (!raw || !raw.length) break;

    const candles = parseKlinesToCandles(raw, symbol);
    const ops = candles.map((c) => ({
      updateOne: {
        filter: { symbol, timestamp: c.timestamp },
        update: { $set: c },
        upsert: true,
      },
    }));
    await Candle.bulkWrite(ops);
    totalSaved += candles.length;

    const lastTs = candles[candles.length - 1].timestamp.getTime();
    currentStart = lastTs + intervalMs; // advance by one interval past last fetched candle

    logger.info(`[Binance] Paginated fetch ${symbol} — ${totalSaved} candles stored so far`);

    // Brief pause to respect Binance rate limits (~2 weight per call)
    await new Promise((r) => setTimeout(r, 250));
  }

  logger.info(`[Binance] Paginated history fetch complete for ${symbol} — total: ${totalSaved}`);
  return totalSaved;
}

/**
 * Check the last candle timestamp in the Redis buffer.
 * If the gap to now is greater than one 15m interval, REST-fetch the missing
 * candles and push them into the buffer + MongoDB before signal computation resumes.
 * Called from openCandleStream on every reconnect.
 */
async function backfillGap(symbol) {
  const Candle = require('../models/Candle');
  const intervalMs = 15 * 60 * 1000;

  const lastRaw = await redisClient.lrange(REDIS_KEYS.CANDLE_BUFFER(symbol), -1, -1);
  if (!lastRaw.length) {
    logger.warn(`[Binance] backfillGap: buffer empty for ${symbol} — skipping (seedCandleBuffer handles this)`);
    return;
  }

  const lastCandle = JSON.parse(lastRaw[0]);
  const lastTs = new Date(lastCandle.timestamp).getTime();
  const gap = Date.now() - lastTs;

  if (gap <= intervalMs) {
    logger.info(`[Binance] No gap for ${symbol} (${Math.round(gap / 1000)}s since last candle)`);
    return;
  }

  const missedEstimate = Math.floor(gap / intervalMs);
  logger.warn(
    `[Binance] Gap detected for ${symbol}: ~${missedEstimate} candles missing — backfilling via REST`
  );

  try {
    const limit = Math.min(missedEstimate + 2, 1000); // +2 safety margin, hard cap at 1000
    const raw = await fetchHistoricalCandles(
      symbol,
      CANDLE_INTERVAL,
      limit,
      null,
      lastTs + 1 // startTime = 1ms after the last known candle
    );
    if (!raw || !raw.length) {
      logger.info(`[Binance] backfillGap: no new candles returned for ${symbol}`);
      return;
    }

    const candles = parseKlinesToCandles(raw, symbol).filter(
      (c) => c.timestamp.getTime() > lastTs
    );
    if (!candles.length) return;

    // Push into Redis buffer
    const pipeline = redisClient.pipeline();
    for (const c of candles) {
      pipeline.rpush(REDIS_KEYS.CANDLE_BUFFER(symbol), JSON.stringify(c));
    }
    pipeline.ltrim(REDIS_KEYS.CANDLE_BUFFER(symbol), -CANDLE_BUFFER_MAX, -1);
    await pipeline.exec();

    // Bulk-upsert into MongoDB
    const ops = candles.map((c) => ({
      updateOne: {
        filter: { symbol, timestamp: c.timestamp },
        update: { $set: c },
        upsert: true,
      },
    }));
    await Candle.bulkWrite(ops);

    logger.info(`[Binance] backfillGap: inserted ${candles.length} missing candles for ${symbol}`);
  } catch (err) {
    logger.error(`[Binance] backfillGap failed for ${symbol}: ${err.message}`);
  }
}

function parseKlinesToCandles(raw, symbol) {
  return raw.map((k) => ({
    symbol,
    interval: CANDLE_INTERVAL,
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    timestamp: new Date(k[0]),
  }));
}

// ──────────────────────────────────────────────────────────
// Candle buffer seed
// ──────────────────────────────────────────────────────────
async function seedCandleBuffer(symbol) {
  const Candle = require('../models/Candle');
  let candles = await Candle.find({ symbol })
    .sort({ timestamp: -1 })
    .limit(CANDLE_BUFFER_MAX)
    .lean();

  // If MongoDB doesn't have enough history, always fetch from Binance REST so
  // indicators (which need >= CANDLE_BUFFER_MIN candles) can run immediately.
  if (candles.length < CANDLE_BUFFER_MIN) {
    logger.info(`[Binance] MongoDB only has ${candles.length} candles for ${symbol} — fetching from Binance REST`);
    try {
      const raw = await fetchHistoricalCandles(symbol, CANDLE_INTERVAL, CANDLE_BUFFER_MAX);
      const parsed = parseKlinesToCandles(raw, symbol);
      // Persist to MongoDB for future restarts (upsert on symbol+timestamp)
      for (const c of parsed) {
        await Candle.updateOne(
          { symbol: c.symbol, timestamp: c.timestamp },
          { $setOnInsert: c },
          { upsert: true }
        ).catch(() => {});
      }
      candles = parsed;
    } catch (err) {
      logger.error(`[Binance] Failed to fetch historical candles for ${symbol}: ${err.message}`);
    }
  }

  const sorted = candles.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const pipeline = redisClient.pipeline();
  pipeline.del(REDIS_KEYS.CANDLE_BUFFER(symbol));
  for (const c of sorted) {
    pipeline.rpush(REDIS_KEYS.CANDLE_BUFFER(symbol), JSON.stringify(c));
  }
  pipeline.ltrim(REDIS_KEYS.CANDLE_BUFFER(symbol), -CANDLE_BUFFER_MAX, -1);
  await pipeline.exec();

  if (sorted.length >= CANDLE_BUFFER_MIN) {
    await redisClient.set(REDIS_KEYS.BUFFER_READY(symbol), '1');
    logger.info(`[Binance] Candle buffer seeded for ${symbol} (${sorted.length} candles) — READY`);
  } else {
    // Clear any stale flag; signal engine will not run until live stream fills the buffer
    await redisClient.del(REDIS_KEYS.BUFFER_READY(symbol));
    logger.warn(`[Binance] Candle buffer for ${symbol} only has ${sorted.length} candles — NOT ready yet`);
  }
}

// ──────────────────────────────────────────────────────────
// Market data WebSocket streams
// ──────────────────────────────────────────────────────────
function openCandleStream(symbol) {
  const stream = symbol.toLowerCase() + `@kline_${CANDLE_INTERVAL}`;
  const url = `${process.env.BINANCE_WS_BASE}/${stream}`;
  let isReconnect = false; // tracks whether this is the initial connect or a subsequent reconnect

  function connect() {
    const ws = new WebSocket(url);
    wsConnections[symbol] = ws;

    ws.on('open', async () => {
      logger.info(`[Binance WS] Connected: ${stream}`);
      await redisClient.set(REDIS_KEYS.WS_CONNECTED(symbol), '1', 'EX', 600);

      // On reconnect: check for candle gaps caused by the outage and backfill before
      // signal computation resumes (prevents corrupted indicator values on the reconnect candle)
      if (isReconnect) {
        await backfillGap(symbol);
      }

      // Ping keepalive every 3 minutes
      pingIntervals[symbol] = setInterval(() => {
        let pongReceived = false;
        ws.once('pong', () => {
          pongReceived = true;
        });
        ws.ping();
        setTimeout(() => {
          if (!pongReceived) {
            logger.warn(`[Binance WS] PING TIMEOUT for ${symbol} — forcing reconnect`);
            ws.terminate();
          }
        }, 10000);
      }, 180000);
    });

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data);
        const k = msg.k;
        const candle = {
          symbol,
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
          timestamp: new Date(k.t),
          isClosed: k.x,
        };

        // Push to emitter for dashboard
        const emitter = require('../socket/emitter');
        emitter.emit('candle:update', candle);

        if (k.x) {
          // Candle closed — update buffer
          const pipeline = redisClient.pipeline();
          pipeline.rpush(REDIS_KEYS.CANDLE_BUFFER(symbol), JSON.stringify(candle));
          pipeline.ltrim(REDIS_KEYS.CANDLE_BUFFER(symbol), -CANDLE_BUFFER_MAX, -1);
          await pipeline.exec();

          // Save to MongoDB
          const Candle = require('../models/Candle');
          await Candle.updateOne(
            { symbol, timestamp: candle.timestamp },
            { $set: candle },
            { upsert: true }
          );

          if (onCandleClose) await onCandleClose(symbol, candle);
        }
      } catch (err) {
        logger.error(`[Binance WS] Parse error for ${symbol}: ${err.message}`);
      }
    });

    ws.on('error', (err) => {
      logger.error(`[Binance WS] Error for ${symbol}: ${err.message}`);
    });

    ws.on('close', () => {
      logger.warn(`[Binance WS] Disconnected: ${stream} — reconnecting in 3s`);
      redisClient.del(REDIS_KEYS.WS_CONNECTED(symbol));
      clearInterval(pingIntervals[symbol]);
      isReconnect = true; // mark so next open triggers gap backfill
      setTimeout(() => connect(), 3000);
    });
  }

  connect();
}

function openAllCandleStreams() {
  for (const symbol of SYMBOLS) {
    openCandleStream(symbol);
  }
}

function closeAllStreams() {
  for (const [symbol, ws] of Object.entries(wsConnections)) {
    clearInterval(pingIntervals[symbol]);
    ws.terminate();
  }
}

function getWsStatus() {
  return Object.fromEntries(
    SYMBOLS.map((s) => [
      s,
      wsConnections[s] ? wsConnections[s].readyState === 1 : false,
    ])
  );
}

module.exports = {
  init,
  restGet,
  restPost,
  restPostUnsigned,
  restPut,
  restDelete,
  fetchAndCacheExchangeInfo,
  roundToTickSize,
  roundToStepSize,
  validateApiKey,
  fetchHistoricalCandles,
  fetchAndStoreHistoricalCandles,
  parseKlinesToCandles,
  seedCandleBuffer,
  backfillGap,
  openAllCandleStreams,
  closeAllStreams,
  getWsStatus,
};
