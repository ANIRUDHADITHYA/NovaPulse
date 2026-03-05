'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const Candle = require('../models/Candle');
const { SYMBOLS, TAKE_PROFIT_PCT, STOP_LOSS_PCT } = require('../config/constants');
const {
  RSI,
  EMA,
  MACD,
  BollingerBands,
} = require('technicalindicators');

const MAKER_FEE = 0.00075; // 0.075%

function computeIndicatorsFromCandles(candles) {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);

  const rsiVals = RSI.calculate({ values: closes, period: 14 });
  const ema9Vals = EMA.calculate({ values: closes, period: 9 });
  const ema21Vals = EMA.calculate({ values: closes, period: 21 });
  const ema50Vals = EMA.calculate({ values: closes, period: 50 });
  const macdResults = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
  const bbResults = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });

  const n = closes.length;
  const rsi = rsiVals[rsiVals.length - 1];
  const ema9 = ema9Vals[ema9Vals.length - 1];
  const ema21 = ema21Vals[ema21Vals.length - 1];
  const ema50 = ema50Vals[ema50Vals.length - 1];
  const prevEma9 = ema9Vals[ema9Vals.length - 2];
  const prevEma21 = ema21Vals[ema21Vals.length - 2];
  const macd = macdResults[macdResults.length - 1];
  const bb = bbResults[bbResults.length - 1];
  const bbWidths = bbResults.map((b) => b.upper - b.lower);
  const bbSqueeze = bb && Math.min(...bbWidths.slice(-20)) >= (bb.upper - bb.lower) * 0.9;
  const recentVols = volumes.slice(-20);
  const avgVol = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
  const volumeRatio = avgVol > 0 ? volumes[n - 1] / avgVol : 1;

  const emaCross =
    prevEma9 && prevEma21
      ? prevEma9 < prevEma21 && ema9 > ema21
        ? 'bullish'
        : prevEma9 > prevEma21 && ema9 < ema21
        ? 'bearish'
        : 'none'
      : 'none';

  return { rsi, ema9, ema21, ema50, emaCross, macdHistogram: macd?.histogram, bbSqueeze, volumeRatio };
}

function scoreL1(ind) {
  if (!ind || ind.rsi === undefined) return 0;
  let b = 0, bb = 0;
  if (ind.rsi < 35) b++; else if (ind.rsi > 65) bb++;
  if (ind.emaCross === 'bullish') b++; else if (ind.emaCross === 'bearish') bb++;
  if (ind.macdHistogram > 0) b++; else if (ind.macdHistogram < 0) bb++;
  if (ind.bbSqueeze && ind.volumeRatio > 1.5) b++;
  return b > bb ? 1 : bb > b ? -1 : 0;
}

async function runBacktest(options = {}) {
  const { symbols = SYMBOLS, lookbackDays = 90 } = options;
  const cutoff = new Date(Date.now() - lookbackDays * 86400000);
  const allTrades = [];

  for (const symbol of symbols) {
    const candles = await Candle.find({ symbol, timestamp: { $gte: cutoff } })
      .sort({ timestamp: 1 })
      .lean();

    if (candles.length < 60) {
      logger.warn(`[Backtest] Not enough candles for ${symbol}: ${candles.length}`);
      continue;
    }

    for (let i = 60; i < candles.length - 5; i++) {
      const window = candles.slice(0, i + 1);
      const ind = computeIndicatorsFromCandles(window);
      const l1 = scoreL1(ind);
      if (l1 !== 1) continue;

      const entry = candles[i].close;
      const tp = entry * (1 + TAKE_PROFIT_PCT);
      const sl = entry * (1 - STOP_LOSS_PCT);

      let status = 'timeout';
      let exit = entry;

      for (let j = i + 1; j <= Math.min(i + 3, candles.length - 1); j++) {
        const c = candles[j];
        if (c.high >= tp) { status = 'TP'; exit = tp; break; }
        if (c.low <= sl) { status = 'SL'; exit = sl; break; }
      }

      if (status === 'timeout') continue;

      const pnlPct = ((exit - entry) / entry) * 100 - MAKER_FEE * 2 * 100;
      allTrades.push({ symbol, entry, exit, status, pnlPct, timestamp: candles[i].timestamp });
    }
  }

  const wins = allTrades.filter((t) => t.status === 'TP').length;
  const winRate = allTrades.length > 0 ? (wins / allTrades.length) * 100 : 0;
  const avgPnl = allTrades.length > 0 ? allTrades.reduce((a, t) => a + t.pnlPct, 0) / allTrades.length : 0;

  // Sharpe ratio: mean(pnl) / stdDev(pnl); risk-free rate ≈ 0 for intraday scalping
  let sharpeRatio = 0;
  if (allTrades.length > 1) {
    const mean = avgPnl;
    const variance = allTrades.reduce((sum, t) => sum + Math.pow(t.pnlPct - mean, 2), 0) / allTrades.length;
    const stdDev = Math.sqrt(variance);
    sharpeRatio = stdDev > 0 ? mean / stdDev : 0;
  }

  let equity = 100;
  let peak = 100;
  let maxDrawdown = 0;
  for (const t of allTrades) {
    equity *= 1 + t.pnlPct / 100;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Pass criteria — must clear all three gates before paper trading
  const PASS_WIN_RATE = 60;
  const PASS_AVG_PNL = 0.4;
  const PASS_MAX_DD = 8;
  const passed =
    winRate >= PASS_WIN_RATE && avgPnl >= PASS_AVG_PNL && maxDrawdown <= PASS_MAX_DD;

  const report = {
    generatedAt: new Date().toISOString(),
    symbols,
    lookbackDays,
    totalTrades: allTrades.length,
    wins,
    losses: allTrades.length - wins,
    winRate: winRate.toFixed(2),
    avgPnlPct: avgPnl.toFixed(4),
    maxDrawdownPct: maxDrawdown.toFixed(2),
    sharpeRatio: sharpeRatio.toFixed(3),
    finalEquity: equity.toFixed(2),
    passCriteria: { winRate: PASS_WIN_RATE, avgPnlPct: PASS_AVG_PNL, maxDrawdownPct: PASS_MAX_DD },
    passed,
    trades: allTrades,
  };

  const dir = path.join(__dirname, '../../backtest-results');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filename = `report_${Date.now()}.json`;
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(report, null, 2));
  logger.info(`[Backtest] Report saved: ${filename} | WinRate: ${winRate.toFixed(1)}% | AvgPnL: ${avgPnl.toFixed(4)}% | Sharpe: ${sharpeRatio.toFixed(3)} | Passed: ${passed}`);

  return report;
}

module.exports = { runBacktest };
