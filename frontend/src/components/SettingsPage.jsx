import { useEffect, useMemo, useState } from 'react'
import axios from '../lib/api.js'
import { Icon } from './icons.jsx'

const API = import.meta.env.VITE_API_URL || ''

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'profile', label: 'Profile' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'privacy', label: 'Privacy & Security' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'billing', label: 'Billing' },
]

const INTEGRATIONS = [
  { id: 'github', label: 'GitHub', icon: 'code' },
  { id: 'linkedin', label: 'LinkedIn', icon: 'linkedin' },
  { id: 'google', label: 'Google', icon: 'globe' },
  { id: 'leetcode', label: 'LeetCode', icon: 'chart' },
  { id: 'stackoverflow', label: 'Stack Overflow', icon: 'bulb' },
]

const NOTIF_DEFS = [
  { id: 'jobAlerts', label: 'Job Alerts', desc: 'Get notified about new job matches', icon: 'bell' },
  { id: 'interviewReminders', label: 'Interview Reminders', desc: 'Reminders for upcoming interviews', icon: 'clock' },
  { id: 'applicationUpdates', label: 'Application Updates', desc: 'Status updates for your applications', icon: 'briefcase' },
  { id: 'productUpdates', label: 'Product Updates', desc: 'New features and improvements', icon: 'sparkles' },
]

function loadPrefs(userId) {
  try {
    return JSON.parse(localStorage.getItem(`grafted_settings_${userId}`) ?? '{}')
  } catch {
    return {}
  }
}

function Toggle({ on, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`set-toggle ${on ? 'is-on' : ''}`}
      onClick={() => onChange(!on)}
    >
      <span className="set-toggle-knob" />
    </button>
  )
}

function Field({ label, children }) {
  return (
    <label className="set-field">
      <span className="set-field-label">{label}</span>
      {children}
    </label>
  )
}

function SettingsArt() {
  return (
    <div className="set-art" aria-hidden="true">
      <div className="set-art-screen">
        <span className="set-art-gear"><Icon name="settings" /></span>
      </div>
      <div className="set-art-bar b1" />
      <div className="set-art-bar b2" />
      <div className="set-art-bar b3" />
      <span className="set-art-plant" />
    </div>
  )
}

