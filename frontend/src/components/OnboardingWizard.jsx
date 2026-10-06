import { useRef, useState } from 'react'
import axios, { aiRequest } from '../lib/api.js'
import logo from '../assets/logo.png'

// ── Data ─────────────────────────────────────────────────────────────────────

const SKILL_CATEGORIES = [
  { id: 'frontend', label: 'Frontend',          skills: ['React', 'Vue.js', 'Next.js', 'Angular', 'TypeScript', 'JavaScript', 'HTML/CSS', 'Tailwind CSS', 'Redux'] },
  { id: 'backend',  label: 'Backend',           skills: ['Node.js', 'Python', 'Java', 'Go', 'Rust', 'Django', 'FastAPI', 'Express.js', 'Spring Boot', 'PHP'] },
  { id: 'database', label: 'Database',          skills: ['PostgreSQL', 'MongoDB', 'MySQL', 'Redis', 'Firebase', 'SQLite', 'Supabase'] },
  { id: 'devops',   label: 'Cloud & DevOps',    skills: ['AWS', 'Docker', 'Kubernetes', 'Git', 'Linux', 'CI/CD', 'GCP', 'Azure'] },
  { id: 'cs',       label: 'CS Fundamentals',   skills: ['DSA', 'System Design', 'REST APIs', 'GraphQL', 'Microservices', 'OS basics'] },
  { id: 'other',    label: 'Other / Emerging',  skills: ['Machine Learning', 'TensorFlow', 'Solidity', 'Flutter', 'React Native', 'Web3'] },
]

const COMPANIES = [
  'Razorpay', 'Groww', 'CRED', 'Zepto', 'Meesho', 'PhonePe',
  'Swiggy', 'Zomato', 'Ola', 'BrowserStack', 'Postman',
  'Freshworks', 'Unacademy', 'Flipkart', 'Amazon', 'Google',
]

const EXPERIENCE_OPTIONS = [
  { id: 'student',   emoji: '🎓', title: 'Student',    desc: 'Currently in college, learning to code' },
  { id: 'fresher',   emoji: '🌱', title: 'Fresher',    desc: 'Just graduated, looking for first job' },
  { id: 'working',   emoji: '💼', title: 'Working',    desc: '1–3 years experience, want to grow' },
  { id: 'switching', emoji: '🚀', title: 'Switching',  desc: 'Coming from another domain' },
]

const GOAL_OPTIONS = [
  { id: 'internship', emoji: '🎓', title: 'Internship',    desc: 'First industry experience' },
  { id: 'job',        emoji: '💼', title: 'Full-time Job', desc: 'Permanent role at a company' },
  { id: 'hackathon',  emoji: '🏆', title: 'Hackathons',    desc: 'Win prizes, build portfolio, network' },
  { id: 'freelance',  emoji: '🔄', title: 'Freelance',     desc: 'Project-based work, independence' },
]

const TIMELINE_OPTIONS = ['Right now', '1–3 months', '3–6 months', 'Just exploring']

function cycleSkill(cur) {
  if (!cur)              return 'know_well'
  if (cur === 'know_well') return 'learning'
  return ''
}

// ── Shared small components ───────────────────────────────────────────────────

function SectionTitle({ children }) {
  return (
    <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', margin: '0 0 8px' }}>
      {children}
    </p>
  )
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--border)', margin: '20px 0' }} />
}

// ── STEP 1 — Who are you? ─────────────────────────────────────────────────────

