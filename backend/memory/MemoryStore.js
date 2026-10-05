/**
 * MemoryStore — durable persistence for memories and their relationships.
 *
 * This is the only module that writes to the `memories` and `memory_relations`
 * tables. Two invariants hold for every method here:
 *
 *   1. user_id is a mandatory parameter and appears in the WHERE clause of every
 *      statement. There is no method that can read or mutate a memory without
 *      naming its owner, so cross-user leakage is structurally impossible rather
 *      than merely unlikely.
 *   2. All SQL is parameterised. No caller-supplied value is ever interpolated.
 */

import { createHash } from 'crypto'
import { query, queryOne, toVectorLiteral, withTransaction } from '../db/pool.js'
import config from '../config.js'
import {
  MEMORY_STATUS, MEMORY_SOURCES, defaultImportance, sourceQuality, isMemoryType,
} from './types.js'
import { clamp } from '../lib/validate.js'

const COLUMNS = `
  id, user_id, type, dedup_key, title, content, data,
  importance, confidence, source, source_quality, status, superseded_by,
  content_hash, access_count, last_accessed_at, created_at, updated_at
`

/** Stable fingerprint of a memory's meaning, used for exact-duplicate detection. */
export function contentHash(type, content) {
  const canonical = String(content ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  return createHash('sha256').update(`${type}::${canonical}`).digest('hex')
}

/** Applies defaults and clamps every scored field into range. */
function normaliseInput(memory) {
  if (!isMemoryType(memory.type)) {
    throw new Error(`Unknown memory type "${memory.type}"`)
  }
  const source = memory.source ?? MEMORY_SOURCES.SYSTEM
  const content = String(memory.content ?? '').trim()
  if (!content) throw new Error('A memory must have content')

  return {
    type: memory.type,
    dedupKey: memory.dedupKey ? String(memory.dedupKey).slice(0, 200) : null,
    title: String(memory.title ?? '').slice(0, 300),
    content,
    data: memory.data ?? {},
    importance: clamp(memory.importance ?? defaultImportance(memory.type), 0, 1, 0.5),
    confidence: clamp(memory.confidence ?? 0.7, 0, 1, 0.7),
    source,
    sourceQuality: clamp(memory.sourceQuality ?? sourceQuality(source), 0, 1, 0.4),
    status: memory.status ?? MEMORY_STATUS.ACTIVE,
    contentHash: memory.contentHash ?? contentHash(memory.type, content),
    embedding: memory.embedding ?? null,
  }
}

/** Converts a database row into the shape the rest of the engine works with. */
export function rowToMemory(row) {
  if (!row) return null
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    dedupKey: row.dedup_key,
    title: row.title,
    content: row.content,
    data: typeof row.data === 'string' ? JSON.parse(row.data) : (row.data ?? {}),
    importance: Number(row.importance),
    confidence: Number(row.confidence),
    source: row.source,
    sourceQuality: Number(row.source_quality),
    status: row.status,
    supersededBy: row.superseded_by,
    contentHash: row.content_hash,
    accessCount: Number(row.access_count ?? 0),
    lastAccessedAt: row.last_accessed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.similarity != null ? { similarity: Number(row.similarity) } : {}),
  }
}

// ── Users ───────────────────────────────────────────────────────────────────

export async function createUser(userId, profile = {}) {
  const row = await queryOne(
    `INSERT INTO users (user_id, name, experience, target_role, timeline, learning_style, email, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id) DO UPDATE
       SET name           = EXCLUDED.name,
           experience     = EXCLUDED.experience,
           target_role    = EXCLUDED.target_role,
           timeline       = EXCLUDED.timeline,
           learning_style = EXCLUDED.learning_style,
           email          = COALESCE(EXCLUDED.email, users.email),
           password_hash  = COALESCE(EXCLUDED.password_hash, users.password_hash),
           updated_at     = now()
     RETURNING *`,
    [
      userId,
      profile.name ?? 'Developer',
      profile.experience ?? '0-1 years',
      profile.targetRole ?? '',
      profile.timeline ?? '',
      profile.learningStyle ?? '',
      profile.email ?? null,
      profile.passwordHash ?? null,
    ],
  )
  return row
}

