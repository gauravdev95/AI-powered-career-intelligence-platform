/**
 * MemoryEngine — the façade the API layer talks to.
 *
 * Orchestrates the other components into whole operations:
 *
 *   remember()  extract → embed → deduplicate → persist → relate
 *   recall()    embed query → retrieve → rank → build context
 *   answer()    recall → generate → resolve citations → learn from the exchange
 *
 * Nothing above this file touches SQL, embeddings, or the model provider directly.
 * Every method takes userId as its first argument and passes it down unchanged —
 * user isolation is enforced at the SQL layer, and there is no path around it.
 */

import { randomUUID } from 'crypto'
import config from '../config.js'
import { query, withTransaction, toVectorLiteral } from '../db/pool.js'
import { embedMany, embedOne, embedQuery } from '../services/embeddings.js'
import * as aiService from '../services/aiService.js'
import { invalidateUser } from '../services/cache.js'
import { slugify } from '../lib/validate.js'
import * as store from './MemoryStore.js'
import * as dedup from './MemoryDeduplicator.js'
import * as ranker from './MemoryRanker.js'
import * as retriever from './MemoryRetriever.js'
import * as extractor from './MemoryExtractor.js'
import * as contextBuilder from './ContextBuilder.js'
import * as graph from './MemoryGraph.js'
import {
  MEMORY_TYPES, MEMORY_SOURCES, MEMORY_STATUS, JOURNEY_TYPES, RELATIONS,
  sourceQuality, defaultImportance,
} from './types.js'

// ── Users and profile ───────────────────────────────────────────────────────

/**
 * Creates a user and expands their onboarding answers into durable memories.
 * Returns the assembled profile in the shape the existing frontend expects.
 */
export async function initUser(profile) {
  const userId = profile.userId ?? randomUUID()

  await store.createUser(userId, {
    name: profile.name,
    experience: profile.experience,
    targetRole: profile.targetRole,
    timeline: profile.timeline,
    learningStyle: profile.learningStyle,
  })

  const candidates = extractor.fromOnboarding({ ...profile, userId })
  const written = await rememberMany(userId, candidates)

  // Wire the profile node to everything it implies, so the graph has a root.
  const profileMemory = written.find(memory => memory?.type === MEMORY_TYPES.PROFILE)
  if (profileMemory) {
    await graph.linkToProfile(userId, written.filter(Boolean), profileMemory.id)
  }

  await recordJourney(userId, JOURNEY_TYPES.ACCOUNT_CREATED, {
    title: 'Career memory created',
    description: `${profile.stack?.length ?? 0} skills, ${profile.goals?.length ?? 0} goals recorded`,
    data: { stack: profile.stack ?? [], experience: profile.experience },
  })

  return getProfile(userId)
}

/** True when this user exists in PostgreSQL. */
export async function userExists(userId) {
  return store.userExists(userId)
}

/**
 * Assembles the user object from scalar profile columns plus list-shaped memories.
 * This is the projection that keeps the pre-existing API contract intact while the
 * underlying storage is fully memory-based.
 */
