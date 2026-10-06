/**
 * Grafted API.
 *
 * A thin HTTP layer over the Career Memory Engine. Route handlers validate input,
 * call one engine method, and shape the response — no persistence, embedding, or
 * model logic lives here.
 *
 * Authorisation model: session-based accounts. Signup/login issue an httpOnly
 * session cookie (PostgreSQL-backed in production, in-memory for local dev);
 * every route that touches user memory requires the session's user to own the
 * requested userId, so a leaked id alone grants nothing. Anonymous onboarding
 * still works — /api/user/init mints a guest user and binds it to the session,
 * and signup later upgrades that guest into a full account.
 */

import express from 'express'
import cors from 'cors'
import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'
import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { randomBytes } from 'crypto'

import config, { validateConfig } from './config.js'
import { migrate } from './db/migrate.js'
import { healthCheck as dbHealthCheck, driverName, getDriver, close as closeDb } from './db/pool.js'
import { cacheName, closeCache } from './services/cache.js'
import * as aiService from './services/aiService.js'
import engine, { MemoryExtractor, MemoryRetriever } from './memory/index.js'
import * as matching from './matching.js'
import { detectInputType, fetchURL, extractText } from './fetcher.js'
import { ApiError, asyncHandler, badRequest, conflict, forbidden, notFound, unauthorized, unprocessable, redact } from './lib/errors.js'
import { hashPassword, verifyPassword, requireEmail, requirePassword } from './lib/auth.js'
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

// Signup/login get their own budget so credential-stuffing cannot hide inside
// the global allowance.
const authLimiter = createRateLimiter({
  windowMs: config.auth.rateLimitWindowMs,
  limit: config.auth.rateLimitMax,
  name: 'Auth',
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
  // The frontend lives on a different origin (e.g. a static Render service)
  // while the API sets an httpOnly session cookie — credentialed CORS is what
  // lets the browser send that cookie back on every API call.
  credentials: true,
  maxAge: 86400,
}))
app.use(express.json({ limit: config.http.maxBodySize }))
app.use(globalLimiter)
app.use(requestLogger)

// ── Sessions ────────────────────────────────────────────────────────────────
// Production (pg driver) persists sessions in PostgreSQL via connect-pg-simple
// so logins survive restarts and work across instances. Local dev and tests run
// on pglite, where the in-process MemoryStore is fine.

let sessionSecret = config.auth.sessionSecret
if (!sessionSecret) {
  // validateConfig() already throws in production without one; this path is
  // dev/test only, where an ephemeral secret simply means sessions die on restart.
  sessionSecret = randomBytes(32).toString('hex')
  console.warn('[auth] SESSION_SECRET is not set — generated an ephemeral secret. Set SESSION_SECRET for persistent logins.')
}

let sessionStore
let sessionStoreName = 'memory'
const dbDriver = await getDriver()
if (dbDriver?.pool) {
  const PgSessionStore = connectPgSimple(session)
  sessionStore = new PgSessionStore({ pool: dbDriver.pool, createTableIfMissing: true })
  sessionStoreName = 'postgres'
}

app.use(session({
  store: sessionStore, // undefined → express-session's MemoryStore
  name: config.auth.sessionName,
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  proxy: true, // trust Render's reverse proxy for Secure cookies
  cookie: {
    httpOnly: true,
    // Cross-origin frontend (static site → API service) needs SameSite=None in
    // production; same-host dev can use Lax.
    sameSite: config.isProduction ? 'none' : 'lax',
    secure: config.isProduction,
    maxAge: config.auth.sessionMaxAgeMs,
  },
}))

/**
 * Resolves and authorises the caller.
 *
 * Every route that touches user memory goes through this: the request must
 * carry a live session, and the session's user must own the requested userId.
 * A userId on its own is no longer sufficient — a leaked id grants nothing.
 */
async function requireSessionUser(req, rawUserId) {
  const userId = requireUserId(rawUserId)
  const sessionUserId = req.session?.userId
  if (!sessionUserId) {
    throw unauthorized('Not signed in. Log in to access your career memory.', 'NOT_SIGNED_IN')
  }
  if (sessionUserId !== userId) {
    throw forbidden('You can only access your own career memory.', 'NOT_OWNER')
  }
  if (!await engine.userExists(userId)) {
    // The session references a user that no longer exists (e.g. after a DB reset).
    throw notFound('User not found. Complete onboarding to create your career memory.')
  }
  return userId
}

/** Regenerate the session id on privilege change (login/signup) against fixation. */
function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate(err => (err ? reject(err) : resolve()))
  })
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
    auth: { sessions: sessionStoreName },
    datasets: { startups: startups.length, hackathons: hackathons.length, skills: skills.length },
  })
}))

