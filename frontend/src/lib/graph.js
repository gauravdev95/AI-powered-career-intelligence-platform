/**
 * Career graph model.
 *
 * This module owns the *shape* of the graph: how the raw API payloads (stack,
 * startups, hackathons, gap report) become nodes and edges, how each node is
 * scored, and which slice of the graph is visible when a node has focus.
 *
 * It lives outside the component tree for two reasons:
 *
 *   1. `App` renders the live graph and the landing page renders a preview of it.
 *      Both must come from the same builder, or the marketing illustration drifts
 *      away from the product.
 *   2. The focus subgraph is pure geometry and set arithmetic. Keeping it out of
 *      the render path makes it testable and keeps `CareerGraph` a view.
 *
 * Visual encoding — every number here is data, not decoration:
 *
 *   node size   ← startup match score · gap priority · hackathon urgency · skill demand
 *   edge width  ← skill-overlap strength between the two endpoints
 *   node colour ← semantic type (blue have · red missing · ochre company · moss event)
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** Used when the profile has no stack yet, so the canvas is never blank. */
const DEFAULT_STACK = ['React', 'Node.js', 'Python']

/** Direct profile→company links. The rest are reachable through skill nodes. */
const PROFILE_TARGET_COMPANIES = 6
const PROFILE_TARGET_EVENTS = 3

/** Nodes rendered per lane in a focused view before the lane is truncated. */
export const MAX_PER_LANE = 7

/**
 * Cap on gap nodes synthesised from requirements the AI report did not rank.
 * They exist so a company's have/missing split is complete; without a cap, a
 * broad dataset would flood the sidebar's gap list.
 */
const MAX_INFERRED_GAPS = 12

/** Which node groups survive each segmented-filter setting. */
export const GROUP_FILTERS = {
  all: new Set(['user', 'skill_known', 'skill_gap', 'skill_learning', 'startup', 'hackathon']),
  skills: new Set(['user', 'skill_known']),
  companies: new Set(['user', 'startup', 'skill_known', 'skill_gap']),
  projects: new Set(['user', 'hackathon', 'skill_known', 'skill_gap']),
  learning: new Set(['user', 'skill_gap', 'skill_learning']),
}

/** Size range per group, in vis-network units. Encodes rank, not category. */
const SIZE_RANGE = {
  user: [30, 30],
  startup: [15, 30],
  hackathon: [13, 26],
  skill_known: [12, 22],
  skill_gap: [12, 22],
  skill_learning: [12, 22],
}

// ── Small helpers ────────────────────────────────────────────────────────────

const clamp01 = value => Math.min(1, Math.max(0, value))

function norm(value) {
  return String(value ?? '').toLowerCase().trim()
}

/**
 * Loose skill equality. The curated dataset and the AI extractor disagree on
 * casing and on prefixes ("React" vs "React.js"), so an exact match under-reports
 * overlap badly enough to change a match score.
 */
export function isSameSkill(a, b) {
  const left = norm(a)
  const right = norm(b)
  if (!left || !right) return false
  return left === right || left.includes(right) || right.includes(left)
}

function cleanId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '-')
}

export function daysUntil(date) {
  if (!date) return null
  return Math.max(0, Math.ceil((new Date(date) - new Date()) / 86400000))
}

/** Hackathon urgency: 1.0 at a week out, 0.0 at two months out. */
export function urgencyOf(hackathon) {
  const days = daysUntil(hackathon?.deadline)
  if (days == null) return 0.35
  return clamp01((60 - days) / 53)
}

export function matchScoreOf(startup) {
  return startup?.analysis?.match_percentage ?? startup?.match_score ?? 0
}

/** Interpolates a group's size range by a normalised 0–1 rank. */
function sizeFor(group, t) {
  const [min, max] = SIZE_RANGE[group] ?? [14, 14]
  return Math.round(min + (max - min) * clamp01(t))
}

/** Edge widths stay inside 1–3.6px so a dense lane never turns into a smear. */
function widthFor(t) {
  return Math.round((1 + clamp01(t) * 2.6) * 100) / 100
}

/** Share of an entity's requirements the developer already covers. */
function overlapRatio(required, known) {
  const list = required ?? []
  if (!list.length) return 0
  return list.filter(item => known.some(skill => isSameSkill(skill, item))).length / list.length
}