function Step1({ name, setName, experience, setExperience }) {
  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px', letterSpacing: '-0.4px' }}>
        Let's start with you
      </h2>
      <p style={{ fontSize: 14, color: 'var(--text-sub)', margin: '0 0 24px', lineHeight: 1.5 }}>
        This helps Grafted personalize everything for your situation.
      </p>

      {/* Name */}
      <div style={{ marginBottom: 22 }}>
        <SectionTitle>What should we call you? <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>(optional)</span></SectionTitle>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Arjun, Priya, your name..."
          autoFocus
          style={{
            width: '100%', padding: '10px 14px',
            border: '1px solid var(--border)', borderRadius: 10,
            background: 'var(--bg-surface0)', color: 'var(--text)',
            fontSize: 14, outline: 'none', fontFamily: 'inherit',
            transition: 'border-color 0.15s',
          }}
          onFocus={e => { e.target.style.borderColor = 'var(--border-active)'; e.target.style.boxShadow = 'var(--shadow-input)' }}
          onBlur={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.boxShadow = 'none' }}
        />
      </div>

      {/* Experience */}
      <div>
        <SectionTitle>Where are you right now? <span style={{ color: 'var(--danger)', textTransform: 'none', letterSpacing: 0 }}>*</span></SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {EXPERIENCE_OPTIONS.map(opt => {
            const active = experience === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setExperience(opt.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  width: '100%', padding: '13px 16px', textAlign: 'left',
                  border: `2px solid ${active ? 'var(--border-active)' : 'var(--border)'}`,
                  borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
                  background: active ? 'var(--accent-bg)' : 'var(--bg-surface0)',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ fontSize: 24, lineHeight: 1 }}>{opt.emoji}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: active ? 'var(--accent)' : 'var(--text)', marginBottom: 2 }}>
                    {opt.title}
                  </div>
                  <div style={{ fontSize: 12, color: active ? 'var(--accent)' : 'var(--text-muted)' }}>
                    {opt.desc}
                  </div>
                </div>
                {active && (
                  <span style={{ marginLeft: 'auto', color: 'var(--accent)', fontSize: 18 }}>✓</span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── STEP 2 — Your skills ──────────────────────────────────────────────────────

function SkillBtn({ skill, state, onClick }) {
  const cls =
    state === 'know_well' ? 'skill-btn skill-btn--know-well' :
    state === 'learning'  ? 'skill-btn skill-btn--learning'  :
    'skill-btn skill-btn--neutral'
  return (
    <button type="button" className={cls} onClick={onClick}>
      {state === 'know_well' && <span className="skill-btn-icon">✓</span>}
      {state === 'learning'  && <span className="skill-btn-icon">⏳</span>}
      {skill}
    </button>
  )
}

function Step2({ skillStates, toggleSkill, customSkill, setCustomSkill, addCustomSkill }) {
  const [openCats, setOpenCats] = useState(() => new Set(SKILL_CATEGORIES.map(c => c.id)))
  const customRef = useRef(null)
  const knowWell = Object.entries(skillStates).filter(([, v]) => v === 'know_well').map(([k]) => k)
  const learning = Object.entries(skillStates).filter(([, v]) => v === 'learning').map(([k]) => k)

  function toggleCat(id) {
    setOpenCats(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px', letterSpacing: '-0.4px' }}>
        What do you know right now?
      </h2>
      <p style={{ fontSize: 14, color: 'var(--text-sub)', margin: '0 0 4px', lineHeight: 1.5 }}>
        Be honest — this is just for you.
      </p>
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
        <span>Click once <span style={{ color: 'var(--info)' }}>✓ know well</span></span>
        <span>Click twice <span style={{ color: 'var(--warning)' }}>⏳ learning</span></span>
        <span>Click again to remove</span>
      </div>

      {SKILL_CATEGORIES.map(cat => (
        <div key={cat.id} style={{ marginBottom: 10 }}>
          <button
            type="button"
            onClick={() => toggleCat(cat.id)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              width: '100%', padding: '6px 0', background: 'none', border: 0,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>
              {cat.label}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-faint)', transition: 'transform 0.15s', transform: openCats.has(cat.id) ? 'rotate(180deg)' : 'none' }}>
              ▾
            </span>
          </button>
          {openCats.has(cat.id) && (
            <div className="skill-btn-row" style={{ marginTop: 6, marginBottom: 4 }}>
              {cat.skills.map(skill => (
                <SkillBtn
                  key={skill}
                  skill={skill}
                  state={skillStates[skill] ?? ''}
                  onClick={() => toggleSkill(skill)}
                />
              ))}
            </div>
          )}
          <div style={{ height: 1, background: 'var(--border)', marginTop: 8 }} />
        </div>
      ))}

      {/* Custom skill input */}
      <div style={{ display: 'flex', gap: 8, marginTop: 14, marginBottom: 4 }}>
        <input
          ref={customRef}
          style={{
            flex: 1, padding: '8px 12px',
            border: '1px solid var(--border)', borderRadius: 8,
            background: 'var(--bg-surface0)', color: 'var(--text)', fontSize: 13,
            outline: 'none', fontFamily: 'inherit',
          }}
          value={customSkill}
          onChange={e => setCustomSkill(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomSkill(); customRef.current?.focus() } }}
          onFocus={e => { e.target.style.borderColor = 'var(--border-active)' }}
          onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
          placeholder="+ Add custom skill (e.g. Rust, Figma, LangChain)…"
        />
        <button
          type="button"
          onClick={() => { addCustomSkill(); customRef.current?.focus() }}
          disabled={!customSkill.trim()}
          style={{
            padding: '8px 14px', borderRadius: 8,
            border: '1px solid var(--border)',
            background: customSkill.trim() ? 'var(--accent-bg)' : 'transparent',
            color: customSkill.trim() ? 'var(--accent)' : 'var(--text-muted)',
            fontSize: 13, cursor: customSkill.trim() ? 'pointer' : 'not-allowed',
            transition: 'background 0.1s, color 0.1s',
          }}
        >
          Add
        </button>
      </div>

      {/* Live summary */}
      {(knowWell.length > 0 || learning.length > 0) && (
        <div style={{ marginTop: 8, padding: '10px 14px', background: 'var(--bg-surface0)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12 }}>
          {knowWell.length > 0 && (
            <div style={{ color: 'var(--info)', marginBottom: learning.length > 0 ? 4 : 0 }}>
              <strong>You know:</strong> {knowWell.join(', ')}
            </div>
          )}
          {learning.length > 0 && (
            <div style={{ color: 'var(--warning)' }}>
              <strong>Learning:</strong> {learning.join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── STEP 3 — Goals ────────────────────────────────────────────────────────────

function Step3({ goals, toggleGoal, targetRole, setTargetRole, targetCompanies, toggleCompany, customCompany, setCustomCompany, addCustomCompany }) {
  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px', letterSpacing: '-0.4px' }}>
        What's your goal right now?
      </h2>
      <p style={{ fontSize: 14, color: 'var(--text-sub)', margin: '0 0 20px', lineHeight: 1.5 }}>
        Pick everything that applies.
      </p>

      {/* Goals 2×2 grid */}
      <SectionTitle>Looking for <span style={{ color: 'var(--danger)', textTransform: 'none', letterSpacing: 0 }}>*</span></SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 22 }}>
        {GOAL_OPTIONS.map(opt => {
          const active = goals.includes(opt.id)
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => toggleGoal(opt.id)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                padding: '12px 14px', textAlign: 'left', fontFamily: 'inherit',
                border: `2px solid ${active ? 'var(--border-active)' : 'var(--border)'}`,
                borderRadius: 10, cursor: 'pointer',
                background: active ? 'var(--accent-bg)' : 'var(--bg-surface0)',
                transition: 'all 0.15s',
              }}
            >
              <span style={{ fontSize: 20, marginBottom: 6 }}>{opt.emoji}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: active ? 'var(--accent)' : 'var(--text)', marginBottom: 3 }}>
                {opt.title}
              </span>
              <span style={{ fontSize: 11, color: active ? 'var(--accent)' : 'var(--text-muted)', lineHeight: 1.4 }}>
                {opt.desc}
              </span>
            </button>
          )
        })}
      </div>

      <Divider />

      {/* Target role */}
      <div style={{ marginBottom: 20 }}>
        <SectionTitle>Any specific role in mind? <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></SectionTitle>
        <input
          type="text"
          value={targetRole}
          onChange={e => setTargetRole(e.target.value)}
          placeholder="e.g. Frontend Developer, Full Stack, ML Engineer"
          style={{
            width: '100%', padding: '10px 14px',
            border: '1px solid var(--border)', borderRadius: 10,
            background: 'var(--bg-surface0)', color: 'var(--text)',
            fontSize: 13, outline: 'none', fontFamily: 'inherit',
          }}
          onFocus={e => { e.target.style.borderColor = 'var(--border-active)' }}
          onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
        />
        <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '5px 0 0' }}>
          Leave blank if unsure — Grafted will suggest based on your skills.
        </p>
      </div>

      {/* Companies */}
      <div>
        <SectionTitle>Dream companies? <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(pick up to 3 — optional)</span></SectionTitle>
        <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '0 0 10px' }}>
          We'll prioritize these in your gap analysis.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {COMPANIES.map(c => {
            const active = targetCompanies.includes(c)
            const maxed  = targetCompanies.length >= 3 && !active
            return (
              <button
                key={c}
                type="button"
                disabled={maxed}
                onClick={() => toggleCompany(c)}
                style={{
                  padding: '5px 12px', borderRadius: 20, fontSize: 12, fontFamily: 'inherit',
                  cursor: maxed ? 'not-allowed' : 'pointer', opacity: maxed ? 0.4 : 1,
                  border: `1px solid ${active ? 'var(--accent-border)' : 'var(--border)'}`,
                  background: active ? 'var(--accent-bg)' : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--text-sub)',
                  transition: 'all 0.1s',
                }}
              >
                {active && <span style={{ marginRight: 4 }}>×</span>}
                {c}
              </button>
            )
          })}
        </div>
        {/* Custom company */}
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={customCompany}
            onChange={e => setCustomCompany(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomCompany() } }}
            placeholder="Other company..."
            disabled={targetCompanies.length >= 3}
            style={{
              flex: 1, padding: '7px 12px',
              border: '1px solid var(--border)', borderRadius: 8,
              background: 'var(--bg-surface0)', color: 'var(--text)',
              fontSize: 12, outline: 'none', fontFamily: 'inherit',
              opacity: targetCompanies.length >= 3 ? 0.4 : 1,
            }}
          />
          <button
            type="button"
            onClick={addCustomCompany}
            disabled={targetCompanies.length >= 3 || !customCompany.trim()}
            style={{
              padding: '7px 14px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--text-sub)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
              opacity: (targetCompanies.length >= 3 || !customCompany.trim()) ? 0.4 : 1,
            }}
          >Add</button>
        </div>
      </div>
    </div>
  )
}

