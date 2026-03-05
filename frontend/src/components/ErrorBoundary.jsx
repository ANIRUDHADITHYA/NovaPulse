import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, countdown: 10 };
    this._timer = null;
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[NovaPulse ErrorBoundary]', error, info);
  }

  componentDidUpdate(_, prevState) {
    if (this.state.hasError && !prevState.hasError) {
      this._timer = setInterval(() => {
        this.setState((s) => {
          if (s.countdown <= 1) {
            clearInterval(this._timer);
            window.location.reload();
          }
          return { countdown: s.countdown - 1 };
        });
      }, 1000);
    }
  }

  componentWillUnmount() {
    clearInterval(this._timer);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100vh', flexDirection: 'column', gap: 16, color: 'var(--accent-red)',
          }}
        >
          <h2>Connection lost — attempting to reconnect…</h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            Auto-refresh in {this.state.countdown}s
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
