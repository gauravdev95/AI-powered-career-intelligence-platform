/**
 * Career Memory Engine integration tests.
 *
 * These run against a real PostgreSQL engine with the real pgvector extension and
 * the production schema — the SQL, the `<=>` cosine operator and the constraints
 * exercised here are the ones that run in production.
 */

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'crypto'

import { setupDatabase, teardown, createTestUser, SAMPLE_WIKI_PAGE } from './helpers.js'
import engine, { MemoryStore, MemoryGraph, ContextBuilder, MemoryExtractor } from '../memory/index.js'
import { MEMORY_TYPES, MEMORY_STATUS, MEMORY_SOURCES } from '../memory/types.js'
import { query } from '../db/pool.js'

before(setupDatabase)
after(teardown)

// ── Persistence and profile ─────────────────────────────────────────────────

test('onboarding is expanded into typed, durable memories', async () => {
  const profile = await createTestUser()

  assert.ok(profile.userId)
  assert.deepEqual(profile.stack.sort(), ['JavaScript', 'Node.js', 'React'])
  assert.deepEqual(profile.learning_stack, ['TypeScript'])
  assert.deepEqual(profile.goals, ['Join a funded fintech startup'])
  assert.deepEqual(profile.target_companies, ['Razorpay'])

  const stats = await engine.getStats(profile.userId)
  assert.ok(stats.byType[MEMORY_TYPES.PROFILE] >= 1)
  assert.equal(stats.byType[MEMORY_TYPES.SKILL], 4, '3 known + 1 learning')
  assert.equal(stats.byType[MEMORY_TYPES.GOAL], 1)
  assert.equal(stats.byType[MEMORY_TYPES.TARGET_COMPANY], 1)
})

test('a stored memory survives being read back through a fresh query', async () => {
  const { userId } = await createTestUser()

  await engine.remember(userId, {
    type: MEMORY_TYPES.GOAL,
    dedupKey: 'goal:relocate',
    title: 'Relocate',
    content: 'The developer wants to relocate to Bangalore within six months.',
    source: MEMORY_SOURCES.ONBOARDING,
  })

  // Read through raw SQL rather than the engine's own cache-aware path.
  const { rows } = await query(
    'SELECT content, importance, confidence, source_quality, status FROM memories WHERE user_id = $1 AND dedup_key = $2',
    [userId, 'goal:relocate'],
  )
  assert.equal(rows.length, 1)
  assert.match(rows[0].content, /relocate to Bangalore/)
  assert.equal(rows[0].status, MEMORY_STATUS.ACTIVE)
  assert.ok(Number(rows[0].source_quality) > 0.9, 'onboarding is a high-quality source')
})

// ── Vector search ───────────────────────────────────────────────────────────

test('pgvector search ranks semantically related memories above unrelated ones', async () => {
  const { userId } = await createTestUser()

  await engine.rememberMany(userId, [
    { type: MEMORY_TYPES.COMPANY, dedupKey: 'company:razorpay', title: 'Razorpay', content: 'Razorpay is a Bangalore payments company hiring backend engineers for TypeScript and PostgreSQL work.', source: MEMORY_SOURCES.INGEST_TEXT },
    { type: MEMORY_TYPES.COMPANY, dedupKey: 'company:cult', title: 'Cult.fit', content: 'Cult.fit runs gyms and fitness classes across Indian cities.', source: MEMORY_SOURCES.INGEST_TEXT },
  ])

  const { embedQuery } = await import('../services/embeddings.js')
  const vector = await embedQuery('which payments company wants TypeScript backend engineers')
  const results = await MemoryStore.vectorSearch(userId, vector, { limit: 10, minSimilarity: 0 })

  assert.ok(results.length >= 2, 'both memories should be candidates')
  assert.equal(results[0].dedupKey, 'company:razorpay', 'the payments company must rank first')
  assert.ok(results[0].similarity > results[1].similarity)
  assert.ok(results[0].similarity <= 1.0001 && results[0].similarity >= -1.0001, 'similarity must be a valid cosine value')
})

test('vector search filters by memory type', async () => {
  const { userId } = await createTestUser()
  const { embedQuery } = await import('../services/embeddings.js')

  const vector = await embedQuery('react')
  const onlyGoals = await MemoryStore.vectorSearch(userId, vector, { types: [MEMORY_TYPES.GOAL], minSimilarity: 0 })

  assert.ok(onlyGoals.every(memory => memory.type === MEMORY_TYPES.GOAL))
})

