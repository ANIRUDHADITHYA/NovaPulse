'use strict';

const { Server } = require('socket.io');
const cookie = require('cookie');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const { SYMBOLS, REDIS_KEYS } = require('../config/constants');

let io;
let redisClient;

function init(httpServer, redis) {
  redisClient = redis;

  io = new Server(httpServer, {
    cors: {
      origin: [process.env.CORS_ORIGIN, 'http://localhost:5173'],
      credentials: true,
    },
  });

  // JWT middleware for Socket.io connections
  io.use((socket, next) => {
    try {
      const cookies = cookie.parse(socket.handshake.headers.cookie || '');
      const token = cookies.token;
      if (!token) return next(new Error('unauthorized'));
      jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    logger.info(`[Socket.io] Client connected: ${socket.id}`);

    // Replay latest cached data immediately so the dashboard populates on load
    if (redisClient) {
      try {
        // OI for each symbol
        for (const symbol of SYMBOLS) {
          const raw = await redisClient.get(REDIS_KEYS.OI(symbol));
          if (raw) {
            const d = JSON.parse(raw);
            socket.emit('oi:update', {
              symbol,
              oiDeltaPct: d.oiDeltaPct,
              oiDelta1h: d.oiDelta1hPct,
              fundingRate: d.fundingRate,
              longShortRatio: d.longShortRatio,
              timestamp: d.timestamp,
            });
          }
        }

        // Sentiment
        const sentRaw = await redisClient.get(REDIS_KEYS.SENTIMENT);
        if (sentRaw) socket.emit('sentiment:update', JSON.parse(sentRaw));

        // Latest signal per symbol
        for (const symbol of SYMBOLS) {
          const sigRaw = await redisClient.get(REDIS_KEYS.LAST_SIGNAL(symbol));
          if (sigRaw) {
            const sig = JSON.parse(sigRaw);
            const event = sig.finalSignal === 'BUY' ? 'signal:buy'
              : sig.finalSignal === 'SELL' ? 'signal:sell' : 'signal:neutral';
            socket.emit(event, sig);
          }
        }

        // PnL state
        const [dailyRaw, dailyUsdtRaw, haltedRaw] = await Promise.all([
          redisClient.get(REDIS_KEYS.DAILY_PNL),
          redisClient.get(REDIS_KEYS.DAILY_PNL_USDT),
          redisClient.get(REDIS_KEYS.TRADING_HALTED),
        ]);
        socket.emit('pnl:update', {
          dailyPnlPct: dailyRaw ? parseFloat(dailyRaw) : 0,
          dailyPnlUsdt: dailyUsdtRaw ? parseFloat(dailyUsdtRaw) : 0,
          halted: !!haltedRaw,
        });
      } catch (err) {
        logger.warn(`[Socket.io] Failed to replay cached state: ${err.message}`);
      }
    }

    socket.on('disconnect', () => {
      logger.info(`[Socket.io] Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

function emit(eventName, payload) {
  if (!io) return;
  io.emit(eventName, payload);
}

module.exports = { init, emit };
