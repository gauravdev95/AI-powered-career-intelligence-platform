/**
 * Embedding service: text in, unit-length vector out.
 *
 * Three layers, in order:
 *   1. Cache      — embeddings are deterministic per (model, text), so caching them
 *                   removes the dominant cost of re-ingest and repeated queries.
 *   2. Provider   — Gemini, batched.
 *   3. Local      — a deterministic hashing encoder used when no API key is set or
 *                   the provider fails. It captures lexical overlap rather than true
 *                   semantics, so retrieval keeps working (with lower recall on
 *                   paraphrases) instead of collapsing. This is what lets the test
 *                   suite exercise real pgvector search without network access.
 *
 * Every vector this module returns is L2-normalised, which makes cosine distance and
 * inner product agree and keeps pgvector's `<=>` operator well behaved.
 */

import { createHash } from 'crypto'
import config from '../config.js'
import * as aiService from './aiService.js'
import { cacheGet, cacheSet } from './cache.js'

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'for', 'of', 'to', 'in',
  'on', 'at', 'by', 'with', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been',
  'it', 'its', 'this', 'that', 'these', 'those', 'you', 'your', 'i', 'we', 'they',
])

/** FNV-1a — fast, stable across processes, good enough for feature hashing. */
function fnv1a(text) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/**
 * Very light suffix stripping. The offline encoder matches on exact tokens, so
 * without this "what are my goals" fails to retrieve a memory phrased "career goal"
 * — a miss a real embedding model would never make. Only applied to longer tokens,
 * so technology names (js, css, go, api) are left intact.
 */
function stem(token) {
  if (token.length < 5) return token
  for (const suffix of ['ings', 'ing', 'ies', 'ers', 'es', 'ed', 's']) {
    if (token.length - suffix.length >= 4 && token.endsWith(suffix)) {
      return suffix === 'ies' ? `${token.slice(0, -3)}y` : token.slice(0, -suffix.length)
    }
  }
  return token
}

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, ' ')
    .split(/\s+/)
    .map(token => token.replace(/^[-.]+|[-.]+$/g, ''))
    .filter(token => token.length > 1 && !STOP_WORDS.has(token))
    .map(stem)
}

export function normalise(vector) {
  let sumSquares = 0
  for (const value of vector) sumSquares += value * value
  if (sumSquares === 0) return vector
  const inverse = 1 / Math.sqrt(sumSquares)
  return vector.map(value => value * inverse)
}

/**
 * Deterministic offline encoder. Uses the hashing trick with a sign bit over word
 * unigrams and bigrams, with sublinear term-frequency scaling.
 */
export function localEmbed(text, dimensions = config.ai.embeddingDimensions) {
  const tokens = tokenize(text)
  const vector = new Array(dimensions).fill(0)
  if (tokens.length === 0) return vector

  const counts = new Map()
  const bump = feature => counts.set(feature, (counts.get(feature) ?? 0) + 1)

  for (let i = 0; i < tokens.length; i += 1) {
    bump(tokens[i])
    if (i + 1 < tokens.length) bump(`${tokens[i]}_${tokens[i + 1]}`)
  }

  for (const [feature, count] of counts) {
    const hash = fnv1a(feature)
    const index = hash % dimensions
    const sign = (hash >>> 31) & 1 ? -1 : 1
    vector[index] += sign * (1 + Math.log(count))
  }

  return normalise(vector)
}

function cacheKey(text, taskType) {
  const digest = createHash('sha256')
    .update(`${config.ai.embeddingModel}:${config.ai.embeddingDimensions}:${taskType}:${text}`)
    .digest('hex')
  return `emb:${digest}`
}

/** Coerces a provider vector to the configured dimension and normalises it. */
function conform(values, dimensions) {
  if (!Array.isArray(values) || values.length === 0) return null
  if (values.length === dimensions) return normalise(values)
  // Truncation is the documented behaviour for Matryoshka-style embedding models;
  // padding covers the (unexpected) short case rather than corrupting the column.
  const sized = values.length > dimensions
    ? values.slice(0, dimensions)
    : [...values, ...new Array(dimensions - values.length).fill(0)]
  return normalise(sized)
}

/**
 * Embeds many texts at once. Returns one vector per input, in order.
 * `taskType` is RETRIEVAL_DOCUMENT for stored content, RETRIEVAL_QUERY for questions.
 */
export async function embedMany(texts, { taskType = 'RETRIEVAL_DOCUMENT' } = {}) {
  const inputs = (Array.isArray(texts) ? texts : [texts]).map(text => String(text ?? '').trim())
  const dimensions = config.ai.embeddingDimensions
  const results = new Array(inputs.length).fill(null)

  // 1. Serve what we can from cache.
  const pending = []
  await Promise.all(inputs.map(async (text, index) => {
    if (!text) {
      results[index] = new Array(dimensions).fill(0)
      return
    }
    const hit = await cacheGet(cacheKey(text, taskType))
    if (Array.isArray(hit) && hit.length === dimensions) {
      results[index] = hit
      return
    }
    pending.push({ text, index })
  }))

  if (pending.length === 0) return results

  // 2. Ask the provider for the rest, in one batch.
  let provided = pending.map(() => null)
  if (aiService.isAvailable()) {
    provided = await aiService.embed(pending.map(item => item.text), { taskType })
  }

  // 3. Fill gaps locally, then write successful embeddings back to cache.
  await Promise.all(pending.map(async (item, slot) => {
    const vector = conform(provided[slot], dimensions) ?? localEmbed(item.text, dimensions)
    results[item.index] = vector
    await cacheSet(cacheKey(item.text, taskType), vector, 60 * 60 * 24 * 7)
  }))

  return results
}

/** Embeds a single text. */
export async function embedOne(text, options = {}) {
  const [vector] = await embedMany([text], options)
  return vector
}

/** Embeds a search query (uses the query-side task type). */
export async function embedQuery(text) {
  return embedOne(text, { taskType: 'RETRIEVAL_QUERY' })
}

/** Cosine similarity for two same-length vectors. Inputs are assumed normalised. */
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export default { embedMany, embedOne, embedQuery, localEmbed, cosineSimilarity, normalise }
