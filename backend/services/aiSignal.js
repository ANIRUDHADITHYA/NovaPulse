'use strict';

/**
 * Layer 6 — AI Signal Wrapper (OpenAI / Claude)
 *
 * Receives raw candle data + all indicator / OI / sentiment context and asks
 * the AI to identify chart patterns and return PRECISE entry, SL, and TP
 * levels derived from actual market structure (swing highs/lows, S/R) rather
 * than fixed percentages.
 *
 * Returns null when the AI is unreachable or the response fails validation —
 * callers must handle null gracefully (fall back to hardcoded TP/SL).
 */

const axios = require('axios');
const logger = require('../utils/logger');

let redisClient;

function init(redis) {
  redisClient = redis;
}

// ─── Token Usage Tracking ─────────────────────────────────────────────────────

/**
 * Persist today's token usage to Redis.
 * Keys expire at UTC midnight so counts reset daily automatically.
 */
async function _trackTokens(promptTokens, completionTokens) {
  if (!redisClient) return;
  try {
    const now = new Date();
    const secsUntilMidnight = 86400 - (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds());
    const ttl = Math.max(1, secsUntilMidnight);

    // Atomic increments
    const [newPrompt, newCompletion] = await Promise.all([
      redisClient.incrby('ai_tokens_today:prompt', promptTokens),
      redisClient.incrby('ai_tokens_today:completion', completionTokens),
      redisClient.incr('ai_calls_today'),
    ]);

    // Set TTL only on first call of the day (value was 0 before incr)
    if (newPrompt === promptTokens) await redisClient.expire('ai_tokens_today:prompt', ttl);
    if (newCompletion === completionTokens) await redisClient.expire('ai_tokens_today:completion', ttl);

    // Track last call timestamp
    await redisClient.set('ai_last_call', new Date().toISOString(), 'EX', 86400);
  } catch (err) {
    logger.warn(`[AISignal] Token tracking failed: ${err.message}`);
  }
}

// ─── Prompt Building ──────────────────────────────────────────────────────────

/**
 * Format last N candles as a compact text table for the prompt.
 */
function formatCandles(candles, n = 30) {
  return candles
    .slice(-n)
    .map(
      (c, i) =>
        `${String(i + 1).padStart(2)}) O:${Number(c.open).toFixed(2)} ` +
        `H:${Number(c.high).toFixed(2)} L:${Number(c.low).toFixed(2)} ` +
        `C:${Number(c.close).toFixed(2)} V:${Number(c.volume).toFixed(0)}`
    )
    .join('\n');
}

function buildPrompt(symbol, candles, ind, oiData, sentimentData, layerSummary) {
  const candleText = formatCandles(candles, 30);

  const indText = [
    `RSI(14): ${ind.rsi?.toFixed(2)}`,
    `EMA9: ${ind.ema9?.toFixed(2)}  EMA21: ${ind.ema21?.toFixed(2)}  EMA50: ${ind.ema50?.toFixed(2)}`,
    `MACD Histogram: ${ind.macdHistogram?.toFixed(5)}`,
    `BB Upper: ${ind.bbUpper?.toFixed(2)}  Middle: ${ind.bbMiddle?.toFixed(2)}  Lower: ${ind.bbLower?.toFixed(2)}`,
    `BB Bandwidth: ${ind.bbBandwidth?.toFixed(2)}  Squeeze: ${ind.bbSqueeze}`,
    `Volume Ratio (vs 20-SMA): ${ind.volumeRatio?.toFixed(2)}x`,
    `Current Price: ${ind.currentPrice}`,
    `Session High: ${ind.high}  Session Low: ${ind.low}`,
  ].join('\n');

  const oiText = oiData
    ? [
        `OI 15m Delta: ${(oiData.oiDeltaPct * 100).toFixed(3)}%`,
        `OI 1h Delta: ${(oiData.oiDelta1hPct * 100).toFixed(3)}%`,
        `Funding Rate: ${oiData.fundingRate}`,
        `Long/Short Ratio: ${oiData.longShortRatio?.toFixed(3)}`,
      ].join('\n')
    : 'OI data unavailable';

  const sentimentText = sentimentData
    ? `Fear & Greed Index: ${sentimentData.value} — ${sentimentData.classification}`
    : 'Sentiment unavailable';

  const systemPrompt =
    `You are an expert crypto technical analyst specialising in 15m chart patterns for ${symbol}. ` +
    `Your job is to identify exact price levels for trade entry, stop-loss, and take-profit using ` +
    `market structure (swing highs/lows, support/resistance, chart patterns). ` +
    `Respond ONLY with a single valid JSON object — no markdown fences, no extra text.`;

  const userPrompt =
    `## ${symbol} — 15m Chart Analysis\n\n` +

    `### Last 30 Candles (newest = candle 30)\n${candleText}\n\n` +

    `### Technical Indicators\n${indText}\n\n` +

    `### Market Structure Context\n${oiText}\n${sentimentText}\n\n` +

    `### Internal Signal Engine (Layers 1-5)\n${layerSummary}\n\n` +

    `### Task\n` +
    `1. Identify any current chart pattern (bull flag, break-and-retest, double bottom, ` +
    `ascending triangle, head & shoulders, etc.) or write "none".\n` +
    `2. Determine the optimal LIMIT entry price based on structure.\n` +
    `3. Place SL below the last significant swing LOW for BUY (above swing HIGH for SELL) — ` +
    `NOT a fixed percentage.\n` +
    `4. Place TP at the next clear resistance (for BUY) or support (for SELL) level.\n` +
    `5. Minimum Risk:Reward ratio must be 2.0. If structure does not support >= 2.0 R:R, ` +
    `return NEUTRAL.\n` +
    `6. If the internal engine already disagrees (mixed layer votes), prefer NEUTRAL.\n\n` +

    `Respond with ONLY this JSON:\n` +
    `{\n` +
    `  "signal": "BUY" | "SELL" | "NEUTRAL",\n` +
    `  "entry": <number>,\n` +
    `  "sl": <number>,\n` +
    `  "tp": <number>,\n` +
    `  "rr": <number>,\n` +
    `  "pattern": "<string>",\n` +
    `  "reason": "<one sentence>"\n` +
    `}`;

  return { systemPrompt, userPrompt };
}

