import { useEffect, useMemo, useState } from 'react'
import axios from '../lib/api.js'
import { Icon } from './icons.jsx'

const API = import.meta.env.VITE_API_URL || ''

// ── Category model ───────────────────────────────────────────────────────────
// Backend wiki page types are: company, skill, gap. The reference design shows
// six filter tabs; Roles / Projects / Courses render honest empty states until
// ingested content produces them — nothing is invented.
const TABS = [
  { id: 'all', label: 'All', types: ['company', 'skill', 'gap'] },
  { id: 'companies', label: 'Companies', types: ['company'] },
  { id: 'skills', label: 'Skills', types: ['skill'] },
  { id: 'roles', label: 'Roles', types: ['role'] },
  { id: 'projects', label: 'Projects', types: ['project'] },
  { id: 'courses', label: 'Courses', types: ['course'] },
]

const TYPE_STYLE = {
  company: { label: 'Company', icon: 'building', cls: 'is-company' },
  skill: { label: 'Skill', icon: 'code', cls: 'is-skill' },
  gap: { label: 'Gap', icon: 'target', cls: 'is-gap' },
  role: { label: 'Role', icon: 'briefcase', cls: 'is-role' },
  project: { label: 'Project', icon: 'cube', cls: 'is-project' },
  course: { label: 'Course', icon: 'resume', cls: 'is-course' },
}

const PAGE_SIZE = 8

function typeOf(page) {
  return page.pageType ?? page.key?.split('/')[0] ?? 'other'
}

function prettyName(page) {
  const raw = page.pageName ?? page.key?.split('/').slice(1).join('/') ?? 'untitled'
  return raw.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function timeSince(iso) {
  if (!iso) return ''
  const diff = (Date.now() - new Date(iso)) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`
  if (diff < 86400 * 30) return `${Math.floor(diff / (86400 * 7))}w ago`
  return new Date(iso).toLocaleDateString()
}

function stripMarkdown(md = '') {
  return md
    .replace(/^---[\s\S]*?---/, '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[#>*_`]/g, '')
    .replace(/-\s\[[ x]\]\s*/g, '')
    .replace(/\n+/g, ' ')
    .trim()
}

function excerpt(md, n = 150) {
  const text = stripMarkdown(md)
  return text.length > n ? `${text.slice(0, n).trimEnd()}…` : text
}

// ── Minimal markdown → JSX (headings, bold, bullets, code, rules, wikilinks) ──

function inlineRender(text) {
  const parts = []
  const re = /\*\*(.+?)\*|`([^`]+)`|\[\[([^\]]+)\]\]/g
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[1] != null) parts.push(<strong className="wmd-strong" key={m.index}>{m[1]}</strong>)
    else if (m[2] != null) parts.push(<code className="wmd-code" key={m.index}>{m[2]}</code>)
    else if (m[3] != null) parts.push(<span className="wmd-link" key={m.index}>{m[3]}</span>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length ? parts : text
}

function renderMarkdown(md) {
  if (!md) return null
  const lines = md.split('\n')
  const elements = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (i === 0 && line.trim() === '---') {
      i += 1
      while (i < lines.length && lines[i].trim() !== '---') i += 1
      i += 1
      continue
    }
    if (!line.trim()) { elements.push(<div className="wmd-space" key={i} />); i += 1; continue }
    if (line.startsWith('### ')) elements.push(<p className="wmd-h4" key={i}>{inlineRender(line.slice(4))}</p>)
    else if (line.startsWith('## ')) elements.push(<h3 className="wmd-h3" key={i}>{inlineRender(line.slice(3))}</h3>)
    else if (line.startsWith('# ')) elements.push(<h2 className="wmd-h2" key={i}>{inlineRender(line.slice(2))}</h2>)
    else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(
        <div className="wmd-li" key={i}>
          <span className="wmd-li-mark" />
          <span className="wmd-li-text">{inlineRender(line.slice(2))}</span>
        </div>,
      )
    } else if (line.startsWith('---')) elements.push(<hr className="wmd-rule" key={i} />)
    else if (line.startsWith('```')) {
      const codeLines = []
      i += 1
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i += 1 }
      elements.push(<pre className="wmd-pre" key={`code-${i}`}><code>{codeLines.join('\n')}</code></pre>)
    } else elements.push(<p className="wmd-p" key={i}>{inlineRender(line)}</p>)
    i += 1
  }
  return elements
}

