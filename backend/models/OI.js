'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Persists one OI snapshot per symbol per fetch cycle.
 * Used for historical analysis and post-trade review.
 */
const OISchema = new Schema(
  {
    symbol: { type: String, required: true, index: true },
    currentOI: { type: Number, required: true },
    oiDeltaPct: { type: Number, required: true },   // % change vs 1 candle (15 min) ago
    oiDelta1hPct: { type: Number, required: true },  // % change vs 4 candles (1 h) ago
    fundingRate: { type: Number, required: true },
    longShortRatio: { type: Number, required: true },
    timestamp: { type: Date, required: true },
  },
  { timestamps: false }
);

OISchema.index({ symbol: 1, timestamp: -1 });

module.exports = mongoose.model('OI', OISchema);
