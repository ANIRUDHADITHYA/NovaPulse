# 🌌 NovaPulse

> **"Signals from the stars. Profits on Earth."**

NovaPulse is a professional-grade, AI-powered automated crypto trading platform built for consistent, low-risk daily returns. It combines real-time technical indicators, Open Interest data, market sentiment, and a custom-trained Machine Learning model to generate high-confidence limit order trades on Binance Spot.

---

## 🎯 Goal

| Parameter | Value |
|-----------|-------|
| **Daily Profit Target** | 1–2% |
| **Max Daily Drawdown** | -2% (auto-halt) |
| **Market** | Binance Crypto Spot |
| **Pairs** | BTCUSDT, ETHUSDT, SOLUSDT |
| **Order Type** | Limit Orders Only |
| **Candle Interval** | 15 minutes |
| **Start Mode** | Binance Testnet → Live |
| **Bot Direction** | **Long-only** — BUY to open, TP/SL to close. No shorting on Spot. A SELL confluence signal = do not open new position (Spot cannot short). All exits are handled exclusively by TP and SL limit orders placed after a BUY fill. |

---

## 🏗️ Project Structure

```
novapulse/
├── backend/                        # Node.js core engine
│   ├── config/
│   │   ├── constants.js            # Pairs, intervals, thresholds
│   │   └── env.js                  # Environment variable loader
│   ├── middleware/
│   │   └── auth.js                 # JWT verification middleware (Feature 7)
│   ├── services/
│   │   ├── binance.js              # Binance REST + WebSocket client
│   │   ├── indicators.js           # RSI, EMA, MACD, Bollinger Bands
│   │   ├── oi.js                   # Open Interest + Funding Rate fetcher
│   │   ├── taapi.js                # Taapi.io Pro API integration
│   │   ├── sentiment.js            # Fear & Greed Index fetcher
│   │   ├── signal.js               # Signal confluence engine
│   │   ├── orderManager.js         # Place / track / cancel limit orders
│   │   ├── riskManager.js          # Position sizing, daily P&L, halt logic
│   │   ├── backtester.js           # Backtesting engine (Feature 14)
│   │   └── telegram.js             # Telegram Bot trade alerts
│   ├── models/
│   │   ├── Trade.js                # Trade schema (MongoDB)
│   │   ├── Candle.js               # Candle/OHLCV schema
│   │   └── Signal.js               # Signal log schema
│   ├── routes/
│   │   ├── auth.js                 # POST /api/auth/login|logout (Feature 7)
│   │   ├── trades.js               # GET /api/trades
│   │   ├── balance.js              # GET /api/balance
│   │   ├── signals.js              # GET /api/signals
│   │   ├── performance.js          # GET /api/performance
│   │   ├── backtest.js             # GET /api/backtest/run (Feature 14)
│   │   └── control.js              # POST /api/trading/pause|resume
│   ├── socket/
│   │   └── emitter.js              # Socket.io real-time push to frontend
│   ├── jobs/
│   │   └── retrainJob.js           # Weekly ML model retraining (node-cron)
│   └── server.js                   # Entry point
│
├── ml-service/                     # Python ML microservice
│   ├── data/
│   │   ├── collector.py            # Historical data fetcher (Binance REST)
│   │   └── features.py             # Feature engineering pipeline
│   ├── model/
│   │   ├── train.py                # XGBoost model training script
│   │   ├── evaluate.py             # Model evaluation + metrics
│   │   └── novapulse_model.pkl     # Saved trained model
│   ├── app.py                      # Flask API server (predict + retrain)
│   └── requirements.txt            # Python dependencies
│
├── frontend/                       # React dashboard
│   ├── src/
│   │   ├── components/
│   │   │   ├── Login.jsx           # Auth login page (Feature 7)
│   │   │   ├── Chart.jsx           # TradingView Lightweight Charts
│   │   │   ├── SignalPanel.jsx     # Live BUY/SELL signals + scores
│   │   │   ├── OpenOrders.jsx      # Active limit orders + cancel
│   │   │   ├── TradeHistory.jsx    # Closed trades + P&L table
│   │   │   ├── RiskPanel.jsx       # Daily drawdown meter
│   │   │   ├── OIPanel.jsx         # Open Interest chart
│   │   │   ├── SentimentBar.jsx    # Fear & Greed gauge
│   │   │   ├── BacktestPanel.jsx   # Equity curve + backtest results (Feature 14)
│   │   │   └── Navbar.jsx          # Pair switcher + status
│   │   ├── hooks/
│   │   │   ├── useSocket.js        # Socket.io connection
│   │   │   └── useTrades.js        # Trade data fetching
│   │   ├── services/
│   │   │   └── api.js              # Axios calls to backend
│   │   └── App.jsx
│   └── package.json
│
├── backtest-results/               # Backtest JSON reports (gitignored)
├── .env.example                    # Environment variable template
├── docker-compose.yml              # MongoDB + Redis + services
├── package.json                    # Backend dependencies
└── README.md
```

---

## ⚙️ Signal Engine — 5 Layers of Confluence

Every trade requires **all 5 layers to agree** before execution.

### Layer 1 — Technical Indicators (Free)
Built on real-time 15m candle data using the `technicalindicators` npm package.

| Indicator | Signal |
|-----------|--------|
| EMA 9 / 21 / 50 | Trend direction + crossover |
| RSI (14) | Oversold (<35) / Overbought (>65) |
| MACD | Momentum confirmation |
| Bollinger Bands | Volatility squeeze breakout |
| Volume Ratio | Confirms move is real (vs 20-candle avg) |

### Layer 2 — Open Interest + Funding Rate (Binance Free)

| Signal | Meaning |
|--------|---------|
| OI rising + price rising | Long buildup → BUY confirm |
| OI falling + price rising | Short covering → weakening |
| Funding rate > +0.1% | Overleveraged longs → AVOID |
| Long/Short ratio | Crowd positioning |

### Layer 3 — Taapi.io Pro (₹599/mo)
- 200+ technical indicators as a REST API
- Bulk endpoint: 3 pairs in 1 API call
- Used as second-opinion cross-validation of Layer 1

### Layer 4 — Fear & Greed Index (Free)

| Value | Zone | Action |
|-------|------|--------|
| 0–25 | Extreme Fear | Strong BUY opportunity |
| 25–45 | Fear | Cautious BUY |
| 46–55 | Neutral | Wait for other signals |
| 55–75 | Greed | Cautious, tighten stops |
| 75–100 | Extreme Greed | AVOID new longs |

### Layer 5 — Custom Python ML (XGBoost)
Meta-model that scores the confluence of all layers above.

```
Input Features (16 total):
  Price:      ema_cross_9_21, ema_cross_21_50, rsi_14,
              macd_histogram, bb_squeeze, volume_ratio
  OI:         oi_change_pct_15m, oi_change_pct_1h,
              funding_rate, long_short_ratio
  Sentiment:  fear_greed_value
  Taapi:      taapi_rsi, taapi_macd_signal
  Time:       hour_of_day, day_of_week, is_weekend

Output:  Confidence score (0.0 – 1.0)
Threshold: Score > 0.72 → proceed to trade
Retrain: Every Sunday on latest 3 months of data
```

---

## 🔄 Trade Flow (End to End)

```
15m candle closes on Binance WebSocket
          ↓
Layer 1: Compute RSI, EMA, MACD, BB, Volume
          ↓
Layer 2: Fetch OI delta + Funding Rate (Binance Futures REST)
          ↓
Layer 3: Fetch Taapi.io bulk indicators
          ↓
Layer 4: Fetch Fear & Greed Index
          ↓
Layer 5: Send all features → Python ML → get confidence score
          ↓
Risk Manager checks:
  ✅ Daily drawdown < 2%?
  ✅ Open positions < 3?
  ✅ Capital available?
  ✅ ML score > 0.72?
          ↓
Place LIMIT BUY order (at best ask price)
          ↓
On fill → immediately place:
  LIMIT SELL  at entry + 1.0%   (Take Profit)
  STOP LIMIT  at entry - 0.5%   (Stop Loss)
          ↓
Either TP or SL hits → trade closed
          ↓
Log to MongoDB → update P&L → push to React dashboard
          ↓
Send Telegram alert: "✅ BTC +0.94% | Score: 0.76"
```

---

## 🛡️ Risk Management Rules

### Portfolio Level
```
✅ Max daily drawdown:     -2%  → auto-halt ALL trading
✅ Max weekly drawdown:    -5%  → manual review required
✅ Max open positions:     3 simultaneously (1 per pair)
✅ Max capital per trade:  20% of total portfolio
```

### Per Trade Level
```
✅ Entry:         Limit order only (never market order)
✅ Take Profit:   +1.0% from entry
✅ Stop Loss:     -0.5% from entry
✅ Risk:Reward:   1:2 minimum
✅ Order timeout: Cancel unfilled limit orders after 15 minutes
✅ Avoid trades:  When Fear & Greed > 80 (Extreme Greed)
✅ Avoid trades:  30 minutes around major news events
```

---

## 🧰 Technology Stack

| Layer | Technology |
|-------|-----------|
| **Backend Runtime** | Node.js v20+ |
| **API Framework** | Express.js |
| **Real-time Push** | Socket.io |
| **Market Data** | Binance WebSocket + REST API |
| **Indicators** | `technicalindicators` (npm) |
| **Signal API** | Taapi.io Pro |
| **OI + Funding** | Binance Futures REST (free) |
| **Sentiment** | Fear & Greed Index API (free) |
| **ML Engine** | Python 3.11 + XGBoost + Flask |
| **ML Libraries** | pandas, scikit-learn, imbalanced-learn, numpy, ta |
| **Primary DB** | MongoDB (trades, signals, candles) |
| **Cache** | Redis (live candle buffer, signal state) |
| **Frontend** | React 18 + Vite |
| **Charts** | TradingView Lightweight Charts |
| **Scheduler** | node-cron (weekly retraining job) |
| **Job Queue** | Bull (order management queue) |
| **Process Manager** | PM2 (production) |
| **Hosting** | DigitalOcean Singapore VPS |
| **Alerts** | Telegram Bot API |
| **Auth** | dotenv (.env — keys never hardcoded) |
| **Containerization** | Docker + docker-compose |