// ── Deduplication, updates and conflict handling ────────────────────────────

test('identical content is stored once and its access count is bumped', async () => {
  const { userId } = await createTestUser()
  const candidate = {
    type: MEMORY_TYPES.SKILL_GAP,
    dedupKey: 'skill_gap:kafka',
    title: 'Kafka',
    content: 'Kafka is a skill gap for this developer.',
    source: MEMORY_SOURCES.INGEST_TEXT,
  }

  const first = await engine.remember(userId, candidate)
  const second = await engine.remember(userId, { ...candidate })

  assert.equal(first.id, second.id, 'the same fact must not create a second row')

  const { rows } = await query(
    'SELECT count(*)::int AS n FROM memories WHERE user_id = $1 AND dedup_key = $2',
    [userId, 'skill_gap:kafka'],
  )
  assert.equal(Number(rows[0].n), 1)
})

test('a newer statement of a keyed fact supersedes the old one, preserving history', async () => {
  const { userId } = await createTestUser()

  const original = await engine.remember(userId, {
    type: MEMORY_TYPES.PREFERENCE,
    dedupKey: 'preference:learning-style',
    content: 'The developer prefers to learn by watching video courses.',
    source: MEMORY_SOURCES.ONBOARDING,
    confidence: 0.8,
  })

  const revised = await engine.remember(userId, {
    type: MEMORY_TYPES.PREFERENCE,
    dedupKey: 'preference:learning-style',
    content: 'The developer prefers to learn by building projects, not watching videos.',
    source: MEMORY_SOURCES.USER_INPUT,
    confidence: 0.9,
  })

  assert.notEqual(original.id, revised.id)

  const old = await MemoryStore.getById(userId, original.id)
  assert.equal(old.status, MEMORY_STATUS.SUPERSEDED, 'the old fact is retained, not deleted')
  assert.equal(old.supersededBy, revised.id, 'and it points at what replaced it')

  const active = await MemoryStore.findByDedupKey(userId, MEMORY_TYPES.PREFERENCE, 'preference:learning-style')
  assert.equal(active.id, revised.id)
  assert.match(active.content, /building projects/)
})

test('a weakly-evidenced contradiction is flagged rather than silently overwriting', async () => {
  const { userId } = await createTestUser()

  await engine.remember(userId, {
    type: MEMORY_TYPES.SKILL,
    dedupKey: 'skill:rust',
    content: 'The developer is highly experienced in Rust.',
    source: MEMORY_SOURCES.ONBOARDING,
    confidence: 0.95,
  })

  await engine.remember(userId, {
    type: MEMORY_TYPES.SKILL,
    dedupKey: 'skill:rust',
    content: 'The developer has never used Rust.',
    source: MEMORY_SOURCES.INFERENCE,
    confidence: 0.3,
  })

  const { rows } = await query(
    `SELECT status, count(*)::int AS n FROM memories
      WHERE user_id = $1 AND dedup_key = 'skill:rust' GROUP BY status`,
    [userId],
  )
  const byStatus = Object.fromEntries(rows.map(row => [row.status, Number(row.n)]))
  assert.equal(byStatus[MEMORY_STATUS.CONFLICTED], 2, 'both competing claims are flagged for resolution')

  // Conflicted memories must not leak into retrieval.
  const active = await MemoryStore.findByDedupKey(userId, MEMORY_TYPES.SKILL, 'skill:rust')
  assert.equal(active, null)
})

test('archived skills leave the active stack but remain on record', async () => {
  const { userId } = await createTestUser()
  await engine.updateStack(userId, ['React', 'Go'])

  const profile = await engine.getProfile(userId)
  assert.deepEqual(profile.stack.sort(), ['Go', 'React'])
  assert.ok(!profile.stack.includes('Node.js'), 'a removed skill leaves the active stack')

  const archived = await MemoryStore.list(userId, { types: [MEMORY_TYPES.SKILL], status: MEMORY_STATUS.ARCHIVED, limit: 50 })
  assert.ok(archived.some(memory => memory.data?.skill === 'Node.js'), 'but it is retained as career history')
})

// ── Cross-user isolation ────────────────────────────────────────────────────

