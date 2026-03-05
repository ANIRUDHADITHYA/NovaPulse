import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { getOpenTrades, getTrades } from '../services/api';

const API_URL = import.meta.env.VITE_API_URL || '';

export default function useSocket() {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [lastCandle, setLastCandle] = useState({});
  const [lastSignal, setLastSignal] = useState({});
  const [openOrders, setOpenOrders] = useState([]);
  const [tradeEvents, setTradeEvents] = useState([]);
  const [pnlState, setPnlState] = useState({});
  const [riskState, setRiskState] = useState({});
  const [oiState, setOiState] = useState({});
  const [sentimentState, setSentimentState] = useState(null);

  // ── Hydrate on mount from REST so refresh / late-join shows existing data ──
  useEffect(() => {
    getOpenTrades()
      .then(({ data }) => {
        if (!data?.length) return;
        const mapped = data.map((t) => ({
          symbol: t.symbol,
          orderId: t.buyOrderId,
          side: 'BUY',
          price: t.entryPrice,
          quantity: t.quantity,
          tpOrderId: t.tpOrderId || null,
          slOrderId: t.slOrderId || null,
          // tpOrderId being set means the buy was filled and TP/SL orders are live
          status: t.tpOrderId ? 'FILLED' : 'PENDING',
        }));
        setOpenOrders(mapped);
      })
      .catch(() => {}); // not logged in yet — ignore

    getTrades(undefined, 50)
      .then(({ data }) => {
        if (!data?.length) return;
        const mapped = data.map((t) => ({
          symbol: t.symbol,
          buyOrderId: t.buyOrderId,
          entryPrice: t.entryPrice,
          exitPrice: t.exitPrice,
          pnlPct: t.pnlPct,
          pnlUsdt: t.pnlUsdt,
          status: t.status,
          closedAt: t.closedAt,
        }));
        setTradeEvents(mapped);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const socket = io(API_URL, { withCredentials: true });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      // Re-hydrate on reconnect (covers backend restart mid-session)
      getOpenTrades()
        .then(({ data }) => {
          const mapped = (data || []).map((t) => ({
            symbol: t.symbol,
            orderId: t.buyOrderId,
            side: 'BUY',
            price: t.entryPrice,
            quantity: t.quantity,
            tpOrderId: t.tpOrderId || null,
            slOrderId: t.slOrderId || null,
            status: t.tpOrderId ? 'FILLED' : 'PENDING',
          }));
          setOpenOrders((prev) => {
            // Merge: REST entries fill gaps; live socket entries take precedence
            const socketIds = new Set(prev.map((o) => o.orderId));
            const fresh = mapped.filter((o) => !socketIds.has(o.orderId));
            return [...prev, ...fresh];
          });
        })
        .catch(() => {});
      getTrades(undefined, 50)
        .then(({ data }) => {
          const mapped = (data || []).map((t) => ({
            symbol: t.symbol,
            buyOrderId: t.buyOrderId,
            entryPrice: t.entryPrice,
            exitPrice: t.exitPrice,
            pnlPct: t.pnlPct,
            pnlUsdt: t.pnlUsdt,
            status: t.status,
            closedAt: t.closedAt,
          }));
          setTradeEvents((prev) => {
            const socketIds = new Set(prev.filter((t) => t.buyOrderId).map((t) => t.buyOrderId));
            const fresh = mapped.filter((t) => !socketIds.has(t.buyOrderId));
            return [...prev, ...fresh].slice(0, 50);
          });
        })
        .catch(() => {});
    });
    socket.on('disconnect', () => setConnected(false));

    socket.on('candle:update', (data) =>
      setLastCandle((prev) => ({ ...prev, [data.symbol]: data }))
    );
    socket.on('signal:buy', (data) =>
      setLastSignal((prev) => ({ ...prev, [data.symbol]: data }))
    );
    socket.on('signal:sell', (data) =>
      setLastSignal((prev) => ({ ...prev, [data.symbol]: data }))
    );
    socket.on('signal:neutral', (data) =>
      setLastSignal((prev) => ({ ...prev, [data.symbol]: data }))
    );
    socket.on('order:opened', (data) =>
      setOpenOrders((prev) => [data, ...prev.filter((o) => o.orderId !== data.orderId)])
    );
    socket.on('order:filled', (data) =>
      setOpenOrders((prev) => prev.map((o) =>
        o.orderId === data.orderId
          ? { ...o, status: 'FILLED', price: data.filledPrice ?? o.price, quantity: data.filledQty ?? o.quantity, tpOrderId: data.tpOrderId ?? o.tpOrderId, slOrderId: data.slOrderId ?? o.slOrderId }
          : o
      ))
    );
    socket.on('order:cancelled', (data) =>
      setOpenOrders((prev) => prev.filter((o) => o.orderId !== data.orderId))
    );
    socket.on('trade:closed', (data) =>
      setTradeEvents((prev) => {
        // Deduplicate against REST-hydrated history using buyOrderId
        const deduped = data.buyOrderId
          ? prev.filter((t) => t.buyOrderId !== data.buyOrderId)
          : prev;
        return [data, ...deduped.slice(0, 49)];
      })
    );
    socket.on('pnl:update', (data) => setPnlState(data));
    socket.on('risk:halted', (data) => setRiskState(data));
    socket.on('oi:update', (data) =>
      setOiState((prev) => ({ ...prev, [data.symbol]: data }))
    );
    socket.on('sentiment:update', (data) => setSentimentState(data));

    return () => socket.disconnect();
  }, []);

  return { connected, lastCandle, lastSignal, openOrders, tradeEvents, pnlState, riskState, oiState, sentimentState };
}
