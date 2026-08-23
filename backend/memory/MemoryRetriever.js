/**
 * MemoryRetriever — finds the candidate memories that could answer a query.
 *
 * Retrieval is hybrid on purpose. Embeddings are good at paraphrase ("what should I
 * learn next" → a SKILL_GAP memory) but bad at rare literals: a company name like
 * "Zerodha" or an acronym like "DSA" can sit below the similarity floor while being
 * exactly what the user asked about. So we union three sources:
 *
 *   1. Vector search over memories   (semantic)
 *   2. Vector search over wiki chunks (semantic, document-grounded)
 *   3. Keyword search                 (literal safety net)
 *
 * The union is deduplicated and handed to MemoryRanker. Retrieval decides *what could
 * be relevant*; ranking decides *what actually goes in the prompt*.
 *
 * Every query is scoped to one user_id at the SQL level — see MemoryStore.
 */

import config from '../config.js'
import { query, toVectorLiteral } from '../db/pool.js'
import { embedQuery } from '../services/embeddings.js'
import * as store from './MemoryStore.js'
import { MEMORY_TYPES } from './types.js'

/**
 * Semantic search across wiki chunks. Chunks are the retrieval unit for wiki content:
 * a whole page is too coarse to rank and too large to fit in a context budget.
 */
export async function searchWikiChunks(userId, embedding, {
  limit = 20,
  minSimilarity = config.memory.retrievalMinSimilarity,
} = {}) {
  const literal = toVectorLiteral(embedding)
  if (!literal) return []

  const { rows } = await query(
    `SELECT c.id, c.page_id, c.page_key, c.chunk_index, c.content, c.created_at,
            p.page_type, p.page_name, p.meta, p.updated_at,
            1 - (c.embedding <=> $2::vector) AS similarity
       FROM wiki_chunks c
       JOIN wiki_pages p ON p.id = c.page_id AND p.user_id = c.user_id
      WHERE c.user_id = $1
        AND c.embedding IS NOT NULL
        AND 1 - (c.embedding <=> $2::vector) >= $3
      ORDER BY c.embedding <=> $2::vector
      LIMIT $4`,
    [userId, literal, minSimilarity, Math.min(limit, 100)],
  )

  // Presented as WIKI_CHUNK memories so ranking and context building treat every
  // candidate uniformly, regardless of which table it came from.
  return rows.map(row => ({
    id: row.id,
    userId,
    type: MEMORY_TYPES.WIKI_CHUNK,
    key: row.page_key,
    title: row.page_name,
    content: row.content,
    data: { pageId: row.page_id, pageKey: row.page_key, pageType: row.page_type, chunkIndex: row.chunk_index },
    similarity: Number(row.similarity),
    // Wiki chunks inherit fixed mid-range scores: they are evidence, not assertions
    // the user made about themselves.
    importance: 0.5,
    confidence: 0.7,
    sourceQuality: 0.6,
    accessCount: 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isChunk: true,
  }))
}

/** Merges candidate lists, keeping the highest similarity seen for each id. */
function mergeCandidates(...lists) {
  const byId = new Map()
  for (const list of lists) {
    for (const candidate of list) {
      const existing = byId.get(candidate.id)
      if (!existing) {
        byId.set(candidate.id, candidate)
        continue
      }
      if ((candidate.similarity ?? 0) > (existing.similarity ?? 0)) {
        byId.set(candidate.id, { ...existing, similarity: candidate.similarity })
      }
    }
  }
  return [...byId.values()]
}

/**
 * Retrieves candidates for a natural-language query.
 *
 * Returns raw candidates — deliberately unranked, so the caller can apply
 * question-specific boosts before ranking.
 */
export async function retrieve(userId, questionText, {
  types = null,
  includeWiki = true,
  includeKeyword = true,
  candidateLimit = config.memory.retrievalCandidateLimit,
  minSimilarity = config.memory.retrievalMinSimilarity,
  embedding = null,
} = {}) {
  const vector = embedding ?? await embedQuery(questionText)

  const [memories, chunks, keywords] = await Promise.all([
    store.vectorSearch(userId, vector, { types, limit: candidateLimit, minSimilarity }),
    includeWiki
      ? searchWikiChunks(userId, vector, { limit: Math.ceil(candidateLimit / 2), minSimilarity })
      : Promise.resolve([]),
    includeKeyword
      ? store.keywordSearch(userId, extractLiteral(questionText), { types, limit: 10 })
      : Promise.resolve([]),
  ])

  return {
    candidates: mergeCandidates(memories, chunks, keywords),
    embedding: vector,
    counts: { memories: memories.length, chunks: chunks.length, keywords: keywords.length },
  }
}

/**
 * Picks the most distinctive term from a question for the literal safety net.
 * Proper nouns and capitalised tokens are the ones embeddings most often blur.
 */
export function extractLiteral(text) {
  const raw = String(text ?? '')
  const proper = raw.match(/\b[A-Z][a-zA-Z0-9.+#-]{2,}\b/g) ?? []
  const candidates = proper.filter(token => !/^(What|Which|How|Why|When|Where|Who|Should|Are|Is|Do|Does|My|The|I)$/i.test(token))
  if (candidates.length) return candidates.sort((a, b) => b.length - a.length)[0]

  const words = raw.toLowerCase().match(/\b[a-z0-9.+#-]{4,}\b/g) ?? []
  return words.sort((a, b) => b.length - a.length)[0] ?? ''
}

/**
 * Loads the memories that describe who the user is. These are injected into every
 * context regardless of similarity — a career answer that ignores the user's goals
 * and stack is not grounded, however well it matches the question's wording.
 */
export async function retrieveCoreProfile(userId, { limit = 12 } = {}) {
  return store.list(userId, {
    types: [
      MEMORY_TYPES.PROFILE,
      MEMORY_TYPES.GOAL,
      MEMORY_TYPES.TARGET_COMPANY,
      MEMORY_TYPES.PREFERENCE,
    ],
    limit,
  })
}

/** Recent conversation turns — short-term memory, newest last. */
export async function recentConversation(userId, limit = config.memory.conversationWindow) {
  const { rows } = await query(
    `SELECT role, content, created_at FROM conversation_turns
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, Math.min(limit, 50)],
  )
  return rows.reverse().map(row => ({ role: row.role, content: row.content, createdAt: row.created_at }))
}

export default { retrieve, searchWikiChunks, retrieveCoreProfile, recentConversation, extractLiteral }
