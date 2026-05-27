import { useRef, useState, useCallback } from 'react'
import axios from '../lib/api.js'
import { Icon } from './icons.jsx'

const API_BASE = import.meta.env.VITE_API_URL || ''

const TABS = [
  { id: 'text', label: 'Paste text' },
  { id: 'url', label: 'URL' },
  { id: 'screenshot', label: 'Screenshot' },
]

const PLACEHOLDERS = {
  text: 'Paste a job description, LinkedIn About section, startup pitch, or any career-relevant text…',
  url: 'https://linkedin.com/jobs/view/... or any job posting URL',
  screenshot: 'Drop an image here or click to upload',
}

const SUGGESTIONS = [
  'Paste a job posting from LinkedIn',
  "Drop in a startup's careers page URL",
  'Paste a skill description from a course',
  'Add a hackathon listing',
]

export default function IngestPanel({ userId, onPagesCreated }) {
  const [tab, setTab] = useState('text')
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [log, setLog] = useState([])
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef(null)
  const logIdRef = useRef(0)

  const addLog = useCallback((type, text) => {
    const id = ++logIdRef.current
    setLog(prev => [...prev.slice(-19), { type, text, id }])
  }, [])

  async function handleSubmit() {
    const value = input.trim()
    if (!value || !userId || loading) return

    setLoading(true)
    addLog('info', tab === 'url' ? `Fetching ${value.slice(0, 60)}…` : 'Processing input…')

    try {
      const { data } = await axios.post(`${API_BASE}/api/ingest`, { userId, input: value })

      const totalEntities = (data.entities?.companies ?? 0) + (data.entities?.skills ?? 0)
        + (data.entities?.hackathons ?? 0) + (data.entities?.gaps ?? 0)

      if (totalEntities === 0) {
        addLog('warn', '⚠ No entities found. Try pasting the job description text directly instead of a URL.')
      } else {
        addLog('success', `✓ ${data.summary || 'Ingested successfully'}`)
        const parts = []
        if (data.entities?.companies) parts.push(`${data.entities.companies} companies`)
        if (data.entities?.skills) parts.push(`${data.entities.skills} skills`)
        if (data.entities?.hackathons) parts.push(`${data.entities.hackathons} hackathons`)
        if (data.entities?.gaps) parts.push(`${data.entities.gaps} gaps`)
        if (parts.length) addLog('info', `Extracted: ${parts.join(', ')}`)
        addLog('success', `${data.pages?.length ?? 0} wiki pages created`)
      }

      setInput('')
      if (onPagesCreated) onPagesCreated(data.pages ?? [])
    } catch (err) {
      const msg = err.appMessage ?? err.message
      addLog('error', `✗ ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    readImageFile(file)
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    readImageFile(file)
  }

  function readImageFile(file) {
    if (!file.type.startsWith('image/')) {
      addLog('error', 'Please upload an image file (PNG, JPG, WEBP)')
      return
    }
    const reader = new FileReader()
    reader.onload = e => {
      setInput(e.target.result)
      addLog('info', `Image loaded: ${file.name}`)
    }
    reader.readAsDataURL(file)
  }

  const canSubmit = input.trim().length > 0 && !loading && userId

  return (
    <div className="ingest-panel">
      <div className="ingest-header">
        <span className="ingest-title">Feed your wiki</span>
        <p className="ingest-subtitle">Ingest job postings, URLs, or screenshots to build your career knowledge base</p>
      </div>

      <div className="ingest-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`ingest-tab ${tab === t.id ? 'active' : ''}`}
            type="button"
            onClick={() => { setTab(t.id); setInput('') }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="ingest-input-area">
        {tab === 'screenshot' ? (
          <div
            className={`drop-zone ${dragOver ? 'drag-over' : ''} ${input ? 'has-image' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => !input && fileRef.current?.click()}
          >
            {input ? (
              <div className="drop-zone-preview">
                <img src={input} alt="Uploaded screenshot" className="screenshot-preview" />
                <button className="clear-image" type="button" onClick={e => { e.stopPropagation(); setInput('') }}>
                  Remove
                </button>
              </div>
            ) : (
              <div className="drop-zone-placeholder">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="upload-icon">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span>Drop screenshot or click to upload</span>
                <span className="drop-zone-hint">PNG, JPG, WEBP</span>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden-file-input" onChange={handleFileChange} />
          </div>
        ) : (
          <textarea
            className="ingest-textarea"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={PLACEHOLDERS[tab]}
            rows={tab === 'url' ? 2 : 6}
            disabled={loading}
          />
        )}
      </div>

      <div className="ingest-footer">
        <div className="ingest-suggestions">
          {SUGGESTIONS.map(s => (
            <button
              key={s}
              className="suggestion-chip"
              type="button"
              onClick={() => { setTab('text'); setInput(s) }}
            >
              {s}
            </button>
          ))}
        </div>

        <button
          className={`btn btn-primary ingest-submit ${loading ? 'loading' : ''}`}
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {loading ? (
            <><span className="btn-spinner" /> Processing…</>
          ) : (
            <>Ingest <kbd>⌘↵</kbd></>
          )}
        </button>
      </div>

      {log.length > 0 && (
        <div className="ingest-log">
          <p className="ingest-log-title">Activity</p>
          {log.map(entry => (
            <div key={entry.id} className={`log-entry log-${entry.type}`}>
              {entry.text}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
