import { useEffect, useState, useCallback } from 'react'
import axios from '../lib/api.js'

const API = import.meta.env.VITE_API_URL || ''

/**
 * Wiki browser.
 *
 * Blueprint Ledger: the markdown renderer previously carried a full inline style
 * object on every element it emitted — that made the wiki the single largest source
 * of unthemeable styling in the app. It now emits semantic class names only, and
 * all typography lives in index.css under `.wiki-*`.
 *
 * Parsing behaviour is unchanged.
 */

// Hackathons are deliberately absent: they live in the graph and the Events tab,
// where the dataset gives them deadlines, prizes and skill coverage. A generated
// wiki page could only restate that, so ingest no longer creates one.
const TYPE_META = {
  company: { label: 'Companies', tone: 'ochre', glyph: '▣' },
  skill: { label: 'Skills', tone: 'blue', glyph: '◆' },
  gap: { label: 'Gaps', tone: 'accent', glyph: '◐' },
}

function typeOf(page) {
  return page.pageType ?? page.key?.split('/')[0] ?? 'other'
}

function timeSince(iso) {
  if (!iso) return ''
  const diff = (Date.now() - new Date(iso)) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// ── Minimal markdown → JSX ───────────────────────────────────────────────────
// Handles headings, bold, bullets, checkboxes, code, rules and [[wikilinks]].

function inlineRender(text) {
  const parts = []
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[\[([^\]]+)\]\]/g
  let last = 0
  let m

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[1] != null) parts.push(<strong className="wiki-strong" key={m.index}>{m[1]}</strong>)
    else if (m[2] != null) parts.push(<code className="wiki-code" key={m.index}>{m[2]}</code>)
    else if (m[3] != null) parts.push(<span className="wiki-link" key={m.index}>{m[3]}</span>)
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

    // Skip the YAML frontmatter block.
    if (i === 0 && line.trim() === '---') {
      i += 1
      while (i < lines.length && lines[i].trim() !== '---') i += 1
      i += 1
      continue
    }

    if (!line.trim()) { elements.push(<div className="wiki-space" key={i} />); i += 1; continue }

    if (line.startsWith('### ')) {
      elements.push(<p className="wiki-h4" key={i}>{inlineRender(line.slice(4))}</p>)
    } else if (line.startsWith('## ')) {
      elements.push(<h3 className="wiki-h3" key={i}>{inlineRender(line.slice(3))}</h3>)
    } else if (line.startsWith('# ')) {
      elements.push(<h2 className="wiki-h2" key={i}>{inlineRender(line.slice(2))}</h2>)
    } else if (/^- \[[ x]\]/.test(line)) {
      const checked = line[3] === 'x'
      elements.push(
        <div className={`wiki-task ${checked ? 'is-done' : ''}`} key={i}>
          <span className="wiki-task-box">{checked ? '×' : ''}</span>
          <span className="wiki-task-text">{inlineRender(line.slice(6))}</span>
        </div>,
      )
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(
        <div className="wiki-li" key={i}>
          <span className="wiki-li-mark" />
          <span className="wiki-li-text">{inlineRender(line.slice(2))}</span>
        </div>,
      )
    } else if (line.startsWith('---')) {
      elements.push(<hr className="wiki-rule" key={i} />)
    } else if (line.startsWith('```')) {
      const codeLines = []
      i += 1
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i += 1 }
      elements.push(<pre className="wiki-pre" key={`code-${i}`}><code>{codeLines.join('\n')}</code></pre>)
    } else {
      elements.push(<p className="wiki-p" key={i}>{inlineRender(line)}</p>)
    }

    i += 1
  }

  return elements
}

// ── Page list row ────────────────────────────────────────────────────────────

function PageRow({ page, selected, onClick }) {
  const type = typeOf(page)
  const meta = TYPE_META[type] ?? { glyph: '·', tone: 'ink' }
  const name = page.pageName ?? page.key?.split('/').slice(1).join('/') ?? page.key

  return (
    <button
      type="button"
      onClick={onClick}
      className={`wiki-row ${selected ? 'is-selected' : ''}`}
      data-tone={meta.tone}
    >
      <span className="wiki-row-glyph">{meta.glyph}</span>
      <span className="wiki-row-main">
        <span className="wiki-row-name">{name.replace(/-/g, ' ')}</span>
        <span className="wiki-row-meta">{type} · {timeSince(page.updated_at)}</span>
      </span>
    </button>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export default function WikiPanel({ userId }) {
  const [pages, setPages] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)

  const load = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setError('')
    try {
      const { data } = await axios.get(`${API}/api/wiki-pages/${userId}`)
      setPages(data.pages ?? [])
    } catch {
      setError('Could not load wiki pages.')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { load() }, [load])

  const types = ['all', ...Object.keys(TYPE_META).filter(t => pages.some(p => typeOf(p) === t))]

  const visible = pages.filter(page => {
    if (filter !== 'all' && typeOf(page) !== filter) return false
    if (query) return (page.pageName ?? page.key ?? '').toLowerCase().includes(query.toLowerCase())
    return true
  })

  const counts = {}
  for (const page of pages) {
    const t = typeOf(page)
    counts[t] = (counts[t] ?? 0) + 1
  }

  return (
    <div className="wiki-panel">

      <div className="wiki-toolbar">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search pages…"
          className="wiki-search"
        />
        <button type="button" onClick={load} title="Refresh" className="wiki-refresh">↺</button>
      </div>

      <div className="wiki-filters">
        {types.map(type => {
          const meta = TYPE_META[type]
          return (
            <button
              key={type}
              type="button"
              onClick={() => setFilter(type)}
              className={`wiki-filter ${filter === type ? 'is-active' : ''}`}
              data-tone={meta?.tone ?? 'ink'}
            >
              {type === 'all' ? `All (${pages.length})` : `${type} (${counts[type] ?? 0})`}
            </button>
          )
        })}
      </div>

      <div className="wiki-body">
        <div className={`wiki-list ${selected ? 'is-split' : ''}`}>
          {loading && <p className="wiki-status">Loading…</p>}
          {error && <p className="wiki-status is-error">{error}</p>}
          {!loading && !error && visible.length === 0 && (
            <div className="wiki-empty">
              <p className="wiki-empty-title">{pages.length === 0 ? 'No pages yet.' : 'No pages match.'}</p>
              {pages.length === 0 && (
                <p className="wiki-empty-body">Ingest a job posting or URL to build your wiki.</p>
              )}
            </div>
          )}
          {visible.map(page => (
            <PageRow
              key={page.key}
              page={page}
              selected={selected?.key === page.key}
              onClick={() => setSelected(prev => (prev?.key === page.key ? null : page))}
            />
          ))}
        </div>

        {selected && (
          <div className="wiki-doc">
            <button type="button" onClick={() => setSelected(null)} className="wiki-back">← back</button>
            <div className="wiki-doc-body">{renderMarkdown(selected.content)}</div>
            {selected.meta?.source && (
              <p className="wiki-source">Source: {selected.meta.source}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
