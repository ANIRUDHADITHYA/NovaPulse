import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../services/api';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(password);
      navigate('/');
    } catch {
      setError('Invalid password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <div className="card" style={{ width: 320, textAlign: 'center' }}>
        <h2 style={{ color: 'var(--accent-blue)', marginBottom: 24 }}>🌌 NovaPulse</h2>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            placeholder="Dashboard password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{
              width: '100%', padding: '8px', marginBottom: 12,
              background: 'var(--bg-primary)', color: 'var(--text-primary)',
              border: '1px solid var(--bg-border)', borderRadius: 4,
              fontFamily: 'var(--font)', fontSize: 13,
            }}
          />
          {error && <p style={{ color: 'var(--accent-red)', marginBottom: 8 }}>{error}</p>}
          <button type="submit" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Authenticating...' : 'Enter'}
          </button>
        </form>
      </div>
    </div>
  );
}
