/**
 * MemoryDeduplicator — decides what happens when a new observation resembles
 * something already remembered.
 *
 * Without this, every re-ingest of the same job posting and every restatement of
 * the same goal would pile up as separate memories, and retrieval would return the
 * same fact ten times, crowding out everything else.
 *
 * Five outcomes:
 *   skip       — byte-identical to an active memory; only bump its access stats.
 *   reinforce  — semantically the same fact from a new observation; merge upward
 *                (confidence and importance rise, best source wins).
 *   supersede  — same natural key, materially different content; the new memory
 *                becomes truth and the old one is retained as SUPERSEDED.
 *   conflict   — same key, contradictory content, and the existing memory is better
 *                evidenced; both are flagged for resolution rather than silently
 *                picking a winner.
 *   insert     — genuinely novel.
 */

import config from '../config.js'
import { cosineSimilarity } from '../services/embeddings.js'
import * as store from './MemoryStore.js'
import { MEMORY_STATUS, SINGLETON_TYPES } from './types.js'

export const ACTIONS = Object.freeze({
  SKIP: 'skip',
  REINFORCE: 'reinforce',
  SUPERSEDE: 'supersede',
  CONFLICT: 'conflict',
  INSERT: 'insert',
})

/**
 * How much better-evidenced the existing memory must be before we refuse to
 * overwrite it and flag a conflict instead. Prevents a low-quality scrape from
 * quietly replacing something the developer told us directly.
 */
const EVIDENCE_MARGIN = 0.25

function evidenceScore(memory) {
  return (memory.confidence * 0.6) + (memory.sourceQuality * 0.4)
}

/** Normalised content comparison, insensitive to whitespace and case. */
function sameText(a, b) {
  const canon = text => String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  return canon(a) === canon(b)
}

/**
 * Resolves a candidate memory against what is already stored.
 * `candidate` must carry `type`, `content` and (ideally) `embedding`.
 */
export async function resolve(userId, candidate) {
  const hash = candidate.contentHash ?? store.contentHash(candidate.type, candidate.content)

  // 1. Exact content match — cheapest and most common case on re-ingest.
  const exact = await store.findByHash(userId, hash)
  if (exact) {
    return { action: ACTIONS.SKIP, existing: exact, reason: 'identical content already stored' }
  }

  // 2. Natural-key match — this fact has a canonical slot (e.g. skill:react).
  if (candidate.dedupKey) {
    const keyed = await store.findByDedupKey(userId, candidate.type, candidate.dedupKey)
    if (keyed) {
      if (sameText(keyed.content, candidate.content)) {
        return { action: ACTIONS.REINFORCE, existing: keyed, reason: 'same fact restated' }
      }
      const existingEvidence = evidenceScore(keyed)
      const candidateEvidence = evidenceScore(candidate)

      if (SINGLETON_TYPES.has(candidate.type) && existingEvidence - candidateEvidence > EVIDENCE_MARGIN) {
        return {
          action: ACTIONS.CONFLICT,
          existing: keyed,
          reason: `existing memory is better evidenced (${existingEvidence.toFixed(2)} vs ${candidateEvidence.toFixed(2)})`,
        }
      }
      return { action: ACTIONS.SUPERSEDE, existing: keyed, reason: 'newer statement of a keyed fact' }
    }
  }

  // 3. Semantic near-duplicate — catches the same fact worded differently.
  //
  // Only for candidates with NO natural key. A candidate that carries an explicit
  // dedupKey which matched nothing above is, by definition, a distinct fact:
  // `skill:javascript` is not `skill:node-js` however similarly the two sentences
  // read. Running the similarity check on keyed candidates merges genuinely
  // different entities — with real embeddings it collapsed two separate hackathons
  // whose descriptions differed only by name.
  if (!candidate.dedupKey && Array.isArray(candidate.embedding)) {
    const neighbours = await store.vectorSearch(userId, candidate.embedding, {
      types: [candidate.type],
      limit: 5,
      minSimilarity: config.memory.duplicateSimilarityThreshold,
    })
    // Never fold into a memory that holds a natural key of its own, for the same reason.
    const nearest = neighbours.find(memory => !memory.dedupKey)
    if (nearest) {
      return {
        action: ACTIONS.REINFORCE,
        existing: nearest,
        reason: `semantically equivalent (similarity ${nearest.similarity?.toFixed(3)})`,
      }
    }
  }

  return { action: ACTIONS.INSERT, existing: null, reason: 'novel memory' }
}

/**
 * Merge policy for reinforcement: repeated independent observation is evidence, so
 * confidence and importance move up (never down) and the better source wins. The
 * longer content is kept — it usually carries more detail.
 */
export function mergePatch(existing, candidate) {
  const patch = {
    type: existing.type,
    importance: Math.max(existing.importance, candidate.importance ?? 0),
    confidence: Math.min(1, Math.max(existing.confidence, candidate.confidence ?? 0) + 0.05),
    sourceQuality: Math.max(existing.sourceQuality, candidate.sourceQuality ?? 0),
  }

  if (candidate.content && candidate.content.length > existing.content.length * 1.2) {
    patch.content = candidate.content
  }
  if ((candidate.sourceQuality ?? 0) > existing.sourceQuality) {
    patch.source = candidate.source
  }
  if (candidate.data && Object.keys(candidate.data).length) {
    patch.data = { ...existing.data, ...candidate.data }
  }
  // Re-embed only when the stored text actually changed.
  if (patch.content && Array.isArray(candidate.embedding)) {
    patch.embedding = candidate.embedding
  }
  return patch
}

/**
 * Collapses duplicates *within* one batch before any of it is written, so a single
 * ingest that mentions "React" five times produces one memory rather than five
 * round-trips that each discover the previous one.
 */
export function dedupeBatch(candidates, { threshold = config.memory.duplicateSimilarityThreshold } = {}) {
  const kept = []

  for (const candidate of candidates) {
    const hash = candidate.contentHash ?? store.contentHash(candidate.type, candidate.content)
    const duplicate = kept.find(existing => {
      if (existing.contentHash === hash) return true
      if (existing.type !== candidate.type) return false
      if (candidate.dedupKey && existing.dedupKey === candidate.dedupKey) return true
      // Distinct natural keys are distinct facts — never let embedding similarity
      // override that. `skill:javascript` and `skill:node-js` describe the same
      // developer in near-identical words and score above any sane threshold.
      if (candidate.dedupKey || existing.dedupKey) return false
      if (!Array.isArray(existing.embedding) || !Array.isArray(candidate.embedding)) return false
      return cosineSimilarity(existing.embedding, candidate.embedding) >= threshold
    })

    if (duplicate) {
      // Keep the strongest version of the fact.
      duplicate.importance = Math.max(duplicate.importance ?? 0, candidate.importance ?? 0)
      duplicate.confidence = Math.max(duplicate.confidence ?? 0, candidate.confidence ?? 0)
      if ((candidate.content?.length ?? 0) > (duplicate.content?.length ?? 0)) {
        duplicate.content = candidate.content
        duplicate.contentHash = hash
      }
      continue
    }
    kept.push({ ...candidate, contentHash: hash })
  }

  return kept
}

/** Convenience predicate used by tests and diagnostics. */
export function isDuplicateStatus(status) {
  return status === MEMORY_STATUS.SUPERSEDED || status === MEMORY_STATUS.ARCHIVED
}

export default { ACTIONS, resolve, mergePatch, dedupeBatch, isDuplicateStatus }
