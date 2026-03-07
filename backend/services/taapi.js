'use strict';

const axios = require('axios');
const logger = require('../utils/logger');
const { REDIS_KEYS, SYMBOLS, CANDLE_INTERVAL } = require('../config/constants');

const TAAPI_BASE = 'https://api.taapi.io';
let redisClient;

function init(redis) {
  redisClient = redis;
}

async function _incTaapiCounter() {
  // Day-scoped counter — TTL set on first call of the day, left untouched after
  const key = REDIS_KEYS.TAAPI_CALLS_TODAY;
  const count = await redisClient.incr(key);
  if (count === 1) {
    // Expire at end of UTC day
    const now = new Date();
    const secsUntilMidnight = 86400 - (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds());
    await redisClient.expire(key, secsUntilMidnight);
  }
}

async function fetchSymbolIndicators(secret, symbol) {
  await _incTaapiCounter();
  // Free plan allows only 1 construct per bulk call — query each symbol individually.
  const construct = [{
    exchange: 'binance',
    symbol: symbol.replace('USDT', '/USDT'),
    interval: CANDLE_INTERVAL,
    indicators: [
      { indicator: 'rsi' },
      { indicator: 'macd' },
      { indicator: 'ema' },
    ],
  }];

  const res = await axios.post(`${TAAPI_BASE}/bulk`, { secret, construct });
  const data = res.data.data;

  // Auto-generated ID format: "binance_BTC/USDT_15m_rsi_14_0"
  const result = {};
  for (const item of data) {
    const parts = item.id.split('_');
    const indicator = parts[3];
    if (indicator) result[indicator] = item.result;
  }
  return result;
}

async function fetchBulkIndicators() {
  const secret = process.env.TAAPI_SECRET;
  if (!secret) {
    logger.warn('[Taapi] No TAAPI_SECRET — skipping');
    return null;
  }

  // Query each symbol one at a time (free plan: 1 construct per request).
  // Stagger calls by 1s to avoid hitting the per-minute rate limit.
  const results = {};
  for (const symbol of SYMBOLS) {
    try {
      results[symbol] = await fetchSymbolIndicators(secret, symbol);
      await redisClient.set(REDIS_KEYS.TAAPI(symbol), JSON.stringify(results[symbol]), 'EX', 960);
      logger.info(`[Taapi] Fetched indicators for ${symbol}`);
    } catch (err) {
      const detail = err.response?.data ? ` | ${JSON.stringify(err.response.data)}` : '';
      logger.warn(`[Taapi] Failed for ${symbol}: ${err.message}${detail}`);
    }
    // Small pause between symbols to stay within rate limit
    await new Promise((r) => setTimeout(r, 1200));
  }

  const fetched = Object.keys(results).length;
  if (fetched === 0) return null;
  logger.info(`[Taapi] Indicators fetched for ${fetched}/${SYMBOLS.length} symbols`);
  return results;
}

async function getLatestTaapi(symbol) {
  const cached = await redisClient.get(REDIS_KEYS.TAAPI(symbol));
  return cached ? JSON.parse(cached) : null;
}

/**
 * Layer 3 vote: +1 if Taapi confirms bullish, -1 bearish, 0 neutral/fallback
 */
function scoreTaapi(taapiData, layer1Indicators) {
  if (!taapiData) {
    // Taapi offline — abstain (return 0) rather than mirror L1.
    // Mirroring produces a correlated vote from the same data, making it easy to
    // reach the 3-layer consensus threshold with just 2 independent signals.
    logger.info('[Taapi] offline — Layer 3 abstains (returns 0)');
    return 0;
  }

  const rsi = taapiData.rsi?.value;
  const macdHist = taapiData.macd?.valueMACD - taapiData.macd?.valueMACDSignal;

  let bullish = 0;
  let bearish = 0;

  if (rsi !== undefined) {
    if (rsi < 40) bullish++;
    else if (rsi > 60) bearish++;
  }
  if (!isNaN(macdHist)) {
    if (macdHist > 0) bullish++;
    else if (macdHist < 0) bearish++;
  }

  const vote = bullish > bearish ? 1 : bearish > bullish ? -1 : 0;

  // Log agreement/disagreement with Layer 1 for post-trade analysis
  if (layer1Indicators) {
    const l1Vote = layer1Indicators.emaCross9_21 === 'bullish' && layer1Indicators.macdHistogram > 0 ? 1
      : layer1Indicators.emaCross9_21 === 'bearish' && layer1Indicators.macdHistogram < 0 ? -1 : 0;
    if (vote !== 0 && l1Vote !== 0) {
      if (vote === l1Vote) {
        logger.info(`[Taapi] AGREES with Layer 1 (vote: ${vote})`); 
      } else {
        logger.warn(`[Taapi] DISAGREES with Layer 1 — Taapi: ${vote}, Layer1: ${l1Vote}`);
      }
    }
  }

  return vote;
}

module.exports = { init, fetchBulkIndicators, getLatestTaapi, scoreTaapi };
