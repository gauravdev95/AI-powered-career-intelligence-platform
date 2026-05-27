import { useCallback, useEffect, useRef, useState } from 'react'
import axios from '../lib/api.js'

const API_BASE = import.meta.env.VITE_API_URL || ''

const FALLBACK_SKILLS = [
  'React', 'Node.js', 'Python', 'TypeScript', 'Go', 'Java',
  'PostgreSQL', 'MongoDB', 'Redis', 'Docker', 'AWS', 'Kubernetes',
  'React Native', 'Machine Learning', 'GraphQL', 'Next.js',
]

const EXPERIENCES = [
  { id: 'beginner', label: 'Beginner' },
  { id: 'intermediate', label: 'Intermediate' },
  { id: 'advanced', label: 'Advanced' },
]

const GOALS = [
  { id: 'internship', label: 'Internship' },
  { id: 'job', label: 'Job' },
  { id: 'hackathon', label: 'Hackathon' },
  { id: 'freelance', label: 'Freelance' },
]

export default function StackInput({ onSubmit, error }) {
  const [input, setInput] = useState('')
  const [skills, setSkills] = useState([])
  const [allSkills, setAllSkills] = useState(FALLBACK_SKILLS)
  const [suggestions, setSuggestions] = useState([])
  const [experience, setExperience] = useState('beginner')
  const [goals, setGoals] = useState(['job'])
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    axios.get(`${API_BASE}/api/skills`)
      .then(({ data }) => {
        const names = (data.skills ?? data).map(skill => typeof skill === 'string' ? skill : skill.name)
        if (names.length) setAllSkills(names)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const q = input.trim().toLowerCase()
    if (!q) {
      setSuggestions([])
      return
    }
    setSuggestions(
      allSkills
        .filter(skill => skill.toLowerCase().includes(q) && !skills.includes(skill))
        .slice(0, 6)
    )
  }, [input, allSkills, skills])

  const addSkill = useCallback(skill => {
    const clean = skill.trim()
    if (!clean || skills.includes(clean) || skills.length >= 15) return
    setSkills(prev => [...prev, clean])
    setInput('')
    setSuggestions([])
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [skills])

  const removeSkill = useCallback(skill => {
    setSkills(prev => prev.filter(item => item !== skill))
  }, [])

  const toggleGoal = useCallback(goal => {
    setGoals(prev => prev.includes(goal) ? prev.filter(item => item !== goal) : [...prev, goal])
  }, [])

  function onKeyDown(event) {
    if ((event.key === 'Enter' || event.key === ',') && input.trim()) {
      event.preventDefault()
      addSkill(input)
    }
    if (event.key === 'Backspace' && !input && skills.length) {
      setSkills(prev => prev.slice(0, -1))
    }
  }

  async function submit(event) {
    event.preventDefault()
    const finalSkills = input.trim() ? [...skills, input.trim()] : skills
    if (!finalSkills.length) return
    setSubmitting(true)
    try {
      await onSubmit(finalSkills, experience, goals)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="stack-screen">
      <form className="stack-card" onSubmit={submit}>
        <div className="stack-logo-row">
          <div className="stack-logo">DevRadar</div>
          <span className="event-badge" style={{ marginTop: 0 }}>WikiThon 2026</span>
        </div>
        <div className="sidebar-divider" style={{ margin: '18px 0 0' }} />

        <h1 className="stack-title">Build your career graph</h1>
        <p className="stack-subtitle">Enter your stack to visualize your career connections</p>

        <label className="field-label" htmlFor="stack-input">Your tech stack</label>
        <div className="tag-input" onClick={() => inputRef.current?.focus()}>
          {skills.map(skill => (
            <span className="skill-tag" key={skill}>
              {skill}
              <button
                className="tag-remove"
                type="button"
                onClick={event => {
                  event.stopPropagation()
                  removeSkill(skill)
                }}
                aria-label={`Remove ${skill}`}
              >
                x
              </button>
            </span>
          ))}
          <input
            id="stack-input"
            ref={inputRef}
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={skills.length ? 'Add another skill...' : 'Type a skill and press Enter...'}
          />
          {suggestions.length > 0 && (
            <div className="autocomplete">
              {suggestions.map(skill => (
                <button type="button" key={skill} onMouseDown={() => addSkill(skill)}>
                  {skill}
                </button>
              ))}
            </div>
          )}
        </div>

        {!input && (
          <div className="filter-chips" style={{ padding: '10px 0 0' }}>
            {allSkills.filter(skill => !skills.includes(skill)).slice(0, 8).map(skill => (
              <button className="chip" type="button" key={skill} onClick={() => addSkill(skill)}>
                {skill}
              </button>
            ))}
          </div>
        )}

        <div style={{ marginTop: 20 }}>
          <label className="field-label">Experience level</label>
          <div className="choice-row">
            {EXPERIENCES.map(item => (
              <button
                className={`choice-button ${experience === item.id ? 'active' : ''}`}
                key={item.id}
                type="button"
                onClick={() => setExperience(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <label className="field-label">I am looking for</label>
          <div className="choice-row">
            {GOALS.map(item => (
              <button
                className={`choice-button ${goals.includes(item.id) ? 'active' : ''}`}
                key={item.id}
                type="button"
                onClick={() => toggleGoal(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="caption" style={{ color: 'var(--danger)', marginTop: 14 }}>
            {error}
          </p>
        )}

        <button className="submit-button" disabled={!skills.length && !input.trim()} type="submit">
          {submitting ? 'Generating your graph...' : 'Generate career graph'}
        </button>

        <p className="caption" style={{ textAlign: 'center', marginTop: 14, color: 'var(--muted)' }}>
          Powered by HydraDB Memory + Claude AI
        </p>
      </form>
    </main>
  )
}