// ── Onboarding and profile ──────────────────────────────────────────────────

app.post('/api/user/init', asyncHandler(async (req, res) => {
  // Idempotent: a session that already owns a live user keeps it instead of
  // minting a duplicate on every revisit.
  const existingId = req.session?.userId
  if (existingId && await engine.userExists(existingId)) {
    const profile = await engine.getProfile(existingId)
    return res.status(200).json({ userId: profile.userId, message: 'Career memory restored', user: profile })
  }

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

  // Guest or account — either way the session now owns this user.
  req.session.userId = profile.userId
  res.status(201).json({ userId: profile.userId, message: 'Career memory created', user: profile })
}))

// ── Auth ────────────────────────────────────────────────────────────────────
// Session-based accounts. Signup attaches credentials to the session's guest
// user when there is one (guest → account upgrade); otherwise it mints a fresh
// user. Login swaps the session to the account's user.

app.post('/api/auth/signup', authLimiter, asyncHandler(async (req, res) => {
  const email = requireEmail(req.body.email)
  const password = requirePassword(req.body.password)
  const name = sanitizeString(req.body.name, 120) || 'Developer'

  const taken = await engine.findUserByEmail(email)
  if (taken) {
    throw conflict('An account with this email already exists. Log in instead.', 'EMAIL_TAKEN')
  }

  const passwordHash = await hashPassword(password)
  const sessionUserId = req.session?.userId
  let profile

  if (sessionUserId && await engine.userExists(sessionUserId)) {
    const current = await engine.getProfile(sessionUserId)
    if (current.email) {
      throw conflict('This session is already signed in. Log out first to create another account.', 'ALREADY_SIGNED_IN')
    }
    // Guest → account: keep every memory, just add credentials.
    await engine.setUserCredentials(sessionUserId, { email, passwordHash })
    await engine.recordJourney(sessionUserId, 'profile_update', {
      title: 'Account created',
      description: email,
    })
    profile = await engine.getProfile(sessionUserId)
  } else {
    profile = await engine.initUser({ name, email, passwordHash, stack: [] })
  }

  await regenerateSession(req)
  req.session.userId = profile.userId
  res.status(201).json({ userId: profile.userId, message: 'Account created', user: profile })
}))

app.post('/api/auth/login', authLimiter, asyncHandler(async (req, res) => {
  const email = requireEmail(req.body.email)
  const password = typeof req.body.password === 'string' ? req.body.password : ''

  // Same message for unknown email and wrong password: no user enumeration.
  const row = await engine.findUserByEmail(email)
  const ok = await verifyPassword(password, row?.password_hash)
  if (!row || !ok) {
    throw unauthorized('Incorrect email or password.', 'INVALID_CREDENTIALS')
  }

  await regenerateSession(req)
  req.session.userId = row.user_id
  const profile = await engine.getProfile(row.user_id)
  res.json({ userId: profile.userId, message: 'Signed in', user: profile })
}))

app.post('/api/auth/logout', asyncHandler(async (req, res) => {
  const name = config.auth.sessionName
  await new Promise((resolve, reject) => {
    req.session.destroy(err => (err ? reject(err) : resolve()))
  })
  res.clearCookie(name)
  res.json({ ok: true, message: 'Signed out' })
}))

app.get('/api/auth/me', asyncHandler(async (req, res) => {
  const sessionUserId = req.session?.userId
  if (!sessionUserId || !await engine.userExists(sessionUserId)) {
    throw unauthorized('Not signed in.', 'NOT_SIGNED_IN')
  }
  res.json({ user: await engine.getProfile(sessionUserId) })
}))

app.get('/api/user/:userId', asyncHandler(async (req, res) => {
  const userId = await requireSessionUser(req, req.params.userId)
  res.json(await engine.getProfile(userId))
}))

app.post('/api/user/:userId/stack', asyncHandler(async (req, res) => {
  const userId = await requireSessionUser(req, req.params.userId)
  const stack = requireNonEmptyArray(req.body.stack, 'stack')

  await engine.updateStack(userId, stack)
  await engine.recordJourney(userId, 'profile_update', {
    title: 'Stack updated',
    description: `${stack.length} skills`,
    data: { stack },
  })

  res.json({ updated: true, stack })
}))

/**
 * PUT /api/user/:userId/profile — apply onboarding answers to an existing user.
 *
 * The wizard calls POST /api/user/init first (creates a guest or restores the
 * session's user); when the user already existed — a fresh signup going through
 * onboarding, or a re-onboarding — it follows up here so the answers are saved
 * instead of silently dropped. Ownership is enforced: only the session's own
 * user may be updated.
 */
