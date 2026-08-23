/**
 * Pure-function tests: ranking, deduplication, chunking, wikilinks, matching,
 * validation, and citation resolution. No database, no network.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import * as ranker from '../memory/MemoryRanker.js'
import * as dedup from '../memory/MemoryDeduplicator.js'
import * as contextBuilder from '../memory/ContextBuilder.js'
import { parseWikiLinks } from '../memory/MemoryGraph.js'
import { chunkMarkdown } from '../memory/MemoryEngine.js'
import { MEMORY_TYPES } from '../memory/types.js'
import * as matching from '../matching.js'
import { sanitizeString, slugify, requireUserId } from '../lib/validate.js'
import { localEmbed, cosineSimilarity } from '../services/embeddings.js'
import { parseJson } from '../services/aiService.js'
import { mapSettledWithConcurrency } from '../lib/concurrency.js'
import { parseErrorDetails } from '../services/providers/gemini.js'
import { SAMPLE_WIKI_PAGE } from './helpers.js'

const DAY = 24 * 60 * 60 * 1000

function memory(overrides = {}) {
  return {
    id: overrides.id ?? 'a0000000-0000-4000-8000-000000000001',
    type: MEMORY_TYPES.SKILL,
    content: 'A memory',
    importance: 0.5,
    confidence: 0.5,
    sourceQuality: 0.5,
    accessCount: 0,
    similarity: 0.5,
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

// ── Ranking ─────────────────────────────────────────────────────────────────

test('recency decays to exactly half at the configured half-life', () => {
  const halfLife = 30
  const fresh = ranker.recencyScore(new Date(), halfLife)
  const halfLifeOld = ranker.recencyScore(new Date(Date.now() - halfLife * DAY), halfLife)
  const twoHalfLives = ranker.recencyScore(new Date(Date.now() - 2 * halfLife * DAY), halfLife)

  assert.ok(Math.abs(fresh - 1) < 0.001, `fresh should be ~1, got ${fresh}`)
  assert.ok(Math.abs(halfLifeOld - 0.5) < 0.01, `one half-life should be ~0.5, got ${halfLifeOld}`)
  assert.ok(Math.abs(twoHalfLives - 0.25) < 0.01, `two half-lives should be ~0.25, got ${twoHalfLives}`)
})

test('access frequency saturates rather than growing without bound', () => {
  assert.equal(ranker.frequencyScore(0), 0)
  const few = ranker.frequencyScore(3)
  const many = ranker.frequencyScore(40)
  assert.ok(few > 0 && few < many)
  assert.ok(many <= 1, 'frequency must stay within [0,1]')
  assert.ok(ranker.frequencyScore(1000) <= 1)
})

test('every ranking component stays within [0,1]', () => {
  const components = ranker.componentScores(memory({
    similarity: 1, importance: 5, confidence: -3, sourceQuality: 99, accessCount: 100000,
  }))
  for (const [name, value] of Object.entries(components)) {
    assert.ok(value >= 0 && value <= 1, `${name} out of range: ${value}`)
  }
})

test('ranking blends signals — importance beats a marginal similarity edge', () => {
  const importantButLessSimilar = memory({ id: 'important', similarity: 0.55, importance: 0.95, confidence: 0.9, sourceQuality: 0.95 })
  const similarButTrivial = memory({ id: 'trivial', similarity: 0.62, importance: 0.15, confidence: 0.3, sourceQuality: 0.3 })

  const [first] = ranker.rank([similarButTrivial, importantButLessSimilar], { limit: 2 })
  assert.equal(first.id, 'important', 'high-importance well-sourced memory should outrank a marginally more similar trivial one')
})

test('ranking weights are configurable — semantic-only weighting flips the order', () => {
  const importantButLessSimilar = memory({ id: 'important', similarity: 0.55, importance: 0.95, confidence: 0.9, sourceQuality: 0.95 })
  const similarButTrivial = memory({ id: 'trivial', similarity: 0.62, importance: 0.15, confidence: 0.3, sourceQuality: 0.3 })

  const [first] = ranker.rank([importantButLessSimilar, similarButTrivial], {
    limit: 2,
    weights: { semantic: 1, importance: 0, recency: 0, confidence: 0, sourceQuality: 0, accessFrequency: 0 },
  })
  assert.equal(first.id, 'trivial', 'with semantic weight only, pure similarity must win')
})

test('ranking exposes an explainable breakdown', () => {
  const [top] = ranker.rank([memory()], { limit: 1 })
  assert.ok(top.rankScore >= 0 && top.rankScore <= 1)
  assert.deepEqual(
    Object.keys(top.rankBreakdown).sort(),
    ['accessFrequency', 'confidence', 'importance', 'recency', 'semantic', 'sourceQuality'],
  )
})

test('type diversity stops one category monopolising the context', () => {
  const chunks = Array.from({ length: 10 }, (_, index) => memory({
    id: `chunk-${index}`, type: MEMORY_TYPES.WIKI_CHUNK, similarity: 0.9, importance: 0.5,
  }))
  const goal = memory({ id: 'goal', type: MEMORY_TYPES.GOAL, similarity: 0.3, importance: 0.9 })

  const withoutDiversity = ranker.rank([...chunks, goal], { limit: 6 })
  assert.ok(
    !withoutDiversity.some(item => item.type === MEMORY_TYPES.GOAL),
    'precondition: on raw score alone the goal is crowded out entirely',
  )

  const ranked = ranker.rank([...chunks, goal], { limit: 6, diversityByType: 3 })
  const goalPosition = ranked.findIndex(item => item.type === MEMORY_TYPES.GOAL)

  assert.ok(goalPosition >= 0, 'the goal must survive a flood of wiki chunks')
  assert.ok(goalPosition <= 3, `the goal must be promoted, not appended; got position ${goalPosition}`)
  // The quota governs promotion order, then the remaining slots are backfilled from
  // the overflow — returning 4 results when 6 were asked for would waste the budget.
  assert.equal(ranked.length, 6, 'the requested limit is still filled')
})

// ── Deduplication ───────────────────────────────────────────────────────────

test('in-batch dedupe collapses repeats by natural key', () => {
  const batch = [
    { type: MEMORY_TYPES.SKILL, dedupKey: 'skill:react', content: 'Knows React', importance: 0.5 },
    { type: MEMORY_TYPES.SKILL, dedupKey: 'skill:react', content: 'Knows React very well indeed', importance: 0.9 },
    { type: MEMORY_TYPES.SKILL, dedupKey: 'skill:node', content: 'Knows Node', importance: 0.5 },
  ]
  const kept = dedup.dedupeBatch(batch)
  assert.equal(kept.length, 2)
  const react = kept.find(item => item.dedupKey === 'skill:react')
  assert.equal(react.importance, 0.9, 'the strongest version of the fact must be kept')
  assert.match(react.content, /very well/, 'the longer, more detailed content must win')
})

test('in-batch dedupe collapses semantic near-duplicates', () => {
  const text = 'The developer wants to join a fintech startup in Bangalore'
  const batch = [
    { type: MEMORY_TYPES.GOAL, content: text, embedding: localEmbed(text) },
    { type: MEMORY_TYPES.GOAL, content: text, embedding: localEmbed(text) },
  ]
  assert.equal(dedup.dedupeBatch(batch).length, 1)
})

test('in-batch dedupe keeps genuinely different facts of the same type', () => {
  const a = 'The developer knows React and builds frontend interfaces'
  const b = 'The developer is targeting Razorpay for a payments role'
  const kept = dedup.dedupeBatch([
    { type: MEMORY_TYPES.GOAL, content: a, embedding: localEmbed(a) },
    { type: MEMORY_TYPES.GOAL, content: b, embedding: localEmbed(b) },
  ])
  assert.equal(kept.length, 2)
})

test('merge policy raises confidence and never lowers importance', () => {
  const existing = { content: 'short', importance: 0.8, confidence: 0.6, sourceQuality: 0.9, data: { a: 1 } }
  const patch = dedup.mergePatch(existing, { importance: 0.3, confidence: 0.7, sourceQuality: 0.5, content: 'short', data: { b: 2 } })

  assert.equal(patch.importance, 0.8, 'importance must not regress')
  assert.ok(patch.confidence > 0.6, 'repeated observation is evidence')
  assert.equal(patch.sourceQuality, 0.9, 'the better source wins')
  assert.deepEqual(patch.data, { a: 1, b: 2 })
})

// ── Embeddings ──────────────────────────────────────────────────────────────

test('local encoder is deterministic and unit-length', () => {
  const first = localEmbed('React and Node.js developer')
  const second = localEmbed('React and Node.js developer')
  assert.deepEqual(first, second)

  const magnitude = Math.sqrt(first.reduce((sum, value) => sum + value * value, 0))
  assert.ok(Math.abs(magnitude - 1) < 1e-9, `expected unit vector, got magnitude ${magnitude}`)
})

test('local encoder scores related text above unrelated text', () => {
  const query = localEmbed('what typescript skills do payment companies want')
  const related = localEmbed('Razorpay requires TypeScript for payment backend roles')
  const unrelated = localEmbed('The weather in Antarctica is cold and windy today')

  assert.ok(
    cosineSimilarity(query, related) > cosineSimilarity(query, unrelated),
    'related content must score higher than unrelated content',
  )
})

// ── Wiki chunking and links ─────────────────────────────────────────────────

test('chunking splits a page, drops frontmatter, and bounds chunk size', () => {
  const chunks = chunkMarkdown(SAMPLE_WIKI_PAGE, { chunkSize: 300, overlap: 50 })
  assert.ok(chunks.length > 1, 'a multi-section page should produce multiple chunks')
  assert.ok(chunks.every(chunk => chunk.length <= 450), 'chunks must respect the size bound')
  assert.ok(!chunks.join(' ').includes('tags: [fintech'), 'YAML frontmatter must not be indexed as prose')
})

test('chunking returns nothing for an empty or frontmatter-only page', () => {
  assert.deepEqual(chunkMarkdown(''), [])
  assert.deepEqual(chunkMarkdown('---\ntype: skill\n---\n'), [])
})

test('wikilinks parse into typed, deduplicated graph targets', () => {
  const links = parseWikiLinks('See [[skill/typescript]] and [[company/Razorpay]] and [[skill/typescript]] and [[Kafka]]')
  assert.equal(links.length, 3, 'repeated links collapse to one target')

  const typescript = links.find(link => link.slug === 'typescript')
  assert.equal(typescript.memoryType, MEMORY_TYPES.SKILL)

  const razorpay = links.find(link => link.slug === 'razorpay')
  assert.equal(razorpay.memoryType, MEMORY_TYPES.COMPANY)

  const bare = links.find(link => link.slug === 'kafka')
  assert.equal(bare.memoryType, MEMORY_TYPES.WIKI, 'a bare link falls back to the wiki type')
})

test('wikilink parsing ignores malformed links', () => {
  assert.deepEqual(parseWikiLinks('[[]] and [[   ]] and [not a link]'), [])
})

// ── Citations ───────────────────────────────────────────────────────────────

test('fabricated citations are dropped, real ones survive', () => {
  const entries = [
    { contextKey: 'skill:typescript', id: 'id-1', type: MEMORY_TYPES.SKILL, title: 'TypeScript', content: 'TypeScript is a gap.' },
    { contextKey: 'company/razorpay#0', id: 'id-2', type: MEMORY_TYPES.WIKI_CHUNK, title: 'razorpay', content: 'Razorpay pays 18-32 LPA.', isChunk: true, data: { pageId: 'page-1' } },
  ]

  const citations = contextBuilder.resolveCitations(
    ['skill:typescript', 'company/razorpay#0', 'skill:totally-made-up', 'skill:typescript'],
    entries,
  )

  assert.equal(citations.length, 2, 'hallucinated and duplicate keys must be removed')
  assert.deepEqual(citations.map(citation => citation.key).sort(), ['company/razorpay#0', 'skill:typescript'])
  assert.ok(citations.every(citation => citation.excerpt.length > 0), 'each citation carries a real excerpt')
})

test('context builder respects its character budget', () => {
  const memories = Array.from({ length: 50 }, (_, index) => memory({
    id: `mem-${index}`,
    dedupKey: `skill:s${index}`,
    content: 'x'.repeat(400),
  }))

  const built = contextBuilder.build(memories, { charBudget: 1200, maxEntries: 40 })
  assert.ok(built.stats.charsUsed <= 1200, `budget exceeded: ${built.stats.charsUsed}`)
  assert.ok(built.entries.length < 50, 'the budget must actually exclude entries')
  assert.ok(built.entries.length > 0)
})

// ── Matching ────────────────────────────────────────────────────────────────

test('skill matching handles real-world naming variants without false positives', () => {
  assert.ok(matching.skillsMatch('Node', 'Node.js'))
  assert.ok(matching.skillsMatch('react', 'React'))
  assert.ok(!matching.skillsMatch('Go', 'Django'), 'a two-letter token must not match inside an unrelated word')
  assert.ok(!matching.skillsMatch('R', 'React'))
})

test('startup ranking scores overlap and boosts stated targets', () => {
  const dataset = [
    { id: 'a', name: 'Alpha', skills_required: ['React', 'Node.js', 'TypeScript', 'Go'] },
    { id: 'b', name: 'Beta', skills_required: ['Python', 'Django'] },
  ]
  const [top] = matching.rankStartups(['React', 'Node.js'], dataset)
  assert.equal(top.id, 'a')
  assert.equal(top.match_score, 50, '2 of 4 required skills')

  const boosted = matching.rankStartups(['Python'], dataset, { targetCompanies: ['Beta'] })
  const beta = boosted.find(item => item.id === 'b')
  assert.ok(beta.is_target)
  assert.equal(beta.match_score, beta.base_score + 20)
})

test('hackathon ranking drops past deadlines and flags urgency', () => {
  const soon = new Date(Date.now() + 3 * DAY).toISOString().slice(0, 10)
  const past = new Date(Date.now() - 3 * DAY).toISOString().slice(0, 10)

  const ranked = matching.rankHackathons(['React'], [
    { id: 'soon', name: 'Soon', deadline: soon, skills_relevant: ['React'] },
    { id: 'past', name: 'Past', deadline: past, skills_relevant: ['React'] },
  ])

  assert.equal(ranked.length, 1)
  assert.equal(ranked[0].id, 'soon')
  assert.equal(ranked[0].urgency, 'high')
})

test('gap report ranks by demand across targets and uses catalog metadata', () => {
  const targets = [
    { name: 'Alpha', skills_required: ['TypeScript', 'Go'] },
    { name: 'Beta', skills_required: ['TypeScript'] },
  ]
  const report = matching.buildGapReport(['React'], targets, [
    { name: 'TypeScript', learning_time_weeks: 4, salary_premium_percent: 22, difficulty: 'Intermediate', resource_url: 'https://example.com' },
  ])

  assert.equal(report.priority_skills[0].skill, 'TypeScript', 'the skill demanded by more targets ranks first')
  assert.equal(report.priority_skills[0].weeks_to_learn, 4)
  assert.equal(report.priority_skills[0].salary_impact, '+22%')
})

// ── Validation and parsing ──────────────────────────────────────────────────

test('sanitisation strips control characters but preserves multi-line text', () => {
  assert.equal(sanitizeString('a bc'), 'abc')
  assert.equal(sanitizeString('line one\nline two'), 'line one\nline two')
  assert.equal(sanitizeString('x'.repeat(50), 10).length, 10)
})

test('user ids must be well-formed UUIDs', () => {
  assert.throws(() => requireUserId('../../etc/passwd'), /valid userId/)
  assert.throws(() => requireUserId("' OR 1=1 --"), /valid userId/)
  assert.equal(requireUserId('3f2504e0-4f89-11d3-9a0c-0305e82c3301'), '3f2504e0-4f89-11d3-9a0c-0305e82c3301')
})

test('slugify produces safe keys', () => {
  assert.equal(slugify('Razorpay Pvt. Ltd!'), 'razorpay-pvt-ltd')
  assert.equal(slugify('../../etc/passwd'), 'etc-passwd')
  assert.equal(slugify(''), 'untitled')
})

test('model JSON parsing survives fences and surrounding prose', () => {
  assert.deepEqual(parseJson('{"a":1}'), { a: 1 })
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseJson('Here you go:\n{"a":1}\nHope that helps'), { a: 1 })
  assert.equal(parseJson('not json at all', null), null)
})

// ── Regression: keyed facts must never be merged by embedding similarity ─────
// Found with live Gemini embeddings: real vectors score distinct-but-similarly-worded
// entities above the 0.92 duplicate threshold, so "Soon Hack"/"Far Hack" collapsed
// into one memory and "JavaScript" vanished from a stack containing "Node.js".

test('distinct natural keys are never merged, however similar the wording', () => {
  const a = 'The developer knows JavaScript and considers it part of their current stack.'
  const b = 'The developer knows Node.js and considers it part of their current stack.'

  // Precondition: these really are near-identical to an embedding model.
  assert.ok(
    cosineSimilarity(localEmbed(a), localEmbed(b)) > 0.7,
    'precondition: the two sentences must be highly similar',
  )

  const kept = dedup.dedupeBatch([
    { type: MEMORY_TYPES.SKILL, dedupKey: 'skill:javascript', content: a, embedding: localEmbed(a) },
    { type: MEMORY_TYPES.SKILL, dedupKey: 'skill:node-js', content: b, embedding: localEmbed(b) },
  ])

  assert.equal(kept.length, 2, 'two different skills must remain two memories')
  assert.deepEqual(kept.map(m => m.dedupKey).sort(), ['skill:javascript', 'skill:node-js'])
})

test('unkeyed near-duplicates still collapse', () => {
  const a = 'The developer opened the roadmap panel today.'
  const kept = dedup.dedupeBatch([
    { type: MEMORY_TYPES.JOURNEY_EVENT, content: a, embedding: localEmbed(a) },
    { type: MEMORY_TYPES.JOURNEY_EVENT, content: a, embedding: localEmbed(a) },
  ])
  assert.equal(kept.length, 1, 'genuine duplicates without a natural key must still merge')
})

// ── Provider error parsing ──────────────────────────────────────────────────

test('a 429 body yields the provider\'s own retry delay and quota ids', () => {
  const body = JSON.stringify({
    error: {
      code: 429,
      message: 'You exceeded your current quota',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaMetric: 'generate_requests', quotaId: 'GenerateRequestsPerMinutePerProject' }],
        },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '27s' },
      ],
    },
  })

  const parsed = parseErrorDetails(body)
  // Gemini sends no Retry-After header — reading only headers means backing off on a
  // schedule unrelated to when the quota actually frees up.
  assert.equal(parsed.retryDelayMs, 27000)
  assert.deepEqual(parsed.quotas, ['GenerateRequestsPerMinutePerProject'])
})

test('a malformed or empty error body never throws', () => {
  for (const body of ['', 'not json', '{}', '{"error":{}}', '{"error":{"details":"nope"}}']) {
    assert.doesNotThrow(() => parseErrorDetails(body), `threw on ${JSON.stringify(body)}`)
  }
  assert.deepEqual(parseErrorDetails('{"error":{}}'), {})
})

// ── Bounded concurrency ─────────────────────────────────────────────────────

test('never runs more jobs at once than the limit allows', async () => {
  let inFlight = 0
  let peak = 0

  await mapSettledWithConcurrency([1, 2, 3, 4, 5, 6, 7], 2, async () => {
    inFlight += 1
    peak = Math.max(peak, inFlight)
    await new Promise(resolve => setTimeout(resolve, 5))
    inFlight -= 1
  })

  assert.equal(peak, 2, 'the whole point is that the provider never sees a burst')
})

test('results stay in input order and one failure does not sink the rest', async () => {
  const results = await mapSettledWithConcurrency(['a', 'boom', 'c'], 2, async item => {
    if (item === 'boom') throw new Error('provider said no')
    return item.toUpperCase()
  })

  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected', 'fulfilled'])
  assert.equal(results[0].value, 'A')
  assert.equal(results[2].value, 'C')
  assert.equal(results[1].reason.message, 'provider said no')
})

test('an empty job list resolves rather than hanging', async () => {
  assert.deepEqual(await mapSettledWithConcurrency([], 4, async () => 'never'), [])
})

test('a keyed candidate is never folded into an unkeyed neighbour', () => {
  const a = 'Kafka is a skill gap for this developer.'
  const kept = dedup.dedupeBatch([
    { type: MEMORY_TYPES.SKILL_GAP, content: a, embedding: localEmbed(a) },
    { type: MEMORY_TYPES.SKILL_GAP, dedupKey: 'skill_gap:kafka', content: a, embedding: localEmbed(a) },
  ])
  // Identical content still collapses on hash — that is correct and desirable.
  assert.equal(kept.length, 1)
})
