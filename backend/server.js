/**
 * DevRadar API.
 *
 * A thin HTTP layer over the Career Memory Engine. Route handlers validate input,
 * call one engine method, and shape the response — no persistence, embedding, or
 * model logic lives here.
 *
 * Authorisation model: DevRadar has no login. A userId is a server-minted UUIDv4
 * (122 bits of entropy) held in the client's localStorage and used as a bearer
 * capability. Every route resolves that id against PostgreSQL and every query is
 * scoped to it, so one user can never read another's memory — but anyone holding
 * the id has full access to that profile. Introducing accounts is the documented
 * upgrade path; see ARCHITECTURE.md.
 */

import express from 'express'
import cors from 'cors'
import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

import config, { validateConfig } from './config.js'
import { migrate } from './db/migrate.js'
import { healthCheck as dbHealthCheck, driverName, close as closeDb } from './db/pool.js'
import { cacheName, closeCache } from './services/cache.js'
import * as aiService from './services/aiService.js'
import engine, { MemoryExtractor } from './memory/index.js'
import * as matching from './matching.js'
import { detectInputType, fetchURL, extractText } from './fetcher.js'
import { ApiError, asyncHandler, badRequest, notFound, unprocessable, redact } from './lib/errors.js'
import { mapSettledWithConcurrency } from './lib/concurrency.js'
import {
  requireUserId, requireString, requireNonEmptyArray,
  sanitizeString, sanitizeStringArray, slugify, parseLimit,
} from './lib/validate.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const configWarnings = validateConfig()

const [startups, hackathons, skills] = await Promise.all([
  readFile(join(__dirname, 'data/startups.json'), 'utf8').then(JSON.parse),
  readFile(join(__dirname, 'data/hackathons.json'), 'utf8').then(JSON.parse),
  readFile(join(__dirname, 'data/skills.json'), 'utf8').then(JSON.parse),
])

if (config.db.autoMigrate) {
  await migrate({ verbose: true })
}

const app = express()

// ── Middleware ──────────────────────────────────────────────────────────────

function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site')
  if (config.isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains')
  }
  next()
}

function isAllowedOrigin(origin) {
  if (!origin) return true // same-origin, curl, server-to-server
  if (config.http.corsOrigins.includes(origin)) return true
  if (!config.http.allowVercelPreviews) return false
  try {
    return /\.vercel\.app$/i.test(new URL(origin).hostname)
  } catch {
    return false
  }
}

function requestLogger(req, res, next) {
  const started = Date.now()
  res.on('finish', () => {
    const ms = Date.now() - started
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'
    // Path only — query strings and bodies can contain user content.
    console[level](`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${ms}ms`)
  })
  next()
}

/**
 * Fixed-window rate limiter. Buckets are swept on write so an idle process does not
 * retain an unbounded map of client keys.
 */
function createRateLimiter({ windowMs, limit, name }) {
  const buckets = new Map()
  let lastSweep = Date.now()

  return (req, res, next) => {
    const now = Date.now()
    if (now - lastSweep > windowMs) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key)
      }
      lastSweep = now
    }

    const key = req.ip || req.socket.remoteAddress || 'unknown'
    const bucket = buckets.get(key) ?? { count: 0, resetAt: now + windowMs }
    if (bucket.resetAt <= now) {
      bucket.count = 0
      bucket.resetAt = now + windowMs
    }
    bucket.count += 1
    buckets.set(key, bucket)

    res.setHeader(`RateLimit-${name}-Limit`, String(limit))
    res.setHeader(`RateLimit-${name}-Remaining`, String(Math.max(limit - bucket.count, 0)))
    res.setHeader(`RateLimit-${name}-Reset`, String(Math.ceil(bucket.resetAt / 1000)))

    if (bucket.count > limit) {
      return res.status(429).json({
        error: 'Too many requests. Please slow down and try again shortly.',
        code: 'RATE_LIMITED',
      })
    }
    return next()
  }
}

const globalLimiter = createRateLimiter({
  windowMs: config.http.rateLimitWindowMs,
  limit: config.http.rateLimitMax,
  name: 'Global',
})

// Ingest, chat and roadmap each cost model calls and embeddings; they get a tighter
// budget than cheap reads so one client cannot exhaust the AI quota.
const aiLimiter = createRateLimiter({
  windowMs: config.http.aiRateLimitWindowMs,
  limit: config.http.aiRateLimitMax,
  name: 'AI',
})

app.set('trust proxy', 1)
app.disable('x-powered-by')
app.use(securityHeaders)
app.use(cors({
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true)
    return callback(new ApiError(403, 'Origin is not allowed by CORS', 'CORS_FORBIDDEN'))
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: false,
  maxAge: 86400,
}))
app.use(express.json({ limit: config.http.maxBodySize }))
app.use(globalLimiter)
app.use(requestLogger)