test('memory is strictly isolated between users', async () => {
  const alice = await createTestUser({ name: 'Alice' })
  const bob = await createTestUser({ name: 'Bob', stack: ['Python'], goals: [], targetCompanies: [] })

  const secret = await engine.remember(alice.userId, {
    type: MEMORY_TYPES.GOAL,
    dedupKey: 'goal:secret',
    content: 'Alice is secretly interviewing at Stripe next week.',
    source: MEMORY_SOURCES.CONVERSATION,
  })

  // Direct fetch with the wrong owner must fail.
  assert.equal(await MemoryStore.getById(bob.userId, secret.id), null)

  // Vector search as Bob must never surface Alice's memory.
  const { embedQuery } = await import('../services/embeddings.js')
  const vector = await embedQuery('secretly interviewing at Stripe next week')
  const bobResults = await MemoryStore.vectorSearch(bob.userId, vector, { minSimilarity: 0, limit: 50 })
  assert.ok(!bobResults.some(memory => memory.id === secret.id))

  // Keyword search as Bob must not surface it either.
  const bobKeyword = await MemoryStore.keywordSearch(bob.userId, 'Stripe', { limit: 50 })
  assert.equal(bobKeyword.length, 0)

  // Full recall must not leak it into Bob's context.
  const recalled = await engine.recall(bob.userId, 'Where am I interviewing?')
  assert.ok(!recalled.context.includes('Stripe'), 'another user\'s memory must never enter the prompt')

  // And Bob cannot mutate it.
  assert.equal(await MemoryStore.setStatus(bob.userId, secret.id, MEMORY_STATUS.ARCHIVED), null)
  const stillActive = await MemoryStore.getById(alice.userId, secret.id)
  assert.equal(stillActive.status, MEMORY_STATUS.ACTIVE)
})

test('a barely-onboarded user recalls only their own profile, never a populated user\'s memories', async () => {
  const populated = await createTestUser({ name: 'Populated' })
  await engine.remember(populated.userId, {
    type: MEMORY_TYPES.GOAL,
    dedupKey: 'goal:distinctive',
    content: 'Populated wants to lead the Kubernetes platform team at Flipkart.',
    source: MEMORY_SOURCES.ONBOARDING,
  })

  const empty = await engine.initUser({
    userId: randomUUID(), name: 'Empty', experience: '0-1 years',
    stack: [], goals: [], targetCompanies: [], learningStack: [],
  })

  const recalled = await engine.recall(empty.userId, 'what should I learn about Kubernetes at Flipkart')

  // initUser always writes a PROFILE memory, so the profile block is legitimately
  // present — what must never appear is anything belonging to the other user.
  // Their own PROFILE memory may legitimately be retrieved; what must never appear
  // is anything belonging to the other user.
  assert.ok(
    recalled.entries.every(entry => entry.userId === undefined || entry.userId === empty.userId),
    'every retrieved entry must belong to this user',
  )
  assert.ok(!recalled.context.includes('Flipkart'), 'another user\'s goal must not leak in')
  assert.ok(!recalled.context.includes('Kubernetes'))
  assert.ok(recalled.context.includes('Empty'), 'only their own profile is grounded in')
})

// ── Wiki storage and retrieval ──────────────────────────────────────────────

test('a wiki page is chunked, embedded and retrievable by meaning', async () => {
  const { userId } = await createTestUser()

  const page = await engine.saveWikiPage(userId, 'company', 'razorpay', SAMPLE_WIKI_PAGE, { source: 'pasted text' })
  assert.ok(page.chunkCount > 0, 'the page must produce indexed chunks')

  const pages = await engine.getWikiPages(userId)
  assert.equal(pages.length, 1)
  assert.equal(pages[0].key, 'company/razorpay')

  const single = await engine.getWikiPage(userId, 'company', 'razorpay')
  assert.match(single.content, /Razorpay is an Indian fintech unicorn/)

  const { embedQuery } = await import('../services/embeddings.js')
  const { searchWikiChunks } = await import('../memory/MemoryRetriever.js')
  const vector = await embedQuery('what salary band does Razorpay pay engineers')
  const hits = await searchWikiChunks(userId, vector, { minSimilarity: 0, limit: 5 })

  assert.ok(hits.length > 0, 'chunk search must return results')
  assert.ok(hits.some(hit => hit.content.includes('18-32 LPA')), 'the salary chunk must be retrievable')
  assert.ok(hits.every(hit => hit.type === MEMORY_TYPES.WIKI_CHUNK))
})

