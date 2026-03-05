'use strict';

const axios = require('axios');
const logger = require('../utils/logger');
const { REDIS_KEYS, SYMBOLS, OI_DELTA_THRESHOLD, FUNDING_RATE_THRESHOLD } = require('../config/constants');
const OIModel = require('../models/OI');
const emitter = require('../socket/emitter');

let redisClient;

function init(redis) {
  redisClient = redis;
}

async function fetchOIForSymbol(symbol) {
  const futuresSymbol = symbol; // same naming convention
  // Always use mainnet for market data — testnet has no OI/funding/L-S history.
  const baseUrl = process.env.BINANCE_MARKET_URL;
  try {
    // Current OI
    const oiRes = await axios.get(`${baseUrl}/fapi/v1/openInterest`, {
      params: { symbol: futuresSymbol },
    });

    // OI history at 15m resolution — each bucket = one signal candle.
    // limit 5: index [4]=latest bucket, [3]=15m ago, [0]=1h ago (≈4 candles)
    const histRes = await axios.get(
      `${baseUrl}/futures/data/openInterestHist`,
      { params: { symbol: futuresSymbol, period: '15m', limit: 5 } }
    );

    // Funding rate
    const fundingRes = await axios.get(
      `${baseUrl}/fapi/v1/fundingRate`,
      { params: { symbol: futuresSymbol, limit: 1 } }
    );

    // Long/Short ratio
    const lsRes = await axios.get(
      `${baseUrl}/futures/data/topLongShortAccountRatio`,
      { params: { symbol: futuresSymbol, period: '5m', limit: 1 } }
    );

    const currentOI = parseFloat(oiRes.data.openInterest);
    const hist = Array.isArray(histRes.data) ? histRes.data : [];

    if (!hist.length) {
      logger.warn(`[OI] ${symbol}: openInterestHist returned empty — delta will be 0. Check BINANCE_MARKET_URL.`);
    }

    // hist is ascending by timestamp. With limit=5 at 15m resolution:
    // hist[0] = ~75m old (oldest)
    // hist[1] = ~60m old
    // hist[2] = ~45m old
    // hist[3] = ~30m old
    // hist[4] = ~15m old (latest closed 15m bucket)
    // Compare live currentOI against hist[4] for 15m delta and hist[0] for 1h delta.
    const oi15mAgo = hist.length >= 1 ? parseFloat(hist[hist.length - 1].sumOpenInterest) : currentOI;
    const oi1hAgo  = hist.length >= 5 ? parseFloat(hist[0].sumOpenInterest)               : currentOI;

    const oiDeltaPct   = oi15mAgo > 0 ? (currentOI - oi15mAgo) / oi15mAgo : 0;
    const oiDelta1hPct = oi1hAgo  > 0 ? (currentOI - oi1hAgo)  / oi1hAgo  : 0;
    const fundingRate = parseFloat(fundingRes.data[0]?.fundingRate || '0');
    const longShortRatio = parseFloat(lsRes.data[0]?.longAccount || '0.5');
    const now = new Date();

    const result = {
      symbol,
      currentOI,
      oiDeltaPct,
      oiDelta1hPct,
      fundingRate,
      longShortRatio,
      timestamp: now.toISOString(),
    };

    // Cache in Redis — TTL 6 minutes (360 s)
    await redisClient.set(REDIS_KEYS.OI(symbol), JSON.stringify(result), 'EX', 360);

    // Persist snapshot to MongoDB
    await OIModel.create({
      symbol,
      currentOI,
      oiDeltaPct,
      oiDelta1hPct,
      fundingRate,
      longShortRatio,
      timestamp: now,
    });

    // Push to dashboard (OIPanel.jsx) — matches Socket.io event schema
    emitter.emit('oi:update', {
      symbol,
      oiDeltaPct,
      oiDelta1h: oiDelta1hPct,
      fundingRate,
      longShortRatio,
      timestamp: now.toISOString(),
    });

    logger.info(`[OI] ${symbol}: delta=${(oiDeltaPct * 100).toFixed(4)}% 1h=${(oiDelta1hPct * 100).toFixed(4)}% funding=${fundingRate} currentOI=${currentOI.toFixed(0)} oi15mAgo=${oi15mAgo.toFixed(0)} oi1hAgo=${oi1hAgo.toFixed(0)}`);

    return result;
  } catch (err) {
    logger.error(`[OI] Failed to fetch OI for ${symbol}: ${err.message}`);
    return null;
  }
}

async function fetchAllOI() {
  const results = await Promise.all(SYMBOLS.map(fetchOIForSymbol));
  return results;
}

async function getLatestOI(symbol) {
  const cached = await redisClient.get(REDIS_KEYS.OI(symbol));
  return cached ? JSON.parse(cached) : null;
}

/**
 * Layer 2 vote: +1 if bullish, -1 if bearish, 0 neutral, 'veto' if extreme funding
 */
function scoreOI(oiData, priceRising) {
  if (!oiData) return 0;
  if (Math.abs(oiData.fundingRate) > FUNDING_RATE_THRESHOLD) {
    return 'veto'; // extreme funding = avoid
  }
  if (oiData.oiDeltaPct > OI_DELTA_THRESHOLD && priceRising) return 1; // long buildup
  if (oiData.oiDeltaPct < -OI_DELTA_THRESHOLD) return -1;
  // When OI delta is flat, use funding rate direction as a tiebreaker:
  // negative funding = shorts pay longs = bullish pressure
  // positive funding = longs pay shorts = bearish pressure
  if (oiData.fundingRate < -0.00005) return 1;  // shorts paying longs
  if (oiData.fundingRate > 0.00005) return -1;  // longs paying shorts
  return 0;
}

module.exports = { init, fetchOIForSymbol, fetchAllOI, getLatestOI, scoreOI };