---

## 📡 APIs Used

| API | Purpose | Cost |
|-----|---------|------|
| Binance Spot REST | OHLCV data, place/cancel orders, balances | Free |
| Binance WebSocket | Real-time candle stream | Free |
| Binance Futures REST | Open Interest + Funding Rate (read only) | Free |
| Taapi.io Pro | 200+ indicators, 3 symbols/call | ₹599/mo |
| Fear & Greed Index | `api.alternative.me/fng` — macro sentiment | Free |
| Telegram Bot API | Trade notifications + alerts | Free |
| Binance Testnet | Paper trading environment | Free |
| CryptoCompare News API | News keyword veto filter (Feature 6) | Free tier |

**Total monthly API cost: ₹599**

---

## 💻 Dashboard Layout

```
┌─────────────────────────────────────────────────────────────┐
│  🌌 NOVAPULSE    BTCUSDT  ETHUSDT  SOLUSDT   Daily: +1.24% │
├──────────────────────────┬──────────────────────────────────┤
│                          │  SIGNAL PANEL                    │
│   CANDLESTICK CHART      │  RSI:  42       ✅ Oversold      │
│   (TradingView)          │  EMA:  9 > 21   ✅ Bullish cross │
│                          │  MACD:          ✅ Bullish        │
│   ▲ BUY signal markers   │  OI:   Rising   ✅ Long buildup  │
│   ▼ SELL signal markers  │  F&G:  28 Fear  ✅ Buy zone      │
│   ─ EMA overlays         │  ML Score:      0.74 ✅          │
│                          │  Signal:        🟢 BUY           │
├──────────────────────────┴──────────────────────────────────┤
│  OPEN ORDERS                                                │
│  BTC  BUY  Limit  $84,200  0.001 BTC  Filled  [Cancel]     │
├─────────────────────────────────────────────────────────────┤
│  TRADE HISTORY                    RISK METER               │
│  BTC  +0.94%  ETH  -0.42%        ▓▓▓▓░░░░ 1.24% / 2.0%   │
│  SOL  +1.10%  BTC  +0.87%        ✅ Trading Active         │
└─────────────────────────────────────────────────────────────┘
```

---

## 📦 Installation

### Prerequisites
- Node.js v20+
- Python 3.11+
- MongoDB
- Redis
- Binance Testnet API Key

### Clone & Setup

```bash
git clone https://github.com/yourname/novapulse.git
cd novapulse
```

### Backend
```bash
npm install
cp .env.example .env
# Fill in your API keys in .env
npm run dev
```

### ML Service
```bash
cd ml-service
pip install -r requirements.txt
python app.py
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Docker (All services)
```bash
docker-compose up -d
```

---

## 🔐 Environment Variables

```env
# ─── App ─────────────────────────────────────────────────
NODE_ENV=development                         # development | production  (controls httpOnly cookie secure flag)

# ─── Binance ───────────────────────────────────────────────
BINANCE_ENV=testnet                          # testnet | live  (Feature 1 — switches all Spot endpoints)
BINANCE_API_KEY=your_testnet_api_key
BINANCE_SECRET_KEY=your_testnet_secret_key
BINANCE_BASE_URL=https://testnet.binance.vision   # auto-set by BINANCE_ENV; shown for clarity
BINANCE_FUTURES_URL=https://fapi.binance.com      # ⚠️ NOTE: Binance Futures has NO public testnet.
                                                   # OI + funding data always comes from the LIVE Futures
                                                   # market, even during Spot Testnet paper trading.
                                                   # This is intentional (read-only). Be aware that live
                                                   # Futures OI signals may behave differently from what
                                                   # Testnet Spot fills would see in production.

# ─── Taapi.io ──────────────────────────────────────────────
TAAPI_SECRET=your_taapi_secret_key

# ─── Telegram ──────────────────────────────────────────────
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# ─── Database ──────────────────────────────────────────────
MONGODB_URI=mongodb://localhost:27017/novapulse
REDIS_URL=redis://localhost:6379

# ─── ML Service ────────────────────────────────────────────
ML_SERVICE_URL=http://localhost:5001

# ─── Auth & Security (Feature 7) ────────────────────────────────
DASHBOARD_PASSWORD=your_strong_dashboard_password   # hashed with bcrypt on first boot
JWT_SECRET=your_random_256bit_secret                # openssl rand -hex 32
CORS_ORIGIN=https://your-vps-domain.com             # also allows localhost:5173 in dev

