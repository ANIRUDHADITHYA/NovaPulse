'use strict';

const Bull = require('bull');
const logger = require('../utils/logger');
const { REDIS_KEYS, ORDER_TIMEOUT_MS, TAKE_PROFIT_PCT, STOP_LOSS_PCT } = require('../config/constants');
const Trade = require('../models/Trade');
const emitter = require('../socket/emitter');
const telegram = require('./telegram');
const riskManager = require('./riskManager');
const binance = require('./binance');

let redisClient;
let orderQueue;
let userDataWs;

function init(redis) {
  redisClient = redis;
  orderQueue = new Bull('order-timeout', process.env.REDIS_URL, {
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
  });

  // Resume the queue in case it was left paused by a previous graceful shutdown.
  orderQueue.resume().catch((err) => logger.warn(`[OrderManager] Queue resume failed: ${err.message}`));

  orderQueue.process(async (job) => {
    const { symbol, orderId } = job.data;
    await handleOrderTimeout(symbol, orderId);
  });

  orderQueue.on('failed', (job, err) => {
    logger.error(`[OrderQueue] Job ${job.id} failed for ${job.data.symbol} (attempt ${job.attemptsMade}/${job.opts.attempts}): ${err.message}`);
    // Only alert on the final attempt so Telegram doesn't spam once per retry
    if (job.attemptsMade >= (job.opts.attempts || 1)) {
      telegram.send(`⚠️ TIMEOUT JOB FAILED: ${job.data.symbol} order ${job.data.orderId} — manual check required`);
    }
  });

  orderQueue.on('stalled', (job) => {
    logger.error(`[OrderQueue] Job ${job.id} stalled — verify order status manually`);
  });
}

// ──────────────────────────────────────────────────────────
// User Data Stream
// ──────────────────────────────────────────────────────────
async function startUserDataStream() {
  const WebSocket = require('ws');
  try {
    const data = await binance.restPostUnsigned('/api/v3/userDataStream');
    const listenKey = data.listenKey;
    logger.info(`[OrderManager] User Data Stream listenKey: ${listenKey}`);

    function connect() {
      const ws = new WebSocket(`${process.env.BINANCE_WS_BASE}/${listenKey}`);
      userDataWs = ws;

      ws.on('open', () => logger.info('[OrderManager] User Data Stream connected'));
      ws.on('message', async (raw) => {
        const msg = JSON.parse(raw);
        if (msg.e === 'executionReport') {
          await handleOrderUpdate(msg);
        }
      });
      ws.on('error', (err) => logger.error(`[OrderManager] UDS error: ${err.message}`));
      ws.on('close', () => {
        logger.warn('[OrderManager] UDS closed — reconnecting');
        setTimeout(connect, 3000);
      });
    }

    connect();
    return listenKey;
  } catch (err) {
    // Testnet does not support /api/v3/userDataStream (410 Gone).
    // Fall back to REST polling every 30 s so order fills are still detected.
    logger.warn(`[OrderManager] User Data Stream unavailable (${err.response?.status ?? err.message}) — using REST poll fallback`);
    startOrderPolling();
    return null;
  }
}

// ──────────────────────────────────────────────────────────
// REST polling fallback (used when UDS is not available)
// ──────────────────────────────────────────────────────────
let _pollTimer = null;
let _pollStarted = false; // committed flag — immune to async race on _pollTimer

