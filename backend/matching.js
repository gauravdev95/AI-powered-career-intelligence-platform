/**
 * Deterministic matching over the curated datasets.
 *
 * Replaces the old analyzer.js, which was dead code that read fields the JSON never
 * had (`startup.stack`, `hackathon.skills`, `hackathon.date` instead of
 * `skills_required`, `skills_relevant`, `deadline`).
 *
 * This layer is intentionally not AI: matching a skill list against a requirements
 * list is arithmetic, and making it deterministic means results are stable, instant,
 * free, and identical whether or not an API key is configured. AI is applied where it
 * adds something arithmetic cannot — extraction, wiki generation, chat, roadmaps.
 *
 * The old response field `claude_analysis` was misleading on two counts: it was never
 * produced by Claude, and it was never produced by any model. It is now `analysis`.
 */

/** Skill-name comparison tolerant of the variations real data contains. */
export function skillsMatch(a, b) {
  const left = String(a ?? '').toLowerCase().trim()
  const right = String(b ?? '').toLowerCase().trim()
  if (!left || !right) return false
  if (left === right) return true
  // "node" ↔ "node.js", "react" ↔ "react.js". Guard the length so "r" does not
  // match "react" and "go" does not match "django".
  const shorter = left.length <= right.length ? left : right
  const longer = left.length <= right.length ? right : left
  return shorter.length >= 3 && longer.includes(shorter)
}

function normaliseStack(stack) {
  return [...new Set((stack ?? []).map(skill => String(skill).toLowerCase().trim()).filter(Boolean))]
}

/** Percentage of a company's required skills the developer already has. */
export function matchScore(userStack, requiredSkills) {
  const required = requiredSkills ?? []
  if (required.length === 0) return 0
  const stack = normaliseStack(userStack)
  const matched = required.filter(skill => stack.some(known => skillsMatch(known, skill)))
  return Math.round((matched.length / required.length) * 100)
}

/**
 * Detailed fit assessment for one company.
 * `nice_to_have` skills count toward the narrative but never toward the score, which
 * stays defined purely by hard requirements.
 */
export function analyzeFit(userStack, startup) {
  const stack = normaliseStack(userStack)
  const required = startup.skills_required ?? []
  const matching = required.filter(skill => stack.some(known => skillsMatch(known, skill)))
  const missing = required.filter(skill => !matching.includes(skill))
  const bonus = (startup.nice_to_have ?? []).filter(skill => stack.some(known => skillsMatch(known, skill)))
  const percentage = matchScore(userStack, required)

  let assessment
  if (percentage >= 80) assessment = `Strong fit — you already cover ${matching.length} of ${required.length} required skills.`
  else if (percentage >= 50) assessment = `Realistic target — you cover ${matching.length} of ${required.length} requirements, with ${missing.length} to close.`
  else if (percentage > 0) assessment = `Stretch role — ${missing.length} of ${required.length} required skills are still missing.`
  else assessment = 'No overlap with your current stack yet.'

  if (bonus.length) assessment += ` You also bring ${bonus.join(', ')} from their nice-to-have list.`

  return {
    match_percentage: percentage,
    matching_skills: matching.slice(0, 6),
    missing_skills: missing.slice(0, 6),
    bonus_skills: bonus.slice(0, 4),
    assessment,
    recommended_action: missing[0]
      ? `Learn ${missing[0]} next — it is the highest-leverage gap for ${startup.name}.`
      : `Prepare for their interview topics: ${(startup.interview_topics ?? ['fundamentals']).slice(0, 3).join(', ')}.`,
  }
}

/**
 * Scores and ranks every startup for a developer.
 * Companies the developer named as targets get a bounded boost so their own stated
 * intent outranks a marginally better arithmetic match elsewhere.
 */