# ─── Risk Config ───────────────────────────────────────────
MAX_DAILY_DRAWDOWN=2
MAX_OPEN_POSITIONS=3
MAX_CAPITAL_PER_TRADE=20
ML_CONFIDENCE_THRESHOLD=0.72
TAKE_PROFIT_PCT=1.0
STOP_LOSS_PCT=0.5
```

---

## 🗓️ Build Roadmap

| Phase | Week | Feature | Milestone |
|-------|------|---------|-----------|
| **1** | 1–2 | F1 | Data pipeline — Binance WebSocket, candle buffer, MongoDB |
| **2** | 3 | F2–F3 | Indicator engine + OI + Funding Rate integration |
| **3** | 4 | F4–F5 | Sentiment (Fear & Greed) + Taapi.io Pro bulk calls |
| **4** | 5 | F6 | Signal confluence engine (Layers 1–4) |
| **5** | 6 | F7 | Auth & Security — JWT, CORS, login, Socket.io protection |
| **6** | 7 | F8 | Order Manager — place, track, cancel limit orders, OCO |
| **7** | 8–9 | F9 | ML Service — collect data, train XGBoost, integrate Layer 5 |
| **8** | 10 | F10 | Risk Manager — daily/weekly halt, position sizing, P&L |
| **9** | 11 | F11 | React dashboard — charts, signals, orders, P&L |
| **10** | 12 | F12 | Telegram Alerts — trade open/close/halt/summary notifications |
| **11** | 13–14 | F13 | Deployment — VPS, PM2, Docker, Nginx, SSL, monitoring |
| **12** | 15 | F14 | Backtesting engine — validate strategy, must pass before live |
| **13** | 16–17 | — | Full testnet paper trading + strategy tuning (2 weeks minimum) |
| **14** | 18 | — | Go live with small capital (₹5,000–10,000) |
| **15** | 19+ | — | Monitor weekly, retrain model, scale capital gradually |

---

## 📡 Socket.io Event Schema

> **Canonical event name registry.** Every backend `emit()` and every frontend `socket.on()` must use these exact names. Both sides are developed across multiple features — a mismatch here causes silent data loss with no error thrown.

| Event Name | Direction | Payload Shape | Emitted By | Consumed By |
|---|---|---|---|---|
| `candle:update` | Server → Client | `{ symbol, open, high, low, close, volume, timestamp, isClosed }` | `binance.js` on kline event | `Chart.jsx` |
| `signal:buy` | Server → Client | `{ symbol, timestamp, layer1, layer2, layer3, layer4, layer5, mlConfidence, finalSignal: 'BUY' }` | `signal.js` | `SignalPanel.jsx`, `Chart.jsx` (marker) |
| `signal:sell` | Server → Client | `{ symbol, timestamp, layer1, layer2, layer3, layer4, layer5, mlConfidence, finalSignal: 'SELL' }` | `signal.js` | `SignalPanel.jsx`, `Chart.jsx` (marker) — **dashboard only, never passed to Order Manager** |
| `signal:neutral` | Server → Client | `{ symbol, timestamp, reason }` | `signal.js` | `SignalPanel.jsx` |
| `order:opened` | Server → Client | `{ symbol, orderId, side: 'BUY', price, quantity, status: 'PENDING', timestamp }` | `orderManager.js` | `OpenOrders.jsx` |
| `order:filled` | Server → Client | `{ symbol, orderId, filledPrice, filledQty, tpOrderId, slOrderId }` | `orderManager.js` | `OpenOrders.jsx`, `TradeHistory.jsx` |
| `order:cancelled` | Server → Client | `{ symbol, orderId, reason }` | `orderManager.js` | `OpenOrders.jsx` |
| `trade:closed` | Server → Client | `{ symbol, entryPrice, exitPrice, pnlPct, pnlUsdt, status: 'CLOSED_TP'\|'CLOSED_SL', duration }` | `orderManager.js` | `TradeHistory.jsx`, `RiskPanel.jsx` |
| `pnl:update` | Server → Client | `{ dailyPnlPct, dailyPnlUsdt, weeklyPnlPct, openPositions, tradingHalted: boolean }` | `riskManager.js` | `RiskPanel.jsx`, `Navbar.jsx` |
| `risk:halted` | Server → Client | `{ reason, dailyPnlPct, timestamp }` | `riskManager.js` | `RiskPanel.jsx`, `Navbar.jsx` |
| `oi:update` | Server → Client | `{ symbol, oiDelta1h, oiDeltaPct, fundingRate, longShortRatio, timestamp }` | `oi.js` | `OIPanel.jsx` |
| `sentiment:update` | Server → Client | `{ value, classification, timestamp }` | `sentiment.js` | `SentimentBar.jsx` |

**Implementation rules:**
1. All emits go through `socket/emitter.js` — never call `io.emit()` directly from service files; import and call `emitter.emit(eventName, payload)` instead
2. `useSocket.js` subscribes to **all** events in this table on mount; components receive data via React state/context updated by the hook
3. All payload fields must be serialisable to JSON — no Mongoose documents, no `Date` objects (use `.toISOString()`)
4. If a payload field is unavailable, send `null` — the frontend must handle `null` gracefully; never omit a documented field

---

## 🧩 Features & Tasks

### Feature 0 — server.js Bootstrap
> Wire all services together. This is the assembly step — all other features build isolated modules; Feature 0 defines the startup sequence and the glue that connects them.

> **Build order dependency:** Complete Features 1–10 before implementing this file. Feature 0 imports from every service; attempting to write it earlier produces a file full of `require()` calls to files that do not exist yet.

#### Startup Sequence (implement in this exact order)

- [ ] **[CRITICAL — Startup Order]** Load environment variables first (`config/env.js`) — must be the absolute first line executed before any other `require()`; any service that reads `process.env` at module load time will get `undefined` if `env.js` runs after them
- [ ] **[CRITICAL — Startup Order]** Connect to MongoDB with retry (`mongoose.connect()` from Feature 1) — wait for connection before continuing; all service modules that reference Mongoose models at startup will fail if MongoDB is not ready
- [ ] **[CRITICAL — Startup Order]** Connect to Redis (`ioredis` client from Feature 1) — wait for `ready` event; Redis is required by the candle buffer seed and every subsequent service
- [ ] **[CRITICAL — Startup Order]** Fetch and cache `exchangeInfo` per symbol in Redis (`binance.js` — from Feature 1) — required by `orderManager.js` before any order can be placed
- [ ] **[CRITICAL — Startup Order]** Seed Redis candle buffer from MongoDB — call the seed function from Feature 1 for each symbol in `SYMBOLS`; gate behind `bufferReady` flag
- [ ] **[CRITICAL — Startup Order]** Validate Binance API key — call `GET /api/v3/account` (Feature 1); fatal exit on 401
- [ ] **[CRITICAL — Startup Order]** Run crash recovery — call `orderManager.reconcileOpenPositions()` (Feature 13) before opening any WebSocket streams; resolves any positions that filled during downtime
- [ ] **[CRITICAL — Startup Order]** Open Binance User Data Stream — call `POST /api/v3/userDataStream` and connect `listenKey` WebSocket (Feature 8)
- [ ] **[CRITICAL — Startup Order]** Open Binance market data WebSocket streams — connect `btcusdt@kline_15m`, `ethusdt@kline_15m`, `solusdt@kline_15m` (Feature 1); signal pipeline begins here
- [ ] **[CRITICAL — Startup Order]** Start all `node-cron` jobs in this order:
  - OI fetch every 5 minutes (Feature 3)
  - Sentiment fetch every hour (Feature 4)
  - User Data Stream keepalive every 30 minutes (Feature 8)
  - News filter fetch every 15 minutes (Feature 6)
  - Daily P&L reset at `0 0 * * *` (Feature 10)
  - Weekly P&L reset at `0 0 * * 1` (Feature 10)
  - Weekly ML retrain at `0 2 * * 0` (Feature 9)
- [ ] Log startup summary line via Winston: `NovaPulse ONLINE | Env: {NODE_ENV} | Binance: {BINANCE_ENV} | Pairs: BTC/ETH/SOL | Buffer: READY`

#### Express App Setup

- [ ] **[CRITICAL — Middleware Order]** Apply middleware in this exact order — order matters in Express:
  1. `helmet()` — security headers (before any route)
  2. `cors({ origin: [...], credentials: true })` — allow frontend (Feature 7)
  3. `express.json()` — parse JSON request bodies
  4. `cookieParser()` — parse httpOnly cookie for JWT (Feature 7)
- [ ] **[CRITICAL — Route Mount Order]** Mount routes in this order:
  1. `GET /health` — unauthenticated health check (inline, no router file needed)
  2. `app.use('/api', require('./routes/auth'))` — login/logout/me (no auth middleware)
  3. `app.use('/api', require('./routes/trades'))` — protected by `auth.js`
  4. `app.use('/api', require('./routes/balance'))` — protected by `auth.js`
  5. `app.use('/api', require('./routes/signals'))` — protected by `auth.js`
  6. `app.use('/api', require('./routes/performance'))` — protected by `auth.js`
  7. `app.use('/api', require('./routes/control'))` — protected by `auth.js`
  8. `app.use('/api', require('./routes/backtest'))` — protected by `auth.js`
- [ ] **[CRITICAL — Socket.io Init]** Attach Socket.io to the HTTP server (`socket/emitter.js`) — must be done after `app` is created but before `server.listen()`; apply JWT middleware `io.use()` (Feature 7); export `io` from emitter for use by service modules
- [ ] **[CRITICAL — Graceful Shutdown]** Register `SIGTERM` and `SIGINT` handlers (Feature 13) — must be registered before `server.listen()` so they are active from the first millisecond of the process

---

### Feature 1 — Data Pipeline
> Connect to Binance, stream live candles, store historical data

- [ ] Initialize Node.js project, install dependencies (`express`, `ws`, `axios`, `dotenv`, `mongoose`, `ioredis`, `bull`, `node-cron`, `winston`, `cookie-parser`)
  > ⚠️ **`cors` is intentionally excluded here.** It is installed and configured in Feature 7 alongside its security options. Installing it now without configuration leads developers to add an open `app.use(cors())` with no origin restriction — defeating the CORS security model. See G4 fix.
- [ ] **[CRITICAL — .env.example]** Create `.env.example` at project root — contains every key from the Environment Variables section of this README with placeholder values (`your_value_here`); commit `.env.example` to git, **never commit `.env`**; add `.env` to `.gitignore` immediately; a developer cloning this repo must be able to see all required variables from `.env.example` without reading further
- [ ] **[CRITICAL — docker-compose.yml]** Create `docker-compose.yml` at project root — define two services: `mongodb` (image: `mongo:6`, port 27017, named volume `mongo_data`) and `redis` (image: `redis:7-alpine`, port 6379, command: `redis-server --appendonly yes --appendfsync everysec`); verify `docker-compose up -d` starts both services correctly before proceeding to any other feature
- [ ] **[NOTABLE — ESLint/Prettier]** Initialize linting: `npm install -D eslint prettier eslint-config-prettier`; create `.eslintrc.json` (Node.js env, `no-unused-vars: error`, `no-console: warn`) and `.prettierrc` (`singleQuote: true, semi: true, printWidth: 100`); add `"lint": "eslint ."` and `"format": "prettier --write ."` npm scripts; also create `ml-service/.flake8` (max-line-length = 100) and run `pip install flake8 black` in the Python venv; consistent style prevents subtle bugs in long trading sessions
- [ ] **[CRITICAL — constants.js]** Create `config/constants.js` — single source of truth for all trading configuration and Redis key names; every service imports from here, nothing is hardcoded:
  ```js
  // Trading config
  module.exports.SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  module.exports.CANDLE_INTERVAL = '15m';
  module.exports.ML_THRESHOLD = 0.72;
  module.exports.TAKE_PROFIT_PCT = 0.01;          // 1.0%
  module.exports.STOP_LOSS_PCT = 0.005;            // 0.5%
  module.exports.OI_DELTA_THRESHOLD = 0.02;        // 2%
  module.exports.FUNDING_RATE_THRESHOLD = 0.001;   // 0.1%
  module.exports.FEAR_GREED_BUY_MAX = 45;
  module.exports.FEAR_GREED_VETO = 80;
  module.exports.MAX_OPEN_POSITIONS = 3;
  module.exports.MAX_CAPITAL_PCT = 0.20;           // 20% per trade
  module.exports.ORDER_TIMEOUT_MS = 900000;        // 15 minutes
  module.exports.CANDLE_BUFFER_MIN = 50;           // min candles before signals
  module.exports.CANDLE_BUFFER_MAX = 200;

  // Redis key registry — ALWAYS use these constants; never inline key strings
  const REDIS_KEYS = {
    CANDLE_BUFFER:       (symbol) => `candle_buffer:${symbol}`,
    EXCHANGE_INFO:       (symbol) => `exchangeInfo:${symbol}`,
    SIGNAL_LOCK:         (symbol) => `signal_lock:${symbol}`,
    POSITION:            (symbol) => `position:${symbol}`,
    OI:                  (symbol) => `oi:${symbol}`,
    TAAPI:               (symbol) => `taapi:${symbol}`,
    INDICATORS:          (symbol) => `indicators:${symbol}`,
    DAILY_PNL:           'daily_pnl',
    WEEKLY_PNL:          'weekly_pnl',
    TRADING_HALTED:      'TRADING_HALTED',
    WEEKLY_REVIEW_FLAG:  'WEEKLY_REVIEW_FLAG',
    IP_BANNED:           'IP_BANNED',
    NEWS_VETO:           'NEWS_VETO',
    SENTIMENT:           'sentiment',
    BUFFER_READY:        (symbol) => `buffer_ready:${symbol}`,
  };
  module.exports.REDIS_KEYS = REDIS_KEYS;
  ```
  Having this registry means a key collision or typo is caught in one file, not discovered at 2 AM during a live session. Every feature that reads/writes Redis must import `REDIS_KEYS` from this file.
- [ ] Create `.env` config loader (`config/env.js`)
- [ ] Set up structured logging with **Winston** — log levels (info, warn, error), file + console transports, daily log rotation
- [ ] Build Binance WebSocket client — connect to `btcusdt@kline_15m`, `ethusdt@kline_15m`, `solusdt@kline_15m`
- [ ] Parse WebSocket candle payload — extract OHLCV + `x` (candle closed flag)
- [ ] **[CRITICAL — Cold Start]** On server boot, seed Redis candle buffer from MongoDB — fetch last 200 closed candles per pair before opening WebSocket
- [ ] **[CRITICAL — Cold Start]** Gate all signal computation behind a `bufferReady` flag — do not emit signals until buffer has ≥ 50 candles per pair
- [ ] Maintain in-memory candle buffer (last 200 candles per pair) using Redis
- [ ] **[CRITICAL — exchangeInfo]** On server boot fetch `GET /api/v3/exchangeInfo` once and cache per-symbol rules in Redis: `tickSize` (price precision), `stepSize` (quantity precision), `minNotional` (minimum order value) — required by Order Manager before any order can be placed
- [ ] **[CRITICAL — exchangeInfo]** Implement `roundToTickSize(price, tickSize)` and `roundToStepSize(qty, stepSize)` helper functions — every TP, SL, and order quantity must pass through these before being sent to Binance or `FILTER_FAILURE` will be returned
- [ ] Build Binance REST client — fetch historical OHLCV via `GET /api/v3/klines`
- [ ] Paginate historical data fetch (1000 candles/request, go back 6 months)
- [ ] Define MongoDB `Candle` schema — symbol, interval, open, high, low, close, volume, timestamp
- [ ] **[NOTABLE — MongoDB Retry]** Wrap `mongoose.connect()` in retry logic with exponential backoff — attempt 5 times with delays 1s, 2s, 4s, 8s, 16s before fatal exit; MongoDB on a fresh VPS may take several seconds to fully start after Docker; without retry, the Node.js process crashes immediately on a cold container start; log each retry attempt with Winston
- [ ] **[NOTABLE]** Create MongoDB index on `{ symbol, timestamp }` for `Candle` collection — prevents query degradation at scale
- [ ] Save closed candles to MongoDB on every candle close event
- [ ] **[CRITICAL — Rate Limits]** Create shared Binance weight tracker in Redis — increment on every REST call, enforce 1200 weight/min ceiling, implement exponential backoff on 429 response
- [ ] **[CRITICAL — HTTP 418 Ban Detection]** Handle Binance HTTP 418 responses — Binance issues a 418 (IP ban) when a client continues sending requests after receiving 429 (too many requests); add a dedicated 418 handler in the Binance REST client: immediately stop ALL outgoing REST requests, set `IP_BANNED=true` flag in Redis with a TTL matching the `Retry-After` header, send Telegram alert `⛔ NOVAPULSE IP BANNED by Binance — all requests paused for {seconds}s`, log `FATAL: Binance 418 IP ban` via Winston; resume automatically after the ban expires; this is the most severe Binance API violation — continued requests during a ban extend the ban duration exponentially
- [ ] Handle WebSocket reconnection logic (auto-reconnect on disconnect)
- [ ] **[NOTABLE — WebSocket Ping Keepalive]** Send a `ws.ping()` to the Binance stream every 3 minutes using `setInterval` — Binance closes streams with no activity after 60 minutes, but network proxies (Nginx, corporate firewalls) commonly kill idle TCP connections after 5–10 minutes; set a pong timeout of 10 seconds — if no `pong` event is received after sending `ping`, treat the connection as a zombie and force-reconnect immediately; log `WS PING TIMEOUT — forcing reconnect` via Winston
- [ ] **[NOTABLE — Gap Candle Detection]** On WebSocket reconnect, compare the timestamp of the last stored candle in Redis against the current server time — if the gap is greater than one candle interval (15 minutes), call the Binance REST `GET /api/v3/klines` endpoint to backfill the missing candles and re-seed the buffer before resuming signal computation; without this, a 20-minute outage leaves the candle buffer with a timestamp gap that corrupts indicator values (EMA, MACD) computed on the incomplete series
- [ ] **[CRITICAL — Testnet → Live]** Add `BINANCE_ENV=testnet|live` flag in `.env` — swap base URL and WebSocket endpoint from a single config file, no code changes needed to go live
- [ ] **[NOTABLE — API Key Validation]** On server startup, before opening any WebSocket streams, call `GET /api/v3/account` with the configured API key — if response is 401 or signature error, log `FATAL: Binance API key invalid or missing permissions` and exit with code 1; this prevents a silent failure where the bot starts, opens WebSockets correctly, but all order placement silently fails with auth errors hours later during the first trade signal
- [ ] Log all WebSocket events (connect, disconnect, error) via Winston
- [ ] Write unit test — verify candle parsing is correct

---

### Feature 2 — Indicator Engine
> Compute RSI, EMA, MACD, Bollinger Bands on live candle data

- [ ] Install `technicalindicators` npm package
- [ ] Build `services/indicators.js` module
- [ ] **[CRITICAL — Cold Start]** Guard every indicator computation — return `null` if candle count < minimum period (e.g. RSI needs 14, EMA50 needs 50); never emit a signal on insufficient data
- [ ] Implement RSI (14) computation on closing prices
- [ ] Implement EMA 9, EMA 21, EMA 50 computation
- [ ] Implement MACD (12, 26, 9) — line, signal, histogram
- [ ] Implement Bollinger Bands (20, 2) — upper, middle, lower, bandwidth
- [ ] Implement Volume Ratio vs 20-candle average
- [ ] Implement EMA crossover detection (9 crosses 21, 21 crosses 50)
- [ ] Implement BB squeeze detection (bandwidth below 20-period minimum)
- [ ] Trigger full indicator recomputation on every candle close
- [ ] Store computed indicator values in Redis (latest values per pair)
- [ ] Write unit tests for each indicator with known input/output pairs

---

### Feature 3 — Open Interest + Funding Rate
> Fetch OI and funding data from Binance Futures (read-only)

- [ ] Build `services/oi.js` module
- [ ] Fetch current OI via `GET /fapi/v1/openInterest` per pair
- [ ] Fetch OI history via `GET /futures/data/openInterestHist` (5m interval)
- [ ] Compute OI delta — % change over last 1 candle and last 4 candles
- [ ] Fetch current funding rate via `GET /fapi/v1/fundingRate`
- [ ] Fetch Long/Short ratio via `GET /futures/data/topLongShortAccountRatio`
- [ ] Define thresholds: OI rising = delta > +2%, extreme funding = > +0.1%
- [ ] Schedule OI fetch every 5 minutes using `node-cron`
- [ ] Cache OI values in Redis with TTL of 6 minutes
- [ ] Log OI changes with timestamps to MongoDB

---

### Feature 4 — Sentiment Integration
> Fetch Fear & Greed Index for macro market context

- [ ] Build `services/sentiment.js` module
- [ ] Fetch Fear & Greed from `https://api.alternative.me/fng/`
- [ ] Parse value + classification (Extreme Fear / Fear / Neutral / Greed / Extreme Greed)
- [ ] Schedule fetch once every hour using `node-cron`
- [ ] Cache value in Redis with TTL of 65 minutes
- [ ] Define trading rule: block new BUY signals when FGI > 80

