'use strict';

const router = require('express').Router();
const auth = require('../middleware/auth');
const { REDIS_KEYS, SYMBOLS } = require('../config/constants');

let redisClient;
function init(redis) { redisClient = redis; }

// GET /api/oi?symbol=BTCUSDT  — returns latest cached OI data for a symbol
router.get('/oi', auth, async (req, res) => {
  try {
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    if (!SYMBOLS.includes(symbol)) return res.status(400).json({ error: 'unknown symbol' });

    const cached = await redisClient.get(REDIS_KEYS.OI(symbol));
    if (!cached) return res.status(404).json({ error: 'no OI data yet' });

    res.json(JSON.parse(cached));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, init };
