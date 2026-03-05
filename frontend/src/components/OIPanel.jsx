import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useState, useEffect } from 'react';
import { getOI } from '../services/api';

const MAX_HISTORY = 24; // ~2 hours at 5-min OI fetch interval

export default function OIPanel({ symbol, oiData }) {
  const [history, setHistory] = useState([]);
  const [currentOI, setCurrentOI] = useState(null);

  // Pre-fetch latest OI from REST on mount / symbol switch
  useEffect(() => {
    let cancelled = false;
    getOI(symbol)
      .then(({ data }) => { if (!cancelled) setCurrentOI(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [symbol]);

  // Live socket updates override the REST snapshot
  const live = oiData || currentOI;

  // Accumulate OI delta snapshots as they arrive from the socket
  useEffect(() => {
    if (!oiData) return;
    setHistory((prev) => {
      const point = {
        i: prev.length,
        delta: parseFloat((oiData.oiDeltaPct * 100).toFixed(3)),
      };
      const next = [...prev, point];
      return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
    });
  }, [oiData]);

  return (
    <div className="card">
      <div style={{ color: 'var(--accent-blue)', marginBottom: 8, fontSize: 12 }}>OI — {symbol}</div>
      {live ? (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 6, fontSize: 12 }}>
            <span>
              OI Δ 15m:{' '}
              <span className={live.oiDeltaPct >= 0 ? 'tag-green' : 'tag-red'}>
                {(live.oiDeltaPct * 100).toFixed(2)}%
              </span>
            </span>
            <span>
              Funding:{' '}
              <span className={live.fundingRate > 0.001 ? 'tag-red' : 'tag-green'}>
                {(live.fundingRate * 100).toFixed(4)}%
              </span>
            </span>
            <span>
              L/S:{' '}
              <span style={{ color: 'var(--accent-gold)' }}>
                {live.longShortRatio?.toFixed(2)}
              </span>
            </span>
          </div>
          {history.length > 1 && (
            <ResponsiveContainer width="100%" height={50}>
              <LineChart data={history}>
                <XAxis dataKey="i" hide />
                <YAxis domain={['auto', 'auto']} hide />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-card)', border: 'none', fontSize: 10 }}
                  formatter={(v) => [`${v}%`, 'OI Δ']}
                />
                <Line
                  type="monotone"
                  dataKey="delta"
                  dot={false}
                  stroke="var(--accent-blue)"
                  strokeWidth={1.5}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </>
      ) : (
        <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Waiting for OI data…</div>
      )}
    </div>
  );
}
