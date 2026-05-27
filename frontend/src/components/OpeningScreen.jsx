import { useRef, useState } from 'react'
import axios from '../lib/api.js'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

// ── Skill categories ──────────────────────────────────────────────────────────
const SKILL_CATEGORIES = [
  { label: 'Frontend',       skills: ['React', 'Vue.js', 'Next.js', 'TypeScript', 'JavaScript', 'Tailwind CSS', 'HTML/CSS'] },
  { label: 'Backend',        skills: ['Node.js', 'Python', 'Java', 'Go', 'Django', 'FastAPI', 'Express.js'] },
  { label: 'Database',       skills: ['PostgreSQL', 'MongoDB', 'MySQL', 'Redis', 'Firebase'] },
  { label: 'DevOps & Cloud', skills: ['Docker', 'AWS', 'Linux', 'Git', 'Kubernetes', 'CI/CD'] },
  { label: 'Other',          skills: ['DSA', 'System Design', 'REST APIs', 'GraphQL', 'Machine Learning'] },
]

const TARGET_COMPANIES = ['Razorpay', 'Groww', 'CRED', 'Zepto', 'Meesho', 'PhonePe', 'Swiggy', 'Zomato', 'Dunzo', 'Flipkart']
const TIMELINES       = ['Immediately', '1-3 months', '3-6 months', 'Just exploring']
const LEARNING_STYLES = ['Video courses', 'Documentation', 'Projects', 'All of the above']
const EXPERIENCES     = ['Beginner', 'Intermediate', 'Advanced']
const GOALS           = ['Internship', 'Job', 'Hackathon', 'Freelance']

const FLOAT_CIRCLES = [
  { size: 320, color: 'var(--circle-1)', top: '10%',   left: '5%',    dur: '12s', delay: '0s'  },
  { size: 240, color: 'var(--circle-2)', top: '60%',   left: '80%',   dur: '15s', delay: '2s'  },
  { size: 180, color: 'var(--circle-3)', top: '30%',   right: '8%',   dur: '10s', delay: '4s'  },
  { size: 280, color: 'var(--circle-4)', bottom: '15%',left: '30%',   dur: '18s', delay: '1s'  },
]

// ── Skill state cycle: '' → 'know_well' → 'learning' → '' ────────────────────
function cycleSkill(current) {
  if (!current)               return 'know_well'
  if (current === 'know_well') return 'learning'
  return ''
}