// ─── Provider Adapters ────────────────────────────────────────────────────────

async function callOpenAI(systemPrompt, userPrompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const model = process.env.AI_MODEL || 'gpt-4o-mini';
  const res = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 350,
      response_format: { type: 'json_object' },
    },
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 15000,
    }
  );

  // Track token usage
  const usage = res.data.usage;
  if (usage) await _trackTokens(usage.prompt_tokens || 0, usage.completion_tokens || 0);

  return JSON.parse(res.data.choices[0].message.content);
}

async function callClaude(systemPrompt, userPrompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const model = process.env.AI_MODEL || 'claude-3-5-haiku-20241022';
  const res = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model,
      max_tokens: 350,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.1,
    },
    {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );

  // Track token usage (Claude uses input_tokens / output_tokens)
  const usage = res.data.usage;
  if (usage) await _trackTokens(usage.input_tokens || 0, usage.output_tokens || 0);

  // Claude returns text; strip accidental code fences
  const text = res.data.content[0].text.replace(/```json|```/g, '').trim();
  return JSON.parse(text);
}

// ─── Response Validation ──────────────────────────────────────────────────────

/**
 * Validate that the AI response is structurally sound and that the price
 * levels are realistic relative to the current market price.
 */
function validateResponse(result, currentPrice) {
  if (!result || typeof result !== 'object') return false;

  const VALID_SIGNALS = new Set(['BUY', 'SELL', 'NEUTRAL']);
  if (!VALID_SIGNALS.has(result.signal)) return false;
  if (result.signal === 'NEUTRAL') return true;

  const { entry, sl, tp } = result;
  if ([entry, sl, tp].some((v) => typeof v !== 'number' || isNaN(v) || v <= 0)) return false;

  // All three levels must be within 8% of current price (catches hallucinated values;
  // wider than 5% to allow structural swing SL/TP placed at real support/resistance levels)
  const within8 = (v) => Math.abs(v - currentPrice) / currentPrice < 0.08;
  if (!within8(entry) || !within8(sl) || !within8(tp)) {
    logger.warn(
      `[AISignal] Rejected: price levels outside 8% band — ` +
      `entry:${entry} sl:${sl} tp:${tp} current:${currentPrice}`
    );
    return false;
  }

  // Structural checks
  if (result.signal === 'BUY'  && !(sl < entry && entry < tp)) return false;
  if (result.signal === 'SELL' && !(tp < entry && entry < sl)) return false;

  // Enforce minimum 1.5 R:R (AI should target 2.0 but we floor at 1.5)
  const risk   = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  if (risk === 0 || reward / risk < 1.5) return false;

  return true;
}

// ─── Public Interface ─────────────────────────────────────────────────────────

/**
 * Analyse market context with the configured AI provider.
 *
 * @returns {object|null} AI result { signal, entry, sl, tp, rr, pattern, reason }
 *                        or null if AI is offline / response is invalid.
 */
async function analyze(symbol, candles, ind, oiData, sentimentData, layerSummary) {
  const provider = (process.env.AI_PROVIDER || '').toLowerCase();

  if (!provider || (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY)) {
    logger.info('[AISignal] No AI provider configured — Layer 6 abstains');
    return null;
  }

  if (provider === 'openai' && !process.env.OPENAI_API_KEY) {
    logger.warn('[AISignal] AI_PROVIDER=openai but OPENAI_API_KEY not set — skipping');
    return null;
  }

  if (provider === 'claude' && !process.env.ANTHROPIC_API_KEY) {
    logger.warn('[AISignal] AI_PROVIDER=claude but ANTHROPIC_API_KEY not set — skipping');
    return null;
  }

  const { systemPrompt, userPrompt } = buildPrompt(symbol, candles, ind, oiData, sentimentData, layerSummary);

  try {
    let result;
    if (provider === 'claude') {
      result = await callClaude(systemPrompt, userPrompt);
    } else {
      result = await callOpenAI(systemPrompt, userPrompt);
    }

    if (!validateResponse(result, ind.currentPrice)) {
      logger.warn(`[AISignal] ${symbol} — response failed validation: ${JSON.stringify(result)}`);
      return null;
    }

    if (result.signal !== 'NEUTRAL') {
      const computedRR = (Math.abs(result.tp - result.entry) / Math.abs(result.entry - result.sl)).toFixed(2);
      result.rr = parseFloat(computedRR);
      logger.info(
        `[AISignal] ${symbol} → ${result.signal} | ` +
        `Entry:${result.entry} SL:${result.sl} TP:${result.tp} R:R=${computedRR} | ` +
        `Pattern: ${result.pattern} | ${result.reason}`
      );
    } else {
      logger.info(`[AISignal] ${symbol} → NEUTRAL | ${result.reason}`);
    }

    return result;
  } catch (err) {
    logger.warn(`[AISignal] ${symbol} — ${provider} error: ${err.message}`);
    return null;
  }
}

module.exports = { init, analyze };
