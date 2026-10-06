import { useCallback, useEffect, useRef, useState } from 'react'
import axios, { aiRequest } from '../lib/api.js'
import { Icon } from './icons.jsx'

/**
 * Ingest page — "Ingest Career Knowledge", in the reference's dark style.
 *
 * Everything is the logged-in user's real data: the extraction preview shows
 * entities the backend actually extracted from their content, and the history
 * lists their real ingestion log. Nothing is demo data.
 */

const MAX_CHARS = 5000

const TABS = [
  { id: 'text', label: 'Paste Text', icon: 'paste' },
  { id: 'url', label: 'URL', icon: 'link' },
  { id: 'screenshot', label: 'Screenshot', icon: 'camera' },
  { id: 'file', label: 'Upload File', icon: 'upload' },
]

const QUICK_EXAMPLES = [
  { id: 'job', label: 'Job Posting', tab: 'text', sample: 'Senior Frontend Engineer — Acme Corp (Bengaluru, Hybrid)\n\nWe are looking for a Senior Frontend Engineer with 3+ years of experience in React, TypeScript and Node.js. You will build our design system, own frontend architecture, and work with GraphQL APIs.\n\nRequirements: React, TypeScript, Node.js, GraphQL, AWS, System Design.\nNice to have: Next.js, Docker, Kubernetes.\n\nSalary: ₹25–35 LPA.' },
  { id: 'linkedin', label: 'LinkedIn About', tab: 'text', sample: 'About — Full-stack developer with 2 years of experience building web apps with React, Node.js and PostgreSQL. Interested in AI/ML, system design and developer tools. Open to SDE roles at product companies.' },
  { id: 'startup', label: 'Startup Career Page', tab: 'url', sample: 'https://example-startup.com/careers' },
  { id: 'course', label: 'Course Description', tab: 'text', sample: 'System Design Masterclass — Learn distributed systems, load balancing, caching with Redis, message queues with Kafka, and database sharding. Includes hands-on projects with Docker and AWS.' },
  { id: 'hackathon', label: 'Hackathon Listing', tab: 'text', sample: 'HackNight 2026 — 48-hour hackathon. Build AI-powered apps. Skills: Python, React, LLMs, RAG. Prizes worth ₹2,00,000. Team size 2–4.' },
]

const TYPE_META = {
  text: { label: 'Text Input', icon: 'paste' },
  url: { label: 'Website URL', icon: 'link' },
  screenshot: { label: 'Screenshot', icon: 'camera' },
  file: { label: 'Uploaded File', icon: 'upload' },
}

function timeAgo(iso) {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  const weeks = Math.round(days / 7)
  return `${weeks} week${weeks === 1 ? '' : 's'} ago`
}

function domainOf(source) {
  try {
    return new URL(source).hostname.replace(/^www\./, '')
  } catch { return source.slice(0, 42) }
}

