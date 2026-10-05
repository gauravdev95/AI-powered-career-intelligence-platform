import axios from '../lib/api.js'
import { isSameSkill } from '../lib/graph.js'

/**
 * Detail panel — the reading surface for whichever node has focus.
 *
 * Two rules hold across every variant:
 *
 *   1. No bare 0–100 bar. Every meter states what is being measured, the value and
 *      its unit, so a filled bar can never be read as "good" by default.
 *   2. No inline style objects except the one live value a meter cannot express in
 *      a stylesheet — its width. Colour, tone and spacing are classes on tokens.
 */

const clamp01 = value => Math.min(1, Math.max(0, value))

function toneForScore(score) {
  if (score >= 80) return 'moss'
  if (score >= 60) return 'blue'
  return 'ochre'
}

function formatPrize(value) {
  if (!value) return 'Prize TBD'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value)
}

function daysUntil(date) {
  if (!date) return null
  return Math.max(0, Math.ceil((new Date(date) - new Date()) / 86400000))
}

/**
 * A labelled meter. `label` says what is measured, `value`/`max`/`unit` say how
 * much of it there is, and `note` carries the plain-language reading.
 */
function Meter({ label, value, max = 100, unit = '%', maxUnit, tone = 'accent', note }) {
  const pct = Math.round(clamp01(max ? value / max : 0) * 100)
  return (
    <div className="meter">
      <div className="meter-head">
        <span className="meter-label">{label}</span>
        <span className="meter-value">
          {value}{unit}
          <span className="meter-max"> / {max}{maxUnit ?? unit}</span>
        </span>
      </div>
      <div
        className="meter-track"
        role="meter"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <div className={`meter-fill meter-fill--${tone}`} style={{ width: `${pct}%` }} />
      </div>
      {note && <p className="meter-note">{note}</p>}
    </div>
  )
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

/** Skill list split into covered and missing — the same split the canvas draws. */
function SkillSplit({ have, missing }) {
  return (
    <div className="split">
      <div className="split-col">
        <p className="split-head split-head--have">You have<span className="split-n">{have.length}</span></p>
        <div className="pill-row">
          {have.length
            ? have.map(skill => <span className="pill known" key={skill}>{skill}</span>)
            : <span className="pill neutral">None yet</span>}
        </div>
      </div>
      <div className="split-col">
        <p className="split-head split-head--missing">Missing<span className="split-n">{missing.length}</span></p>
        <div className="pill-row">
          {missing.length
            ? missing.map(skill => <span className="pill missing" key={skill}>{skill}</span>)
            : <span className="pill neutral">Nothing missing</span>}
        </div>
      </div>
    </div>
  )
}

function StartupContent({ node, userStack, onSave }) {
  const startup = node.raw
  const match = startup.analysis ?? {}
  const score = match.match_percentage ?? startup.match_score ?? 0
  const required = startup.skills_required ?? []
  const have = match.matching_skills?.length
    ? match.matching_skills
    : required.filter(skill => userStack.some(known => isSameSkill(known, skill)))
  const missing = match.missing_skills?.length
    ? match.missing_skills
    : required.filter(skill => !have.some(item => isSameSkill(item, skill)))

  return (
    <>
      <div className="panel-body">
        <div className="panel-section">
          <Meter
            label="Stack match"
            value={score}
            unit="%"
            tone={toneForScore(score)}
            note={`${have.length} of ${required.length} required skills covered`}
          />
        </div>

        <div className="panel-section">
          <p className="panel-section-title">Requirements</p>
          <SkillSplit have={have} missing={missing} />
        </div>

        <div className="panel-section">
          <p className="panel-section-title">Details</p>
          <div className="detail-row"><span>Location</span><span>{startup.location ?? '—'}</span></div>
          <div className="detail-row"><span>Stage</span><span>{startup.stage ?? '—'}</span></div>
          <div className="detail-row"><span>Experience</span><span>{startup.min_experience ?? '—'}</span></div>
          <div className="detail-row"><span>Salary</span><span>{startup.salary_range_lpa ?? '—'} LPA</span></div>
          <div className="detail-row"><span>Rounds</span><span>{startup.interview_rounds ?? 3}</span></div>
        </div>

        {(startup.interview_topics ?? []).length > 0 && (
          <div className="panel-section">
            <p className="panel-section-title">Interview</p>
            <div className="pill-row">
              {startup.interview_topics.map(topic => <span className="pill neutral" key={topic}>{topic}</span>)}
            </div>
          </div>
        )}
      </div>
      <div className="panel-actions">
        {startup.apply_url && <a className="btn btn-primary" href={startup.apply_url} target="_blank" rel="noopener noreferrer">Apply</a>}
        <button className="btn btn-outline" type="button" onClick={onSave}>Save to Watchlist</button>
      </div>
    </>
  )
}

function SkillKnownContent({ node, startups, hackathons, onFocusNode }) {
  const { skill, demand = 0, totalOrgs = 0 } = node.raw
  const companies = startups.filter(startup => (startup.skills_required ?? []).some(item => isSameSkill(item, skill)))
  const events = hackathons.filter(hackathon => (hackathon.skills_relevant ?? []).some(item => isSameSkill(item, skill)))

  return (
    <div className="panel-body">
      <div className="panel-section">
        <span className="pill known">In your stack</span>
      </div>

      <div className="panel-section">
        {totalOrgs > 0 ? (
          <Meter
            label="Demand across your matches"
            value={demand}
            max={totalOrgs}
            unit={demand === 1 ? ' org' : ' orgs'}
            maxUnit={totalOrgs === 1 ? ' org' : ' orgs'}
            tone="blue"
            note={`${companies.length} ${companies.length === 1 ? 'company' : 'companies'} and ${events.length} ${events.length === 1 ? 'hackathon' : 'hackathons'} ask for ${skill}`}
          />
        ) : (
          <p className="meter-note meter-note--empty">No matches ask for {skill} yet — run an analysis or ingest companies to see demand.</p>
        )}
      </div>

      <div className="panel-section">
        <p className="panel-section-title">Companies requiring it</p>
        <div className="pill-row">
          {companies.length
            ? companies.map(company => (
              <button className="pill neutral" key={company.id} type="button" onClick={() => onFocusNode(`startup:${company.id}`)}>
                {company.name}
              </button>
            ))
            : <span className="pill neutral">No matches yet</span>}
        </div>
      </div>

      <div className="panel-section">
        <p className="panel-section-title">Events using it</p>
        <div className="pill-row">
          {events.length
            ? events.map(event => (
              <button className="pill neutral" key={event.id} type="button" onClick={() => onFocusNode(`hackathon:${event.id}`)}>
                {event.name}
              </button>
            ))
            : <span className="pill neutral">No events yet</span>}
        </div>
      </div>
    </div>
  )
}

function SkillGapContent({ node, userId, userStack, onLearned }) {
  const gap = node.raw
  const total = Math.max(1, gap.rankedTotal ?? 1)

  async function markLearned() {
    if (userId && !userStack.includes(gap.skill)) {
      try {
        await axios.post(`/api/user/${userId}/stack`, { stack: [...userStack, gap.skill] })
      } catch {
        // Local state still advances — the next sync will reconcile the stack.
      }
    }
    onLearned(gap.skill)
  }

  return (
    <>
      <div className="panel-body">
        <div className="panel-section">
          <span className="pill missing">Not in your stack</span>
          {gap.inferred && <span className="pill neutral">Unranked requirement</span>}
        </div>

        <div className="panel-section">
          {gap.priority ? (
            /* Inverted: rank 1 is the most urgent, so it reads as a full bar. */
            <Meter
              label="Gap priority"
              value={total - gap.priority + 1}
              max={total}
              unit=""
              tone="accent"
              note={`Ranked ${gap.priority} of ${total} gaps to close first`}
            />
          ) : (
            <Meter
              label="Asked for by"
              value={gap.demand ?? 0}
              max={Math.max(1, gap.demand ?? 1)}
              unit={(gap.demand ?? 0) === 1 ? ' org' : ' orgs'}
              maxUnit={(gap.demand ?? 1) === 1 ? ' org' : ' orgs'}
              tone="ochre"
              note="Not in your ranked gap list — it came from a company or event requirement"
            />
          )}
        </div>

        <div className="panel-section">
          <p className="panel-section-title">Why you need this</p>
          <p className="panel-prose">{gap.why}</p>
        </div>

        <div className="panel-section">
          <p className="panel-section-title">Learning path</p>
          <div className="detail-row"><span>Time</span><span>{gap.time_weeks ?? 2} weeks</span></div>
          <div className="detail-row"><span>Difficulty</span><span>{gap.difficulty ?? 'Beginner friendly'}</span></div>
          {gap.resource && (
            <a className="panel-link" href={gap.resource} target="_blank" rel="noopener noreferrer">Start learning →</a>
          )}
        </div>

        <div className="panel-section">
          <p className="panel-section-title">Impact</p>
          <div className="detail-row"><span>Salary</span><span className="val-moss">{gap.salary_impact ?? '+15-20%'}</span></div>
          <div className="detail-row"><span>Access</span><span className="val-accent">Unlocks more companies</span></div>
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
  const relevant = hackathon.skills_relevant ?? []
  const have = hackathon.matchedSkills ?? []
  const missing = hackathon.missingSkills ?? relevant.filter(skill => !have.includes(skill))
  const days = hackathon.days ?? daysUntil(hackathon.deadline)

  return (
    <>
      <div className="panel-body">
        <div className="panel-section">
          <Meter
            label="Skill coverage"
            value={have.length}
            max={Math.max(1, relevant.length)}
            unit=" skills"
            tone={toneForScore(relevant.length ? (have.length / relevant.length) * 100 : 0)}
            note={`${have.length} of ${relevant.length} relevant skills already in your stack`}
          />
        </div>

        {days != null && (
          <div className="panel-section">
            {/* Urgency counts down: a full bar means the deadline is imminent. */}
            <Meter
              label="Deadline urgency"
              value={Math.max(0, 60 - Math.min(days, 60))}
              max={60}
              unit=" days"
              tone={days < 14 ? 'accent' : days < 30 ? 'ochre' : 'moss'}
              note={days === 0 ? 'Closes today' : `${days} days left to register`}
            />
          </div>
        )}

        <div className="panel-section">
          <p className="panel-section-title">Skills needed</p>
          <SkillSplit have={have} missing={missing} />
        </div>

        <div className="panel-section">
          <p className="panel-section-title">Details</p>
          <div className="pill-row pill-row--spaced">
            <span className="pill neutral">{hackathon.platform}</span>
            <span className="pill neutral">{hackathon.type}</span>
          </div>
          <div className="detail-row"><span>Duration</span><span>{hackathon.duration_hours} hours</span></div>
          <div className="detail-row"><span>Team</span><span>{hackathon.team_size_min}-{hackathon.team_size_max} people</span></div>
          <div className="detail-row"><span>Prize</span><span className="val-moss">{formatPrize(hackathon.prize_pool_inr)}</span></div>
          <div className="detail-row">
            <span>Deadline</span>
            <span>{hackathon.deadline ? new Date(hackathon.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'TBD'}</span>
          </div>
        </div>

        {/* Never let a projected date read as a published one. Events whose organiser
            has not announced dates carry date_status: "expected" in the dataset. */}
        {hackathon.date_status === 'expected' && (
          <div className="panel-section">
            <p className="panel-note panel-note--caution">
              <strong>Dates not yet confirmed.</strong>{' '}
              {hackathon.date_status_reason ?? 'Projected from this event’s previous editions.'} Check the registration page before you plan around it.
            </p>
          </div>
        )}

        {hackathon.date_status === 'confirmed' && hackathon.date_note && (
          <div className="panel-section">
            <p className="panel-note">{hackathon.date_note}</p>
          </div>
        )}
      </div>
      <div className="panel-actions">
        {hackathon.registration_url && (
          <a className="btn btn-primary" href={hackathon.registration_url} target="_blank" rel="noopener noreferrer">Register Now</a>
        )}
      </div>
    </>
  )
}

function UserContent({ userStack, startups, hackathons, gapSkills, onFocusNode }) {
  const topMatch = startups[0]
  const nextDeadline = hackathons.find(item => item.deadline)
  const covered = userStack.length
  const total = covered + gapSkills.length

  return (
    <div className="panel-body">
      <div className="panel-section">
        <div className="profile-head">
          <div className="avatar" aria-hidden="true">YOU</div>
          <div>
            <p className="panel-title">Your Profile</p>
            <p className="caption">Grafted career graph</p>
          </div>
        </div>
      </div>

      <div className="panel-section">
        <Meter
          label="Stack coverage"
          value={covered}
          max={Math.max(1, total)}
          unit=" skills"
          tone="blue"
          note={`${gapSkills.length} gaps stand between you and your top matches`}
        />
      </div>

      <div className="panel-section">
        <p className="panel-section-title">Your stack</p>
        <div className="pill-row">
          {userStack.map(skill => (
            <button className="pill known" key={skill} type="button" onClick={() => onFocusNode(`skill-known:${skill}`)}>
              {skill}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-section">
        <p className="panel-section-title">In your memory</p>
        <div className="detail-row"><span>Top match</span><span>{topMatch ? `${topMatch.name}` : '—'}</span></div>
        <div className="detail-row">
          <span>Next deadline</span>
          <span>{nextDeadline ? `${nextDeadline.name} · ${daysUntil(nextDeadline.deadline)}d` : '—'}</span>
        </div>
        <div className="detail-row"><span>Top gap</span><span>{gapSkills[0]?.skill ?? '—'}</span></div>
      </div>

      <div className="panel-section">
        <p className="panel-section-title">Counts</p>
        <div className="stats-grid">
          <div className="stat-box"><strong>{userStack.length}</strong><span>skills</span></div>
          <div className="stat-box"><strong>{gapSkills.length}</strong><span>gaps</span></div>
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
      {node.type === 'startup' && <StartupContent node={node} userStack={userStack} onSave={onSave} />}
      {node.type === 'skill_known' && (
        <SkillKnownContent node={node} startups={startups} hackathons={hackathons} onFocusNode={onFocusNode} />
      )}
      {node.type === 'skill_gap' && (
        <SkillGapContent node={node} userId={userId} userStack={userStack} onLearned={onLearned} />
      )}
      {node.type === 'hackathon' && <HackathonContent node={node} />}
      {node.type === 'user' && (
        <UserContent
          userStack={userStack}
          startups={startups}
          hackathons={hackathons}
          gapSkills={gapSkills}
          onFocusNode={onFocusNode}
        />
      )}
    </aside>
  )
}
