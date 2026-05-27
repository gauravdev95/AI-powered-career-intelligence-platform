import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { v4 as uuidv4 } from 'uuid'
import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '.env') })

const [
  hydra,
  claude,
  groqAI,
  fetcher,
] = await Promise.all([
  import('./hydradb.js'),
  import('./claude.js'),
  import('./groq.js'),
  import('./fetcher.js'),
])

const {
  initUser,
  getUser,
  updateStack,
  recordStartupView,
  recordHackathonView,
  saveGapAnalysis,
  getReturnContext,
  saveWikiPage,
  getWikiPage,
  getAllWikiPages,
  appendToIngestLog,
  getGraphData,
} = hydra

const {
  analyzeStackVsStartup,
  generateGapReport,
  matchHackathons,
  ingestStep1: claudeIngestStep1,
  ingestStep2GeneratePage: claudeIngestStep2,
  queryWiki: claudeQueryWiki,
  generateRoadmap: claudeRoadmap,
} = claude

const { detectInputType, fetchURL, extractText } = fetcher

const useGroq = groqAI.isAvailable()
const ingestStep1 = useGroq ? groqAI.ingestStep1 : claudeIngestStep1
const ingestStep2GeneratePage = useGroq ? groqAI.ingestStep2GeneratePage : claudeIngestStep2
const queryWiki = useGroq ? groqAI.queryWiki : claudeQueryWiki
const generateRoadmap = useGroq ? groqAI.generateRoadmap : claudeRoadmap

const app = express()
const PORT = Number(process.env.PORT) || 3001
const IS_PRODUCTION = process.env.NODE_ENV === 'production'
const MAX_BODY_SIZE = process.env.MAX_BODY_SIZE || '1mb'
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
]

const startups = JSON.parse(await readFile(join(__dirname, 'data/startups.json'), 'utf8'))
const hackathons = JSON.parse(await readFile(join(__dirname, 'data/hackathons.json'), 'utf8'))
const skills = JSON.parse(await readFile(join(__dirname, 'data/skills.json'), 'utf8'))

class ApiError extends Error {
  constructor(statusCode, message, code = 'API_ERROR') {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

function parseAllowedOrigins() {
  const configured = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
  return configured.length ? configured : DEFAULT_ALLOWED_ORIGINS
}

function isAllowedOrigin(origin) {
  if (!origin) return true
  const allowed = parseAllowedOrigins()
  return allowed.includes(origin) || /\.vercel\.app$/i.test(new URL(origin).hostname)
}

function requestLogger(req, res, next) {
  const started = Date.now()
  res.on('finish', () => {
    const ms = Date.now() - started
    const status = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'
    console[status](`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`)
  })
  next()
}

function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (IS_PRODUCTION) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains')
  }
  next()
}

function createRateLimiter({ windowMs = 15 * 60 * 1000, limit = 120 } = {}) {
  const buckets = new Map()
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown'
    const now = Date.now()
    const bucket = buckets.get(key) ?? { count: 0, resetAt: now + windowMs }

    if (bucket.resetAt <= now) {
      bucket.count = 0
      bucket.resetAt = now + windowMs
    }

    bucket.count += 1
    buckets.set(key, bucket)
    res.setHeader('RateLimit-Limit', String(limit))
    res.setHeader('RateLimit-Remaining', String(Math.max(limit - bucket.count, 0)))
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)))

    if (bucket.count > limit) {
      return res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.' })
    }
    next()
  }
}

function validateUserId(userId) {
  if (!userId || typeof userId !== 'string' || userId.length > 120) {
    throw new ApiError(400, 'A valid userId is required', 'VALIDATION_ERROR')
  }
}

function sanitizeString(value, max = 2000) {
  if (value == null) return ''
  return String(value).replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max)
}

function sanitizeStringArray(value, maxItems = 30, maxLength = 80) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(item => sanitizeString(item, maxLength)).filter(Boolean))].slice(0, maxItems)
}

function requireNonEmptyArray(value, field) {
  const clean = sanitizeStringArray(value)
  if (clean.length === 0) {
    throw new ApiError(400, `${field} must be a non-empty array`, 'VALIDATION_ERROR')
  }
  return clean
}

