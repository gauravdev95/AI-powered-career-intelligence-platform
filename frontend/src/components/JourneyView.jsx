import { useEffect, useState } from 'react'
import axios from '../lib/api.js'

const API = import.meta.env.VITE_API_URL || ''

/**
 * Career timeline.
 *
 * Blueprint Ledger: event colour is carried by a `data-tone` attribute rather than
 * an inline hex, so the palette lives entirely in CSS and the theme switcher can
 * reach it. Data logic and the normalisation shim are unchanged.
 */

const TYPE_META = {
  skill_learned: { icon: '✓', tone: 'moss', label: 'Skill Learned' },
  wiki_ingest: { icon: '↓', tone: 'blue', label: 'Wiki Ingest' },
  profile_update: { icon: '✎', tone: 'ink', label: 'Profile Update' },
  roadmap_gen: { icon: '◇', tone: 'ochre', label: 'Roadmap Generated' },
  chat_session: { icon: '◈', tone: 'blue', label: 'Chat Session' },
  startup_viewed: { icon: '▣', tone: 'ochre', label: 'Startup Viewed' },
  hackathon_viewed: { icon: '▲', tone: 'moss', label: 'Hackathon Viewed' },
  gap_analysis_run: { icon: '◐', tone: 'accent', label: 'Gap Analysis' },
  account_created: { icon: '★', tone: 'accent', label: 'Account Created' },
  return_visit: { icon: '↺', tone: 'blue', label: 'Return Visit' },
  default: { icon: '·', tone: 'ink', label: 'Event' },
}

/** Normalises a stored journey event (which uses a `data` field) into the flat
 *  shape JourneyEntry expects. */
function normaliseEntry(entry) {
  const d = entry.data ?? {}
  return {
    ...entry,
    title: entry.title
      ?? d.startupName
      ?? d.hackathonName
      ?? d.message
      ?? (d.top_gap ? `Top gap: ${d.top_gap}` : null)
      ?? entry.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    description: entry.description
      ?? (d.match_score != null ? `Match score: ${d.match_score}%` : null)
      ?? (d.targets ? `Targets: ${d.targets.join(', ')}` : null)
      ?? null,
    skills: entry.skills ?? d.stack ?? null,
  }
}

function timeSince(dateStr) {
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return dateStr ?? ''
  const diff = (Date.now() - date) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function JourneyEntry({ entry }) {
  const meta = TYPE_META[entry.type] ?? TYPE_META.default
  return (
    <div className="journey-entry" data-tone={meta.tone}>
      <div className="journey-line">
        <div className="journey-dot">
          <span className="journey-dot-glyph">{meta.icon}</span>
        </div>
        <div className="journey-connector" />
      </div>
      <div className="journey-card">
        <div className="journey-card-header">
          <span className="journey-type-badge">{meta.label}</span>
          <span className="journey-time">{timeSince(entry.timestamp)}</span>
        </div>
        {entry.title && <p className="journey-title">{entry.title}</p>}
        {entry.description && <p className="journey-desc">{entry.description}</p>}
        {entry.skills?.length > 0 && (
          <div className="journey-tags">
            {entry.skills.map(skill => (
              <span key={skill} className="journey-tag">{skill}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const EMPTY_TIPS = [
  { icon: '↓', text: 'Ingest a startup careers page', tone: 'blue' },
  { icon: '✓', text: 'Mark a skill as learned in the graph', tone: 'moss' },
  { icon: '◇', text: 'Generate your learning roadmap', tone: 'ochre' },
]

function EmptyJourney() {
  return (
    <div className="journey-empty">
      <div className="journey-empty-mark">◷</div>
      <p className="journey-empty-title">Your journey starts here</p>
      <p className="journey-empty-body">
        As you learn skills, ingest career content, and generate roadmaps — they&apos;ll appear here as a
        timeline of your growth.
      </p>
      <div className="journey-tips">
        {EMPTY_TIPS.map(tip => (
          <div className="journey-tip" data-tone={tip.tone} key={tip.text}>
            <span className="journey-tip-icon">{tip.icon}</span>
            <span className="journey-tip-text">{tip.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function JourneyView({ userId }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!userId) { setLoading(false); return }

    setLoading(true)
    axios.get(`${API}/api/journey/${userId}`)
      .then(({ data }) => setEntries(data.journey ?? []))
      .catch(err => {
        // Gracefully degrade — the journey endpoint may not exist yet.
        if (err.response?.status === 404) setEntries([])
        else setError('Could not load journey.')
      })
      .finally(() => setLoading(false))
  }, [userId])

  if (loading) {
    return (
      <div className="journey-loading">
        <div className="spinner" />
        <p className="journey-loading-text">Loading your journey…</p>
      </div>
    )
  }

  if (error) return <p className="journey-error">{error}</p>

  return (
    <div className="journey-view">
      <div className="journey-header">
        <h3 className="journey-heading">My Journey</h3>
        <span className="journey-count">
          {entries.length} event{entries.length !== 1 ? 's' : ''}
        </span>
      </div>

      {entries.length === 0 ? (
        <EmptyJourney />
      ) : (
        <div className="journey-list">
          {entries
            .slice()
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .map((entry, i) => (
              <JourneyEntry key={entry.id ?? i} entry={normaliseEntry(entry)} />
            ))}
        </div>
      )}
    </div>
  )
}
