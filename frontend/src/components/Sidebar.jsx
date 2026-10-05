import { useMemo, useState } from 'react'
import { Icon } from './icons.jsx'
import ThemeSwitcher from './ThemeSwitcher.jsx'
import DevRadarLogo from './DevRadarLogo.jsx'

/**
 * Workspace sidebar — the readable index of the graph.
 *
 * The canvas only ever shows one neighbourhood, so this list is how you reach
 * anything that is currently off-canvas. It is built as a table, not a tree: one
 * row per node, a fixed score column on the right, and section headers that carry
 * their own counts. Selection is derived from `focusId`, so the highlighted row is
 * always the node at the centre of the canvas — there is no second source of truth.
 */

/** Right-hand score column. Every row carries one, so the column never ragged. */
function Score({ meta }) {
  if (!meta) return <span className="row-score row-score--empty" aria-hidden="true">·</span>
  return (
    <span className={`row-score row-score--${meta.tone ?? 'muted'}`}>
      {meta.value}{meta.unit ?? ''}
    </span>
  )
}

function Row({ detail, focusId, onFocusNode, mark }) {
  if (!detail) return null
  return (
    <li>
      <button
        type="button"
        className={`nav-row ${focusId === detail.id ? 'is-current' : ''}`}
        onClick={() => onFocusNode(detail.id)}
        title={detail.label}
        aria-current={focusId === detail.id ? 'true' : undefined}
      >
        <span className={`row-mark row-mark--${detail.type}`} aria-hidden="true">{mark}</span>
        <span className="row-label">{detail.label}</span>
        <Score meta={detail.meta} />
      </button>
    </li>
  )
}

function Section({ title, count, children }) {
  return (
    <section className="nav-section">
      <h2 className="nav-section-head">
        <span className="nav-section-title">{title}</span>
        <span className="nav-section-count">{count}</span>
      </h2>
      <ul className="nav-list">{children}</ul>
    </section>
  )
}