// ── Gap inference ────────────────────────────────────────────────────────────

/**
 * Fallback when the AI gap report is unavailable: rank the skills demanded by the
 * best-matching companies that the developer does not have.
 */
export function inferGaps(startups, stack) {
  const counts = new Map()
  startups.slice(0, 8).forEach(startup => {
    ;(startup.skills_required ?? []).forEach(skill => {
      if (stack.some(known => isSameSkill(known, skill))) return
      counts.set(skill, (counts.get(skill) ?? 0) + 1)
    })
  })
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([skill, count]) => ({
      skill,
      why: `Required by ${count} matching companies`,
      time_weeks: count > 2 ? 2 : 1,
      difficulty: 'Beginner friendly',
      resource: `https://www.google.com/search?q=learn+${encodeURIComponent(skill)}`,
      salary_impact: '+10-15%',
    }))
}

// ── Builder ──────────────────────────────────────────────────────────────────

/**
 * Builds the full career graph. Nothing here is filtered for display — the whole
 * model is produced once, and `focusSubgraph` decides what a given view shows.
 */
export function buildGraph({
  userStack = [],
  startups = [],
  hackathons = [],
  gapReport = null,
  learnedSkills = [],
  learningStack = [],
} = {}) {
  const knownSkills = Array.from(new Set([
    ...(userStack.length ? userStack : DEFAULT_STACK),
    ...learnedSkills,
  ]))

  // Demand = how many companies and events ask for a skill. Drives skill node
  // size and the width of the profile→skill edge.
  const requirementSets = [
    ...startups.map(startup => startup.skills_required ?? []),
    ...hackathons.map(hackathon => hackathon.skills_relevant ?? []),
  ]
  const demandOf = skill => requirementSets.filter(set => set.some(item => isSameSkill(item, skill))).length
  const maxDemand = Math.max(1, ...knownSkills.map(demandOf))

  const rawGaps = gapReport?.priority_skills?.length
    ? gapReport.priority_skills
    : inferGaps(startups, knownSkills)
  const reportedGaps = rawGaps.filter(item => !knownSkills.some(skill => isSameSkill(skill, item.skill)))

  // The AI report only ranks the gaps it thinks matter most, but the canvas
  // promises a *complete* have/missing split for whichever company or event you
  // focus. Any requirement that is neither known nor already ranked gets its own
  // node, appended after the ranked ones so the report keeps top priority.
  const unranked = []
  requirementSets.flat().forEach(skill => {
    if (knownSkills.some(known => isSameSkill(known, skill))) return
    if (reportedGaps.some(gap => isSameSkill(gap.skill, skill))) return
    if (unranked.some(gap => isSameSkill(gap.skill, skill))) return
    const count = demandOf(skill)
    unranked.push({
      skill,
      why: `Required by ${count} of your matches`,
      time_weeks: count > 2 ? 3 : 2,
      difficulty: 'Unranked — not in your top gaps',
      resource: `https://www.google.com/search?q=learn+${encodeURIComponent(skill)}`,
      inferred: true,
    })
  })
  unranked.sort((a, b) => demandOf(b.skill) - demandOf(a.skill))

  const gapSkills = [...reportedGaps, ...unranked.slice(0, MAX_INFERRED_GAPS)]

  const nodes = []
  const edges = []
  const nodeDetails = []
  const nodeMap = new Map()
  const nodeById = new Map()

  function addNode(node, detail) {
    nodes.push(node)
    nodeDetails.push(detail)
    nodeMap.set(node.id, detail)
    nodeById.set(node.id, node)
  }

  // ── Profile root ───────────────────────────────────────────────────────────
  addNode({
    id: 'user',
    label: 'You',
    group: 'user',
    size: sizeFor('user', 1),
    title: 'Your Grafted career profile',
  }, {
    id: 'user',
    type: 'user',
    label: 'Your Profile',
    icon: 'user',
    mobileView: 'dashboard',
    raw: { stack: knownSkills },
  })

  // ── Skills you have ────────────────────────────────────────────────────────
  knownSkills.forEach(skill => {
    const id = `skill-known:${skill}`
    const demand = demandOf(skill)
    const rank = demand / maxDemand
    addNode({
      id,
      label: skill,
      group: 'skill_known',
      size: sizeFor('skill_known', rank),
      title: `${skill}<br>In your stack · wanted by ${demand} of ${requirementSets.length}`,
    }, {
      id,
      type: 'skill_known',
      label: skill,
      icon: 'skill',
      mobileView: 'gaps',
      // Sidebar score column: how many orgs ask for it.
      meta: { value: demand, unit: demand === 1 ? ' org' : ' orgs', tone: demand > 0 ? 'blue' : 'muted' },
      sort: demand,
      raw: { skill, demand, totalOrgs: requirementSets.length },
    })
    edges.push({ from: 'user', to: id, width: widthFor(rank), relation: 'has' })
  })

  // ── Skills you are missing ─────────────────────────────────────────────────
  gapSkills.forEach((item, index) => {
    const id = `skill-gap:${item.skill}`
    const demand = demandOf(item.skill)

    // Ranked gaps carry the report's priority; synthesised ones have no ranking
    // to claim, so they are sized and labelled by raw demand instead. Presenting
    // an unranked requirement as "P9" would invent an ordering the AI never gave.
    const priority = item.inferred ? null : index + 1
    const rank = item.inferred
      ? (demand / maxDemand) * 0.5
      : (reportedGaps.length - index) / reportedGaps.length

    addNode({
      id,
      label: item.skill,
      group: 'skill_gap',
      size: sizeFor('skill_gap', rank),
      title: priority
        ? `${item.skill}<br>Priority ${priority} gap`
        : `${item.skill}<br>Required by ${demand} of your matches`,
    }, {
      id,
      type: 'skill_gap',
      label: item.skill,
      icon: 'gap',
      mobileView: 'gaps',
      meta: priority
        ? { value: `P${priority}`, tone: 'danger' }
        : { value: demand, unit: ' req', tone: 'muted' },
      sort: rank,
      raw: { ...item, priority, demand, rankedTotal: reportedGaps.length },
    })
    edges.push({ from: 'user', to: id, dashes: true, width: widthFor(rank), relation: 'needs' })
  })

  // ── Skills being learned (in progress) ─────────────────────────────────────
  // profile.learning_stack: skills the user marked as currently learning. They
  // are neither "known" nor "gaps" — they sit between the two, which is exactly
  // what the Learning tab visualises.
  const learningSkills = Array.from(new Set(learningStack))
    .filter(skill => !knownSkills.some(known => isSameSkill(known, skill)))

  learningSkills.forEach(skill => {
    const id = `skill-learning:${skill}`
    const demand = demandOf(skill)
    const rank = demand / maxDemand
    addNode({
      id,
      label: skill,
      group: 'skill_learning',
      size: sizeFor('skill_known', rank),
      title: `${skill}<br>In progress · wanted by ${demand} of ${requirementSets.length}`,
    }, {
      id,
      type: 'skill_learning',
      label: skill,
      icon: 'learning',
      mobileView: 'gaps',
      meta: { value: 'Learning', tone: 'blue' },
      sort: rank,
      raw: { skill, demand, totalOrgs: requirementSets.length },
    })
    edges.push({ from: 'user', to: id, width: widthFor(rank), relation: 'learning' })
  })

  // ── Companies ──────────────────────────────────────────────────────────────
  const rankedStartups = [...startups].sort((a, b) => matchScoreOf(b) - matchScoreOf(a))

  rankedStartups.forEach((startup, index) => {
    const score = matchScoreOf(startup)
    const id = `startup:${startup.id}`
    const required = startup.skills_required ?? []
    const overlap = overlapRatio(required, knownSkills)

    addNode({
      id,
      label: startup.name,
      group: 'startup',
      size: sizeFor('startup', score / 100),
      title: `${startup.name}<br>${score}% match · ${startup.type}`,
    }, {
      id,
      type: 'startup',
      label: startup.name,
      icon: 'startup',
      score,
      mobileView: 'startups',
      meta: { value: score, unit: '%', tone: toneForScore(score) },
      sort: score,
      raw: { ...startup, overlap },
    })

    // A shortlist of targets hangs directly off the profile so the default view
    // answers "who should I be aiming at" without a second click.
    if (index < PROFILE_TARGET_COMPANIES) {
      edges.push({ from: 'user', to: id, width: widthFor(score / 100), relation: 'targets' })
    }

    knownSkills.forEach(skill => {
      if (required.some(item => isSameSkill(item, skill))) {
        edges.push({ from: `skill-known:${skill}`, to: id, width: widthFor(overlap), relation: 'requires' })
      }
    })
    gapSkills.forEach(gap => {
      if (required.some(item => isSameSkill(item, gap.skill))) {
        edges.push({ from: `skill-gap:${gap.skill}`, to: id, dashes: true, width: widthFor(overlap), relation: 'requires' })
      }
    })
  })

  // ── Hackathons ─────────────────────────────────────────────────────────────
  const rankedHackathons = [...hackathons].sort((a, b) => urgencyOf(b) - urgencyOf(a))

  rankedHackathons.forEach((hackathon, index) => {
    const id = `hackathon:${hackathon.id}`
    const relevant = hackathon.skills_relevant ?? []
    const overlap = overlapRatio(relevant, knownSkills)
    const days = daysUntil(hackathon.deadline)
    const urgency = urgencyOf(hackathon)

    addNode({
      id,
      label: hackathon.name,
      group: 'hackathon',
      size: sizeFor('hackathon', urgency),
      title: `${hackathon.name}<br>${days == null ? 'Date TBD' : `${days} days left`} · ${hackathon.platform}`,
    }, {
      id,
      type: 'hackathon',
      label: hackathon.name,
      icon: 'hackathon',
      score: hackathon.match_score ?? 0,
      mobileView: 'hackathons',
      meta: days == null
        ? { value: '—', tone: 'muted' }
        : { value: days, unit: 'd', tone: days < 14 ? 'danger' : 'moss' },
      sort: urgency,
      raw: {
        ...hackathon,
        days,
        urgency,
        matchedSkills: relevant.filter(skill => knownSkills.some(known => isSameSkill(known, skill))),
        missingSkills: relevant.filter(skill => !knownSkills.some(known => isSameSkill(known, skill))),
      },
    })

    if (index < PROFILE_TARGET_EVENTS) {
      edges.push({ from: 'user', to: id, width: widthFor(urgency), relation: 'shortlisted' })
    }

    relevant.forEach(skill => {
      const known = knownSkills.find(item => isSameSkill(item, skill))
      if (known) edges.push({ from: `skill-known:${known}`, to: id, width: widthFor(overlap), relation: 'requires' })
      const gap = gapSkills.find(item => isSameSkill(item.skill, skill))
      if (gap) edges.push({ from: `skill-gap:${gap.skill}`, to: id, dashes: true, width: widthFor(overlap), relation: 'requires' })
    })
  })

  const deduped = dedupeEdges(edges)

  return {
    nodes,
    edges: deduped,
    nodeDetails,
    nodeMap,
    nodeById,
    adjacency: buildAdjacency(deduped),
    gapSkills,
    knownSkills,
    learningSkills,
    startups: rankedStartups,
    hackathons: rankedHackathons,
  }
}

