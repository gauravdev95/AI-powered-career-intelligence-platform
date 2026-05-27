import { useEffect, useState } from 'react'
import axios from '../lib/api.js'

const API_BASE = import.meta.env.VITE_API_URL || ''

const TYPE_COLORS = {
  course: '#3B82F6',
  docs: '#8B5CF6',
  project: '#F97316',
  article: '#10B981',
}

function WeekCard({ week, isActive }) {
  const [open, setOpen] = useState(isActive)

  return (
    <div className={`week-card ${open ? 'open' : ''}`}>
      <button className="week-header" type="button" onClick={() => setOpen(o => !o)}>
        <div className="week-meta">
          <span className="week-number">Week {week.week}</span>
          <span className="week-theme">{week.theme}</span>
        </div>
        {week.focus_skill && <span className="week-focus">{week.focus_skill}</span>}
        <svg className="week-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="week-body">
          {week.tasks?.length > 0 && (
            <div className="week-section">
              <p className="week-section-title">Tasks</p>
              <ul className="week-tasks">
                {week.tasks.map((task, i) => (
                  <li key={i} className="week-task">
                    <span className="task-check" />
                    {task}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {week.resources?.length > 0 && (
            <div className="week-section">
              <p className="week-section-title">Resources</p>
              <div className="week-resources">
                {week.resources.map((r, i) => (
                  <a
                    key={i}
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="resource-link"
                  >
                    <span
                      className="resource-type"
                      style={{ background: `${TYPE_COLORS[r.type] ?? '#94A3B8'}20`, color: TYPE_COLORS[r.type] ?? '#94A3B8' }}
                    >
                      {r.type}
                    </span>
                    {r.title}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" style={{ marginLeft: 'auto', opacity: 0.5 }}>
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                ))}
              </div>
            </div>
          )}

          {week.milestone && (
            <div className="week-milestone">
              <span className="milestone-icon">🎯</span>
              <span>{week.milestone}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function RoadmapView({ userId }) {
  const [roadmap, setRoadmap] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!userId) return
    fetchRoadmap()
  }, [userId])

  async function fetchRoadmap() {
    setLoading(true)
    setError(null)
    try {
      const { data } = await axios.get(`${API_BASE}/api/roadmap/${userId}`)
      setRoadmap(data)
    } catch (err) {
      setError(err.appMessage ?? 'Failed to load roadmap')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="roadmap-view">
        <div className="roadmap-loading">
          <div className="spinner" style={{ width: 28, height: 28 }} />
          <p>Generating your personalized roadmap…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="roadmap-view">
        <div className="roadmap-error">
          <p>{error}</p>
          <button className="btn btn-outline" type="button" onClick={fetchRoadmap}>Retry</button>
        </div>
      </div>
    )
  }

  if (!roadmap) {
    return (
      <div className="roadmap-view">
        <div className="roadmap-empty">
          <p>No roadmap yet. Complete a gap analysis first.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="roadmap-view">
      <div className="roadmap-header">
        <h2 className="roadmap-title">Your 4-Week Roadmap</h2>
        {roadmap.summary && <p className="roadmap-summary">{roadmap.summary}</p>}
        <button className="btn btn-outline" type="button" onClick={fetchRoadmap} style={{ marginTop: 12 }}>
          Regenerate
        </button>
      </div>

      <div className="roadmap-weeks">
        {(roadmap.weeks ?? []).map((week, i) => (
          <WeekCard key={week.week ?? i} week={week} isActive={i === 0} />
        ))}
      </div>
    </div>
  )
}
