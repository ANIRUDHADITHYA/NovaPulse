import { useEffect, useRef } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import { getCandles } from '../services/api';

export default function Chart({ symbol, lastCandle, lastSignal }) {
  const containerRef = useRef(null);
  const chartRef     = useRef(null);
  const seriesRef    = useRef(null);
  const markersRef   = useRef([]);

  // ── Create the chart once ──────────────────────────────────────────
  useEffect(() => {
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: '#0a0a0f' }, textColor: '#8888aa' },
      grid: { vertLines: { color: '#1e1e2e' }, horzLines: { color: '#1e1e2e' } },
      width:  containerRef.current.clientWidth,
      height: containerRef.current.clientHeight || 340,
    });
    const candleSeries = chart.addCandlestickSeries({
      upColor:      '#00e676',
      downColor:    '#ff1744',
      borderVisible: false,
      wickUpColor:  '#00e676',
      wickDownColor:'#ff1744',
    });
    chartRef.current  = chart;
    seriesRef.current = candleSeries;

    const ro = new ResizeObserver(() => {
      if (containerRef.current)
        chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);
    return () => { ro.disconnect(); chart.remove(); };
  }, []);

  // ── Load historical candles whenever symbol changes ────────────────
  useEffect(() => {
    if (!seriesRef.current || !symbol) return;
    // clear existing data + markers immediately
    seriesRef.current.setData([]);
    seriesRef.current.setMarkers([]);
    markersRef.current = [];

    getCandles(symbol, 300)
      .then(({ data }) => {
        if (!seriesRef.current) return;
        const bars = data.map((c) => ({
          time:  Math.floor(new Date(c.timestamp).getTime() / 1000),
          open:  c.open,
          high:  c.high,
          low:   c.low,
          close: c.close,
        }));
        if (bars.length) {
          seriesRef.current.setData(bars);
          chartRef.current?.timeScale().fitContent();
        }
      })
      .catch(() => { /* no historical data yet — live feed will fill it */ });
  }, [symbol]);

  // ── Stream: push each new candle tick ─────────────────────────────
  useEffect(() => {
    if (!lastCandle || !seriesRef.current) return;
    seriesRef.current.update({
      time:  Math.floor(new Date(lastCandle.timestamp).getTime() / 1000),
      open:  lastCandle.open,
      high:  lastCandle.high,
      low:   lastCandle.low,
      close: lastCandle.close,
    });
  }, [lastCandle]);

  // ── Signal markers ────────────────────────────────────────────────
  useEffect(() => {
    if (!lastSignal || !seriesRef.current) return;
    if (lastSignal.finalSignal === 'BUY' || lastSignal.finalSignal === 'SELL') {
      const marker = {
        time:     Math.floor(new Date(lastSignal.timestamp).getTime() / 1000),
        position: lastSignal.finalSignal === 'BUY' ? 'belowBar' : 'aboveBar',
        color:    lastSignal.finalSignal === 'BUY' ? '#00e676' : '#ff1744',
        shape:    lastSignal.finalSignal === 'BUY' ? 'arrowUp'  : 'arrowDown',
        text:     lastSignal.finalSignal,
      };
      markersRef.current = [...markersRef.current, marker]
        .slice(-50) // cap at 50 markers
        .sort((a, b) => a.time - b.time);
      seriesRef.current.setMarkers(markersRef.current);
    }
  }, [lastSignal]);

  return (
    <div style={{ height: '100%', minHeight: 340, display: 'flex', flexDirection: 'column' }}>
      <div style={{ color: 'var(--accent-blue)', marginBottom: 4, fontSize: 12, flexShrink: 0 }}>
        {symbol} <span style={{ color: 'var(--text-secondary)', fontSize: 10 }}>15m</span>
      </div>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}
