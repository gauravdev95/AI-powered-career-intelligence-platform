/**
 * Idempotent schema migration.
 *
 * Runs db/schema.sql statement-by-statement so a single unsupported index (e.g. an
 * ANN index on a pgvector build that predates HNSW) degrades to a warning instead
 * of aborting startup — correctness never depends on an index existing.
 *
 * Usable as a module (server boot) or as a CLI: `npm run db:migrate`.
 */

import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import config from '../config.js'
import { query, exec, driverName } from './pool.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Splits a SQL script into individual statements.
 * The schema contains no dollar-quoted bodies or semicolons inside literals, so a
 * comment-aware split on `;` is sufficient and avoids a parser dependency.
 */
function splitStatements(sql) {
  return sql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map(statement => statement.trim())
    .filter(Boolean)
}

/** Vector index definitions, applied best-effort after the base schema. */
function annIndexStatements(dim) {
  // HNSW gives good recall at Grafted's scale. If the server's pgvector is too old,
  // the statement fails and we fall back to exact search (a sequential scan).
  return [
    `CREATE INDEX IF NOT EXISTS memories_embedding_hnsw_idx
       ON memories USING hnsw (embedding vector_cosine_ops)`,
    `CREATE INDEX IF NOT EXISTS wiki_chunks_embedding_hnsw_idx
       ON wiki_chunks USING hnsw (embedding vector_cosine_ops)`,
  ].map(sql => sql.replace('{{EMBEDDING_DIM}}', String(dim)))
}

export async function migrate({ verbose = true } = {}) {
  const dim = config.ai.embeddingDimensions
  const raw = await readFile(join(__dirname, 'schema.sql'), 'utf8')
  const sql = raw.replaceAll('{{EMBEDDING_DIM}}', String(dim))

  const log = (...args) => { if (verbose) console.log(...args) }
  const warnings = []

  for (const statement of splitStatements(sql)) {
    await exec(`${statement};`)
  }

  for (const statement of annIndexStatements(dim)) {
    try {
      await exec(`${statement};`)
    } catch (err) {
      warnings.push(`ANN index skipped (${err.message.split('\n')[0]}). Vector search will use exact scan.`)
    }
  }

  await assertEmbeddingDimension(dim, warnings)

  log(`[db] schema ready on ${await driverName()} (embedding dim ${dim})`)
  for (const warning of warnings) console.warn(`[db] ${warning}`)
  return { warnings }
}

/**
 * Guards the one migration that cannot be applied automatically: changing
 * EMBEDDING_DIMENSIONS after data exists would silently break every vector search.
 */
async function assertEmbeddingDimension(expected, warnings) {
  const { rows } = await query(
    `SELECT a.atttypmod AS typmod
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relname = 'memories' AND a.attname = 'embedding' AND a.attnum > 0`,
  )
  const actual = rows[0]?.typmod
  if (actual != null && Number(actual) > 0 && Number(actual) !== expected) {
    const { rows: counts } = await query('SELECT count(*)::int AS n FROM memories WHERE embedding IS NOT NULL')
    const populated = Number(counts[0]?.n ?? 0)
    const message = `memories.embedding is vector(${actual}) but EMBEDDING_DIMENSIONS=${expected}.`
    if (populated > 0) {
      throw new Error(
        `${message} ${populated} embeddings already exist. Re-embedding is required: ` +
        'restore EMBEDDING_DIMENSIONS to the previous value, or drop and re-ingest.',
      )
    }
    warnings.push(`${message} No embeddings stored yet — run "npm run db:reset" to rebuild at the new dimension.`)
  }
}

/** Drops every Grafted table. Destructive; intended for tests and local resets. */
export async function reset() {
  await exec(`
    DROP TABLE IF EXISTS ingest_log, conversation_turns, journey_events,
      wiki_chunks, wiki_pages, memory_relations, memories, users CASCADE;
  `)
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isCli) {
  const { close } = await import('./pool.js')
  try {
    if (process.argv.includes('--reset')) {
      await reset()
      console.log('[db] tables dropped')
    }
    await migrate()
    await close()
  } catch (err) {
    console.error('[db] migration failed:', err.message)
    await close()
    process.exit(1)
  }
}
