/**
 * MemoryGraph — the relationship layer.
 *
 * Two responsibilities:
 *
 *   1. Turn `[[type/name]]` wikilinks inside generated pages into real, queryable
 *      edges between memories. The original implementation re-parsed wikilinks on
 *      every render and produced throwaway nodes; here a link becomes a durable
 *      LINKS_TO row, and a link to something not yet known creates a stub memory so
 *      the edge has a real endpoint that later ingests can enrich.
 *
 *   2. Project the memory graph into the node/edge payload vis-network already
 *      renders, so /api/graph-data/:userId finally reflects stored knowledge.
 */

import { slugify } from '../lib/validate.js'
import * as store from './MemoryStore.js'
import { MEMORY_TYPES, MEMORY_SOURCES, RELATIONS } from './types.js'

const WIKILINK_RE = /\[\[([^\]]{1,120})\]\]/g

/** Maps a wikilink's `type` segment onto a memory type. */
const LINK_TYPE_TO_MEMORY = {
  company: MEMORY_TYPES.COMPANY,
  startup: MEMORY_TYPES.COMPANY,
  skill: MEMORY_TYPES.SKILL,
  gap: MEMORY_TYPES.SKILL_GAP,
  hackathon: MEMORY_TYPES.HACKATHON,
  job: MEMORY_TYPES.JOB,
  goal: MEMORY_TYPES.GOAL,
  wiki: MEMORY_TYPES.WIKI,
}

/** Presentation grouping for vis-network, reusing the frontend's existing groups. */
const TYPE_TO_GROUP = {
  [MEMORY_TYPES.PROFILE]: 'user',
  [MEMORY_TYPES.SKILL]: 'skill_known',
  [MEMORY_TYPES.SKILL_GAP]: 'skill_gap',
  [MEMORY_TYPES.COMPANY]: 'startup',
  [MEMORY_TYPES.TARGET_COMPANY]: 'startup',
  [MEMORY_TYPES.JOB]: 'startup',
  [MEMORY_TYPES.HACKATHON]: 'hackathon',
  [MEMORY_TYPES.WIKI]: 'wiki',
  [MEMORY_TYPES.GOAL]: 'goal',
  [MEMORY_TYPES.PREFERENCE]: 'note',
  [MEMORY_TYPES.ROADMAP]: 'note',
}

const GROUP_COLORS = {
  // Blueprint Ledger palette. Kept in sync with the --node-* CSS variables in
  // frontend/src/styles/blueprint-tokens.css; the frontend reads its own tokens,
  // these are the fallback for any consumer rendering straight from the API.
  user:        { background: '#12140F', border: '#FF4A1C' },  // ink + signal ring
  skill_known: { background: '#1B3AC7', border: '#12140F' },  // blueprint blue
  skill_gap:   { background: '#FF4A1C', border: '#12140F' },  // signal orange
  startup:     { background: '#C8A24A', border: '#12140F' },  // ochre
  hackathon:   { background: '#2E6B4F', border: '#12140F' },  // moss
  wiki:        { background: '#EDE9E0', border: '#12140F' },
  goal:        { background: '#FFFFFF', border: '#12140F' },
  note:        { background: '#E2DDD1', border: '#12140F' },
}

/**
 * Parses `[[type/name]]` and bare `[[name]]` links out of markdown.
 * Returns normalised targets; unknown type segments fall back to WIKI.
 */
export function parseWikiLinks(content, { defaultType = MEMORY_TYPES.WIKI } = {}) {
  const found = new Map()

  for (const match of String(content ?? '').matchAll(WIKILINK_RE)) {
    const raw = match[1].trim()
    if (!raw) continue

    const parts = raw.split('/')
    const hasType = parts.length > 1
    const linkType = hasType ? parts[0].trim().toLowerCase() : ''
    const linkName = (hasType ? parts.slice(1).join('/') : parts[0]).trim()
    if (!linkName) continue

    const memoryType = LINK_TYPE_TO_MEMORY[linkType] ?? defaultType
    const slug = slugify(linkName)
    const key = `${memoryType.toLowerCase()}:${slug}`

    if (!found.has(key)) {
      found.set(key, { memoryType, name: linkName, slug, dedupKey: key, raw })
    }
  }

  return [...found.values()]
}

/**
 * Ensures a memory exists for a wikilink target, creating a low-confidence stub when
 * the target has not been ingested yet. Stubs are deliberately weak: they carry the
 * link's own name only, so they rank below real, sourced memories but keep the graph
 * connected.
 */
async function ensureTargetMemory(userId, target, embedFn) {
  const existing = await store.findByDedupKey(userId, target.memoryType, target.dedupKey)
  if (existing) return existing

  const content = `${target.name} was referenced by another page in this developer's career wiki.`
  const embedding = embedFn ? await embedFn(content) : null

  return store.insert(userId, {
    type: target.memoryType,
    dedupKey: target.dedupKey,
    title: target.name,
    content,
    data: { stub: true, name: target.name, slug: target.slug },
    source: MEMORY_SOURCES.INFERENCE,
    importance: 0.3,
    confidence: 0.35,
    embedding,
  })
}

