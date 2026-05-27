import { useEffect, useState, useCallback } from 'react'
import axios from '../lib/api.js'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const TYPE_META = {
  company:   { label: 'Companies',  color: 'var(--node-company)',   icon: '🏢' },
  skill:     { label: 'Skills',     color: 'var(--node-skill)',     icon: '⚡' },
  gap:       { label: 'Gaps',       color: 'var(--node-gap)',       icon: '🔍' },
  hackathon: { label: 'Hackathons', color: 'var(--node-hackathon)', icon: '🏆' },
}

function typeOf(page) {
  return page.pageType ?? page.key?.split('/')[0] ?? 'other'
}

function timeSince(iso) {
  if (!iso) return ''
  const diff = (Date.now() - new Date(iso)) / 1000
  if (diff < 60)    return 'just now'
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// Minimal markdown → JSX (headings, bold, bullets, checkboxes, code, hr)
function renderMarkdown(md) {
  if (!md) return null
  const lines = md.split('\n')
  const elements = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Skip YAML frontmatter block
    if (i === 0 && line.trim() === '---') {
      i++
      while (i < lines.length && lines[i].trim() !== '---') i++
      i++
      continue
    }

    if (!line.trim()) { elements.push(<div key={i} style={{ height: 8 }} />); i++; continue }

    if (line.startsWith('### ')) {
      elements.push(<p key={i} style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', margin: '16px 0 4px' }}>{inlineRender(line.slice(4))}</p>)
    } else if (line.startsWith('## ')) {
      elements.push(<h3 key={i} style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: '20px 0 6px', borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>{inlineRender(line.slice(3))}</h3>)
    } else if (line.startsWith('# ')) {
      elements.push(<h2 key={i} style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', margin: '0 0 12px', letterSpacing: '-0.3px' }}>{inlineRender(line.slice(2))}</h2>)
    } else if (/^- \[[ x]\]/.test(line)) {
      const checked = line[3] === 'x'
      elements.push(
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '3px 0' }}>
          <span style={{ color: checked ? 'var(--accent)' : 'var(--border)', fontSize: 13, marginTop: 1 }}>{checked ? '✓' : '○'}</span>
          <span style={{ fontSize: 13, color: checked ? 'var(--text-muted)' : 'var(--text-sub)', textDecoration: checked ? 'line-through' : 'none' }}>{inlineRender(line.slice(6))}</span>
        </div>
      )
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '3px 0' }}>
          <span style={{ color: 'var(--accent)', fontSize: 10, marginTop: 4 }}>▸</span>
          <span style={{ fontSize: 13, color: 'var(--text-sub)', lineHeight: 1.5 }}>{inlineRender(line.slice(2))}</span>
        </div>
      )
    } else if (line.startsWith('---')) {
      elements.push(<hr key={i} style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '12px 0' }} />)
    } else if (line.startsWith('```')) {
      const codeLines = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++ }
      elements.push(<pre key={`code-${i}`} style={{ background: 'var(--bg-surface0)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontSize: 11, color: 'var(--text-sub)', overflowX: 'auto', margin: '8px 0' }}><code>{codeLines.join('\n')}</code></pre>)
    } else {
      elements.push(<p key={i} style={{ fontSize: 13, color: 'var(--text-sub)', lineHeight: 1.6, margin: '4px 0' }}>{inlineRender(line)}</p>)
    }

    i++
  }

  return elements
}

function inlineRender(text) {
  // Replace **bold**, `code`, and [[wikilinks]]
  const parts = []
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[\[([^\]]+)\]\]/g
  let last = 0, m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[1] != null) parts.push(<strong key={m.index} style={{ color: 'var(--text)', fontWeight: 700 }}>{m[1]}</strong>)
    else if (m[2] != null) parts.push(<code key={m.index} style={{ background: 'var(--bg-surface0)', borderRadius: 3, padding: '1px 5px', fontSize: '0.9em', color: 'var(--accent)' }}>{m[2]}</code>)
    else if (m[3] != null) parts.push(<span key={m.index} style={{ color: 'var(--accent)', fontWeight: 600 }}>{m[3]}</span>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length ? parts : text
}

