'use strict';

const logger = require('../utils/logger');
const { REDIS_KEYS, CANDLE_BUFFER_MIN } = require('../config/constants');
const indicators = require('./indicators');
const oi = require('./oi');
const taapi = require('./taapi');
const sentiment = require('./sentiment');
const aiSignal = require('./aiSignal');
const Signal = require('../models/Signal');
const emitter = require('../socket/emitter');

let redisClient;

function init(redis) {
  redisClient = redis;
}

/**
 * Layer 1 vote: +1 bullish, -1 bearish, 0 neutral
 */
function scoreLayer1(ind) {
  if (!ind) return 0;
  let bullish = 0;
  let bearish = 0;

  // RSI — bullish: oversold (<40) OR confirmed upward momentum (55-70)
  //         bearish: overbought (>70) — tightened from 75 to avoid late entries
  if (ind.rsi < 40 || (ind.rsi >= 55 && ind.rsi <= 70)) bullish++;
  else if (ind.rsi > 70) bearish++;

  // EMA trend alignment — checks ongoing trend, not just the crossover event
  // emaCross9_21 === 'bullish' only fires on 1 candle; EMA stack fires every candle in a trend
  if (ind.ema9 > ind.ema21 && ind.ema21 > ind.ema50) bullish++;
  else if (ind.ema9 < ind.ema21 && ind.ema21 < ind.ema50) bearish++;

  // MACD
  if (ind.macdHistogram > 0) bullish++;
  else if (ind.macdHistogram < 0) bearish++;

  // Bollinger squeeze breakout + volume surge
  if (ind.bbSqueeze && ind.volumeRatio > 1.5) bullish++;

  return bullish > bearish ? 1 : bearish > bullish ? -1 : 0;
}

/**
 * Evaluate all confluence layers and emit signal.
 */