export async function getProfile(userId) {
  const row = await store.getUserRow(userId)
  if (!row) return null

  const memories = await store.list(userId, {
    types: [
      MEMORY_TYPES.SKILL, MEMORY_TYPES.SKILL_GAP, MEMORY_TYPES.GOAL,
      MEMORY_TYPES.TARGET_COMPANY, MEMORY_TYPES.COMPANY, MEMORY_TYPES.HACKATHON,
    ],
    limit: 400,
  })

  const stack = []
  const learningStack = []
  const goals = []
  const targetCompanies = []
  const startupsViewed = []
  const hackathonsViewed = []
  const gaps = []

  for (const memory of memories) {
    switch (memory.type) {
      case MEMORY_TYPES.SKILL: {
        const skill = memory.data?.skill ?? memory.title
        if (!skill) break
        if (memory.data?.proficiency === 'learning') learningStack.push(skill)
        else stack.push(skill)
        break
      }
      case MEMORY_TYPES.SKILL_GAP:
        gaps.push({
          skill: memory.data?.skill ?? memory.title,
          why: memory.data?.why ?? memory.data?.reason ?? '',
          urgency: memory.data?.urgency ?? 'medium',
          importance: memory.importance,
          updated_at: memory.updatedAt,
        })
        break
      case MEMORY_TYPES.GOAL:
        goals.push(memory.data?.goal ?? memory.title)
        break
      case MEMORY_TYPES.TARGET_COMPANY:
        targetCompanies.push(memory.data?.company ?? memory.title)
        break
      case MEMORY_TYPES.COMPANY:
        if (memory.source === MEMORY_SOURCES.CURATED_DATASET) {
          startupsViewed.push({
            startupId: memory.data?.entityId ?? null,
            startupName: memory.title,
            viewed_at: memory.updatedAt,
          })
        }
        break
      case MEMORY_TYPES.HACKATHON:
        if (memory.source === MEMORY_SOURCES.CURATED_DATASET) {
          hackathonsViewed.push({
            hackathonId: memory.data?.entityId ?? null,
            hackathonName: memory.title,
            viewed_at: memory.updatedAt,
          })
        }
        break
      default:
        break
    }
  }

  gaps.sort((a, b) => b.importance - a.importance)

  return {
    userId: row.user_id,
    name: row.name,
    experience: row.experience,
    target_role: row.target_role,
    timeline: row.timeline,
    learning_style: row.learning_style,
    stack: [...new Set(stack)],
    learning_stack: [...new Set(learningStack)],
    goals: [...new Set(goals)],
    target_companies: [...new Set(targetCompanies)],
    startups_viewed: startupsViewed,
    hackathons_viewed: hackathonsViewed,
    skill_gaps: gaps,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_visit_at: row.last_visit_at,
  }
}

/**
 * Replaces the user's known skills.
 *
 * Skills that disappear are ARCHIVED rather than deleted: knowing that someone once
 * listed a skill is itself career history, and a hard delete would lose it.
 */
export async function updateStack(userId, newStack) {
  const existing = await store.list(userId, { types: [MEMORY_TYPES.SKILL], limit: 200 })
  const desired = new Set(newStack.map(skill => slugify(skill)))
  const profile = await store.getUserRow(userId)
  const name = profile?.name ?? 'This developer'

  for (const memory of existing) {
    const slug = slugify(memory.data?.skill ?? memory.title)
    if (!desired.has(slug) && memory.data?.proficiency !== 'learning') {
      await store.setStatus(userId, memory.id, MEMORY_STATUS.ARCHIVED)
    }
  }

  const candidates = newStack.map(skill => ({
    type: MEMORY_TYPES.SKILL,
    dedupKey: extractor.dedupKeyFor(MEMORY_TYPES.SKILL, skill),
    title: skill,
    content: `${name} knows ${skill} and considers it part of their current stack.`,
    data: { skill, proficiency: 'known' },
    source: MEMORY_SOURCES.USER_INPUT,
    importance: 0.8,
    confidence: 0.9,
  }))

  const written = await rememberMany(userId, candidates)
  await invalidateUser(userId)
  return written.filter(Boolean)
}

// ── Core write path ─────────────────────────────────────────────────────────

/**
 * Persists one candidate, resolving it against existing memory first.
 * Returns the resulting memory (new, reinforced, or the untouched original).
 */