// ── Page list item ─────────────────────────────────────────────────────────────

function PageRow({ page, selected, onClick }) {
  const type = typeOf(page)
  const meta = TYPE_META[type] ?? { icon: '📄', color: 'var(--text-muted)' }
  const name = page.pageName ?? page.key?.split('/').slice(1).join('/') ?? page.key
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '9px 14px', textAlign: 'left',
        background: selected ? 'var(--bg-surface0)' : 'none',
        border: 'none', borderBottom: '1px solid var(--border)',
        cursor: 'pointer',
        borderLeft: selected ? `2px solid ${meta.color}` : '2px solid transparent',
      }}
    >
      <span style={{ fontSize: 15, flexShrink: 0 }}>{meta.icon}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', textTransform: 'capitalize', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name.replace(/-/g, ' ')}
        </p>
        <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '2px 0 0' }}>
          {type} · {timeSince(page.updated_at)}
        </p>
      </div>
    </button>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function WikiPanel({ userId }) {
  const [pages, setPages]       = useState([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [filter, setFilter]     = useState('all')
  const [query, setQuery]       = useState('')
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

  const visible = pages.filter(p => {
    if (filter !== 'all' && typeOf(p) !== filter) return false
    if (query) {
      const name = (p.pageName ?? p.key ?? '').toLowerCase()
      return name.includes(query.toLowerCase())
    }
    return true
  })

  const counts = {}
  for (const p of pages) { const t = typeOf(p); counts[t] = (counts[t] ?? 0) + 1 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Search + refresh */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search pages…"
          style={{
            flex: 1, background: 'var(--bg-surface0)', border: '1px solid var(--border)',
            borderRadius: 6, padding: '6px 10px', fontSize: 12, color: 'var(--text)',
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={load}
          title="Refresh"
          style={{ background: 'var(--bg-surface0)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13 }}
        >
          ↺
        </button>
      </div>

      {/* Type filter tabs */}
      <div style={{ display: 'flex', gap: 4, padding: '8px 14px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        {types.map(t => {
          const meta = TYPE_META[t]
          const active = filter === t
          return (
            <button
              key={t}
              type="button"
              onClick={() => setFilter(t)}
              style={{
                fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20,
                border: active ? `1px solid ${meta?.color ?? 'var(--accent)'}` : '1px solid var(--border)',
                background: active ? (meta?.color ?? 'var(--accent)') + '22' : 'none',
                color: active ? (meta?.color ?? 'var(--accent)') : 'var(--text-muted)',
                cursor: 'pointer', textTransform: 'capitalize',
              }}
            >
              {t === 'all' ? `All (${pages.length})` : `${meta?.icon} ${t} (${counts[t] ?? 0})`}
            </button>
          )
        })}
      </div>

      {/* Body: list + detail */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>

        {/* Page list */}
        <div style={{ width: selected ? '38%' : '100%', flexShrink: 0, overflowY: 'auto', borderRight: selected ? '1px solid var(--border)' : 'none' }}>
          {loading && (
            <p style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)' }}>Loading…</p>
          )}
          {error && (
            <p style={{ padding: 16, fontSize: 12, color: 'var(--danger)' }}>{error}</p>
          )}
          {!loading && !error && visible.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center' }}>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
                {pages.length === 0 ? 'No pages yet.' : 'No pages match.'}
              </p>
              {pages.length === 0 && (
                <p style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                  Ingest a job posting or URL to build your wiki.
                </p>
              )}
            </div>
          )}
          {visible.map(p => (
            <PageRow
              key={p.key}
              page={p}
              selected={selected?.key === p.key}
              onClick={() => setSelected(prev => prev?.key === p.key ? null : p)}
            />
          ))}
        </div>

        {/* Page detail */}
        {selected && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', minWidth: 0 }}>
            <button
              type="button"
              onClick={() => setSelected(null)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, marginBottom: 12, padding: 0 }}
            >
              ← back
            </button>
            <div>{renderMarkdown(selected.content)}</div>
            {selected.meta?.source && (
              <p style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                Source: {selected.meta.source}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
