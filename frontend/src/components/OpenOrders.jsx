import React from 'react';
import { cancelOrder } from '../services/api';

// Constants mirror backend/config/constants.js
const TAKE_PROFIT_PCT = 0.01;   // 1.0 %
const STOP_LOSS_PCT   = 0.005;  // 0.5 %

async function handleCancel(symbol, orderId) {
  try {
    await cancelOrder(symbol, orderId);
  } catch {
    // silent — order may have already filled
  }
}

/* ── TP / SL progress bar ─────────────────────────────────── */
function TPSLBar({ entry, livePrice }) {
  const tp    = entry * (1 + TAKE_PROFIT_PCT);
  const sl    = entry * (1 - STOP_LOSS_PCT);
  const range = tp - sl;

  const rawPct      = ((livePrice - sl) / range) * 100;
  const pct         = Math.max(0, Math.min(100, rawPct));
  const entryPct    = ((entry - sl) / range) * 100; // always ~33 %
  const towardTP    = livePrice >= entry;
  const fillColor   = towardTP ? 'var(--accent-green)' : 'var(--accent-red)';

  // How far from entry toward TP / SL (0–100 %)
  const legPct = towardTP
    ? Math.min(100, ((livePrice - entry) / (tp - entry)) * 100)
    : Math.min(100, ((entry - livePrice) / (entry - sl)) * 100);

  const fmt = (n) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });

  return (
    <div style={{ marginTop: 6, paddingBottom: 2 }}>
      {/* Labels row */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: 9,
        marginBottom: 4,
        letterSpacing: '0.02em',
      }}>
        <span style={{ color: 'var(--accent-red)', opacity: 0.9 }}>SL ${fmt(sl)}</span>
        <span style={{ color: 'var(--text-secondary)', opacity: 0.6 }}>
          {towardTP
            ? <span style={{ color: 'var(--accent-green)' }}>{legPct.toFixed(1)}% → TP</span>
            : <span style={{ color: 'var(--accent-red)' }}>{legPct.toFixed(1)}% → SL</span>}
        </span>
        <span style={{ color: 'var(--accent-green)', opacity: 0.9 }}>TP ${fmt(tp)}</span>
      </div>

      {/* Bar track */}
      <div style={{
        position: 'relative',
        height: 7,
        background: 'rgba(255,255,255,0.07)',
        borderRadius: 4,
        overflow: 'visible',
      }}>
        {/* Filled portion */}
        <div style={{
          width: `${pct}%`,
          height: '100%',
          background: `linear-gradient(90deg, ${towardTP ? 'rgba(0,230,118,0.25)' : 'rgba(255,23,68,0.25)'} 0%, ${fillColor} 100%)`,
          borderRadius: 4,
          transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1), background 0.4s ease',
          boxShadow: `0 0 8px ${towardTP ? 'rgba(0,230,118,0.5)' : 'rgba(255,23,68,0.5)'}`,
        }} />

        {/* Entry price midpoint marker */}
        <div style={{
          position: 'absolute',
          left: `${entryPct}%`,
          top: -3,
          bottom: -3,
          width: 2,
          background: 'var(--accent-gold)',
          borderRadius: 2,
          boxShadow: '0 0 4px rgba(255,215,0,0.6)',
          transform: 'translateX(-50%)',
        }} />

        {/* Current-price tick */}
        <div style={{
          position: 'absolute',
          left: `${Math.max(1, Math.min(99, pct))}%`,
          top: -4,
          bottom: -4,
          width: 3,
          background: fillColor,
          borderRadius: 2,
          boxShadow: `0 0 6px ${fillColor}`,
          transform: 'translateX(-50%)',
          transition: 'left 0.6s cubic-bezier(0.4,0,0.2,1)',
        }} />
      </div>

      {/* Current price label below bar */}
      <div style={{
        marginTop: 4,
        textAlign: 'center',
        fontSize: 9,
        color: fillColor,
        opacity: 0.85,
        letterSpacing: '0.04em',
      }}>
        ▲ ${fmt(livePrice)}
      </div>
    </div>
  );
}

export default function OpenOrders({ symbol, openOrders, lastCandle = {} }) {
  const filtered = openOrders.filter((o) => !symbol || o.symbol === symbol);

  return (
    <div className="card">
      <div style={{ color: 'var(--accent-blue)', marginBottom: 8, fontSize: 12 }}>
        OPEN ORDERS {symbol && `— ${symbol}`}
      </div>
      {filtered.length === 0 ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>No open orders</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Pair</th>
              <th>Side</th>
              <th>Entry</th>
              <th>Current</th>
              <th>Running P&amp;L</th>
              <th>Qty</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => {
              const livePrice = lastCandle[o.symbol]?.close;
              const entry = parseFloat(o.price);
              const pnlPct = livePrice && entry ? ((livePrice - entry) / entry) * 100 : null;
              const pnlUsdt = livePrice && entry ? (livePrice - entry) * parseFloat(o.quantity) : null;

              return (
                <React.Fragment key={o.orderId}>
                  <tr>
                    <td>{o.symbol}</td>
                    <td className="tag-green">{o.side}</td>
                    <td>${Number(entry).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
                    <td style={{ color: 'var(--text-primary)' }}>
                      {livePrice ? `$${Number(livePrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : '—'}
                    </td>
                    <td>
                      {pnlPct !== null ? (
                        <span style={{ color: pnlPct >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 600 }}>
                          {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(3)}%
                          <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.75 }}>
                            ({pnlUsdt >= 0 ? '+' : ''}${pnlUsdt.toFixed(2)})
                          </span>
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-secondary)' }}>Pending fill</span>
                      )}
                    </td>
                    <td>{o.quantity}</td>
                    <td style={{ color: o.tpOrderId ? 'var(--accent-green)' : 'var(--accent-gold)' }}>
                      {o.tpOrderId ? 'OPEN' : 'PENDING'}
                    </td>
                    <td>
                      {!o.tpOrderId && (
                        <button
                          style={{ fontSize: 10, padding: '2px 6px' }}
                          onClick={() => handleCancel(o.symbol, o.orderId)}
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>

                  {/* TP / SL progress bar row — only shown when trade is OPEN (TP/SL placed) */}
                  {livePrice && entry > 0 && o.tpOrderId && (
                    <tr>
                      <td
                        colSpan={8}
                        style={{ paddingTop: 0, paddingBottom: 8, borderTop: 'none' }}
                      >
                        <TPSLBar entry={entry} livePrice={livePrice} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
