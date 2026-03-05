import { logout } from '../services/api';
import { useNavigate } from 'react-router-dom';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

export default function Navbar({ symbol, setSymbol, connected, pnlState }) {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div
      className="card"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 16px', borderRadius: 0,
      }}
    >
      <span style={{ color: 'var(--accent-blue)', fontWeight: 'bold', fontSize: 15 }}>
        🌌 NOVAPULSE
      </span>

      <div style={{ display: 'flex', gap: 8 }}>
        {SYMBOLS.map((s) => (
          <button
            key={s}
            onClick={() => setSymbol(s)}
            style={{
              background: symbol === s ? 'var(--accent-blue)' : undefined,
              color: symbol === s ? '#000' : undefined,
            }}
          >
            {s.replace('USDT', '')}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {pnlState?.dailyPnlPct !== undefined && (
          <span
            className={pnlState.dailyPnlPct >= 0 ? 'tag-green' : 'tag-red'}
          >
            Daily: {pnlState.dailyPnlPct >= 0 ? '+' : ''}{Number(pnlState.dailyPnlPct).toFixed(2)}%
          </span>
        )}
        <span style={{ color: connected ? 'var(--accent-green)' : 'var(--accent-red)' }}>
          ● {connected ? 'LIVE' : 'OFFLINE'}
        </span>
        {pnlState?.tradingHalted && (
          <span className="tag-red">⛔ HALTED</span>
        )}
        <button onClick={() => navigate('/portfolio')} style={{ fontSize: 11 }}>Portfolio</button>
        <button onClick={handleLogout} style={{ fontSize: 11 }}>Logout</button>
      </div>
    </div>
  );
}
