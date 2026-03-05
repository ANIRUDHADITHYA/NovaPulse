import { useState } from 'react';
import { runBacktest } from '../services/api';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export default function BacktestPanel() {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [lookback, setLookback] = useState(90);

  const handleRun = async () => {
    setRunning(true);
    setError('');
    try {
      const res = await runBacktest(lookback);
      setReport(res.data);
    } catch (e) {
      setError(e.response?.data?.error || 'Backtest failed');
    } finally {
      setRunning(false);
    }
  };

  // Build equity curve data from trades
  const equityData = report?.trades
    ? report.trades.reduce((acc, t) => {
        const prev = acc.length > 0 ? acc[acc.length - 1].equity : 100;
        acc.push({ equity: +(prev * (1 + t.pnlPct / 100)).toFixed(4), i: acc.length });
        return acc;
      }, [])
    : [];

  return (
    <div className="card" style={{ margin: '0 4px 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <span style={{ color: 'var(--accent-blue)', fontSize: 12 }}>BACKTEST ENGINE</span>
        <select
          value={lookback}
          onChange={(e) => setLookback(parseInt(e.target.value))}
          style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--bg-border)', padding: '2px 6px', fontSize: 12 }}
        >
          <option value={30}>30 days</option>
          <option value={60}>60 days</option>
          <option value={90}>90 days</option>
          <option value={180}>180 days</option>
        </select>
        <button onClick={handleRun} disabled={running} style={{ fontSize: 11 }}>
          {running ? 'Running…' : 'Run Backtest'}
        </button>
        {error && <span style={{ color: 'var(--accent-red)', fontSize: 11 }}>{error}</span>}
      </div>

      {report && (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ fontSize: 12, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <span
              style={{
                padding: '1px 8px',
                borderRadius: 4,
                fontWeight: 700,
                fontSize: 11,
                background: report.passed ? 'rgba(0,200,100,0.15)' : 'rgba(220,50,50,0.15)',
                color: report.passed ? 'var(--accent-green, #00c87f)' : 'var(--accent-red)',
                border: `1px solid ${report.passed ? 'var(--accent-green, #00c87f)' : 'var(--accent-red)'}`,
              }}
            >
              {report.passed ? '✅ PASSED' : '❌ FAILED'}
            </span>
            <span>Trades: <b style={{ color: 'var(--accent-gold)' }}>{report.totalTrades}</b></span>
            <span>Win Rate: <b className={parseFloat(report.winRate) >= report.passCriteria?.winRate ? 'tag-green' : 'tag-red'}>{report.winRate}%</b></span>
            <span>Avg P&L: <b className={parseFloat(report.avgPnlPct) >= (report.passCriteria?.avgPnlPct ?? 0) ? 'tag-green' : 'tag-red'}>{report.avgPnlPct}%</b></span>
            <span>Max DD: <b className={parseFloat(report.maxDrawdownPct) <= (report.passCriteria?.maxDrawdownPct ?? 8) ? 'tag-green' : 'tag-red'}>{report.maxDrawdownPct}%</b></span>
            <span>Sharpe: <b style={{ color: parseFloat(report.sharpeRatio) >= 1.5 ? 'var(--accent-green, #00c87f)' : 'var(--text-secondary, #999)' }}>{report.sharpeRatio}</b></span>
            <span>Final Equity: <b style={{ color: 'var(--accent-gold)' }}>{report.finalEquity}</b></span>
          </div>
          {equityData.length > 0 && (
            <div style={{ flex: 1, height: 80 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equityData}>
                  <XAxis dataKey="i" hide />
                  <YAxis domain={['auto', 'auto']} hide />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-card)', border: 'none', fontSize: 11 }}
                    formatter={(v) => [v, 'Equity']}
                  />
                  <Line type="monotone" dataKey="equity" dot={false} stroke="var(--accent-blue)" strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
