import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  withCredentials: true, // send httpOnly cookie automatically
});

export const login = (password) => api.post('/api/auth/login', { password });
export const logout = () => api.post('/api/auth/logout');
export const getMe = (config) => api.get('/api/auth/me', config);
export const getTrades = (symbol, limit = 50) =>
  api.get('/api/trades', { params: { symbol, limit } });
export const getOpenTrades = () => api.get('/api/trades/open');
export const getTradeStats = () => api.get('/api/trades/stats');
export const getBalance = () => api.get('/api/balance');
export const getSignals = (symbol, limit = 20) =>
  api.get('/api/signals', { params: { symbol, limit } });
export const getLatestSignal = (symbol) =>
  api.get('/api/signals/latest', { params: { symbol } });
export const getPerformance = () => api.get('/api/performance');
export const getPerformanceHistory = (limit = 30) =>
  api.get('/api/performance/history', { params: { limit } });
export const pauseTrading = () => api.post('/api/trading/pause');
export const resumeTrading = () => api.post('/api/trading/resume');
export const cancelOrder = (symbol, orderId) => api.delete(`/api/orders/${symbol}/${orderId}`);
export const runBacktest = (lookbackDays = 90, symbols) =>
  api.get('/api/backtest/run', { params: { lookbackDays, ...(symbols && { symbols: symbols.join(',') }) } });

export const getAPIStatus = () => api.get('/api/status');
export const getCandles  = (symbol, limit = 300) => api.get('/api/candles', { params: { symbol, limit } });
export const getOI       = (symbol) => api.get('/api/oi', { params: { symbol } });

export default api;