// Run once at startup: verify every cached position still has a live order on Binance.
// Any position whose order returns 400 is stale (filled/cancelled externally) and gets purged.
async function purgeStalePositions() {
  const { SYMBOLS } = require('../config/constants');
  for (const symbol of SYMBOLS) {
    try {
      const posRaw = await redisClient.get(REDIS_KEYS.POSITION(symbol));
      if (!posRaw) continue;
      const pos = JSON.parse(posRaw);

      // Pick the most meaningful order ID to probe
      const probeId = pos.tpOrderId || pos.slOrderId || pos.buyOrderId;
      if (!probeId) {
        await redisClient.del(REDIS_KEYS.POSITION(symbol));
        logger.warn(`[OrderManager] Purged empty position key for ${symbol}`);
        continue;
      }

      await binance.restGet('/api/v3/order', { symbol, orderId: probeId }, 2, true);
      // If we reach here the order still exists — nothing to do
    } catch (err) {
      const httpStatus = err.response?.status;
      const binanceCode = err.response?.data?.code;
      if (httpStatus === 400) {
        try {
          const posRaw2 = await redisClient.get(REDIS_KEYS.POSITION(symbol));
          if (posRaw2) {
            const pos2 = JSON.parse(posRaw2);
            await redisClient.del(REDIS_KEYS.POSITION(symbol));
            if (pos2.tradeId) {
              await Trade.updateOne(
                { _id: pos2.tradeId, status: { $in: ['PENDING', 'OPEN'] } },
                { status: 'CANCELLED', closedAt: new Date() }
              );
            }
            logger.warn(`[OrderManager] Startup purge: stale position for ${symbol} (HTTP 400 / code ${binanceCode}) removed`);
          }
        } catch (cleanupErr) {
          logger.error(`[OrderManager] Startup purge cleanup error for ${symbol}: ${cleanupErr.message}`);
        }
      }
    }
  }
}

function startOrderPolling(intervalMs = 30000) {
  if (_pollStarted) return; // already running
  _pollStarted = true;
  logger.info('[OrderManager] REST order-poll fallback started (every 30 s)');

  // Immediately validate cached positions before the first timed poll fires
  purgeStalePositions().catch((err) =>
    logger.warn(`[OrderManager] Startup position validation failed: ${err.message}`)
  );

  async function poll() {
    const { SYMBOLS } = require('../config/constants');
    for (const symbol of SYMBOLS) {
      try {
        const posRaw = await redisClient.get(REDIS_KEYS.POSITION(symbol));
        if (!posRaw) continue;
        const pos = JSON.parse(posRaw);
        // Check buy order if still pending
        if (pos.buyOrderId && !pos.tpOrderId) {
          const order = await binance.restGet('/api/v3/order', { symbol, orderId: pos.buyOrderId }, 2, true);
          if (order.status === 'FILLED') {
            const qty = parseFloat(order.executedQty);
            const entry = parseFloat(order.cummulativeQuoteQty) / qty;
            await onBuyFilled(symbol, pos, entry, qty);
          } else if (order.status === 'PARTIALLY_FILLED') {
            const qty = parseFloat(order.executedQty);
            const entry = parseFloat(order.cummulativeQuoteQty) / qty;
            if (qty > 0) {
              try { await cancelOrder(symbol, pos.buyOrderId); } catch (_) {}
              await onBuyFilled(symbol, pos, entry, qty);
            }
          }
          continue;
        }

        // Check TP/SL orders
        const [tpOrder, slOrder] = await Promise.all([
          pos.tpOrderId ? binance.restGet('/api/v3/order', { symbol, orderId: pos.tpOrderId }, 2, true) : null,
          pos.slOrderId ? binance.restGet('/api/v3/order', { symbol, orderId: pos.slOrderId }, 2, true) : null,
        ]);
        if (tpOrder?.status === 'FILLED') {
          await onTpFilled(symbol, pos, parseFloat(tpOrder.cummulativeQuoteQty) / parseFloat(tpOrder.executedQty), parseFloat(tpOrder.executedQty));
        } else if (slOrder?.status === 'FILLED') {
          await onSlFilled(symbol, pos, parseFloat(slOrder.cummulativeQuoteQty) / parseFloat(slOrder.executedQty), parseFloat(slOrder.executedQty));
        }
      } catch (err) {
        const httpStatus = err.response?.status;
        const binanceCode = err.response?.data?.code;

        // Binance 400 with -2013 (ORDER_DOES_NOT_EXIST) or -2011 (UNKNOWN_ORDER) means
        // the position key in Redis is stale — the order was filled or cancelled externally.
        // Clear it so the poll stops hammering Binance on every tick.
        if (httpStatus === 400 && (binanceCode === -2013 || binanceCode === -2011 || binanceCode === -1102 || binanceCode == null)) {
          try {
            const posRaw = await redisClient.get(REDIS_KEYS.POSITION(symbol));
            if (posRaw) {
              const pos = JSON.parse(posRaw);
              await redisClient.del(REDIS_KEYS.POSITION(symbol));
              if (pos.tradeId) {
                await Trade.updateOne(
                  { _id: pos.tradeId, status: { $in: ['PENDING', 'OPEN'] } },
                  { status: 'CANCELLED', closedAt: new Date() }
                );
              }
              logger.warn(`[OrderManager] Stale position for ${symbol} (HTTP 400 / Binance code ${binanceCode}) — Redis key purged, trade marked CANCELLED`);
            }
          } catch (cleanupErr) {
            logger.error(`[OrderManager] Stale-position cleanup failed for ${symbol}: ${cleanupErr.message}`);
          }
        } else {
          logger.warn(`[OrderManager] Poll error for ${symbol}: ${err.message}`);
        }
      }
    }
    _pollTimer = setTimeout(poll, intervalMs);
  }
  _pollTimer = setTimeout(poll, intervalMs);
}