/**
 * Resolves and authorises the caller. Every route that touches user memory uses this,
 * so an unknown or malformed id is rejected before any query runs.
 */
async function requireUser(rawUserId) {
  const userId = requireUserId(rawUserId)
  if (!await engine.userExists(userId)) {
    throw notFound('User not found. Complete onboarding to create your career memory.')
  }
  return userId
}

// ── Health ──────────────────────────────────────────────────────────────────

app.get('/api/health', asyncHandler(async (_req, res) => {
  const [database, driver, cache] = await Promise.all([dbHealthCheck(), driverName(), cacheName()])
  const ai = aiService.describe()

  res.status(database ? 200 : 503).json({
    status: database ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    environment: config.env,
    database: { connected: database, driver, persistent: driver === 'pg' },
    cache,
    ai: { provider: ai.provider, model: ai.model, available: ai.available, embeddingModel: ai.embeddingModel },
    datasets: { startups: startups.length, hackathons: hackathons.length, skills: skills.length },
  })
}))

// ── Onboarding and profile ──────────────────────────────────────────────────

app.post('/api/user/init', asyncHandler(async (req, res) => {
  const stack = requireNonEmptyArray(req.body.stack, 'stack')
  const experience = requireString(req.body.experience, 'experience', 80)

  const profile = await engine.initUser({
    name: sanitizeString(req.body.name, 120) || 'Developer',
    stack,
    learningStack: sanitizeStringArray(req.body.learning_stack),
    experience,
    goals: sanitizeStringArray(req.body.goals, 10, 120),
    targetRole: sanitizeString(req.body.target_role, 120),
    targetCompanies: sanitizeStringArray(req.body.target_companies, 5, 120),
    timeline: sanitizeString(req.body.timeline, 80),
    learningStyle: sanitizeString(req.body.learning_style, 80),
  })

  res.status(201).json({ userId: profile.userId, message: 'Career memory created', user: profile })
}))

app.get('/api/user/:userId', asyncHandler(async (req, res) => {
  const userId = await requireUser(req.params.userId)
  res.json(await engine.getProfile(userId))
}))

app.post('/api/user/:userId/stack', asyncHandler(async (req, res) => {
  const userId = await requireUser(req.params.userId)
  const stack = requireNonEmptyArray(req.body.stack, 'stack')

  await engine.updateStack(userId, stack)
  await engine.recordJourney(userId, 'profile_update', {
    title: 'Stack updated',
    description: `${stack.length} skills`,
    data: { stack },
  })

  res.json({ updated: true, stack })
}))

// ── Matching (deterministic, dataset-driven) ────────────────────────────────

app.post('/api/analyze', asyncHandler(async (req, res) => {
  const userId = await requireUser(req.body.userId)
  const profile = await engine.getProfile(userId)

  const requested = sanitizeStringArray(req.body.stack)
  const stack = requested.length ? requested : profile.stack
  if (!stack.length) throw badRequest('stack must be a non-empty array')

  const ranked = matching.rankStartups(stack, startups, { targetCompanies: profile.target_companies })
  const enriched = ranked.map((startup, index) => (
    // Only the visible shortlist gets the detailed breakdown; the rest keep their score.
    index < 5 ? { ...startup, analysis: matching.analyzeFit(stack, startup) } : startup
  ))
  const topMatch = enriched[0] ?? null

  if (topMatch) await engine.recordEntityView(userId, 'startup', topMatch)
  if (requested.length) await engine.updateStack(userId, stack)

  res.json({ startups: enriched, topMatch, total: enriched.length })
}))

app.post('/api/gaps', asyncHandler(async (req, res) => {
  const userId = await requireUser(req.body.userId)
  const profile = await engine.getProfile(userId)
  const stack = sanitizeStringArray(req.body.stack).length ? sanitizeStringArray(req.body.stack) : profile.stack
  if (!stack.length) throw badRequest('stack must be a non-empty array')

  const requestedTargets = sanitizeStringArray(req.body.targetCompanies, 10, 120)
  const targets = requestedTargets.length
    ? startups.filter(startup => requestedTargets.includes(startup.name) || requestedTargets.includes(startup.id))
    : matching.rankStartups(stack, startups, { targetCompanies: profile.target_companies }).slice(0, 5)

  const report = matching.buildGapReport(stack, targets.length ? targets : startups.slice(0, 5), skills)
  await engine.saveGapAnalysis(userId, report, { targets: targets.map(target => target.name) })

  res.json(report)
}))

