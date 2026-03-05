'use strict';

const router = require('express').Router();
const auth = require('../middleware/auth');
const logger = require('../utils/logger');
const orderManager = require('../services/orderManager');

let redisClient;
const { REDIS_KEYS } = require('../config/constants');

function init(redis) {
  redisClient = redis;
}

router.post('/trading/pause', auth, async (req, res) => {
  try {
    await redisClient.set(REDIS_KEYS.TRADING_HALTED, '1');
    logger.warn('[Control] Trading manually paused');
    res.json({ status: 'paused' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/trading/resume', auth, async (req, res) => {
  try {
    await redisClient.del(REDIS_KEYS.TRADING_HALTED);
    await orderManager.resumeQueue();
    logger.info('[Control] Trading manually resumed');
    res.json({ status: 'resumed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, init };