// ── Relation graph (computed from real page content, never invented) ──────────

function pageTokens(page) {
  return prettyName(page).toLowerCase().split(/[^a-z0-9+]+/).filter(t => t.length >= 3)
}

function buildRelations(pages) {
  const rel = {}
  for (const p of pages) rel[p.key] = []
  for (const p of pages) {
    const hay = `${p.content ?? ''}`.toLowerCase()
    for (const q of pages) {
      if (p.key === q.key) continue
      const toks = pageTokens(q)
      if (toks.length === 0) continue
      const hit = toks.some(t => hay.includes(t))
      const backHit = `${q.content ?? ''}`.toLowerCase().includes(pageTokens(p).join(' '))
      if (hit || backHit) rel[p.key].push(q.key)
    }
  }
  return rel
}

// ── Cards ────────────────────────────────────────────────────────────────────

function WikiCard({ page, onOpen, relatedCount }) {
  const type = typeOf(page)
  const style = TYPE_STYLE[type] ?? TYPE_STYLE.skill
  const name = prettyName(page)
  const source = page.meta?.source

  return (
    <button type="button" className={`wiki-card ${style.cls}`} onClick={() => onOpen(page)}>
      <div className="wiki-card-top">
        <span className="wiki-card-icon"><Icon name={style.icon} /></span>
        <span className="wiki-type-badge">{style.label}</span>
        <span className="wiki-card-menu" onClick={e => e.stopPropagation()}><Icon name="dots" /></span>
      </div>
      <h3 className="wiki-card-title">{name}</h3>
      <p className="wiki-card-time">{timeSince(page.updated_at)}</p>
      <p className="wiki-card-desc">{excerpt(page.content) || 'AI-generated page from your ingested content.'}</p>
      <div className="wiki-card-chips">
        {relatedCount > 0 && <span className="wiki-chip">Related {relatedCount}</span>}
        {source && <span className="wiki-chip is-source">{page.meta?.inputType === 'url' ? 'URL' : 'Text'}</span>}
      </div>
    </button>
  )
}

// ── Detail panel ─────────────────────────────────────────────────────────────

const DETAIL_TABS = ['Overview', 'Skills', 'Jobs', 'Sources', 'Notes']