export async function remember(userId, candidate) {
  const prepared = { ...candidate }
  if (!Array.isArray(prepared.embedding)) {
    prepared.embedding = await embedOne(`${prepared.title ?? ''} ${prepared.content}`.trim())
  }
  prepared.contentHash = store.contentHash(prepared.type, prepared.content)
  // Resolve the scored fields before conflict resolution runs. The deduplicator
  // weighs the candidate's evidence against the stored memory's, so leaving these
  // to be defaulted at insert time would make that comparison NaN and silently
  // downgrade every conflict to a supersede.
  prepared.sourceQuality ??= sourceQuality(prepared.source ?? MEMORY_SOURCES.SYSTEM)
  prepared.confidence ??= 0.7
  prepared.importance ??= defaultImportance(prepared.type)

  const decision = await dedup.resolve(userId, prepared)

  switch (decision.action) {
    case dedup.ACTIONS.SKIP:
      await store.touch(userId, [decision.existing.id])
      return decision.existing

    case dedup.ACTIONS.REINFORCE:
      return store.update(userId, decision.existing.id, dedup.mergePatch(decision.existing, prepared))

    case dedup.ACTIONS.SUPERSEDE: {
      // Retire the old row first so the partial unique index on (user, type, key)
      // does not reject the replacement.
      const created = await withTransaction(async tx => {
        await tx.query(
          `UPDATE memories SET status = $3, updated_at = now() WHERE user_id = $1 AND id = $2`,
          [userId, decision.existing.id, MEMORY_STATUS.SUPERSEDED],
        )
        const { rows } = await tx.query(
          `INSERT INTO memories
             (user_id, type, dedup_key, title, content, data, importance, confidence,
              source, source_quality, status, content_hash, embedding)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,'ACTIVE',$11,$12::vector)
           RETURNING *`,
          [
            userId, prepared.type, prepared.dedupKey ?? null, prepared.title ?? '', prepared.content,
            JSON.stringify(prepared.data ?? {}),
            Math.max(prepared.importance ?? 0.5, decision.existing.importance * 0.9),
            prepared.confidence ?? 0.7,
            prepared.source ?? MEMORY_SOURCES.SYSTEM,
            prepared.sourceQuality ?? 0.5,
            prepared.contentHash,
            toVectorLiteral(prepared.embedding),
          ],
        )
        await tx.query(
          'UPDATE memories SET superseded_by = $3 WHERE user_id = $1 AND id = $2',
          [userId, decision.existing.id, rows[0].id],
        )
        return store.rowToMemory(rows[0])
      })

      await store.relate(userId, created.id, decision.existing.id, RELATIONS.SUPERSEDES, 1)
      return created
    }

    case dedup.ACTIONS.CONFLICT:
      // Record the competing claim, but keep it out of retrieval until resolved.
      await store.markConflicted(userId, [decision.existing.id])
      return store.insert(userId, { ...prepared, status: MEMORY_STATUS.CONFLICTED })

    case dedup.ACTIONS.INSERT:
    default:
      return store.insert(userId, prepared)
  }
}

/**
 * Persists many candidates. Embeds and collapses in-batch duplicates in one pass,
 * so ingesting a posting that mentions React five times costs one embedding call and
 * produces one memory.
 */
export async function rememberMany(userId, candidates) {
  if (!candidates?.length) return []

  const texts = candidates.map(candidate => `${candidate.title ?? ''} ${candidate.content}`.trim())
  const embeddings = await embedMany(texts)
  const withEmbeddings = candidates.map((candidate, index) => ({ ...candidate, embedding: embeddings[index] }))

  const unique = dedup.dedupeBatch(withEmbeddings)

  const written = []
  for (const candidate of unique) {
    try {
      written.push(await remember(userId, candidate))
    } catch (err) {
      console.error('[memory] failed to store candidate:', err.message)
      written.push(null)
    }
  }

  await invalidateUser(userId)
  return written
}

// ── Core read path ──────────────────────────────────────────────────────────

/**
 * Retrieves, ranks and packs memory for a query.
 * This is the RAG pipeline: embed → pgvector → rank → budgeted context.
 */
export async function recall(userId, question, {
  types = null,
  topK = config.memory.retrievalTopK,
  charBudget = config.memory.contextCharBudget,
  typeBoosts = null,
  includeProfile = true,
  recordAccess = true,
} = {}) {
  const embedding = await embedQuery(question)

  const [{ candidates, counts }, coreProfile] = await Promise.all([
    retriever.retrieve(userId, question, { types, embedding }),
    includeProfile ? retriever.retrieveCoreProfile(userId) : Promise.resolve([]),
  ])

  const ranked = ranker.rank(candidates, {
    limit: topK,
    typeBoosts,
    // Stop any single category from monopolising the context window.
    diversityByType: Math.max(3, Math.ceil(topK / 3)),
  })

  const profileBlock = includeProfile ? contextBuilder.buildProfileBlock(coreProfile) : ''
  const built = contextBuilder.build(ranked, {
    charBudget: charBudget - profileBlock.length,
    maxEntries: topK,
  })

  if (recordAccess && built.entries.length) {
    // Only real memories have rows to touch; wiki chunks live in their own table.
    const ids = built.entries.filter(entry => !entry.isChunk).map(entry => entry.id)
    await store.touch(userId, ids)
  }

  return {
    context: [profileBlock, built.text].filter(Boolean).join('\n\n'),
    entries: built.entries,
    ranked,
    stats: { ...built.stats, retrieved: counts },
  }
}

