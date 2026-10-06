import { useMemo, useState } from 'react'
import { matchScoreOf } from '../lib/graph.js'
import { Icon } from './icons.jsx'

/* ── helpers ─────────────────────────────────────────────────────────────── */

function firstName(name) {
  const n = (name ?? '').trim()
  return n ? n.split(/\s+/)[0] : 'there'
}

function trunc(label, n = 14) {
  const s = String(label ?? '')
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/** % of onboarding/profile fields that are filled in. */
function profileCompletion(profile) {
  if (!profile) return 0
  const fields = [
    profile.name,
    profile.experience,
    profile.target_role,
    profile.timeline,
    (profile.stack ?? []).length > 0,
    (profile.goals ?? []).length > 0,
    profile.learning_style,
  ]
  const filled = fields.filter(Boolean).length
  return Math.round((filled / fields.length) * 100)
}

function gapPriority(gap, index) {
  if (gap.inferred) return { label: 'Unranked', tone: 'muted' }
  if (index < 2) return { label: 'High', tone: 'high' }
  if (index < 4) return { label: 'Medium', tone: 'medium' }
  return { label: 'Low', tone: 'low' }
}

function timeAgo(iso) {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff) || diff < 0) return null
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

/* ── SVG career graph ────────────────────────────────────────────────────── */

const CLUSTER_DEFS = [
  { id: 'skills', label: 'Skills', color: '#22c55e', icon: 'code', x: 320, y: 80 },
  { id: 'goals', label: 'Goals', color: '#a855f7', icon: 'target', x: 130, y: 185 },
  { id: 'companies', label: 'Companies', color: '#f59e0b', icon: 'briefcase', x: 510, y: 185 },
  { id: 'learning', label: 'Learning', color: '#ec4899', icon: 'wiki', x: 320, y: 360 },
]
const CENTER = { x: 320, y: 220 }
const VB = { w: 640, h: 440 } // viewBox — satellites are clamped inside it

function clusterItems(clusterId, profile, graph) {
  if (clusterId === 'skills') return (graph.knownSkills ?? []).slice(0, 5)
  if (clusterId === 'goals') {
    const goals = (profile?.goals ?? []).slice(0, 3)
    if (goals.length) return goals
    return profile?.target_role ? [profile.target_role] : []
  }
  if (clusterId === 'companies') return (graph.startups ?? []).slice(0, 4).map(s => s.name)
  if (clusterId === 'learning') return (graph.gapSkills ?? []).slice(0, 4).map(g => g.skill)
  return []
}

