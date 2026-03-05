'use strict';

const router = require('express').Router();
const auth = require('../middleware/auth');
const Trade = require('../models/Trade');

let _orderManager;
function init(om) { _orderManager = om; }

router.get('/trades', auth, async (req, res) => {
  try {
    const { symbol, limit = 50 } = req.query;
    const query = { status: { $in: ['CLOSED_TP', 'CLOSED_SL', 'CANCELLED'] } };
    if (symbol) query.symbol = symbol;
    const trades = await Trade.find(query).sort({ closedAt: -1 }).limit(parseInt(limit)).lean();
    res.json(trades);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/trades/open', auth, async (req, res) => {
  try {
    const trades = await Trade.find({ status: 'OPEN' }).lean();
    res.json(trades);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/trades/stats', auth, async (req, res) => {
  try {
    const stats = await Trade.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 }, avgPnlPct: { $avg: '$pnlPct' } } },
    ]);
    const total = await Trade.countDocuments({ status: { $in: ['CLOSED_TP', 'CLOSED_SL'] } });
    const wins = await Trade.countDocuments({ status: 'CLOSED_TP' });
    res.json({ stats, total, wins, winRate: total > 0 ? ((wins / total) * 100).toFixed(1) : '0' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/orders/:symbol/:orderId', auth, async (req, res) => {
  try {
    if (!_orderManager) return res.status(503).json({ error: 'Order manager not initialised' });
    await _orderManager.cancelOrder(req.params.symbol, req.params.orderId);
    res.json({ cancelled: true });
  } catch (err) {
    // ORDER_NOT_FOUND means it already filled — treat as non-fatal
    if (err.message && err.message.includes('ORDER_NOT_FOUND')) {
      return res.status(404).json({ error: 'Order not found — may have already filled' });
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, init };
