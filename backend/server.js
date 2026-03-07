'use strict';

// ── MUST BE FIRST ─────────────────────────────────────────
require('./config/env');

const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const cron = require('node-cron');
const Redis = require('ioredis');

const logger = require('./utils/logger');
const { SYMBOLS, CANDLE_INTERVAL, REDIS_KEYS } = require('./config/constants');

const emitter = require('./socket/emitter');
const binance = require('./services/binance');
const indicators = require('./services/indicators');
const oiService = require('./services/oi');
const sentimentService = require('./services/sentiment');
const taapiService = require('./services/taapi');
const signalService = require('./services/signal');
const orderManager = require('./services/orderManager');
const riskManager = require('./services/riskManager');
const retrainJob = require('./jobs/retrainJob');
const newsService = require('./services/news');
const aiSignal = require('./services/aiSignal');

const authRoutes = require('./routes/auth');
const tradesRoutes = require('./routes/trades');
const balanceRoutes = require('./routes/balance');
const signalsRoutes = require('./routes/signals');
const performanceRoutes = require('./routes/performance');
const backtestRoutes = require('./routes/backtest');
const controlRoute  = require('./routes/control');
const statusRoute   = require('./routes/status');
const candlesRoute  = require('./routes/candles');
const oiRoute       = require('./routes/oi');

const PORT = process.env.PORT || 3000;

// ─── Express App ──────────────────────────────────────────
const app = express();
const server = http.createServer(app);

// ─── Middleware (order matters) ───────────────────────────
app.use(helmet());
app.use(cors({ origin: [process.env.CORS_ORIGIN, 'http://localhost:5173', 'http://localhost:5174'], credentials: true }));
app.use(express.json());
app.use(cookieParser());

// ─── Socket.io (before server.listen) ────────────────────
// redis not ready yet here — emitter.init is called again after redis connects (in bootstrap)

// ─── Health check (unauthenticated) ──────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ─── Routes ───────────────────────────────────────────────
app.use('/api', authRoutes);
app.use('/api', tradesRoutes.router);
app.use('/api', balanceRoutes);
app.use('/api', signalsRoutes);
app.use('/api', performanceRoutes);
app.use('/api', backtestRoutes);
app.use('/api', controlRoute.router);
app.use('/api', statusRoute.router);
app.use('/api', candlesRoute);
app.use('/api', oiRoute.router);

// ─── Graceful shutdown ────────────────────────────────────
let redis;

async function gracefulShutdown(signal) {
  logger.info(`[Server] ${signal} received — shutting down gracefully`);
  try {
    if (redis) await redis.set(REDIS_KEYS.TRADING_HALTED, '1');
    await orderManager.pauseQueue();
    const telegram = require('./services/telegram');
    telegram.send('🟡 NovaPulse shutting down gracefully…');
    binance.closeAllStreams();
    await mongoose.disconnect();
    if (redis) redis.disconnect();
    logger.info('[Server] Graceful shutdown complete');
    logger.end();
  } catch (err) {
    logger.error(`[Server] Shutdown error: ${err.message}`);
  }
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ─── Bootstrap ────────────────────────────────────────────
async function connectMongoDBWithRetry(retries = 5, delay = 1000) {
  for (let i = 1; i <= retries; i++) {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      logger.info('[Server] MongoDB connected');
      return;
    } catch (err) {
      logger.warn(`[Server] MongoDB connection attempt ${i}/${retries} failed: ${err.message}`);
      if (i === retries) {
        logger.error('FATAL: MongoDB connection failed after all retries');
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, delay * Math.pow(2, i - 1)));
    }
  }
}