/** Case-insensitive lookup — emails are stored lowercased. */
export async function findUserByEmail(email) {
  if (!email) return null
  return queryOne('SELECT * FROM users WHERE email = $1', [email])
}

/**
 * Attaches (or replaces) credentials on an existing user. Used when a guest
 * upgrades to an account via signup, and for password changes.
 */
export async function setUserCredentials(userId, { email, passwordHash }) {
  return queryOne(
    `UPDATE users
       SET email = $2, password_hash = $3, updated_at = now()
     WHERE user_id = $1
     RETURNING *`,
    [userId, email ?? null, passwordHash ?? null],
  )
}

export async function getUserRow(userId) {
  return queryOne('SELECT * FROM users WHERE user_id = $1', [userId])
}

export async function userExists(userId) {
  const row = await queryOne('SELECT 1 AS present FROM users WHERE user_id = $1', [userId])
  return Boolean(row)
}

export async function touchUserVisit(userId) {
  await query('UPDATE users SET last_visit_at = now(), updated_at = now() WHERE user_id = $1', [userId])
}

export async function updateUserProfile(userId, patch) {
  const fields = []
  const params = [userId]
  const push = (column, value) => {
    if (value === undefined) return
    params.push(value)
    fields.push(`${column} = $${params.length}`)
  }
  push('name', patch.name)
  push('experience', patch.experience)
  push('target_role', patch.targetRole)
  push('timeline', patch.timeline)
  push('learning_style', patch.learningStyle)
  if (fields.length === 0) return getUserRow(userId)

  return queryOne(
    `UPDATE users SET ${fields.join(', ')}, updated_at = now() WHERE user_id = $1 RETURNING *`,
    params,
  )
}

export async function deleteUser(userId) {
  // Cascades through memories, relations, wiki, journey and conversations.
  const { rowCount } = await query('DELETE FROM users WHERE user_id = $1', [userId])
  return rowCount
}

// ── Memory writes ───────────────────────────────────────────────────────────

export async function insert(userId, memory) {
  const input = normaliseInput(memory)
  const row = await queryOne(
    `INSERT INTO memories
       (user_id, type, dedup_key, title, content, data, importance, confidence,
        source, source_quality, status, content_hash, embedding)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13::vector)
     RETURNING ${COLUMNS}`,
    [
      userId, input.type, input.dedupKey, input.title, input.content,
      JSON.stringify(input.data), input.importance, input.confidence,
      input.source, input.sourceQuality, input.status, input.contentHash,
      toVectorLiteral(input.embedding),
    ],
  )
  return rowToMemory(row)
}

/**
 * Updates an existing memory in place. Used when a new observation reinforces or
 * refines a fact rather than replacing it — confidence and importance move toward
 * the higher of the two values, because repeated observation is evidence.
 */
export async function update(userId, id, patch) {
  const fields = []
  const params = [userId, id]
  const push = (fragment, value) => {
    params.push(value)
    fields.push(fragment.replace('$?', `$${params.length}`))
  }

  if (patch.content !== undefined) {
    push('content = $?', patch.content)
    push('content_hash = $?', contentHash(patch.type ?? 'UNKNOWN', patch.content))
  }
  if (patch.title !== undefined) push('title = $?', patch.title)
  if (patch.data !== undefined) push('data = $?::jsonb', JSON.stringify(patch.data))
  if (patch.importance !== undefined) push('importance = GREATEST(importance, $?)', clamp(patch.importance, 0, 1, 0.5))
  if (patch.confidence !== undefined) push('confidence = GREATEST(confidence, $?)', clamp(patch.confidence, 0, 1, 0.5))
  if (patch.sourceQuality !== undefined) push('source_quality = GREATEST(source_quality, $?)', clamp(patch.sourceQuality, 0, 1, 0.4))
  if (patch.source !== undefined) push('source = $?', patch.source)
  if (patch.status !== undefined) push('status = $?', patch.status)
  if (patch.embedding !== undefined) push('embedding = $?::vector', toVectorLiteral(patch.embedding))

  if (fields.length === 0) return getById(userId, id)

  const row = await queryOne(
    `UPDATE memories SET ${fields.join(', ')}, updated_at = now()
      WHERE user_id = $1 AND id = $2
      RETURNING ${COLUMNS}`,
    params,
  )
  return rowToMemory(row)
}

