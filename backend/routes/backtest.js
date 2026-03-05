'use strict';

const router = require('express').Router();
const auth = require('../middleware/auth');
const backtester = require('../services/backtester');

router.get('/backtest/run', auth, async (req, res) => {
  try {
    const { lookbackDays = 90, symbols } = req.query;
    // symbols may be a comma-separated string: 'BTCUSDT,ETHUSDT'
    const symbolList = symbols
      ? symbols.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
      : undefined;
    const report = await backtester.runBacktest({
      lookbackDays: parseInt(lookbackDays),
      ...(symbolList && { symbols: symbolList }),
    });
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