export default function IngestPage({ userId, onPagesCreated }) {
  const [tab, setTab] = useState('text')
  const [input, setInput] = useState('')
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState(null) // { tone, text }
  const [preview, setPreview] = useState(null) // { companies, skills, projects, gaps } name arrays
  const [expanded, setExpanded] = useState({})
  const [history, setHistory] = useState([])
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef(null)
  const shotRef = useRef(null)

  const fetchHistory = useCallback(async () => {
    if (!userId) return
    try {
      const { data } = await axios.get(`/api/ingest/${userId}/recent`)
      setHistory(data.ingestions ?? [])
    } catch { /* history is a bonus */ }
  }, [userId])

  useEffect(() => { fetchHistory() }, [fetchHistory])

  async function handleIngest() {
    const value = input.trim()
    if (!value || !userId || loading) return

    if (tab === 'screenshot') {
      setStatus({ tone: 'warn', text: 'Screenshot analysis is not supported yet — copy the text from the page and paste it instead.' })
      return
    }

    setLoading(true)
    setStatus(null)
    try {
      const { data } = await axios.post('/api/ingest', { userId, input: value }, aiRequest())
      const names = {
        companies: data.entities?.companyNames ?? [],
        skills: data.entities?.skillNames ?? [],
        projects: data.entities?.projectNames ?? [],
        gaps: data.entities?.gapNames ?? [],
      }
      setPreview(names)
      const total = names.companies.length + names.skills.length + names.projects.length + names.gaps.length
      setStatus({
        tone: total ? 'ok' : 'warn',
        text: total
          ? `Extracted ${total} entities — ${data.pages?.length ?? 0} wiki pages created. Your graph and recommendations just got smarter.`
          : 'No entities found. Try pasting the job description text directly instead of a URL.',
      })
      setInput('')
      setFileName('')
      if (onPagesCreated) onPagesCreated(data.pages ?? [])
      fetchHistory()
    } catch (err) {
      setStatus({ tone: 'error', text: err.appMessage ?? 'Something went wrong. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  function applyExample(example) {
    setTab(example.tab)
    setInput(example.sample)
    setFileName('')
    setStatus(null)
  }

  function handleFile(file, asImage) {
    if (!file) return
    if (asImage) {
      if (!file.type.startsWith('image/')) {
        setStatus({ tone: 'error', text: 'Please upload an image file (PNG, JPG, WEBP).' })
        return
      }
      const reader = new FileReader()
      reader.onload = e => {
        setInput(e.target.result)
        setFileName(file.name)
        setStatus({ tone: 'warn', text: 'Screenshot analysis is not supported yet — copy the text from the page and paste it instead.' })
      }
      reader.readAsDataURL(file)
      return
    }
    if (file.size > 200000) {
      setStatus({ tone: 'error', text: 'That file is over 200 KB — paste the relevant text instead.' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setInput(String(reader.result ?? '').slice(0, MAX_CHARS))
      setFileName(file.name)
      setStatus(null)
    }
    reader.readAsText(file)
  }

  const categories = [
    { key: 'skills', label: 'Skills', icon: 'bulb', tone: 'teal', items: preview?.skills ?? [] },
    { key: 'companies', label: 'Companies', icon: 'building', tone: 'purple', items: preview?.companies ?? [] },
    { key: 'roles', label: 'Roles', icon: 'user', tone: 'blue', items: [] },
    { key: 'projects', label: 'Projects', icon: 'cube', tone: 'pink', items: preview?.projects ?? [] },
    { key: 'tech', label: 'Technologies', icon: 'code', tone: 'amber', items: [] },
    { key: 'goals', label: 'Goals / Interests', icon: 'target', tone: 'amber', items: preview?.gaps ?? [] },
  ]

  return (
    <section className="ingest-page">
      <header className="ingest-head">
        <div className="ingest-head-text">
          <h1 className="ingest-title">Ingest Career Knowledge</h1>
          <p className="ingest-sub">Add job postings, profiles, courses, or any career content to build your personalized knowledge base.</p>
        </div>
        <div className="ingest-hero">
          <div className="ingest-art" aria-hidden="true">
            <span className="art-center"><Icon name="upload" /></span>
            <span className="art-chip art-in"><Icon name="linkedin" /></span>
            <span className="art-chip art-doc"><Icon name="resume" /></span>
            <span className="art-chip art-video"><Icon name="play" /></span>
            <span className="art-chip art-globe"><Icon name="globe" /></span>
          </div>
          <p className="ingest-tagline">More data.<br />Smarter insights.<br />A stronger you.</p>
        </div>
      </header>

      <div className="ingest-grid">
        <div className="ingest-col-main">
          {/* Add Knowledge */}
          <div className="ingest-card">
            <h2 className="ingest-card-title"><span className="ingest-card-icon"><Icon name="ingest" /></span> Add Knowledge</h2>
            <p className="ingest-card-sub">Ingest job postings, URLs, screenshots or text to extract skills, companies, roles and more.</p>

            <div className="ingest-tabs" role="tablist" aria-label="Input type">
              {TABS.map(t => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  className={`ingest-tab ${tab === t.id ? 'active' : ''}`}
                  onClick={() => { setTab(t.id); setInput(''); setFileName(''); setStatus(null) }}
                >
                  <Icon name={t.icon} /> {t.label}
                </button>
              ))}
            </div>

            <div className="ingest-input-zone">
              {tab === 'text' && (
                <>
                  <textarea
                    className="ingest-textarea"
                    value={input}
                    onChange={e => setInput(e.target.value.slice(0, MAX_CHARS))}
                    placeholder="Paste a job description, LinkedIn About section, startup pitch, course description, or any career-relevant text…"
                    rows={7}
                    disabled={loading}
                  />
                  <span className="char-count">{input.length}/{MAX_CHARS}</span>
                </>
              )}
              {tab === 'url' && (
                <input
                  className="ingest-url-input"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="https://linkedin.com/jobs/view/… or any job posting URL"
                  disabled={loading}
                  inputMode="url"
                />
              )}
              {tab === 'screenshot' && (
                <>
                  <div className="ingest-warn-note">
                    <Icon name="bulb" />
                    <p>Screenshot analysis isn&apos;t supported yet — copy the text from the page and paste it in the Paste Text tab instead.</p>
                  </div>
                  <div
                    className={`shot-drop ${dragOver ? 'drag-over' : ''}`}
                  onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0], true) }}
                  onClick={() => shotRef.current?.click()}
                >
                  <Icon name="camera" />
                  <p>Drop a screenshot here or click to upload</p>
                  <span>PNG, JPG, WEBP</span>
                  <input ref={shotRef} type="file" accept="image/*" hidden onChange={e => { handleFile(e.target.files?.[0], true); e.target.value = '' }} />
                </div>
              </>
              )}
              {tab === 'file' && (
                <div className="file-drop" onClick={() => fileRef.current?.click()}>
                  {fileName ? (
                    <p className="file-loaded"><Icon name="resume" /> {fileName} <span>— ready to ingest</span></p>
                  ) : (
                    <>
                      <Icon name="upload" />
                      <p>Click to upload a text file</p>
                      <span>.txt, .md, .json, .csv — up to 200 KB</span>
                    </>
                  )}
                  <input ref={fileRef} type="file" accept=".txt,.md,.json,.csv,.log" hidden onChange={e => { handleFile(e.target.files?.[0], false); e.target.value = '' }} />
                </div>
              )}
            </div>

            <div className="quick-examples">
              <span className="quick-label">Quick examples:</span>
              {QUICK_EXAMPLES.map(ex => (
                <button key={ex.id} type="button" className="quick-chip" onClick={() => applyExample(ex)}>{ex.label}</button>
              ))}
            </div>

            <button
              className={`ingest-cta ${loading ? 'loading' : ''}`}
              type="button"
              onClick={handleIngest}
              disabled={!input.trim() || loading || !userId}
            >
              {loading ? <><span className="btn-spinner" /> Analyzing…</> : <><span aria-hidden="true">✨</span> Ingest &amp; Analyze</>}
            </button>

            {status && <p className={`ingest-status ingest-status--${status.tone}`}>{status.text}</p>}
          </div>

          {/* Recent Ingestions */}
          <div className="ingest-card">
            <div className="ingest-card-head">
              <div>
                <h2 className="ingest-card-title"><span className="ingest-card-icon"><Icon name="clock" /></span> Recent Ingestions</h2>
                <p className="ingest-card-sub">Your recently added content and extracted insights.</p>
              </div>
              <button type="button" className="view-all-btn" onClick={fetchHistory}>View All</button>
            </div>
            <div className="ingest-history">
              {loading && (
                <div className="history-row processing">
                  <span className="history-icon"><span className="btn-spinner" /></span>
                  <div className="history-main"><p className="history-title">Analyzing your content…</p></div>
                  <span className="status-badge processing">Processing</span>
                </div>
              )}
              {history.map((item, i) => {
                const meta = TYPE_META[item.inputType] ?? TYPE_META.text
                const ents = item.entities ?? {}
                const chips = []
                if ((ents.skills ?? []).length) chips.push(`Skills +${ents.skills.length}`)
                if ((ents.companies ?? []).length) chips.push(`Companies +${ents.companies.length}`)
                if ((ents.projects ?? []).length) chips.push(`Projects +${ents.projects.length}`)
                if ((ents.gaps ?? []).length) chips.push(`Gaps +${ents.gaps.length}`)
                const title = item.inputType === 'url' ? domainOf(item.source) : (item.summary || item.source).slice(0, 48)
                return (
                  <div className="history-row" key={i}>
                    <span className={`history-icon hi-${item.inputType}`}><Icon name={meta.icon} /></span>
                    <div className="history-main">
                      <p className="history-title">{title}</p>
                      <p className="history-sub">{item.source?.slice(0, 60) ?? ''} · {meta.label}</p>
                    </div>
                    <div className="history-chips">
                      {chips.map(chip => <span className="history-chip" key={chip}>{chip}</span>)}
                    </div>
                    <span className="history-time">{timeAgo(item.createdAt)}</span>
                    <span className="status-badge completed">Completed</span>
                  </div>
                )
              })}
              {!history.length && !loading && (
                <p className="history-empty">Nothing ingested yet — paste your first job posting above.</p>
              )}
            </div>
          </div>
        </div>

        <div className="ingest-col-side">
          {/* AI Extraction Preview */}
          <div className="ingest-card">
            <div className="ingest-card-head">
              <h2 className="ingest-card-title">AI Extraction Preview</h2>
              <span className="live-badge"><span aria-hidden="true">✦</span> Live Preview</span>
            </div>
            <p className="ingest-card-sub">See what information Grafted will extract from your content.</p>
            <div className="extract-cats">
              {categories.map(cat => (
                <div className="extract-cat" key={cat.key}>
                  <button
                    type="button"
                    className="extract-cat-head"
                    onClick={() => setExpanded(prev => ({ ...prev, [cat.key]: !prev[cat.key] }))}
                    aria-expanded={!!expanded[cat.key]}
                  >
                    <span className={`extract-icon ei-${cat.tone}`}><Icon name={cat.icon} /></span>
                    <span className="extract-label">{cat.label}</span>
                    <span className="extract-count">{cat.items.length}</span>
                    <span className={`extract-chevron ${expanded[cat.key] ? 'open' : ''}`}>›</span>
                  </button>
                  {expanded[cat.key] && (
                    <div className="extract-items">
                      {cat.items.length
                        ? cat.items.map(item => <span className="extract-pill" key={item}>{item}</span>)
                        : <span className="extract-none">Nothing extracted yet</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {!preview && <p className="preview-note"><span aria-hidden="true">ⓘ</span> Paste some content to see extracted data preview</p>}
          </div>

          {/* Career Memory Impact */}
          <div className="ingest-card">
            <h2 className="ingest-card-title"><span className="ingest-card-icon"><Icon name="nodes" /></span> Career Memory Impact</h2>
            <p className="ingest-card-sub">This data will enhance your career graph and recommendations.</p>
            <div className="impact-list">
              {[
                { icon: 'chart', tone: 'teal', title: 'Better Job Matching', sub: 'Find companies and roles that match your skills' },
                { icon: 'target', tone: 'purple', title: 'Improved Skill Gap Analysis', sub: 'Discover new skills to learn' },
                { icon: 'graph', tone: 'blue', title: 'Richer Career Graph', sub: 'Connect skills, companies, projects and more' },
                { icon: 'star', tone: 'amber', title: 'Personalized AI Recommendations', sub: 'Get tailored learning and career advice' },
              ].map(item => (
                <div className="impact-row" key={item.title}>
                  <span className={`impact-icon ii-${item.tone}`}><Icon name={item.icon} /></span>
                  <div><p className="impact-title">{item.title}</p><p className="impact-sub">{item.sub}</p></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