/**
 * Retires `oldId` in favour of `newId`, atomically. Both must belong to `userId`.
 * The old row is kept so the memory's history stays auditable.
 */
export async function supersede(userId, oldId, newId) {
  return withTransaction(async tx => {
    const { rowCount } = await tx.query(
      `UPDATE memories
          SET status = $3, superseded_by = $4, updated_at = now()
        WHERE user_id = $1 AND id = $2`,
      [userId, oldId, MEMORY_STATUS.SUPERSEDED, newId],
    )
    return rowCount > 0
  })
}

/** Flags memories as mutually contradictory, taking them out of retrieval. */
export async function markConflicted(userId, ids) {
  if (!ids.length) return 0
  const { rowCount } = await query(
    `UPDATE memories SET status = $2, updated_at = now()
      WHERE user_id = $1 AND id = ANY($3::uuid[]) AND status = 'ACTIVE'`,
    [userId, MEMORY_STATUS.CONFLICTED, ids],
  )
  return rowCount
}

export async function setStatus(userId, id, status) {
  const row = await queryOne(
    `UPDATE memories SET status = $3, updated_at = now()
      WHERE user_id = $1 AND id = $2 RETURNING ${COLUMNS}`,
    [userId, id, status],
  )
  return rowToMemory(row)
}

export async function remove(userId, id) {
  const { rowCount } = await query('DELETE FROM memories WHERE user_id = $1 AND id = $2', [userId, id])
  return rowCount > 0
}

/**
 * Records that memories were surfaced to the user. Access frequency is a ranking
 * signal, so this write is what makes frequently-useful memories rise over time.
 */
export async function touch(userId, ids) {
  if (!ids?.length) return 0
  const { rowCount } = await query(
    `UPDATE memories
        SET access_count = access_count + 1, last_accessed_at = now()
      WHERE user_id = $1 AND id = ANY($2::uuid[])`,
    [userId, ids],
  )
  return rowCount
}

// ── Memory reads ────────────────────────────────────────────────────────────

export async function getById(userId, id) {
  const row = await queryOne(
    `SELECT ${COLUMNS} FROM memories WHERE user_id = $1 AND id = $2`,
    [userId, id],
  )
  return rowToMemory(row)
}

export async function findByDedupKey(userId, type, dedupKey, status = MEMORY_STATUS.ACTIVE) {
  const row = await queryOne(
    `SELECT ${COLUMNS} FROM memories
      WHERE user_id = $1 AND type = $2 AND dedup_key = $3 AND status = $4
      LIMIT 1`,
    [userId, type, dedupKey, status],
  )
  return rowToMemory(row)
}

export async function findByHash(userId, hash) {
  const row = await queryOne(
    `SELECT ${COLUMNS} FROM memories
      WHERE user_id = $1 AND content_hash = $2 AND status = 'ACTIVE'
      LIMIT 1`,
    [userId, hash],
  )
  return rowToMemory(row)
}

