'use strict';

const router = require('express').Router();
const auth   = require('../middleware/auth');
const Candle = require('../models/Candle');

/**
 * GET /api/candles?symbol=BTCUSDT&limit=300
 * Returns historical candles from MongoDB (newest first → reversed for chart).
 */
router.get('/candles', auth, async (req, res) => {
  try {
    const { symbol, limit = 300 } = req.query;
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    const candles = await Candle.find({ symbol })
      .sort({ timestamp: -1 })
      .limit(parseInt(limit, 10))
      .lean();
    // return oldest first so charts can append left-to-right
    res.json(candles.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