async function keepAliveUserDataStream(listenKey) {
  try {
    await binance.restPut('/api/v3/userDataStream', { listenKey }, 1);
    logger.info('[OrderManager] User Data Stream keepalive sent');
  } catch (err) {
    logger.error(`[OrderManager] Keepalive failed: ${err.message}`);
  }
}

// ──────────────────────────────────────────────────────────
// Signal entry point
// ──────────────────────────────────────────────────────────
async function onBuySignal(symbol, currentPrice, mlConfidence, aiResult) {
  const allowed = await riskManager.canTrade(symbol);
  if (!allowed) return;

  try {
    const infoRaw = await redisClient.get(REDIS_KEYS.EXCHANGE_INFO(symbol));
    if (!infoRaw) {
      logger.error(`[OrderManager] No exchangeInfo for ${symbol}`);
      await riskManager.releaseLock();
      return;
    }
    const { tickSize, stepSize, minNotional } = JSON.parse(infoRaw);

    // Use current market price for quantity sizing (MARKET order — no limit price needed)
    const capitalUsdt = await riskManager.getPositionSize();
    const rawQty = capitalUsdt / currentPrice;
    const quantity = binance.roundToStepSize(rawQty, stepSize);

    if (quantity * currentPrice < minNotional) {
      logger.warn(`[OrderManager] SKIPPED: below minNotional for ${symbol}`);
      await riskManager.releaseLock();
      return;
    }

    await placeMarketBuyOrder(symbol, quantity, mlConfidence, aiResult, tickSize);
  } catch (err) {
    logger.error(`[OrderManager] onBuySignal error: ${err.message}`);
  } finally {
    await riskManager.releaseLock();
  }
}