function basicMatchScore(userStack, startup) {
  const userNorm = userStack.map(s => s.toLowerCase().trim())
  const required = (startup.skills_required ?? []).map(s => s.toLowerCase())
  const matched = userNorm.filter(s => required.some(r => r.includes(s) || s.includes(r)))
  return Math.round((matched.length / Math.max(required.length, 1)) * 100)
}

function slugify(value) {
  return sanitizeString(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled'
}

app.set('trust proxy', 1)
app.disable('x-powered-by')
app.use(securityHeaders)
app.use(cors({
  origin(origin, callback) {
    try {
      if (isAllowedOrigin(origin)) return callback(null, true)
      return callback(new ApiError(403, 'Origin is not allowed by CORS', 'CORS_FORBIDDEN'))
    } catch {
      return callback(new ApiError(403, 'Invalid Origin header', 'CORS_FORBIDDEN'))
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  maxAge: 86400,
}))
app.use(express.json({ limit: MAX_BODY_SIZE }))
app.use(createRateLimiter({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_MAX) || 120,
}))
app.use(requestLogger)

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    hydradb: Boolean(process.env.HYDRADB_API_KEY && process.env.HYDRADB_PROJECT_ID),
    ai: useGroq ? 'groq' : (process.env.ANTHROPIC_API_KEY ? 'claude' : 'none'),
    groq: useGroq,
    claude: Boolean(process.env.ANTHROPIC_API_KEY),
  })
})

app.post('/api/user/init', asyncHandler(async (req, res) => {
  const stack = requireNonEmptyArray(req.body.stack, 'stack')
  const experience = sanitizeString(req.body.experience, 80)
  if (!experience) throw new ApiError(400, 'Experience level is required', 'VALIDATION_ERROR')

  const userId = uuidv4()
  const user = await initUser({
    userId,
    name: sanitizeString(req.body.name, 120) || 'Developer',
    stack,
    learning_stack: sanitizeStringArray(req.body.learning_stack),
    experience,
    goals: sanitizeStringArray(req.body.goals, 10, 80),
    target_role: sanitizeString(req.body.target_role, 120),
    target_companies: sanitizeStringArray(req.body.target_companies, 5, 120),
    timeline: sanitizeString(req.body.timeline, 80),
    learning_style: sanitizeString(req.body.learning_style, 80),
    created_at: new Date().toISOString(),
  })

  res.status(201).json({ userId, message: 'Profile created', user })
}))

app.get('/api/user/:userId', asyncHandler(async (req, res) => {
  validateUserId(req.params.userId)
  const user = await getUser(req.params.userId)
  if (!user) throw new ApiError(404, 'User not found', 'NOT_FOUND')
  res.json(user)
}))

app.post('/api/user/:userId/stack', asyncHandler(async (req, res) => {
  validateUserId(req.params.userId)
  const stack = requireNonEmptyArray(req.body.stack, 'stack')
  const updated = await updateStack(req.params.userId, stack)
  if (!updated) throw new ApiError(404, 'User not found', 'NOT_FOUND')
  res.json({ updated: true })
}))

app.post('/api/analyze', asyncHandler(async (req, res) => {
  validateUserId(req.body.userId)
  const userProfile = await getUser(req.body.userId).catch(() => null)
  const stack = sanitizeStringArray(req.body.stack).length
    ? sanitizeStringArray(req.body.stack)
    : (userProfile?.stack ?? [])
  if (!stack.length) throw new ApiError(400, 'stack must be a non-empty array', 'VALIDATION_ERROR')

  const experience = sanitizeString(req.body.experience, 80) || userProfile?.experience || 'beginner'
  const targetCompanies = sanitizeStringArray(userProfile?.target_companies ?? [], 5, 120)

  let scored = startups.map(startup => ({ ...startup, match_score: basicMatchScore(stack, startup) }))
  if (targetCompanies.length) {
    scored = scored.map(startup => {
      const nameNorm = startup.name.toLowerCase()
      const isTarget = targetCompanies.some(tc => nameNorm.includes(tc.toLowerCase()) || tc.toLowerCase().includes(nameNorm))
      return isTarget ? { ...startup, match_score: Math.min(100, startup.match_score + 20), is_target: true } : startup
    })
  }

  scored.sort((a, b) => b.match_score - a.match_score)
  const top5 = scored.slice(0, 5)
  const analyses = await Promise.allSettled(top5.map(startup => analyzeStackVsStartup(stack, { ...startup, experience })))
  const enrichedTop5 = top5.map((startup, i) => ({
    ...startup,
    claude_analysis: analyses[i].status === 'fulfilled'
      ? analyses[i].value
      : { match_percentage: startup.match_score, matching_skills: [], missing_skills: [], assessment: '', recommended_action: '' },
  }))

  const enrichedMap = new Map(enrichedTop5.map(startup => [startup.id, startup]))
  const allStartups = scored.map(startup => enrichedMap.get(startup.id) ?? startup)
  const topMatch = enrichedTop5[0] ?? null

  if (topMatch) await recordStartupView(req.body.userId, topMatch.id, topMatch.name)
  await updateStack(req.body.userId, stack)

  res.json({ startups: allStartups, topMatch, total: allStartups.length })
}))

