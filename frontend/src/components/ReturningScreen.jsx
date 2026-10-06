import logo from '../assets/logo.png'

const FLOAT_CIRCLES = [
  { size: 260, color: 'var(--circle-1)', top: '15%', left: '5%',  dur: '12s', delay: '0s' },
  { size: 200, color: 'var(--circle-2)', top: '65%', left: '78%', dur: '15s', delay: '2s' },
  { size: 160, color: 'var(--circle-3)', top: '35%', right: '6%', dur: '10s', delay: '4s' },
]

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export default function ReturningScreen({ returnContext, onContinue, waking = false, onGoHome }) {
  const items   = returnContext?.urgentItems ?? []
  const name    = returnContext?.name ?? ''
  const stack   = returnContext?.stack ?? []
  const learning = returnContext?.learning_stack ?? []
  const message = returnContext?.message ?? 'Your career memory has been restored.'

  // Build a short "last active" phrase
  const lastVisit = returnContext?.lastVisit
  let lastActive = ''
  if (lastVisit) {
    const days = Math.round((Date.now() - new Date(lastVisit).getTime()) / 86400000)
    lastActive = days === 0 ? 'Active today' : days === 1 ? 'Last active yesterday' : `Last active ${plural(days, 'day')} ago`
  }

  return (
    <div className="opening-screen">
      {waking && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 20px',
          background: 'var(--warning-bg)',
          borderBottom: '1px solid var(--warning-border)',
        }}>
          <span style={{ fontSize: 13 }}>⏳</span>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>
            backend warming up — <span style={{ color: 'var(--text)', fontWeight: 700 }}>give it ~30s on first load</span>
          </p>
        </div>
      )}
      {FLOAT_CIRCLES.map((c, i) => (
        <div
          key={i}
          className="opening-blob"
          style={{
            width: c.size, height: c.size,
            background: c.color,
            top: c.top, left: c.left, right: c.right, bottom: c.bottom,
            animationDuration: c.dur, animationDelay: c.delay,
          }}
        />
      ))}

      <div className="opening-card animate-fade-up" style={{ maxWidth: 420, textAlign: 'center' }}>
        {/* Necto Mono wordmark */}
        <button
          type="button"
          onClick={onGoHome}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 20 }}
        >
          <img src={logo} alt="Grafted" style={{ width: 30, height: 30, borderRadius: 9, objectFit: 'cover' }} />
          <span className="brand-word">grafted</span>
        </button>

        <h2 className="opening-heading" style={{ marginBottom: 6 }}>
          Welcome back{name ? `, ${name}` : ''}
        </h2>

        <p style={{ fontSize: 13, color: 'var(--text-sub)', lineHeight: 1.6, marginBottom: 16 }}>
          {message}
        </p>

        {/* Stack preview */}
        {stack.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Your stack
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
              {stack.slice(0, 6).map(skill => (
                <span
                  key={skill}
                  style={{
                    padding: '3px 10px',
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 500,
                    background: 'var(--info-bg)',
                    border: '1px solid var(--info-border)',
                    color: 'var(--info)',
                  }}
                >
                  {skill}
                </span>
              ))}
              {learning.slice(0, 2).map(skill => (
                <span
                  key={skill}
                  style={{
                    padding: '3px 10px',
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 500,
                    background: 'var(--warning-bg)',
                    border: '1px solid var(--warning-border)',
                    color: 'var(--warning)',
                  }}
                >
                  ⏳ {skill}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Urgent items */}
        {items.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 16 }}>
            {items.slice(0, 3).map((item, i) => (
              <span
                key={i}
                style={{
                  padding: '4px 12px',
                  borderRadius: 999,
                  fontSize: 12,
                  background:    item.daysLeft < 3 ? 'var(--danger-bg)'  : 'var(--warning-bg)',
                  border:        `1px solid ${item.daysLeft < 3 ? 'var(--danger-border)' : 'var(--warning-border)'}`,
                  color:         item.daysLeft < 3 ? 'var(--danger)'     : 'var(--warning)',
                }}
              >
                {item.name}{item.daysLeft != null ? ` · ${item.daysLeft}d left` : ' hiring'}
              </span>
            ))}
          </div>
        )}

        <button
          type="button"
          className="opening-cta"
          onClick={onContinue}
          style={{ background: 'var(--accent)', color: 'var(--bg-base)', cursor: 'pointer' }}
        >
          Continue →
        </button>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <span className="pulse-dot animate-pulse-dot" />
          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            Career memory loaded{lastActive ? ` · ${lastActive}` : ''}
          </span>
        </div>
      </div>
    </div>
  )
}
