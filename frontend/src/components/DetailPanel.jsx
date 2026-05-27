import axios from '../lib/api.js'

const API_BASE = import.meta.env.VITE_API_URL || ''

function scoreColor(score) {
  if (score >= 80) return 'var(--success)'
  if (score >= 60) return 'var(--primary)'
  return 'var(--warning)'
}

function formatPrize(value) {
  if (!value) return 'Prize TBD'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value)
}

function daysUntil(date) {
  if (!date) return null
  return Math.max(0, Math.ceil((new Date(date) - new Date()) / 86400000))
}

function Header({ node, onClose }) {
  return (
    <div className="panel-header">
      <div className="panel-title-wrap">
        <span className={`node-type-badge ${node.type}`}>{node.type.replace('_', ' ')}</span>
        <span className="panel-title">{node.label}</span>
      </div>
      <button className="panel-close" type="button" onClick={onClose} aria-label="Close detail panel">×</button>
    </div>
  )
}

function Score({ score, matched, total }) {
  return (
    <div className="panel-section">
      <div className="score-number" style={{ color: scoreColor(score) }}>{score}%</div>
      <div className="progress-track" style={{ marginTop: 10 }}>
        <div className="progress-fill" style={{ width: `${score}%`, background: scoreColor(score) }} />
      </div>
      <p className="caption" style={{ marginTop: 8 }}>{matched} of {total} skills match</p>
    </div>
  )
}

function StartupContent({ node, onSave }) {
  const startup = node.raw
  const match = startup.claude_analysis ?? {}
  const score = match.match_percentage ?? startup.match_score ?? 0
  const known = match.matching_skills?.length ? match.matching_skills : startup.skills_required?.slice(0, 3) ?? []
  const missing = match.missing_skills?.length ? match.missing_skills : startup.skills_required?.filter(skill => !known.includes(skill)) ?? []

  return (
    <>
      <div className="panel-body">
        <Score score={score} matched={known.length} total={(startup.skills_required ?? []).length} />
        <div className="panel-section">
          <p className="panel-section-title">Skills</p>
          <div className="pill-row">
            {known.map(skill => <span className="pill known" key={skill}>{skill}</span>)}
            {missing.map(skill => <span className="pill missing" key={skill}>{skill}</span>)}
          </div>
        </div>
        <div className="panel-section">
          <p className="panel-section-title">Details</p>
          <div className="detail-row"><span>Location</span><span>{startup.location}</span></div>
          <div className="detail-row"><span>Stage</span><span>{startup.stage}</span></div>
          <div className="detail-row"><span>Experience</span><span>{startup.min_experience}</span></div>
          <div className="detail-row"><span>Salary</span><span>{startup.salary_range_lpa} LPA</span></div>
          <div className="detail-row"><span>Rounds</span><span>{startup.interview_rounds ?? 3}</span></div>
        </div>
        <div className="panel-section">
          <p className="panel-section-title">Interview</p>
          <div className="pill-row">
            {(startup.interview_topics ?? []).map(topic => <span className="pill neutral" key={topic}>{topic}</span>)}
          </div>
        </div>
      </div>
      <div className="panel-actions">
        {startup.apply_url && <a className="btn btn-primary" href={startup.apply_url} target="_blank" rel="noopener noreferrer">Apply</a>}
        <button className="btn btn-outline" type="button" onClick={onSave}>Save to Watchlist</button>
      </div>
    </>
  )
}

function SkillKnownContent({ node, startups, onFocus }) {
  const skill = node.raw.skill
  const companies = startups.filter(startup => startup.skills_required?.includes(skill)).slice(0, 6)
  const demand = Math.min(100, 48 + companies.length * 9)

  return (
    <div className="panel-body">
      <div className="panel-section">
        <span className="pill known">In your stack</span>
      </div>
      <div className="panel-section">
        <p className="panel-section-title">Demand</p>
        <div className="detail-row"><span>Demand score</span><span>{demand}/100</span></div>
        <div className="progress-track"><div className="progress-fill" style={{ width: `${demand}%`, background: 'var(--success)' }} /></div>
        <div style={{ marginTop: 10 }}><span className="pill known">rising ↑</span></div>
      </div>
      <div className="panel-section">
        <p className="panel-section-title">Companies wanting this</p>
        <div className="pill-row">
          {companies.map(company => (
            <button className="pill neutral" key={company.id} type="button" onClick={() => onFocus(`startup:${company.id}`)}>{company.name}</button>
          ))}
        </div>
      </div>
      <div className="panel-section">
        <p className="panel-section-title">Market</p>
        <div className="detail-row"><span>Salary premium</span><span style={{ color: 'var(--success)' }}>+18%</span></div>
        <div className="detail-row"><span>Interview importance</span><span>High</span></div>
      </div>
    </div>
  )
}

function SkillGapContent({ node, userId, userStack, onLearned }) {
  const gap = node.raw

  async function markLearned() {
    if (userId && !userStack.includes(gap.skill)) {
      try {
        await axios.post(`${API_BASE}/api/user/${userId}/stack`, { stack: [...userStack, gap.skill] })
      } catch {}
    }
    onLearned(gap.skill)
  }

  return (
    <>
      <div className="panel-body">
        <div className="panel-section">
          <span className="pill missing">Not in your stack</span>
        </div>
        <div className="panel-section">
          <p className="panel-section-title">Why you need this</p>
          <p className="caption" style={{ color: 'var(--secondary)' }}>{gap.why}</p>
        </div>
        <div className="panel-section">
          <p className="panel-section-title">Learning path</p>
          <div className="detail-row"><span>Time</span><span>{gap.time_weeks ?? 2} weeks</span></div>
          <div className="detail-row"><span>Difficulty</span><span>{gap.difficulty ?? 'Beginner friendly'}</span></div>
          <div className="detail-row"><span>Prerequisite</span><span>JavaScript</span></div>
          {gap.resource && <a href={gap.resource} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 10 }}>Start learning →</a>}
        </div>
        <div className="panel-section">
          <p className="panel-section-title">Impact</p>
          <div className="detail-row"><span>Salary</span><span style={{ color: 'var(--success)' }}>{gap.salary_impact ?? '+15-20%'}</span></div>
          <div className="detail-row"><span>Access</span><span style={{ color: 'var(--primary)' }}>Unlocks more companies</span></div>
        </div>
      </div>
      <div className="panel-actions">
        <button className="btn btn-success" type="button" onClick={markLearned}>Mark as Learned</button>
      </div>
    </>
  )
}

