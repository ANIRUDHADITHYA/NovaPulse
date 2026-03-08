'use strict';

const logger = require('../utils/logger');
const { REDIS_KEYS, MAX_OPEN_POSITIONS, MAX_CAPITAL_PCT } = require('../config/constants');
const Trade = require('../models/Trade');
const DailySnapshot = require('../models/DailySnapshot');
const emitter = require('../socket/emitter');
const telegram = require('./telegram');

let redisClient;

function init(redis) {
  redisClient = redis;
}

/**
 * Check if a new trade can be opened.
 * Uses Redis SET NX for atomic lock to prevent race conditions.
 */
async function canTrade(symbol) {
  // On testnet every BUY signal should fire freely — no daily/position limits.
  // Only the per-symbol duplicate guard is kept to avoid doubling into the same coin.
  const isTestnet = process.env.BINANCE_ENV === 'testnet';

  if (!isTestnet) {
    const halted = await redisClient.get(REDIS_KEYS.TRADING_HALTED);
    if (halted) {
      const msg = `⛔ BUY BLOCKED [${symbol}] — trading is halted. Use /api/trading/resume to re-enable.`;
      logger.warn(`[RiskManager] ${msg}`);
      telegram.send(msg);
      return false;
    }
  } else {
    logger.info(`[RiskManager] Testnet mode — halt/limit checks skipped for ${symbol}`);
  }

  // Atomic concurrency lock (15s TTL).
  // Retry up to 4 times with 1.5 s gaps so that when multiple symbols fire BUY
  // at the same candle close, the second and third can acquire the lock after the
  // first one finishes placing its order (~1-2 s) rather than being silently dropped.
  let lockAcquired = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    lockAcquired = await redisClient.set('order_placement_lock', '1', 'NX', 'PX', 15000);
    if (lockAcquired) break;
    logger.info(`[RiskManager] ${symbol} lock held — retry ${attempt + 1}/4 in 1.5 s`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (!lockAcquired) {
    logger.warn(`[RiskManager] ${symbol} SKIPPED: could not acquire order lock after 4 attempts`);
    return false;
  }

  // Position count — enforced on mainnet only
  if (!isTestnet) {
    const openTrades = await Trade.countDocuments({ status: { $in: ['PENDING', 'OPEN'] } });
    if (openTrades >= MAX_OPEN_POSITIONS) {
      await releaseLock();
      logger.info(`[RiskManager] Max open positions (${MAX_OPEN_POSITIONS}) reached`);
      return false;
    }
  }

  // Always guard: don't open a second position on the same symbol
  const posKey = REDIS_KEYS.POSITION(symbol);
  const existing = await redisClient.get(posKey);
  if (existing) {
    await releaseLock();
    logger.info(`[RiskManager] Position already open for ${symbol}`);
    return false;
  }

  return true; // lock still held — must call releaseLock() after order placement
}

async function releaseLock() {
  await redisClient.del('order_placement_lock');
}

/**
 * Calculate position size based on free USDT balance.
 */
async function getPositionSize() {
  const binance = require('./binance');
  const account = await binance.restGet('/api/v3/account', {}, 10, true);
  const usdtBalance = account.balances.find((b) => b.asset === 'USDT');
  const free = parseFloat(usdtBalance?.free || '0');
  return free * MAX_CAPITAL_PCT;
}

/**
 * Record trade P&L and check daily drawdown.
 */
async function recordTradePnL(pnlPct, pnlUsdt) {
  const dailyPnl = parseFloat((await redisClient.get(REDIS_KEYS.DAILY_PNL)) || '0');
  const weeklyPnl = parseFloat((await redisClient.get(REDIS_KEYS.WEEKLY_PNL)) || '0');
  const dailyPnlUsdt = parseFloat((await redisClient.get(REDIS_KEYS.DAILY_PNL_USDT)) || '0');

  const newDailyPnl = dailyPnl + pnlPct;
  const newWeeklyPnl = weeklyPnl + pnlPct;
  const newDailyPnlUsdt = dailyPnlUsdt + pnlUsdt;

  await redisClient.set(REDIS_KEYS.DAILY_PNL, newDailyPnl.toFixed(4));
  await redisClient.set(REDIS_KEYS.DAILY_PNL_USDT, newDailyPnlUsdt.toFixed(4));
  await redisClient.set(REDIS_KEYS.WEEKLY_PNL, newWeeklyPnl.toFixed(4));

  const maxDrawdown = -Math.abs(parseFloat(process.env.MAX_DAILY_DRAWDOWN || '2'));
  const isTestnet = process.env.BINANCE_ENV === 'testnet';

  if (!isTestnet && newDailyPnl <= maxDrawdown) {
    // Expire the halt at UTC midnight so the bot auto-resets each day.
    // Math.max(1, ...) guards against the EX=0 edge case at exactly 00:00:00 UTC,
    // which Redis rejects as an invalid TTL.
    const now = new Date();
    const secsUntilMidnight = Math.max(1, 86400 - (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()));
    await redisClient.set(REDIS_KEYS.TRADING_HALTED, '1', 'EX', secsUntilMidnight);
    const msg = `⛔ NOVAPULSE HALTED | Daily loss limit ${newDailyPnl.toFixed(2)}% reached (auto-resumes UTC midnight)`;
    telegram.send(msg);
    logger.warn(msg);
    emitter.emit('risk:halted', {
      reason: 'Daily drawdown limit reached',
      dailyPnlPct: newDailyPnl,
      timestamp: new Date().toISOString(),
    });
  } else if (isTestnet && newDailyPnl <= maxDrawdown) {
    logger.info(`[RiskManager] Daily drawdown ${newDailyPnl.toFixed(2)}% exceeded but testnet mode — continuing without halt`);
  }

  if (!isTestnet && newWeeklyPnl <= -5) {
    await redisClient.set(REDIS_KEYS.WEEKLY_REVIEW_FLAG, '1');
    telegram.send(`⚠️ WEEKLY DRAWDOWN -5% — Manual review required`);
  }

  emitter.emit('pnl:update', {
    dailyPnlPct: newDailyPnl,
    dailyPnlUsdt: newDailyPnlUsdt,
    weeklyPnlPct: newWeeklyPnl,
    openPositions: await Trade.countDocuments({ status: { $in: ['PENDING', 'OPEN'] } }),
    tradingHalted: !!(await redisClient.get(REDIS_KEYS.TRADING_HALTED)),
  });
}

async function getDailyPnl() {
  return parseFloat((await redisClient.get(REDIS_KEYS.DAILY_PNL)) || '0');
}

async function getDailyPnlUsdt() {
  return parseFloat((await redisClient.get(REDIS_KEYS.DAILY_PNL_USDT)) || '0');
}

async function getWeeklyPnl() {
  return parseFloat((await redisClient.get(REDIS_KEYS.WEEKLY_PNL)) || '0');
}

/**
 * Persist a daily performance snapshot to MongoDB.
 * Call this just BEFORE clearing the daily_pnl Redis key at 00:00 UTC.
 */
async function persistDailySnapshot() {
  try {
    const dailyPnlPct = await getDailyPnl();
    const dailyPnlUsdt = await getDailyPnlUsdt();
    const halted = !!(await redisClient.get(REDIS_KEYS.TRADING_HALTED));

    const now = new Date();
    // yesterday's date in UTC (snapshot covers the day that just ended)
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const dateStr = yesterday.toISOString().slice(0, 10);

    const [total, wins] = await Promise.all([
      Trade.countDocuments({ status: { $in: ['CLOSED_TP', 'CLOSED_SL'] }, closedAt: { $gte: yesterday, $lt: now } }),
      Trade.countDocuments({ status: 'CLOSED_TP', closedAt: { $gte: yesterday, $lt: now } }),
    ]);

    await DailySnapshot.findOneAndUpdate(
      { date: dateStr },
      {
        date: dateStr,
        dailyPnlPct,
        dailyPnlUsdt,
        totalTrades: total,
        wins,
        losses: total - wins,
        winRate: total > 0 ? parseFloat(((wins / total) * 100).toFixed(1)) : 0,
        tradingHalted: halted,
      },
      { upsert: true, new: true }
    );
    logger.info(`[RiskManager] Daily snapshot persisted for ${dateStr}: P&L ${dailyPnlPct.toFixed(2)}%`);
  } catch (err) {
    logger.error(`[RiskManager] Failed to persist daily snapshot: ${err.message}`);
  }
}

/**
 * Send a daily summary Telegram alert at 23:59 UTC.
 * Called by the 23:59 cron in server.js — before the midnight reset.
 */
async function sendDailySummary() {
  try {
    const dailyPnlPct = await getDailyPnl();
    const dailyPnlUsdt = await getDailyPnlUsdt();

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const [total, wins] = await Promise.all([
      Trade.countDocuments({ status: { $in: ['CLOSED_TP', 'CLOSED_SL'] }, closedAt: { $gte: todayStart } }),
      Trade.countDocuments({ status: 'CLOSED_TP', closedAt: { $gte: todayStart } }),
    ]);

    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0';
    const pnlSign = dailyPnlPct >= 0 ? '+' : '';

    telegram.send(
      `📊 NOVAPULSE DAILY SUMMARY\n` +
      `P&L: ${pnlSign}${dailyPnlPct.toFixed(2)}% ($${dailyPnlUsdt.toFixed(2)})\n` +
      `Trades: ${total} | Wins: ${wins} | Win Rate: ${winRate}%`
    );

    logger.info(`[RiskManager] Daily summary sent: P&L ${pnlSign}${dailyPnlPct.toFixed(2)}%, ${total} trades, ${winRate}% win rate`);
  } catch (err) {
    logger.error(`[RiskManager] Failed to send daily summary: ${err.message}`);
  }
}

module.exports = {
  init,
  canTrade,
  releaseLock,
  getPositionSize,
  recordTradePnL,
  getDailyPnl,
  getDailyPnlUsdt,
  getWeeklyPnl,
  persistDailySnapshot,
  sendDailySummary,
};