async function bootstrap() {
  // 1. MongoDB
  await connectMongoDBWithRetry();

  // 2. Redis
  redis = new Redis(process.env.REDIS_URL);
  await new Promise((resolve, reject) => {
    redis.on('ready', () => {
      logger.info('[Server] Redis connected');
      resolve();
    });
    redis.on('error', reject);
  });

  // Inject redis into services
  emitter.init(server, redis); // reinit with redis so new-client replay works
  newsService.init(redis);
  binance.init(redis, async (symbol, candle) => {
    await signalService.evaluate(symbol);
  });
  indicators.init(redis);
  oiService.init(redis);
  sentimentService.init(redis);
  taapiService.init(redis);
  signalService.init(redis);
  orderManager.init(redis);
  riskManager.init(redis);
  aiSignal.init(redis);
  controlRoute.init(redis);
  statusRoute.init(redis);
  oiRoute.init(redis);
  tradesRoutes.init(orderManager); // inject orderManager for cancel endpoint

  // Clear any stale news veto on startup so signals aren't blocked from boot
  await redis.del(REDIS_KEYS.NEWS_VETO);
  logger.info('[Server] Cleared stale NEWS_VETO on boot');

  // 3. Fetch & cache exchangeInfo
  await binance.fetchAndCacheExchangeInfo();

  // 4. Seed candle buffers from MongoDB
  for (const symbol of SYMBOLS) {
    await binance.seedCandleBuffer(symbol);
  }

  // 5. Validate API key
  await binance.validateApiKey();

  // 6. Crash recovery
  await orderManager.reconcileOpenPositions();

  // 7. User Data Stream (graceful — testnet may return 410, falls back to REST poll)
  const listenKey = await orderManager.startUserDataStream();

  // 8. Open market data WebSocket streams
  binance.openAllCandleStreams();

  // 9. Cron jobs
  cron.schedule('*/5 * * * *', () => oiService.fetchAllOI()); // OI every 5m
  cron.schedule('*/15 * * * *', () => sentimentService.fetchSentiment()); // Sentiment every 15m (keep cache fresh for signal cycles)
  cron.schedule('*/15 * * * *', () => newsService.fetchAndCheckNews()); // News filter every 15m
  if (listenKey) {
    cron.schedule('*/30 * * * *', () => orderManager.keepAliveUserDataStream(listenKey)); // UDS keepalive
  }
  cron.schedule('59 23 * * *', () => riskManager.sendDailySummary()); // Daily summary Telegram 23:59 UTC
  cron.schedule('0 0 * * *', async () => { // Daily P&L reset 00:00 UTC
    await riskManager.persistDailySnapshot();
    await redis.del(REDIS_KEYS.DAILY_PNL);
    await redis.del(REDIS_KEYS.DAILY_PNL_USDT);
    await redis.del(REDIS_KEYS.TRADING_HALTED);
    logger.info('[Server] Daily P&L reset');
  });
  cron.schedule('0 0 * * 1', async () => { // Weekly P&L reset Monday 00:00 UTC
    await redis.del(REDIS_KEYS.WEEKLY_PNL);
    await redis.del(REDIS_KEYS.WEEKLY_REVIEW_FLAG);
    logger.info('[Server] Weekly P&L reset');
  });
  cron.schedule('0 2 * * 0', () => retrainJob.triggerRetrain()); // Weekly ML retrain Sunday 02:00

  // 10. Start HTTP server — do this BEFORE the slow initial data fetches
  // so the server is immediately available to accept connections
  await new Promise((resolve) => server.listen(PORT, () => {
    logger.info(
      `NovaPulse ONLINE | Env: ${process.env.NODE_ENV} | Binance: ${process.env.BINANCE_ENV} | Pairs: BTC/ETH/SOL | Buffer: READY`
    );
    resolve();
  }));

  // Fetch initial data (non-blocking after server is up)
  Promise.all([oiService.fetchAllOI(), sentimentService.fetchSentiment(), taapiService.fetchBulkIndicators()])
    .catch((err) => logger.warn(`[Server] Initial data fetch error: ${err.message}`));
}

bootstrap().catch((err) => {
  logger.error(`[Server] Bootstrap failed: ${err.message}`);
  process.exit(1);
});
