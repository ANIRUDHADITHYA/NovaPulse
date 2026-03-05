import { useState, useEffect, useCallback } from 'react';
import { getAPIStatus } from '../services/api';

/* ── single service tile ────────────────────────────────── */
function Tile({ label, ok, sub, bar, error }) {
  const borderColor = ok ? 'rgba(0,230,118,0.25)' : 'rgba(255,23,68,0.35)';
  const bgColor     = ok ? 'rgba(0,230,118,0.05)' : 'rgba(255,23,68,0.07)';
  const dotColor    = ok ? 'var(--accent-green)'   : 'var(--accent-red)';
  const pct = bar && bar.total > 0 ? Math.min(100, Math.round((bar.used / bar.total) * 100)) : null;
  const barColor = pct >= 90 ? 'var(--accent-red)' : pct >= 70 ? '#ffa726' : 'var(--accent-blue)';

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      padding: '4px 8px', borderRadius: 4, minWidth: 0,
      border: `1px solid ${borderColor}`,
      background: bgColor,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{
          display: 'inline-block', width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          background: dotColor, boxShadow: `0 0 4px ${dotColor}`,
        }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
      </div>
      {pct !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
          <div style={{ flex: 1, height: 3, background: 'var(--bg-border)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: barColor, transition: 'width 0.4s' }} />
          </div>
          <span style={{ fontSize: 9, color: 'var(--text-secondary)', flexShrink: 0 }}>{pct}%</span>
        </div>
      )}
      {ok && sub && (
        <span style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sub}
        </span>
      )}
      {!ok && error && (
        <span style={{ fontSize: 9, color: 'var(--accent-red)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          ⚠ {error}
        </span>
      )}
    </div>
  );
}

/* ── main component ─────────────────────────────────────── */
export default function APIStatus() {
  const [data, setData]       = useState(null);
  const [lastFetch, setLast]  = useState(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { const res = await getAPIStatus(); setData(res.data); setLast(new Date()); }
    catch { /* silent */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, [refresh]);

  const s = data?.services;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 10px',
      background: 'var(--bg-card)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-blue)', whiteSpace: 'nowrap' }}>
          API STATUS
        </span>
        <span style={{ fontSize: 9, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
          {loading ? 'updating...' : lastFetch ? lastFetch.toLocaleTimeString() : '--'}
        </span>
      </div>

      <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--bg-border)', flexShrink: 0 }} />

      {!s ? (
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          {loading ? 'Connecting...' : 'Unavailable'}
        </span>
      ) : (
        <div style={{
          flex: 1,
          display: 'grid',
          gridTemplateRows: '1fr 1fr',
          gridAutoFlow: 'column',
          gridAutoColumns: '1fr',
          gap: '4px 6px',
        }}>
          <Tile
            label="Binance REST" ok={s.binanceRest.ok} error={s.binanceRest.error}
            bar={s.binanceRest.ok ? { used: s.binanceRest.weight, total: s.binanceRest.weightLimit } : null}
            sub={s.binanceRest.ok ? `wt ${s.binanceRest.weight}/${s.binanceRest.weightLimit}` : null}
          />
          <Tile
            label="Binance WS" ok={s.binanceWs.ok}
            sub={s.binanceWs.ok
              ? Object.entries(s.binanceWs.symbols).map(([sym, c]) => sym.replace('USDT', '') + (c ? 'v' : 'x')).join(' ')
              : null}
          />
          <Tile
            label="Futures/OI" ok={s.binanceFutures.ok} error={s.binanceFutures.error}
            sub={s.binanceFutures.ok && s.binanceFutures.oiCacheSecsLeft != null
              ? `cache ${s.binanceFutures.oiCacheSecsLeft}s` : null}
          />
          <Tile
            label="TAAPI"
            ok={s.taapi.ok && s.taapi.remaining > 0}
            error={!s.taapi.ok ? s.taapi.error : s.taapi.remaining === 0 ? 'quota exhausted' : null}
            bar={{ used: s.taapi.callsToday, total: s.taapi.dailyLimit }}
            sub={`${s.taapi.remaining.toLocaleString()} left`}
          />
          <Tile
            label="ML Service" ok={s.ml.ok} error={s.ml.error}
            sub={s.ml.ok ? (s.ml.modelLoaded ? 'loaded' : 'cold start') : null}
          />
          <Tile
            label="Fear & Greed" ok={s.fearGreed.ok} error={s.fearGreed.error}
            sub={s.fearGreed.ok && s.fearGreed.value != null
              ? `${s.fearGreed.value} - ${s.fearGreed.classification}` : null}
          />
          <Tile
            label="CC News" ok={s.cryptoCompareNews.ok} error={s.cryptoCompareNews.error}
            sub={s.cryptoCompareNews.ok && s.cryptoCompareNews.cacheTtl != null
              ? (s.cryptoCompareNews.cacheTtl > 0 ? `cache ${s.cryptoCompareNews.cacheTtl}s` : 'expired')
              : null}
          />
          <Tile
            label="MongoDB" ok={s.mongodb.ok} error={!s.mongodb.ok ? 'disconnected' : null}
            sub={s.mongodb.ok ? 'connected' : null}
          />
        </div>
      )}
    </div>
  );
}
