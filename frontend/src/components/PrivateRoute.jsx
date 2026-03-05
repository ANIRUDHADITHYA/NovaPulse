import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { getMe } from '../services/api';

export default function PrivateRoute({ children }) {
  const [auth, setAuth] = useState(null); // null = loading

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    getMe({ signal: controller.signal })
      .then(() => setAuth(true))
      .catch((err) => {
        // Ignore aborts (React StrictMode double-invoke / component unmount)
        if (err?.name === 'AbortError' || err?.code === 'ERR_CANCELED') return;
        setAuth(false);
      })
      .finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); };
  }, []);

  if (auth === null) {
    return <div className="loading">Verifying session…</div>;
  }
  if (!auth) {
    return <Navigate to="/login" replace />;
  }
  return children;
}