function GraphCanvas({ profile, graph }) {
  const clusters = useMemo(() => CLUSTER_DEFS.map(def => ({
    ...def,
    items: clusterItems(def.id, profile, graph),
  })), [profile, graph])

  const hasAny = clusters.some(c => c.items.length > 0)
  if (!hasAny) return null

  return (
    <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="dash-graph-svg" role="img" aria-label="Career graph overview">
      <defs>
        <radialGradient id="dash-you" cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#8b7bff" />
          <stop offset="100%" stopColor="#4338ca" />
        </radialGradient>
      </defs>

      {clusters.map(cluster => {
        const dx = cluster.x - CENTER.x
        const dy = cluster.y - CENTER.y
        const len = Math.hypot(dx, dy) || 1
        const nx = dx / len
        const ny = dy / len
        // Swooping dotted connector: You → cluster hub.
        const mx = (CENTER.x + cluster.x) / 2
        const my = (CENTER.y + cluster.y) / 2
        const qx = mx - ny * 34
        const qy = my + nx * 34
        // Satellite pills fan out perpendicular to the hub direction,
        // clamped so they never clip outside the viewBox.
        const px = -ny
        const py = nx
        const PILL_W = 88
        const PILL_H = 26
        return (
          <g key={cluster.id}>
            <path
              d={`M ${CENTER.x} ${CENTER.y} Q ${qx} ${qy} ${cluster.x} ${cluster.y}`}
              fill="none"
              stroke={cluster.color}
              strokeWidth="1.6"
              strokeDasharray="3 6"
              strokeLinecap="round"
              opacity="0.55"
            />
            {cluster.items.map((item, i) => {
              const off = (i - (cluster.items.length - 1) / 2) * 88
              const rawX = cluster.x + nx * 56 + px * off
              const rawY = cluster.y + ny * 56 + py * off
              const sx = Math.min(Math.max(rawX, PILL_W / 2 + 4), VB.w - PILL_W / 2 - 4)
              const sy = Math.min(Math.max(rawY, PILL_H / 2 + 4), VB.h - PILL_H / 2 - 4)
              return (
                <g key={`${cluster.id}-${i}`}>
                  <line
                    x1={cluster.x} y1={cluster.y} x2={sx} y2={sy}
                    stroke={cluster.color} strokeWidth="1" opacity="0.3"
                  />
                  <rect
                    x={sx - PILL_W / 2} y={sy - PILL_H / 2} width={PILL_W} height={PILL_H} rx={PILL_H / 2}
                    fill="#0d1730" stroke={cluster.color} strokeOpacity="0.45"
                  />
                  <text
                    x={sx} y={sy + 4} textAnchor="middle"
                    fill="#dbe2f5" fontSize="11" fontWeight="600"
                  >
                    {trunc(item, 12)}
                  </text>
                </g>
              )
            })}
            <circle cx={cluster.x} cy={cluster.y} r="27" fill="#0d1730" stroke={cluster.color} strokeWidth="2" />
            <foreignObject x={cluster.x - 20} y={cluster.y - 20} width="40" height="40">
              <div
                xmlns="http://www.w3.org/1999/xhtml"
                style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', color: cluster.color }}
              >
                <Icon name={cluster.icon} className="dash-hub-icon" />
              </div>
            </foreignObject>
            <text
              x={cluster.x} y={cluster.y + 44} textAnchor="middle"
              fill="#dbe2f5" fontSize="12.5" fontWeight="700"
            >
              {cluster.label}
            </text>
          </g>
        )
      })}

      {/* You */}
      <circle cx={CENTER.x} cy={CENTER.y} r="36" fill="url(#dash-you)" />
      <text x={CENTER.x} y={CENTER.y + 9} textAnchor="middle" fill="#fff" fontSize="30" fontWeight="800">G</text>
      <text x={CENTER.x} y={CENTER.y + 58} textAnchor="middle" fill="#f1f5f9" fontSize="14" fontWeight="700">You</text>
    </svg>
  )
}

function GraphListView({ profile, graph }) {
  const groups = [
    { label: 'Skills you have', items: graph.knownSkills ?? [], color: '#22c55e' },
    { label: 'Goals', items: (profile?.goals ?? []).length ? profile.goals : (profile?.target_role ? [profile.target_role] : []), color: '#a855f7' },
    { label: 'Matched companies', items: (graph.startups ?? []).map(s => s.name), color: '#f59e0b' },
    { label: 'Learning next', items: (graph.gapSkills ?? []).map(g => g.skill), color: '#ec4899' },
  ]
  return (
    <div className="dash-graph-list">
      {groups.map(group => (
        <div key={group.label} className="dash-graph-listgroup">
          <p className="dash-graph-listhead" style={{ color: group.color }}>{group.label}</p>
          {group.items.length ? (
            <div className="dash-pillrow">
              {group.items.slice(0, 8).map(item => (
                <span key={item} className="dash-pill">{item}</span>
              ))}
            </div>
          ) : (
            <p className="dash-empty-line">Nothing here yet.</p>
          )}
        </div>
      ))}
    </div>
  )
}

/* ── small pieces ────────────────────────────────────────────────────────── */

function SectionHead({ icon, title, actionLabel, onAction }) {
  return (
    <div className="dash-sechead">
      <span className="dash-sectitle"><Icon name={icon} className="dash-secicon" />{title}</span>
      {actionLabel && (
        <button type="button" className="dash-viewall" onClick={onAction}>{actionLabel}</button>
      )}
    </div>
  )
}

function EmptyCard({ text, actionLabel, onAction }) {
  return (
    <div className="dash-empty">
      <p>{text}</p>
      {actionLabel && (
        <button type="button" className="dash-empty-btn" onClick={onAction}>{actionLabel}</button>
      )}
    </div>
  )
}

/* ── Dashboard ───────────────────────────────────────────────────────────── */

