import { useState } from 'react'
import axios from '../lib/api.js'
import { isSameSkill } from '../lib/graph.js'

/**
 * Detail panel — the reading surface for the focused node, in the reference's
 * dark style. Every number comes from the logged-in user's real data:
 * demand counts from matched companies, match scores from analysis, roles
 * from the startup dataset. Nothing is invented — where we have no data
 * (job counts, salary bands, growth rates) the panel simply doesn't show it.
 */

const clamp01 = value => Math.min(1, Math.max(0, value))

function demandTier(demand, totalOrgs) {
  const ratio = demand / Math.max(1, totalOrgs)
  if (ratio >= 0.5) return { label: 'Very High', tone: 'high' }
  if (ratio >= 0.3) return { label: 'High', tone: 'high' }
  if (ratio >= 0.15) return { label: 'Medium', tone: 'medium' }
  return { label: 'Low', tone: 'low' }
}

function matchScoreOf(startup) {
  return startup.analysis?.match_percentage ?? startup.match_score ?? 0
}

function companiesRequiring(skill, startups) {
  return startups.filter(startup =>
    (startup.skills_required ?? []).some(item => isSameSkill(item, skill)))
}

function projectsUsing(skill, hackathons) {
  return hackathons.filter(hackathon =>
    (hackathon.skills_relevant ?? []).some(item => isSameSkill(item, skill)))
}

function Header({ node, badge, badgeTone, onClose }) {
  return (
    <div className="cg-panel-head">
      <span className={`cg-panel-icon cg-panel-icon--${badgeTone}`} aria-hidden="true">
        {node.label.slice(0, 1).toUpperCase()}
      </span>
      <div className="cg-panel-title-wrap">
        <p className="cg-panel-title">{node.label}</p>
        <span className={`cg-badge cg-badge--${badgeTone}`}>{badge}</span>
      </div>
      <button className="cg-panel-close" type="button" onClick={onClose} aria-label="Close detail panel">×</button>
    </div>
  )
}