---

### Feature 5 — Taapi.io Integration
> Fetch second-opinion indicators from Taapi.io Pro

- [ ] Sign up for Taapi.io Pro (₹599/mo) — get API secret
- [ ] Build `services/taapi.js` module
- [ ] Build bulk request payload — fetch RSI, MACD, EMA for 3 pairs in 1 call
- [ ] Parse and normalize Taapi response format
- [ ] Handle Taapi rate limit (150,000 calls/day — ~600/day used)
- [ ] On Taapi API error → fallback to self-computed Layer 1 indicators
- [ ] **[NOTABLE — Taapi Fallback Test]** Write an explicit test for the Taapi fallback path: (1) temporarily set `TAAPI_SECRET` to an invalid value in `.env`; (2) start the server and wait for a candle close; (3) verify in Winston logs that the line `Taapi fallback: using Layer 1 indicators` appears and NO signal is suppressed; (4) verify the signal engine still emits a signal using only Layer 1 data (Layer 3 abstains); this path is critical because Taapi downtime during a live trading session must not halt the entire bot
- [ ] Cache Taapi results in Redis per pair per candle close
- [ ] Log Taapi signal agreement/disagreement with Layer 1 for analysis

---

### Feature 6 — Signal Confluence Engine
> Combine all layers into a single signal decision

- [ ] Build `services/signal.js` module
- [ ] Define signal scoring per layer (each layer votes: +1 bullish / -1 bearish / 0 neutral)
- [ ] Layer 1 vote: EMA cross + RSI + MACD + BB all agree = +1
- [ ] Layer 2 vote: OI rising + price rising = +1; extreme funding = veto
- [ ] Layer 3 vote: Taapi confirms Layer 1 = +1
- [ ] Layer 4 vote: FGI < 45 = +1; FGI > 80 = veto (block trade)
- [ ] **[NOTABLE — News Filter]** Integrate CryptoCompare News API (free) — fetch `https://min-api.cryptocompare.com/data/v2/news/?lang=EN` every 15 minutes via `node-cron`; cache the response in Redis with TTL of 16 minutes
  - **Keyword veto list**: `FOMC`, `CPI`, `inflation`, `SEC`, `lawsuit`, `hack`, `exploit`, `liquidation`, `bankruptcy`, `ban`, `regulation`, `emergency` (case-insensitive match against article title + body)
  - **30-minute window logic**: on candle close, check if any article with a matching keyword was published within the last 30 minutes (compare article `publishedAt` Unix timestamp against `Date.now() - 1800000`)
  - **Veto behavior**: if match found, set `NEWS_VETO=true` in Redis with TTL of 30 minutes; signal engine reads this flag and blocks new BUY signals during the window; log the triggering article title via Winston
  - **API-down fallback**: if the CryptoCompare request fails (network error or non-200 response), log `WARN: CryptoCompare news fetch failed — news filter bypassed for this candle` and allow the signal through (fail-open); do NOT block trades indefinitely on a transient news API outage
