'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const required = [
  'BINANCE_API_KEY',
  'BINANCE_SECRET_KEY',
  'BINANCE_ENV',       // 'live' | 'testnet'
  'MONGODB_URI',
  'REDIS_URL',
  'JWT_SECRET',
  'DASHBOARD_PASSWORD',
  'CORS_ORIGIN',       // e.g. https://yourdashboard.example.com
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}. Check your .env file.`);
  }
}

// Optional keys — bot functions that depend on these will degrade gracefully,
// but warn loudly at boot so the omission is never silent.
const optional = [
  'TAAPI_SECRET',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'ML_SERVICE_URL',
  'MAX_DAILY_DRAWDOWN',       // default: 2 (%) — max daily loss before halt
  'ML_CONFIDENCE_THRESHOLD',  // default: 0.72 — minimum ML score for BUY
  'ML_PORT',                  // default: 5001 — Flask ML service port
];
for (const key of optional) {
  if (!process.env[key]) {
    // Use console.warn here — logger is not yet initialised when env.js runs
    console.warn(`[env] WARNING: Optional variable ${key} is not set. Related features will be disabled.`);
  }
}

// Derived config
process.env.BINANCE_BASE_URL =
  process.env.BINANCE_ENV === 'live'
    ? 'https://api.binance.com'
    : 'https://testnet.binance.vision';

process.env.BINANCE_WS_BASE =
  process.env.BINANCE_ENV === 'live'
    ? 'wss://stream.binance.com:9443/ws'
    : 'wss://stream.testnet.binance.vision/ws';

// Binance Futures REST base URL (used by oi.js for OI, funding rate, L/S ratio)
process.env.BINANCE_FUTURES_URL =
  process.env.BINANCE_ENV === 'live'
    ? 'https://fapi.binance.com'
    : 'https://testnet.binancefuture.com';

// Market data URL — ALWAYS mainnet regardless of BINANCE_ENV.
// OI, funding rate, and L/S ratio are real market signals; testnet has no data.
process.env.BINANCE_MARKET_URL = 'https://fapi.binance.com';
