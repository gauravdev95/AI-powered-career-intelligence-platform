/**
 * Central configuration. Loads .env once, then exposes typed, validated settings.
 * Every other module imports from here instead of touching process.env directly,
 * so there is exactly one place where a secret can be read (and none where it is logged).
 */

import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '.env') })

function num(name, fallback) {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function str(name, fallback = '') {
  const raw = process.env[name]
  return raw == null || raw === '' ? fallback : String(raw).trim()
}

function bool(name, fallback = false) {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  return /^(1|true|yes|on)$/i.test(raw.trim())
}

function list(name, fallback = []) {
  const raw = str(name)
  if (!raw) return fallback
  return raw.split(',').map(item => item.trim()).filter(Boolean)
}

const NODE_ENV = str('NODE_ENV', 'development')
const IS_PRODUCTION = NODE_ENV === 'production'
const IS_TEST = NODE_ENV === 'test'

/**
 * Ranking weights for MemoryRanker. Every signal is configurable at runtime so the
 * blend can be tuned per-deployment without a code change. Weights are normalised
 * at use-time, so they do not have to sum to 1.
 */
const rankingWeights = {
  semantic: num('RANK_W_SEMANTIC', 0.40),
  importance: num('RANK_W_IMPORTANCE', 0.15),
  recency: num('RANK_W_RECENCY', 0.15),
  confidence: num('RANK_W_CONFIDENCE', 0.10),
  sourceQuality: num('RANK_W_SOURCE_QUALITY', 0.10),
  accessFrequency: num('RANK_W_ACCESS_FREQUENCY', 0.10),
}

export const config = {
  env: NODE_ENV,
  isProduction: IS_PRODUCTION,
  isTest: IS_TEST,
  port: num('PORT', 3001),

  http: {
    corsOrigins: list('CORS_ORIGIN', [
      'http://localhost:5173', 'http://127.0.0.1:5173',
      'http://localhost:5174', 'http://127.0.0.1:5174',
      'http://localhost:5175', 'http://127.0.0.1:5175',
      'http://localhost:5176', 'http://127.0.0.1:5176',
      'http://localhost:5177', 'http://127.0.0.1:5177',
      'http://localhost:3000',
    ]),
    allowVercelPreviews: bool('CORS_ALLOW_VERCEL_PREVIEWS', true),
    maxBodySize: str('MAX_BODY_SIZE', '1mb'),
    rateLimitWindowMs: num('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
    rateLimitMax: num('RATE_LIMIT_MAX', 120),
    // Expensive AI routes get their own, much tighter bucket.
    aiRateLimitWindowMs: num('AI_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
    aiRateLimitMax: num('AI_RATE_LIMIT_MAX', 30),
  },

  db: {
    // 'pg' talks to a real PostgreSQL server. 'pglite' is an in-process Postgres
    // build used for tests and offline development only.
    driver: str('DATABASE_DRIVER', str('DATABASE_URL') ? 'pg' : (IS_PRODUCTION ? 'pg' : 'pglite')),
    url: str('DATABASE_URL'),
    ssl: bool('DATABASE_SSL', IS_PRODUCTION),
    poolMax: num('DATABASE_POOL_MAX', 10),
    connectionTimeoutMs: num('DATABASE_CONNECTION_TIMEOUT_MS', 10000),
    idleTimeoutMs: num('DATABASE_IDLE_TIMEOUT_MS', 30000),
    statementTimeoutMs: num('DATABASE_STATEMENT_TIMEOUT_MS', 15000),
    pgliteDataDir: str('PGLITE_DATA_DIR'), // empty => ephemeral in-memory
    autoMigrate: bool('DATABASE_AUTO_MIGRATE', true),
  },

  redis: {
    url: str('REDIS_URL'),
    enabled: bool('REDIS_ENABLED', Boolean(str('REDIS_URL'))),
    keyPrefix: str('REDIS_KEY_PREFIX', 'devradar:'),
    defaultTtlSeconds: num('REDIS_TTL_SECONDS', 300),
  },

  ai: {
    provider: str('AI_PROVIDER', 'gemini'),
    apiKey: str('GEMINI_API_KEY'),
    baseUrl: str('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta'),
    // Model id is intentionally env-driven: swapping generations is a config change,
    // never a code change. See README for the currently verified ids.
    model: str('GEMINI_MODEL', 'gemini-3-flash-preview'),
    embeddingModel: str('GEMINI_EMBEDDING_MODEL', 'gemini-embedding-001'),
    embeddingDimensions: num('EMBEDDING_DIMENSIONS', 768),
    timeoutMs: num('AI_TIMEOUT_MS', 30000),
    maxRetries: num('AI_MAX_RETRIES', 2),
    temperature: num('AI_TEMPERATURE', 0.3),
  },

  memory: {
    rankingWeights,
    // Half-life in days for the exponential recency decay.
    recencyHalfLifeDays: num('MEMORY_RECENCY_HALF_LIFE_DAYS', 30),
    // Cosine similarity at or above which two memories are considered the same fact.
    duplicateSimilarityThreshold: num('MEMORY_DUPLICATE_THRESHOLD', 0.92),
    // Similarity floor for a memory to be eligible for retrieval at all.
    retrievalMinSimilarity: num('MEMORY_RETRIEVAL_MIN_SIMILARITY', 0.15),
    retrievalCandidateLimit: num('MEMORY_RETRIEVAL_CANDIDATES', 60),
    retrievalTopK: num('MEMORY_RETRIEVAL_TOP_K', 12),
    // Character budget for the assembled RAG context. Never send the whole wiki.
    contextCharBudget: num('MEMORY_CONTEXT_CHAR_BUDGET', 6000),
    chunkSize: num('WIKI_CHUNK_SIZE', 900),
    chunkOverlap: num('WIKI_CHUNK_OVERLAP', 150),
    conversationWindow: num('MEMORY_CONVERSATION_WINDOW', 8),
    conversationRetention: num('MEMORY_CONVERSATION_RETENTION', 50),
  },

  ingest: {
    maxInputChars: num('INGEST_MAX_INPUT_CHARS', 12000),
    maxFetchBytes: num('INGEST_MAX_FETCH_BYTES', 2 * 1024 * 1024),
    fetchTimeoutMs: num('INGEST_FETCH_TIMEOUT_MS', 10000),
    maxRedirects: num('INGEST_MAX_REDIRECTS', 3),
    // How many wiki pages one paste may generate at once. Providers rate-limit per
    // minute, so an unbounded fan-out burns the whole budget on a single ingest and
    // 429s whatever the user does next. Raise it only with a paid, high-RPM key.
    wikiPageConcurrency: num('INGEST_WIKI_PAGE_CONCURRENCY', 2),
    // When set, only these hostnames (and their subdomains) may be fetched.
    allowedHosts: list('INGEST_ALLOWED_HOSTS', []),
    blockedHosts: list('INGEST_BLOCKED_HOSTS', []),
    // Escape hatch for local development against localhost fixtures. Never enable in prod.
    allowPrivateNetwork: bool('INGEST_ALLOW_PRIVATE_NETWORK', false) && !IS_PRODUCTION,
  },
}

/**
 * Fails fast on misconfiguration that would otherwise surface as silent data loss.
 * Returns a list of non-fatal warnings.
 */
export function validateConfig() {
  const warnings = []

  if (config.db.driver === 'pg' && !config.db.url) {
    throw new Error('DATABASE_URL is required when DATABASE_DRIVER=pg. PostgreSQL is the source of truth for DevRadar memory.')
  }
  if (config.isProduction && config.db.driver !== 'pg') {
    throw new Error('DATABASE_DRIVER must be "pg" in production. The pglite driver is for tests and local development only.')
  }
  if (!config.ai.apiKey) {
    warnings.push('GEMINI_API_KEY is not set — AI generation is disabled and embeddings fall back to a deterministic local encoder. Retrieval still works, quality is reduced.')
  }
  if (config.isProduction && config.ingest.allowPrivateNetwork) {
    warnings.push('INGEST_ALLOW_PRIVATE_NETWORK was requested but is force-disabled in production.')
  }
  if (!config.redis.enabled) {
    warnings.push('Redis is not configured — using an in-process cache. Set REDIS_URL to share cache across instances.')
  }
  const weightSum = Object.values(config.memory.rankingWeights).reduce((a, b) => a + b, 0)
  if (weightSum <= 0) {
    throw new Error('At least one RANK_W_* ranking weight must be greater than zero.')
  }
  return warnings
}

export default config
