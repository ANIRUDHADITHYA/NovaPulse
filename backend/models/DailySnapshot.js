'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Daily performance snapshot — persisted at 00:00 UTC just before the
 * daily_pnl and daily_pnl_usdt Redis keys are cleared.
 */
const DailySnapshotSchema = new Schema(
  {
    date: { type: String, required: true, unique: true }, // 'YYYY-MM-DD' UTC
    dailyPnlPct: { type: Number, required: true },
    dailyPnlUsdt: { type: Number, required: true },
    totalTrades: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    winRate: { type: Number, default: 0 }, // 0–100
    tradingHalted: { type: Boolean, default: false },
  },
  { timestamps: false }
);

DailySnapshotSchema.index({ date: -1 });

module.exports = mongoose.model('DailySnapshot', DailySnapshotSchema);
