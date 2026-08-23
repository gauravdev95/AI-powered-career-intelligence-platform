function lastActiveText(lastActiveAt) {
  if (!lastActiveAt) return 'recently'
  const days = Math.floor((Date.now() - new Date(lastActiveAt).getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

export default function MemoryBadge({ context, onDismiss }) {
  if (!context?.hasHistory) return null

  const urgentItems = (context.urgentItems ?? []).slice(0, 2)

  return (
    <div className="memory-banner">
      <div className="memory-copy">
        <div className="memory-label">
          <span className="pulse-dot" style={{ background: 'var(--accent)', width: 6, height: 6 }} />
          memory engine · active
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 2 }}>
          {context.message}
        </div>
      </div>

      {urgentItems.length > 0 && (
        <div className="pill-row" style={{ flexShrink: 0 }}>
          {urgentItems.map((item, i) => (
            <span
              key={`${item.name}-${i}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 10px',
                borderRadius: 999,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                background: 'var(--warning-bg)',
                border: '1px solid var(--warning-border)',
                color: 'var(--warning)',
                whiteSpace: 'nowrap',
              }}
            >
              ⚡ {item.type === 'hackathon' ? `${item.name} · ${item.daysLeft}d` : `${item.name} hiring`}
            </span>
          ))}
        </div>
      )}

      <button
        className="panel-close"
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss memory banner"
        style={{ flexShrink: 0 }}
      >
        ×
      </button>
    </div>
  )
}