function DetailPanel({ page, pages, relations, onClose, onOpenPage }) {
  const [tab, setTab] = useState('Overview')
  const type = typeOf(page)
  const style = TYPE_STYLE[type] ?? TYPE_STYLE.skill
  const name = prettyName(page)
  const related = (relations[page.key] ?? []).map(k => pages.find(p => p.key === k)).filter(Boolean)
  const relatedSkills = related.filter(p => typeOf(p) === 'skill')
  const relatedCompanies = related.filter(p => typeOf(p) === 'company')
  const source = page.meta?.source
  const isUrl = typeof source === 'string' && /^https?:\/\//i.test(source)

  useEffect(() => { setTab('Overview') }, [page.key])

  return (
    <div className="wiki-detail-wrap">
      <div className="wiki-detail-scrim" onClick={onClose} />
      <aside className="wiki-detail">
        <div className="wiki-detail-head">
          <span className={`wiki-card-icon lg ${style.cls}`}><Icon name={style.icon} /></span>
          <div className="wiki-detail-title-wrap">
            <h2 className="wiki-detail-title">{name}</h2>
            <p className="wiki-detail-sub">Updated {timeSince(page.updated_at)}</p>
          </div>
          <span className="wiki-type-badge">{style.label}</span>
          {isUrl && (
            <a className="wiki-btn is-primary sm" href={source} target="_blank" rel="noreferrer">
              View Source <Icon name="external" />
            </a>
          )}
          <button type="button" className="wiki-icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>

        <div className="wiki-detail-tabs">
          {DETAIL_TABS.map(t => {
            const count = t === 'Skills' ? relatedSkills.length : t === 'Jobs' ? relatedCompanies.length : null
            return (
              <button
                key={t}
                type="button"
                className={`wiki-detail-tab ${tab === t ? 'is-active' : ''}`}
                onClick={() => setTab(t)}
              >
                {t}{count != null && count > 0 ? ` (${count})` : ''}
              </button>
            )
          })}
        </div>

        <div className="wiki-detail-body">
          {tab === 'Overview' && (
            <div className="wmd">{renderMarkdown(page.content)}</div>
          )}

          {tab === 'Skills' && (
            relatedSkills.length === 0
              ? <p className="wiki-empty-note">No skill pages linked to this page yet.</p>
              : <div className="wiki-related-list">
                {relatedSkills.map(p => (
                  <button key={p.key} type="button" className="wiki-related-row" onClick={() => onOpenPage(p)}>
                    <span className="wiki-card-icon sm is-skill"><Icon name="code" /></span>
                    <span>{prettyName(p)}</span>
                    <Icon name="chevron" />
                  </button>
                ))}
              </div>
          )}

          {tab === 'Jobs' && (
            relatedCompanies.length === 0
              ? <p className="wiki-empty-note">No company pages linked to this page yet.</p>
              : <div className="wiki-related-list">
                {relatedCompanies.map(p => (
                  <button key={p.key} type="button" className="wiki-related-row" onClick={() => onOpenPage(p)}>
                    <span className="wiki-card-icon sm is-company"><Icon name="building" /></span>
                    <span>{prettyName(p)}</span>
                    <Icon name="chevron" />
                  </button>
                ))}
              </div>
          )}

          {tab === 'Sources' && (
            <div className="wiki-sources">
              {source ? (
                <div className="wiki-source-row">
                  <span className="wiki-card-icon sm"><Icon name={page.meta?.inputType === 'url' ? 'link' : 'paste'} /></span>
                  <div>
                    <p className="wiki-source-title">{isUrl ? new URL(source).hostname : 'Pasted text'}</p>
                    <p className="wiki-source-sub">
                      {isUrl ? source : String(source).slice(0, 120)}
                      {' · '}{timeSince(page.created_at)}
                    </p>
                  </div>
                  <span className="wiki-chip">{page.meta?.inputType === 'url' ? 'URL' : 'Text Input'}</span>
                </div>
              ) : (
                <p className="wiki-empty-note">No ingested source recorded for this page.</p>
              )}
              <p className="wiki-cite-note">
                Everything on this page was extracted from your ingested content — the AI never invents companies, skills or facts.
              </p>
            </div>
          )}

          {tab === 'Notes' && (
            <div className="wiki-notes">
              <p className="wiki-empty-note">No notes yet. Notes you add to this page will appear here.</p>
            </div>
          )}
        </div>

        {related.length > 0 && (
          <div className="wiki-detail-related">
            <div className="wiki-detail-related-head">
              <h4>Related Wiki Pages</h4>
            </div>
            <div className="wiki-detail-related-row">
              {related.slice(0, 6).map(p => {
                const rs = TYPE_STYLE[typeOf(p)] ?? TYPE_STYLE.skill
                return (
                  <button key={p.key} type="button" className="wiki-related-chip" onClick={() => onOpenPage(p)}>
                    <span className={`wiki-card-icon xs ${rs.cls}`}><Icon name={rs.icon} /></span>
                    <span>{prettyName(p)}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}

// ── Header illustration (pure CSS, mirrors the reference motif) ──────────────

function WikiArt() {
  return (
    <div className="wiki-art" aria-hidden="true">
      <div className="wiki-art-doc d1" />
      <div className="wiki-art-doc d2" />
      <div className="wiki-art-doc d3" />
      <span className="wiki-art-chip c1"><Icon name="briefcase" /> Jobs</span>
      <span className="wiki-art-chip c2"><Icon name="code" /> Skills</span>
      <span className="wiki-art-chip c3"><Icon name="cube" /> Projects</span>
      <span className="wiki-art-chip c4"><Icon name="user" /> Roles</span>
      <span className="wiki-art-chip c5"><Icon name="resume" /> Courses</span>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function WikiPage({ userId }) {
  const [pages, setPages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('newest')
  const [pageNum, setPageNum] = useState(1)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    let alive = true
    async function load() {
      if (!userId) return
      setLoading(true)
      setError('')
      try {
        const { data } = await axios.get(`${API}/api/wiki-pages/${userId}`)
        if (alive) setPages(data.pages ?? [])
      } catch {
        if (alive) setError('Could not load your wiki pages. Please try again.')
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [userId])

  const relations = useMemo(() => buildRelations(pages), [pages])

  const counts = useMemo(() => {
    const c = { all: pages.length }
    for (const t of TABS) {
      if (t.id === 'all') continue
      c[t.id] = pages.filter(p => t.types.includes(typeOf(p))).length
    }
    return c
  }, [pages])

  const visible = useMemo(() => {
    const active = TABS.find(t => t.id === tab) ?? TABS[0]
    let list = pages.filter(p => active.types.includes(typeOf(p)))
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter(p =>
        prettyName(p).toLowerCase().includes(q) ||
        stripMarkdown(p.content).toLowerCase().includes(q),
      )
    }
    const byTime = (a, b) => new Date(b.updated_at) - new Date(a.updated_at)
    if (sort === 'newest') list = [...list].sort(byTime)
    else if (sort === 'oldest') list = [...list].sort((a, b) => -byTime(a, b))
    else if (sort === 'az') list = [...list].sort((a, b) => prettyName(a).localeCompare(prettyName(b)))
    return list
  }, [pages, tab, query, sort])

  useEffect(() => { setPageNum(1) }, [tab, query, sort])

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const safePage = Math.min(pageNum, totalPages)
  const pageItems = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const activeTab = TABS.find(t => t.id === tab)

  return (
    <div className="wiki-page">
      <header className="wiki-hero">
        <div className="wiki-hero-text">
          <h1 className="wiki-hero-title">Wiki <span className="wiki-hero-emoji" aria-hidden="true">📚</span></h1>
          <p className="wiki-hero-sub">Your personal career knowledge base</p>
          <p className="wiki-hero-desc">
            All your ingested content is organized into AI-generated pages.
            These pages power your chat, career graph and recommendations.
          </p>
        </div>
        <WikiArt />
        <p className="wiki-hero-tag">More knowledge.<br />Better insights.<br />A stronger you.</p>
      </header>

      <div className="wiki-toolbar-row">
        <div className="wiki-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              className={`wiki-tab ${tab === t.id ? 'is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label} <span className="wiki-tab-count">{counts[t.id] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="wiki-tools">
          <label className="wiki-search">
            <Icon name="search" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search wiki pages…"
            />
          </label>
          <label className="wiki-sort">
            <Icon name="filter" />
            <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort wiki pages">
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="az">Name A–Z</option>
            </select>
          </label>
        </div>
      </div>

      <h2 className="wiki-section-title">
        Wiki Pages ({visible.length})
      </h2>

      {loading && (
        <div className="wiki-grid">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="wiki-card is-skeleton" />)}
        </div>
      )}

      {!loading && error && (
        <div className="wiki-state"><p>{error}</p></div>
      )}

      {!loading && !error && pageItems.length === 0 && (
        <div className="wiki-state">
          <span className="wiki-state-icon"><Icon name="wiki" /></span>
          {pages.length === 0 ? (
            <>
              <h3>No wiki pages yet</h3>
              <p>Ingest a job posting, URL or text and Grafted will build AI-generated pages for the companies, skills and gaps it finds.</p>
            </>
          ) : (
            <>
              <h3>No pages match</h3>
              <p>
                {activeTab.id === 'roles' || activeTab.id === 'projects' || activeTab.id === 'courses'
                  ? `No ${activeTab.label.toLowerCase()} pages yet — they appear here when your ingested content mentions them.`
                  : 'Try a different search or category.'}
              </p>
            </>
          )}
        </div>
      )}

      {!loading && !error && pageItems.length > 0 && (
        <>
          <div className="wiki-grid">
            {pageItems.map(p => (
              <WikiCard
                key={p.key}
                page={p}
                onOpen={setSelected}
                relatedCount={(relations[p.key] ?? []).length}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="wiki-pagination">
              <button
                type="button"
                className="wiki-page-btn"
                disabled={safePage <= 1}
                onClick={() => setPageNum(safePage - 1)}
                aria-label="Previous page"
              >
                <Icon name="chevron-left" />
              </button>
              {Array.from({ length: totalPages }).map((_, i) => (
                <button
                  key={i}
                  type="button"
                  className={`wiki-page-btn ${safePage === i + 1 ? 'is-active' : ''}`}
                  onClick={() => setPageNum(i + 1)}
                >
                  {i + 1}
                </button>
              ))}
              <button
                type="button"
                className="wiki-page-btn"
                disabled={safePage >= totalPages}
                onClick={() => setPageNum(safePage + 1)}
                aria-label="Next page"
              >
                <Icon name="chevron" />
              </button>
            </div>
          )}
          <p className="wiki-showing">Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, visible.length)} of {visible.length} pages</p>
        </>
      )}

      {selected && (
        <DetailPanel
          page={selected}
          pages={pages}
          relations={relations}
          onClose={() => setSelected(null)}
          onOpenPage={setSelected}
        />
      )}
    </div>
  )
}