/**
 * Answers a question using only retrieved memory, then learns from the exchange.
 *
 * Short-term memory (recent turns) shapes the reply; long-term memory is written only
 * for durable facts the developer stated about themselves.
 */
export async function answer(userId, question, { userStack = [] } = {}) {
  const [recalled, recentTurns] = await Promise.all([
    recall(userId, question, {
      typeBoosts: inferTypeBoosts(question),
    }),
    retriever.recentConversation(userId),
  ])

  const result = await aiService.answerFromContext({
    question,
    context: recalled.context,
    userStack,
    recentTurns,
  })

  const citations = contextBuilder.resolveCitations(result.cited_keys, recalled.entries)

  await appendConversation(userId, question, result.answer)

  // Promote durable facts from this exchange. Best-effort: a failure here must not
  // affect the answer the user already has.
  try {
    const durable = await extractor.fromConversation({ question, answer: result.answer, userStack })
    if (durable.length) await rememberMany(userId, durable)
  } catch (err) {
    console.warn('[memory] conversation extraction skipped:', err.message)
  }

  return {
    answer: result.answer,
    citations,
    grounded: recalled.entries.length > 0,
    // Non-null when the answer came from a fallback rather than the model, so the UI
    // can label it instead of passing canned text off as a generated reply.
    degraded: result.degraded ?? null,
    stats: recalled.stats,
  }
}

/** Nudges retrieval toward the category a question is obviously about. */
function inferTypeBoosts(question) {
  const text = String(question).toLowerCase()
  const boosts = {}
  if (/hackathon|deadline|event|competition/.test(text)) boosts[MEMORY_TYPES.HACKATHON] = 0.12
  if (/compan|startup|apply|job|role|hiring|salary/.test(text)) {
    boosts[MEMORY_TYPES.COMPANY] = 0.10
    boosts[MEMORY_TYPES.TARGET_COMPANY] = 0.10
    boosts[MEMORY_TYPES.JOB] = 0.08
  }
  if (/learn|skill|gap|missing|study|improve/.test(text)) {
    boosts[MEMORY_TYPES.SKILL_GAP] = 0.12
    boosts[MEMORY_TYPES.SKILL] = 0.08
  }
  if (/goal|want|plan|aim/.test(text)) boosts[MEMORY_TYPES.GOAL] = 0.10
  return Object.keys(boosts).length ? boosts : null
}

// ── Conversation (short-term memory) ────────────────────────────────────────

/** Appends a turn pair and trims the rolling window. Raw chat is disposable. */
export async function appendConversation(userId, question, answerText) {
  await query(
    `INSERT INTO conversation_turns (user_id, role, content)
     VALUES ($1, 'user', $2), ($1, 'assistant', $3)`,
    [userId, question.slice(0, 4000), String(answerText ?? '').slice(0, 4000)],
  )
  await query(
    `DELETE FROM conversation_turns
      WHERE user_id = $1
        AND id NOT IN (
          SELECT id FROM conversation_turns
           WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT $2
        )`,
    [userId, config.memory.conversationRetention],
  )
}

// ── Wiki ────────────────────────────────────────────────────────────────────

/**
 * Splits markdown into retrieval-sized chunks on section boundaries.
 * Overlap preserves context that would otherwise be severed mid-argument.
 */