export default function Dashboard({ user, profile, graph, onNavigate, onOpenChat, onRunAnalysis, onSelectGap }) {
  const [graphMode, setGraphMode] = useState('graph')

  const completion = profileCompletion(profile)
  const skills = graph.knownSkills ?? []
  const learning = profile?.learning_stack ?? []
  const startups = useMemo(() => [...(graph.startups ?? [])].sort((a, b) => matchScoreOf(b) - matchScoreOf(a)), [graph.startups])
  const gaps = useMemo(() => {
    const list = [...(graph.gapSkills ?? [])]
    // Ranked gaps first (they carry a priority), inferred ones after.
    list.sort((a, b) => (a.inferred ? 1 : 0) - (b.inferred ? 1 : 0) || (a.priority ?? 99) - (b.priority ?? 99))
    return list
  }, [graph.gapSkills])
  const goals = profile?.goals ?? []

  const bestMatch = startups[0] ?? null
  const bestScore = bestMatch ? Math.round(matchScoreOf(bestMatch)) : 0
  const topGap = gaps[0] ?? null
  // Most demanded skill across the matched companies (honest, computed).
  const demandRank = useMemo(() => {
    const counts = new Map()
    startups.forEach(s => (s.skills_required ?? []).forEach(skill => {
      counts.set(skill, (counts.get(skill) ?? 0) + 1)
    }))
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null
  }, [startups])

  const recentActivity = useMemo(() => {
    const items = []
    const viewed = (profile?.startups_viewed ?? []).length + (profile?.hackathons_viewed ?? []).length
    if (viewed > 0) items.push({ icon: 'graph', text: `${viewed} ${viewed === 1 ? 'match' : 'matches'} explored`, when: timeAgo(profile?.updated_at) })
    if ((profile?.skill_gaps ?? []).length > 0) items.push({ icon: 'target', text: `${profile.skill_gaps.length} skill gaps tracked`, when: timeAgo(profile?.updated_at) })
    items.push({ icon: 'user', text: 'Profile created', when: timeAgo(profile?.created_at) })
    if (profile?.last_visit_at) items.push({ icon: 'refresh', text: 'Last visit', when: timeAgo(profile.last_visit_at) })
    return items.slice(0, 4)
  }, [profile])

  const graphHasData = (graph.nodes ?? []).length > 1

  return (
    <div className="dash">
      {/* Welcome */}
      <section className="dash-welcome">
        <svg className="dash-welcome-mountains" viewBox="0 0 640 170" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
          <defs>
            <radialGradient id="dash-sunset" cx="68%" cy="88%" r="55%">
              <stop offset="0%" stopColor="#fb923c" stopOpacity="0.5" />
              <stop offset="45%" stopColor="#ec4899" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#ec4899" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="dash-range-back" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#232c5e" />
              <stop offset="100%" stopColor="#141b3f" />
            </linearGradient>
            <linearGradient id="dash-range-front" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10173a" />
              <stop offset="100%" stopColor="#080d22" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="640" height="170" fill="url(#dash-sunset)" />
          {/* stars */}
          <g fill="#ffffff" opacity="0.7">
            <circle cx="120" cy="28" r="1.3" />
            <circle cx="250" cy="18" r="1" />
            <circle cx="380" cy="32" r="1.4" />
            <circle cx="500" cy="16" r="1" />
            <circle cx="580" cy="40" r="1.2" />
            <circle cx="60" cy="52" r="1" />
            <circle cx="320" cy="55" r="1" />
          </g>
          {/* back range */}
          <path
            d="M0 170 L0 118 L70 66 L130 104 L210 44 L290 100 L370 58 L450 108 L530 72 L600 112 L640 96 L640 170 Z"
            fill="url(#dash-range-back)"
          />
          {/* snow caps on back range */}
          <g fill="#e8ecff" opacity="0.85">
            <path d="M210 44 l14 22 -8 -4 -6 8 -7 -9 -8 5 15 -22Z" />
            <path d="M370 58 l12 18 -7 -3 -5 7 -6 -8 -7 4 13 -18Z" />
          </g>
          {/* front range */}
          <path
            d="M0 170 L0 138 L90 88 L170 132 L270 82 L370 136 L460 96 L550 134 L640 118 L640 170 Z"
            fill="url(#dash-range-front)"
          />
        </svg>
        <div className="dash-welcome-main">
          <h1 className="dash-welcome-title">Welcome back, {firstName(user?.name ?? profile?.name)} <span aria-hidden="true">👋</span></h1>
          <p className="dash-welcome-sub">Your AI-powered career intelligence platform</p>
        </div>
        <p className="dash-welcome-quote">“A smarter path<br />for your brighter future.”</p>
      </section>

      {/* Stat cards */}
      <section className="dash-stats">
        <div className="dash-stat">
          <span className="dash-stat-icon dash-tile-blue"><Icon name="user-solid" className="dash-stat-svg" /></span>
          <span className="dash-stat-meta"><small>Profile</small><strong>Complete</strong></span>
          <span className="dash-ring" style={{ '--p': completion }} aria-label={`${completion}% complete`}>
            <span>{completion}%</span>
          </span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-icon dash-tile-green"><Icon name="bolt" className="dash-stat-svg" /></span>
          <span className="dash-stat-meta"><small>Skills</small><strong>{skills.length}</strong></span>
          <span className="dash-stat-delta">{learning.length > 0 ? `+${learning.length} learning` : 'in your stack'}</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-icon dash-tile-purple"><Icon name="case-solid" className="dash-stat-svg" /></span>
          <span className="dash-stat-meta"><small>Matched Companies</small><strong>{startups.length}</strong></span>
          <span className="dash-stat-delta">{bestMatch ? `top ${bestScore}% match` : 'run analysis'}</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-icon dash-tile-orange"><Icon name="target-solid" className="dash-stat-svg" /></span>
          <span className="dash-stat-meta"><small>Active Goals</small><strong>{goals.length}</strong></span>
          <span className="dash-stat-delta">{profile?.target_role ? trunc(profile.target_role, 18) : 'set a goal'}</span>
        </div>
      </section>

      {/* Graph + insights */}
      <section className="dash-grid-main">
        <div className="dash-card dash-graph-card">
          <div className="dash-cardhead">
            <div>
              <SectionHead icon="graph" title="Your Career Graph" />
              <p className="dash-cardsub">Explore your skills, goals, companies and opportunities</p>
            </div>
            <div className="dash-segwrap">
              <div className="dash-seg" role="tablist" aria-label="Graph view">
                {[['graph', 'Graph View'], ['list', 'List View']].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={graphMode === id}
                    className={`dash-segbtn ${graphMode === id ? 'is-active' : ''}`}
                    onClick={() => setGraphMode(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="dash-graph-body">
            {graphHasData ? (
              graphMode === 'graph'
                ? <GraphCanvas profile={profile} graph={graph} />
                : <GraphListView profile={profile} graph={graph} />
            ) : (
              <EmptyCard
                text="Your graph is empty — complete your profile and run an analysis to grow it."
                actionLabel="Run analysis"
                onAction={onRunAnalysis}
              />
            )}
          </div>
        </div>

        <div className="dash-card">
          <SectionHead icon="sparkles" title="AI Career Insights" actionLabel="View All" onAction={() => onOpenChat(null)} />
          <div className="dash-insights">
            {bestMatch ? (
              <button type="button" className="dash-insight" onClick={() => onNavigate('job-match')}>
                <span className="dash-insight-icon dash-tint-blue"><Icon name="building" className="dash-stat-svg" /></span>
                <span className="dash-insight-meta"><small>Best Match</small><strong>{bestMatch.name}</strong><span>{bestScore}% match with your current skills</span></span>
                <span className="dash-insight-arrow" aria-hidden="true">›</span>
              </button>
            ) : null}
            {topGap ? (
              <button type="button" className="dash-insight" onClick={() => onSelectGap(topGap.skill)}>
                <span className="dash-insight-icon dash-tint-green"><Icon name="code" className="dash-stat-svg" /></span>
                <span className="dash-insight-meta"><small>Top Skill to Learn</small><strong>{topGap.skill}</strong><span>{topGap.why ?? `Priority gap #${topGap.priority ?? '–'}`}</span></span>
                <span className="dash-insight-arrow" aria-hidden="true">›</span>
              </button>
            ) : null}
            {demandRank ? (
              <button type="button" className="dash-insight" onClick={() => onNavigate('skill-gaps')}>
                <span className="dash-insight-icon dash-tint-purple"><Icon name="gap" className="dash-stat-svg" /></span>
                <span className="dash-insight-meta"><small>Market Trend</small><strong>{demandRank[0]}</strong><span>Required by {demandRank[1]} of {startups.length} matched companies</span></span>
                <span className="dash-insight-arrow" aria-hidden="true">›</span>
              </button>
            ) : null}
            <button type="button" className="dash-insight" onClick={() => (topGap ? onSelectGap(topGap.skill) : onNavigate('skill-gaps'))}>
              <span className="dash-insight-icon dash-tint-orange"><Icon name="flag" className="dash-stat-svg" /></span>
              <span className="dash-insight-meta"><small>Next Step</small><strong>{topGap ? `Learn ${topGap.skill}` : 'Close your first gap'}</strong><span>{topGap?.time_weeks ? `About ${topGap.time_weeks} weeks of focused work` : 'Start with your highest-priority gap'}</span></span>
              <span className="dash-insight-arrow" aria-hidden="true">›</span>
            </button>
            {!bestMatch && !topGap && !demandRank && (
              <EmptyCard
                text="Insights unlock after your first analysis."
                actionLabel="Run analysis"
                onAction={onRunAnalysis}
              />
            )}
          </div>
        </div>
      </section>

      {/* Companies + gaps + roadmap */}
      <section className="dash-grid-tri">
        <div className="dash-card">
          <SectionHead icon="briefcase" title="Top Matched Companies" actionLabel="View All" onAction={() => onNavigate('job-match')} />
          {startups.length ? (
            <ul className="dash-list">
              {startups.slice(0, 5).map(startup => {
                const score = Math.round(matchScoreOf(startup))
                const overlap = (startup.skills_required ?? []).filter(req =>
                  skills.some(known => known.toLowerCase() === String(req).toLowerCase())
                ).length
                return (
                  <li key={startup.id ?? startup.name} className="dash-row">
                    <span className="dash-row-avatar" aria-hidden="true">{(startup.name ?? '?').trim()[0]?.toUpperCase()}</span>
                    <span className="dash-row-meta"><strong>{startup.name}</strong></span>
                    <span className="dash-matchpill">{score}% Match</span>
                    {startup.type && <span className="dash-chip">{startup.type}</span>}
                    <span className="dash-row-sub">{(startup.roles_available ?? []).length} open roles</span>
                    <span className="dash-insight-arrow" aria-hidden="true">›</span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <EmptyCard text="No company matches yet." actionLabel="Run analysis" onAction={onRunAnalysis} />
          )}
        </div>

        <div className="dash-card">
          <SectionHead icon="target" title="Skill Gaps" actionLabel="View All" onAction={() => onNavigate('skill-gaps')} />
          {gaps.length ? (
            <ul className="dash-list">
              {gaps.slice(0, 5).map((gap, i) => {
                const pr = gapPriority(gap, i)
                return (
                  <li key={gap.skill}>
                    <button type="button" className="dash-row dash-rowbtn" onClick={() => onSelectGap(gap.skill)}>
                      <span className="dash-row-avatar dash-tint-purple" aria-hidden="true">
                        <Icon name="code" className="dash-row-svg" />
                      </span>
                      <span className="dash-row-meta"><strong>{gap.skill}</strong></span>
                      <span className={`dash-prio dash-prio--${pr.tone}`}>{pr.label}</span>
                      <span className="dash-row-sub">{gap.time_weeks ? `${gap.time_weeks} weeks` : '—'}</span>
                      <span className="dash-insight-arrow" aria-hidden="true">›</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <EmptyCard text="No gaps found — your stack covers every matched requirement." />
          )}
        </div>

        <div className="dash-card">
          <SectionHead icon="roadmap" title="Your Learning Roadmap" actionLabel="View All" onAction={() => onNavigate('roadmap')} />
          {gaps.length ? (
            <ol className="dash-roadmap">
              {gaps.slice(0, 4).map((gap, i) => (
                <li key={gap.skill}>
                  <button type="button" className="dash-step" onClick={() => onSelectGap(gap.skill)}>
                    <span className="dash-step-num" aria-hidden="true">{i + 1}</span>
                    <span className="dash-step-meta">
                      <strong>{gap.skill === topGap?.skill ? `Learn ${gap.skill}` : gap.skill}</strong>
                      <span>{gap.time_weeks ? `${gap.time_weeks} weeks` : '—'} • {gap.difficulty && !gap.inferred ? gap.difficulty : 'Self-paced'}</span>
                    </span>
                    <span className="dash-step-play" aria-hidden="true">▸</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyCard text="Your roadmap builds itself from your skill gaps." actionLabel="Run analysis" onAction={onRunAnalysis} />
          )}
        </div>
      </section>

      {/* Recent activity */}
      <section className="dash-card dash-activity">
        <SectionHead icon="refresh" title="Recent Activity" />
        <ul className="dash-activity-list">
          {recentActivity.map((item, i) => (
            <li key={i} className="dash-activity-item">
              <span className="dash-activity-icon" aria-hidden="true"><Icon name={item.icon} className="dash-row-svg" /></span>
              <span className="dash-activity-text">{item.text}</span>
              {item.when && <span className="dash-activity-when">{item.when}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