- [ ] Layer 5 vote: ML confidence > 0.72 = +1 (added in Feature 8)
- [ ] Final signal: all non-veto layers must agree for BUY/SELL
- [ ] **[NOTABLE — Deduplication]** Set Redis key `signal_lock:{symbol}` with TTL = candle interval (15m) on signal emit — skip duplicate signal if lock exists for that pair on that candle
- [ ] **[CRITICAL — SELL Routing]** **SELL confluence signals are emitted to the dashboard only — never passed to the Order Manager.** NovaPulse operates Spot long-only: there is no mechanism to short-sell; a SELL confluence means "do not open a new BUY position" (equivalent to staying flat). The only SELL orders in the system are the TP and SL limit sells placed automatically after a BUY fill by `orderManager.js`. Any developer who routes a SELL signal to `orderManager.js` will create a dead code path that attempts to sell an asset that was never bought, producing `INSUFFICIENT_BALANCE` errors from Binance.
- [ ] Emit BUY signal to Order Manager (`orderManager.placeLimitBuyOrder()`); emit SELL signal to Socket.io dashboard event `signal:sell` only — no order placed
- [ ] **[CRITICAL — Signal Schema]** Define `models/Signal.js` Mongoose schema **before** attempting to store any signal:
  ```js
  const SignalSchema = new Schema({
    symbol:       { type: String, required: true },
    timestamp:    { type: Date, required: true },
    layer1Score:  Number,   // +1 / -1 / 0
    layer2Score:  Number,
    layer3Score:  Number,
    layer4Score:  Number,
    layer5Score:  Number,
    mlConfidence: Number,   // 0.0 – 1.0, null if ML not yet trained
    finalSignal:  { type: String, enum: ['BUY', 'SELL', 'NEUTRAL'], required: true },
    vetoed:       { type: Boolean, default: false },
    vetoReason:   String,   // 'NEWS_FILTER' | 'EXTREME_GREED' | 'EXTREME_FUNDING' | null
  }, { timestamps: true });
  SignalSchema.index({ symbol: 1, timestamp: -1 });
  ```
- [ ] Store signal in MongoDB `Signal` schema (pair, timestamp, scores per layer, final signal)
- [ ] **[NOTABLE]** Verify compound index on `{ symbol: 1, timestamp: -1 }` is applied to the `Signal` collection — run `db.signals.getIndexes()` in mongo shell to confirm; without it, `GET /api/signals` queries on large collections will full-scan
- [ ] **[CRITICAL — /api/signals Route]** Implement `routes/signals.js` — consumed by `SignalPanel.jsx` to populate the live signal history:
  - `GET /api/signals?symbol=BTCUSDT&limit=20` — query `Signal` collection sorted by `timestamp` descending, return last N entries for the given symbol
  - `GET /api/signals/latest?symbol=BTCUSDT` — return the single most recent signal per pair (used by `SignalPanel.jsx` to display current layer scores)
  - Protect both routes with `auth.js` middleware
  - Mount in `server.js` as `app.use('/api', require('./routes/signals'))` (see Feature 0 for mount order)
- [ ] Push signal via Socket.io to React dashboard via `emitter.emit('signal:buy' | 'signal:sell' | 'signal:neutral', payload)` using event names from the Socket.io Event Schema section

---

### Feature 7 — Auth & Security
> Protect the platform from unauthorized access; set up CORS from this feature onward so the React frontend can reach the backend from day one

- [ ] Install `jsonwebtoken`, `bcryptjs`, `express-rate-limit`, `helmet`, `cookie-parser`, `cookie`, `cors`
- [ ] **[CRITICAL — CORS]** Configure CORS immediately in `server.js`: `app.use(cors({ origin: [process.env.CORS_ORIGIN, 'http://localhost:5173'], credentials: true }))` — **must be added in this feature, not deferred to later**; developers hit CORS errors from Feature 1 day one when the React dev server (port 5173) first calls the backend (port 3000); `credentials: true` is required so the browser automatically sends the httpOnly JWT cookie with every request
- [ ] **[CRITICAL — Backend Auth Routes]** Create `backend/routes/auth.js` — register `POST /api/auth/login`, `POST /api/auth/logout`, and `GET /api/auth/me` routes; mount in `server.js` before any other route
- [ ] **[CRITICAL — Backend Auth Routes]** `POST /api/auth/login` handler: read `DASHBOARD_PASSWORD` from `.env`, compare with `bcrypt.compare()`, on success sign and return JWT (`jsonwebtoken.sign`) with 24h expiry in cookie with options: `{ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 86400000 }` — **do NOT use `secure: true` hardcoded** — the `secure` flag causes browsers to reject cookies over plain HTTP; `http://localhost` is HTTP, so `secure: true` will silently break auth during development; use `process.env.NODE_ENV === 'production'` so HTTPS is enforced only in production
- [ ] **[CRITICAL — Backend Auth Routes]** `GET /api/auth/me` handler: protected by `auth.js` middleware — returns `{ authenticated: true, user: req.user }` on valid JWT, 401 on invalid; **this is the only mechanism React's `PrivateRoute` can use to verify session state** since JS cannot read the httpOnly cookie
- [ ] **[CRITICAL — Backend Auth Routes]** `POST /api/auth/logout` handler: clear the cookie and return 200
- [ ] **[CRITICAL — Backend Auth Middleware]** Build `middleware/auth.js` — extract JWT from `httpOnly` cookie, verify with `jsonwebtoken.verify()`, attach decoded payload to `req.user`; on failure return 401
- [ ] **[CRITICAL — Backend Auth Middleware]** Apply `auth.js` middleware to all `router` instances in `routes/trades.js`, `routes/balance.js`, `routes/signals.js`, `routes/performance.js`, `routes/control.js`, `routes/backtest.js` — backtest endpoint triggers a full MongoDB + CPU-intensive candle replay and must not be publicly accessible
- [ ] **[CRITICAL — Socket.io Server JWT]** In `socket/emitter.js`, add Socket.io `io.use()` middleware — install `cookie` npm package, parse `socket.handshake.headers.cookie` to extract the JWT (browser automatically sends httpOnly cookies with the Socket.io upgrade request), call `jsonwebtoken.verify()`; reject connection with `next(new Error('unauthorized'))` if invalid; **do not rely on `socket.handshake.auth.token` — client JS cannot set it since the token lives in an httpOnly cookie**
- [ ] Apply `helmet()` to all Express routes — sets secure HTTP headers
- [ ] Apply `express-rate-limit` to `/api/auth/login` — max 10 attempts/15 min (brute-force protection)
- [ ] Store `DASHBOARD_PASSWORD` (hashed with bcrypt) and `JWT_SECRET` in `.env` — never in code
- [ ] Security audit: confirm no API keys or secrets appear in Winston output at `info` level or above

---

### Feature 8 — Order Manager
> Place, track, and cancel limit orders on Binance

- [ ] Build `services/orderManager.js` module
- [ ] Implement HMAC SHA256 request signing for Binance private endpoints
- [ ] **[CRITICAL — User Data Stream]** On startup call `POST /api/v3/userDataStream` to obtain `listenKey`
- [ ] **[CRITICAL — User Data Stream]** Schedule `PUT /api/v3/userDataStream` keepalive ping every **30 minutes** via `node-cron` — listen key expires after 60 min without ping, silently killing fill detection
- [ ] **[CRITICAL — User Data Stream]** On WebSocket disconnect, re-create listen key and reconnect — reconcile any missed fills via `GET /api/v3/myTrades` on reconnect
- [ ] **[CRITICAL — PRICE_FILTER]** Round all limit prices (entry, TP, SL) to symbol `tickSize` using `roundToTickSize()` from Feature 1 before every `POST /api/v3/order` — raw floats like `84200.123456` will be rejected by Binance with `FILTER_FAILURE: PRICE_FILTER`
- [ ] **[CRITICAL — LOT_SIZE]** Round all order quantities to symbol `stepSize` using `roundToStepSize()` from Feature 1 — `20% of balance / price` will be a raw float; Binance rejects quantities not matching `stepSize` increments
- [ ] **[CRITICAL — LOT_SIZE]** After rounding quantity, verify `roundedQty * price >= minNotional` — if below minimum notional, skip the trade and log `SKIPPED: below minNotional`
- [ ] Implement `placeLimitBuyOrder(symbol, quantity, price)` — `POST /api/v3/order`
- [ ] **[CRITICAL — Partial Fill]** Handle `PARTIALLY_FILLED` order status — place TP/SL only on the **filled quantity**; cancel remainder of original buy order immediately
- [ ] **[CRITICAL — Partial Fill]** If partial fill quantity is below minimum notional value (check `exchangeInfo`), cancel both the order and any orphaned TP/SL orders
- [ ] On **full** fill confirmation → immediately place TP limit sell order (entry + 1%)
- [ ] On **full** fill confirmation → immediately place SL stop-limit order (entry - 0.5%)
- [ ] **[DESIGN NOTE — Why Not Native OCO Endpoint]** Binance provides `POST /api/v3/order/oco` which places a TP + SL pair atomically. NovaPulse does **not** use this endpoint for three reasons: (1) The native OCO requires `STOP_LOSS_LIMIT` order type which may not fill during flash crashes where price gaps below the limit; (2) The OCO endpoint cannot integrate with the 15-minute Bull timeout cancel job — if the BUY order is cancelled before fill, neither leg should be placed, which `order/oco` cannot handle; (3) Manual implementation allows correct partial-fill handling (place TP/SL only on actually filled quantity). The sibling-cancel pattern below replicates OCO behaviour with better control over all edge cases.
- [ ] **[CRITICAL — OCO Sibling Cancel]** Store `{ tpOrderId, slOrderId }` in Redis keyed by `position:{symbol}`
- [ ] **[CRITICAL — OCO Sibling Cancel]** On TP fill event → immediately call `cancelOrder(slOrderId)` before doing anything else
- [ ] **[CRITICAL — OCO Sibling Cancel]** On SL fill event → immediately call `cancelOrder(tpOrderId)` before doing anything else
- [ ] **[CRITICAL — OCO Race Condition]** On cancel response `ORDER_NOT_FOUND` (both fired near-simultaneously) → treat as already closed, log warning, do NOT re-place orders
- [ ] Implement `cancelOrder(symbol, orderId)` — `DELETE /api/v3/order`
- [ ] Implement `getOpenOrders(symbol)` — `GET /api/v3/openOrders`
- [ ] Auto-cancel unfilled buy orders after 15 minutes (using Bull job queue)
- [ ] **[CRITICAL — Order Timeout Guard]** Before executing the Bull cancel job, call `GET /api/v3/order` to check current order status — if status is `FILLED` or `PARTIALLY_FILLED`, abort the cancel and instead trigger the normal fill handler to place TP/SL; prevents incorrect state transition if order filled at minute 14:59
- [ ] **[NOTABLE — Bull Error Handling]** Register Bull job `failed` event handler — log failure with job ID, symbol, and error; send Telegram alert `⚠️ TIMEOUT JOB FAILED: {symbol} order {orderId} — manual check required`
- [ ] **[NOTABLE — Bull Error Handling]** Configure Bull job retry policy: `attempts: 3, backoff: { type: 'exponential', delay: 2000 }` — retries on Redis temporary unavailability
- [ ] **[NOTABLE — Bull Error Handling]** Register Bull job `stalled` event handler — log stalled job ID; a stalled job means Bull Redis backend lost the lock, treat the order as potentially unfilled and manually verify status
- [ ] Listen to Binance Order Update stream (`/ws/userDataStream`) for fill events
- [ ] Track order lifecycle: PENDING → PARTIALLY_FILLED → FILLED → TP_PLACED / SL_PLACED → CLOSED
- [ ] **[NOTABLE — Capital Sizing]** Fetch available USDT balance only (exclude locked/reserved funds) via `GET /api/v3/account` — filter `asset=USDT` and use `free` field, not `total`
- [ ] **[CRITICAL — Trade Schema]** Define `models/Trade.js` Mongoose schema **before** attempting to save any trade:
  ```js
  const TradeSchema = new Schema({
    symbol:        { type: String, required: true },
    side:          { type: String, default: 'BUY' },
    entryPrice:    { type: Number, required: true },
    exitPrice:     Number,
    quantity:      { type: Number, required: true },
    status:        { type: String, enum: ['OPEN','CLOSED_TP','CLOSED_SL','CANCELLED'], default: 'OPEN' },
    buyOrderId:    String,
    tpOrderId:     String,
    slOrderId:     String,
    bullJobId:     String,   // Bull timeout job ID — cancel on fill/close
    mlConfidence:  Number,
    pnlPct:        Number,
    pnlUsdt:       Number,
    openedAt:      { type: Date, default: Date.now },
    closedAt:      Date,
  }, { timestamps: true });
  TradeSchema.index({ symbol: 1, openedAt: -1 });
  TradeSchema.index({ status: 1, symbol: 1 });  // for reconciliation queries
  ```