async function placeMarketBuyOrder(symbol, quantity, mlConfidence, aiResult, tickSize) {
  const order = await binance.restPost('/api/v3/order', {
    symbol,
    side: 'BUY',
    type: 'MARKET',
    quantity,
  }, 1);

  // MARKET orders fill immediately — extract actual fill price from the response
  const filledPrice = parseFloat(order.cummulativeQuoteQty) / parseFloat(order.executedQty);
  const filledQty = parseFloat(order.executedQty);

  logger.info(`[OrderManager] MARKET BUY filled: ${symbol} qty=${filledQty} @ ${filledPrice.toFixed(2)} orderId=${order.orderId}`);

  // Pre-compute AI-derived TP/SL prices so they are stored with the trade record.
  // onBuyFilled will read them back from the position key instead of re-calculating.
  let aiTpPrice = null;
  let aiSlPrice = null;
  if (aiResult?.signal === 'BUY' && aiResult?.tp && aiResult?.sl && tickSize) {
    aiTpPrice = binance.roundToTickSize(aiResult.tp, tickSize);
    aiSlPrice = binance.roundToTickSize(aiResult.sl, tickSize);
  }

  // Save trade to MongoDB (PENDING → onBuyFilled will update to OPEN)
  const trade = await Trade.create({
    symbol,
    side: 'BUY',
    entryPrice: filledPrice,
    quantity: filledQty,
    status: 'PENDING',
    buyOrderId: String(order.orderId),
    mlConfidence,
    aiTp:      aiTpPrice,
    aiSl:      aiSlPrice,
    aiPattern: aiResult?.pattern ?? null,
    aiReason:  aiResult?.reason  ?? null,
    aiRr:      aiResult?.rr      ?? null,
    openedAt: new Date(),
  });

  const pos = {
    tradeId: trade._id.toString(),
    buyOrderId: String(order.orderId),
    entryPrice: filledPrice,
    quantity: filledQty,
    aiTp: aiTpPrice,
    aiSl: aiSlPrice,
  };

  // Store position in Redis — include AI levels so onBuyFilled can use them
  await redisClient.set(REDIS_KEYS.POSITION(symbol), JSON.stringify(pos));

  emitter.emit('order:opened', {
    symbol,
    orderId: order.orderId,
    side: 'BUY',
    price: filledPrice,
    quantity: filledQty,
    status: 'FILLED',
    timestamp: new Date().toISOString(),
  });

  const aiInfo = aiTpPrice
    ? ` | AI TP:$${aiTpPrice} SL:$${aiSlPrice} R:R=${aiResult?.rr?.toFixed(2)} [${aiResult?.pattern ?? 'N/A'}]`
    : ' | AI: offline';
  telegram.send(`🟢 BUY ${symbol} | Entry: $${filledPrice.toFixed(2)} | Qty: ${filledQty} | Score: ${mlConfidence?.toFixed(2) ?? 'N/A'}${aiInfo}`);

  // Market order fills instantly — set up TP/SL immediately without waiting for UDS/poll
  await onBuyFilled(symbol, pos, filledPrice, filledQty);
}

// ──────────────────────────────────────────────────────────
// Order update handler (User Data Stream)
// ──────────────────────────────────────────────────────────
async function handleOrderUpdate(msg) {
  const { s: symbol, i: orderId, X: status, l: filledQty, L: filledPrice } = msg;

  const posRaw = await redisClient.get(REDIS_KEYS.POSITION(symbol));
  if (!posRaw) return;
  const pos = JSON.parse(posRaw);

  if (String(orderId) === pos.buyOrderId) {
    if (status === 'FILLED') {
      const qty = parseFloat(filledQty);
      const entry = parseFloat(filledPrice);
      // Guard: market orders already call onBuyFilled synchronously (pos.tpOrderId is set by then)
      if (qty > 0 && !pos.tpOrderId) await onBuyFilled(symbol, pos, entry, qty);
    } else if (status === 'PARTIALLY_FILLED') {
      const qty = parseFloat(filledQty);
      const entry = parseFloat(filledPrice);
      if (qty > 0) {
        // Cancel the unfilled remainder immediately
        try {
          await cancelOrder(symbol, orderId);
          logger.info(`[OrderManager] Cancelled partial remainder for ${symbol} orderId=${orderId}`);
        } catch (err) {
          if (!err.message.includes('ORDER_NOT_FOUND')) {
            logger.error(`[OrderManager] Failed to cancel partial remainder: ${err.message}`);
          }
        }
        await onBuyFilled(symbol, pos, entry, qty);
      }
    }
    return;
  }

  if (String(orderId) === pos.tpOrderId && status === 'FILLED') {
    await onTpFilled(symbol, pos, parseFloat(filledPrice), parseFloat(filledQty));
  } else if (String(orderId) === pos.slOrderId && status === 'FILLED') {
    await onSlFilled(symbol, pos, parseFloat(filledPrice), parseFloat(filledQty));
  }
}