async function evaluate(symbol) {
  // Buffer ready check
  const bufferReady = await redisClient.get(REDIS_KEYS.BUFFER_READY(symbol));
  if (!bufferReady) {
    logger.warn(`[Signal] Buffer not ready for ${symbol} — skipping`);
    return;
  }

  // Per-candle dedup lock — 60 s prevents double-fire from the same candle event
  // (NOT 900 s: using the candle interval as the TTL would block the very next candle)
  const lockKey = REDIS_KEYS.SIGNAL_LOCK(symbol);
  const locked = await redisClient.set(lockKey, '1', 'NX', 'EX', 60);
  if (!locked) {
    logger.info(`[Signal] Lock active for ${symbol} — skipping duplicate`);
    return;
  }

  // Layer 1 — Technical Indicators
  const ind = await indicators.computeIndicators(symbol);
  if (!ind) {
    // Buffer is flagged ready but indicators still returned null — not enough candles yet.
    // Clear the stale flag so the check at the top of evaluate() catches it next time.
    await redisClient.del(REDIS_KEYS.BUFFER_READY(symbol));
    logger.warn(`[Signal] ${symbol} — indicators returned null (insufficient candles). Clearing buffer_ready flag.`);
    return;
  }
  const layer1 = scoreLayer1(ind);
  logger.info(`[Signal] ${symbol} indicators — RSI:${ind.rsi?.toFixed(1)} EMACross:${ind.emaCross9_21} MACDhisto:${ind.macdHistogram?.toFixed(2)} BBsqueeze:${ind.bbSqueeze} VolRatio:${ind.volumeRatio?.toFixed(2)} → L1:${layer1}`);

  // Layer 2 — OI + Funding Rate
  const oiData = await oi.getLatestOI(symbol);
  // Use EMA9 > EMA21 (trend alignment) — crossover only fires once per trend, not every candle
  const priceRising = ind.ema9 > ind.ema21;
  const layer2 = oi.scoreOI(oiData, priceRising);

  // Layer 3 — Taapi
  const taapiData = await taapi.getLatestTaapi(symbol);
  const layer3 = taapi.scoreTaapi(taapiData, ind);

  // Layer 4 — Sentiment (fetch fresh if cache is stale — sentiment cron can race with signal)
  let sentimentData = await sentiment.getLatestSentiment();
  if (!sentimentData) sentimentData = await sentiment.fetchSentiment();
  const layer4 = sentiment.scoreSentiment(sentimentData);

  // ── Veto checks (after all layers computed so dashboard shows real scores) ──

  // News veto
  const newsVeto = await redisClient.get(REDIS_KEYS.NEWS_VETO);
  if (newsVeto) {
    logger.warn(`[Signal] News veto active — skipping ${symbol}`);
    await saveAndEmit(symbol, layer1, layer2, layer3, layer4, 0, null, false, 'NEUTRAL', true, 'NEWS_FILTER');
    return;
  }

  // Extreme funding veto
  if (layer2 === 'veto') {
    await saveAndEmit(symbol, layer1, 'veto', layer3, layer4, 0, null, false, 'NEUTRAL', true, 'EXTREME_FUNDING');
    return;
  }

  // Extreme greed veto
  if (layer4 === 'veto') {
    await saveAndEmit(symbol, layer1, layer2, layer3, 'veto', 0, null, false, 'NEUTRAL', true, 'EXTREME_GREED');
    return;
  }

  // Layer 5 — ML
  let layer5 = 0;
  let mlConfidence = null;
  let mlOffline = false;
  try {
    const axios2 = require('axios');
    // Only ind is strictly required — buildMLFeatures handles null oiData/sentimentData
    // with safe ?? defaults, so a temporarily unavailable OI or Fear&Greed feed no longer
    // silently skips the ML call and leaves mlConfidence = null.
    if (ind) {
      const features = buildMLFeatures(ind, oiData, sentimentData, taapiData);
      const mlRes = await axios2.post(`${process.env.ML_SERVICE_URL}/predict`, features, { timeout: 5000 });
      mlConfidence = mlRes.data.score;
      if (mlRes.data.fallback) {
        layer5 = 0;        // abstain on fallback — no trained model yet
        mlConfidence = null; // don't surface fallback 0.50 as a real score
      } else {
        layer5 = mlConfidence >= parseFloat(process.env.ML_CONFIDENCE_THRESHOLD || '0.72') ? 1 : -1;
      }
    }
  } catch (err) {
    logger.warn(`[Signal] ML service unavailable — Layer 5 abstains: ${err.message}`);
    layer5 = 0;
    mlOffline = true;
  }

  // All layers must agree (no veto, and sum > 0 for BUY)
  const numericScores = [layer1, layer2, layer3, layer4, layer5].filter((s) => s !== 0);
  const allBullish = numericScores.length >= 3 && numericScores.every((s) => s === 1);
  const allBearish = numericScores.length >= 3 && numericScores.every((s) => s === -1);

  let finalSignal = 'NEUTRAL';
  if (allBullish) finalSignal = 'BUY';
  else if (allBearish) finalSignal = 'SELL';

  // ── Layer 6: AI chart-pattern confirmation ──────────────────────────────────
  // Only invoked when layers 1-5 agree on a directional trade (saves API calls).
  // If the AI disagrees or is offline, we treat it as VETO or abstain respectively.
  let layer6 = 0;
  let aiResult = null; // { signal, entry, sl, tp, rr, pattern, reason }

  if (finalSignal === 'BUY' || finalSignal === 'SELL') {
    // Read raw candles from Redis for AI pattern analysis
    const raw = await redisClient.lrange(REDIS_KEYS.CANDLE_BUFFER(symbol), 0, -1);
    const candles = raw.map((s) => JSON.parse(s));

    const layerSummary =
      `L1:${layer1} L2:${layer2} L3:${layer3} L4:${layer4} L5:${layer5} ML:${mlConfidence ?? 'N/A'}`;

    aiResult = await aiSignal.analyze(symbol, candles, ind, oiData, sentimentData, layerSummary);

    if (aiResult !== null) {
      // AI responded — honour its verdict
      if (aiResult.signal === finalSignal) {
        layer6 = 1;  // confirms direction
      } else {
        layer6 = -1; // AI disagrees → veto
        logger.warn(
          `[Signal] ${symbol} — Layer 6 AI VETO: engine=${finalSignal} AI=${aiResult.signal} ` +
          `(${aiResult.reason})`
        );
        await saveAndEmit(
          symbol, layer1, layer2, layer3, layer4, layer5,
          mlConfidence, mlOffline, 'NEUTRAL', true, 'AI_VETO',
          layer6, aiResult
        );
        return;
      }
    } else {
      // AI offline — abstain; don't block trade
      layer6 = 0;
      logger.info(`[Signal] ${symbol} — Layer 6 offline, proceeding without AI levels`);
    }
  }

  await saveAndEmit(
    symbol, layer1, layer2, layer3, layer4, layer5,
    mlConfidence, mlOffline, finalSignal, false, null,
    layer6, aiResult
  );

  // Route BUY to Order Manager; SELL to dashboard only
  if (finalSignal === 'BUY') {
    const orderManager = require('./orderManager');
    await orderManager.onBuySignal(symbol, ind.currentPrice, mlConfidence, aiResult);
  }
}