- [ ] Save completed trade to MongoDB `Trade` schema
- [ ] Send Telegram alert on trade open and close
- [ ] **[CRITICAL — /api/trades Route]** Implement `routes/trades.js` — consumed by `TradeHistory.jsx`:
  - `GET /api/trades?symbol=BTCUSDT&limit=50` — query `Trade` collection with `status: { $in: ['CLOSED_TP','CLOSED_SL','CANCELLED'] }` sorted by `closedAt` descending; if `symbol` param omitted, return all pairs
  - `GET /api/trades/open` — query `status: 'OPEN'`; used by `OpenOrders.jsx` to populate active order table
  - `GET /api/trades/stats` — aggregate win rate, avg pnlPct, count per status; consumed by `RiskPanel.jsx`
  - Protect all routes with `auth.js` middleware
  - Mount in `server.js` as `app.use('/api', require('./routes/trades'))` (see Feature 0)
- [ ] **[CRITICAL — /api/balance Route]** Implement `routes/balance.js` — consumed by `RiskPanel.jsx`:
  - `GET /api/balance` — call Binance `GET /api/v3/account`, filter `balances` array for assets with `free > 0` or `locked > 0`; return `{ usdt: { free, locked }, btc: { free, locked }, eth: { free, locked }, sol: { free, locked } }`
  - Protect with `auth.js` middleware
  - Use the shared Binance weight tracker (Feature 1) — this endpoint consumes 10 weight units per call; do not call it on every React render; frontend should poll at most once every 30 seconds
  - Mount in `server.js` as `app.use('/api', require('./routes/balance'))` (see Feature 0)

---

### Feature 9 — ML Service (Python + XGBoost)
> Train and serve an ML model that scores signal confidence

- [ ] Set up Python 3.11 environment, install `xgboost`, `pandas`, `scikit-learn`, `imbalanced-learn`, `numpy`, `ta`, `flask`
- [ ] Build `data/collector.py` — fetch 6 months of OHLCV + OI history from Binance
- [ ] Build `data/features.py` — compute all 16 input features from raw data
- [ ] Label dataset: `1` if price moved +0.8% within next 4 candles, `0` otherwise
- [ ] **[NOTABLE — Class Imbalance]** Apply **SMOTE** (Synthetic Minority Oversampling) via `imbalanced-learn` on training set — `scale_pos_weight` alone produces poor recall on minority class
- [ ] Compare baseline (scale_pos_weight only) vs SMOTE — keep whichever has higher F1 score
- [ ] Build `model/train.py` — train XGBoost classifier with 5-fold cross-validation
- [ ] Target metrics: Precision > 0.65, Recall > 0.55, F1 > 0.60 on test set
- [ ] Save trained model to `model/novapulse_model.pkl` using `joblib`
- [ ] **[NOTABLE — Model Versioning]** Before overwriting `novapulse_model.pkl` during retrain, copy current model to `model/novapulse_model_v{YYYYMMDD_HHMMSS}.pkl`; after training, compare new model F1 on the validation set against the old model F1; if new F1 is lower, restore the backup automatically and send Telegram alert `⚠️ ML RETRAIN DEGRADED — rolled back (old F1: X.XX, new F1: X.XX)`; keep only the 2 most recent versioned backups to avoid disk bloat
- [ ] Build `model/evaluate.py` — confusion matrix, precision, recall, feature importance plot
- [ ] **[CRITICAL — ML Cold Start]** On `POST /predict`, check if `novapulse_model.pkl` exists — if not, return `{ score: 0.5, fallback: true }` instead of crashing; Node.js signal engine treats fallback as neutral (Layer 5 abstains)
- [ ] **[CRITICAL — ML Cold Start]** Add `/health` endpoint that returns model load status — Node.js checks this on startup and logs warning if model not ready
- [ ] Build `app.py` Flask server:
  - `POST /predict` — **validate input before inference**: check all 16 expected feature keys exist in request JSON; reject any value that is `null`, `NaN`, or non-numeric with a 400 response containing the invalid key names; only after full validation call `model.predict_proba()`; XGBoost silently produces nonsense scores on NaN inputs without raising an exception, which would generate false trade signals
  - `POST /retrain` — **do NOT run training synchronously**; spawn a background thread (`threading.Thread`) and immediately return `{ "status": "retraining_started" }` — training on 6 months of data takes several minutes and a synchronous handler will timeout Node.js axios calls or block the Flask worker
  - `GET /retrain/status` — returns `{ "status": "idle" | "running" | "completed" | "failed", "last_completed": timestamp, "last_f1": float }`
  - `GET /health` — health check + model load status
- [ ] Update `jobs/retrainJob.js` in Node.js — call `POST /retrain` (fire-and-forget, do not await result), then poll `GET /retrain/status` every 2 minutes until `status === "completed"` or `"failed"` before triggering A/B comparison
- [ ] After retrain, A/B compare new model vs current on last 2 weeks of signals — only replace if new model has higher F1
- [ ] **[CRITICAL — ML Bootstrap Gate]** Before starting paper trading (Phase 13), explicitly run the full ML pipeline to bootstrap the model:
  1. `cd ml-service && python data/collector.py` — fetches 6 months of OHLCV + OI history (takes ~5–10 minutes)
  2. `python data/features.py` — computes all 16 features and saves `data/features.csv`
  3. `python model/train.py` — trains XGBoost, prints metrics, saves `model/novapulse_model.pkl`
  4. Verify the model file exists: `ls -lh model/novapulse_model.pkl` — must be > 0 bytes
  5. Verify Flask health endpoint: `curl http://localhost:5001/health` — must return `{ "model_loaded": true }`
  **The bot must NOT enter paper trading with the ML cold-start fallback (`score: 0.5`) as the permanent state — the fallback is only for restart resilience, not a substitute for a trained model**

---

### Feature 10 — Risk Manager
> Enforce all risk rules, position sizing, daily halt

