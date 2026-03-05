export default function SentimentBar({ sentimentData }) {
  const v = sentimentData?.value ?? 50;
  const label = sentimentData?.classification ?? 'Loading…';
  const color =
    v <= 25 ? 'var(--accent-green)' :
    v <= 45 ? '#66bb6a' :
    v <= 55 ? 'var(--accent-gold)' :
    v <= 75 ? '#ffa726' : 'var(--accent-red)';

  return (
    <div className="card">
      <div style={{ color: 'var(--accent-blue)', marginBottom: 6, fontSize: 12 }}>
        FEAR &amp; GREED INDEX
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            flex: 1, height: 10, background: 'var(--bg-border)',
            borderRadius: 5, overflow: 'hidden',
          }}
        >
          <div style={{ width: `${v}%`, height: '100%', background: color, transition: 'width 0.5s' }} />
        </div>
        <span style={{ color, minWidth: 40, fontSize: 13, fontWeight: 'bold' }}>{v}</span>
        <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{label}</span>
      </div>
    </div>
  );
}