app.post('/api/gaps', asyncHandler(async (req, res) => {
  validateUserId(req.body.userId)
  const stack = requireNonEmptyArray(req.body.stack, 'stack')
  const targetCompanies = sanitizeStringArray(req.body.targetCompanies, 10, 120)
  const targets = targetCompanies.length
    ? startups.filter(s => targetCompanies.includes(s.name) || targetCompanies.includes(s.id))
    : startups.slice(0, 5)

  const report = await generateGapReport(stack, targets.length ? targets : startups.slice(0, 5))
  await saveGapAnalysis(req.body.userId, { ...report, stack, targets: targets.map(t => t.name) })
  res.json(report)
}))

app.get('/api/hackathons/:userId', asyncHandler(async (req, res) => {
  validateUserId(req.params.userId)
  const stack = sanitizeString(req.query.stack, 1000).split(',').map(s => s.trim()).filter(Boolean)
  if (!stack.length) return res.json({ ranked_hackathons: hackathons.map(h => ({ ...h, match_score: 0 })) })

  const { ranked_hackathons } = await matchHackathons(stack, hackathons)
  const top = ranked_hackathons[0]
  if (top) await recordHackathonView(req.params.userId, top.id, top.name)
  res.json({ ranked_hackathons })
}))

app.get('/api/return-context/:userId', asyncHandler(async (req, res) => {
  validateUserId(req.params.userId)
  res.json(await getReturnContext(req.params.userId, startups, hackathons))
}))

app.get('/api/skills', (_req, res) => {
  res.json(skills)
})

app.post('/api/ingest', asyncHandler(async (req, res) => {
  validateUserId(req.body.userId)
  const input = sanitizeString(req.body.input, 12000)
  if (!input) throw new ApiError(400, 'input is required', 'VALIDATION_ERROR')

  const inputType = detectInputType(input)
  if (inputType === 'screenshot') {
    throw new ApiError(422, 'Screenshot analysis is not yet supported. Please copy and paste the text from the page directly.', 'UNSUPPORTED_INPUT')
  }

  let content = ''
  if (inputType === 'url') {
    content = await fetchURL(input).catch(err => {
      throw new ApiError(422, `Could not fetch URL: ${err.message}`, 'FETCH_FAILED')
    })
    if (content.replace(/\s+/g, '').length < 300) {
      throw new ApiError(422, 'This page is JavaScript-rendered and cannot be scraped directly. Please copy and paste the job description text instead.', 'FETCH_FAILED')
    }
  } else {
    content = extractText(input, inputType)
  }

  const user = await getUser(req.body.userId)
  const userStack = user?.stack ?? []
  const entities = await ingestStep1(content, userStack)
  const pageJobs = [
    ...(entities.companies ?? []).slice(0, 3).map(entity => ({ type: 'company', entity, name: slugify(entity.name) })),
    ...(entities.skills ?? []).slice(0, 2).map(entity => ({ type: 'skill', entity, name: slugify(entity.name) })),
    ...(entities.hackathons ?? []).slice(0, 1).map(entity => ({ type: 'hackathon', entity, name: slugify(entity.name) })),
    ...(entities.gaps ?? []).slice(0, 2).map(entity => ({ type: 'gap', entity, name: slugify(entity.skill) })),
  ]

  const results = await Promise.allSettled(pageJobs.map(async job => {
    const markdown = await ingestStep2GeneratePage(job.type, job.entity, userStack, content)
    await saveWikiPage(req.body.userId, job.type, job.name, markdown, { source: inputType === 'url' ? input : inputType })
    return { type: job.type, name: job.name, pageKey: `${job.type}/${job.name}` }
  }))
  const saved = results.filter(result => result.status === 'fulfilled').map(result => result.value)

  await appendToIngestLog(req.body.userId, {
    inputType,
    source: inputType === 'url' ? input.slice(0, 200) : `${content.slice(0, 60)}...`,
    pagesCreated: saved.length,
    summary: sanitizeString(entities.summary, 500),
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
    pages: saved,
  })
}))