async function onBuyFilled(symbol, pos, filledPrice, filledQty) {
  const infoRaw = await redisClient.get(REDIS_KEYS.EXCHANGE_INFO(symbol));
  const { tickSize, minNotional } = JSON.parse(infoRaw);

  // Guard: partial fill may produce a quantity below minNotional
  if (filledQty * filledPrice < minNotional) {
    logger.warn(`[OrderManager] SKIPPED TP/SL for ${symbol}: partial fill ${filledQty} @ ${filledPrice} below minNotional (${minNotional})`);
    await redisClient.del(REDIS_KEYS.POSITION(symbol));
    await Trade.updateOne({ _id: pos.tradeId }, { status: 'CANCELLED' });
    emitter.emit('order:cancelled', { symbol, orderId: pos.buyOrderId, reason: 'below_min_notional' });
    return;
  }

  const tpPrice = (pos.aiTp && pos.aiTp > filledPrice)
    ? binance.roundToTickSize(pos.aiTp, tickSize)   // AI-derived level from chart structure
    : binance.roundToTickSize(filledPrice * (1 + TAKE_PROFIT_PCT), tickSize); // fallback %

  const slPrice = (pos.aiSl && pos.aiSl < filledPrice)
    ? binance.roundToTickSize(pos.aiSl, tickSize)   // AI-derived level from chart structure
    : binance.roundToTickSize(filledPrice * (1 - STOP_LOSS_PCT), tickSize);  // fallback %

  const levelsSource = pos.aiTp ? 'AI-chart' : 'pct-fallback';
  logger.info(`[OrderManager] ${symbol} TP/SL source: ${levelsSource}`);

  const [tpOrder, slOrder] = await Promise.all([
    binance.restPost('/api/v3/order', {
      symbol, side: 'SELL', type: 'LIMIT', timeInForce: 'GTC', quantity: filledQty, price: tpPrice,
    }),
    // Use STOP_LOSS (market-stop) instead of STOP_LOSS_LIMIT so the SL always executes
    // even when price gaps through the stop level. STOP_LOSS_LIMIT with price=stopPrice
    // silently fails to fill when the market jumps past the limit in one candle.
    // NOTE: STOP_LOSS (market-stop) does NOT accept timeInForce — Binance returns -1106
    // if timeInForce is passed, which was causing onBuyFilled to throw and every trade
    // to remain stuck in PENDING status forever.
    binance.restPost('/api/v3/order', {
      symbol, side: 'SELL', type: 'STOP_LOSS',
      quantity: filledQty, stopPrice: slPrice,
    }),
  ]);

  const updatedPos = {
    ...pos,
    entryPrice: filledPrice,
    quantity: filledQty,
    tpOrderId: String(tpOrder.orderId),
    slOrderId: String(slOrder.orderId),
  };
  await redisClient.set(REDIS_KEYS.POSITION(symbol), JSON.stringify(updatedPos));

  // Transition PENDING → OPEN. Match on _id first; fall back to buyOrderId in case
  // tradeId in the Redis position key is from a previous stale write.
  const updateFilter = pos.tradeId
    ? { _id: pos.tradeId }
    : { buyOrderId: String(pos.buyOrderId), status: { $in: ['PENDING', 'OPEN'] } };
  const updateResult = await Trade.updateOne(
    updateFilter,
    { status: 'OPEN', entryPrice: filledPrice, tpOrderId: String(tpOrder.orderId), slOrderId: String(slOrder.orderId) }
  );
  if (updateResult.matchedCount === 0) {
    logger.error(`[OrderManager] onBuyFilled: no trade doc matched for ${symbol} tradeId=${pos.tradeId} buyOrderId=${pos.buyOrderId}`);
  }

  emitter.emit('order:filled', {
    symbol,
    orderId: pos.buyOrderId,
    filledPrice,
    filledQty,
    tpOrderId: tpOrder.orderId,
    slOrderId: slOrder.orderId,
  });

  logger.info(`[OrderManager] BUY filled ${symbol} @ ${filledPrice} | TP: ${tpPrice} | SL: ${slPrice} | source: ${levelsSource}`);
}