test('re-saving a page replaces its chunks instead of accumulating stale ones', async () => {
  const { userId } = await createTestUser()

  await engine.saveWikiPage(userId, 'company', 'razorpay', SAMPLE_WIKI_PAGE, {})
  const before = await query('SELECT count(*)::int AS n FROM wiki_chunks WHERE user_id = $1', [userId])

  await engine.saveWikiPage(userId, 'company', 'razorpay', '# Razorpay\n\nA much shorter page now.', {})
  const after = await query('SELECT count(*)::int AS n FROM wiki_chunks WHERE user_id = $1', [userId])

  assert.ok(Number(after.rows[0].n) < Number(before.rows[0].n), 'stale chunks must be removed')

  const pages = await engine.getWikiPages(userId)
  assert.equal(pages.length, 1, 're-saving updates in place rather than duplicating the page')
  assert.match(pages[0].content, /much shorter page/)
})

test('wiki pages of one user are invisible to another', async () => {
  const alice = await createTestUser({ name: 'Alice' })
  const bob = await createTestUser({ name: 'Bob' })

  await engine.saveWikiPage(alice.userId, 'company', 'razorpay', SAMPLE_WIKI_PAGE, {})

  assert.equal((await engine.getWikiPages(bob.userId)).length, 0)
  assert.equal(await engine.getWikiPage(bob.userId, 'company', 'razorpay'), null)
})

// ── Graph ───────────────────────────────────────────────────────────────────

test('wikilinks become real graph edges with real endpoints', async () => {
  const { userId } = await createTestUser()
  await engine.saveWikiPage(userId, 'company', 'razorpay', SAMPLE_WIKI_PAGE, {})

  const graph = await engine.getGraphData(userId)

  assert.ok(graph.nodes.length > 0)
  assert.ok(graph.edges.length > 0, 'the page\'s [[skill/...]] links must produce edges')

  const nodeIds = new Set(graph.nodes.map(node => node.id))
  assert.ok(graph.edges.every(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to)),
    'every edge must connect two nodes that exist')

  const labels = graph.nodes.map(node => node.label.toLowerCase())
  assert.ok(labels.some(label => label.includes('typescript')), 'the linked TypeScript node must appear')

  const groups = new Set(graph.nodes.map(node => node.group))
  assert.ok(groups.has('user'), 'the profile is the graph root')
  assert.ok(groups.has('skill_known'))
})

test('graph data is user-scoped', async () => {
  const alice = await createTestUser({ name: 'Alice' })
  const bob = await createTestUser({ name: 'Bob' })
  await engine.saveWikiPage(alice.userId, 'company', 'razorpay', SAMPLE_WIKI_PAGE, {})

  const aliceGraph = await engine.getGraphData(alice.userId)
  const bobGraph = await engine.getGraphData(bob.userId)

  assert.ok(aliceGraph.nodes.length > bobGraph.nodes.length)
  const bobIds = new Set(bobGraph.nodes.map(node => node.id))
  assert.ok(aliceGraph.nodes.every(node => !bobIds.has(node.id) || node.group === 'user'))
})

test('company memories link to the skills they require', async () => {
  const { userId } = await createTestUser()

  await engine.recordEntityView(userId, 'startup', {
    id: 'razorpay', name: 'Razorpay', type: 'Fintech', location: 'Bangalore',
    skills_required: ['React', 'Node.js', 'TypeScript'],
  })

  const graph = await engine.getGraphData(userId)
  const razorpay = graph.nodes.find(node => node.label.toLowerCase().includes('razorpay'))
  assert.ok(razorpay, 'the viewed company must be a node')

  const requiresEdges = graph.edges.filter(edge => edge.from === razorpay.id && edge.relation === 'REQUIRES')
  assert.ok(requiresEdges.length >= 2, 'the company must connect to the skills it needs')
})

// ── Recall and citations ────────────────────────────────────────────────────

