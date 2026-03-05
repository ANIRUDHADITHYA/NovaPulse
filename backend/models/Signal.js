'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

const SignalSchema = new Schema(
  {
    symbol: { type: String, required: true },
    timestamp: { type: Date, required: true },
    layer1Score: Number,
    layer2Score: Number,
    layer3Score: Number,
    layer4Score: Number,
    layer5Score: Number,
    mlConfidence: Number,
    mlOffline: { type: Boolean, default: false },
    finalSignal: { type: String, enum: ['BUY', 'SELL', 'NEUTRAL'], required: true },
    vetoed: { type: Boolean, default: false },
    vetoReason: String,
  },
  { timestamps: true }
);

SignalSchema.index({ symbol: 1, timestamp: -1 });

module.exports = mongoose.model('Signal', SignalSchema);
