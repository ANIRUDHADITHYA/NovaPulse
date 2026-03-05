import { pauseTrading, resumeTrading } from '../services/api';

export default function RiskPanel({ pnlState, riskState }) {
  const daily = pnlState?.dailyPnlPct ?? 0;
  const maxDrawdown = 2;
  const barPct = Math.min(Math.abs(daily) / maxDrawdown * 100, 100);
  const halted = pnlState?.tradingHalted;

  return (
    <div className="card">
      <div style={{ color: 'var(--accent-blue)', marginBottom: 8, fontSize: 12 }}>RISK METER</div>

      {/* Daily P&L progress bar */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Daily P&L</span>
          <span className={daily >= 0 ? 'tag-green' : 'tag-red'}>
            {daily >= 0 ? '+' : ''}{Number(daily).toFixed(2)}% / {maxDrawdown}%
          </span>
        </div>
        <div style={{ height: 8, background: 'var(--bg-border)', borderRadius: 4, overflow: 'hidden' }}>
          <div
            style={{
              width: `${barPct}%`, height: '100%', borderRadius: 4,
              background: barPct > 80 ? 'var(--accent-red)' : barPct > 50 ? 'var(--accent-gold)' : 'var(--accent-green)',
              transition: 'width 0.4s',
            }}
          />
        </div>
      </div>

      <div style={{ marginBottom: 8, fontSize: 12 }}>
        Open positions:{' '}
        <span style={{ color: 'var(--accent-gold)' }}>{pnlState?.openPositions ?? 0}</span>
      </div>

      <div style={{ marginBottom: 12 }}>
        Status:{' '}
        {halted ? (
          <span className="tag-red">⛔ HALTED</span>
        ) : (
          <span className="tag-green">✅ Active</span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => pauseTrading()} style={{ flex: 1, fontSize: 11 }}>Pause</button>
        <button onClick={() => resumeTrading()} style={{ flex: 1, fontSize: 11 }}>Resume</button>
      </div>
    </div>
  );
}
