'use strict';

const router = require('express').Router();
const auth = require('../middleware/auth');
const Trade = require('../models/Trade');
const DailySnapshot = require('../models/DailySnapshot');
const riskManager = require('../services/riskManager');

router.get('/performance', auth, async (req, res) => {
  try {
    const [total, wins, dailyPnl, weeklyPnl] = await Promise.all([
      Trade.countDocuments({ status: { $in: ['CLOSED_TP', 'CLOSED_SL'] } }),
      Trade.countDocuments({ status: 'CLOSED_TP' }),
      riskManager.getDailyPnl(),
      riskManager.getWeeklyPnl(),
    ]);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthlyTrades = await Trade.find({
      status: { $in: ['CLOSED_TP', 'CLOSED_SL'] },
      closedAt: { $gte: monthStart },
    }).lean();
    const monthlyPnl = monthlyTrades.reduce((a, t) => a + (t.pnlPct || 0), 0);

    const avgPnlResult = await Trade.aggregate([
      { $match: { status: { $in: ['CLOSED_TP', 'CLOSED_SL'] } } },
      { $group: { _id: null, avgPnl: { $avg: '$pnlPct' } } },
    ]);
    const avgPnl = avgPnlResult[0]?.avgPnl ?? 0;

    res.json({
      totalTrades: total,
      wins,
      losses: total - wins,
      winRate: total > 0 ? ((wins / total) * 100).toFixed(1) : '0',
      avgPnlPct: avgPnl.toFixed(4),
      dailyPnlPct: dailyPnl,
      weeklyPnlPct: weeklyPnl,
      monthlyPnlPct: monthlyPnl.toFixed(4),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/performance/history — last N daily snapshots (default 30 days)
router.get('/performance/history', auth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 30, 365);
    const snapshots = await DailySnapshot.find({})
      .sort({ date: -1 })
      .limit(limit)
      .lean();
    res.json(snapshots.reverse()); // oldest-first for chart rendering
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
