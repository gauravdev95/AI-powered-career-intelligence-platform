/**
 * MemoryRanker — turns a candidate set into an ordered shortlist.
 *
 * Vector similarity alone is a poor ordering for a career assistant: it cannot tell
 * that "I want to join Razorpay" (stated in onboarding, high confidence, central to
 * everything) matters more than a sentence scraped from a job ad that happens to use
 * similar words. So similarity is one of six signals:
 *
 *   semantic         cosine similarity to the query
 *   importance       how central this fact is to the user's career
 *   recency          exponential decay — stale career facts genuinely do matter less
 *   confidence       how sure we are the fact is true
 *   sourceQuality    how much we trust the channel it arrived through
 *   accessFrequency  how often it has actually proven useful
 *
 * All weights come from config and are normalised at use-time, so tuning is an env
 * change. Every component score is in [0, 1], which makes the final score directly
 * comparable across queries and explainable in the returned breakdown.
 */

import config from '../config.js'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Exponential decay with a configurable half-life. 1.0 today, 0.5 at the half-life. */
export function recencyScore(timestamp, halfLifeDays = config.memory.recencyHalfLifeDays) {
  if (!timestamp) return 0
  const then = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime()
  if (!Number.isFinite(then)) return 0
  const ageDays = Math.max(0, (Date.now() - then) / MS_PER_DAY)
  return 2 ** (-ageDays / Math.max(halfLifeDays, 0.001))
}

/**
 * Saturating curve over raw access counts: the difference between 0 and 3 accesses
 * is meaningful, between 40 and 43 is not. log1p keeps early growth fast and caps
 * the contribution so a single hot memory cannot dominate forever.
 */
export function frequencyScore(accessCount) {
  const count = Number(accessCount) || 0
  if (count <= 0) return 0
  return Math.min(1, Math.log1p(count) / Math.log1p(20))
}

/** Cosine similarity arrives in [-1, 1]; map to [0, 1] without discarding sign. */
export function similarityScore(similarity) {
  if (similarity == null) return 0
  return Math.min(1, Math.max(0, (Number(similarity) + 1) / 2))
}

function normalisedWeights(overrides) {
  const weights = { ...config.memory.rankingWeights, ...overrides }
  const total = Object.values(weights).reduce((sum, value) => sum + (Number(value) || 0), 0)
  if (total <= 0) throw new Error('Ranking weights must sum to more than zero')
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, (Number(value) || 0) / total]))
}

/** Computes the six component scores for one memory. */
export function componentScores(memory) {
  return {
    semantic: similarityScore(memory.similarity),
    importance: Math.min(1, Math.max(0, Number(memory.importance) || 0)),
    recency: recencyScore(memory.lastAccessedAt ?? memory.updatedAt ?? memory.createdAt),
    confidence: Math.min(1, Math.max(0, Number(memory.confidence) || 0)),
    sourceQuality: Math.min(1, Math.max(0, Number(memory.sourceQuality) || 0)),
    accessFrequency: frequencyScore(memory.accessCount),
  }
}

/** Scores one memory, returning the blended value and its explainable breakdown. */
export function score(memory, { weights } = {}) {
  const normalised = normalisedWeights(weights)
  const components = componentScores(memory)
  const total = Object.entries(components)
    .reduce((sum, [signal, value]) => sum + value * (normalised[signal] ?? 0), 0)

  return {
    score: Number(total.toFixed(6)),
    components,
    weights: normalised,
  }
}

/**
 * Ranks candidates and returns the top `limit`.
 *
 * `typeBoosts` lets a caller nudge whole categories for a specific question without
 * touching global weights — e.g. a hackathon question boosts HACKATHON memories.
 * `diversityByType` caps how many results one type may occupy, so a user with 200
 * wiki chunks still sees their goals and gaps in the context window.
 */
export function rank(memories, {
  limit = config.memory.retrievalTopK,
  weights,
  typeBoosts = null,
  diversityByType = null,
} = {}) {
  const scored = memories.map(memory => {
    const result = score(memory, { weights })
    const boost = typeBoosts?.[memory.type] ?? 0
    return {
      ...memory,
      rankScore: Number(Math.min(1, result.score + boost).toFixed(6)),
      rankBreakdown: result.components,
    }
  })

  scored.sort((a, b) => {
    if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore
    // Stable, meaningful tiebreak: prefer the more important, then the more recent.
    if (b.importance !== a.importance) return b.importance - a.importance
    return new Date(b.updatedAt ?? 0) - new Date(a.updatedAt ?? 0)
  })

  if (!diversityByType) return scored.slice(0, limit)

  const perType = new Map()
  const selected = []
  const overflow = []

  for (const memory of scored) {
    const used = perType.get(memory.type) ?? 0
    if (used < diversityByType) {
      perType.set(memory.type, used + 1)
      selected.push(memory)
      if (selected.length >= limit) break
    } else {
      overflow.push(memory)
    }
  }
  // Backfill from the overflow if quotas left us short of the limit.
  return [...selected, ...overflow].slice(0, limit)
}

export default { rank, score, componentScores, recencyScore, frequencyScore, similarityScore }