app.get('/api/hackathons/:userId', asyncHandler(async (req, res) => {
  const userId = await requireUser(req.params.userId)
  const queryStack = sanitizeString(req.query.stack, 1000).split(',').map(item => item.trim()).filter(Boolean)
  const stack = queryStack.length ? queryStack : (await engine.getProfile(userId)).stack

  const ranked = matching.rankHackathons(stack, hackathons)
  if (ranked[0]) await engine.recordEntityView(userId, 'hackathon', ranked[0])

  res.json({ ranked_hackathons: ranked })
}))

app.get('/api/skills', (_req, res) => {
  res.json(skills)
})

// ── Return context ──────────────────────────────────────────────────────────

app.get('/api/return-context/:userId', asyncHandler(async (req, res) => {
  // Deliberately not requireUser: an unknown id means "no history", not an error —
  // the client sends whatever is in localStorage, which may predate a database reset.
  const userId = requireUserId(req.params.userId)
  if (!await engine.userExists(userId)) {
    return res.json({ hasHistory: false, message: '', urgentItems: [] })
  }
  return res.json(await engine.getReturnContext(userId, startups, hackathons))
}))

// ── Ingest → wiki ───────────────────────────────────────────────────────────

app.post('/api/ingest', aiLimiter, asyncHandler(async (req, res) => {
  const userId = await requireUser(req.body.userId)
  const input = requireString(req.body.input, 'input', config.ingest.maxInputChars)

  const inputType = detectInputType(input)
  if (inputType === 'screenshot') {
    throw unprocessable(
      'Screenshot analysis is not supported yet. Copy the text from the page and paste it instead.',
      'UNSUPPORTED_INPUT',
    )
  }

  let content = input
  let sourceUrl = ''
  if (inputType === 'url') {
    const fetched = await fetchURL(input)
    content = fetched.content
    sourceUrl = fetched.finalUrl
  } else {
    content = extractText(input)
  }

  const profile = await engine.getProfile(userId)

  // 1. Extract entities and remember them as durable memories.
  const { candidates, entities } = await MemoryExtractor.fromIngest(content, {
    userStack: profile.stack,
    inputType,
    sourceUrl,
  })

  await engine.rememberMany(userId, candidates)

  // 2. Generate a wiki page per notable entity, capped so one paste cannot fan out
  //    into dozens of model calls. Hackathons are excluded on purpose: the curated
  //    dataset already gives them deadlines, prizes and skill coverage in the graph,
  //    so a generated page would only restate it. They are still remembered above.
  const pageJobs = [
    ...(entities.companies ?? []).slice(0, 3).map(entity => ({ type: 'company', entity, name: slugify(entity.name) })),
    ...(entities.skills ?? []).slice(0, 2).map(entity => ({ type: 'skill', entity, name: slugify(entity.name) })),
    ...(entities.gaps ?? []).slice(0, 2).map(entity => ({ type: 'gap', entity, name: slugify(entity.skill) })),
  ].filter(job => job.name && job.name !== 'untitled')

  // Bounded, not parallel: see lib/concurrency.js — the unbounded version spent the
  // provider's per-minute budget on one paste and 429'd the user's next question.
  const results = await mapSettledWithConcurrency(pageJobs, config.ingest.wikiPageConcurrency, async job => {
    const markdown = await aiService.generateWikiPage(job.type, job.entity, profile.stack, content)
    await engine.saveWikiPage(userId, job.type, job.name, markdown, {
      source: inputType === 'url' ? sourceUrl : 'pasted text',
      inputType,
    })
    return { type: job.type, name: job.name, pageKey: `${job.type}/${job.name}` }
  })

  const pages = results.filter(result => result.status === 'fulfilled').map(result => result.value)
  const failed = results.filter(result => result.status === 'rejected')
  if (failed.length) {
    console.warn(`[ingest] ${failed.length}/${results.length} pages failed:`, redact(failed[0].reason?.message ?? ''))
  }

  await engine.appendIngestLog(userId, {
    inputType,
    source: inputType === 'url' ? sourceUrl : `${content.slice(0, 80)}…`,
    pagesCreated: pages.length,
    summary: entities.summary,
  })
  await engine.recordJourney(userId, 'wiki_ingest', {
    title: entities.summary?.slice(0, 120) || 'Content ingested',
    description: `${pages.length} wiki pages created`,
    data: { inputType, pagesCreated: pages.length },
  })

  res.json({
    ok: true,
    summary: entities.summary ?? '',
    entities: {
      companies: entities.companies?.length ?? 0,
      skills: entities.skills?.length ?? 0,
      hackathons: entities.hackathons?.length ?? 0,
      gaps: entities.gaps?.length ?? 0,
    },
    pages,
  })
}))

app.get('/api/wiki-pages/:userId', asyncHandler(async (req, res) => {
  const userId = await requireUser(req.params.userId)
  const pages = await engine.getWikiPages(userId)
  res.json({ pages, total: pages.length })
}))

