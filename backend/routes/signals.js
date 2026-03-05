'use strict';

const router = require('express').Router();
const auth = require('../middleware/auth');
const Signal = require('../models/Signal');

router.get('/signals', auth, async (req, res) => {
  try {
    const { symbol, limit = 20 } = req.query;
    const query = symbol ? { symbol } : {};
    const signals = await Signal.find(query).sort({ timestamp: -1 }).limit(parseInt(limit)).lean();
    res.json(signals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/signals/latest', auth, async (req, res) => {
  try {
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    const signal = await Signal.findOne({ symbol }).sort({ timestamp: -1 }).lean();
    res.json(signal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