async function onTpFilled(symbol, pos, exitPrice, qty) {
  // Cancel SL sibling
  try {
    await cancelOrder(symbol, pos.slOrderId);
  } catch (err) {
    if (!err.message.includes('ORDER_NOT_FOUND')) logger.error(err.message);
  }

  const pnlPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
  const pnlUsdt = (exitPrice - pos.entryPrice) * qty;

  await closeTrade(symbol, pos, 'CLOSED_TP', exitPrice, pnlPct, pnlUsdt);
  telegram.send(`✅ CLOSED ${symbol} | +${pnlPct.toFixed(2)}% | P&L: $${pnlUsdt.toFixed(2)}`);
}

async function onSlFilled(symbol, pos, exitPrice, qty) {
  // Cancel TP sibling
  try {
    await cancelOrder(symbol, pos.tpOrderId);
  } catch (err) {
    if (!err.message.includes('ORDER_NOT_FOUND')) logger.error(err.message);
  }

  const pnlPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
  const pnlUsdt = (exitPrice - pos.entryPrice) * qty;

  await closeTrade(symbol, pos, 'CLOSED_SL', exitPrice, pnlPct, pnlUsdt);
  telegram.send(`🔴 STOP LOSS ${symbol} | ${pnlPct.toFixed(2)}% | P&L: $${pnlUsdt.toFixed(2)}`);
}

async function closeTrade(symbol, pos, status, exitPrice, pnlPct, pnlUsdt) {
  const closedAt = new Date();
  await Trade.updateOne({ _id: pos.tradeId }, { status, exitPrice, pnlPct, pnlUsdt, closedAt });
  await redisClient.del(REDIS_KEYS.POSITION(symbol));

  // Cancel Bull timeout job
  if (pos.bullJobId) {
    try {
      const job = await orderQueue.getJob(pos.bullJobId);
      if (job) await job.remove();
    } catch (_) { /* ignore */ }
  }

  await riskManager.recordTradePnL(pnlPct, pnlUsdt);

  emitter.emit('trade:closed', {
    symbol,
    buyOrderId: pos.buyOrderId,
    entryPrice: pos.entryPrice,
    exitPrice,
    pnlPct,
    pnlUsdt,
    status,
    duration: closedAt.toISOString(),
  });
}

// ──────────────────────────────────────────────────────────
// Order timeout handler
// ──────────────────────────────────────────────────────────
async function handleOrderTimeout(symbol, orderId) {
  // If the position was already resolved (by fill detection or reconciliation)
  // there is nothing for this timeout job to do — skip to avoid spurious 400s
  const posRaw = await redisClient.get(REDIS_KEYS.POSITION(symbol));
  if (!posRaw) {
    logger.info(`[OrderManager] Timeout job for ${symbol}:${orderId} — position already resolved, skipping`);
    return;
  }

  let order;
  try {
    order = await binance.restGet('/api/v3/order', { symbol, orderId }, 2, true);
  } catch (err) {
    const httpStatus = err.response?.status;
    const binanceCode = err.response?.data?.code;
    const detail = err.response?.data ? ` | ${JSON.stringify(err.response.data)}` : '';

    // 400 means Binance has no record of this order (already expired, cancelled, or never placed).
    // Treat as external cancellation — clean up without retrying so the job doesn't keep failing.
    if (httpStatus === 400) {
      await redisClient.del(REDIS_KEYS.POSITION(symbol));
      await Trade.updateOne({ buyOrderId: String(orderId), status: { $in: ['PENDING', 'OPEN'] } }, { status: 'CANCELLED', closedAt: new Date() });
      emitter.emit('order:cancelled', { symbol, orderId, reason: 'not_found_on_exchange' });
      logger.warn(`[OrderManager] Timeout: order ${orderId} for ${symbol} not found on Binance (code ${binanceCode}) — purged as CANCELLED`);
      return; // don't throw — job completes cleanly, no Bull retry
    }

    logger.error(`[OrderManager] handleOrderTimeout GET /api/v3/order failed for ${symbol}:${orderId} — ${err.message}${detail}`);
    throw err; // transient error — let Bull retry
  }

  if (order.status === 'FILLED') {
    const pos = JSON.parse(await redisClient.get(REDIS_KEYS.POSITION(symbol)));
    if (pos) await onBuyFilled(symbol, pos, parseFloat(order.price), parseFloat(order.executedQty));
    return;
  }
  if (order.status === 'PARTIALLY_FILLED') {
    const pos = JSON.parse(await redisClient.get(REDIS_KEYS.POSITION(symbol)));
    if (pos) {
      const qty = parseFloat(order.executedQty);
      if (qty > 0) {
        await binance.restDelete('/api/v3/order', { symbol, orderId }, 1);
        await onBuyFilled(symbol, pos, parseFloat(order.price), qty);
      }
    }
    return;
  }
  // Cancel unfilled
  await cancelOrder(symbol, orderId);
  await redisClient.del(REDIS_KEYS.POSITION(symbol));
  await Trade.updateOne({ buyOrderId: String(orderId) }, { status: 'CANCELLED' });
  emitter.emit('order:cancelled', { symbol, orderId, reason: 'timeout' });
  logger.info(`[OrderManager] Order ${orderId} for ${symbol} cancelled after timeout`);
}