// ── Individual skill button — uses CSS classes for theme-aware colors ─────────
function SkillButton({ skill, state, onClick }) {
  const stateClass =
    state === 'know_well' ? 'skill-btn--know-well' :
    state === 'learning'  ? 'skill-btn--learning'  :
    'skill-btn--neutral'

  return (
    <button
      type="button"
      className={`skill-btn ${stateClass}`}
      onClick={onClick}
      title={
        state === 'know_well' ? '✓ Know well' :
        state === 'learning'  ? '⏳ Learning'  :
        'Click to add'
      }
    >
      {state === 'know_well' && <span className="skill-btn-icon">✓</span>}
      {state === 'learning'  && <span className="skill-btn-icon">⏳</span>}
      {skill}
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function OpeningScreen({ onComplete }) {
  const [skillStates, setSkillStates]         = useState({})
  const [customInput, setCustomInput]         = useState('')
  const [experience, setExperience]           = useState('beginner')
  const [goals, setGoals]                     = useState([])
  const [targetRole, setTargetRole]           = useState('')
  const [targetCompanies, setTargetCompanies] = useState([])
  const [timeline, setTimeline]               = useState('')
  const [learningStyle, setLearningStyle]     = useState('')
  const [loading, setLoading]                 = useState(false)
  const [error, setError]                     = useState(null)
  const customRef = useRef(null)

  function toggleSkill(skill) {
    setSkillStates(prev => {
      const next = cycleSkill(prev[skill])
      if (!next) {
        const { [skill]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [skill]: next }
    })
  }

  function addCustomSkill() {
    const s = customInput.trim()
    if (!s) return
    setSkillStates(prev => ({ ...prev, [s]: 'know_well' }))
    setCustomInput('')
    customRef.current?.focus()
  }

  function toggleGoal(g) {
    const key = g.toLowerCase()
    setGoals(prev => prev.includes(key) ? prev.filter(x => x !== key) : [...prev, key])
  }

  function toggleCompany(c) {
    setTargetCompanies(prev =>
      prev.includes(c)
        ? prev.filter(x => x !== c)
        : prev.length < 3 ? [...prev, c] : prev
    )
  }

  const knowWell  = Object.entries(skillStates).filter(([, s]) => s === 'know_well').map(([k]) => k)
  const learning  = Object.entries(skillStates).filter(([, s]) => s === 'learning').map(([k]) => k)
  const canSubmit = knowWell.length > 0 && !loading

  async function handleSubmit() {
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await axios.post(`${API}/api/user/init`, {
        stack:            knowWell,
        learning_stack:   learning,
        experience,
        goals,
        target_role:      targetRole,
        target_companies: targetCompanies.map(c => c.toLowerCase()),
        timeline,
        learning_style:   learningStyle,
      })
      localStorage.setItem('devradar_user_id', data.userId)
      onComplete({
        userId:         data.userId,
        stack:          knowWell,
        learning_stack: learning,
        experience,
        goals,
      })
    } catch (err) {
      setError(err.appMessage ?? 'Could not connect - is the backend running?')
      setLoading(false)
    }
  }

  return (
    <div className="opening-screen">
      {/* Floating background blobs */}
      {FLOAT_CIRCLES.map((c, i) => (
        <div
          key={i}
          className="opening-blob"
          style={{
            width: c.size, height: c.size,
            background: c.color,
            top: c.top, left: c.left, right: c.right, bottom: c.bottom,
            animationDuration: c.dur, animationDelay: c.delay,
          }}
        />
      ))}

      {/* Card */}
      <div className="opening-card animate-fade-up" style={{ maxWidth: 560 }}>

        {/* Logo */}
        <div className="opening-logo-row">
          <div className="opening-dots">
            {['var(--node-company)', 'var(--node-skill)', 'var(--node-hackathon)'].map((c, i) => (
              <span key={i} className="opening-dot" style={{ background: c }} />
            ))}
          </div>
          <span className="opening-wordmark">DevRadar</span>
          <span className="opening-hackathon-badge">WikiThon 2026</span>
        </div>

        <p className="opening-tagline">Your personal career knowledge base</p>

        <div className="opening-divider" />

        <h2 className="opening-heading">Build your career graph</h2>
        <p className="opening-body">
          Select your skills below, tell us your goals, and DevRadar will build a personal
          knowledge graph powered by HydraDB memory.
        </p>

        {/* Feature pills */}
        <div className="opening-pills" style={{ marginTop: 14 }}>
          {[
            { label: '🗺  Career Graph', color: 'var(--node-skill)',     bg: 'var(--info-bg)',    border: 'var(--info-border)' },
            { label: '💬  Ask Anything', color: 'var(--success)',        bg: 'var(--success-bg)', border: 'var(--success-border)' },
            { label: '📍  Roadmap',      color: 'var(--node-hackathon)', bg: 'var(--accent-bg)',  border: 'var(--accent-border)' },
          ].map(p => (
            <span
              key={p.label}
              className="opening-feature-pill"
              style={{ color: p.color, background: p.bg, border: `1px solid ${p.border}` }}
            >
              {p.label}
            </span>
          ))}
        </div>

        <div className="opening-divider" />

        {/* ── SKILL PICKER ── */}
        <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label className="opening-label" style={{ margin: 0 }}>Your tech skills</label>
          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>
            <span style={{ color: 'var(--info)' }}>✓ Know well</span>
            <span style={{ color: 'var(--warning)' }}>⏳ Learning</span>
          </div>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 12 }}>
          Click once = know well · Click twice = currently learning · Click again = remove
        </p>

        {SKILL_CATEGORIES.map(cat => (
          <div key={cat.label} className="skill-category">
            <p className="skill-category-label">{cat.label}</p>
            <div className="skill-btn-row">
              {cat.skills.map(skill => (
                <SkillButton
                  key={skill}
                  skill={skill}
                  state={skillStates[skill] ?? ''}
                  onClick={() => toggleSkill(skill)}
                />
              ))}
            </div>
          </div>
        ))}

        {/* Custom skill input */}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input
            ref={customRef}
            className="opening-skill-input"
            style={{
              flex: 1, padding: '7px 12px',
              border: '1px solid var(--border)', borderRadius: 8,
              background: 'var(--bg-surface0)', color: 'var(--text)', fontSize: 12,
              outline: 'none', transition: 'border-color 0.15s',
            }}
            value={customInput}
            onChange={e => setCustomInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomSkill() } }}
            onFocus={e => { e.target.style.borderColor = 'var(--border-active)' }}
            onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
            placeholder="+ Add custom skill…"
          />
          <button
            type="button"
            onClick={addCustomSkill}
            style={{
              padding: '7px 14px', borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--text-sub)',
              fontSize: 12, cursor: 'pointer',
              transition: 'background 0.1s',
            }}
          >
            Add
          </button>
        </div>

        {/* Selected summary */}
        {(knowWell.length > 0 || learning.length > 0) && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
            {knowWell.length > 0 && <span style={{ color: 'var(--info)' }}>✓ {knowWell.join(', ')}</span>}
            {learning.length > 0 && (
              <span style={{ color: 'var(--warning)', marginLeft: knowWell.length > 0 ? 10 : 0 }}>
                ⏳ {learning.join(', ')}
              </span>
            )}
          </div>
        )}

        <div className="opening-divider" />

        {/* ── PROFILE FIELDS ── */}

        {/* Experience */}
        <div className="opening-row-group">
          <p className="opening-small-label">Experience level</p>
          <div className="opening-toggle-row">
            {EXPERIENCES.map(e => (
              <button key={e} type="button"
                className={`opening-toggle ${experience === e.toLowerCase() ? 'active' : ''}`}
                onClick={() => setExperience(e.toLowerCase())}>
                {e}
              </button>
            ))}
          </div>
        </div>

        {/* Goals */}
        <div className="opening-row-group">
          <p className="opening-small-label">Looking for</p>
          <div className="opening-toggle-row">
            {GOALS.map(g => (
              <button key={g} type="button"
                className={`opening-toggle ${goals.includes(g.toLowerCase()) ? 'active' : ''}`}
                onClick={() => toggleGoal(g)}>
                {g}
              </button>
            ))}
          </div>
        </div>

        {/* Target role */}
        <div className="opening-row-group">
          <p className="opening-small-label">Target role <span style={{ color: 'var(--text-faint)', textTransform: 'none', letterSpacing: 0 }}>(optional)</span></p>
          <input
            style={{
              width: '100%', padding: '8px 12px',
              border: '1px solid var(--border)', borderRadius: 8,
              background: 'var(--bg-surface0)', color: 'var(--text)', fontSize: 13,
              outline: 'none', transition: 'border-color 0.15s',
              fontFamily: 'inherit',
            }}
            value={targetRole}
            onChange={e => setTargetRole(e.target.value)}
            onFocus={e => { e.target.style.borderColor = 'var(--border-active)' }}
            onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
            placeholder="e.g. Frontend Developer, Full Stack, ML Engineer"
          />
        </div>

        {/* Target companies */}
        <div className="opening-row-group">
          <p className="opening-small-label">
            Target companies <span style={{ color: 'var(--text-faint)', textTransform: 'none', letterSpacing: 0 }}>(pick up to 3)</span>
          </p>
          <div className="opening-toggle-row">
            {TARGET_COMPANIES.map(c => (
              <button key={c} type="button"
                className={`opening-toggle ${targetCompanies.includes(c) ? 'active' : ''}`}
                onClick={() => toggleCompany(c)}>
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Timeline */}
        <div className="opening-row-group">
          <p className="opening-small-label">How soon are you looking?</p>
          <div className="opening-toggle-row">
            {TIMELINES.map(t => (
              <button key={t} type="button"
                className={`opening-toggle ${timeline === t ? 'active' : ''}`}
                onClick={() => setTimeline(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Learning style */}
        <div className="opening-row-group">
          <p className="opening-small-label">Learning style preference</p>
          <div className="opening-toggle-row">
            {LEARNING_STYLES.map(s => (
              <button key={s} type="button"
                className={`opening-toggle ${learningStyle === s ? 'active' : ''}`}
                onClick={() => setLearningStyle(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="opening-error">{error}</p>}

        {/* CTA */}
        <button
          type="button"
          className="opening-cta"
          disabled={!canSubmit}
          onClick={handleSubmit}
          style={{
            background: !canSubmit ? 'var(--bg-surface1)' : 'var(--accent)',
            color:      !canSubmit ? 'var(--text-muted)' : 'var(--bg-base)',
            cursor:     !canSubmit ? 'not-allowed' : 'pointer',
            opacity:     loading ? 0.7 : 1,
          }}
        >
          {loading
            ? 'Building your graph…'
            : knowWell.length === 0
              ? 'Select at least one skill to continue'
              : `Start → Build Career Graph (${knowWell.length + learning.length} skills)`}
        </button>

        <p className="opening-footer">Powered by HydraDB · {import.meta.env.VITE_AI_PROVIDER ?? 'Claude AI'} · WikiThon 2026</p>
      </div>
    </div>
  )
}

