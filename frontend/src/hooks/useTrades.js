import { useState, useEffect, useCallback } from 'react';
import { getTrades, getOpenTrades, getTradeStats } from '../services/api';

export default function useTrades(symbol) {
  const [trades, setTrades] = useState([]);
  const [openTrades, setOpenTrades] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [t, o, s] = await Promise.all([
        getTrades(symbol),
        getOpenTrades(),
        getTradeStats(),
      ]);
      setTrades(t.data);
      setOpenTrades(o.data);
      setStats(s.data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  return { trades, openTrades, stats, loading, refresh: fetchAll };
}