export function rankStartups(userStack, startups, { targetCompanies = [], targetBoost = 20 } = {}) {
  const targets = targetCompanies.map(name => String(name).toLowerCase().trim()).filter(Boolean)

  return startups
    .map(startup => {
      const base = matchScore(userStack, startup.skills_required)
      const name = startup.name.toLowerCase()
      const isTarget = targets.some(target => name.includes(target) || target.includes(name))
      return {
        ...startup,
        match_score: isTarget ? Math.min(100, base + targetBoost) : base,
        base_score: base,
        is_target: isTarget,
      }
    })
    .sort((a, b) => b.match_score - a.match_score || a.name.localeCompare(b.name))
}

/**
 * Ranks hackathons by how much of their relevant-skill list the developer covers.
 * Past-deadline events are dropped, and urgency is surfaced for the UI badge.
 */
export function rankHackathons(userStack, hackathons, { now = new Date() } = {}) {
  const stack = normaliseStack(userStack)

  return hackathons
    .map(hackathon => {
      const relevant = hackathon.skills_relevant ?? []
      const matched = relevant.filter(skill => stack.some(known => skillsMatch(known, skill)))
      const daysLeft = hackathon.deadline
        ? Math.ceil((new Date(hackathon.deadline).getTime() - now.getTime()) / 86400000)
        : null

      return {
        ...hackathon,
        match_score: relevant.length ? Math.round((matched.length / relevant.length) * 100) : 0,
        matched_skills: matched,
        days_left: daysLeft,
        urgency: daysLeft == null ? 'unknown' : daysLeft <= 7 ? 'high' : daysLeft <= 14 ? 'medium' : 'low',
      }
    })
    .filter(hackathon => hackathon.days_left == null || hackathon.days_left > 0)
    .sort((a, b) => b.match_score - a.match_score || (a.days_left ?? 9999) - (b.days_left ?? 9999))
}

/**
 * Identifies the highest-leverage missing skills across a set of target companies.
 * Demand is how many targets want the skill; the curated skills dataset supplies
 * learning time and salary impact where we have it.
 */
export function buildGapReport(userStack, targets, skillsCatalog = []) {
  const stack = normaliseStack(userStack)
  const catalog = new Map(skillsCatalog.map(skill => [skill.name.toLowerCase(), skill]))
  const demand = new Map()

  for (const target of targets) {
    for (const skill of target.skills_required ?? []) {
      if (stack.some(known => skillsMatch(known, skill))) continue
      const entry = demand.get(skill) ?? { skill, count: 0, companies: [] }
      entry.count += 1
      entry.companies.push(target.name)
      demand.set(skill, entry)
    }
  }

  const priority = [...demand.values()]
    .sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill))
    .slice(0, 6)
    .map(entry => {
      const meta = catalog.get(entry.skill.toLowerCase())
      return {
        skill: entry.skill,
        reason: `Required by ${entry.count} of your ${targets.length} target companies (${entry.companies.slice(0, 3).join(', ')})`,
        weeks_to_learn: meta?.learning_time_weeks ?? 3,
        difficulty: meta?.difficulty ?? 'Intermediate',
        salary_impact: meta?.salary_premium_percent ? `+${meta.salary_premium_percent}%` : '+10-15%',
        demand_score: meta?.demand_score ?? null,
        resource: meta?.resource_url ?? `https://www.google.com/search?q=learn+${encodeURIComponent(entry.skill)}`,
        companies: entry.companies.slice(0, 5),
      }
    })

  const strengths = stack.slice(0, 3)

  return {
    summary: strengths.length
      ? `Your stack is strongest in ${strengths.join(', ')}. ${priority.length ? `The biggest gap for your targets is ${priority[0].skill}.` : 'You already cover your targets\' core requirements.'}`
      : 'Add a few skills to your profile to get a meaningful gap analysis.',
    priority_skills: priority,
    recommendations: priority.length
      ? [
        `Start with ${priority[0].skill} — ${priority[0].reason.toLowerCase()}.`,
        `Budget roughly ${priority[0].weeks_to_learn} weeks and build one project with it.`,
      ]
      : ['Keep sharpening your current stack and ship a portfolio project.'],
  }
}

export default { skillsMatch, matchScore, analyzeFit, rankStartups, rankHackathons, buildGapReport }