function buildMLFeatures(ind, oiData, sentimentData, taapiData) {
  const now = new Date();
  return {
    ema_cross_9_21: ind.emaCross9_21 === 'bullish' ? 1 : ind.emaCross9_21 === 'bearish' ? -1 : 0,
    ema_cross_21_50: ind.emaCross21_50 === 'bullish' ? 1 : ind.emaCross21_50 === 'bearish' ? -1 : 0,
    rsi_14: ind.rsi,
    macd_histogram: ind.macdHistogram,
    bb_squeeze: ind.bbSqueeze ? 1 : 0,
    volume_ratio: ind.volumeRatio,
    oi_change_pct_15m: oiData?.oiDeltaPct ?? 0,
    oi_change_pct_1h: oiData?.oiDelta1hPct ?? 0,
    funding_rate: oiData?.fundingRate ?? 0,
    long_short_ratio: oiData?.longShortRatio ?? 0.5,
    fear_greed_value: sentimentData?.value ?? 50,
    taapi_rsi: taapiData?.rsi?.value ?? ind.rsi,
    taapi_macd_signal: taapiData?.macd?.valueMACDSignal ?? ind.macdSignal,
    hour_of_day: now.getUTCHours(),
    day_of_week: now.getUTCDay(),
    is_weekend: now.getUTCDay() === 0 || now.getUTCDay() === 6 ? 1 : 0,
  };
}

async function saveAndEmit(
  symbol, layer1, layer2, layer3, layer4, layer5,
  mlConfidence, mlOffline, finalSignal, vetoed, vetoReason,
  layer6 = 0, aiResult = null
) {
  const ts = new Date();
  const doc = {
    symbol,
    timestamp: ts,
    layer1Score: typeof layer1 === 'number' ? layer1 : null,
    layer2Score: typeof layer2 === 'number' ? layer2 : null,
    layer3Score: typeof layer3 === 'number' ? layer3 : null,
    layer4Score: typeof layer4 === 'number' ? layer4 : null,
    layer5Score: typeof layer5 === 'number' ? layer5 : null,
    layer6Score: typeof layer6 === 'number' ? layer6 : null,
    mlConfidence: mlConfidence ?? null,
    mlOffline: !!mlOffline,
    finalSignal,
    vetoed: !!vetoed,
    vetoReason: vetoReason ?? null,
    aiSignal: aiResult?.signal ?? null,
    aiEntry:  aiResult?.entry  ?? null,
    aiSl:     aiResult?.sl     ?? null,
    aiTp:     aiResult?.tp     ?? null,
    aiRr:     aiResult?.rr     ?? null,
    aiPattern: aiResult?.pattern ?? null,
    aiReason:  aiResult?.reason  ?? null,
  };

  try {
    await Signal.create(doc);
  } catch (err) {
    logger.error(`[Signal] Failed to save to MongoDB: ${err.message}`);
  }

  const payload = { ...doc, timestamp: ts.toISOString() };

  // Persist latest signal per symbol so new dashboard clients get it immediately on connect
  try {
    await redisClient.set(REDIS_KEYS.LAST_SIGNAL(symbol), JSON.stringify(payload), 'EX', 86400);
  } catch (err) {
    logger.warn(`[Signal] Failed to cache last signal: ${err.message}`);
  }

  const event =
    finalSignal === 'BUY' ? 'signal:buy' :
    finalSignal === 'SELL' ? 'signal:sell' : 'signal:neutral';

  emitter.emit(event, payload);
  logger.info(`[Signal] ${symbol} → ${finalSignal} | L1:${layer1} L2:${layer2} L3:${layer3} L4:${layer4} L5:${layer5} L6:${layer6} ML:${mlConfidence} | vetoed:${vetoed} reason:${vetoReason} | AI:${aiResult?.signal ?? 'N/A'} pattern:${aiResult?.pattern ?? '-'}`);
}

module.exports = { init, evaluate };
