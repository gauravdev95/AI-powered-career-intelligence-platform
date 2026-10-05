/**
 * Database access layer.
 *
 * Exposes one small surface — query / withTransaction / close — over two drivers:
 *   pg      : a real PostgreSQL server. The only supported production driver.
 *   pglite  : PostgreSQL compiled in-process (with pgvector). Tests and offline dev.
 *
 * Both drivers speak the same dialect and the same $1 placeholder syntax, so every
 * caller writes plain parameterised SQL. There is no string interpolation of user
 * input anywhere above this file.
 */

import config from '../config.js'

let driver = null
let readyPromise = null

/** Normalises driver-specific result shapes into { rows, rowCount }. */
function normalise(result) {
  const rows = result?.rows ?? []
  const count = result?.rowCount ?? result?.affectedRows ?? rows.length
  return { rows, rowCount: Number(count) || 0 }
}

async function createPgDriver() {
  const pg = await import('pg')
  const { Pool, types } = pg.default ?? pg

  // int8 (COUNT, SUM) arrives as a string by default; we only ever count small things.
  types.setTypeParser(20, value => (value == null ? null : Number(value)))

  const pool = new Pool({
    connectionString: config.db.url,
    max: config.db.poolMax,
    ssl: config.db.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: config.db.connectionTimeoutMs,
    idleTimeoutMillis: config.db.idleTimeoutMs,
    statement_timeout: config.db.statementTimeoutMs,
  })

  // A pool-level error must never take the process down.
  pool.on('error', err => console.error('[db] idle client error:', err.message))

  return {
    name: 'pg',
    // Exposed so the session store can share this pool instead of opening its own.
    pool,
    async query(text, params = []) {
      return normalise(await pool.query(text, params))
    },
    async exec(sql) {
      await pool.query(sql)
    },
    async withTransaction(fn) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await fn({
          query: async (text, params = []) => normalise(await client.query(text, params)),
        })
        await client.query('COMMIT')
        return result
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
      } finally {
        client.release()
      }
    },
    async close() {
      await pool.end()
    },
  }
}

async function createPgliteDriver() {
  const { PGlite } = await import('@electric-sql/pglite')
  const { vector } = await import('@electric-sql/pglite/vector')

  const db = await new PGlite({
    dataDir: config.db.pgliteDataDir || undefined,
    extensions: { vector },
  })

  return {
    name: 'pglite',
    async query(text, params = []) {
      return normalise(await db.query(text, params))
    },
    async exec(sql) {
      await db.exec(sql)
    },
    async withTransaction(fn) {
      return db.transaction(async tx => fn({
        query: async (text, params = []) => normalise(await tx.query(text, params)),
      }))
    },
    async close() {
      await db.close()
    },
  }
}

async function initDriver() {
  if (config.db.driver === 'pg') return createPgDriver()
  if (config.db.driver === 'pglite') return createPgliteDriver()
  throw new Error(`Unknown DATABASE_DRIVER "${config.db.driver}". Use "pg" or "pglite".`)
}

/** Lazily creates the driver. Concurrent callers share one initialisation. */
export function getDriver() {
  if (!readyPromise) {
    readyPromise = initDriver().then(created => {
      driver = created
      return created
    }).catch(err => {
      readyPromise = null
      throw err
    })
  }
  return readyPromise
}

/** Runs a parameterised query. The only way to reach the database. */
export async function query(text, params = []) {
  const db = await getDriver()
  return db.query(text, params)
}

/** Convenience: first row or null. */
export async function queryOne(text, params = []) {
  const { rows } = await query(text, params)
  return rows[0] ?? null
}

/** Runs a multi-statement SQL script. Never accepts user input. */
export async function exec(sql) {
  const db = await getDriver()
  return db.exec(sql)
}

/** Runs fn inside a transaction, rolling back on any throw. */
export async function withTransaction(fn) {
  const db = await getDriver()
  return db.withTransaction(fn)
}

export async function driverName() {
  return (await getDriver()).name
}

/** True when the database answers a trivial query. Used by /api/health. */
export async function healthCheck() {
  try {
    await query('SELECT 1')
    return true
  } catch {
    return false
  }
}

export async function close() {
  if (driver) {
    await driver.close().catch(() => {})
    driver = null
    readyPromise = null
  }
}

/** Formats a JS number array as a pgvector literal for parameter binding. */
export function toVectorLiteral(values) {
  if (!Array.isArray(values) || values.length === 0) return null
  return `[${values.map(v => (Number.isFinite(v) ? v : 0)).join(',')}]`
}

export default { query, queryOne, exec, withTransaction, healthCheck, close, toVectorLiteral, driverName, getDriver }
