import { useEffect, useMemo, useState } from 'react'
import axios from '../lib/api.js'
import { Icon } from './icons.jsx'

const API = import.meta.env.VITE_API_URL || ''

const TABS = ['Job Matches', 'Saved Jobs', 'Applications', 'Recommended', 'Company Insights']

const TILE_COLORS = [
  ['#4a6cf7', '#8b5cf6'], ['#059669', '#34d399'], ['#d97706', '#fbbf24'],
  ['#dc2626', '#f87171'], ['#7c3aed', '#a78bfa'], ['#0ea5e9', '#7dd3fc'],
]

function tileColors(name) {
  let h = 0
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 997
  return TILE_COLORS[h % TILE_COLORS.length]
}

function CompanyTile({ name, size = 52 }) {
  const [a, b] = tileColors(name)
  const initials = String(name ?? '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  return (
    <span
      className="jm-tile"
      style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(135deg, ${a}, ${b})` }}
    >
      {initials}
    </span>
  )
}

function loadSaved(userId) {
  try { return JSON.parse(localStorage.getItem(`grafted_saved_jobs_${userId}`) ?? '[]') } catch { return [] }
}

function MatchRing({ score, size = 120 }) {
  const r = 52
  const circ = 2 * Math.PI * r
  const off = circ - (Math.min(100, score) / 100) * circ
  const tone = score >= 75 ? '#34d399' : score >= 50 ? '#fbbf24' : '#f87171'
  return (
    <div className="jm-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 130 130">
        <circle cx="65" cy="65" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="11" />
        <circle cx="65" cy="65" r={r} fill="none" stroke={tone} strokeWidth="11" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={off} transform="rotate(-90 65 65)" />
      </svg>
      <div className="jm-ring-label"><strong>{score}%</strong></div>
    </div>
  )
}

function JobCard({ job, saved, onToggleSave, onInspect }) {
  const analysis = job.analysis
  const skills = job.skills_required ?? []
  return (
    <article className="jm-job">
      <CompanyTile name={job.name} />
      <div className="jm-job-main">
        <div className="jm-job-head">
          <h3>{job.roles_available?.[0] ?? 'Open Role'} {job.apply_url && <Icon name="external" />}</h3>
          <span className="jm-match">{job.match_score}% Match</span>
        </div>
        <p className="jm-job-company">{job.name}</p>
        <div className="jm-job-meta">
          <span className="jm-meta-chip">Full-time</span>
          <span className="jm-meta-chip">{job.location ?? 'India'}</span>
          <span className="jm-meta-chip">{job.min_experience ?? 'Fresher friendly'}</span>
        </div>
        <div className="jm-job-skills">
          {skills.slice(0, 5).map(s => <span key={s} className="jm-skill-chip">{s}</span>)}
          {skills.length > 5 && <span className="jm-skill-chip is-more">+{skills.length - 5}</span>}
        </div>
        {analysis && (
          <p className="jm-job-why">{analysis.assessment}</p>
        )}
      </div>
      <div className="jm-job-side">
        <p className="jm-salary">₹{job.salary_range_lpa ?? '—'} LPA</p>
        <div className="jm-job-actions">
          <button
            type="button"
            className={`jm-icon-btn ${saved ? 'is-saved' : ''}`}
            onClick={() => onToggleSave(job)}
            aria-label={saved ? 'Unsave job' : 'Save job'}
            title={saved ? 'Unsave' : 'Save'}
          >
            <Icon name="resume" />
          </button>
          {job.apply_url ? (
            <a className="jm-btn is-primary sm" href={job.apply_url} target="_blank" rel="noreferrer">
              View &amp; Apply <Icon name="external" />
            </a>
          ) : (
            <button type="button" className="jm-btn is-primary sm" onClick={() => onInspect(job)}>
              View Details
            </button>
          )}
        </div>
      </div>
    </article>
  )
}

function JobArt() {
  return (
    <div className="jm-art" aria-hidden="true">
      <div className="jm-art-laptop"><span className="jm-art-code"><Icon name="code" /></span></div>
      <span className="jm-art-tag t1"><Icon name="roadmap" /> Your Skills</span>
      <span className="jm-art-tag t2"><Icon name="roadmap" /> Job Market</span>
      <span className="jm-art-tag t3"><Icon name="roadmap" /> Perfect Match</span>
      <span className="jm-art-plant" />
    </div>
  )
}

export default function JobMatchPage({ userId }) {
  const [startups, setStartups] = useState([])
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('Job Matches')
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const [minMatch, setMinMatch] = useState(0)
  const [sort, setSort] = useState('match')
  const [saved, setSaved] = useState(() => loadSaved(userId))
  const [alerts, setAlerts] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`grafted_job_alerts_${userId}`) ?? '{}') } catch { return {} }
  })
  const [inspected, setInspected] = useState(null)

  useEffect(() => {
    localStorage.setItem(`grafted_saved_jobs_${userId}`, JSON.stringify(saved))
  }, [saved, userId])

  useEffect(() => {
    localStorage.setItem(`grafted_job_alerts_${userId}`, JSON.stringify(alerts))
  }, [alerts, userId])

  useEffect(() => {
    let alive = true
    async function load() {
      if (!userId) return
      setLoading(true)
      setError('')
      try {
        const [{ data: prof }, { data: an }] = await Promise.all([
          axios.get(`${API}/api/user/${userId}`),
          axios.post(`${API}/api/analyze`, { userId }),
        ])
        if (!alive) return
        setProfile(prof)
        setStartups(an.startups ?? [])
      } catch {
        if (alive) setError('Could not load job matches. Please try again.')
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [userId])

  const toggleSave = job => {
    setSaved(prev => prev.includes(job.id) ? prev.filter(id => id !== job.id) : [...prev, job.id])
  }

  const filtered = useMemo(() => {
    let list = [...startups]
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter(j =>
        j.name?.toLowerCase().includes(q) ||
        (j.roles_available ?? []).some(r => r.toLowerCase().includes(q)) ||
        (j.skills_required ?? []).some(s => s.toLowerCase().includes(q)),
      )
    }
    const loc = location.trim().toLowerCase()
    if (loc) list = list.filter(j => (j.location ?? '').toLowerCase().includes(loc) || loc === 'remote')
    if (minMatch > 0) list = list.filter(j => (j.match_score ?? 0) >= minMatch)
    if (sort === 'match') list.sort((a, b) => (b.match_score ?? 0) - (a.match_score ?? 0))
    else if (sort === 'salary') list.sort((a, b) => parseFloat(b.salary_range_lpa?.split('-')[0]) - parseFloat(a.salary_range_lpa?.split('-')[0]))
    else if (sort === 'name') list.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    return list
  }, [startups, query, location, minMatch, sort])

  const savedJobs = useMemo(() => startups.filter(j => saved.includes(j.id)), [startups, saved])
  const recommended = useMemo(() => [...startups].sort((a, b) => (b.match_score ?? 0) - (a.match_score ?? 0)).slice(0, 5), [startups])

  const stats = useMemo(() => {
    const scores = startups.map(s => s.match_score ?? 0)
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0
    return {
      total: startups.length,
      accuracy: avg,
      fresh: startups.filter(s => s.hiring).length,
      saved: saved.length,
    }
  }, [startups, saved])

  const topSkills = useMemo(() => {
    const freq = {}
    for (const j of startups.slice(0, 10)) {
      for (const s of j.analysis?.matching_skills ?? []) freq[s] = (freq[s] ?? 0) + 1
    }
    return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s]) => s)
  }, [startups])

  const improveSkills = useMemo(() => {
    const set = new Set()
    for (const j of startups.slice(0, 10)) {
      for (const s of j.analysis?.missing_skills ?? []) set.add(s)
    }
    const gaps = (profile?.skill_gaps ?? []).map(g => g.skill).filter(Boolean)
    return [...new Set([...gaps, ...set])].slice(0, 6)
  }, [startups, profile])

  const listForTab = tab === 'Saved Jobs' ? savedJobs : tab === 'Recommended' ? recommended : filtered

  return (
    <div className="jm-page">
      <header className="jm-hero">
        <div className="jm-hero-text">
          <h1 className="jm-hero-title"><span className="jm-hero-icon"><Icon name="briefcase" /></span> Job Match</h1>
          <p className="jm-hero-sub">Find the best job opportunities tailored to your skills, experience and career goals.</p>
        </div>
        <JobArt />
      </header>

      <div className="jm-tabs">
        {TABS.map(t => (
          <button key={t} type="button" className={`jm-tab ${tab === t ? 'is-active' : ''}`} onClick={() => setTab(t)}>
            {t}{t === 'Saved Jobs' && saved.length > 0 ? ` (${saved.length})` : ''}
          </button>
        ))}
      </div>

      <div className="jm-cols">
        <div className="jm-main">
          {(tab === 'Job Matches' || tab === 'Recommended') && (
            <>
              <div className="jm-search-row">
                <label className="jm-search">
                  <Icon name="search" />
                  <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by job title, company or keywords…" />
                </label>
                <label className="jm-search">
                  <Icon name="building" />
                  <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Location (e.g. Remote, Noida)" />
                </label>
                <button type="button" className="jm-btn is-primary" onClick={() => {}}><Icon name="search" /> Search</button>
              </div>

              <div className="jm-filters">
                <label className="jm-filter">
                  <span>Min match</span>
                  <select value={minMatch} onChange={e => setMinMatch(Number(e.target.value))}>
                    <option value={0}>Any</option>
                    <option value={50}>50%+</option>
                    <option value={70}>70%+</option>
                    <option value={85}>85%+</option>
                  </select>
                </label>
                <label className="jm-filter">
                  <span>Sort by</span>
                  <select value={sort} onChange={e => setSort(e.target.value)}>
                    <option value="match">Best Match</option>
                    <option value="salary">Salary</option>
                    <option value="name">Name A–Z</option>
                  </select>
                </label>
                {(query || location || minMatch > 0) && (
                  <button type="button" className="jm-reset" onClick={() => { setQuery(''); setLocation(''); setMinMatch(0) }}>
                    Reset
                  </button>
                )}
              </div>

              <div className="jm-stats">
                {[
                  { icon: 'target', label: 'Job Matches', sub: 'Based on your profile & skills', value: stats.total, cls: 'is-purple' },
                  { icon: 'chart', label: 'Match Accuracy', sub: 'AI-powered matching', value: `${stats.accuracy}%`, cls: 'is-green' },
                  { icon: 'briefcase', label: 'Hiring Now', sub: 'Fresh opportunities', value: stats.fresh, cls: 'is-blue' },
                  { icon: 'resume', label: 'Saved Jobs', sub: 'Track interesting roles', value: stats.saved, cls: 'is-amber' },
                ].map(s => (
                  <div key={s.label} className="jm-stat">
                    <span className={`jm-stat-icon ${s.cls}`}><Icon name={s.icon} /></span>
                    <div><strong>{s.value}</strong><span>{s.label}</span><p>{s.sub}</p></div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="jm-section-head">
            <h2>
              {tab === 'Job Matches' && 'Top Job Matches for You'}
              {tab === 'Saved Jobs' && 'Saved Jobs'}
              {tab === 'Applications' && 'Your Applications'}
              {tab === 'Recommended' && 'Recommended for You'}
              {tab === 'Company Insights' && 'Company Insights'}
            </h2>
          </div>

          {loading && <div className="jm-loading">Finding your best matches…</div>}
          {!loading && error && <div className="jm-state"><p>{error}</p></div>}

          {!loading && !error && tab === 'Applications' && (
            <div className="jm-state">
              <span className="jm-state-icon"><Icon name="briefcase" /></span>
              <h3>No applications tracked yet</h3>
              <p>When you apply to a matched job, track it here to follow its status.</p>
            </div>
          )}

          {!loading && !error && tab === 'Company Insights' && (
            <div className="jm-insights">
              {startups.slice(0, 6).map(j => (
                <button key={j.id} type="button" className="jm-insight" onClick={() => setInspected(j)}>
                  <CompanyTile name={j.name} size={44} />
                  <div><strong>{j.name}</strong><p>{j.type} · {j.stage} · {j.location}</p></div>
                  <span className="jm-match sm">{j.match_score}%</span>
                </button>
              ))}
            </div>
          )}

          {!loading && !error && (tab === 'Job Matches' || tab === 'Saved Jobs' || tab === 'Recommended') && (
            <>
              {listForTab.length === 0 ? (
                <div className="jm-state">
                  <span className="jm-state-icon"><Icon name="briefcase" /></span>
                  <h3>{tab === 'Saved Jobs' ? 'No saved jobs yet' : 'No matches found'}</h3>
                  <p>{tab === 'Saved Jobs' ? 'Tap the bookmark icon on any job to save it here.' : 'Try adjusting your search or filters.'}</p>
                </div>
              ) : (
                <div className="jm-jobs">
                  {listForTab.map(j => (
                    <JobCard key={j.id} job={j} saved={saved.includes(j.id)} onToggleSave={toggleSave} onInspect={setInspected} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <aside className="jm-side">
          <section className="jm-card">
            <div className="jm-card-head"><h3>Your Profile Match</h3></div>
            <div className="jm-profile-match">
              <MatchRing score={stats.accuracy} />
              <ul className="jm-legend">
                <li><span className="dot is-green" /> Matching Skills <strong>{topSkills.length}/{topSkills.length + improveSkills.length || '—'}</strong></li>
                <li><span className="dot is-blue" /> Avg Match <strong>{stats.accuracy}%</strong></li>
                <li><span className="dot is-amber" /> To Improve <strong>{improveSkills.length}</strong></li>
              </ul>
            </div>
          </section>

          <section className="jm-card">
            <div className="jm-card-head"><h3>Top Matching Skills</h3></div>
            <div className="jm-chips">
              {topSkills.length === 0 && <p className="jm-hint">Ingest job postings to discover matching skills.</p>}
              {topSkills.map(s => <span key={s} className="jm-chip is-ok">{s}</span>)}
            </div>
          </section>

          <section className="jm-card">
            <div className="jm-card-head"><h3>Skills to Improve</h3></div>
            <div className="jm-chips">
              {improveSkills.length === 0 && <p className="jm-hint">No gaps detected yet.</p>}
              {improveSkills.map(s => <span key={s} className="jm-chip is-miss">{s}</span>)}
            </div>
          </section>

          <section className="jm-card">
            <div className="jm-card-head">
              <h3><Icon name="bell" /> Job Alerts</h3>
              <button
                type="button"
                role="switch"
                aria-checked={alerts.enabled ?? true}
                className={`jm-switch ${(alerts.enabled ?? true) ? 'is-on' : ''}`}
                onClick={() => setAlerts(a => ({ ...a, enabled: !(a.enabled ?? true) }))}
              >
                <span />
              </button>
            </div>
            <p className="jm-hint">Get notified when new jobs match your profile.</p>
            {[
              ['daily', 'Daily email alerts'],
              ['realtime', 'Real-time notifications'],
              ['only80', 'Only show 80%+ matches'],
              ['remote', 'Include remote jobs'],
            ].map(([id, label]) => (
              <label key={id} className="jm-check">
                <input
                  type="checkbox"
                  checked={alerts[id] ?? (id !== 'only80')}
                  onChange={e => setAlerts(a => ({ ...a, [id]: e.target.checked }))}
                />
                <span>{label}</span>
              </label>
            ))}
          </section>
        </aside>
      </div>

      {inspected && (
        <div className="jm-modal-wrap">
          <div className="jm-modal-scrim" onClick={() => setInspected(null)} />
          <div className="jm-modal">
            <div className="jm-modal-head">
              <CompanyTile name={inspected.name} size={52} />
              <div><h3>{inspected.name}</h3><p>{inspected.type} · {inspected.stage} · {inspected.location}</p></div>
              <button type="button" className="jm-icon-btn" onClick={() => setInspected(null)} aria-label="Close"><Icon name="x" /></button>
            </div>
            <p className="jm-modal-desc">{inspected.description}</p>
            <div className="jm-modal-grid">
              <div><span>Salary</span><strong>₹{inspected.salary_range_lpa ?? '—'} LPA</strong></div>
              <div><span>Experience</span><strong>{inspected.min_experience ?? '—'}</strong></div>
              <div><span>Open roles</span><strong>{(inspected.roles_available ?? []).join(', ') || '—'}</strong></div>
              <div><span>Interview topics</span><strong>{(inspected.interview_topics ?? []).slice(0, 4).join(', ') || '—'}</strong></div>
            </div>
            {inspected.analysis && (
              <>
                <h4>Why this matches you</h4>
                <p className="jm-modal-desc">{inspected.analysis.assessment}</p>
                <div className="jm-modal-cols">
                  <div><h4>Matching skills</h4><div className="jm-chips">{inspected.analysis.matching_skills.map(s => <span key={s} className="jm-chip is-ok">{s}</span>)}</div></div>
                  <div><h4>Missing skills</h4><div className="jm-chips">{inspected.analysis.missing_skills.map(s => <span key={s} className="jm-chip is-miss">{s}</span>)}</div></div>
                </div>
                <p className="jm-reco">{inspected.analysis.recommended_action}</p>
              </>
            )}
            <div className="jm-modal-actions">
              <button type="button" className={`jm-btn ${saved.includes(inspected.id) ? 'is-ghost' : 'is-primary'}`} onClick={() => toggleSave(inspected)}>
                {saved.includes(inspected.id) ? 'Saved' : 'Save Job'}
              </button>
              {inspected.apply_url && (
                <a className="jm-btn is-primary" href={inspected.apply_url} target="_blank" rel="noreferrer">
                  View &amp; Apply <Icon name="external" />
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
