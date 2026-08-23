/**
 * Short-term cache. Redis when REDIS_URL is configured, otherwise a bounded
 * in-process map with the same semantics.
 *
 * The cache is strictly an optimisation: every read path must remain correct when
 * it returns a miss, and nothing is ever written here that is not also durable in
 * PostgreSQL. Redis being down degrades latency, never correctness.
 */

import config from '../config.js'
import { redact } from '../lib/errors.js'

const MAX_LOCAL_ENTRIES = 2000

class LocalCache {
  constructor() {
    this.store = new Map()
    this.name = 'memory'
  }

  #prune() {
    // Evict expired entries first, then oldest-inserted, keeping the map bounded.
    const now = Date.now()
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) this.store.delete(key)
    }
    while (this.store.size > MAX_LOCAL_ENTRIES) {
      const oldest = this.store.keys().next().value
      if (oldest === undefined) break
      this.store.delete(oldest)
    }
  }

  async get(key) {
    const entry = this.store.get(key)
    if (!entry) return null
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key)
      return null
    }
    return entry.value
  }

  async set(key, value, ttlSeconds) {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
    this.#prune()
  }

  async del(prefix) {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key)
    }
  }

  async close() {
    this.store.clear()
  }
}

class RedisCache {
  constructor(client) {
    this.client = client
    this.name = 'redis'
  }

  async get(key) {
    try {
      const raw = await this.client.get(key)
      return raw == null ? null : JSON.parse(raw)
    } catch (err) {
      console.warn('[cache] redis get failed:', redact(err.message))
      return null
    }
  }

  async set(key, value, ttlSeconds) {
    try {
      await this.client.set(key, JSON.stringify(value), { EX: Math.max(1, Math.floor(ttlSeconds)) })
    } catch (err) {
      console.warn('[cache] redis set failed:', redact(err.message))
    }
  }

  async del(prefix) {
    try {
      for await (const key of this.client.scanIterator({ MATCH: `${prefix}*`, COUNT: 200 })) {
        await this.client.del(key)
      }
    } catch (err) {
      console.warn('[cache] redis del failed:', redact(err.message))
    }
  }

  async close() {
    try { await this.client.quit() } catch { /* already closed */ }
  }
}

let backendPromise = null

async function createBackend() {
  if (!config.redis.enabled || !config.redis.url) return new LocalCache()

  try {
    const { createClient } = await import('redis')
    const client = createClient({
      url: config.redis.url,
      socket: { connectTimeout: 5000, reconnectStrategy: retries => Math.min(retries * 200, 3000) },
    })
    // Without a listener an emitted 'error' would crash the process.
    client.on('error', err => console.warn('[cache] redis error:', redact(err.message)))
    await client.connect()
    console.log('[cache] redis connected')
    return new RedisCache(client)
  } catch (err) {
    console.warn('[cache] redis unavailable, using in-process cache:', redact(err.message))
    return new LocalCache()
  }
}

function backend() {
  if (!backendPromise) backendPromise = createBackend()
  return backendPromise
}

const prefixed = key => `${config.redis.keyPrefix}${key}`

export async function cacheGet(key) {
  return (await backend()).get(prefixed(key))
}

export async function cacheSet(key, value, ttlSeconds = config.redis.defaultTtlSeconds) {
  return (await backend()).set(prefixed(key), value, ttlSeconds)
}

/** Reads through the cache, computing and storing on miss. */
export async function cached(key, ttlSeconds, compute) {
  const hit = await cacheGet(key)
  if (hit != null) return hit
  const value = await compute()
  if (value != null) await cacheSet(key, value, ttlSeconds)
  return value
}

/** Drops every cached entry for one user. Called whenever their memory changes. */
export async function invalidateUser(userId) {
  return (await backend()).del(prefixed(`u:${userId}:`))
}

export async function cacheName() {
  return (await backend()).name
}

export async function closeCache() {
  if (backendPromise) {
    const instance = await backendPromise
    await instance.close()
    backendPromise = null
  }
}

export default { cacheGet, cacheSet, cached, invalidateUser, cacheName, closeCache }