export function toneForScore(score) {
  if (score >= 80) return 'moss'
  if (score >= 60) return 'blue'
  return 'ochre'
}

function dedupeEdges(edges) {
  const seen = new Set()
  return edges
    .filter(edge => {
      const key = `${edge.from}->${edge.to}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((edge, index) => ({ id: `edge:${index}:${cleanId(edge.from)}:${cleanId(edge.to)}`, ...edge }))
}

/** id → [{ id, edge }]. Undirected: a click on either end reaches the other. */
function buildAdjacency(edges) {
  const map = new Map()
  const push = (from, to, edge) => {
    if (!map.has(from)) map.set(from, [])
    map.get(from).push({ id: to, edge })
  }
  edges.forEach(edge => {
    push(edge.from, edge.to, edge)
    push(edge.to, edge.from, edge)
  })
  return map
}

// ── Focus view ───────────────────────────────────────────────────────────────

const DEG = Math.PI / 180

/**
 * Lane plans, in screen-space degrees (0° = east, angles increase clockwise
 * because vis-network's y axis grows downward).
 *
 * A plan is chosen by the focused node's group and answers one question per
 * focus: what is this node surrounded by, and where does each kind sit?
 */
const LANE_PLANS = {
  // Profile: the four things a career is made of, one per quadrant.
  user: [
    { group: 'skill_known', label: 'Skills you have', arc: [135, 225] },
    { group: 'skill_gap', label: 'Gaps to close', arc: [225, 315] },
    { group: 'startup', label: 'Target companies', arc: [-45, 45] },
    { group: 'hackathon', label: 'Events shortlisted', arc: [45, 135] },
  ],
  // Company / event: the requirement split. Covered on the left, missing on the
  // right — the single most useful read for "am I ready for this".
  startup: [
    { group: 'skill_known', label: 'You have', side: 'left', arc: [105, 255] },
    { group: 'skill_gap', label: 'You are missing', side: 'right', arc: [-75, 75] },
  ],
  hackathon: [
    { group: 'skill_known', label: 'You have', side: 'left', arc: [105, 255] },
    { group: 'skill_gap', label: 'You are missing', side: 'right', arc: [-75, 75] },
  ],
  // Skill: who wants it. Companies east, events west, profile due north.
  skill_known: [
    { group: 'startup', label: 'Companies requiring it', side: 'right', arc: [-70, 70] },
    { group: 'hackathon', label: 'Events using it', side: 'left', arc: [110, 250] },
    { group: 'user', arc: [265, 275] },
  ],
  skill_gap: [
    { group: 'startup', label: 'Companies requiring it', side: 'right', arc: [-70, 70] },
    { group: 'hackathon', label: 'Events using it', side: 'left', arc: [110, 250] },
    { group: 'user', arc: [265, 275] },
  ],
}

/** Lanes sit further out as they get busier, so labels never collide. */
function radiusFor(count) {
  return 200 + Math.max(0, count - 3) * 24
}

/**
 * Spreads nodes across an arc. A single node takes the arc's centre line; two or
 * more are inset from the arc edges so adjacent lanes stay visually separate.
 */
function placeArc(items, [from, to], radius) {
  const span = to - from
  return items.map((item, index) => {
    const t = items.length === 1 ? 0.5 : 0.12 + (0.76 * index) / (items.length - 1)
    const angle = (from + span * t) * DEG
    return {
      ...item,
      x: Math.round(Math.cos(angle) * radius),
      y: Math.round(Math.sin(angle) * radius),
    }
  })
}

/**
 * The visible slice of the graph: the focused node at the origin, its direct
 * neighbours laid out around it, and nothing else. Unrelated nodes are absent
 * from the returned payload — not dimmed — which is what keeps the canvas
 * readable as the dataset grows.
 *
 * Returns `{ nodes, edges, lanes, focus, hidden }`. `lanes` drives the on-canvas
 * captions; `hidden` reports what truncation removed so the UI can say so.
 */
export function focusSubgraph(graph, focusId, filter = 'all') {
  const focus = graph.nodeById.get(focusId)
  if (!focus) return { nodes: [], edges: [], lanes: [], focus: null, hidden: 0 }

  const allowed = GROUP_FILTERS[filter] ?? null
  const plan = LANE_PLANS[focus.group] ?? LANE_PLANS.user

  const neighbours = (graph.adjacency.get(focusId) ?? [])
    .map(link => ({ node: graph.nodeById.get(link.id), edge: link.edge }))
    .filter(entry => entry.node && (!allowed || allowed.has(entry.node.group)))

  const lanes = []
  const placed = []
  const edges = []
  let hidden = 0

  plan.forEach(lane => {
    const members = neighbours
      .filter(entry => entry.node.group === lane.group)
      .sort((a, b) => (b.node.size ?? 0) - (a.node.size ?? 0))

    if (!members.length) return

    const shown = members.slice(0, MAX_PER_LANE)
    hidden += members.length - shown.length

    placeArc(shown, lane.arc, radiusFor(shown.length)).forEach(entry => {
      placed.push({ ...entry.node, x: entry.x, y: entry.y })
      edges.push(entry.edge)
    })

    if (lane.label) {
      lanes.push({
        group: lane.group,
        label: lane.label,
        side: lane.side ?? null,
        shown: shown.length,
        total: members.length,
      })
    }
  })

  return {
    nodes: [{ ...focus, x: 0, y: 0 }, ...placed],
    edges,
    lanes,
    focus,
    hidden,
  }
}

// ── Full radial view ─────────────────────────────────────────────────────────

/**
 * The whole filtered graph at once: the profile at the centre, each surviving
 * group fanned into its own cluster ring around it. Positions are deterministic
 * (cluster angle × member index), so the "All" view always reads the same way;
 * physics stays on for drag/zoom interactivity but starts from this layout.
 *
 * Clusters with more than MAX_CLUSTER_NODES members keep their largest nodes
 * and report the rest as hidden — a 20-company shortlist must not bury the
 * canvas under labels.
 */
const MAX_CLUSTER_NODES = 24

/** Cluster angles in degrees (0° = east, clockwise since y grows downward). */
const CLUSTER_ANGLES = {
  skill_known: -90,
  startup: -18,
  hackathon: 54,
  skill_gap: 126,
  skill_learning: 198,
}

const CLUSTER_ORDER = ['skill_known', 'startup', 'hackathon', 'skill_gap', 'skill_learning']

export function fullGraphView(graph, filter = 'all') {
  const allowed = GROUP_FILTERS[filter] ?? GROUP_FILTERS.all
  const keep = graph.nodes.filter(node => allowed.has(node.group))
  const ids = new Set(keep.map(node => node.id))
  const edges = graph.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to))

  const RADIUS = 360
  const placed = []
  let hidden = 0

  const userNode = keep.find(node => node.group === 'user')
  if (userNode) placed.push({ ...userNode, x: 0, y: 0, fixed: false })

  CLUSTER_ORDER.forEach(group => {
    const members = keep
      .filter(node => node.group === group)
      .sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
    if (!members.length) return

    const shown = members.slice(0, MAX_CLUSTER_NODES)
    hidden += members.length - shown.length

    const angle = (CLUSTER_ANGLES[group] ?? 0) * DEG
    const cx = Math.cos(angle) * RADIUS
    const cy = Math.sin(angle) * RADIUS
    const ring = Math.min(150, 56 + shown.length * 7)

    shown.forEach((node, index) => {
      if (shown.length === 1) {
        placed.push({ ...node, x: cx, y: cy })
        return
      }
      const a = (index / shown.length) * Math.PI * 2 - Math.PI / 2
      placed.push({ ...node, x: cx + Math.cos(a) * ring, y: cy + Math.sin(a) * ring })
    })
  })

  return { nodes: placed, edges, hidden }
}

// ── Landing-page sample ──────────────────────────────────────────────────────

/**
 * A small, honest sample of the real API payloads. The landing illustration is
 * generated from this through `buildGraph`, so the picture on the marketing page
 * is produced by the same code path as the product.
 */
const inDays = days => new Date(Date.now() + days * 86400000).toISOString()

export const SAMPLE_INPUT = {
  userStack: ['React', 'Node.js', 'PostgreSQL'],
  startups: [
    {
      id: 'razorpay',
      name: 'Razorpay',
      type: 'Fintech',
      match_score: 86,
      skills_required: ['React', 'Node.js', 'PostgreSQL', 'TypeScript'],
    },
    {
      id: 'zepto',
      name: 'Zepto',
      type: 'Consumer',
      match_score: 71,
      skills_required: ['React', 'Node.js', 'Kafka'],
    },
    {
      id: 'groww',
      name: 'Groww',
      type: 'Fintech',
      match_score: 64,
      skills_required: ['React', 'PostgreSQL', 'Go'],
    },
  ],
  hackathons: [
    {
      id: 'ethindia',
      name: 'ETHIndia',
      platform: 'Devfolio',
      match_score: 68,
      deadline: inDays(9),
      skills_relevant: ['React', 'Solidity'],
    },
    {
      id: 'smartindia',
      name: 'SIH',
      platform: 'MoE',
      match_score: 55,
      deadline: inDays(38),
      skills_relevant: ['Node.js', 'PostgreSQL'],
    },
  ],
  gapReport: {
    priority_skills: [
      { skill: 'TypeScript', why: 'Required by 3 of your top matches', time_weeks: 2 },
      { skill: 'Kafka', why: 'Standard at consumer scale', time_weeks: 3 },
      { skill: 'Go', why: 'Common in fintech backends', time_weeks: 4 },
    ],
  },
}
