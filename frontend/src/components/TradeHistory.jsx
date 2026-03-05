export default function TradeHistory({ symbol, tradeEvents }) {
  const filtered = tradeEvents.filter((t) => !symbol || t.symbol === symbol);

  return (
    <div className="card">
      <div style={{ color: 'var(--accent-blue)', marginBottom: 8, fontSize: 12 }}>
        TRADE HISTORY {symbol && `— ${symbol}`}
      </div>
      {filtered.length === 0 ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>No closed trades yet</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Pair</th>
              <th>Entry</th>
              <th>Exit</th>
              <th>P&amp;L</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 20).map((t, i) => (
              <tr key={i}>
                <td>{t.symbol}</td>
                <td>${Number(t.entryPrice).toLocaleString()}</td>
                <td>${Number(t.exitPrice).toLocaleString()}</td>
                <td className={t.pnlPct >= 0 ? 'tag-green' : 'tag-red'}>
                  {t.pnlPct >= 0 ? '+' : ''}{Number(t.pnlPct).toFixed(2)}%
                </td>
                <td style={{ color: t.status === 'CLOSED_TP' ? 'var(--accent-green)' : 'var(--accent-red)', fontSize: 11 }}>
                  {t.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
