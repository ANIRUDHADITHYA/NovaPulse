'use strict';

const router = require('express').Router();
const auth = require('../middleware/auth');
const binance = require('../services/binance');

router.get('/balance', auth, async (req, res) => {
  try {
    const account = await binance.restGet('/api/v3/account', {}, 10, true);
    const wanted = ['USDT', 'BTC', 'ETH', 'SOL'];
    const result = {};
    for (const asset of wanted) {
      const b = account.balances.find((a) => a.asset === asset);
      result[asset.toLowerCase()] = b
        ? { free: parseFloat(b.free), locked: parseFloat(b.locked) }
        : { free: 0, locked: 0 };
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