function HackathonContent({ node }) {
  const hackathon = node.raw
  const score = hackathon.match_score ?? 0
  const days = daysUntil(hackathon.deadline)

  return (
    <>
      <div className="panel-body">
        <Score score={score} matched={hackathon.matchedSkills?.length ?? 0} total={(hackathon.skills_relevant ?? []).length} />
        <div className="panel-section">
          <p className="panel-section-title">Details</p>
          <div className="pill-row" style={{ marginBottom: 12 }}>
            <span className="pill neutral">{hackathon.platform}</span>
            <span className="pill neutral">{hackathon.type}</span>
          </div>
          <div className="detail-row"><span>Duration</span><span>{hackathon.duration_hours} hours</span></div>
          <div className="detail-row"><span>Team</span><span>{hackathon.team_size_min}-{hackathon.team_size_max} people</span></div>
          <div className="detail-row"><span>Prize</span><span style={{ color: 'var(--success)' }}>{formatPrize(hackathon.prize_pool_inr)}</span></div>
        </div>
        <div className="panel-section">
          <p className="panel-section-title">Deadline</p>
          <div className="detail-row"><span>Date</span><span>{hackathon.deadline ? new Date(hackathon.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'TBD'}</span></div>
          {days != null && <div className="detail-row"><span>Remaining</span><span style={{ color: days < 14 ? 'var(--danger)' : 'var(--muted)' }}>{days} days left</span></div>}
        </div>
        <div className="panel-section">
          <p className="panel-section-title">Skills needed</p>
          <div className="pill-row">
            {(hackathon.skills_relevant ?? []).map(skill => <span className="pill neutral" key={skill}>{skill}</span>)}
          </div>
        </div>
      </div>
      <div className="panel-actions">
        {hackathon.registration_url && <a className="btn btn-primary" href={hackathon.registration_url} target="_blank" rel="noopener noreferrer">Register Now</a>}
      </div>
    </>
  )
}

function UserContent({ userStack, startups, hackathons, gapSkills }) {
  const events = [
    ['#3B82F6', `Stack created: ${userStack.join(', ') || 'React, Node.js, Python'}`, 'Just now'],
    ['#F97316', `Viewed ${startups[0]?.name ?? 'Razorpay'}`, '3 days ago'],
    ['#8B5CF6', `Viewed ${hackathons[0]?.name ?? 'ETHIndia 2026'}`, '3 days ago'],
    ['#EF4444', `Gap analysis: ${gapSkills.slice(0, 2).map(item => item.skill).join(', ') || 'TypeScript'}`, '3 days ago'],
  ]

  return (
    <div className="panel-body">
      <div className="panel-section">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className="avatar">AR</div>
          <div>
            <div className="panel-title">Your Profile</div>
            <p className="caption">Developer career graph</p>
          </div>
        </div>
      </div>
      <div className="panel-section">
        <p className="panel-section-title">Your stack</p>
        <div className="pill-row">{userStack.map(skill => <span className="pill known" key={skill}>{skill}</span>)}</div>
      </div>
      <div className="panel-section">
        <p className="panel-section-title">HydraDB memory</p>
        <div className="timeline-mini">
          {events.map(([color, text, time]) => (
            <div className="timeline-mini-item" key={text}>
              <span className="dot" style={{ background: color, marginTop: 3 }} />
              <span>{text}<br /><span style={{ color: 'var(--muted)' }}>{time}</span></span>
            </div>
          ))}
        </div>
      </div>
      <div className="panel-section">
        <p className="panel-section-title">Stats</p>
        <div className="stats-grid">
          <div className="stat-box"><strong>4</strong><span>sessions</span></div>
          <div className="stat-box"><strong>7</strong><span>days active</span></div>
          <div className="stat-box"><strong>{startups.length}</strong><span>startups</span></div>
          <div className="stat-box"><strong>{hackathons.length}</strong><span>hackathons</span></div>
        </div>
      </div>
    </div>
  )
}

export default function DetailPanel({
  node,
  onClose,
  startups,
  hackathons,
  userStack,
  userId,
  gapSkills,
  onFocusNode,
  onLearned,
  onSave,
}) {
  if (!node) return null

  return (
    <aside className="detail-panel">
      <Header node={node} onClose={onClose} />
      {node.type === 'startup' && <StartupContent node={node} onSave={onSave} />}
      {node.type === 'skill_known' && <SkillKnownContent node={node} startups={startups} onFocus={onFocusNode} />}
      {node.type === 'skill_gap' && <SkillGapContent node={node} userId={userId} userStack={userStack} onLearned={onLearned} />}
      {node.type === 'hackathon' && <HackathonContent node={node} />}
      {node.type === 'user' && <UserContent userStack={userStack} startups={startups} hackathons={hackathons} gapSkills={gapSkills} />}
    </aside>
  )
}