/** Lists memories with optional type/status filters, newest first. */
export async function list(userId, { types = null, status = MEMORY_STATUS.ACTIVE, limit = 200, offset = 0 } = {}) {
  const params = [userId]
  const conditions = ['user_id = $1']

  if (status) {
    params.push(status)
    conditions.push(`status = $${params.length}`)
  }
  if (types?.length) {
    params.push(types)
    conditions.push(`type = ANY($${params.length}::text[])`)
  }
  params.push(Math.min(limit, 500), offset)

  const { rows } = await query(
    `SELECT ${COLUMNS} FROM memories
      WHERE ${conditions.join(' AND ')}
      ORDER BY updated_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return rows.map(rowToMemory)
}

export async function countByType(userId) {
  const { rows } = await query(
    `SELECT type, count(*)::int AS count FROM memories
      WHERE user_id = $1 AND status = 'ACTIVE'
      GROUP BY type`,
    [userId],
  )
  return Object.fromEntries(rows.map(row => [row.type, Number(row.count)]))
}

/**
 * Approximate-nearest-neighbour search over memory embeddings.
 *
 * Uses pgvector's cosine distance operator, so the ANN index is actually used;
 * similarity is returned as 1 - distance. Memories without an embedding are
 * excluded — they are reachable via list() instead.
 */
export async function vectorSearch(userId, embedding, {
  types = null,
  limit = config.memory.retrievalCandidateLimit,
  minSimilarity = config.memory.retrievalMinSimilarity,
  excludeIds = null,
} = {}) {
  const literal = toVectorLiteral(embedding)
  if (!literal) return []

  const params = [userId, literal]
  const conditions = ['user_id = $1', "status = 'ACTIVE'", 'embedding IS NOT NULL']

  if (types?.length) {
    params.push(types)
    conditions.push(`type = ANY($${params.length}::text[])`)
  }
  if (excludeIds?.length) {
    params.push(excludeIds)
    conditions.push(`id <> ALL($${params.length}::uuid[])`)
  }
  params.push(minSimilarity, Math.min(limit, 200))

  const { rows } = await query(
    `SELECT ${COLUMNS}, 1 - (embedding <=> $2::vector) AS similarity
       FROM memories
      WHERE ${conditions.join(' AND ')}
        AND 1 - (embedding <=> $2::vector) >= $${params.length - 1}
      ORDER BY embedding <=> $2::vector
      LIMIT $${params.length}`,
    params,
  )
  return rows.map(rowToMemory)
}

/** Keyword fallback for exact tokens (company names, acronyms) that embeddings blur. */
export async function keywordSearch(userId, text, { types = null, limit = 20 } = {}) {
  const needle = String(text ?? '').trim()
  if (needle.length < 2) return []

  const params = [userId, `%${needle}%`]
  const conditions = ['user_id = $1', "status = 'ACTIVE'", '(content ILIKE $2 OR title ILIKE $2)']

  if (types?.length) {
    params.push(types)
    conditions.push(`type = ANY($${params.length}::text[])`)
  }
  params.push(Math.min(limit, 100))

  const { rows } = await query(
    `SELECT ${COLUMNS} FROM memories
      WHERE ${conditions.join(' AND ')}
      ORDER BY importance DESC, updated_at DESC
      LIMIT $${params.length}`,
    params,
  )
  return rows.map(rowToMemory)
}

// ── Relationships ───────────────────────────────────────────────────────────

export async function relate(userId, fromId, toId, relation, weight = 1) {
  if (!fromId || !toId || fromId === toId) return null
  const row = await queryOne(
    `INSERT INTO memory_relations (user_id, from_id, to_id, relation, weight)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, from_id, to_id, relation)
       DO UPDATE SET weight = GREATEST(memory_relations.weight, EXCLUDED.weight)
     RETURNING id, from_id, to_id, relation, weight`,
    [userId, fromId, toId, relation, weight],
  )
  return row
}

export async function listRelations(userId) {
  const { rows } = await query(
    `SELECT r.id, r.from_id, r.to_id, r.relation, r.weight
       FROM memory_relations r
       JOIN memories mf ON mf.id = r.from_id AND mf.user_id = r.user_id
       JOIN memories mt ON mt.id = r.to_id   AND mt.user_id = r.user_id
      WHERE r.user_id = $1 AND mf.status = 'ACTIVE' AND mt.status = 'ACTIVE'`,
    [userId],
  )
  return rows
}

/** Memories directly connected to `id`, in either direction. */
export async function neighbours(userId, id, { limit = 25 } = {}) {
  const { rows } = await query(
    `SELECT ${COLUMNS.split(',').map(column => `m.${column.trim()}`).join(', ')},
            r.relation, r.weight
       FROM memory_relations r
       JOIN memories m
         ON m.user_id = r.user_id
        AND m.id = CASE WHEN r.from_id = $2 THEN r.to_id ELSE r.from_id END
      WHERE r.user_id = $1
        AND (r.from_id = $2 OR r.to_id = $2)
        AND m.status = 'ACTIVE'
      LIMIT $3`,
    [userId, id, Math.min(limit, 100)],
  )
  return rows.map(row => ({ ...rowToMemory(row), relation: row.relation, weight: Number(row.weight) }))
}

export default {
  contentHash, rowToMemory,
  createUser, getUserRow, userExists, touchUserVisit, updateUserProfile, deleteUser,
  findUserByEmail, setUserCredentials,
  insert, update, supersede, markConflicted, setStatus, remove, touch,
  getById, findByDedupKey, findByHash, list, countByType, vectorSearch, keywordSearch,
  relate, listRelations, neighbours,
}