async function cancelOrder(symbol, orderId) {
  return binance.restDelete('/api/v3/order', { symbol, orderId }, 1);
}

async function getOpenOrders(symbol) {
  return binance.restGet('/api/v3/openOrders', { symbol }, 3, true);
}

// ──────────────────────────────────────────────────────────
// Crash recovery
// ──────────────────────────────────────────────────────────
async function reconcileOpenPositions() {
  const keys = await redisClient.keys('position:*');
  let resolved = 0;
  for (const key of keys) {
    const posRaw = await redisClient.get(key);
    if (!posRaw) continue;
    const pos = JSON.parse(posRaw);
    const symbol = key.replace('position:', '');
    try {
      const [tpOrder, slOrder] = await Promise.all([
        pos.tpOrderId
          ? binance.restGet('/api/v3/order', { symbol, orderId: pos.tpOrderId }, 2, true)
          : null,
        pos.slOrderId
          ? binance.restGet('/api/v3/order', { symbol, orderId: pos.slOrderId }, 2, true)
          : null,
      ]);

      const tpFilled = tpOrder?.status === 'FILLED';
      const slFilled = slOrder?.status === 'FILLED';
      const tpCancelled = tpOrder?.status === 'CANCELED' || tpOrder?.status === 'EXPIRED';
      const slCancelled = slOrder?.status === 'CANCELED' || slOrder?.status === 'EXPIRED';
      const tpOpen = tpOrder && !tpFilled && !tpCancelled;
      const slOpen = slOrder && !slFilled && !slCancelled;

      if (tpFilled && slFilled) {
        // Race condition: both filled during downtime — close at TP (better fill), alert for manual review
        logger.warn(`[Reconcile] RACE: both TP and SL filled for ${symbol} — closing at TP price`);
        telegram.send(`⚠️ RECONCILE RACE: both TP+SL filled for ${symbol} — manual review required`);
        await onTpFilled(symbol, pos, parseFloat(tpOrder.cummulativeQuoteQty) / parseFloat(tpOrder.executedQty), parseFloat(tpOrder.executedQty));
        resolved++;
      } else if (tpFilled) {
        await onTpFilled(symbol, pos, parseFloat(tpOrder.cummulativeQuoteQty) / parseFloat(tpOrder.executedQty), parseFloat(tpOrder.executedQty));
        resolved++;
      } else if (slFilled) {
        await onSlFilled(symbol, pos, parseFloat(slOrder.cummulativeQuoteQty) / parseFloat(slOrder.executedQty), parseFloat(slOrder.executedQty));
        resolved++;
      } else if (pos.tpOrderId && pos.slOrderId && tpCancelled && slCancelled) {
        // Both orders cancelled/expired — orphaned position, clear Redis, alert
        logger.error(`[Reconcile] ORPHANED: both TP and SL are CANCELLED/EXPIRED for ${symbol}`);
        telegram.send(`⛔ ORPHANED POSITION: Both TP+SL CANCELLED for ${symbol} — manual review required`);
        await redisClient.del(REDIS_KEYS.POSITION(symbol));
        await Trade.updateOne({ _id: pos.tradeId }, { status: 'CANCELLED' });
        // Remove stale Bull timeout job if it still exists
        if (pos.bullJobId) {
          try {
            const job = await orderQueue.getJob(pos.bullJobId);
            if (job) await job.remove();
          } catch (_) { /* ignore */ }
        }
        resolved++;
      } else if (tpOpen && slOpen) {
        // TP and SL are both live — repair PENDING → OPEN in the DB if it got stuck
        const repaired = await Trade.updateOne(
          { $or: [{ _id: pos.tradeId }, { buyOrderId: String(pos.buyOrderId) }], status: 'PENDING' },
          { status: 'OPEN', tpOrderId: String(pos.tpOrderId), slOrderId: String(pos.slOrderId) }
        );
        if (repaired.modifiedCount > 0) {
          logger.warn(`[Reconcile] Repaired stuck PENDING → OPEN for ${symbol}`);
          resolved++;
        }

        // Detect SL gap-through: SL order is a LIMIT sell stuck because price has
        // already dropped below the limit price (STOP_LOSS_LIMIT edge case).
        // If so, cancel and close at market to guarantee exit.
        if (slOrder?.type === 'STOP_LOSS_LIMIT') {
          try {
            const ticker = await binance.restGet('/api/v3/ticker/price', { symbol }, 1, false);
            const currentPrice = parseFloat(ticker.price);
            const slLimitPrice = parseFloat(slOrder.price);
            if (currentPrice < slLimitPrice) {
              logger.error(
                `[Reconcile] SL GAP-THROUGH for ${symbol}: currentPrice=${currentPrice} < slLimit=${slLimitPrice} — cancelling and market-selling`
              );
              telegram.send(`⚠️ SL GAP-THROUGH ${symbol} | Price:${currentPrice} < SL:${slLimitPrice} — closing at MARKET`);
              try { await cancelOrder(symbol, pos.slOrderId); } catch (_) {}
              try { await cancelOrder(symbol, pos.tpOrderId); } catch (_) {}
              const marketSell = await binance.restPost('/api/v3/order', {
                symbol, side: 'SELL', type: 'MARKET', quantity: pos.quantity,
              }, 1);
              const exitPrice = parseFloat(marketSell.cummulativeQuoteQty) / parseFloat(marketSell.executedQty);
              await onSlFilled(symbol, pos, exitPrice, parseFloat(marketSell.executedQty));
              resolved++;
            }
          } catch (gapErr) {
            logger.error(`[Reconcile] SL gap-through check failed for ${symbol}: ${gapErr.message}`);
          }
        }
      }
    } catch (err) {
      logger.error(`[Reconcile] Error for ${symbol}: ${err.message}`);
    }
  }
  logger.info(`RECONCILIATION COMPLETE — ${keys.length} positions checked, ${resolved} resolved`);
}

async function pauseQueue() {
  if (orderQueue) {
    await orderQueue.pause();
    logger.info('[OrderManager] Bull queue paused — draining active jobs');
  }
}

async function resumeQueue() {
  if (orderQueue) {
    await orderQueue.resume();
    logger.info('[OrderManager] Bull queue resumed');
  }
}

module.exports = {
  init,
  onBuySignal,
  startUserDataStream,
  keepAliveUserDataStream,
  cancelOrder,
  getOpenOrders,
  reconcileOpenPositions,
  pauseQueue,
  resumeQueue,
};
