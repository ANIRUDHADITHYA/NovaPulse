'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

const TradeSchema = new Schema(
  {
    symbol: { type: String, required: true },
    side: { type: String, default: 'BUY' },
    entryPrice: { type: Number, required: true },
    exitPrice: Number,
    quantity: { type: Number, required: true },
    status: {
      type: String,
      enum: ['PENDING', 'OPEN', 'CLOSED_TP', 'CLOSED_SL', 'CANCELLED'],
      default: 'PENDING',
    },
    buyOrderId: String,
    tpOrderId: String,
    slOrderId: String,
    bullJobId: String,
    mlConfidence: Number,
    pnlPct: Number,
    pnlUsdt: Number,
    // AI-provided levels (null when AI offline at signal time)
    aiTp:      Number,
    aiSl:      Number,
    aiPattern: String,
    aiReason:  String,
    aiRr:      Number,
    openedAt: { type: Date, default: Date.now },
    closedAt: Date,
  },
  { timestamps: true }
);

TradeSchema.index({ symbol: 1, openedAt: -1 });
TradeSchema.index({ status: 1, symbol: 1 });

module.exports = mongoose.model('Trade', TradeSchema);
