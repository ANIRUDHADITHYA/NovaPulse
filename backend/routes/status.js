'use strict';

/**
 * GET /api/status
 * Returns live health + quota info for every external API / internal service.
 * Used by the APIStatus dashboard panel.
 */

const router = require('express').Router();
const axios = require('axios');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const { REDIS_KEYS, SYMBOLS } = require('../config/constants');
const binance = require('../services/binance');

let redisClient;
function init(redis) { redisClient = redis; }

// ── helpers ──────────────────────────────────────────────────────────────────

async function probe(fn) {
  try { return { ok: true, ...(await fn()) }; }
  catch (e) { return { ok: false, error: e.message?.slice(0, 120) }; }
}

function redisTtlToAge(ttl) {
  if (ttl === -2) return null;   // key doesn't exist
  if (ttl === -1) return 0;      // no expiry = persistent
  return ttl;                    // seconds remaining
}

// ── route ─────────────────────────────────────────────────────────────────────

router.get('/status', auth, async (req, res) => {
  const [
    binanceRest,
    binanceFutures,
    mlHealth,
    fng,
    cryptoCompare,
  ] = await Promise.all([
    // Binance REST ping
    probe(async () => {
      await axios.get(`${process.env.BINANCE_BASE_URL}/api/v3/ping`, { timeout: 5000 });
      const weight = parseInt(await redisClient.get(REDIS_KEYS.BINANCE_WEIGHT) || '0', 10);
      return { weight, weightLimit: 1200, note: 'testnet' };
    }),

    // Binance Futures REST (OI endpoint)
    probe(async () => {
      const res = await axios.get(`${process.env.BINANCE_FUTURES_URL}/fapi/v1/ping`, { timeout: 5000 });
      // Check when OI was last fetched
      const oiTtl = await redisClient.ttl(REDIS_KEYS.OI('BTCUSDT'));
      return { oiCacheSecsLeft: redisTtlToAge(oiTtl) };
    }),

    // ML service
    probe(async () => {
      const res = await axios.get(`${process.env.ML_SERVICE_URL}/health`, { timeout: 5000 });
      return { modelLoaded: res.data.model_loaded };
    }),

    // Fear & Greed (alternative.me — no auth, free)
    probe(async () => {
      const ttl = await redisClient.ttl(REDIS_KEYS.SENTIMENT);
      const raw = await redisClient.get(REDIS_KEYS.SENTIMENT);
      const data = raw ? JSON.parse(raw) : null;
      return { value: data?.value, classification: data?.classification, cacheTtl: redisTtlToAge(ttl) };
    }),

    // CryptoCompare News
    probe(async () => {
      const ttl = await redisClient.ttl('news_cache');
      return { cacheTtl: redisTtlToAge(ttl) };
    }),
  ]);

  // Taapi (no live ping — use counter + cache presence per symbol)
  const taapiCallsRaw = await redisClient.get(REDIS_KEYS.TAAPI_CALLS_TODAY);
  const taapiCallsTtl = await redisClient.ttl(REDIS_KEYS.TAAPI_CALLS_TODAY);
  const taapiCached = (await Promise.all(
    SYMBOLS.map((s) => redisClient.get(REDIS_KEYS.TAAPI(s)))
  )).some(Boolean);

  const taapiCalls = parseInt(taapiCallsRaw || '0', 10);
  const TAAPI_DAILY_LIMIT = 5000; // Free plan
  const taapi = {
    ok: true,
    callsToday: taapiCalls,
    dailyLimit: TAAPI_DAILY_LIMIT,
    remaining: TAAPI_DAILY_LIMIT - taapiCalls,
    pct: Math.round((taapiCalls / TAAPI_DAILY_LIMIT) * 100),
    counterResetsIn: redisTtlToAge(taapiCallsTtl),
    hasCachedData: taapiCached,
    plan: 'Free',
  };

  // Binance WebSocket per symbol
  const wsStatus = binance.getWsStatus();

  // MongoDB
  const mongoOk = mongoose.connection.readyState === 1;

  res.json({
    ts: new Date().toISOString(),
    services: {
      binanceRest: { label: 'Binance REST', plan: 'Testnet', ...binanceRest },
      binanceFutures: { label: 'Binance Futures', plan: 'Live (OI only)', ...binanceFutures },
      binanceWs: {
        label: 'Binance WebSocket',
        ok: Object.values(wsStatus).some(Boolean),
        symbols: wsStatus,
      },
      taapi: { label: 'Taapi.io', ...taapi },
      ml: { label: 'ML Service', plan: 'Internal', ...mlHealth },
      fearGreed: { label: 'Fear & Greed', plan: 'Free (alternative.me)', ...fng },
      cryptoCompareNews: { label: 'CryptoCompare News', plan: 'Free', ...cryptoCompare },
      mongodb: { label: 'MongoDB', ok: mongoOk, plan: 'Local' },
    },
  });
});

module.exports = { router, init };