export default function SettingsPage({ userId, onNavigate }) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('general')
  const [prefs, setPrefs] = useState(() => loadPrefs(userId))
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Profile form state
  const [name, setName] = useState('')
  const [targetRole, setTargetRole] = useState('')
  const [experience, setExperience] = useState('')
  const [stackInput, setStackInput] = useState('')
  const [stack, setStack] = useState([])

  useEffect(() => {
    let alive = true
    async function load() {
      if (!userId) return
      setLoading(true)
      try {
        const { data } = await axios.get(`${API}/api/user/${userId}`)
        if (!alive) return
        setProfile(data)
        setName(data.name ?? '')
        setTargetRole(data.target_role ?? '')
        setExperience(data.experience ?? '')
        setStack(data.stack ?? [])
        setPrefs(prev => {
          const merged = { ...prev }
          if (!merged.defaultRole && data.target_role) merged.defaultRole = data.target_role
          return merged
        })
      } catch {
        /* keep graceful empty state */
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [userId])

  useEffect(() => {
    if (userId) localStorage.setItem(`grafted_settings_${userId}`, JSON.stringify(prefs))
  }, [prefs, userId])

  const setPref = (key, value) => setPrefs(prev => ({ ...prev, [key]: value }))
  const setNotif = (key, value) => setPrefs(prev => ({ ...prev, notifications: { ...prev.notifications, [key]: value } }))
  const setIntegration = (key, value) => setPrefs(prev => ({ ...prev, integrations: { ...prev.integrations, [key]: value } }))

  const flash = msg => {
    setNotice(msg)
    setTimeout(() => setNotice(''), 3200)
  }

  const saveProfile = async () => {
    if (!profile) return
    setSaving(true)
    try {
      await axios.put(`${API}/api/user/${userId}/profile`, {
        name: name.trim() || 'Developer',
        stack: stack.length ? stack : (profile.stack ?? ['JavaScript']),
        experience: experience.trim() || profile.experience || 'fresher',
        target_role: targetRole.trim(),
        timeline: profile.timeline,
        learning_style: profile.learning_style,
        learning_stack: profile.learning_stack ?? [],
        goals: profile.goals ?? [],
      })
      const { data } = await axios.get(`${API}/api/user/${userId}`)
      setProfile(data)
      flash('Profile saved.')
    } catch {
      flash('Could not save profile. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const addSkill = () => {
    const v = stackInput.trim()
    if (v && !stack.includes(v)) setStack(prev => [...prev, v])
    setStackInput('')
  }

  const exportData = () => {
    if (!profile) return
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `grafted-profile-${userId.slice(0, 8)}.json`
    a.click()
    URL.revokeObjectURL(url)
    flash('Profile data downloaded.')
  }

  const memberSince = useMemo(() => {
    if (!profile?.created_at) return ''
    return new Date(profile.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
  }, [profile])

  const initial = (profile?.name ?? 'G').charAt(0).toUpperCase()

  return (
    <div className="set-page">
      <header className="set-hero">
        <div className="set-hero-text">
          <h1 className="set-hero-title"><span className="set-hero-gear"><Icon name="settings" /></span> Settings</h1>
          <p className="set-hero-sub">Customize your Grafted experience</p>
        </div>
        <SettingsArt />
      </header>

      <div className="set-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            className={`set-tab ${tab === t.id ? 'is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {notice && <div className="set-notice">{notice}</div>}

      {loading ? (
        <div className="set-loading">Loading your settings…</div>
      ) : (
        <>
          {tab === 'general' && (
            <section className="set-card">
              <h2>Account Settings</h2>
              <p className="set-card-sub">Manage your profile and account information</p>
              <div className="set-account-row">
                <span className="set-avatar">{initial}</span>
                <div className="set-account-info">
                  <strong>{profile?.name ?? 'Developer'}</strong>
                  <span>{profile?.email ?? 'No email on file'}</span>
                  <span className="set-plan">Free Plan{memberSince ? ` · Member since ${memberSince}` : ''}</span>
                </div>
                <button type="button" className="set-btn is-ghost" onClick={() => setTab('profile')}>
                  Edit Profile
                </button>
              </div>
              <div className="set-grid-2">
                <Field label="Full Name">
                  <input className="set-input" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
                </Field>
                <Field label="Email Address">
                  <input className="set-input" value={profile?.email ?? ''} disabled title="Email is tied to your sign-in" />
                </Field>
              </div>
              <Field label="Bio">
                <textarea
                  className="set-input"
                  rows={3}
                  maxLength={200}
                  value={prefs.bio ?? ''}
                  onChange={e => setPref('bio', e.target.value)}
                  placeholder="Final year CSE student | AI/ML Developer | Open Source Enthusiast"
                />
              </Field>
              <p className="set-hint">{(prefs.bio ?? '').length}/200 · Bio is saved on this device</p>
              <div className="set-actions">
                <button type="button" className="set-btn is-primary" disabled={saving} onClick={saveProfile}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </section>
          )}

          {tab === 'profile' && (
            <section className="set-card">
              <h2>Profile</h2>
              <p className="set-card-sub">Your career profile powers matching, gaps and recommendations</p>
              <div className="set-grid-2">
                <Field label="Full Name">
                  <input className="set-input" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
                </Field>
                <Field label="Target Role">
                  <input
                    className="set-input"
                    value={targetRole}
                    onChange={e => setTargetRole(e.target.value)}
                    placeholder="e.g. AI/ML Engineer"
                  />
                </Field>
              </div>
              <Field label="Experience">
                <select className="set-input" value={experience} onChange={e => setExperience(e.target.value)}>
                  <option value="">Select…</option>
                  <option value="fresher">Fresher</option>
                  <option value="0-1 years">0–1 years</option>
                  <option value="1-3 years">1–3 years</option>
                  <option value="3-5 years">3–5 years</option>
                  <option value="5+ years">5+ years</option>
                </select>
              </Field>
              <Field label="Skills Stack">
                <div className="set-stack-row">
                  <input
                    className="set-input"
                    value={stackInput}
                    onChange={e => setStackInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSkill() } }}
                    placeholder="Add a skill and press Enter"
                  />
                  <button type="button" className="set-btn is-ghost" onClick={addSkill}>Add</button>
                </div>
              </Field>
              <div className="set-chips">
                {stack.map(s => (
                  <span key={s} className="set-chip">
                    {s}
                    <button type="button" aria-label={`Remove ${s}`} onClick={() => setStack(prev => prev.filter(x => x !== s))}>
                      <Icon name="x" />
                    </button>
                  </span>
                ))}
                {stack.length === 0 && <p className="set-hint">No skills yet — add your first one above.</p>}
              </div>
              {(profile?.goals ?? []).length > 0 && (
                <>
                  <h3 className="set-subhead">Career Goals</h3>
                  <div className="set-chips">
                    {(profile.goals ?? []).map((g, i) => <span key={i} className="set-chip is-goal">{g}</span>)}
                  </div>
                </>
              )}
              <div className="set-actions">
                <button type="button" className="set-btn is-primary" disabled={saving} onClick={saveProfile}>
                  {saving ? 'Saving…' : 'Save Profile'}
                </button>
              </div>
            </section>
          )}

          {tab === 'preferences' && (
            <div className="set-grid-2">
              <section className="set-card">
                <h2>Preferences</h2>
                <p className="set-card-sub">Customize how Grafted works for you</p>
                <Field label="Theme">
                  <select className="set-input" value={prefs.theme ?? 'dark'} onChange={e => setPref('theme', e.target.value)}>
                    <option value="dark">Dark (Default)</option>
                    <option value="system">System</option>
                  </select>
                </Field>
                <Field label="Language">
                  <select className="set-input" value={prefs.language ?? 'en'} onChange={e => setPref('language', e.target.value)}>
                    <option value="en">English</option>
                    <option value="hi">Hindi</option>
                    <option value="hinglish">Hinglish</option>
                  </select>
                </Field>
                <Field label="Default Role">
                  <select className="set-input" value={prefs.defaultRole ?? targetRole ?? ''} onChange={e => setPref('defaultRole', e.target.value)}>
                    <option value="">Select…</option>
                    {['AI/ML Engineer', 'Frontend Engineer', 'Backend Engineer', 'Full-Stack Engineer', 'Data Scientist', 'DevOps Engineer'].map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                    {targetRole && !['AI/ML Engineer', 'Frontend Engineer', 'Backend Engineer', 'Full-Stack Engineer', 'Data Scientist', 'DevOps Engineer'].includes(targetRole) && (
                      <option value={targetRole}>{targetRole}</option>
                    )}
                  </select>
                </Field>
                <Field label="Location Preference">
                  <select className="set-input" value={prefs.location ?? 'india'} onChange={e => setPref('location', e.target.value)}>
                    <option value="india">India (Remote + Onsite)</option>
                    <option value="remote">Remote only</option>
                    <option value="bangalore">Bengaluru</option>
                    <option value="hyderabad">Hyderabad</option>
                    <option value="noida">Noida / Delhi NCR</option>
                  </select>
                </Field>
                <p className="set-hint">Preferences are saved on this device.</p>
              </section>

              <section className="set-card">
                <h2>Notifications</h2>
                <p className="set-card-sub">Manage what notifications you receive</p>
                {NOTIF_DEFS.map(n => (
                  <div key={n.id} className="set-row">
                    <span className={`set-row-icon i-${n.id}`}><Icon name={n.icon} /></span>
                    <div className="set-row-text">
                      <strong>{n.label}</strong>
                      <span>{n.desc}</span>
                    </div>
                    <Toggle label={n.label} on={prefs.notifications?.[n.id] ?? (n.id !== 'productUpdates')} onChange={v => setNotif(n.id, v)} />
                  </div>
                ))}
                <p className="set-hint">Notification preferences are saved on this device.</p>
              </section>
            </div>
          )}

          {tab === 'notifications' && (
            <section className="set-card">
              <h2>Notifications</h2>
              <p className="set-card-sub">Manage what notifications you receive</p>
              {NOTIF_DEFS.map(n => (
                <div key={n.id} className="set-row">
                  <span className={`set-row-icon i-${n.id}`}><Icon name={n.icon} /></span>
                  <div className="set-row-text">
                    <strong>{n.label}</strong>
                    <span>{n.desc}</span>
                  </div>
                  <Toggle label={n.label} on={prefs.notifications?.[n.id] ?? (n.id !== 'productUpdates')} onChange={v => setNotif(n.id, v)} />
                </div>
              ))}
              <p className="set-hint">Notification preferences are saved on this device.</p>
            </section>
          )}

          {tab === 'privacy' && (
            <section className="set-card">
              <h2>Privacy &amp; Security</h2>
              <p className="set-card-sub">Manage your data and account security</p>
              <button type="button" className="set-action-row" onClick={exportData}>
                <span className="set-row-icon"><Icon name="paste" /></span>
                <span className="set-row-text"><strong>Data Privacy</strong><span>Download your profile and career data</span></span>
                <Icon name="chevron" />
              </button>
              <button type="button" className="set-action-row" onClick={() => flash('Password changes are handled through your sign-in method — sign out and use “Forgot password” if needed.')}>
                <span className="set-row-icon"><Icon name="settings" /></span>
                <span className="set-row-text"><strong>Change Password</strong><span>Update your account password</span></span>
                <Icon name="chevron" />
              </button>
              <div className="set-action-row is-static">
                <span className="set-row-icon"><Icon name="bell" /></span>
                <span className="set-row-text"><strong>Two-Factor Authentication</strong><span>Add an extra layer of security</span></span>
                <Toggle label="Two-factor authentication" on={prefs.twoFactor ?? false} onChange={v => setPref('twoFactor', v)} />
              </div>
              {!confirmDelete ? (
                <button type="button" className="set-action-row is-danger" onClick={() => setConfirmDelete(true)}>
                  <span className="set-row-icon"><Icon name="x" /></span>
                  <span className="set-row-text"><strong>Delete Account</strong><span>Permanently delete your account</span></span>
                  <Icon name="chevron" />
                </button>
              ) : (
                <div className="set-danger-box">
                  <p>Account deletion is permanent and removes your profile, memories and wiki pages. To proceed, contact support from the Help &amp; Feedback page so we can verify ownership first.</p>
                  <div className="set-actions">
                    <button type="button" className="set-btn is-ghost" onClick={() => setConfirmDelete(false)}>Keep my account</button>
                    {onNavigate && (
                      <button type="button" className="set-btn is-danger-btn" onClick={() => onNavigate('help')}>Go to Help &amp; Feedback</button>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          {tab === 'integrations' && (
            <section className="set-card">
              <div className="set-card-head">
                <div>
                  <h2>Integrations</h2>
                  <p className="set-card-sub">Connect with your accounts</p>
                </div>
              </div>
              <div className="set-integrations">
                {INTEGRATIONS.map(svc => {
                  const connected = prefs.integrations?.[svc.id] ?? false
                  return (
                    <div key={svc.id} className="set-integration">
                      <span className="set-integration-icon"><Icon name={svc.icon} /></span>
                      <div className="set-row-text">
                        <strong>{svc.label}</strong>
                        <span className={connected ? 'is-connected' : ''}>{connected ? 'Connected' : 'Not Connected'}</span>
                      </div>
                      <button
                        type="button"
                        className={`set-btn sm ${connected ? 'is-ghost' : 'is-primary'}`}
                        onClick={() => setIntegration(svc.id, !connected)}
                      >
                        {connected ? 'Disconnect' : 'Connect'}
                      </button>
                    </div>
                  )
                })}
              </div>
              <p className="set-hint">Integration choices are saved on this device for now — full OAuth connections are coming soon.</p>
            </section>
          )}

          {tab === 'billing' && (
            <section className="set-card">
              <div className="set-card-head">
                <div>
                  <h2>Billing &amp; Plan</h2>
                  <p className="set-card-sub">Manage your subscription and usage</p>
                </div>
              </div>
              <div className="set-plan-card">
                <span className="set-plan-icon"><Icon name="crown" /></span>
                <div className="set-row-text">
                  <strong>Free Plan <span className="set-plan-badge">Current Plan</span></strong>
                  <span>Career graph, wiki, chat and job matching with standard limits</span>
                </div>
                <button type="button" className="set-btn is-primary" onClick={() => flash('Grafted Pro is coming soon — you are on the Free plan for now.')}>
                  Upgrade to Pro
                </button>
              </div>
              <div className="set-usage">
                <div className="set-usage-row"><span>Wiki pages</span><strong>{profile ? 'Unlimited' : '—'}</strong></div>
                <div className="set-usage-row"><span>AI chat</span><strong>Standard</strong></div>
                <div className="set-usage-row"><span>Career memory</span><strong>Unlimited</strong></div>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