- [ ] Build `services/riskManager.js` module
- [ ] Track daily P&L in Redis (reset at 00:00 UTC)
- [ ] **[NOTABLE — Daily Reset Cron]** Add `node-cron` job with schedule `0 0 * * *` (every day 00:00 UTC) — delete `daily_pnl` Redis key and clear `TRADING_HALTED` flag; without this cron the daily halt set at -2% never lifts after midnight and the bot stays permanently paused
- [ ] Implement daily drawdown check: if P&L < -2% → set `TRADING_HALTED=true` in Redis
- [ ] **[CRITICAL — Concurrency Lock]** Implement atomic `canTrade()` using Redis `SET NX PX` (SET if Not eXists with TTL) — acquire lock before position count check, release after order placement; prevents two simultaneous signals both passing the "0 open positions" check
- [ ] **[CRITICAL — Concurrency Lock]** If lock acquisition fails (another signal is placing an order) → skip current signal, log `SKIPPED: order lock held`
- [ ] Implement position count check: block new trades if 3 positions open
- [ ] Implement capital per trade = 20% of **free USDT balance** (not total — excludes locked funds in open orders)
- [ ] Implement Kelly Criterion option for dynamic position sizing (Phase 2)
- [ ] Calculate trade P&L on close: `(exitPrice - entryPrice) / entryPrice * 100`
- [ ] **[NOTABLE — Weekly Drawdown]** Track weekly P&L in Redis (reset every Monday 00:00 UTC) — if weekly P&L < -5%, send Telegram alert `⚠️ WEEKLY DRAWDOWN -5% — Manual review required` and set `WEEKLY_REVIEW_FLAG=true` in Redis; bot continues trading but flag is visible on dashboard
- [ ] **[NOTABLE — Weekly Reset Cron]** Add `node-cron` job with schedule `0 0 * * 1` (Monday 00:00 UTC) — delete `weekly_pnl` Redis key and clear `WEEKLY_REVIEW_FLAG`; without this cron the weekly P&L accumulates indefinitely and the -5% alert never resets
- [ ] Expose `GET /api/performance` — win rate, avg P&L, total trades, daily P&L, **weekly P&L**, monthly P&L
- [ ] Persist performance stats to MongoDB daily snapshot
- [ ] Send Telegram alert when daily halt triggered

---

### Feature 11 — React Dashboard
> Real-time visual interface for monitoring and control

- [ ] Initialize React 18 + Vite project in `frontend/`
- [ ] **[CRITICAL — React Router]** Install `react-router-dom`: `npm install react-router-dom` — without this, `<BrowserRouter>` is undefined and the app crashes on the first render; install before creating any component that uses `<Link>`, `<useNavigate>`, or `<Routes>`
- [ ] **[CRITICAL — App.jsx Shell]** Build `App.jsx` with full routing structure:
  ```jsx
  import { BrowserRouter, Routes, Route } from 'react-router-dom';
  import Login from './components/Login';
  import PrivateRoute from './components/PrivateRoute';
  import Dashboard from './components/Dashboard';

  export default function App() {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
        </Routes>
      </BrowserRouter>
    );
  }
  ```
  This must be the root component mounted in `main.jsx` via `ReactDOM.createRoot(...).render(<App />)`. Without a routing shell, navigating to `/login` returns a blank page and `PrivateRoute` cannot redirect unauthenticated users.
- [ ] **[CRITICAL — Dashboard.jsx]** Build `Dashboard.jsx` — layout component that assembles all panels in the grid shown in the Dashboard Layout section; it is the single component rendered for the authenticated `/` route:
  ```jsx
  export default function Dashboard() {
    return (
      <div className="dashboard-grid">
        <Navbar />
        <Chart />
        <SignalPanel />
        <OIPanel />
        <SentimentBar />
        <OpenOrders />
        <TradeHistory />
        <RiskPanel />
      </div>
    );
  }
  ```
  Without this file, the 10 individual components built in subsequent tasks have no mount point and the dashboard renders nothing.
- [ ] **[CRITICAL — PrivateRoute Component]** Build `PrivateRoute.jsx` — on mount, call `GET /api/auth/me`; render children if 200, redirect to `/login` if 401; show a loading state while the request is in-flight (prevents flash of unauthenticated content)
- [ ] **[CRITICAL — frontend/.env]** Create `frontend/.env` with `VITE_API_URL=http://localhost:3000` — this Vite environment variable is the backend base URL used by `services/api.js` for all axios calls and by `useSocket.js` for Socket.io connection; without it every API call fails with a network error since Vite does not proxy to the backend by default; for production set `VITE_API_URL=https://your-vps-domain.com` (Nginx handles routing /api and /socket.io to the Node.js backend); also create `frontend/.env.example` with this placeholder
- [ ] Install `lightweight-charts`, `socket.io-client`, `axios`, `recharts`
- [ ] **[CRITICAL — Auth]** Build `Login.jsx` — password login page; on submit, `POST /api/auth/login`; server sets JWT in `httpOnly` cookie (browser JS cannot read it — this is intentional for XSS protection)
- [ ] **[CRITICAL — Auth]** Build `useSocket.js` hook — connect to backend Socket.io; **do NOT pass token in `socket.handshake.auth.token`** (impossible — JS cannot read httpOnly cookie); instead Socket.io backend `io.use()` middleware reads the cookie directly from `socket.handshake.headers.cookie` using the `cookie` npm package (see Feature 7)
- [ ] Build `Navbar.jsx` — pair switcher (BTC/ETH/SOL), bot status indicator, daily P&L badge
- [ ] Build `Chart.jsx` — TradingView Lightweight Charts candlestick chart
  - [ ] Render EMA 9, 21, 50 overlays on chart
  - [ ] Add BUY (▲) and SELL (▼) trade markers on chart
  - [ ] Real-time candle updates via Socket.io
- [ ] Build `SignalPanel.jsx` — live display of all 5 layer signals + ML score
- [ ] Build `OIPanel.jsx` — OI delta chart (line chart via recharts)
- [ ] Build `SentimentBar.jsx` — Fear & Greed gauge (0–100 color bar)
- [ ] Build `OpenOrders.jsx` — table of active limit orders + Cancel button
- [ ] Build `TradeHistory.jsx` — closed trades table (pair, entry, exit, P&L%, time)
- [ ] Build `RiskPanel.jsx` — daily P&L progress bar + halt status
- [ ] Add manual Pause/Resume trading button → calls `POST /api/trading/pause` (auth protected)
- [ ] **[NOTABLE — Error Boundary]** Build `ErrorBoundary.jsx` component and wrap the full app in it inside `App.jsx` — catches uncaught React render errors (Socket.io disconnect events can cause component re-renders that throw if event data is null/undefined) and displays a "Connection lost — attempting to reconnect..." banner instead of a blank white page; log error stack to console for debugging; auto-refresh attempt after 10 seconds
- [ ] Style with dark space theme (black + electric blue + gold color palette)

---

### Feature 12 — Telegram Alerts
> Real-time notifications on phone for every trade event

- [ ] Create Telegram Bot via @BotFather → get `TELEGRAM_BOT_TOKEN`
- [ ] Build `services/telegram.js` module using `axios` POST to Telegram API
- [ ] Alert on trade open: `🟢 BUY BTCUSDT | Entry: $84,200 | Qty: 0.001 | Score: 0.74`
- [ ] Alert on TP hit: `✅ CLOSED BTCUSDT | +0.94% | P&L: ₹470 | Time: 32min`
- [ ] Alert on SL hit: `🔴 STOP LOSS BTCUSDT | -0.48% | P&L: -₹240`
- [ ] Alert on daily halt: `⛔ NOVAPULSE HALTED | Daily loss limit -2% reached`
- [ ] Alert on daily summary (23:59 UTC): win rate, total trades, daily P&L
- [ ] Alert on ML model retrained: accuracy + feature importance summary

---

### Feature 13 — Deployment & Monitoring
> Run NovaPulse reliably 24/7 on VPS

- [ ] Set up DigitalOcean Droplet (Singapore) — Ubuntu 22.04, 2GB RAM
- [ ] Install Node.js 20, Python 3.11, MongoDB, Redis, PM2 on VPS
- [ ] Set up `docker-compose.yml` for MongoDB + Redis
- [ ] **[CRITICAL — Redis Persistence]** Enable Redis **AOF (Append-Only File)** persistence in `docker-compose.yml` — set `appendonly yes` and `appendfsync everysec`; without this a VPS crash wipes all Redis state including `position:{symbol}` OCO keys, leaving live TP and SL orders orphaned with no bot watching them
- [ ] **[CRITICAL — Redis Persistence]** After enabling AOF, test crash recovery: start bot, open a simulated position, kill Redis, restart Redis, verify `position:{symbol}` key is restored and OCO cancel still functions
- [ ] Configure PM2 ecosystem file — run backend + ML service as persistent processes
- [ ] **[CRITICAL — PM2 ecosystem.config.js]** Create `ecosystem.config.js` at project root with the following processes:
  ```js
  module.exports = { apps: [
    { name: 'novapulse-backend', script: 'backend/server.js', env: { NODE_ENV: 'production' }, max_memory_restart: '500M', error_file: 'logs/backend-error.log', out_file: 'logs/backend-out.log' },
    { name: 'novapulse-ml', script: 'ml-service/app.py', interpreter: 'python3', env: { FLASK_ENV: 'production' }, error_file: 'logs/ml-error.log', out_file: 'logs/ml-out.log' }
  ]};
  ```
  Verify with `pm2 start ecosystem.config.js` and `pm2 list` shows both processes `online`
- [ ] Set up PM2 log rotation and auto-restart on crash
- [ ] Configure UFW firewall — allow only ports 80, 443, 3000, SSH
- [ ] Set up Let's Encrypt SSL for dashboard domain
- [ ] Configure Nginx reverse proxy for frontend + backend
- [ ] **[CRITICAL — Nginx Config]** Nginx configuration must include:
  - `proxy_pass http://localhost:3000` for routes `/api` and `/socket.io`
  - WebSocket upgrade headers: `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`
  - `proxy_read_timeout 86400s;` (WebSocket connections stay alive)
  - `proxy_set_header X-Real-IP $remote_addr;` (for rate limiter IP detection)
  - SSL termination with Let's Encrypt (Certbot); HTTP → HTTPS redirect
  - Serve React build (`/var/www/novapulse/dist`) as static files with `try_files $uri /index.html` (required for React Router)
  Without the WebSocket upgrade headers, Socket.io falls back to long-polling and the dashboard loses real-time updates
