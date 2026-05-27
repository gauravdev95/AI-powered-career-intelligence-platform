import { useEffect, useState } from 'react'
import axios from '../lib/api.js'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const TYPE_META = {
  skill_learned:    { icon: '✅', color: '#A6E3A1', label: 'Skill Learned' },
  wiki_ingest:      { icon: '📥', color: '#89B4FA', label: 'Wiki Ingest' },
  profile_update:   { icon: '✏️', color: '#CBA6F7', label: 'Profile Update' },
  roadmap_gen:      { icon: '🗺',  color: '#FAB387', label: 'Roadmap Generated' },
  chat_session:     { icon: '💬', color: '#94E2D5', label: 'Chat Session' },
  startup_viewed:   { icon: '🏢', color: '#FAB387', label: 'Startup Viewed' },
  hackathon_viewed: { icon: '🏆', color: '#CBA6F7', label: 'Hackathon Viewed' },
  gap_analysis_run: { icon: '🔍', color: '#F38BA8', label: 'Gap Analysis' },
  account_created:  { icon: '🚀', color: '#A6E3A1', label: 'Account Created' },
  return_visit:     { icon: '👋', color: '#89B4FA', label: 'Return Visit' },
  default:          { icon: '📍', color: '#7F849C', label: 'Event' },
}

/** Normalise a raw HydraDB journey event (which uses a `data` field) into the
 *  flat shape expected by JourneyEntry. */
function normaliseEntry(entry) {
  const d = entry.data ?? {}
  return {
    ...entry,
    title: entry.title
      ?? d.startupName
      ?? d.hackathonName
      ?? d.message
      ?? (d.top_gap ? `Top gap: ${d.top_gap}` : null)
      ?? (entry.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())),
    description: entry.description
      ?? (d.match_score != null ? `Match score: ${d.match_score}%` : null)
      ?? (d.targets ? `Targets: ${d.targets.join(', ')}` : null)
      ?? null,
    skills: entry.skills
      ?? (d.stack ? d.stack : null)
      ?? null,
  }
}

function timeSince(dateStr) {
  const date = new Date(dateStr)
  if (isNaN(date)) return dateStr ?? ''
  const diff = (Date.now() - date) / 1000
  if (diff < 60)   return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function JourneyEntry({ entry, index }) {
  const meta = TYPE_META[entry.type] ?? TYPE_META.default
  return (
    <div className="journey-entry" style={{ '--entry-color': meta.color }}>
      <div className="journey-line">
        <div className="journey-dot" style={{ background: meta.color, boxShadow: `0 0 8px ${meta.color}55` }}>
          <span style={{ fontSize: 12 }}>{meta.icon}</span>
        </div>
        {/* Vertical line, hidden for last */}
        <div className="journey-connector" />
      </div>
      <div className="journey-card">
        <div className="journey-card-header">
          <span className="journey-type-badge" style={{ color: meta.color, background: `${meta.color}18`, border: `1px solid ${meta.color}40` }}>
            {meta.label}
          </span>
          <span className="journey-time">{timeSince(entry.timestamp)}</span>
        </div>
        {entry.title && <p className="journey-title">{entry.title}</p>}
        {entry.description && <p className="journey-desc">{entry.description}</p>}
        {entry.skills && entry.skills.length > 0 && (
          <div className="journey-tags">
            {entry.skills.map(s => (
              <span key={s} className="journey-tag" style={{ color: meta.color, borderColor: `${meta.color}40` }}>{s}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyJourney() {
  return (
    <div className="journey-empty">
      <div style={{ fontSize: 48, marginBottom: 12 }}>🗺</div>
      <p style={{ color: '#CDD6F4', fontWeight: 600, marginBottom: 6 }}>Your journey starts here</p>
      <p style={{ color: '#7F849C', fontSize: 13, lineHeight: 1.6 }}>
        As you learn skills, ingest career content, and generate roadmaps — they'll appear here as a timeline of your growth.
      </p>
      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[
          { icon: '📥', text: 'Ingest a startup careers page', color: '#89B4FA' },
          { icon: '✅', text: 'Mark a skill as learned in the graph', color: '#A6E3A1' },
          { icon: '🗺', text: 'Generate your learning roadmap', color: '#FAB387' },
        ].map(tip => (
          <div key={tip.text} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#1E1E2E', borderRadius: 8, border: '1px solid #313244' }}>
            <span style={{ fontSize: 18 }}>{tip.icon}</span>
            <span style={{ fontSize: 12, color: tip.color }}>{tip.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function JourneyView({ userId }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    if (!userId) { setLoading(false); return }

    setLoading(true)
    axios.get(`${API}/api/journey/${userId}`)
      .then(({ data }) => {
        setEntries(data.journey ?? [])
      })
      .catch(err => {
        // Gracefully degrade — journey endpoint may not exist yet
        if (err.response?.status === 404) {
          setEntries([])
        } else {
          setError('Could not load journey.')
        }
      })
      .finally(() => setLoading(false))
  }, [userId])

  if (loading) {
    return (
      <div className="journey-loading">
        <div className="spinner" style={{ width: 28, height: 28 }} />
        <p style={{ color: '#7F849C', fontSize: 13, marginTop: 12 }}>Loading your journey…</p>
      </div>
    )
  }

  if (error) {
    return <p style={{ color: '#F38BA8', fontSize: 13, padding: 16 }}>{error}</p>
  }

  return (
    <div className="journey-view">
      <div className="journey-header">
        <h3 className="journey-heading">My Journey</h3>
        <span style={{ fontSize: 12, color: '#7F849C' }}>{entries.length} event{entries.length !== 1 ? 's' : ''}</span>
      </div>

      {entries.length === 0 ? (
        <EmptyJourney />
      ) : (
        <div className="journey-list">
          {entries
            .slice()
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .map((entry, i) => (
              <JourneyEntry key={entry.id ?? i} entry={normaliseEntry(entry)} index={i} />
            ))}
        </div>
      )}
    </div>
  )
}
