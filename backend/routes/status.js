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

  // ── AI Layer 6 (OpenAI / Claude) ──────────────────────────────────────────
  const provider   = (process.env.AI_PROVIDER || '').toLowerCase();
  const aiModel    = process.env.AI_MODEL || (provider === 'claude' ? 'claude-3-5-haiku-20241022' : 'gpt-4o-mini');
  const aiKeySet   = provider === 'claude'
    ? !!process.env.ANTHROPIC_API_KEY
    : !!process.env.OPENAI_API_KEY;

  const [aiPromptRaw, aiCompletionRaw, aiCallsRaw, aiLastCallRaw, aiCounterTtlRaw] = await Promise.all([
    redisClient.get('ai_tokens_today:prompt'),
    redisClient.get('ai_tokens_today:completion'),
    redisClient.get('ai_calls_today'),
    redisClient.get('ai_last_call'),
    redisClient.ttl('ai_tokens_today:prompt'),
  ]);

  const aiPromptTokens     = parseInt(aiPromptRaw     || '0', 10);
  const aiCompletionTokens = parseInt(aiCompletionRaw || '0', 10);
  const aiCallsToday       = parseInt(aiCallsRaw      || '0', 10);
  const aiTotalTokens      = aiPromptTokens + aiCompletionTokens;

  // Per-model cost estimates (USD per 1M tokens)
  const COST_TABLE = {
    'gpt-4o-mini':              { inp: 0.150,  out: 0.600  },
    'gpt-4o':                   { inp: 2.50,   out: 10.00  },
    'claude-3-5-haiku-20241022':{ inp: 0.80,   out: 4.00   },
    'claude-3-5-sonnet-20241022':{ inp: 3.00,  out: 15.00  },
  };
  const costRow = COST_TABLE[aiModel] || { inp: 0, out: 0 };
  const aiCostToday = (
    (aiPromptTokens     / 1_000_000) * costRow.inp +
    (aiCompletionTokens / 1_000_000) * costRow.out
  );

  const ai = {
    ok:               !!provider && aiKeySet,
    configured:       !!provider,
    keySet:           aiKeySet,
    provider:         provider || 'none',
    model:            aiModel,
    callsToday:       aiCallsToday,
    promptTokens:     aiPromptTokens,
    completionTokens: aiCompletionTokens,
    totalTokens:      aiTotalTokens,
    costUsdToday:     parseFloat(aiCostToday.toFixed(6)),
    lastCall:         aiLastCallRaw || null,
    counterResetsIn:  redisTtlToAge(aiCounterTtlRaw),
    error:            !provider ? 'AI_PROVIDER not set' : !aiKeySet ? 'API key missing' : null,
  };

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
      ai: { label: 'AI Layer 6', ...ai },
    },
  });
});

module.exports = { router, init };