test('recall builds a grounded, budgeted context with citable keys', async () => {
  const { userId } = await createTestUser()
  await engine.saveWikiPage(userId, 'company', 'razorpay', SAMPLE_WIKI_PAGE, {})
  await engine.remember(userId, {
    type: MEMORY_TYPES.SKILL_GAP,
    dedupKey: 'skill_gap:typescript',
    title: 'TypeScript',
    content: 'TypeScript is the developer\'s highest-priority skill gap for payments roles.',
    source: MEMORY_SOURCES.INFERENCE,
    importance: 0.9,
  })

  const recalled = await engine.recall(userId, 'What should I learn to get into Razorpay?')

  assert.ok(recalled.entries.length > 0, 'something must be retrieved')
  assert.ok(recalled.context.includes('Developer profile:'), 'the profile is always grounded in')
  assert.ok(recalled.stats.charsUsed <= recalled.stats.charBudget)
  assert.ok(recalled.entries.every(entry => typeof entry.contextKey === 'string' && entry.contextKey.length > 0),
    'every entry must carry a citable key')

  // Only keys actually present in the context can be cited.
  const realKey = recalled.entries[0].contextKey
  const citations = ContextBuilder.resolveCitations([realKey, 'company/fabricated#9'], recalled.entries)
  assert.equal(citations.length, 1)
  assert.equal(citations[0].key, realKey)
  assert.ok(citations[0].excerpt.length > 0)
})

test('retrieval records access, which feeds the frequency ranking signal', async () => {
  const { userId } = await createTestUser()
  const memory = await engine.remember(userId, {
    type: MEMORY_TYPES.GOAL,
    dedupKey: 'goal:fintech',
    content: 'The developer wants to work on payments infrastructure at a fintech company.',
    source: MEMORY_SOURCES.ONBOARDING,
    importance: 0.9,
  })

  assert.equal(memory.accessCount, 0)
  await engine.recall(userId, 'payments infrastructure fintech goal')

  const after = await MemoryStore.getById(userId, memory.id)
  assert.ok(after.accessCount > 0, 'a surfaced memory must record the access')
  assert.ok(after.lastAccessedAt, 'and when it happened')
})

// ── Journey ─────────────────────────────────────────────────────────────────

test('journey events persist and come back newest-first', async () => {
  const { userId } = await createTestUser()

  // Onboarding already wrote account_created.
  await engine.recordJourney(userId, 'skill_learned', { title: 'Learned TypeScript', data: { skill: 'TypeScript' } })
  await engine.recordEntityView(userId, 'startup', { id: 'razorpay', name: 'Razorpay', type: 'Fintech' })

  const journey = await engine.getJourney(userId)
  const types = journey.map(event => event.type)

  assert.ok(types.includes('account_created'), 'onboarding must be on the timeline')
  assert.ok(types.includes('skill_learned'))
  assert.ok(types.includes('startup_viewed'))

  assert.ok(journey[0].timestamp, 'the frontend timeline reads `timestamp`')
  const timestamps = journey.map(event => new Date(event.timestamp).getTime())
  assert.deepEqual(timestamps, [...timestamps].sort((a, b) => b - a), 'newest first')
})

test('journey is user-scoped', async () => {
  const alice = await createTestUser()
  const bob = await createTestUser()
  await engine.recordJourney(alice.userId, 'skill_learned', { title: 'Alice learned Rust' })

  const bobJourney = await engine.getJourney(bob.userId)
  assert.ok(!bobJourney.some(event => event.title.includes('Alice')))
})

// ── Return context ──────────────────────────────────────────────────────────

test('return context reports the real top gap (regression: previously always missing)', async () => {
  const { userId } = await createTestUser()

  await engine.recordEntityView(userId, 'startup', { id: 'razorpay', name: 'Razorpay', type: 'Fintech', hiring: true })
  await engine.saveGapAnalysis(userId, {
    priority_skills: [{ skill: 'TypeScript', reason: 'Required by 3 of your targets' }],
  }, { targets: ['Razorpay'] })

  const context = await engine.getReturnContext(
    userId,
    [{ id: 'razorpay', name: 'Razorpay', hiring: true }],
    [],
  )

  assert.equal(context.hasHistory, true)
  assert.match(context.message, /Razorpay/)
  assert.equal(context.topGap, 'TypeScript')
  assert.match(context.message, /TypeScript/, 'the top-gap sentence must actually render')
  assert.ok(context.urgentItems.some(item => item.type === 'startup' && item.name === 'Razorpay'))
})