app.get('/api/wiki/:userId/:pageType/:pageName', asyncHandler(async (req, res) => {
  const userId = await requireUser(req.params.userId)
  const page = await engine.getWikiPage(userId, req.params.pageType, req.params.pageName)
  if (!page) throw notFound('Page not found')
  res.json(page)
}))

// ── Chat (semantic RAG over memory) ─────────────────────────────────────────

app.post('/api/chat', aiLimiter, asyncHandler(async (req, res) => {
  const userId = await requireUser(req.body.userId)
  const question = requireString(req.body.question, 'question', 1000)

  const requested = sanitizeStringArray(req.body.userStack)
  const userStack = requested.length ? requested : (await engine.getProfile(userId)).stack

  const result = await engine.answer(userId, question, { userStack })
  res.json({
    answer: result.answer,
    citations: result.citations,
    grounded: result.grounded,
    degraded: result.degraded,
  })
}))

// ── Roadmap ─────────────────────────────────────────────────────────────────

app.get('/api/roadmap/:userId', aiLimiter, asyncHandler(async (req, res) => {
  const userId = await requireUser(req.params.userId)
  const roadmap = await engine.generateRoadmap(userId)
  if (!roadmap) throw notFound('User not found')
  res.json(roadmap)
}))

// ── Journey ─────────────────────────────────────────────────────────────────

app.get('/api/journey/:userId', asyncHandler(async (req, res) => {
  const userId = await requireUser(req.params.userId)
  const limit = parseLimit(req.query.limit, 200, 500)
  res.json({ journey: await engine.getJourney(userId, { limit }) })
}))

// ── Knowledge graph ─────────────────────────────────────────────────────────

app.get('/api/graph-data/:userId', asyncHandler(async (req, res) => {
  const userId = await requireUser(req.params.userId)
  res.json(await engine.getGraphData(userId))
}))

// ── Memory diagnostics ──────────────────────────────────────────────────────

app.get('/api/memory/:userId/stats', asyncHandler(async (req, res) => {
  const userId = await requireUser(req.params.userId)
  res.json(await engine.getStats(userId))
}))

app.post('/api/memory/:userId/search', asyncHandler(async (req, res) => {
  const userId = await requireUser(req.params.userId)
  const question = requireString(req.body.query, 'query', 500)
  const topK = parseLimit(req.body.topK, 10, 50)

  const recalled = await engine.recall(userId, question, { topK, recordAccess: false })
  res.json({
    results: recalled.ranked.map(memory => ({
      key: memory.dedupKey ?? memory.id,
      type: memory.type,
      content: memory.content,
      score: memory.rankScore,
      breakdown: memory.rankBreakdown,
      similarity: memory.similarity ?? null,
    })),
    stats: recalled.stats,
  })
}))

// ── Errors ──────────────────────────────────────────────────────────────────

app.use((_req, _res, next) => next(notFound('Route not found')))

app.use((err, _req, res, _next) => {
  const statusCode = Number(err.statusCode) || 500
  const code = err.code ?? (statusCode === 429 ? 'RATE_LIMITED' : 'INTERNAL_ERROR')

  console.error('[api error]', {
    statusCode,
    code,
    message: redact(err.message),
    ...(config.isProduction ? {} : { stack: err.stack }),
  })

  // 5xx messages are never echoed back: they can contain connection strings,
  // upstream payloads, or SQL fragments.
  res.status(statusCode).json({
    error: statusCode >= 500 ? 'Internal server error' : err.message,
    code,
  })
})

// ── Boot ────────────────────────────────────────────────────────────────────

const server = app.listen(config.port, async () => {
  const ai = aiService.describe()
  console.log('────────────────────────────────────────────')
  console.log(`Grafted API       http://localhost:${config.port}`)
  console.log(`Environment       ${config.env}`)
  console.log(`Database          ${await driverName()}${config.db.driver === 'pg' ? ' (persistent)' : ' (in-process — dev/test only)'}`)
  console.log(`Cache             ${await cacheName()}`)
  console.log(`AI provider       ${ai.provider} · ${ai.model} · ${ai.available ? 'ready' : 'no API key'}`)
  console.log(`Embeddings        ${ai.embeddingModel} · ${ai.embeddingDimensions}d${ai.available ? '' : ' (local fallback encoder)'}`)
  console.log(`Datasets          ${startups.length} startups · ${hackathons.length} hackathons · ${skills.length} skills`)
  for (const warning of configWarnings) console.warn(`⚠  ${warning}`)
  console.log('────────────────────────────────────────────')
})

/** Drains connections, then releases the pool and cache. */
async function shutdown(signal) {
  console.log(`\n[server] ${signal} received, shutting down`)
  server.close(async () => {
    await closeCache()
    await closeDb()
    process.exit(0)
  })
  // Do not hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 10000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

export default app
