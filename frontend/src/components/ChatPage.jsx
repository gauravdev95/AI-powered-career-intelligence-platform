import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios, { aiRequest } from '../lib/api.js'
import { isSameSkill, matchScoreOf } from '../lib/graph.js'
import { Icon } from './icons.jsx'

/**
 * AI Career Assistant — full chat page in the reference's dark style.
 *
 * Two answer paths:
 *  1. Deterministic rich builders for the quick actions / suggested prompts.
 *     They read the logged-in user's real analysis data (match scores, gaps,
 *     roadmap, interview topics) and render structured tables — never invented.
 *  2. Free-form questions go to /api/chat, whose answers are grounded in the
 *     user's career memory; markdown (including tables) is rendered richly.
 */

const now = () => new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
const uid = () => Math.random().toString(36).slice(2, 10)

function timeAgo(iso) {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function profileCompletion(profile) {
  if (!profile) return 0
  const fields = [
    profile.name, profile.experience, profile.target_role, profile.timeline,
    (profile.stack ?? []).length > 0, (profile.goals ?? []).length > 0, profile.learning_style,
  ]
  return Math.round((fields.filter(Boolean).length / fields.length) * 100)
}

function requiredByPct(skill, startups) {
  if (!startups.length) return 0
  const n = startups.filter(s => (s.skills_required ?? []).some(r => isSameSkill(r, skill))).length
  return Math.round((n / startups.length) * 100)
}

function priorityOf(index) {
  if (index < 2) return { label: 'High Priority', tone: 'high' }
  if (index < 4) return { label: 'Medium Priority', tone: 'medium' }
  return { label: 'Low Priority', tone: 'low' }
}

// ── Rich answer builders (all data from the logged-in user) ─────────────────

function buildJobMatching({ startups, userStack }) {
  const top = [...startups].sort((a, b) => matchScoreOf(b) - matchScoreOf(a)).slice(0, 5)
  if (!top.length) {
    return [{ type: 'text', text: 'No company matches yet — run an analysis from the dashboard first, then ask me again.' }]
  }
  return [
    { type: 'text', text: 'Based on your skills, profile and current market demand, here are the best matching companies for you:' },
    {
      type: 'company-table',
      rows: top.map((company, i) => {
        const required = company.skills_required ?? []
        const matched = required.filter(skill => userStack.some(known => isSameSkill(known, skill)))
        return {
          rank: i + 1,
          name: company.name,
          score: matchScoreOf(company),
          skills: matched.slice(0, 3),
          extraSkills: Math.max(0, matched.length - 3),
          roles: (company.roles_available ?? []).slice(0, 2).join(', '),
        }
      }),
    },
  ]
}

function buildSkillAnalysis({ gapReport, startups }) {
  const gaps = gapReport?.priority_skills ?? []
  if (!gaps.length) {
    return [{ type: 'text', text: 'No skill gaps detected — run an analysis from the dashboard to get your personalized gap list.' }]
  }
  return [
    { type: 'text', text: 'Here are the top skills you should learn next, based on your current skills and market demand:' },
    {
      type: 'skill-table',
      rows: gaps.slice(0, 6).map((gap, i) => ({
        rank: i + 1,
        skill: gap.skill,
        ...priorityOf(i),
        requiredBy: requiredByPct(gap.skill, startups),
        time: `${gap.time_weeks ?? 2}–${(gap.time_weeks ?? 2) + 1} weeks`,
        difficulty: gap.difficulty ?? 'Medium',
      })),
    },
  ]
}

function buildRoadmap({ gapReport }, months = null) {
  const gaps = gapReport?.priority_skills ?? []
  if (!gaps.length) {
    return [{ type: 'text', text: 'No roadmap yet — run an analysis from the dashboard and I will build your step-by-step plan.' }]
  }
  const steps = gaps.slice(0, 5)
  return [
    { type: 'text', text: months ? `Here is your ${months}-month learning plan, ordered by impact:` : 'Here is your step-by-step learning roadmap, ordered by impact:' },
    {
      type: 'roadmap',
      steps: steps.map((gap, i) => ({
        n: i + 1,
        skill: gap.skill,
        weeks: gap.time_weeks ?? 2,
        difficulty: gap.difficulty ?? 'Medium',
        ...priorityOf(i),
        why: gap.why,
      })),
    },
  ]
}

function buildCareerAdvice({ profile, startups, gapReport, userStack }) {
  const top = [...startups].sort((a, b) => matchScoreOf(b) - matchScoreOf(a))[0]
  const gaps = gapReport?.priority_skills ?? []
  const name = (profile?.name ?? 'there').split(' ')[0]
  const lines = []
  if (top) lines.push(`Your strongest match right now is **${top.name}** at ${matchScoreOf(top)}% — double down on the roles they are hiring for.`)
  if (gaps[0]) lines.push(`The single highest-leverage move is learning **${gaps[0].skill}** (${gaps[0].time_weeks ?? 2} weeks): it is required by ${requiredByPct(gaps[0].skill, startups)}% of your matched companies.`)
  if ((profile?.goals ?? [])[0]) lines.push(`Your goal “${profile.goals[0]}” lines up well — keep every application and project pointed at it.`)
  if (!lines.length) lines.push('Complete your profile and run an analysis so I can give you sharper, data-backed advice.')
  return [
    { type: 'text', text: `Here is my honest take, ${name}:` },
    { type: 'checklist', items: lines.map(text => ({ ok: true, text })) },
    {
      type: 'stats',
      items: [
        { value: top ? `${matchScoreOf(top)}%` : '—', label: 'Top match' },
        { value: String(userStack.length), label: 'Skills' },
        { value: String(gaps.length), label: 'Gaps to close' },
      ],
    },
  ]
}

function buildResumeFeedback({ profile, startups, userStack }) {
  const top = [...startups].sort((a, b) => matchScoreOf(b) - matchScoreOf(a)).slice(0, 5)
  const required = new Set()
  top.forEach(s => (s.skills_required ?? []).forEach(skill => required.add(skill)))
  const missing = [...required].filter(skill => !userStack.some(known => isSameSkill(known, skill))).slice(0, 6)
  const items = []
  items.push({ ok: userStack.length >= 5, text: userStack.length >= 5 ? `Skills section looks solid (${userStack.length} skills listed).` : `Add more skills — you list only ${userStack.length}; your top matches ask for ${required.size} distinct ones.` })
  items.push({ ok: missing.length === 0, text: missing.length === 0 ? 'Your stack covers the keywords your top matches ask for.' : `Missing keywords recruiters filter on: ${missing.join(', ')}.` })
  items.push({ ok: Boolean(profile?.target_role), text: profile?.target_role ? `Target role “${profile.target_role}” is set — tailor the headline to it.` : 'Set a target role so the resume reads as focused, not generic.' })
  items.push({ ok: false, text: 'Quantify every project bullet (users, latency, accuracy) — numbers beat adjectives.' })
  return [
    { type: 'text', text: 'Here is my ATS-focused feedback, based on what your top matched companies actually filter on:' },
    { type: 'checklist', items },
  ]
}

function buildInterviewPrep({ startups }) {
  const top = [...startups].sort((a, b) => matchScoreOf(b) - matchScoreOf(a)).slice(0, 3)
  const groups = top
    .map(s => ({ company: s.name, topics: s.interview_topics ?? [] }))
    .filter(g => g.topics.length)
  if (!groups.length) {
    return [{ type: 'text', text: 'No interview topics found for your matches yet — run an analysis first.' }]
  }
  return [
    { type: 'text', text: 'Interview topics your top matches actually ask, pulled from their hiring data:' },
    { type: 'topic-groups', groups },
    { type: 'text', text: 'Pick one company and I will drill you with mock questions on any of these topics.' },
  ]
}

function buildOpportunities({ startups }) {
  const top = [...startups].sort((a, b) => matchScoreOf(b) - matchScoreOf(a)).slice(0, 5)
  const items = top.flatMap(s => (s.roles_available ?? []).slice(0, 2).map(role => ({
    role, company: s.name, score: matchScoreOf(s), applyUrl: s.apply_url,
  })))
  if (!items.length) {
    return [{ type: 'text', text: 'No open roles listed for your matches right now.' }]
  }
  return [
    { type: 'text', text: 'Latest openings at your best-matched companies:' },
    { type: 'opp-list', items: items.slice(0, 8) },
  ]
}

// ── Minimal markdown renderer (tables, lists, bold, code, links) ─────────────

function renderInline(text) {
  const parts = []
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[([^\]]+)\]\(([^)]+)\))/g
  let last = 0
  let m
  let k = 0
  while ((m = regex.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const token = m[0]
    if (token.startsWith('**')) parts.push(<strong key={k++}>{token.slice(2, -2)}</strong>)
    else if (token.startsWith('*')) parts.push(<em key={k++}>{token.slice(1, -1)}</em>)
    else if (token.startsWith('`')) parts.push(<code key={k++}>{token.slice(1, -1)}</code>)
    else parts.push(<a key={k++} href={m[3]} target="_blank" rel="noopener noreferrer">{m[2]}</a>)
    last = m.index + token.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length ? parts : [text]
}

function Markdown({ text }) {
  const lines = String(text ?? '').split('\n')
  const blocks = []
  let i = 0
  let k = 0
  while (i < lines.length) {
    const line = lines[i]
    // Table
    if (/^\|.*\|$/.test(line.trim()) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      const headers = line.trim().slice(1, -1).split('|').map(c => c.trim())
      i += 2
      const rows = []
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        rows.push(lines[i].trim().slice(1, -1).split('|').map(c => c.trim()))
        i++
      }
      blocks.push(
        <div className="md-table-wrap" key={k++}>
          <table className="md-table">
            <thead><tr>{headers.map((h, hi) => <th key={hi}>{renderInline(h)}</th>)}</tr></thead>
            <tbody>{rows.map((row, ri) => <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{renderInline(cell)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )
      continue
    }
    // Heading
    const heading = /^(#{1,4})\s+(.*)/.exec(line)
    if (heading) {
      const Tag = `h${heading[1].length + 2}`
      blocks.push(<Tag className="md-heading" key={k++}>{renderInline(heading[2])}</Tag>)
      i++
      continue
    }
    // Code block
    if (/^```/.test(line)) {
      i++
      const code = []
      while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++ }
      i++
      blocks.push(<pre className="md-code" key={k++}><code>{code.join('\n')}</code></pre>)
      continue
    }
    // List
    if (/^\s*([-*]|\d+[.)])\s+/.test(line)) {
      const items = []
      const ordered = /^\s*\d+[.)]/.test(line)
      while (i < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+[.)])\s+/, ''))
        i++
      }
      const ListTag = ordered ? 'ol' : 'ul'
      blocks.push(<ListTag className="md-list" key={k++}>{items.map((item, ii) => <li key={ii}>{renderInline(item)}</li>)}</ListTag>)
      continue
    }
    // Paragraph
    if (line.trim()) blocks.push(<p className="md-p" key={k++}>{renderInline(line)}</p>)
    i++
  }
  return <>{blocks}</>
}

// ── Rich block renderers ─────────────────────────────────────────────────────

function CompanyTable({ rows }) {
  return (
    <div className="rich-table-wrap">
      <table className="rich-table">
        <thead><tr><th>#</th><th>Company</th><th>Match Score</th><th>Key Matching Skills</th><th>Role Types</th></tr></thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.rank}>
              <td className="rank">{row.rank}</td>
              <td className="co-name">{row.name}</td>
              <td><span className={`score-pill ${row.score >= 80 ? 'high' : row.score >= 60 ? 'med' : 'low'}`}>{row.score}%</span></td>
              <td>
                <span className="skill-pills">
                  {row.skills.map(skill => <span className="mini-pill" key={skill}>{skill}</span>)}
                  {row.extraSkills > 0 && <span className="mini-pill more">+{row.extraSkills}</span>}
                </span>
              </td>
              <td className="muted-cell">{row.roles || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SkillTable({ rows }) {
  return (
    <div className="rich-list">
      {rows.map(row => (
        <div className="rich-row" key={row.rank}>
          <span className="rich-rank">{row.rank}</span>
          <span className="rich-main">
            <strong>{row.skill}</strong>
            <span className="rich-sub">Required by {row.requiredBy}% companies</span>
          </span>
          <span className={`prio-badge prio-${row.priorityTone}`}>{row.label}</span>
          <span className="rich-meta">⏱ {row.time}</span>
          <span className={`diff-meter diff-${row.difficulty.toLowerCase().split(' ')[0]}`}>{row.difficulty}</span>
        </div>
      ))}
    </div>
  )
}

function RoadmapBlocks({ steps }) {
  return (
    <div className="rich-roadmap">
      {steps.map(step => (
        <div className="roadmap-step" key={step.n}>
          <span className="roadmap-n">{step.n}</span>
          <div className="roadmap-body">
            <p className="roadmap-skill">{step.skill} <span className={`prio-badge prio-${step.priorityTone}`}>{step.label}</span></p>
            <p className="roadmap-meta">⏱ {step.weeks} weeks · {step.difficulty}</p>
            {step.why && <p className="roadmap-why">{step.why}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}

function renderBlocks(blocks) {
  return blocks.map((block, i) => {
    switch (block.type) {
      case 'text': return <div className="md-p" key={i}><Markdown text={block.text} /></div>
      case 'company-table': return <CompanyTable key={i} rows={block.rows} />
      case 'skill-table': return <SkillTable key={i} rows={block.rows} />
      case 'roadmap': return <RoadmapBlocks key={i} steps={block.steps} />
      case 'stats': return (
        <div className="rich-stats" key={i}>
          {block.items.map(item => <div className="rich-stat" key={item.label}><strong>{item.value}</strong><span>{item.label}</span></div>)}
        </div>
      )
      case 'checklist': return (
        <ul className="rich-checklist" key={i}>
          {block.items.map((item, ii) => (
            <li key={ii} className={item.ok ? 'ok' : 'todo'}>
              <span className="check-icon">{item.ok ? '✓' : '→'}</span>
              <Markdown text={item.text} />
            </li>
          ))}
        </ul>
      )
      case 'topic-groups': return (
        <div className="rich-topics" key={i}>
          {block.groups.map(group => (
            <div className="topic-group" key={group.company}>
              <p className="topic-co">{group.company}</p>
              <div className="skill-pills">{group.topics.map(topic => <span className="mini-pill" key={topic}>{topic}</span>)}</div>
            </div>
          ))}
        </div>
      )
      case 'opp-list': return (
        <div className="rich-opps" key={i}>
          {block.items.map((item, ii) => (
            <div className="opp-row" key={ii}>
              <div><p className="opp-role">{item.role}</p><p className="opp-co">{item.company} · {item.score}% match</p></div>
              {item.applyUrl && <a className="chat-btn-sm" href={item.applyUrl} target="_blank" rel="noopener noreferrer">Apply</a>}
            </div>
          ))}
        </div>
      )
      default: return null
    }
  })
}

// ── Quick actions & suggested prompts ────────────────────────────────────────

const QUICK_ACTIONS = [
  { id: 'advice', icon: 'sparkles', tone: 'purple', title: 'Career Advice', sub: 'Personalized for you', question: 'Give me personalized career advice', build: buildCareerAdvice },
  { id: 'skills', icon: 'target', tone: 'teal', title: 'Skill Analysis', sub: 'Find your gaps', question: 'Analyze my skills and gaps', build: buildSkillAnalysis },
  { id: 'jobs', icon: 'interview', tone: 'pink', title: 'Job Matching', sub: 'Best opportunities', question: 'Which companies are best match for my skills?', build: buildJobMatching },
  { id: 'roadmap', icon: 'roadmap', tone: 'amber', title: 'Learning Roadmap', sub: 'Step by step plan', question: 'Create my learning roadmap', build: buildRoadmap },
  { id: 'resume', icon: 'resume', tone: 'blue', title: 'Resume Feedback', sub: 'ATS optimization', question: 'Give me feedback on my resume', build: buildResumeFeedback },
]

const SUGGESTED_PROMPTS = [
  { icon: 'briefcase', text: 'Find companies matching my skills', action: 'jobs' },
  { icon: 'roadmap', text: 'Create a 3-month learning plan', action: 'roadmap3' },
  { icon: 'resume', text: 'Analyze my resume', action: 'resume' },
  { icon: 'gap', text: 'What are my skill gaps?', action: 'skills' },
  { icon: 'interview', text: 'Prepare for interview questions', action: 'interview' },
  { icon: 'building', text: 'Show latest job opportunities', action: 'opps' },
  { icon: 'chat', text: 'Compare two career paths', action: 'free' },
  { icon: 'sparkles', text: 'How is the current AI job market?', action: 'free' },
]

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ChatPage({
  user, profile, userId, userStack = [], startups = [], hackathons = [],
  gapReport = null, initialQuery = null, chatKey = 0,
}) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [memoryOn, setMemoryOn] = useState(true)
  const [webSearch, setWebSearch] = useState(false)
  const [modelName, setModelName] = useState('')
  const [sessions, setSessions] = useState([])
  const [promptSpin, setPromptSpin] = useState(0)
  const [attachment, setAttachment] = useState(null)
  const [showAllSkills, setShowAllSkills] = useState(false)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const fileRef = useRef(null)
  const initialSentRef = useRef(false)

  const data = useMemo(() => ({ profile, startups, hackathons, gapReport, userStack }), [profile, startups, hackathons, gapReport, userStack])
  const completion = profileCompletion(profile)
  const skills = profile?.stack ?? userStack
  const goals = profile?.goals ?? []

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  // Real model name for the composer chip.
  useEffect(() => {
    axios.get('/api/health').then(({ data: health }) => {
      const model = health?.ai?.model
      if (model) setModelName(String(model).replace(/-/g, ' '))
    }).catch(() => {})
  }, [])

  const refreshSessions = useCallback(async () => {
    if (!userId) return
    try {
      const { data: payload } = await axios.get(`/api/chat/${userId}/recent`)
      setSessions(payload.sessions ?? [])
    } catch { /* history is a bonus, not a blocker */ }
  }, [userId])

  useEffect(() => { refreshSessions() }, [refreshSessions])

  // Top-bar search hands a question in — send it once per chat key.
  useEffect(() => {
    if (initialQuery && !initialSentRef.current) {
      initialSentRef.current = true
      sendFree(initialQuery)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatKey])

  function pushUser(text) {
    const msg = { id: uid(), role: 'user', kind: 'text', content: text, time: now() }
    setMessages(prev => [...prev, msg])
    return msg
  }

  function pushAssistant(blocks) {
    setMessages(prev => [...prev, { id: uid(), role: 'assistant', kind: 'rich', blocks, time: now() }])
  }

  /** Deterministic rich answer — no AI call, pure user data. */
  function runBuilder(actionId, question) {
    if (question) pushUser(question)
    setLoading(true)
    setTimeout(() => {
      const builders = {
        advice: buildCareerAdvice, skills: buildSkillAnalysis, jobs: buildJobMatching,
        roadmap: d => buildRoadmap(d), roadmap3: d => buildRoadmap(d, 3),
        resume: buildResumeFeedback, interview: buildInterviewPrep, opps: buildOpportunities,
      }
      const build = builders[actionId]
      pushAssistant(build ? build(data) : [{ type: 'text', text: 'I could not build that answer.' }])
      setLoading(false)
      inputRef.current?.focus()
    }, 350)
  }

  function runQuickAction(action) {
    runBuilder(action.id, action.question)
  }

  function runPrompt(prompt) {
    if (prompt.action === 'free') sendFree(prompt.text)
    else {
      const action = QUICK_ACTIONS.find(a => a.id === prompt.action)
      runBuilder(prompt.action, action ? action.question : prompt.text)
    }
  }

  /** Free-form question → the AI, grounded in career memory. */
  async function sendFree(question) {
    let q = (question ?? input).trim()
    if (!q || loading || !userId) return
    if (attachment) {
      q = `[Attached file: ${attachment.name}]\n${attachment.content}\n\n${q}`
    }
    pushUser(question ?? input.trim())
    setInput('')
    setAttachment(null)
    setLoading(true)
    try {
      const { data: res } = await axios.post('/api/chat', {
        userId, question: q, userStack, memory: memoryOn, webSearch,
      }, aiRequest())
      setMessages(prev => [...prev, {
        id: uid(), role: 'assistant', kind: 'text', content: res.answer,
        citations: res.citations ?? [], degraded: res.degraded ?? null,
        webSearchNote: res.webSearchUnsupported ? true : false, time: now(),
      }])
      refreshSessions()
    } catch (err) {
      setMessages(prev => [...prev, {
        id: uid(), role: 'assistant', kind: 'text',
        content: err.appMessage ?? 'Something went wrong. Please try again.',
        time: now(),
      }])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFree() }
  }

  function newChat() {
    setMessages([])
    setInput('')
    setAttachment(null)
    initialSentRef.current = true
    inputRef.current?.focus()
  }

  function openSession(session) {
    setMessages(session.turns.map(turn => ({
      id: uid(), role: turn.role, kind: 'text', content: turn.content, time: '',
    })))
  }

  function handleAttach(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 200000) {
      pushAssistant([{ type: 'text', text: 'That file is over 200 KB — paste the relevant section as text instead.' }])
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '').slice(0, 6000)
      setAttachment({ name: file.name, content: text })
    }
    reader.readAsText(file)
  }

  const prompts = useMemo(() => {
    const rotated = [...SUGGESTED_PROMPTS]
    for (let i = 0; i < promptSpin; i++) rotated.push(rotated.shift())
    return rotated
  }, [promptSpin])

  const initial = (user?.name ?? user?.email ?? 'G').slice(0, 1).toUpperCase()
  const headline = [profile?.experience, profile?.target_role].filter(Boolean).join(' | ') || 'Career Explorer'

  return (
    <section className="chat-page">
      <div className="chat-main">
        <header className="chat-page-head">
          <div>
            <h1 className="chat-page-title">AI Career Assistant <span className="sparkle" aria-hidden="true">✨</span></h1>
            <p className="chat-page-sub">Get personalized insights based on your career data, skills, goals and market trends.</p>
          </div>
          <button className="chat-new-btn" type="button" onClick={newChat}>
            <span className="chat-new-plus">+</span> New Chat
          </button>
        </header>

        <div className="qa-cards">
          {QUICK_ACTIONS.map(action => (
            <button key={action.id} type="button" className={`qa-card qa-${action.tone}`} onClick={() => runQuickAction(action)}>
              <span className="qa-icon"><Icon name={action.icon} /></span>
              <span className="qa-text"><strong>{action.title}</strong><span>{action.sub}</span></span>
            </button>
          ))}
        </div>

        <div className="chat-thread">
          {messages.length === 0 && !loading && (
            <div className="chat-welcome">
              <p className="chat-welcome-title">Ask anything about your career</p>
              <p className="chat-welcome-sub">Pick a quick action above, or type your own question — answers come from your live career data.</p>
            </div>
          )}
          {messages.map(msg => <ChatMessage key={msg.id} msg={msg} initial={initial} />)}
          {loading && (
            <div className="chat-msg assistant">
              <span className="chat-avatar">G</span>
              <div className="chat-bubble"><span className="typing-dots"><span /><span /><span /></span></div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="chat-composer">
          {attachment && (
            <div className="attach-chip">
              <Icon name="resume" />
              <span>{attachment.name}</span>
              <button type="button" onClick={() => setAttachment(null)} aria-label="Remove attachment">×</button>
            </div>
          )}
          <div className="composer-row">
            <button className="composer-icon-btn" type="button" onClick={() => fileRef.current?.click()} aria-label="Attach a text file">
              <Icon name="attach" />
            </button>
            <input ref={fileRef} type="file" accept=".txt,.md,.json,.csv,.log" onChange={handleAttach} hidden />
            <textarea
              ref={inputRef}
              className="composer-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about your career, skills, companies, or goals…"
              rows={1}
              disabled={loading}
            />
            <button className="composer-send" type="button" onClick={() => sendFree()} disabled={!input.trim() || loading} aria-label="Send message">
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M3.4 20.4 21.8 12 3.4 3.6l-.01 6.53L14 12 3.39 13.87l.01 6.53Z" /></svg>
            </button>
          </div>
          <div className="composer-toggles">
            <span className="toggle-label"><Icon name="globe" /> Career Memory ({memoryOn ? 'On' : 'Off'})</span>
            <button
              type="button" role="switch" aria-checked={memoryOn} aria-label="Career memory"
              className={`switch ${memoryOn ? 'on' : ''}`} onClick={() => setMemoryOn(v => !v)}
            >
              <span className="knob" />
            </button>
            <span className="toggle-label"><Icon name="search" /> Web Search</span>
            <button
              type="button" role="switch" aria-checked={webSearch} aria-label="Web search"
              className={`switch ${webSearch ? 'on' : ''}`} onClick={() => setWebSearch(v => !v)}
            >
              <span className="knob" />
            </button>
            {webSearch && <span className="websearch-note">Web search isn't connected yet — answering from your career memory.</span>}
            {modelName && <span className="model-chip">{modelName} ▾</span>}
          </div>
        </div>
      </div>

      <aside className="chat-context">
        <div className="ctx-head">
          <p className="ctx-title">Conversation Context</p>
          <button className="ctx-manage" type="button" onClick={refreshSessions}>Manage</button>
        </div>

        <div className="ctx-profile">
          <span className="ctx-avatar">{initial}</span>
          <div className="ctx-profile-info">
            <p className="ctx-name">{user?.name ?? 'Career Explorer'}</p>
            <p className="ctx-headline">{headline}</p>
            <div className="ctx-progress"><div className="ctx-progress-fill" style={{ width: `${completion}%` }} /></div>
            <p className="ctx-progress-label">Profile {completion}% complete</p>
          </div>
        </div>

        <div className="ctx-section">
          <div className="ctx-section-head"><p className="ctx-section-title">Your Skills ({skills.length})</p>
            {skills.length > 8 && <button type="button" className="ctx-link" onClick={() => setShowAllSkills(v => !v)}>{showAllSkills ? 'Show Less' : 'View All'}</button>}
          </div>
          <div className="ctx-pills">
            {(showAllSkills ? skills : skills.slice(0, 8)).map(skill => <span className="ctx-pill skill" key={skill}>{skill}</span>)}
            {!skills.length && <span className="ctx-empty">No skills yet</span>}
          </div>
        </div>

        <div className="ctx-section">
          <div className="ctx-section-head"><p className="ctx-section-title">Goals</p></div>
          <div className="ctx-pills">
            {goals.slice(0, 4).map(goal => <span className="ctx-pill goal" key={goal}>🎯 {goal}</span>)}
            {!goals.length && <span className="ctx-empty">No goals set yet</span>}
          </div>
        </div>

        <div className="ctx-section">
          <div className="ctx-section-head">
            <p className="ctx-section-title">Suggested Prompts</p>
            <button type="button" className="ctx-link" onClick={() => setPromptSpin(s => s + 1)}>Refresh</button>
          </div>
          <div className="ctx-prompts">
            {prompts.map(prompt => (
              <button key={prompt.text} type="button" className="ctx-prompt" onClick={() => runPrompt(prompt)}>
                <span className="ctx-prompt-icon"><Icon name={prompt.icon} /></span>
                {prompt.text}
                <span className="ctx-prompt-arrow">›</span>
              </button>
            ))}
          </div>
        </div>

        <div className="ctx-section">
          <div className="ctx-section-head"><p className="ctx-section-title">Recent Chats</p></div>
          <div className="ctx-recents">
            {sessions.slice(0, 4).map(session => (
              <button key={session.id} type="button" className="ctx-recent" onClick={() => openSession(session)}>
                <span className="ctx-recent-icon"><Icon name="chat" /></span>
                <span className="ctx-recent-title">{session.title}</span>
                <span className="ctx-recent-time">{timeAgo(session.startedAt)}</span>
              </button>
            ))}
            {!sessions.length && <span className="ctx-empty">No conversations yet</span>}
          </div>
        </div>
      </aside>
    </section>
  )
}

function ChatMessage({ msg, initial }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`chat-msg ${isUser ? 'user' : 'assistant'}`}>
      {!isUser && <span className="chat-avatar">G</span>}
      <div className="chat-msg-body">
        <div className={`chat-bubble ${isUser ? 'user-bubble' : 'ai-bubble'}`}>
          {msg.kind === 'rich' ? renderBlocks(msg.blocks) : <Markdown text={msg.content} />}
          {msg.degraded && <p className="chat-degraded">AI quota reached — this is a stock reply, not a generated one.</p>}
          {msg.webSearchNote && <p className="chat-degraded">Web search isn't connected — answered from your career memory.</p>}
        </div>
        {msg.time && <span className="chat-time">{msg.time}</span>}
      </div>
      {isUser && <span className="chat-avatar user-avatar">{initial}</span>}
    </div>
  )
}