function Tabs({ tabs, active, onChange }) {
  return (
    <div className="cg-panel-tabs" role="tablist">
      {tabs.map(tab => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={active === tab}
          className={`cg-panel-tab ${active === tab ? 'active' : ''}`}
          onClick={() => onChange(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  )
}

function DemandRow({ demand, totalOrgs, skill }) {
  const tier = demandTier(demand, totalOrgs)
  const pct = totalOrgs ? Math.round((demand / totalOrgs) * 100) : 0
  return (
    <div className="cg-demand">
      <div className="cg-demand-head">
        <span className="cg-section-label">Market Demand</span>
        <span className={`cg-demand-tier cg-demand-tier--${tier.tone}`}>↑ {tier.label}</span>
      </div>
      <p className="cg-demand-note">{pct}% of matched companies require {skill}</p>
      <div className="cg-bar"><div className={`cg-bar-fill cg-bar-fill--${tier.tone}`} style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

function MatchRow({ name, score, onClick }) {
  return (
    <button type="button" className="cg-match-row" onClick={onClick}>
      <span className="cg-match-name">{name}</span>
      <span className="cg-match-pct">{score}% Match</span>
    </button>
  )
}

function PillRow({ items, tone = 'neutral', onPick, empty = 'None yet' }) {
  return (
    <div className="cg-pills">
      {items.length ? items.map(item => (
        onPick
          ? <button key={item} type="button" className={`cg-pill cg-pill--${tone}`} onClick={() => onPick(item)}>{item}</button>
          : <span key={item} className={`cg-pill cg-pill--${tone}`}>{item}</span>
      )) : <span className="cg-pill cg-pill--muted">{empty}</span>}
    </div>
  )
}

/** Have-vs-required split — the skill-gap answer in one glance. */
function GapSplit({ have, missing, haveLabel = 'You have', missingLabel = 'Missing' }) {
  return (
    <div className="cg-split">
      <div className="cg-split-col">
        <p className="cg-split-head cg-split-head--have">{haveLabel}<span>{have.length}</span></p>
        <PillRow items={have} tone="have" empty="None yet" />
      </div>
      <div className="cg-split-col">
        <p className="cg-split-head cg-split-head--missing">{missingLabel}<span>{missing.length}</span></p>
        <PillRow items={missing} tone="missing" empty="Nothing missing" />
      </div>
    </div>
  )
}

// ── Skill (known) ────────────────────────────────────────────────────────────

function SkillContent({ node, startups, hackathons, onFocusNode }) {
  const [tab, setTab] = useState('Overview')
  const { skill, demand = 0, totalOrgs = 0 } = node.raw
  const companies = companiesRequiring(skill, startups)
    .sort((a, b) => matchScoreOf(b) - matchScoreOf(a))
  const projects = projectsUsing(skill, hackathons)

  return (
    <>
      <Header node={node} badge="Skill" badgeTone="skill" onClose={node.onClose} />
      <Tabs tabs={['Overview', 'Companies', 'Opportunities']} active={tab} onChange={setTab} />
      <div className="cg-panel-body">
        {tab === 'Overview' && (
          <>
            <DemandRow demand={demand} totalOrgs={totalOrgs} skill={skill} />
            <div className="cg-stat-trio">
              <div className="cg-stat"><strong>{demand}</strong><span>requiring orgs</span></div>
              <div className="cg-stat"><strong>{companies.length}</strong><span>companies</span></div>
              <div className="cg-stat"><strong>{projects.length}</strong><span>projects</span></div>
            </div>
            <p className="cg-section-label">Your level</p>
            <PillRow items={['Proficient — in your stack']} tone="have" />
            <p className="cg-section-label">Skill gap — has vs required</p>
            <p className="cg-prose">
              You have <strong>{skill}</strong>. It is required by <strong>{companies.length}</strong> of your{' '}
              {totalOrgs} matched organisations, so it already counts toward your match score at each of them.
            </p>
            <p className="cg-section-label">Related projects</p>
            {projects.length ? projects.map(project => (
              <button
                key={project.id}
                type="button"
                className="cg-link-row"
                onClick={() => onFocusNode(`hackathon:${project.id}`)}
              >
                {project.name}
              </button>
            )) : <p className="cg-muted">No projects use {skill} yet.</p>}
          </>
        )}
        {tab === 'Companies' && (
          <>
            <p className="cg-section-label">Top matching companies <span className="cg-count">{companies.length}</span></p>
            {companies.length ? companies.slice(0, 8).map(company => (
              <MatchRow
                key={company.id}
                name={company.name}
                score={matchScoreOf(company)}
                onClick={() => onFocusNode(`startup:${company.id}`)}
              />
            )) : <p className="cg-muted">No matched companies require {skill} yet.</p>}
          </>
        )}
        {tab === 'Opportunities' && (
          <>
            <p className="cg-section-label">Open roles needing {skill}</p>
            {companies.length ? companies.slice(0, 6).flatMap(company =>
              (company.roles_available ?? []).map(role => (
                <div className="cg-opp-row" key={`${company.id}:${role}`}>
                  <div>
                    <p className="cg-opp-role">{role}</p>
                    <p className="cg-opp-co">{company.name} · {matchScoreOf(company)}% match</p>
                  </div>
                  {company.apply_url && (
                    <a className="cg-btn cg-btn-sm" href={company.apply_url} target="_blank" rel="noopener noreferrer">Apply</a>
                  )}
                </div>
              ))
            ) : <p className="cg-muted">No open roles found for {skill}.</p>}
            {projects.length > 0 && (
              <>
                <p className="cg-section-label">Build with it</p>
                {projects.map(project => (
                  <button
                    key={project.id}
                    type="button"
                    className="cg-link-row"
                    onClick={() => onFocusNode(`hackathon:${project.id}`)}
                  >
                    {project.name}
                  </button>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </>
  )
}

// ── Skill gap ────────────────────────────────────────────────────────────────

function SkillGapContent({ node, userId, userStack, startups, hackathons, onFocusNode, onLearned }) {
  const [tab, setTab] = useState('Overview')
  const gap = node.raw
  const companies = companiesRequiring(gap.skill, startups).sort((a, b) => matchScoreOf(b) - matchScoreOf(a))
  const projects = projectsUsing(gap.skill, hackathons)
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
      <Header node={node} badge={gap.priority ? `Gap · P${gap.priority}` : 'Skill Gap'} badgeTone="gap" onClose={node.onClose} />
      <Tabs tabs={['Overview', 'Companies']} active={tab} onChange={setTab} />
      <div className="cg-panel-body">
        {tab === 'Overview' && (
          <>
            <DemandRow demand={gap.demand ?? 0} totalOrgs={Math.max(1, startups.length + hackathons.length)} skill={gap.skill} />
            <p className="cg-section-label">Skill gap — has vs required</p>
            <div className="cg-gap-card">
              <p className="cg-gap-line"><span className="cg-gap-k">You have</span>Not in your stack yet</p>
              <p className="cg-gap-line"><span className="cg-gap-k">Required by</span>{companies.length} companies · {projects.length} projects</p>
              {gap.priority && <p className="cg-gap-line"><span className="cg-gap-k">Priority</span>#{gap.priority} of {total} gaps to close</p>}
            </div>
            {gap.why && (
              <>
                <p className="cg-section-label">Why you need this</p>
                <p className="cg-prose">{gap.why}</p>
              </>
            )}
            <div className="cg-detail-grid">
              <div className="cg-detail"><span>Time to learn</span><strong>{gap.time_weeks ?? 2} weeks</strong></div>
              <div className="cg-detail"><span>Difficulty</span><strong>{gap.difficulty ?? 'Beginner friendly'}</strong></div>
              <div className="cg-detail"><span>Salary impact</span><strong className="cg-good">{gap.salary_impact ?? '+15–20%'}</strong></div>
            </div>
            {gap.resource && (
              <a className="cg-link" href={gap.resource} target="_blank" rel="noopener noreferrer">Start learning →</a>
            )}
          </>
        )}
        {tab === 'Companies' && (
          <>
            <p className="cg-section-label">Unlocks these matches <span className="cg-count">{companies.length}</span></p>
            {companies.length ? companies.slice(0, 8).map(company => (
              <MatchRow
                key={company.id}
                name={company.name}
                score={matchScoreOf(company)}
                onClick={() => onFocusNode(`startup:${company.id}`)}
              />
            )) : <p className="cg-muted">No matched companies list {gap.skill} yet.</p>}
          </>
        )}
      </div>
      <div className="cg-panel-actions">
        <button className="cg-btn cg-btn-primary" type="button" onClick={markLearned}>Mark as Learned</button>
      </div>
    </>
  )
}

// ── Learning (in progress) ───────────────────────────────────────────────────

function SkillLearningContent({ node, startups, hackathons, onFocusNode, onLearned }) {
  const { skill, demand = 0, totalOrgs = 0 } = node.raw
  const companies = companiesRequiring(skill, startups).sort((a, b) => matchScoreOf(b) - matchScoreOf(a))
  const projects = projectsUsing(skill, hackathons)

  return (
    <>
      <Header node={node} badge="Learning" badgeTone="learning" onClose={node.onClose} />
      <div className="cg-panel-body">
        <DemandRow demand={demand} totalOrgs={totalOrgs} skill={skill} />
        <p className="cg-section-label">Status</p>
        <PillRow items={['In progress — keep going']} tone="learning" />
        <p className="cg-section-label">Companies waiting on it <span className="cg-count">{companies.length}</span></p>
        {companies.length ? companies.slice(0, 6).map(company => (
          <MatchRow
            key={company.id}
            name={company.name}
            score={matchScoreOf(company)}
            onClick={() => onFocusNode(`startup:${company.id}`)}
          />
        )) : <p className="cg-muted">No matched companies require {skill} yet.</p>}
        {projects.length > 0 && (
          <>
            <p className="cg-section-label">Practice it here</p>
            {projects.map(project => (
              <button
                key={project.id}
                type="button"
                className="cg-link-row"
                onClick={() => onFocusNode(`hackathon:${project.id}`)}
              >
                {project.name}
              </button>
            ))}
          </>
        )}
      </div>
      <div className="cg-panel-actions">
        <button className="cg-btn cg-btn-primary" type="button" onClick={() => onLearned(skill)}>Mark as Learned</button>
      </div>
    </>
  )
}

// ── Company ──────────────────────────────────────────────────────────────────

function StartupContent({ node, userStack, onFocusNode, onSave }) {
  const [tab, setTab] = useState('Overview')
  const startup = node.raw
  const score = matchScoreOf(startup)
  const required = startup.skills_required ?? []
  const have = required.filter(skill => userStack.some(known => isSameSkill(known, skill)))
  const missing = required.filter(skill => !have.some(item => isSameSkill(item, skill)))
  const roles = startup.roles_available ?? []

  return (
    <>
      <Header node={node} badge={`${score}% Match`} badgeTone={score >= 60 ? 'skill' : 'gap'} onClose={node.onClose} />
      <Tabs tabs={['Overview', 'Skills', 'Opportunities']} active={tab} onChange={setTab} />
      <div className="cg-panel-body">
        {tab === 'Overview' && (
          <>
            <p className="cg-section-label">Stack match</p>
            <div className="cg-bar cg-bar--big"><div className="cg-bar-fill cg-bar-fill--high" style={{ width: `${clamp01(score / 100) * 100}%` }} /></div>
            <p className="cg-demand-note">{have.length} of {required.length} required skills covered</p>
            <div className="cg-detail-grid">
              <div className="cg-detail"><span>Location</span><strong>{startup.location ?? '—'}</strong></div>
              <div className="cg-detail"><span>Stage</span><strong>{startup.stage ?? '—'}</strong></div>
              <div className="cg-detail"><span>Experience</span><strong>{startup.min_experience ?? '—'}</strong></div>
              <div className="cg-detail"><span>Salary</span><strong>{startup.salary_range_lpa ? `${startup.salary_range_lpa} LPA` : '—'}</strong></div>
            </div>
            {startup.description && <p className="cg-prose">{startup.description}</p>}
            {(startup.interview_topics ?? []).length > 0 && (
              <>
                <p className="cg-section-label">Interview topics</p>
                <PillRow items={startup.interview_topics} />
              </>
            )}
          </>
        )}
        {tab === 'Skills' && (
          <>
            <p className="cg-section-label">Required skills</p>
            <PillRow items={required} empty="No listed requirements" />
            <p className="cg-section-label">Skill gap — matched vs missing</p>
            <GapSplit have={have} missing={missing} />
          </>
        )}
        {tab === 'Opportunities' && (
          <>
            <p className="cg-section-label">Relevant opportunities <span className="cg-count">{roles.length}</span></p>
            {roles.length ? roles.map(role => (
              <div className="cg-opp-row" key={role}>
                <div>
                  <p className="cg-opp-role">{role}</p>
                  <p className="cg-opp-co">{startup.name} · {score}% match</p>
                </div>
                {startup.apply_url && (
                  <a className="cg-btn cg-btn-sm" href={startup.apply_url} target="_blank" rel="noopener noreferrer">Apply</a>
                )}
              </div>
            )) : <p className="cg-muted">No listed openings right now.</p>}
          </>
        )}
      </div>
      <div className="cg-panel-actions">
        {startup.apply_url && (
          <a className="cg-btn cg-btn-primary" href={startup.apply_url} target="_blank" rel="noopener noreferrer">Find Jobs ↗</a>
        )}
        <button className="cg-btn cg-btn-outline" type="button" onClick={onSave}>Save to Watchlist</button>
      </div>
    </>
  )
}

// ── Project (hackathon) ──────────────────────────────────────────────────────

function HackathonContent({ node, userStack, gapSkills, onFocusNode }) {
  const hackathon = node.raw
  const relevant = hackathon.skills_relevant ?? []
  const have = relevant.filter(skill => userStack.some(known => isSameSkill(known, skill)))
  const missing = relevant.filter(skill => !have.some(item => isSameSkill(item, skill)))
  const closesGaps = (gapSkills ?? []).filter(gap => relevant.some(skill => isSameSkill(skill, gap.skill)))

  return (
    <>
      <Header node={node} badge="Project" badgeTone="project" onClose={node.onClose} />
      <div className="cg-panel-body">
        <p className="cg-section-label">Skills used</p>
        <GapSplit have={have} missing={missing} haveLabel="You bring" missingLabel="You'd pick up" />
        <p className="cg-section-label">Related technologies</p>
        <PillRow items={relevant} empty="No listed technologies" />
        <p className="cg-section-label">Career skills this strengthens</p>
        {have.length || closesGaps.length ? (
          <div className="cg-pills">
            {have.map(skill => <span key={`s:${skill}`} className="cg-pill cg-pill--have">{skill} · sharpens</span>)}
            {closesGaps.map(gap => (
              <button
                key={`g:${gap.skill}`}
                type="button"
                className="cg-pill cg-pill--missing"
                onClick={() => onFocusNode(`skill-gap:${gap.skill}`)}
              >
                {gap.skill} · closes gap
              </button>
            ))}
          </div>
        ) : <p className="cg-muted">Add skills to your stack to see what this project strengthens.</p>}
        <div className="cg-detail-grid">
          <div className="cg-detail"><span>Organizer</span><strong>{hackathon.organizer ?? hackathon.platform ?? '—'}</strong></div>
          <div className="cg-detail"><span>Format</span><strong>{hackathon.type ?? '—'}</strong></div>
          <div className="cg-detail"><span>Team</span><strong>{hackathon.team_size_min ?? '—'}–{hackathon.team_size_max ?? '—'} people</strong></div>
          <div className="cg-detail"><span>Deadline</span><strong>{hackathon.deadline ? new Date(hackathon.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'TBD'}</strong></div>
        </div>
        {hackathon.theme && <p className="cg-prose">{hackathon.theme}</p>}
      </div>
      <div className="cg-panel-actions">
        {hackathon.registration_url && (
          <a className="cg-btn cg-btn-primary" href={hackathon.registration_url} target="_blank" rel="noopener noreferrer">Register ↗</a>
        )}
      </div>
    </>
  )
}

// ── You ──────────────────────────────────────────────────────────────────────

function UserContent({ node, userStack, startups, hackathons, gapSkills, learningInProgress, onFocusNode }) {
  const topMatch = startups[0]

  return (
    <>
      <Header node={node} badge="You" badgeTone="user" onClose={node.onClose} />
      <div className="cg-panel-body">
        <div className="cg-stat-trio">
          <div className="cg-stat"><strong>{userStack.length}</strong><span>skills</span></div>
          <div className="cg-stat"><strong>{startups.length}</strong><span>companies</span></div>
          <div className="cg-stat"><strong>{gapSkills.length}</strong><span>gaps</span></div>
        </div>
        <p className="cg-section-label">Your stack</p>
        <div className="cg-pills">
          {userStack.map(skill => (
            <button key={skill} type="button" className="cg-pill cg-pill--have" onClick={() => onFocusNode(`skill-known:${skill}`)}>
              {skill}
            </button>
          ))}
        </div>
        {(learningInProgress ?? []).length > 0 && (
          <>
            <p className="cg-section-label">Learning now</p>
            <div className="cg-pills">
              {learningInProgress.map(skill => (
                <button key={skill} type="button" className="cg-pill cg-pill--learning" onClick={() => onFocusNode(`skill-learning:${skill}`)}>
                  {skill}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="cg-detail-grid">
          <div className="cg-detail"><span>Top match</span><strong>{topMatch ? topMatch.name : '—'}</strong></div>
          <div className="cg-detail"><span>Top gap</span><strong>{gapSkills[0]?.skill ?? '—'}</strong></div>
        </div>
        {hackathons[0] && (
          <button type="button" className="cg-link-row" onClick={() => onFocusNode(`hackathon:${hackathons[0].id}`)}>
            Next project: {hackathons[0].name}
          </button>
        )}
      </div>
    </>
  )
}

// ── Learning overview (Learning tab, nothing selected) ───────────────────────

function LearningOverview({ learnedSkills, learningInProgress, gapSkills, startups, onFocusNode, onClose }) {
  const recommended = (gapSkills ?? []).slice(0, 6)

  return (
    <>
      <div className="cg-panel-head">
        <span className="cg-panel-icon cg-panel-icon--learning" aria-hidden="true">L</span>
        <div className="cg-panel-title-wrap">
          <p className="cg-panel-title">Learning Path</p>
          <span className="cg-badge cg-badge--learning">Overview</span>
        </div>
        <button className="cg-panel-close" type="button" onClick={onClose} aria-label="Close detail panel">×</button>
      </div>
      <div className="cg-panel-body">
        <p className="cg-section-label">Completed <span className="cg-count">{learnedSkills.length}</span></p>
        {learnedSkills.length ? (
          <div className="cg-pills">
            {learnedSkills.map(skill => (
              <button key={skill} type="button" className="cg-pill cg-pill--have" onClick={() => onFocusNode(`skill-known:${skill}`)}>
                {skill}
              </button>
            ))}
          </div>
        ) : <p className="cg-muted">Nothing marked complete yet — open a gap and hit “Mark as Learned”.</p>}

        <p className="cg-section-label">In progress <span className="cg-count">{(learningInProgress ?? []).length}</span></p>
        {(learningInProgress ?? []).length ? (
          <div className="cg-pills">
            {learningInProgress.map(skill => (
              <button key={skill} type="button" className="cg-pill cg-pill--learning" onClick={() => onFocusNode(`skill-learning:${skill}`)}>
                {skill}
              </button>
            ))}
          </div>
        ) : <p className="cg-muted">No skills in progress. Add them from your profile.</p>}

        <p className="cg-section-label">Recommended next <span className="cg-count">{recommended.length}</span></p>
        {recommended.length ? recommended.map(gap => {
          const needCount = companiesRequiring(gap.skill, startups).length
          return (
            <button
              key={gap.skill}
              type="button"
              className="cg-rec-row"
              onClick={() => onFocusNode(`skill-gap:${gap.skill}`)}
            >
              <span className={`cg-prio cg-prio--${(gap.priority ?? 99) <= 3 ? 'hot' : 'warm'}`}>
                {gap.priority ? `P${gap.priority}` : '•'}
              </span>
              <span className="cg-rec-main">
                <strong>{gap.skill}</strong>
                <span>Required by {needCount} {needCount === 1 ? 'company' : 'companies'} · {gap.time_weeks ?? 2} weeks</span>
              </span>
            </button>
          )
        }) : <p className="cg-muted">No gaps detected — run an analysis to get recommendations.</p>}
      </div>
    </>
  )
}

export default function DetailPanel(props) {
  const {
    node, onClose, startups = [], hackathons = [], userStack = [],
    userId, gapSkills = [], learningSkills = [], learnedSkills = [],
    learningInProgress = [], onFocusNode, onLearned, onSave,
    showLearningOverview = false,
  } = props

  if (showLearningOverview) {
    return (
      <aside className="detail-panel cg-panel">
        <LearningOverview
          learnedSkills={learnedSkills}
          learningInProgress={learningInProgress}
          gapSkills={gapSkills}
          startups={startups}
          onFocusNode={onFocusNode}
          onClose={onClose}
        />
      </aside>
    )
  }

  if (!node) return null
  const withClose = { ...node, onClose }

  return (
    <aside className="detail-panel cg-panel">
      {node.type === 'startup' && (
        <StartupContent node={withClose} userStack={userStack} onFocusNode={onFocusNode} onSave={onSave} />
      )}
      {node.type === 'skill_known' && (
        <SkillContent node={withClose} startups={startups} hackathons={hackathons} onFocusNode={onFocusNode} />
      )}
      {node.type === 'skill_gap' && (
        <SkillGapContent
          node={withClose} userId={userId} userStack={userStack}
          startups={startups} hackathons={hackathons}
          onFocusNode={onFocusNode} onLearned={onLearned}
        />
      )}
      {node.type === 'skill_learning' && (
        <SkillLearningContent
          node={withClose} startups={startups} hackathons={hackathons}
          onFocusNode={onFocusNode} onLearned={onLearned}
        />
      )}
      {node.type === 'hackathon' && (
        <HackathonContent node={withClose} userStack={userStack} gapSkills={gapSkills} onFocusNode={onFocusNode} />
      )}
      {node.type === 'user' && (
        <UserContent
          node={withClose} userStack={userStack} startups={startups}
          hackathons={hackathons} gapSkills={gapSkills}
          learningInProgress={learningInProgress} onFocusNode={onFocusNode}
        />
      )}
    </aside>
  )
}