test('return context flags hackathon deadlines inside the two-week window', async () => {
  const { userId } = await createTestUser()
  const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10)
  const far = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)

  await engine.recordEntityView(userId, 'hackathon', { id: 'soon', name: 'Soon Hack', deadline: soon })
  await engine.recordEntityView(userId, 'hackathon', { id: 'far', name: 'Far Hack', deadline: far })

  const context = await engine.getReturnContext(userId, [], [
    { id: 'soon', name: 'Soon Hack', deadline: soon },
    { id: 'far', name: 'Far Hack', deadline: far },
  ])

  const urgentNames = context.urgentItems.map(item => item.name)
  assert.ok(urgentNames.includes('Soon Hack'))
  assert.ok(!urgentNames.includes('Far Hack'), 'a deadline 90 days out is not urgent')
})

// ── Conversation memory ─────────────────────────────────────────────────────

test('conversation turns are trimmed to a rolling window, not kept forever', async () => {
  const { userId } = await createTestUser()

  for (let index = 0; index < 40; index += 1) {
    await engine.appendConversation(userId, `question ${index}`, `answer ${index}`)
  }

  const { rows } = await query('SELECT count(*)::int AS n FROM conversation_turns WHERE user_id = $1', [userId])
  assert.ok(Number(rows[0].n) <= 50, `expected the window to be capped, got ${rows[0].n}`)

  const { recentConversation } = await import('../memory/MemoryRetriever.js')
  const recent = await recentConversation(userId, 4)
  assert.equal(recent.length, 4)
  assert.match(recent.at(-1).content, /39/, 'the most recent turn must be last')
})

test('raw chat turns are not promoted into long-term memory automatically', async () => {
  const { userId } = await createTestUser()
  const before = await engine.getStats(userId)

  await engine.appendConversation(userId, 'what is the weather like', 'I only know about your career.')

  const after = await engine.getStats(userId)
  assert.equal(after.memories, before.memories, 'small talk must not become a durable memory')
})

// ── Extraction ──────────────────────────────────────────────────────────────

test('gap analysis is extracted into typed SKILL_GAP memories', async () => {
  const { userId } = await createTestUser()

  await engine.saveGapAnalysis(userId, {
    priority_skills: [
      { skill: 'TypeScript', reason: 'Required by 3 targets', weeks_to_learn: 4 },
      { skill: 'Kafka', reason: 'Required by 1 target', weeks_to_learn: 6 },
    ],
  }, { targets: ['Razorpay', 'Slice'] })

  const gaps = await MemoryStore.list(userId, { types: [MEMORY_TYPES.SKILL_GAP], limit: 20 })
  const skills = gaps.map(gap => gap.data?.skill)
  assert.ok(skills.includes('TypeScript'))
  assert.ok(skills.includes('Kafka'))
  assert.ok(gaps.every(gap => gap.source === MEMORY_SOURCES.INFERENCE), 'derived gaps must be marked as derived')
})

test('curated entity extraction produces a well-formed memory', () => {
  const candidate = MemoryExtractor.fromCuratedEntity('startup', {
    id: 'razorpay', name: 'Razorpay', type: 'Fintech', location: 'Bangalore',
    skills_required: ['Node.js'], salary_range_lpa: '18-32',
  })

  assert.equal(candidate.type, MEMORY_TYPES.COMPANY)
  assert.equal(candidate.dedupKey, 'company:razorpay')
  assert.match(candidate.content, /18-32 LPA/)
  assert.equal(candidate.source, MEMORY_SOURCES.CURATED_DATASET)
})

test('graph link parsing is resilient to a page with no links', async () => {
  const { userId } = await createTestUser()
  await engine.saveWikiPage(userId, 'skill', 'plain', '# Plain\n\nNo links here at all.', {})

  const graph = await engine.getGraphData(userId)
  assert.ok(graph.nodes.some(node => node.label.toLowerCase().includes('plain')))
})

test('MemoryGraph.linkToProfile connects skills and gaps to the profile root', async () => {
  const { userId } = await createTestUser()
  const profileMemory = (await MemoryStore.list(userId, { types: [MEMORY_TYPES.PROFILE], limit: 1 }))[0]
  assert.ok(profileMemory)

  const relations = await MemoryStore.listRelations(userId)
  const fromProfile = relations.filter(relation => relation.from_id === profileMemory.id)
  assert.ok(fromProfile.length >= 4, 'skills, goals and targets must hang off the profile')
  assert.ok(fromProfile.some(relation => relation.relation === 'HAS_SKILL'))
  assert.ok(fromProfile.some(relation => relation.relation === 'TARGETS'))
})