// ── STEP 4 — Timeline + Summary ───────────────────────────────────────────────

function Step4({ name, experience, knowWell, learning, goals, targetRole, targetCompanies, timeline, setTimeline, loading, submitSteps }) {
  const expLabel = EXPERIENCE_OPTIONS.find(e => e.id === experience)?.title ?? experience

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px', letterSpacing: '-0.4px' }}>
        Almost done!
      </h2>
      <p style={{ fontSize: 14, color: 'var(--text-sub)', margin: '0 0 22px', lineHeight: 1.5 }}>
        One last thing, then your career graph is ready.
      </p>

      {/* Timeline */}
      <SectionTitle>When are you looking to land something? <span style={{ color: 'var(--danger)', textTransform: 'none', letterSpacing: 0 }}>*</span></SectionTitle>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
        {TIMELINE_OPTIONS.map(t => {
          const active = timeline === t
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTimeline(t)}
              style={{
                padding: '8px 16px', borderRadius: 8, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
                border: `2px solid ${active ? 'var(--border-active)' : 'var(--border)'}`,
                background: active ? 'var(--accent-bg)' : 'var(--bg-surface0)',
                color: active ? 'var(--accent)' : 'var(--text-sub)',
                fontWeight: active ? 600 : 400,
                transition: 'all 0.15s',
              }}
            >
              {t}
            </button>
          )
        })}
      </div>

      <Divider />

      {/* Summary preview */}
      <SectionTitle>Your Grafted Profile</SectionTitle>
      <div style={{
        padding: 16, background: 'var(--bg-surface0)', border: '1px solid var(--border)',
        borderRadius: 12, fontSize: 13, lineHeight: 1.6, marginBottom: 16,
      }}>
        {[
          ['Name',         name || 'Not set'],
          ['Experience',   expLabel],
          ['Know well',    knowWell.length > 4 ? `${knowWell.slice(0, 4).join(', ')} +${knowWell.length - 4} more` : (knowWell.join(', ') || '—')],
          ['Learning',     learning.length > 2 ? `${learning.slice(0, 2).join(', ')} +${learning.length - 2} more` : (learning.join(', ') || '—')],
          ['Looking for',  goals.map(g => GOAL_OPTIONS.find(o => o.id === g)?.title ?? g).join(', ') || '—'],
          ['Timeline',     timeline || '—'],
          ['Companies',    targetCompanies.join(', ') || '—'],
          ['Target role',  targetRole || '—'],
        ].map(([label, val]) => (
          <div key={label} style={{ display: 'flex', gap: 12, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
            <span style={{ width: 110, flexShrink: 0, color: 'var(--text-muted)', fontSize: 12 }}>{label}</span>
            <span style={{ color: 'var(--text)', fontWeight: 500 }}>{val}</span>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.6, marginBottom: 16 }}>
        This is saved privately in your own database. Only you can see it. You can update it anytime.
      </p>

      {/* Submit progress steps */}
      {loading && submitSteps.length > 0 && (
        <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {submitSteps.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: s.done ? 'var(--success)' : 'var(--accent)' }}>
              <span style={{ width: 16, textAlign: 'center' }}>{s.done ? '✓' : '⏳'}</span>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Wizard ───────────────────────────────────────────────────────────────

const TOTAL_STEPS = 4

const STEP_LABELS = ['Who are you?', 'Your skills', 'Your goals', 'Confirm']

export default function OnboardingWizard({ onComplete, waking = false, onGoHome }) {
  const [step, setStep]               = useState(1)
  const [name, setName]               = useState('')
  const [experience, setExperience]   = useState(null)
  const [skillStates, setSkillStates] = useState({})
  const [goals, setGoals]             = useState([])
  const [targetRole, setTargetRole]   = useState('')
  const [targetCompanies, setTargetCompanies] = useState([])
  const [customCompany, setCustomCompany]     = useState('')
  const [customSkill, setCustomSkill]         = useState('')
  const [timeline, setTimeline]       = useState(null)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState('')
  const [submitSteps, setSubmitSteps] = useState([])

  const knowWell = Object.entries(skillStates).filter(([, v]) => v === 'know_well').map(([k]) => k)
  const learning = Object.entries(skillStates).filter(([, v]) => v === 'learning').map(([k]) => k)

  function toggleSkill(skill) {
    setSkillStates(prev => {
      const next = cycleSkill(prev[skill])
      if (!next) { const { [skill]: _, ...rest } = prev; return rest }
      return { ...prev, [skill]: next }
    })
  }

  function addCustomSkill() {
    const s = customSkill.trim()
    if (!s) return
    setSkillStates(prev => ({ ...prev, [s]: prev[s] ? prev[s] : 'know_well' }))
    setCustomSkill('')
  }

  function toggleGoal(id) {
    setGoals(prev => prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id])
  }

  function toggleCompany(c) {
    setTargetCompanies(prev =>
      prev.includes(c) ? prev.filter(x => x !== c) : prev.length < 3 ? [...prev, c] : prev
    )
  }

  function addCustomCompany() {
    const c = customCompany.trim()
    if (!c || targetCompanies.length >= 3) return
    if (!targetCompanies.includes(c)) setTargetCompanies(prev => [...prev, c])
    setCustomCompany('')
  }

  const canProceed = {
    1: !!experience,
    2: knowWell.length > 0,
    3: goals.length > 0,
    4: !!timeline,
  }[step] ?? false

  async function handleFinish() {
    if (!canProceed) return
    setLoading(true)
    setError('')

    const steps = [
      { label: 'Creating your profile…',     done: false },
      { label: 'Saving to your career memory…',         done: false },
      { label: 'Building your career wiki…', done: false },
      { label: 'Preparing your graph…',      done: false },
    ]
    setSubmitSteps(steps)

    async function tickStep(i, delay = 600) {
      await new Promise(r => setTimeout(r, delay))
      setSubmitSteps(prev => prev.map((s, idx) => idx === i ? { ...s, done: true } : s))
    }

    try {
      const profilePayload = {
        name:             name.trim() || 'Developer',
        experience,
        stack:            knowWell,
        learning_stack:   learning,
        goals,
        target_role:      targetRole,
        target_companies: targetCompanies,
        timeline,
      }
      // 90s budget: profile creation runs embedding batches, slow on cold backends.
      const { data } = await axios.post('/api/user/init', profilePayload, aiRequest())

      if (data.message === 'Career memory restored') {
        // The session already owned a user (fresh signup, or a re-onboarding):
        // init did not touch the profile, so apply the wizard answers now.
        await axios.put(`/api/user/${data.userId}/profile`, profilePayload, aiRequest())
      }

      await tickStep(0, 300)
      await tickStep(1, 400)
      await tickStep(2, 400)
      await tickStep(3, 300)

      onComplete({
        userId:         data.userId,
        name:           (data.name ?? name.trim()) || 'Developer',
        stack:          knowWell,
        learning_stack: learning,
        experience,
        goals,
      })
    } catch (err) {
      setError(err.appMessage ?? 'Could not connect - is the backend running?')
      setLoading(false)
      setSubmitSteps([])
    }
  }

  // ── Layout ────────────────────────────────────────────────────────────────

  const progressPct = ((step - 1) / TOTAL_STEPS) * 100

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg-base)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px',
    }}>
      {waking && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 20px',
          background: 'var(--warning-bg)',
          borderBottom: '1px solid var(--warning-border)',
        }}>
          <span style={{ fontSize: 13 }}>⏳</span>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>
            backend warming up — <span style={{ color: 'var(--text)', fontWeight: 700 }}>give it ~30s on first load</span> (Render free tier)
          </p>
        </div>
      )}
      <div style={{
        width: '100%', maxWidth: 540,
        background: 'var(--bg-mantle)', border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: 18, boxShadow: 'var(--shadow-panel)',
        overflow: 'hidden',
        marginTop: waking ? 40 : 0,
      }}>
        {/* Header */}
        <div style={{ padding: '20px 28px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <button
              type="button"
              onClick={onGoHome}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <img src={logo} alt="Grafted" style={{ width: 26, height: 26, borderRadius: 8, objectFit: 'cover' }} />
              <span className="brand-word">grafted</span>
            </button>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>Step {step} of {TOTAL_STEPS}</span>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 1 }}>{STEP_LABELS[step - 1]}</div>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, marginBottom: 0, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${progressPct}%`,
              background: 'var(--accent)', borderRadius: 2,
              transition: 'width 300ms ease',
            }} />
          </div>
        </div>

        {/* Step dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, padding: '12px 0 0' }}>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <div key={i} style={{
              width: i + 1 === step ? 20 : 6,
              height: 6, borderRadius: 3,
              background: i + 1 <= step ? 'var(--accent)' : 'var(--border)',
              transition: 'all 0.25s',
            }} />
          ))}
        </div>

        {/* Content */}
        <div style={{ padding: '20px 28px 0' }}>
          {step === 1 && (
            <Step1
              name={name} setName={setName}
              experience={experience} setExperience={setExperience}
            />
          )}
          {step === 2 && (
            <Step2
              skillStates={skillStates} toggleSkill={toggleSkill}
              customSkill={customSkill} setCustomSkill={setCustomSkill}
              addCustomSkill={addCustomSkill}
            />
          )}
          {step === 3 && (
            <Step3
              goals={goals} toggleGoal={toggleGoal}
              targetRole={targetRole} setTargetRole={setTargetRole}
              targetCompanies={targetCompanies} toggleCompany={toggleCompany}
              customCompany={customCompany} setCustomCompany={setCustomCompany}
              addCustomCompany={addCustomCompany}
            />
          )}
          {step === 4 && (
            <Step4
              name={name} experience={experience}
              knowWell={knowWell} learning={learning}
              goals={goals} targetRole={targetRole}
              targetCompanies={targetCompanies}
              timeline={timeline} setTimeline={setTimeline}
              loading={loading} submitSteps={submitSteps}
            />
          )}
        </div>

        {/* Error */}
        {error && (
          <div style={{ margin: '12px 28px 0', padding: '10px 14px', background: 'var(--danger-bg)', border: '1px solid var(--danger-border)', borderRadius: 8, color: 'var(--danger)', fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Footer nav */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 28px 28px', gap: 12,
        }}>
          {step > 1 ? (
            <button
              type="button"
              disabled={loading}
              onClick={() => setStep(s => s - 1)}
              style={{
                padding: '10px 20px', borderRadius: 10,
                border: '1px solid var(--border)', background: 'transparent',
                color: 'var(--text-sub)', fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', opacity: loading ? 0.5 : 1, transition: 'all 0.15s',
              }}
            >
              ← Back
            </button>
          ) : (
            <div />
          )}

          {step < TOTAL_STEPS ? (
            <button
              type="button"
              disabled={!canProceed}
              onClick={() => setStep(s => s + 1)}
              style={{
                padding: '10px 24px', borderRadius: 10, border: 0,
                background: canProceed ? 'var(--accent)' : 'var(--bg-surface1)',
                color: canProceed ? 'var(--bg-base)' : 'var(--text-muted)',
                fontSize: 14, fontWeight: 600, cursor: canProceed ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit', transition: 'all 0.15s',
              }}
            >
              Next →
            </button>
          ) : (
            <button
              type="button"
              disabled={!canProceed || loading}
              onClick={handleFinish}
              style={{
                flex: 1, padding: '12px 24px', borderRadius: 10, border: 0,
                background: (canProceed && !loading) ? 'var(--accent)' : 'var(--bg-surface1)',
                color: (canProceed && !loading) ? 'var(--bg-base)' : 'var(--text-muted)',
                fontSize: 15, fontWeight: 700, cursor: (canProceed && !loading) ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit', letterSpacing: '-0.2px', transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              {loading ? (
                <>
                  <span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                  Setting up your career wiki…
                </>
              ) : (
                'Build my career graph →'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
