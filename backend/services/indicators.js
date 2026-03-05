'use strict';

const {
  RSI,
  EMA,
  MACD,
  BollingerBands,
} = require('technicalindicators');
const logger = require('../utils/logger');
const { REDIS_KEYS, CANDLE_BUFFER_MIN } = require('../config/constants');

let redisClient;

function init(redis) {
  redisClient = redis;
}

async function getCandles(symbol) {
  const raw = await redisClient.lrange(REDIS_KEYS.CANDLE_BUFFER(symbol), 0, -1);
  return raw.map((s) => JSON.parse(s));
}

/**
 * Compute all indicators for a symbol.
 * Returns null if not enough candles.
 */
async function computeIndicators(symbol) {
  const candles = await getCandles(symbol);
  if (candles.length < CANDLE_BUFFER_MIN) {
    logger.warn(`[Indicators] Not enough candles for ${symbol}: ${candles.length}`);
    return null;
  }

  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  // RSI (14)
  const rsiValues = RSI.calculate({ values: closes, period: 14 });
  const rsi = rsiValues[rsiValues.length - 1] ?? null;
  if (rsi === null) return null;

  // EMA 9, 21, 50
  const ema9Values = EMA.calculate({ values: closes, period: 9 });
  const ema21Values = EMA.calculate({ values: closes, period: 21 });
  const ema50Values = EMA.calculate({ values: closes, period: 50 });
  if (!ema9Values.length || !ema21Values.length || !ema50Values.length) return null;

  const ema9 = ema9Values[ema9Values.length - 1];
  const ema21 = ema21Values[ema21Values.length - 1];
  const ema50 = ema50Values[ema50Values.length - 1];
  const prevEma9 = ema9Values[ema9Values.length - 2] ?? null;
  const prevEma21 = ema21Values[ema21Values.length - 2] ?? null;
  const prevEma50 = ema50Values[ema50Values.length - 2] ?? null;

  // EMA crossovers
  const emaCross9_21 =
    prevEma9 !== null && prevEma21 !== null
      ? prevEma9 < prevEma21 && ema9 > ema21
        ? 'bullish'
        : prevEma9 > prevEma21 && ema9 < ema21
          ? 'bearish'
          : 'none'
      : 'none';

  const emaCross21_50 =
    prevEma21 !== null && prevEma50 !== null
      ? prevEma21 < prevEma50 && ema21 > ema50
        ? 'bullish'
        : prevEma21 > prevEma50 && ema21 < ema50
          ? 'bearish'
          : 'none'
      : 'none';

  // MACD (12, 26, 9)
  const macdResults = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  if (!macdResults.length) return null;
  const macd = macdResults[macdResults.length - 1];

  // Bollinger Bands (20, 2)
  const bbResults = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
  if (!bbResults.length) return null;
  const bb = bbResults[bbResults.length - 1];
  const bbBandwidth = bb.upper - bb.lower;
  const bbWidths = bbResults.map((b) => b.upper - b.lower);
  const minBbWidth = Math.min(...bbWidths.slice(-20));
  const bbSqueeze = bbBandwidth <= minBbWidth * 1.1;

  // Volume ratio vs 20-candle average
  const recentVols = volumes.slice(-20);
  const avgVolume = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
  const currentVolume = volumes[volumes.length - 1];
  const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;

  const result = {
    symbol,
    timestamp: new Date().toISOString(),
    rsi,
    ema9,
    ema21,
    ema50,
    emaCross9_21,
    emaCross21_50,
    macdLine: macd.MACD,
    macdSignal: macd.signal,
    macdHistogram: macd.histogram,
    bbUpper: bb.upper,
    bbMiddle: bb.middle,
    bbLower: bb.lower,
    bbBandwidth,
    bbSqueeze,
    volumeRatio,
    currentPrice: closes[closes.length - 1],
    high: highs[highs.length - 1],
    low: lows[lows.length - 1],
  };

  await redisClient.set(REDIS_KEYS.INDICATORS(symbol), JSON.stringify(result), 'EX', 120);
  return result;
}

async function getLatestIndicators(symbol) {
  const cached = await redisClient.get(REDIS_KEYS.INDICATORS(symbol));
  return cached ? JSON.parse(cached) : null;
}

module.exports = { init, computeIndicators, getLatestIndicators };