app.put('/api/user/:userId/profile', authLimiter, asyncHandler(async (req, res) => {
  const userId = await requireSessionUser(req, req.params.userId)

  const name = sanitizeString(req.body.name, 120) || 'Developer'
  const stack = requireNonEmptyArray(req.body.stack, 'stack')
  const experience = requireString(req.body.experience, 'experience', 80)

  const profile = await engine.applyOnboardingProfile(userId, {
    name,
    stack,
    experience,
    targetRole: sanitizeString(req.body.target_role, 120),
    timeline: sanitizeString(req.body.timeline, 80),
    learningStyle: sanitizeString(req.body.learning_style, 80),
    learningStack: sanitizeStringArray(req.body.learning_stack),
    goals: sanitizeStringArray(req.body.goals, 10, 120),
    targetCompanies: sanitizeStringArray(req.body.target_companies, 5, 120),
  })

  res.json({ updated: true, profile })
}))

// ── Matching (deterministic, dataset-driven) ────────────────────────────────

app.post('/api/analyze', asyncHandler(async (req, res) => {
  const userId = await requireSessionUser(req, req.body.userId)
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

  // Best-effort enrichment: the ranking above is pure/local and must always
  // return — a failed side-write must never 500 the analysis itself.
  try {
    if (topMatch) await engine.recordEntityView(userId, 'startup', topMatch)
    if (requested.length) await engine.updateStack(userId, stack)
  } catch (sideEffectError) {
    console.warn('[api/analyze] side-effect failed (analysis still returned):', sideEffectError?.message)
  }

  res.json({ startups: enriched, topMatch, total: enriched.length })
}))
app.post('/api/gaps', asyncHandler(async (req, res) => {
  const userId = await requireSessionUser(req, req.body.userId)
  const profile = await engine.getProfile(userId)
  const stack = sanitizeStringArray(req.body.stack).length ? sanitizeStringArray(req.body.stack) : profile.stack
  if (!stack.length) throw badRequest('stack must be a non-empty array')

  const requestedTargets = sanitizeStringArray(req.body.targetCompanies, 10, 120)
  const targets = requestedTargets.length
    ? startups.filter(startup => requestedTargets.includes(startup.name) || requestedTargets.includes(startup.id))
    : matching.rankStartups(stack, startups, { targetCompanies: profile.target_companies }).slice(0, 5)

  const report = matching.buildGapReport(stack, targets.length ? targets : startups.slice(0, 5), skills)
  try {
    await engine.saveGapAnalysis(userId, report, { targets: targets.map(target => target.name) })
  } catch (sideEffectError) {
    console.warn('[api/gaps] saveGapAnalysis failed (report still returned):', sideEffectError?.message)
  }

  res.json(report)
}))

app.get('/api/hackathons/:userId', asyncHandler(async (req, res) => {
  const userId = await requireSessionUser(req, req.params.userId)
  const queryStack = sanitizeString(req.query.stack, 1000).split(',').map(item => item.trim()).filter(Boolean)
  const stack = queryStack.length ? queryStack : (await engine.getProfile(userId)).stack

  const ranked = matching.rankHackathons(stack, hackathons)
  try {
    if (ranked[0]) await engine.recordEntityView(userId, 'hackathon', ranked[0])
  } catch (sideEffectError) {
    console.warn('[api/hackathons] recordEntityView failed (ranking still returned):', sideEffectError?.message)
  }

  res.json({ ranked_hackathons: ranked })
}))

app.get('/api/skills', (_req, res) => {
  res.json(skills)
})

// ── Return context ──────────────────────────────────────────────────────────

app.get('/api/return-context/:userId', asyncHandler(async (req, res) => {
  const userId = await requireSessionUser(req, req.params.userId)
  return res.json(await engine.getReturnContext(userId, startups, hackathons))
}))

// ── Ingest → wiki ───────────────────────────────────────────────────────────

app.post('/api/ingest', aiLimiter, asyncHandler(async (req, res) => {
  const userId = await requireSessionUser(req, req.body.userId)
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
    entities: {
      companies: (entities.companies ?? []).map(c => c.name).filter(Boolean).slice(0, 10),
      skills: (entities.skills ?? []).map(s => s.name).filter(Boolean).slice(0, 15),
      projects: (entities.hackathons ?? []).map(h => h.name).filter(Boolean).slice(0, 10),
      gaps: (entities.gaps ?? []).map(g => g.skill).filter(Boolean).slice(0, 10),
    },
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
      companyNames: (entities.companies ?? []).map(c => c.name).filter(Boolean).slice(0, 10),
      skillNames: (entities.skills ?? []).map(s => s.name).filter(Boolean).slice(0, 15),
      projectNames: (entities.hackathons ?? []).map(h => h.name).filter(Boolean).slice(0, 10),
      gapNames: (entities.gaps ?? []).map(g => g.skill).filter(Boolean).slice(0, 10),
    },
    pages,
  })
}))

