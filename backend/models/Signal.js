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
    layer6Score: Number,
    mlConfidence: Number,
    mlOffline: { type: Boolean, default: false },
    finalSignal: { type: String, enum: ['BUY', 'SELL', 'NEUTRAL'], required: true },
    vetoed: { type: Boolean, default: false },
    vetoReason: String,
    // Layer 6 — AI chart-pattern analysis
    aiSignal:  { type: String, enum: ['BUY', 'SELL', 'NEUTRAL', null], default: null },
    aiEntry:   Number,
    aiSl:      Number,
    aiTp:      Number,
    aiRr:      Number,
    aiPattern: String,
    aiReason:  String,
  },
  { timestamps: true }
);

SignalSchema.index({ symbol: 1, timestamp: -1 });

module.exports = mongoose.model('Signal', SignalSchema);
