import { useState, useEffect } from 'react';
import { getLatestSignal } from '../services/api';

function LayerRow({ label, score }) {
  const color =
    score === 1 ? 'var(--accent-green)' :
    score === -1 ? 'var(--accent-red)' :
    score === 'veto' ? 'var(--accent-gold)' : 'var(--text-secondary)';
  const icon = score === 1 ? '✅' : score === -1 ? '❌' : score === 'veto' ? '⚠️' : '⬜';
  return (
    <tr>
      <td style={{ color: 'var(--text-secondary)' }}>{label}</td>
      <td style={{ color }}>{icon} {String(score)}</td>
    </tr>
  );
}

// Only "warming up" if no signal at all or if the signal has never had any data
// computed (not merely vetoed — vetoed signals ARE real signals).
function isWarmingUp(s) {
  if (!s) return true;
  if (s.vetoed) return false; // vetoed = real computed signal, just blocked
  const scores = [s.layer1Score, s.layer2Score, s.layer3Score, s.layer4Score, s.layer5Score];
  return s.finalSignal === 'NEUTRAL' && scores.every((v) => v === 0 || v === null);
}

export default function SignalPanel({ symbol, lastSignal }) {
  const [signal, setSignal] = useState(null);
  const [loading, setLoading] = useState(true);

  // Pre-populate from REST on symbol change, then keep live via socket prop
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getLatestSignal(symbol)
      .then(({ data }) => { if (!cancelled) { setSignal(data); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol]);

  // Merge live socket updates
  useEffect(() => {
    if (lastSignal) setSignal(lastSignal);
  }, [lastSignal]);

  const s = signal;
  const warming = isWarmingUp(s);

  const signalColor =
    s?.finalSignal === 'BUY'  ? 'var(--accent-green)' :
    s?.finalSignal === 'SELL' ? 'var(--accent-red)'   : 'var(--text-secondary)';

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ color: 'var(--accent-blue)', fontSize: 12 }}>SIGNAL PANEL — {symbol}</span>
        {s && (
          <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
            {new Date(s.timestamp).toLocaleTimeString()}
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Loading…</div>
      ) : warming ? (
        <div style={{ color: '#ffa726', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 16 }}>⏳</span>
          <span>Warming up — awaiting candle buffer ({symbol})</span>
        </div>
      ) : (
        <>
          <table>
            <tbody>
              <LayerRow label="L1 Technical" score={s.layer1Score} />
              <LayerRow label="L2 OI/Funding" score={s.layer2Score} />
              <LayerRow label="L3 Taapi"      score={s.layer3Score} />
              <LayerRow label="L4 Sentiment"  score={s.layer4Score} />
              <LayerRow label="L5 ML"         score={s.layer5Score} />
            </tbody>
          </table>
          <div style={{ marginTop: 8 }}>
            <span style={{ color: 'var(--text-secondary)' }}>ML Score: </span>
            {s.mlOffline
              ? <span style={{ color: 'var(--accent-red)', fontSize: 11 }}>⚠️ Offline</span>
              : s.mlConfidence !== null
                ? <span style={{ color: 'var(--accent-gold)' }}>{Number(s.mlConfidence).toFixed(3)}</span>
                : <span style={{ color: 'var(--text-secondary)' }}>—</span>}
          </div>
          <div style={{ marginTop: 8, fontSize: 15, color: signalColor, fontWeight: 'bold' }}>
            Signal: {s.finalSignal === 'BUY' ? '🟢' : s.finalSignal === 'SELL' ? '🔴' : '⚪'} {s.finalSignal}
          </div>
          {s.vetoed && (
            <div style={{ color: 'var(--accent-gold)', fontSize: 11, marginTop: 4 }}>
              ⚠️ Vetoed: {s.vetoReason}
            </div>
          )}
        </>
      )}
    </div>
  );
}

