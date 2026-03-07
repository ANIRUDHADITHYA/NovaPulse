'use strict';

// Trading config
module.exports.SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOTUSDT'];
module.exports.CANDLE_INTERVAL = '15m';
module.exports.ML_THRESHOLD = 0.72;
module.exports.TAKE_PROFIT_PCT = 0.015; // 1.5% — 3:1 R:R vs 0.5% SL
module.exports.STOP_LOSS_PCT = 0.005;  // 0.5%
module.exports.OI_DELTA_THRESHOLD = 0.003; // 0.3% — crypto OI typical 15m move is 0.1-0.5%
module.exports.FUNDING_RATE_THRESHOLD = 0.001; // 0.1%
module.exports.FEAR_GREED_BUY_MAX = 65; // allow entries up to mild-greed; pure Fear zone was too restrictive
module.exports.FEAR_GREED_VETO = 80;
module.exports.MAX_OPEN_POSITIONS = 3;
module.exports.MAX_CAPITAL_PCT = 0.2; // 20% per trade
module.exports.ORDER_TIMEOUT_MS = 900000; // 15 minutes
module.exports.CANDLE_BUFFER_MIN = 50; // min candles before signals
module.exports.CANDLE_BUFFER_MAX = 200;

// Redis key registry — ALWAYS use these constants; never inline key strings
const REDIS_KEYS = {
  CANDLE_BUFFER: (symbol) => `candle_buffer:${symbol}`,
  EXCHANGE_INFO: (symbol) => `exchangeInfo:${symbol}`,
  SIGNAL_LOCK: (symbol) => `signal_lock:${symbol}`,
  POSITION: (symbol) => `position:${symbol}`,
  OI: (symbol) => `oi:${symbol}`,
  TAAPI: (symbol) => `taapi:${symbol}`,
  INDICATORS: (symbol) => `indicators:${symbol}`,
  DAILY_PNL: 'daily_pnl',
  DAILY_PNL_USDT: 'daily_pnl_usdt',
  WEEKLY_PNL: 'weekly_pnl',
  TRADING_HALTED: 'TRADING_HALTED',
  WEEKLY_REVIEW_FLAG: 'WEEKLY_REVIEW_FLAG',
  IP_BANNED: 'IP_BANNED',
  NEWS_VETO: 'NEWS_VETO',
  SENTIMENT: 'sentiment',
  LAST_SIGNAL: (symbol) => `last_signal:${symbol}`,
  BUFFER_READY: (symbol) => `buffer_ready:${symbol}`,
  TAAPI_CALLS_TODAY: 'taapi_calls_today',
  BINANCE_WEIGHT: 'binance_weight',
  WS_CONNECTED: (symbol) => `ws_connected:${symbol}`,
};
module.exports.REDIS_KEYS = REDIS_KEYS;
