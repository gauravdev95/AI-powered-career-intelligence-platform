import { useEffect, useRef, useState } from 'react'
import axios, { aiRequest } from '../lib/api.js'

const SUGGESTED_QUESTIONS = [
  'Which companies should I apply to first?',
  'What skills should I learn next?',
  'Are there any urgent hackathon deadlines?',
  'What are my biggest skill gaps?',
  'Which startup is the best fit for me?',
]

// Why a reply is canned rather than generated. Phrased so the user knows whether
// waiting helps, and that the rest of the app is unaffected either way.
const DEGRADED_LABEL = {
  rate_limited: 'AI quota reached — this is a stock reply, not a generated one. Your memory, matches and search still work.',
  unconfigured: 'No AI key configured — this is a stock reply. Matching and memory search work without one.',
  unavailable: 'The AI provider could not be reached — this is a stock reply.',
  no_context: 'Nothing in your wiki matches this yet. Ingest a job post or URL, then ask again.',
}

function Message({ msg }) {
  return (
    <div className={`chat-message ${msg.role}`}>
      <div className="chat-bubble">
        <p className="chat-text">{msg.content}</p>
        {msg.degraded && DEGRADED_LABEL[msg.degraded] && (
          <p className="chat-degraded">{DEGRADED_LABEL[msg.degraded]}</p>
        )}
        {msg.citations?.length > 0 && (
          <div className="chat-citations">
            {msg.citations.map(c => (
              <div key={c.key} className="citation-chip" title={c.excerpt}>
                <span className="citation-key">{c.pageName}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <span className="chat-time">{msg.time}</span>
    </div>
  )
}

export default function ChatInterface({ userId, userStack, wikiPageCount }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function now() {
    return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  async function sendMessage(question) {
    const q = (question ?? input).trim()
    if (!q || loading || !userId) return

    const userMsg = { role: 'user', content: q, time: now() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const { data } = await axios.post('/api/chat', {
        userId,
        question: q,
        userStack,
      }, aiRequest())

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.answer,
        citations: data.citations ?? [],
        // The API answers even when the model is rate-limited or unconfigured, using
        // a canned reply. Marking it keeps the user from reading a fallback as if it
        // were a real, memory-grounded answer.
        degraded: data.degraded ?? null,
        time: now(),
      }])
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: err.appMessage ?? 'Something went wrong. Please try again.',
        citations: [],
        time: now(),
      }])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const isEmpty = messages.length === 0

  return (
    <div className="chat-interface">
      <div className="chat-header">
        <span className="chat-title">Career Chat</span>
        <span className="chat-badge">{wikiPageCount ?? 0} wiki pages</span>
      </div>

      <div className="chat-messages">
        {isEmpty ? (
          <div className="chat-empty">
            <div className="chat-empty-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p className="chat-empty-title">Ask anything about your career</p>
            <p className="chat-empty-sub">
              {(wikiPageCount ?? 0) === 0
                ? 'Ingest some content first to build your wiki, then ask questions.'
                : 'Your answers are sourced from your personal wiki pages.'}
            </p>
            <div className="chat-suggestions">
              {SUGGESTED_QUESTIONS.map(q => (
                <button
                  key={q}
                  className="suggestion-chip"
                  type="button"
                  onClick={() => sendMessage(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => <Message key={i} msg={msg} />)}
            {loading && (
              <div className="chat-message assistant">
                <div className="chat-bubble">
                  <span className="typing-dots"><span /><span /><span /></span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      <div className="chat-input-area">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your career, skills, or opportunities…"
          rows={2}
          disabled={loading}
        />
        <button
          className="chat-send"
          type="button"
          onClick={() => sendMessage()}
          disabled={!input.trim() || loading || !userId}
          aria-label="Send message"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  )
}
