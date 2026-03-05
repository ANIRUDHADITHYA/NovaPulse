import { useState } from 'react';
import useSocket from '../hooks/useSocket';
import Navbar from './Navbar';
import Chart from './Chart';
import SignalPanel from './SignalPanel';
import OIPanel from './OIPanel';
import SentimentBar from './SentimentBar';
import OpenOrders from './OpenOrders';
import TradeHistory from './TradeHistory';
import RiskPanel from './RiskPanel';
import BacktestPanel from './BacktestPanel';
import APIStatus from './APIStatus';

export default function Dashboard() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const socket = useSocket();

  return (
    <div className="dash-wrapper">
      <Navbar
        symbol={symbol}
        setSymbol={setSymbol}
        connected={socket.connected}
        pnlState={socket.pnlState}
      />

      {/* ── Main body ── */}
      <div className="dash-body">

        {/* ── Left column: chart on top, orders+trades on bottom ── */}
        <div className="dash-left">
          <div className="card dash-chart">
            <Chart
              symbol={symbol}
              lastCandle={socket.lastCandle[symbol]}
              lastSignal={socket.lastSignal[symbol]}
            />
          </div>
          <div className="dash-bottom">
            <div className="dash-orders">
              <OpenOrders symbol={symbol} openOrders={socket.openOrders} lastCandle={socket.lastCandle} />
            </div>
            <div className="dash-trades">
              <TradeHistory symbol={symbol} tradeEvents={socket.tradeEvents} />
            </div>
          </div>
        </div>

        {/* ── Right column: signal panel + sidebar ── */}
        <div className="dash-right">
          <div className="dash-signal">
            <SignalPanel symbol={symbol} lastSignal={socket.lastSignal[symbol]} />
          </div>
          <div className="dash-sidebar">
            <OIPanel symbol={symbol} oiData={socket.oiState[symbol]} />
            <SentimentBar sentimentData={socket.sentimentState} />
            <RiskPanel pnlState={socket.pnlState} riskState={socket.riskState} />
          </div>
        </div>

      </div>

      {/* ── API Status strip (always visible) ── */}
      <div className="dash-statusbar">
        <APIStatus />
      </div>

      {/* ── Backtest panel (full-width footer) ── */}
      <BacktestPanel />
    </div>
  );
}
