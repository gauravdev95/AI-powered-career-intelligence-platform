import { useEffect, useMemo, useState } from 'react'
import axios from '../lib/api.js'
import { Icon } from './icons.jsx'

const API = import.meta.env.VITE_API_URL || ''

const TABS = ['Create / Edit', 'ATS Analysis', 'Job Tailor', 'Templates', 'Suggestions', 'Download']

const TEMPLATES = [
  { id: 'modern', label: 'Modern' },
  { id: 'professional', label: 'Professional' },
  { id: 'creative', label: 'Creative' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'tech', label: 'Tech' },
  { id: 'academic', label: 'Academic' },
]

// ── Rule-based resume intelligence (no AI API needed) ─────────────────────────

function computeAts(profile) {
  const checks = []
  const has = v => v != null && String(v).trim() !== ''
  checks.push({ label: 'Contact information present', pass: has(profile?.name) && has(profile?.email), tip: 'Add your name and email so recruiters can reach you.' })
  checks.push({ label: 'Target role is set', pass: has(profile?.target_role), tip: 'Set a target role in your profile for role-specific keyword matching.' })
  const skills = profile?.stack ?? []
  checks.push({ label: `Skills section (${skills.length} skills)`, pass: skills.length >= 5, tip: 'List at least 5 skills — recruiters scan this section first.' })
  checks.push({ label: 'Experience level recorded', pass: has(profile?.experience), tip: 'Add your experience level in profile settings.' })
  checks.push({ label: 'Career goals defined', pass: (profile?.goals ?? []).length > 0, tip: 'Define career goals so your resume tells a clear story.' })
  checks.push({ label: 'Skill gaps identified', pass: (profile?.skill_gaps ?? []).length > 0, tip: 'Ingest job postings so Grafted can spot your skill gaps.' })
  const passed = checks.filter(c => c.pass).length
  const score = Math.round((passed / checks.length) * 100)
  return { score, checks }
}

function buildSuggestions(profile, ats) {
  const out = []
  const gaps = profile?.skill_gaps ?? []
  const stack = new Set((profile?.stack ?? []).map(s => s.toLowerCase()))
  for (const g of gaps.slice(0, 3)) {
    const skill = g.skill ?? ''
    if (skill && !stack.has(skill.toLowerCase())) {
      out.push({
        icon: 'code',
        title: 'Add missing keywords',
        desc: `Consider adding: ${skill}${g.why ? ` — ${g.why}` : ''}`,
      })
    }
  }
  if ((profile?.stack ?? []).length < 8) {
    out.push({ icon: 'chart', title: 'Expand your skills section', desc: `You list ${(profile?.stack ?? []).length} skills. Aim for 8–12 to cover ATS keyword scans.` })
  }
  if (!profile?.target_role) {
    out.push({ icon: 'target', title: 'Set a target role', desc: 'A clear target role lets the ATS match you against the right keywords.' })
  }
  out.push({ icon: 'sparkles', title: 'Add measurable impact', desc: 'Wherever possible, quantify results — e.g. “Built a web app used by 1,000+ users”.' })
  if (profile?.target_role) {
    out.push({ icon: 'resume', title: 'Optimize for target role', desc: `Tailoring for: ${profile.target_role}` })
  }
  return out
}