- [ ] **[CRITICAL — MongoDB Decision]** Use **MongoDB Atlas Free Tier (512MB)** for development and **self-hosted MongoDB** (via docker-compose) for production VPS — Atlas free tier has connection limits and sleep timeouts that will pause the bot after 5 minutes of query inactivity; production **must** use the local Docker MongoDB instance configured in `docker-compose.yml`; update `MONGODB_URI` in `.env` accordingly: `mongodb://localhost:27017/novapulse` for local/production, `mongodb+srv://...` for Atlas dev
- [ ] Set up automated MongoDB backups (daily cron → compress + store)
- [ ] **[CRITICAL — Testnet Funding Steps]** Fund the Binance Testnet account before paper trading:
  1. Go to `https://testnet.binance.vision/` and log in with GitHub OAuth
  2. Click **"Generate HMAC_SHA256 Key"** to get your testnet API key and secret
  3. Click **"Deposit"** on the testnet dashboard to add test USDT (testnet funds are fake and free)
  4. Verify balance: `curl -H "X-MBX-APIKEY: {key}" "https://testnet.binance.vision/api/v3/account"` — confirm USDT balance > 1000 USDT (test funds)
  5. Update `.env`: `BINANCE_ENV=testnet`, `BINANCE_API_KEY={testnet_key}`, `BINANCE_SECRET_KEY={testnet_secret}`
  Note: Testnet order fill simulation is **erratic** — limit orders may never fill even at market price, or fill instantly regardless of price; this is a known Binance Testnet limitation; paper trading results on Testnet are **not representative** of live performance; use Testnet primarily to verify the order flow logic (no 500 errors, correct order IDs, correct TP/SL placement) rather than to validate P&L outcomes
- [ ] Create health check endpoint `GET /health` on backend
- [ ] Set up UptimeRobot (free) — ping health check every 5 minutes
- [ ] Alert via Telegram if health check fails 2× in a row
- [ ] **[NOTABLE — Testnet → Live Switch]** Verified switchover checklist: update `BINANCE_ENV=live` in `.env`, rotate API keys, confirm `BINANCE_BASE_URL` resolves correctly, run 1 test balance fetch before enabling signal engine
- [ ] **[CRITICAL — OI Data on Testnet Will Block All Signals]** Binance Futures has **no public testnet** — all OI and funding rate data always comes from the live Futures market, even when running on Spot Testnet. This has a concrete operational consequence: **Layer 2 reads real live market conditions**. If BTC is in a bear market or accumulation phase during your 2-week paper trading window, OI delta may be flat or falling and funding rates may be elevated. In that scenario, Layer 2 will correctly veto every signal — resulting in **zero trades for the entire paper trading period**. Before concluding the bot is broken:
  1. Check OI data manually: `curl "https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=5m&limit=5"` — if all deltas are near zero or negative, Layer 2 is working correctly
  2. Check funding rate: if > +0.1%, the bot is correctly avoiding overleveraged-long conditions
  3. A zero-trade paper trading session with healthy logs (no errors, signals reaching Layer 2 and being vetoed) is a **passing result**, not a failure
  4. To force a signal through for integration testing, temporarily set `OI_DELTA_THRESHOLD=0` and `FUNDING_RATE_THRESHOLD=999` in `.env`; remember to restore before paper trading evaluation
- [ ] **[CRITICAL — Graceful Shutdown]** Register `SIGTERM` and `SIGINT` handlers in `server.js` — on receiving shutdown signal: (1) set `TRADING_HALTED=true` in Redis to block new signals, (2) call `Bull.pause()` to drain active jobs without accepting new ones, (3) send Telegram alert `🟡 NovaPulse shutting down gracefully…`, (4) close all Binance WebSocket streams, (5) call `mongoose.disconnect()`, (6) flush Winston logger; PM2 sends SIGTERM before SIGKILL (grace period 5 seconds) — without this handler, a PM2 restart during an active order can leave TP/SL orders orphaned or corrupt Redis lock state
- [ ] **[CRITICAL — Crash Recovery]** On every Node.js startup (including PM2 restarts after crash), run `services/orderManager.reconcileOpenPositions()`:
  - Scan all `position:{symbol}` keys in Redis
  - For each key, call `GET /api/v3/order` on stored `tpOrderId` and `slOrderId`
  - If TP is `FILLED`: cancel SL, log trade as closed at TP price, update MongoDB + P&L
  - If SL is `FILLED`: cancel TP, log trade as closed at SL price, update MongoDB + P&L
  - If both are `FILLED` (race during downtime): log as closed at better-priced fill, investigate manually via Telegram alert
  - If both still `NEW`/`OPEN`: resume normal OCO monitoring — no action needed
  - If both are `CANCELLED` or `EXPIRED`: clear Redis key, log as orphaned trade, send Telegram alert for manual review
  - **[CRITICAL — Bull Orphan]** For every position resolved (TP or SL already filled): retrieve and remove the corresponding Bull timeout job by job ID stored alongside `tpOrderId`/`slOrderId` in `position:{symbol}` Redis key — call `job.remove()` to prevent the stale Bull job from firing later and triggering the fill handler on an already-closed trade
- [ ] **[CRITICAL — Bull Orphan]** When creating the 15-minute Bull timeout job for a buy order, store its `job.id` inside the `position:{symbol}` Redis hash alongside `tpOrderId` and `slOrderId` so crash reconciliation (and normal TP/SL fill handlers) can cancel it by ID
- [ ] **[CRITICAL — Crash Recovery]** Add startup log line: `RECONCILIATION COMPLETE — N positions checked, M resolved` before opening WebSocket streams

---

### Feature 14 — Backtesting Engine
> Validate strategy viability on historical data before any live capital

- [ ] Build `backend/services/backtester.js` module
- [ ] Load 3–6 months of stored OHLCV candles from MongoDB for each pair
- [ ] Replay candles sequentially, computing all **Layer 1–4** signals on each closed candle
- [ ] **[NOTABLE — ML Excluded — Look-Ahead Bias]** Layer 5 (ML) is intentionally excluded from backtesting. The ML model is trained in Feature 9 (Phase 7, Weeks 8–9) on 6 months of historical OHLCV + OI candles. The backtesting engine (Feature 14, Phase 12, Week 15) replays candles from that **same historical window**. Including the trained model in the backtest would produce **look-ahead bias**: the model has already seen the outcome labels for those candles during training, so its confidence scores on the backtest window are artificially inflated and do not reflect out-of-sample performance. The correct out-of-sample evaluation is live paper trading (Phase 13), where the model encounters candle data it was never trained on. Backtest win rate with Layers 1–4 only will be **optimistic** vs live — compensate by requiring win rate > 60% (not lower) to pass the pre-live gate.
- [ ] Simulate limit order fills — assume fill if price touches limit within next 3 candles
- [ ] Simulate TP (+1%) and SL (-0.5%) — mark which exits first per trade
- [ ] Deduct Binance maker fee (0.075%) from each simulated trade P&L
- [ ] Track: win rate, avg P&L per trade, max drawdown, Sharpe ratio, total return
- [ ] Output backtest report to `backtest-results/report_{timestamp}.json`
- [ ] **[NOTABLE — .gitignore]** Add `backtest-results/` to `.gitignore` — backtest JSON reports can be large (hundreds of trades) and contain real historical signal data; they are build artifacts, not source code; each developer runs their own backtests against their own data
- [ ] Build `GET /api/backtest/run` endpoint — trigger backtest on demand from dashboard
- [ ] Build `BacktestPanel.jsx` in React — display equity curve, win rate, drawdown chart
- [ ] **Set pass criteria before paper trading:** win rate > **60%**, avg P&L > 0.4%, max drawdown < 8%
- [ ] If backtest fails criteria → tune signal thresholds before proceeding to paper trading
- [ ] **[NOTABLE — Integration Test Plan]** Before going live, manually trace the full signal → order → fill → close path end-to-end on Testnet:
  1. Confirm a BUY signal fires and a limit order appears in `GET /api/v3/openOrders`
  2. Manually fill the order on Testnet dashboard (or wait for natural fill); confirm TP and SL orders are placed immediately after fill
  3. Manually trigger TP fill; confirm SL order is cancelled, trade is logged in MongoDB, P&L updated in Redis, Telegram alert sent
  4. Confirm the Bull timeout job does NOT fire after TP fill (it should be cancelled by job ID stored in Redis)
  5. Repeat for SL fill path
  6. Simulate a crash (kill Node.js process mid-trade); restart; confirm `reconcileOpenPositions()` correctly resolves the open position without duplicate orders
  This test matrix must pass completely on Testnet before any live capital is committed
- [ ] **[CRITICAL — Testnet Fill Caveat]** Binance Testnet fill simulation is **erratic** — limit orders may fill instantly at any price or never fill at all; use Testnet exclusively to validate code correctness (no errors, correct order IDs, correct state transitions), NOT to measure P&L accuracy; paper trading P&L on Testnet has no predictive value for live performance

---

## 📊 Expected Performance

| Metric | Target |
|--------|--------|
| Daily profit | 1–2% |
| Win rate | 60–65% |
| Risk:Reward | 1:2 |
| Max daily loss | -2% (hard halt) |
| Sharpe Ratio | > 1.5 |
| Monthly return | ~20–40% |
| Model retrain | Every Sunday |

---

## 💰 Monthly Cost

| Service | Plan | Cost |
|---------|------|------|
| Taapi.io | Pro | ₹599 |
| DigitalOcean VPS (Singapore) | Basic Droplet | ₹1,700 |
| Binance API | — | Free |
| Fear & Greed API | — | Free |
| Telegram Bot | — | Free |
| MongoDB Atlas (dev) | Free tier | Free |
| **Total** | | **₹2,299/mo** |

---

## ⚠️ Disclaimer

> NovaPulse is built for personal use and educational purposes. Cryptocurrency trading involves substantial risk of financial loss. Past performance does not guarantee future results. Always test thoroughly on Testnet before trading with real capital. Never trade money you cannot afford to lose.

---

## 👤 Author

**NovaPulse** — Built with precision, powered by AI, guided by the stars.

---

*"Signals from the stars. Profits on Earth."* 🌌
