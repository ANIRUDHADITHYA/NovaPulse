'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

const CandleSchema = new Schema(
  {
    symbol: { type: String, required: true, index: true },
    interval: { type: String, required: true, default: '15m' },
    open: { type: Number, required: true },
    high: { type: Number, required: true },
    low: { type: Number, required: true },
    close: { type: Number, required: true },
    volume: { type: Number, required: true },
    timestamp: { type: Date, required: true },
  },
  { timestamps: false }
);

CandleSchema.index({ symbol: 1, timestamp: 1 }, { unique: true });

module.exports = mongoose.model('Candle', CandleSchema);