// ── Ingest history for the Ingest page ───────────────────────────────────────
app.get('/api/ingest/:userId/recent', asyncHandler(async (req, res) => {
  const userId = await requireSessionUser(req, req.params.userId)
  res.json({ ingestions: await engine.getIngestLog(userId, 10) })
}))

app.get('/api/wiki-pages/:userId', asyncHandler(async (req, res) => {
  const userId = await requireSessionUser(req, req.params.userId)
  const pages = await engine.getWikiPages(userId)
  res.json({ pages, total: pages.length })
}))

app.get('/api/wiki/:userId/:pageType/:pageName', asyncHandler(async (req, res) => {
  const userId = await requireSessionUser(req, req.params.userId)
  const page = await engine.getWikiPage(userId, req.params.pageType, req.params.pageName)
  if (!page) throw notFound('Page not found')
  res.json(page)
}))

// ── Chat (semantic RAG over memory) ─────────────────────────────────────────

app.post('/api/chat', aiLimiter, asyncHandler(async (req, res) => {
  const userId = await requireSessionUser(req, req.body.userId)
  const question = requireString(req.body.question, 'question', 1000)

  const requested = sanitizeStringArray(req.body.userStack)
  const userStack = requested.length ? requested : (await engine.getProfile(userId)).stack
  const useMemory = req.body.memory !== false
  const webSearch = req.body.webSearch === true

  const result = await engine.answer(userId, question, { userStack, useMemory })
  res.json({
    answer: result.answer,
    citations: result.citations,
    grounded: result.grounded,
    degraded: result.degraded,
    // The product has no web-search provider wired yet: the client shows an
    // honest note instead of pretending results were searched.
    webSearchUnsupported: webSearch || undefined,
  })
}))

// ── Chat history: recent conversation sessions for the context panel ─────────
app.get('/api/chat/:userId/recent', asyncHandler(async (req, res) => {
  const userId = await requireSessionUser(req, req.params.userId)
  const turns = await MemoryRetriever.recentConversation(userId, 60)

  // Consecutive turns more than 30 minutes apart start a new session.
  const sessions = []
  let current = null
  for (const turn of turns) {
    const t = new Date(turn.createdAt).getTime()
    if (!current || t - current.lastT > 30 * 60 * 1000) {
      current = { turns: [], lastT: t, startedAt: turn.createdAt }
      sessions.push(current)
    }
    current.lastT = t
    current.turns.push({ role: turn.role, content: turn.content })
  }

  res.json({
    sessions: sessions.reverse().slice(0, 10).map((session, index) => {
      const firstUser = session.turns.find(turn => turn.role === 'user')
      const title = firstUser ? firstUser.content : 'Conversation'
      return {
        id: `session-${index}`,
        title: title.length > 44 ? `${title.slice(0, 44)}…` : title,
        startedAt: session.startedAt,
        turns: session.turns,
      }
    }),
  })
}))

// ── Roadmap ─────────────────────────────────────────────────────────────────

app.get('/api/roadmap/:userId', aiLimiter, asyncHandler(async (req, res) => {
  const userId = await requireSessionUser(req, req.params.userId)
  const roadmap = await engine.generateRoadmap(userId)
  if (!roadmap) throw notFound('User not found')
  res.json(roadmap)
}))

// ── Journey ─────────────────────────────────────────────────────────────────

app.get('/api/journey/:userId', asyncHandler(async (req, res) => {
  const userId = await requireSessionUser(req, req.params.userId)
  const limit = parseLimit(req.query.limit, 200, 500)
  res.json({ journey: await engine.getJourney(userId, { limit }) })
}))

// ── Knowledge graph ─────────────────────────────────────────────────────────

app.get('/api/graph-data/:userId', asyncHandler(async (req, res) => {
  const userId = await requireSessionUser(req, req.params.userId)
  res.json(await engine.getGraphData(userId))
}))

// ── Memory diagnostics ──────────────────────────────────────────────────────

app.get('/api/memory/:userId/stats', asyncHandler(async (req, res) => {
  const userId = await requireSessionUser(req, req.params.userId)
  res.json(await engine.getStats(userId))
}))

app.post('/api/memory/:userId/search', asyncHandler(async (req, res) => {
  const userId = await requireSessionUser(req, req.params.userId)
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