/**
 * Materialises every wikilink in a page as an edge from that page's memory.
 * Returns the created relations. Failures on individual links are non-fatal: a
 * malformed link must not fail the whole ingest.
 */
export async function syncPageLinks(userId, pageMemoryId, content, { embedFn = null, maxLinks = 25 } = {}) {
  const targets = parseWikiLinks(content).slice(0, maxLinks)
  const relations = []

  for (const target of targets) {
    try {
      const targetMemory = await ensureTargetMemory(userId, target, embedFn)
      if (!targetMemory || targetMemory.id === pageMemoryId) continue
      const relation = await store.relate(userId, pageMemoryId, targetMemory.id, RELATIONS.LINKS_TO, 1)
      if (relation) relations.push(relation)
    } catch (err) {
      console.warn(`[graph] could not link ${target.dedupKey}:`, err.message)
    }
  }

  return relations
}

/**
 * Connects a set of newly written memories to the developer's PROFILE node and to
 * each other, so skills, gaps and companies are reachable from the graph root.
 */
export async function linkToProfile(userId, memories, profileMemoryId) {
  if (!profileMemoryId) return 0
  let created = 0

  for (const memory of memories) {
    const relation = {
      [MEMORY_TYPES.SKILL]: RELATIONS.HAS_SKILL,
      [MEMORY_TYPES.SKILL_GAP]: RELATIONS.NEEDS_SKILL,
      [MEMORY_TYPES.TARGET_COMPANY]: RELATIONS.TARGETS,
      [MEMORY_TYPES.GOAL]: RELATIONS.TARGETS,
      [MEMORY_TYPES.PREFERENCE]: RELATIONS.RELATES_TO,
    }[memory.type]

    if (!relation) continue
    const edge = await store.relate(userId, profileMemoryId, memory.id, relation, 1)
    if (edge) created += 1
  }

  return created
}

/**
 * Links a company or hackathon memory to the skill memories it requires, which is
 * what produces the skill→company edges the career graph is built around.
 */
export async function linkEntityToSkills(userId, entityMemory, skillNames = []) {
  let created = 0

  for (const skillName of skillNames.slice(0, 12)) {
    const slug = slugify(skillName)
    // A required skill is either something the developer has, or a gap.
    const known = await store.findByDedupKey(userId, MEMORY_TYPES.SKILL, `skill:${slug}`)
    const gap = known ? null : await store.findByDedupKey(userId, MEMORY_TYPES.SKILL_GAP, `skill_gap:${slug}`)
    const target = known ?? gap
    if (!target) continue

    const edge = await store.relate(userId, entityMemory.id, target.id, RELATIONS.REQUIRES, 1)
    if (edge) created += 1
  }

  return created
}

/**
 * Builds the vis-network payload from stored memories and relations.
 *
 * Nodes carry their memory id, so the frontend can request detail for any node, and
 * a `value` derived from importance so vis-network can size them meaningfully.
 */
export async function buildGraphData(userId, { limit = 300 } = {}) {
  const [memories, relations] = await Promise.all([
    store.list(userId, { limit }),
    store.listRelations(userId),
  ])

  const nodes = memories.map(memory => {
    const group = TYPE_TO_GROUP[memory.type] ?? 'note'
    const label = memory.title || memory.data?.skill || memory.data?.company || memory.content.slice(0, 28)
    return {
      id: memory.id,
      label: String(label).replace(/-/g, ' ').slice(0, 40),
      group,
      color: GROUP_COLORS[group] ?? GROUP_COLORS.note,
      title: `${memory.type.toLowerCase()}: ${memory.content.slice(0, 160)}`,
      value: Math.round(memory.importance * 10),
      memoryType: memory.type,
      memoryId: memory.id,
      importance: memory.importance,
      confidence: memory.confidence,
    }
  })

  const nodeIds = new Set(nodes.map(node => node.id))
  const edges = relations
    .filter(relation => nodeIds.has(relation.from_id) && nodeIds.has(relation.to_id))
    .map(relation => ({
      id: relation.id,
      from: relation.from_id,
      to: relation.to_id,
      label: relation.relation === RELATIONS.LINKS_TO ? '' : relation.relation.toLowerCase().replace(/_/g, ' '),
      relation: relation.relation,
      dashes: relation.relation === RELATIONS.NEEDS_SKILL,
      width: Math.max(1, Number(relation.weight) || 1),
    }))

  const byType = {}
  for (const memory of memories) byType[memory.type] = (byType[memory.type] ?? 0) + 1

  return {
    nodes,
    edges,
    stats: { nodes: nodes.length, edges: edges.length, byType },
    // Retained for backwards compatibility with the previous graph-data response.
    page_count: byType[MEMORY_TYPES.WIKI] ?? 0,
  }
}

export default {
  parseWikiLinks, syncPageLinks, linkToProfile, linkEntityToSkills, buildGraphData,
  TYPE_TO_GROUP, GROUP_COLORS,
}