app.get('/api/wiki-pages/:userId', asyncHandler(async (req, res) => {
  validateUserId(req.params.userId)
  const pages = await getAllWikiPages(req.params.userId)
  res.json({ pages, total: pages.length })
}))

app.get('/api/wiki/:userId/:pageType/:pageName', asyncHandler(async (req, res) => {
  validateUserId(req.params.userId)
  const pageType = slugify(req.params.pageType)
  const pageName = slugify(req.params.pageName)
  const page = await getWikiPage(req.params.userId, pageType, pageName)
  if (!page) throw new ApiError(404, 'Page not found', 'NOT_FOUND')
  res.json(page)
}))

app.post('/api/chat', asyncHandler(async (req, res) => {
  validateUserId(req.body.userId)
  const question = sanitizeString(req.body.question, 1000)
  if (!question) throw new ApiError(400, 'question is required', 'VALIDATION_ERROR')
  const user = await getUser(req.body.userId)
  const userStack = sanitizeStringArray(req.body.userStack).length ? sanitizeStringArray(req.body.userStack) : (user?.stack ?? [])
  const wikiPages = await getAllWikiPages(req.body.userId)
  res.json(await queryWiki(question, wikiPages, userStack))
}))

app.get('/api/roadmap/:userId', asyncHandler(async (req, res) => {
  validateUserId(req.params.userId)
  const user = await getUser(req.params.userId)
  if (!user) throw new ApiError(404, 'User not found', 'NOT_FOUND')
  const lastGapAnalysis = user.gap_analyses?.at(-1)
  const roadmap = await generateRoadmap(user.stack ?? [], lastGapAnalysis?.priority_skills ?? [], user.goals ?? [], await getAllWikiPages(req.params.userId))
  res.json(roadmap)
}))

app.get('/api/journey/:userId', asyncHandler(async (req, res) => {
  validateUserId(req.params.userId)
  const user = await getUser(req.params.userId)
  if (!user) throw new ApiError(404, 'User not found', 'NOT_FOUND')
  res.json({ journey: user.journey ?? [] })
}))

app.get('/api/graph-data/:userId', asyncHandler(async (req, res) => {
  validateUserId(req.params.userId)
  res.json(await getGraphData(req.params.userId))
}))

app.use((_req, _res, next) => {
  next(new ApiError(404, 'Route not found', 'NOT_FOUND'))
})

app.use((err, _req, res, _next) => {
  const statusCode = Number(err.statusCode) || 500
  const isRateLimit = err.isRateLimit || statusCode === 429
  const message = statusCode >= 500
    ? 'Internal server error'
    : err.message

  console.error('[API error]', {
    statusCode,
    code: err.code || (isRateLimit ? 'RATE_LIMITED' : 'INTERNAL_ERROR'),
    message: err.message,
    stack: IS_PRODUCTION ? undefined : err.stack,
  })

  res.status(statusCode).json({
    error: isRateLimit ? 'AI daily token limit reached. Please try again later or configure a fallback provider.' : message,
    code: err.code || (isRateLimit ? 'RATE_LIMITED' : 'INTERNAL_ERROR'),
    ...(IS_PRODUCTION ? {} : { detail: err.message }),
  })
})

app.listen(PORT, () => {
  console.log('----------------------------------------')
  console.log(`DevRadar backend http://localhost:${PORT}`)
  console.log(`Environment      ${process.env.NODE_ENV || 'development'}`)
  console.log(`HydraDB          ${process.env.HYDRADB_API_KEY ? 'configured' : 'local Map fallback'}`)
  console.log(`AI provider      ${useGroq ? 'Groq' : (process.env.ANTHROPIC_API_KEY ? 'Claude' : 'none')}`)
  console.log(`Startups loaded  ${startups.length}`)
  console.log(`Hackathons       ${hackathons.length}`)
  console.log(`Skills           ${skills.length}`)
  console.log('----------------------------------------')
})