export function chunkMarkdown(content, {
  chunkSize = config.memory.chunkSize,
  overlap = config.memory.chunkOverlap,
} = {}) {
  const body = String(content ?? '')
    .replace(/^---\n[\s\S]*?\n---\n/, '') // drop YAML frontmatter — it is metadata, not prose
    .trim()
  if (!body) return []

  // Prefer splitting at markdown headings; fall back to blank lines.
  const sections = body.split(/\n(?=#{1,3}\s)/).filter(section => section.trim())
  const chunks = []

  for (const section of sections) {
    if (section.length <= chunkSize) {
      chunks.push(section.trim())
      continue
    }
    const paragraphs = section.split(/\n\s*\n/)
    let buffer = ''
    for (const paragraph of paragraphs) {
      if (buffer && buffer.length + paragraph.length > chunkSize) {
        chunks.push(buffer.trim())
        buffer = overlap > 0 ? `${buffer.slice(-overlap)}\n\n${paragraph}` : paragraph
      } else {
        buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph
      }
    }
    if (buffer.trim()) chunks.push(buffer.trim())
  }

  // Hard-split anything still oversized (e.g. one enormous paragraph).
  return chunks.flatMap(chunk => {
    if (chunk.length <= chunkSize * 1.5) return [chunk]
    const pieces = []
    for (let index = 0; index < chunk.length; index += chunkSize - overlap) {
      pieces.push(chunk.slice(index, index + chunkSize))
    }
    return pieces
  }).filter(Boolean)
}

/**
 * Saves a wiki page: the document, its embedded chunks, a WIKI memory representing
 * the page, and graph edges for every wikilink it contains.
 */
export async function saveWikiPage(userId, pageType, pageName, content, meta = {}) {
  const type = slugify(pageType)
  const name = slugify(pageName)
  const pageKey = `${type}/${name}`

  const page = await withTransaction(async tx => {
    const { rows } = await tx.query(
      `INSERT INTO wiki_pages (user_id, page_key, page_type, page_name, content, meta)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (user_id, page_key) DO UPDATE
         SET content = EXCLUDED.content, meta = EXCLUDED.meta, updated_at = now()
       RETURNING *`,
      [userId, pageKey, type, name, content, JSON.stringify(meta)],
    )
    const saved = rows[0]
    // Re-chunking replaces the old slices wholesale; stale chunks would otherwise
    // keep answering questions with superseded content.
    await tx.query('DELETE FROM wiki_chunks WHERE user_id = $1 AND page_id = $2', [userId, saved.id])
    return saved
  })

  const chunks = chunkMarkdown(content)
  if (chunks.length) {
    const embeddings = await embedMany(chunks)
    for (let index = 0; index < chunks.length; index += 1) {
      await query(
        `INSERT INTO wiki_chunks (user_id, page_id, page_key, chunk_index, content, char_count, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
         ON CONFLICT (page_id, chunk_index) DO UPDATE
           SET content = EXCLUDED.content, embedding = EXCLUDED.embedding, char_count = EXCLUDED.char_count`,
        [userId, page.id, pageKey, index, chunks[index], chunks[index].length, toVectorLiteral(embeddings[index])],
      )
    }
  }

  // The page also exists as a memory, so it participates in ranking and the graph.
  const pageMemory = await remember(userId, {
    type: MEMORY_TYPES.WIKI,
    dedupKey: `wiki:${pageKey}`,
    title: pageName.replace(/-/g, ' '),
    content: `Wiki page ${pageKey}: ${stripMarkdown(content).slice(0, 400)}`,
    data: { pageKey, pageType: type, pageName: name, chunkCount: chunks.length, ...meta },
    source: meta.source?.startsWith('http') ? MEMORY_SOURCES.INGEST_URL : MEMORY_SOURCES.AI_EXTRACTION,
    importance: 0.55,
    confidence: 0.7,
  })

  if (pageMemory) {
    await query('UPDATE wiki_pages SET memory_id = $3 WHERE user_id = $1 AND id = $2', [userId, page.id, pageMemory.id])
    await graph.syncPageLinks(userId, pageMemory.id, content, { embedFn: text => embedOne(text) })
  }

  await invalidateUser(userId)

  return {
    key: pageKey,
    pageType: type,
    pageName: name,
    content,
    meta,
    chunkCount: chunks.length,
    created_at: page.created_at,
    updated_at: page.updated_at,
  }
}

function stripMarkdown(text) {
  return String(text ?? '')
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/[#*_`>-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function getWikiPages(userId) {
  const { rows } = await query(
    `SELECT page_key AS key, page_type AS "pageType", page_name AS "pageName",
            content, meta, created_at, updated_at
       FROM wiki_pages WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId],
  )
  return rows.map(row => ({ ...row, meta: typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta }))
}

export async function getWikiPage(userId, pageType, pageName) {
  const pageKey = `${slugify(pageType)}/${slugify(pageName)}`
  const { rows } = await query(
    `SELECT page_key AS key, page_type AS "pageType", page_name AS "pageName",
            content, meta, created_at, updated_at
       FROM wiki_pages WHERE user_id = $1 AND page_key = $2`,
    [userId, pageKey],
  )
  if (!rows[0]) return null
  const row = rows[0]
  return { ...row, meta: typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta }
}

export async function countWikiPages(userId) {
  const { rows } = await query('SELECT count(*)::int AS n FROM wiki_pages WHERE user_id = $1', [userId])
  return Number(rows[0]?.n ?? 0)
}

// ── Journey ─────────────────────────────────────────────────────────────────

/**
 * Records a milestone. Replaces the previously dead updateJourney(): every event
 * written here is durable and appears in /api/journey.
 */
export async function recordJourney(userId, type, { title = '', description = null, data = {} } = {}) {
  const { rows } = await query(
    `INSERT INTO journey_events (user_id, type, title, description, data)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id, type, title, description, data, created_at`,
    [userId, type, title.slice(0, 300), description, JSON.stringify(data)],
  )
  return rows[0]
}

export async function getJourney(userId, { limit = 200 } = {}) {
  const { rows } = await query(
    `SELECT id, type, title, description, data, created_at
       FROM journey_events WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2`,
    [userId, Math.min(limit, 500)],
  )
  return rows.map(row => ({
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
    // The frontend timeline reads `timestamp`; created_at is kept for API clarity.
    timestamp: row.created_at,
    created_at: row.created_at,
  }))
}

// ── Curated-entity engagement ───────────────────────────────────────────────

/** Remembers that the developer engaged with a company or hackathon we curate. */
export async function recordEntityView(userId, kind, entity) {
  if (!entity?.name) return null
  const memory = await remember(userId, extractor.fromCuratedEntity(kind, entity))

  if (memory && kind !== 'hackathon' && entity.skills_required?.length) {
    await graph.linkEntityToSkills(userId, memory, entity.skills_required)
  }
  if (memory && kind === 'hackathon' && entity.skills_relevant?.length) {
    await graph.linkEntityToSkills(userId, memory, entity.skills_relevant)
  }

  await recordJourney(
    userId,
    kind === 'hackathon' ? JOURNEY_TYPES.HACKATHON_VIEWED : JOURNEY_TYPES.STARTUP_VIEWED,
    {
      title: entity.name,
      description: kind === 'hackathon'
        ? `Deadline ${entity.deadline ?? 'unknown'}`
        : `${entity.type ?? 'Company'} · ${entity.location ?? 'India'}`,
      data: { entityId: entity.id, match_score: entity.match_score ?? null },
    },
  )

  return memory
}

/** Stores a gap analysis as SKILL_GAP memories plus a journey milestone. */
export async function saveGapAnalysis(userId, report, { targets = [] } = {}) {
  const candidates = extractor.fromGapAnalysis(report.priority_skills ?? [], { targets })
  const written = await rememberMany(userId, candidates)

  await recordJourney(userId, JOURNEY_TYPES.GAP_ANALYSIS_RUN, {
    title: report.priority_skills?.[0]?.skill ? `Top gap: ${report.priority_skills[0].skill}` : 'Gap analysis run',
    description: targets.length ? `Targets: ${targets.slice(0, 3).join(', ')}` : null,
    data: { top_gap: report.priority_skills?.[0]?.skill ?? null, targets },
  })

  return written.filter(Boolean)
}

// ── Return context ──────────────────────────────────────────────────────────

/**
 * Reconstructs "what you were doing last time" from durable memory.
 *
 * Fixes the previous implementation, which read `gap_analyses[].gaps[0].skill` — a
 * key that was never written — so the top-gap sentence could never appear.
 */
export async function getReturnContext(userId, startups = [], hackathons = []) {
  const empty = { hasHistory: false, message: '', urgentItems: [] }

  const profile = await getProfile(userId)
  if (!profile) return empty

  const viewedStartups = profile.startups_viewed
  const viewedHackathons = profile.hackathons_viewed
  const topGap = profile.skill_gaps[0]?.skill ?? null

  if (!viewedStartups.length && !viewedHackathons.length && !topGap) {
    // Known user with no engagement yet — let them straight into the app.
    return { ...empty, name: profile.name, stack: profile.stack }
  }

  const now = Date.now()
  const urgentItems = []

  for (const viewed of viewedHackathons) {
    const live = hackathons.find(item => item.id === viewed.hackathonId)
    if (!live?.deadline) continue
    const daysLeft = Math.ceil((new Date(live.deadline).getTime() - now) / 86400000)
    if (daysLeft > 0 && daysLeft <= 14) {
      urgentItems.push({ type: 'hackathon', name: live.name, daysLeft })
    }
  }

  for (const viewed of viewedStartups) {
    const live = startups.find(item => item.id === viewed.startupId)
    if (live?.hiring) urgentItems.push({ type: 'startup', name: live.name, daysLeft: null })
  }

  urgentItems.sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999))

  const recentStartup = viewedStartups.at(-1)?.startupName
  const recentHackathon = viewedHackathons.at(-1)?.hackathonName

  let message = 'Welcome back! '
  if (recentStartup && recentHackathon) message += `Last time you explored ${recentStartup} and checked out ${recentHackathon}. `
  else if (recentStartup) message += `Last time you were looking at ${recentStartup}. `
  else if (recentHackathon) message += `Last time you checked out ${recentHackathon}. `

  if (topGap) message += `Your top skill gap was ${topGap} — let's see how your stack looks now.`
  else if (profile.stack.length) message += `Your stack has ${profile.stack.length} skills — here's what's changed.`

  await store.touchUserVisit(userId)
  await recordJourney(userId, JOURNEY_TYPES.RETURN_VISIT, {
    title: 'Returned to Grafted',
    data: { urgentItems: urgentItems.length },
  })

  return {
    hasHistory: true,
    message: message.trim(),
    urgentItems,
    name: profile.name,
    stack: profile.stack,
    learning_stack: profile.learning_stack,
    topGap,
    lastVisit: profile.last_visit_at ?? profile.created_at,
  }
}

// ── Roadmap ─────────────────────────────────────────────────────────────────

/** Generates a roadmap grounded in the user's own memory, and remembers it. */
export async function generateRoadmap(userId) {
  const profile = await getProfile(userId)
  if (!profile) return null

  const gapSkills = profile.skill_gaps.slice(0, 6).map(gap => ({ skill: gap.skill, why: gap.why }))
  const focus = gapSkills.map(gap => gap.skill).join(', ') || profile.stack.join(', ')
  const recalled = await recall(userId, `learning plan for ${focus}`, {
    topK: 8,
    charBudget: 2500,
    recordAccess: false,
  })

  const roadmap = await aiService.generateRoadmap({
    userStack: profile.stack,
    gapSkills,
    goals: profile.goals,
    context: recalled.context,
  })

  await remember(userId, {
    type: MEMORY_TYPES.ROADMAP,
    dedupKey: 'roadmap:current',
    title: 'Current 4-week roadmap',
    content: `Roadmap: ${roadmap.summary} Weeks: ${roadmap.weeks.map(week => `${week.week}. ${week.theme} (${week.focus_skill})`).join('; ')}`,
    data: roadmap,
    source: MEMORY_SOURCES.AI_EXTRACTION,
    importance: 0.65,
    confidence: 0.6,
  })

  await recordJourney(userId, JOURNEY_TYPES.ROADMAP_GEN, {
    title: 'Roadmap generated',
    description: roadmap.summary?.slice(0, 200) ?? null,
    data: { weeks: roadmap.weeks.length },
  })

  return roadmap
}

// ── Ingest bookkeeping ──────────────────────────────────────────────────────

export async function appendIngestLog(userId, entry) {
  await query(
    `INSERT INTO ingest_log (user_id, input_type, source, pages_created, summary)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, entry.inputType, String(entry.source ?? '').slice(0, 500), entry.pagesCreated ?? 0, String(entry.summary ?? '').slice(0, 1000)],
  )
}

// ── Diagnostics ─────────────────────────────────────────────────────────────

export async function getStats(userId) {
  const [byType, wikiPages] = await Promise.all([
    store.countByType(userId),
    countWikiPages(userId),
  ])
  const total = Object.values(byType).reduce((sum, count) => sum + count, 0)
  return { memories: total, byType, wikiPages }
}

export async function getGraphData(userId) {
  return graph.buildGraphData(userId)
}

export default {
  initUser, userExists, getProfile, updateStack,
  remember, rememberMany, recall, answer,
  saveWikiPage, getWikiPages, getWikiPage, countWikiPages, chunkMarkdown,
  recordJourney, getJourney, recordEntityView, saveGapAnalysis,
  getReturnContext, generateRoadmap, appendIngestLog, getStats, getGraphData,
  appendConversation,
}
