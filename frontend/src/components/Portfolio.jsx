import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getBalance, getPerformance, getPerformanceHistory, getTrades, logout } from '../services/api';

/* ── tiny inline bar chart for equity curve ─────────────── */
function EquityBar({ value, max }) {
  const pct = max === 0 ? 0 : Math.abs(value / max) * 100;
  const color = value >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        width: `${Math.max(2, pct)}%`,
        minWidth: 2,
        maxWidth: '100%',
        height: 8,
        background: color,
        borderRadius: 2,
        boxShadow: `0 0 4px ${color}`,
        transition: 'width 0.4s ease',
      }} />
      <span style={{ color, fontSize: 10, whiteSpace: 'nowrap' }}>
        {value >= 0 ? '+' : ''}{Number(value).toFixed(2)}%
      </span>
    </div>
  );
}

/* ── stat card ───────────────────────────────────────────── */
function StatCard({ label, value, color, sub }) {
  return (
    <div className="card" style={{ flex: 1, minWidth: 110 }}>
      <div style={{ color: 'var(--text-secondary)', fontSize: 10, marginBottom: 4, letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ color: color || 'var(--text-primary)', fontSize: 18, fontWeight: 700 }}>
        {value}
      </div>
      {sub && <div style={{ color: 'var(--text-secondary)', fontSize: 10, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

const PAGE_SIZE = 25;
const SYMBOLS = ['ALL', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOTUSDT'];

export default function Portfolio() {
  const navigate = useNavigate();

  const [balance, setBalance]       = useState(null);
  const [perf, setPerf]             = useState(null);
  const [history, setHistory]       = useState([]);
  const [trades, setTrades]         = useState([]);
  const [totalTrades, setTotalTrades] = useState(0);
  const [page, setPage]             = useState(0);
  const [filterSym, setFilterSym]   = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);

  /* fetch all data on mount */
  useEffect(() => {
    Promise.all([
      getBalance(),
      getPerformance(),
      getPerformanceHistory(90),
      getTrades(undefined, 500),   // fetch up to 500 for client-side pagination
    ])
      .then(([bal, pf, hist, tr]) => {
        setBalance(bal.data);
        setPerf(pf.data);
        setHistory(hist.data || []);
        setTrades(tr.data || []);
        setTotalTrades((tr.data || []).length);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleLogout = async () => { await logout(); navigate('/login'); };

  /* client-side filter + paginate */
  const filtered = trades.filter((t) => {
    const symOk = filterSym === 'ALL' || t.symbol === filterSym;
    const stOk  = filterStatus === 'ALL' || t.status === filterStatus;
    return symOk && stOk;
  });
  const pageCount  = Math.ceil(filtered.length / PAGE_SIZE);
  const pageSlice  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  /* equity curve max for bar scaling */
  const maxAbsPnl = Math.max(...history.map((s) => Math.abs(s.pnlPct || 0)), 0.001);

  /* totals from filtered set */
  const filteredWins   = filtered.filter((t) => t.status === 'CLOSED_TP').length;
  const filteredPnlSum = filtered.reduce((a, t) => a + (t.pnlPct || 0), 0);
  const filteredPnlUsdt = filtered.reduce((a, t) => a + (t.pnlUsdt || 0), 0);

  if (loading) return <div className="loading">Loading portfolio…</div>;
  if (error)   return <div className="loading" style={{ color: 'var(--accent-red)' }}>Error: {error}</div>;

  const fmt2  = (n) => Number(n).toFixed(2);
  const fmtPct = (n, digits = 2) => (n >= 0 ? '+' : '') + Number(n).toFixed(digits) + '%';

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', minHeight: '100vh',
      background: 'var(--bg-primary)', padding: 16, gap: 16,
    }}>

      {/* ── Top nav bar ─────────────────────────────────────── */}
      <div className="card" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 16px', borderRadius: 6,
      }}>
        <span
          style={{ color: 'var(--accent-blue)', fontWeight: 'bold', fontSize: 15, cursor: 'pointer' }}
          onClick={() => navigate('/')}
        >
          🌌 NOVAPULSE
        </span>
        <span style={{ color: 'var(--accent-blue)', fontSize: 13 }}>PORTFOLIO</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ fontSize: 11 }} onClick={() => navigate('/')}>← Dashboard</button>
          <button style={{ fontSize: 11 }} onClick={handleLogout}>Logout</button>
        </div>
      </div>

      {/* ── Wallet balance ───────────────────────────────────── */}
      <section>
        <div style={{ color: 'var(--accent-blue)', fontSize: 11, marginBottom: 8, letterSpacing: '0.1em' }}>
          WALLET BALANCE
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {balance && Object.entries(balance).map(([asset, b]) => (
            <div key={asset} className="card" style={{ minWidth: 140 }}>
              <div style={{ color: 'var(--text-secondary)', fontSize: 10, marginBottom: 4 }}>
                {asset.toUpperCase()}
              </div>
              <div style={{ color: 'var(--accent-gold)', fontSize: 16, fontWeight: 700 }}>
                {Number(b.free + b.locked).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 10, marginTop: 4 }}>
                Free: {Number(b.free).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                {b.locked > 0 && (
                  <span style={{ color: 'var(--accent-red)', marginLeft: 6 }}>
                    Locked: {Number(b.locked).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Overall PnL stats ────────────────────────────────── */}
      {perf && (
        <section>
          <div style={{ color: 'var(--accent-blue)', fontSize: 11, marginBottom: 8, letterSpacing: '0.1em' }}>
            OVERALL PERFORMANCE
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <StatCard label="TOTAL TRADES" value={perf.totalTrades} />
            <StatCard label="WIN RATE" value={perf.winRate + '%'}
              color={parseFloat(perf.winRate) >= 50 ? 'var(--accent-green)' : 'var(--accent-red)'} />
            <StatCard label="WINS / LOSSES"
              value={`${perf.wins} / ${perf.losses}`}
              color="var(--accent-green)" />
            <StatCard label="AVG PnL / TRADE"
              value={fmtPct(perf.avgPnlPct, 3)}
              color={parseFloat(perf.avgPnlPct) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'} />
            <StatCard label="DAILY PnL"
              value={fmtPct(perf.dailyPnlPct)}
              color={perf.dailyPnlPct >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'} />
            <StatCard label="WEEKLY PnL"
              value={fmtPct(perf.weeklyPnlPct)}
              color={perf.weeklyPnlPct >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'} />
            <StatCard label="MONTHLY PnL"
              value={fmtPct(perf.monthlyPnlPct)}
              color={parseFloat(perf.monthlyPnlPct) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'} />
          </div>
        </section>
      )}

      {/* ── 90-day equity curve ──────────────────────────────── */}
      {history.length > 0 && (
        <section>
          <div style={{ color: 'var(--accent-blue)', fontSize: 11, marginBottom: 8, letterSpacing: '0.1em' }}>
            DAILY PnL — LAST 90 DAYS
          </div>
          <div className="card" style={{ overflowX: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, minWidth: history.length * 14, height: 80 }}>
              {history.map((s, i) => {
                const pct = s.pnlPct || 0;
                const heightPct = Math.max(4, Math.abs(pct) / maxAbsPnl * 100);
                const color = pct >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
                return (
                  <div
                    key={i}
                    title={`${s.date?.slice(0, 10)} | ${fmtPct(pct)} | ${s.trades ?? 0} trades`}
                    style={{
                      flex: 1,
                      minWidth: 8,
                      height: `${heightPct}%`,
                      background: color,
                      borderRadius: '2px 2px 0 0',
                      opacity: 0.85,
                      cursor: 'default',
                      boxShadow: `0 0 4px ${color}`,
                    }}
                  />
                );
              })}
            </div>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              color: 'var(--text-secondary)', fontSize: 9, marginTop: 4,
            }}>
              <span>{history[0]?.date?.slice(0, 10)}</span>
              <span>{history[Math.floor(history.length / 2)]?.date?.slice(0, 10)}</span>
              <span>{history[history.length - 1]?.date?.slice(0, 10)}</span>
            </div>
          </div>
        </section>
      )}

      {/* ── Trade history table ──────────────────────────────── */}
      <section style={{ flex: 1 }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 8, flexWrap: 'wrap', gap: 8,
        }}>
          <div style={{ color: 'var(--accent-blue)', fontSize: 11, letterSpacing: '0.1em' }}>
            TRADE HISTORY
            <span style={{ color: 'var(--text-secondary)', marginLeft: 8 }}>
              ({filtered.length} trades
              {filtered.length > 0 && ` • ${filteredWins}W/${filtered.length - filteredWins}L`}
              {filteredPnlSum !== 0 && ` • ${fmtPct(filteredPnlSum)} total`})
            </span>
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SYMBOLS.map((s) => (
              <button
                key={s}
                onClick={() => { setFilterSym(s); setPage(0); }}
                style={{
                  fontSize: 10, padding: '3px 8px',
                  background: filterSym === s ? 'var(--accent-blue)' : undefined,
                  color: filterSym === s ? '#000' : undefined,
                }}
              >
                {s === 'ALL' ? 'All Pairs' : s.replace('USDT', '')}
              </button>
            ))}
            <div style={{ width: 1, background: 'var(--bg-border)' }} />
            {['ALL', 'CLOSED_TP', 'CLOSED_SL', 'CANCELLED'].map((st) => (
              <button
                key={st}
                onClick={() => { setFilterStatus(st); setPage(0); }}
                style={{
                  fontSize: 10, padding: '3px 8px',
                  background: filterStatus === st ? 'var(--accent-blue)' : undefined,
                  color: filterStatus === st ? '#000' : undefined,
                }}
              >
                {st === 'ALL' ? 'All' : st === 'CLOSED_TP' ? 'TP hit' : st === 'CLOSED_SL' ? 'SL hit' : 'Cancelled'}
              </button>
            ))}
          </div>
        </div>

        <div className="card" style={{ overflowX: 'auto' }}>
          {filtered.length === 0 ? (
            <div style={{ color: 'var(--text-secondary)', fontSize: 12, padding: 12 }}>No trades match filter</div>
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Pair</th>
                    <th>Side</th>
                    <th>Entry</th>
                    <th>Exit</th>
                    <th>PnL %</th>
                    <th>PnL USDT</th>
                    <th>Qty</th>
                    <th>ML Score</th>
                    <th>Status</th>
                    <th>Opened</th>
                    <th>Closed</th>
                  </tr>
                </thead>
                <tbody>
                  {pageSlice.map((t, i) => {
                    const rowNum = page * PAGE_SIZE + i + 1;
                    const isTP = t.status === 'CLOSED_TP';
                    const isSL = t.status === 'CLOSED_SL';
                    const statusColor = isTP
                      ? 'var(--accent-green)'
                      : isSL ? 'var(--accent-red)' : 'var(--text-secondary)';
                    const pnl = t.pnlPct ?? 0;
                    return (
                      <tr key={t._id || i} style={{ opacity: t.status === 'CANCELLED' ? 0.45 : 1 }}>
                        <td style={{ color: 'var(--text-secondary)', fontSize: 10 }}>{rowNum}</td>
                        <td style={{ fontWeight: 600 }}>{t.symbol}</td>
                        <td className="tag-green">{t.side || 'BUY'}</td>
                        <td>${Number(t.entryPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
                        <td>
                          {t.exitPrice
                            ? `$${Number(t.exitPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
                            : <span style={{ color: 'var(--text-secondary)' }}>—</span>}
                        </td>
                        <td style={{ color: pnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 600 }}>
                          {pnl >= 0 ? '+' : ''}{Number(pnl).toFixed(3)}%
                        </td>
                        <td style={{ color: (t.pnlUsdt ?? 0) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                          {t.pnlUsdt != null
                            ? `${t.pnlUsdt >= 0 ? '+' : ''}$${fmt2(t.pnlUsdt)}`
                            : <span style={{ color: 'var(--text-secondary)' }}>—</span>}
                        </td>
                        <td>{t.quantity}</td>
                        <td style={{ color: 'var(--text-secondary)' }}>
                          {t.mlConfidence != null ? `${(t.mlConfidence * 100).toFixed(0)}%` : '—'}
                        </td>
                        <td style={{ color: statusColor, fontSize: 11 }}>
                          {isTP ? '✓ TP' : isSL ? '✗ SL' : t.status}
                        </td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: 10 }}>
                          {t.openedAt ? new Date(t.openedAt).toLocaleString() : '—'}
                        </td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: 10 }}>
                          {t.closedAt ? new Date(t.closedAt).toLocaleString() : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>

                {/* Summary footer */}
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--bg-border)' }}>
                    <td colSpan={5} style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>
                      FILTERED TOTAL ({filtered.length})
                    </td>
                    <td style={{ color: filteredPnlSum >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 700 }}>
                      {fmtPct(filteredPnlSum, 3)}
                    </td>
                    <td style={{ color: filteredPnlUsdt >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 700 }}>
                      {filteredPnlUsdt >= 0 ? '+' : ''}${fmt2(filteredPnlUsdt)}
                    </td>
                    <td colSpan={5} />
                  </tr>
                </tfoot>
              </table>

              {/* Pagination */}
              {pageCount > 1 && (
                <div style={{ display: 'flex', gap: 6, justifyContent: 'center', padding: '10px 0 4px' }}>
                  <button
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                    style={{ fontSize: 10, padding: '3px 10px', opacity: page === 0 ? 0.4 : 1 }}
                  >
                    ← Prev
                  </button>
                  {Array.from({ length: pageCount }, (_, pi) => (
                    <button
                      key={pi}
                      onClick={() => setPage(pi)}
                      style={{
                        fontSize: 10, padding: '3px 8px',
                        background: pi === page ? 'var(--accent-blue)' : undefined,
                        color: pi === page ? '#000' : undefined,
                      }}
                    >
                      {pi + 1}
                    </button>
                  ))}
                  <button
                    disabled={page === pageCount - 1}
                    onClick={() => setPage((p) => p + 1)}
                    style={{ fontSize: 10, padding: '3px 10px', opacity: page === pageCount - 1 ? 0.4 : 1 }}
                  >
                    Next →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

    </div>
  );
}