function analyzeJd(jd, profile) {
  const words = jd.toLowerCase().match(/[a-z][a-z0-9+#.]{1,}/g) ?? []
  const freq = {}
  for (const w of words) freq[w] = (freq[w] ?? 0) + 1
  const stack = profile?.stack ?? []
  const gaps = profile?.skill_gaps ?? []
  const matched = []
  const missing = []
  const seen = new Set()
  for (const s of stack) {
    const key = s.toLowerCase()
    if (freq[key] && !seen.has(key)) { seen.add(key); matched.push({ skill: s, count: freq[key] }) }
  }
  for (const g of gaps) {
    const skill = g.skill ?? ''
    const key = skill.toLowerCase()
    if (skill && freq[key] && !seen.has(key)) { seen.add(key); missing.push({ skill, count: freq[key] }) }
  }
  const total = matched.length + missing.length
  const score = total === 0 ? 0 : Math.round((matched.length / total) * 100)
  return { matched, missing, score, total }
}

function resumeMarkdown(profile) {
  const lines = [
    `# ${profile?.name ?? 'Your Name'}`,
    `${profile?.target_role ?? 'Aspiring Developer'}${profile?.experience ? ` · ${profile.experience}` : ''}`,
    `${profile?.email ?? ''}`,
    '',
    '## Skills',
    (profile?.stack ?? []).join(', ') || 'Add skills in your profile.',
    '',
    '## Career Goals',
    ...((profile?.goals ?? []).length ? profile.goals.map(g => `- ${g}`) : ['Set career goals in your profile.']),
    '',
    '## Focus Areas',
    ...((profile?.skill_gaps ?? []).length
      ? profile.skill_gaps.slice(0, 5).map(g => `- ${g.skill}${g.why ? `: ${g.why}` : ''}`)
      : ['Ingest job postings to identify skill gaps.']),
  ]
  return lines.join('\n')
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function ScoreRing({ score }) {
  const r = 54
  const circ = 2 * Math.PI * r
  const off = circ - (score / 100) * circ
  const tone = score >= 75 ? '#34d399' : score >= 50 ? '#fbbf24' : '#f87171'
  return (
    <div className="rh-ring">
      <svg viewBox="0 0 130 130">
        <circle cx="65" cy="65" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="11" />
        <circle
          cx="65" cy="65" r={r} fill="none" stroke={tone} strokeWidth="11"
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={off}
          transform="rotate(-90 65 65)"
        />
      </svg>
      <div className="rh-ring-label"><strong>{score}</strong><span>/100</span></div>
    </div>
  )
}

function ResumeDoc({ profile, template }) {
  const skills = profile?.stack ?? []
  const goals = profile?.goals ?? []
  const gaps = (profile?.skill_gaps ?? []).slice(0, 4)
  return (
    <div className={`rh-doc t-${template}`}>
      <h1>{(profile?.name ?? 'Your Name').toUpperCase()}</h1>
      <p className="rh-doc-role">
        {[profile?.target_role, profile?.experience].filter(Boolean).join(' · ') || 'Aspiring Developer'}
      </p>
      <p className="rh-doc-contact">
        {[profile?.email, 'linkedin.com/in/your-profile', 'github.com/your-handle'].filter(Boolean).join('  ·  ')}
      </p>
      <h2>Skills</h2>
      <div className="rh-doc-skills">
        {skills.length === 0 && <span className="rh-doc-empty">Add skills in your profile to populate this section.</span>}
        {skills.map(s => <span key={s} className="rh-doc-skill">{s}</span>)}
      </div>
      <h2>Career Goals</h2>
      <ul>
        {goals.length === 0 && <li className="rh-doc-empty">Set career goals in your profile.</li>}
        {goals.map((g, i) => <li key={i}>{g}</li>)}
      </ul>
      <h2>Focus Areas</h2>
      <ul>
        {gaps.length === 0 && <li className="rh-doc-empty">Ingest job postings to identify skill gaps.</li>}
        {gaps.map((g, i) => <li key={i}><strong>{g.skill}</strong>{g.why ? ` — ${g.why}` : ''}</li>)}
      </ul>
      <p className="rh-doc-foot">Generated from your Grafted career profile · {new Date().toLocaleDateString()}</p>
    </div>
  )
}

function TemplateThumb({ t, active, onClick }) {
  return (
    <button type="button" className={`rh-tpl ${active ? 'is-active' : ''}`} onClick={onClick}>
      <span className={`rh-tpl-doc t-${t.id}`}>
        <span className="rh-tpl-line w60" />
        <span className="rh-tpl-line w90" />
        <span className="rh-tpl-line w75" />
        <span className="rh-tpl-line w85" />
      </span>
      <span className="rh-tpl-label">{t.label}</span>
      {active && <span className="rh-tpl-check"><Icon name="roadmap" /></span>}
    </button>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function ResumeHelperPage({ userId, onNavigate }) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('Create / Edit')
  const [template, setTemplate] = useState('modern')
  const [jd, setJd] = useState('')
  const [jdResult, setJdResult] = useState(null)
  const [coverLetter, setCoverLetter] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let alive = true
    async function load() {
      if (!userId) return
      setLoading(true)
      try {
        const { data } = await axios.get(`${API}/api/user/${userId}`)
        if (alive) setProfile(data)
      } catch { /* graceful */ } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [userId])

  const ats = useMemo(() => computeAts(profile), [profile])
  const suggestions = useMemo(() => buildSuggestions(profile, ats), [profile, ats])

  const flash = msg => { setNotice(msg); setTimeout(() => setNotice(''), 3000) }

  const runJdAnalysis = () => {
    if (!jd.trim()) { flash('Paste a job description first.'); return }
    setJdResult(analyzeJd(jd, profile))
  }

  const downloadMd = () => {
    const blob = new Blob([resumeMarkdown(profile)], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `resume-${(profile?.name ?? 'grafted').toLowerCase().replace(/\s+/g, '-')}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const generateCoverLetter = () => {
    const p = profile ?? {}
    const letter = [
      `Dear Hiring Manager,`,
      '',
      `I am ${(p.name ?? 'a final-year engineering student').trim()}${p.target_role ? `, aspiring to become a ${p.target_role}` : ''}${p.experience ? ` with ${p.experience} of experience` : ''}.`,
      '',
      `My technical skills include ${(p.stack ?? []).slice(0, 6).join(', ') || 'a growing set of modern technologies'}.`,
      ...(p.goals?.length ? ['', `My career goals include: ${p.goals.slice(0, 2).join('; ')}.`] : []),
      '',
      'I would welcome the opportunity to discuss how I can contribute to your team.',
      '',
      'Sincerely,',
      p.name ?? '',
      p.email ?? '',
    ].join('\n')
    setCoverLetter(letter)
  }

  const quickActions = [
    { icon: 'briefcase', label: 'Tailor for a Job Description', go: 'Job Tailor' },
    { icon: 'target', label: 'Optimize for ATS', go: 'ATS Analysis' },
    { icon: 'sparkles', label: 'Improve Bullet Points', go: 'Suggestions' },
    { icon: 'resume', label: 'Check Grammar & Clarity', go: 'Suggestions' },
    { icon: 'code', label: 'Suggest Keywords', go: 'Suggestions' },
    { icon: 'chat', label: 'Generate Cover Letter', action: generateCoverLetter },
  ]

  return (
    <div className="rh-page">
      <header className="rh-hero">
        <div className="rh-hero-text">
          <h1 className="rh-hero-title"><span className="rh-hero-icon"><Icon name="resume" /></span> Resume Helper</h1>
          <p className="rh-hero-sub">Create, optimize, and tailor your resume with AI to land your dream job.</p>
        </div>
        <div className="rh-hero-art" aria-hidden="true">
          <div className="rh-art-doc a1" />
          <div className="rh-art-doc a2" />
          <span className="rh-art-ai">AI</span>
        </div>
        <ul className="rh-hero-points">
          {['ATS Optimized', 'Job Specific', 'AI Suggestions', 'Professional Templates'].map(p => (
            <li key={p}><Icon name="roadmap" /> {p}</li>
          ))}
        </ul>
      </header>

      <div className="rh-tabs">
        {TABS.map(t => (
          <button key={t} type="button" className={`rh-tab ${tab === t ? 'is-active' : ''}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {notice && <div className="rh-notice">{notice}</div>}

      {loading ? (
        <div className="rh-loading">Loading your resume data…</div>
      ) : (
        <>
          {(tab === 'Create / Edit') && (
            <div className="rh-cols">
              <div className="rh-col-left">
                <section className="rh-card">
                  <h2>Build Your Resume</h2>
                  <p className="rh-card-sub">Start from scratch or generate using AI</p>
                  <button type="button" className="rh-build is-primary" onClick={() => flash('Your resume is generated from your live Grafted profile.')}>
                    <span className="rh-build-icon"><Icon name="resume" /></span>
                    <span><strong>Create New Resume</strong><span>Build with AI step by step</span></span>
                  </button>
                  <button type="button" className="rh-build" onClick={() => flash('LinkedIn import is coming soon — your Grafted profile is used for now.')}>
                    <span className="rh-build-icon is-linkedin"><Icon name="linkedin" /></span>
                    <span><strong>Import from LinkedIn</strong><span>Convert your profile to resume</span></span>
                  </button>
                  <button type="button" className="rh-build" onClick={() => flash('Resume upload parsing is coming soon.')}>
                    <span className="rh-build-icon is-upload"><Icon name="upload" /></span>
                    <span><strong>Upload Existing Resume</strong><span>Improve with AI suggestions</span></span>
                  </button>
                </section>

                <section className="rh-card">
                  <h2>Quick Actions</h2>
                  {quickActions.map(a => (
                    <button
                      key={a.label}
                      type="button"
                      className="rh-action"
                      onClick={() => (a.go ? setTab(a.go) : a.action())}
                    >
                      <span className="rh-action-icon"><Icon name={a.icon} /></span>
                      <span>{a.label}</span>
                      <Icon name="chevron" />
                    </button>
                  ))}
                </section>

                <section className="rh-card">
                  <div className="rh-card-head"><h2>Resume Templates</h2></div>
                  <div className="rh-tpl-row">
                    {TEMPLATES.map(t => (
                      <TemplateThumb key={t.id} t={t} active={template === t.id} onClick={() => setTemplate(t.id)} />
                    ))}
                  </div>
                </section>
              </div>

              <div className="rh-col-center">
                <section className="rh-card">
                  <div className="rh-card-head">
                    <h2>Resume Preview</h2>
                    <button type="button" className="rh-btn is-ghost sm" onClick={() => onNavigate && onNavigate('settings')}>
                      Edit
                    </button>
                  </div>
                  <ResumeDoc profile={profile} template={template} />
                </section>
              </div>

              <div className="rh-col-right">
                <section className="rh-card">
                  <div className="rh-card-head">
                    <h2>ATS Score &amp; Suggestions</h2>
                  </div>
                  <div className="rh-ats-top">
                    <ScoreRing score={ats.score} />
                    <p className="rh-ats-verdict">
                      {ats.score >= 75 ? 'Great! Your resume is ATS friendly.' : ats.score >= 50 ? 'Good start — a few gaps to fix.' : 'Needs work to pass ATS scans.'}
                    </p>
                  </div>
                  <ul className="rh-checks">
                    {ats.checks.map((c, i) => (
                      <li key={i} className={c.pass ? 'is-pass' : 'is-warn'}>
                        <Icon name={c.pass ? 'roadmap' : 'clock'} />
                        <span>{c.label}</span>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="rh-card">
                  <div className="rh-card-head"><h2>AI Suggestions</h2></div>
                  <div className="rh-sugg-list">
                    {suggestions.slice(0, 4).map((s, i) => (
                      <div key={i} className="rh-sugg">
                        <span className="rh-sugg-icon"><Icon name={s.icon} /></span>
                        <div><strong>{s.title}</strong><p>{s.desc}</p></div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rh-card">
                  <h2>Tailor for a Job</h2>
                  <p className="rh-card-sub">Paste a job description and get a tailored resume with relevant keywords and skills.</p>
                  <textarea
                    className="rh-input"
                    rows={3}
                    value={jd}
                    onChange={e => setJd(e.target.value)}
                    placeholder="Paste job description here…"
                  />
                  <button type="button" className="rh-btn is-primary full" onClick={() => { runJdAnalysis(); setTab('Job Tailor') }}>
                    <Icon name="sparkles" /> Tailor with AI
                  </button>
                </section>
              </div>
            </div>
          )}

          {tab === 'ATS Analysis' && (
            <div className="rh-wide">
              <section className="rh-card">
                <h2>ATS Analysis</h2>
                <p className="rh-card-sub">How applicant tracking systems read your resume — computed from your live profile</p>
                <div className="rh-ats-top">
                  <ScoreRing score={ats.score} />
                  <div>
                    {ats.checks.map((c, i) => (
                      <div key={i} className="rh-ats-row">
                        <span className={`rh-ats-dot ${c.pass ? 'is-pass' : 'is-warn'}`} />
                        <div><strong>{c.label}</strong><p>{c.pass ? 'Passed' : c.tip}</p></div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          )}

          {tab === 'Job Tailor' && (
            <div className="rh-wide">
              <section className="rh-card">
                <h2>Tailor for a Job</h2>
                <p className="rh-card-sub">Paste a job description — we compare its keywords against your skills and gaps</p>
                <textarea
                  className="rh-input"
                  rows={6}
                  value={jd}
                  onChange={e => setJd(e.target.value)}
                  placeholder="Paste the full job description here…"
                />
                <div className="rh-actions"><button type="button" className="rh-btn is-primary" onClick={runJdAnalysis}><Icon name="sparkles" /> Analyze Match</button></div>
                {jdResult && (
                  <div className="rh-jd-result">
                    <div className="rh-jd-score"><ScoreRing score={jdResult.score} /><p>Keyword match score</p></div>
                    <div className="rh-jd-cols">
                      <div>
                        <h3>Matched skills ({jdResult.matched.length})</h3>
                        <div className="rh-chips">{jdResult.matched.map(m => <span key={m.skill} className="rh-chip is-ok">{m.skill} ×{m.count}</span>)}
                          {jdResult.matched.length === 0 && <p className="rh-hint">None of your skills appear in this JD.</p>}</div>
                      </div>
                      <div>
                        <h3>Missing keywords ({jdResult.missing.length})</h3>
                        <div className="rh-chips">{jdResult.missing.map(m => <span key={m.skill} className="rh-chip is-miss">{m.skill} ×{m.count}</span>)}
                          {jdResult.missing.length === 0 && <p className="rh-hint">No missing keywords detected.</p>}</div>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}

          {tab === 'Templates' && (
            <section className="rh-card">
              <h2>Resume Templates</h2>
              <p className="rh-card-sub">Pick a template — the preview updates instantly</p>
              <div className="rh-tpl-grid">
                {TEMPLATES.map(t => (
                  <TemplateThumb key={t.id} t={t} active={template === t.id} onClick={() => setTemplate(t.id)} />
                ))}
              </div>
            </section>
          )}

          {tab === 'Suggestions' && (
            <div className="rh-wide">
              <section className="rh-card">
                <h2>AI Suggestions</h2>
                <p className="rh-card-sub">Actionable improvements computed from your profile and skill gaps</p>
                <div className="rh-sugg-list">
                  {suggestions.map((s, i) => (
                    <div key={i} className="rh-sugg">
                      <span className="rh-sugg-icon"><Icon name={s.icon} /></span>
                      <div><strong>{s.title}</strong><p>{s.desc}</p></div>
                    </div>
                  ))}
                </div>
              </section>
              <section className="rh-card">
                <h2>Cover Letter Generator</h2>
                <p className="rh-card-sub">Drafted from your live profile data</p>
                <div className="rh-actions"><button type="button" className="rh-btn is-primary" onClick={generateCoverLetter}><Icon name="chat" /> Generate Cover Letter</button></div>
                {coverLetter && <pre className="rh-cover">{coverLetter}</pre>}
              </section>
            </div>
          )}

          {tab === 'Download' && (
            <section className="rh-card">
              <h2>Download Resume</h2>
              <p className="rh-card-sub">Export your resume generated from your Grafted profile</p>
              <div className="rh-actions">
                <button type="button" className="rh-btn is-primary" onClick={downloadMd}><Icon name="upload" /> Download Markdown</button>
                <button type="button" className="rh-btn is-ghost" onClick={() => window.print()}><Icon name="resume" /> Print / Save as PDF</button>
              </div>
              <p className="rh-hint">Tip: use “Print / Save as PDF” and choose “Save as PDF” in the print dialog.</p>
            </section>
          )}
        </>
      )}
    </div>
  )
}