export default function Sidebar({
  graph,
  focusId,
  onFocusNode,
  userStack,
  startups,
  hackathons,
  gapSkills,
  rightPanel,
  onSetRightPanel,
  wikiPageCount,
  onGoHome,
  userName,
}) {
  const [tab, setTab] = useState('graph')
  const [query, setQuery] = useState('')
  const [listFilter, setListFilter] = useState('all')

  const knownSkills = userStack.length ? userStack : graph.knownSkills

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return graph.nodeDetails
      .filter(node => {
        if (node.type === 'user') return false
        if (listFilter === 'skills' && !['skill_known', 'skill_gap'].includes(node.type)) return false
        if (listFilter === 'startups' && node.type !== 'startup') return false
        if (listFilter === 'hackathons' && node.type !== 'hackathon') return false
        return !q || node.label.toLowerCase().includes(q)
      })
      .sort((a, b) => (b.sort ?? 0) - (a.sort ?? 0))
  }, [graph.nodeDetails, query, listFilter])

  const get = id => graph.nodeMap.get(id)

  const displayName = userName || 'Your Profile'
  const profileInitial = (displayName.trim()[0] || 'Y').toUpperCase()
  const stackLine = knownSkills.slice(0, 4).join(' · ') || 'No stack yet'

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <button type="button" onClick={onGoHome} className="brand-row" aria-label="Grafted home">
          <DevRadarLogo size={24} />
          <span className="brand-text">
            <span className="brand-word">grafted</span>
            <span className="brand-tagline">Your career, remembered</span>
          </span>
        </button>
        <span className="event-badge">WikiThon 2026</span>
      </div>

      <div className="sidebar-tabs" role="tablist">
        {[['graph', 'Graph'], ['list', 'List']].map(([id, label]) => (
          <button
            className={`sidebar-tab ${tab === id ? 'active' : ''}`}
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="sidebar-scroll">
        {tab === 'list' ? (
          <>
            <div className="list-search">
              <Icon name="search" />
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search nodes..." />
            </div>
            <div className="filter-chips">
              {['all', 'skills', 'startups', 'hackathons'].map(id => (
                <button className={`chip ${listFilter === id ? 'active' : ''}`} key={id} type="button" onClick={() => setListFilter(id)}>
                  {id === 'all' ? 'All' : id[0].toUpperCase() + id.slice(1)}
                </button>
              ))}
            </div>
            <Section title="Results" count={results.length}>
              {results.map(node => (
                <Row key={node.id} detail={node} focusId={focusId} onFocusNode={onFocusNode} mark={<Icon name={node.icon} />} />
              ))}
              {!results.length && <li className="nav-empty">No nodes match “{query}”.</li>}
            </Section>
          </>
        ) : (
          <>
            <Section title="Profile" count={knownSkills.length + gapSkills.length}>
              <li>
                <button
                  type="button"
                  className={`profile-card ${focusId === 'user' ? 'is-current' : ''}`}
                  onClick={() => onFocusNode('user')}
                  title="Open your profile"
                  aria-current={focusId === 'user' ? 'true' : undefined}
                >
                  <span className="profile-avatar" aria-hidden="true">{profileInitial}</span>
                  <span className="profile-meta">
                    <span className="profile-name">{displayName}</span>
                    <span className="profile-stack">{stackLine}</span>
                  </span>
                </button>
              </li>
            </Section>

            <Section title="Skills you have" count={knownSkills.length}>
              {knownSkills.map(skill => (
                <Row
                  key={skill}
                  detail={get(`skill-known:${skill}`)}
                  focusId={focusId}
                  onFocusNode={onFocusNode}
                  mark={<span className="row-swatch row-swatch--skill" />}
                />
              ))}
            </Section>

            <Section title="Gaps to close" count={gapSkills.length}>
              {gapSkills.map(gap => (
                <Row
                  key={gap.skill}
                  detail={get(`skill-gap:${gap.skill}`)}
                  focusId={focusId}
                  onFocusNode={onFocusNode}
                  mark={<span className="row-swatch row-swatch--gap" />}
                />
              ))}
              {!gapSkills.length && <li className="nav-empty">No gaps found yet.</li>}
            </Section>

            <Section title="Companies" count={startups.length}>
              {startups.map(startup => (
                <Row
                  key={startup.id}
                  detail={get(`startup:${startup.id}`)}
                  focusId={focusId}
                  onFocusNode={onFocusNode}
                  mark={<span className="row-swatch row-swatch--company" />}
                />
              ))}
            </Section>

            <Section title="Hackathons" count={hackathons.length}>
              {hackathons.map(hackathon => (
                <Row
                  key={hackathon.id}
                  detail={get(`hackathon:${hackathon.id}`)}
                  focusId={focusId}
                  onFocusNode={onFocusNode}
                  mark={<span className="row-swatch row-swatch--hackathon" />}
                />
              ))}
            </Section>
          </>
        )}
      </div>

      {onSetRightPanel && (
        <div className="sidebar-tools">
          <p className="sidebar-tools-title">Tools</p>
          <div className="sidebar-actions">
          <button
            className={`sidebar-action-btn ${rightPanel === 'ingest' ? 'active' : ''}`}
            type="button"
            onClick={() => onSetRightPanel(rightPanel === 'ingest' ? null : 'ingest')}
            title="Feed your career wiki"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="sidebar-icon">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span className="sidebar-item-text">Ingest</span>
            {(wikiPageCount ?? 0) > 0 && <span className="count-badge blue">{wikiPageCount}</span>}
          </button>

          <button
            className={`sidebar-action-btn ${rightPanel === 'chat' ? 'active' : ''}`}
            type="button"
            onClick={() => onSetRightPanel(rightPanel === 'chat' ? null : 'chat')}
            title="Chat with your career wiki"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="sidebar-icon">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span className="sidebar-item-text">Chat</span>
          </button>

          <button
            className={`sidebar-action-btn ${rightPanel === 'roadmap' ? 'active' : ''}`}
            type="button"
            onClick={() => onSetRightPanel(rightPanel === 'roadmap' ? null : 'roadmap')}
            title="View your learning roadmap"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="sidebar-icon">
              <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            <span className="sidebar-item-text">Roadmap</span>
          </button>

          <button
            className={`sidebar-action-btn ${rightPanel === 'journey' ? 'active' : ''}`}
            type="button"
            onClick={() => onSetRightPanel(rightPanel === 'journey' ? null : 'journey')}
            title="View your career journey"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="sidebar-icon">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <span className="sidebar-item-text">Journey</span>
          </button>

          <button
            className={`sidebar-action-btn ${rightPanel === 'wiki' ? 'active' : ''}`}
            type="button"
            onClick={() => onSetRightPanel(rightPanel === 'wiki' ? null : 'wiki')}
            title="Browse your wiki pages"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="sidebar-icon">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            <span className="sidebar-item-text">Wiki</span>
            {(wikiPageCount ?? 0) > 0 && <span className="count-badge blue">{wikiPageCount}</span>}
          </button>
          </div>
        </div>
      )}

      <div className="sidebar-bottom">
        <p className="caption">{graph.nodes.length} nodes · {graph.edges.length} connections</p>
        <div className="memory-active"><span className="pulse-dot" /> memory active</div>
      </div>

      <ThemeSwitcher />
    </aside>
  )
}
