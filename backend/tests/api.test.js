/**
 * API contract tests.
 *
 * Boots the real server in a child process and exercises it over HTTP, so the boot
 * path (config validation, migration, route wiring, error handling) is covered too.
 * The assertions pin the response shapes the existing React frontend depends on.
 */

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'child_process'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 3100 + Math.floor(Math.random() * 800)
const BASE = `http://127.0.0.1:${PORT}`

let child
let dataDir

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'devradar-api-'))

  child = spawn(process.execPath, ['server.js'], {
    cwd: backendDir,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(PORT),
      DATABASE_DRIVER: 'pglite',
      PGLITE_DATA_DIR: dataDir,
      REDIS_ENABLED: 'false',
      GEMINI_API_KEY: '',
      CORS_ORIGIN: 'http://localhost:5173',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const errors = []
  child.stderr.on('data', chunk => errors.push(chunk.toString()))

  // Poll until the server answers, rather than sleeping a fixed amount.
  const deadline = Date.now() + 90000
  for (;;) {
    if (Date.now() > deadline) throw new Error(`server did not start.\n${errors.join('')}`)
    try {
      const response = await fetch(`${BASE}/api/health`)
      if (response.ok) break
    } catch { /* not listening yet */ }
    await new Promise(resolve => setTimeout(resolve, 300))
  }
}, { timeout: 120000 })

after(async () => {
  if (child && child.exitCode == null) {
    // Wait for the process to actually exit before touching its data directory:
    // on Windows the database files stay locked until the handles are released.
    const exited = new Promise(resolve => child.once('exit', resolve))
    child.kill('SIGKILL')
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))])
  }
  // Temp-directory cleanup is best-effort; a leftover directory must not fail the run.
  if (dataDir) {
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      .catch(() => {})
  }
})

/**
 * HTTP client with its own cookie jar — one per simulated browser session.
 * Sessions are the auth story now, so every test that touches user data gets
 * its own client from createUser(); sessionless routes use `anon`.
 */
function makeClient() {
  const jar = new Map()
  async function request(path, init = {}) {
    const headers = { ...(init.headers || {}) }
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
    const response = await fetch(`${BASE}${path}`, { ...init, headers })
    for (const setCookie of response.headers.getSetCookie?.() ?? []) {
      const [pair] = setCookie.split(';')
      const eq = pair.indexOf('=')
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
    }
    return response
  }
  return {
    get: (path) => request(path),
    post: (path, body) => request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  }
}

// Sessionless client for public routes (health, skills, unknown routes, validation).
const anon = makeClient()

async function createUser(overrides = {}) {
  const client = makeClient()
  const response = await client.post('/api/user/init', {
    name: 'API Test Dev',
    experience: '1-2 years',
    stack: ['React', 'Node.js'],
    learning_stack: ['TypeScript'],
    goals: ['Join a fintech startup'],
    target_role: 'Backend Engineer',
    target_companies: ['Razorpay'],
    timeline: '6 months',
    ...overrides,
  })
  assert.equal(response.status, 201)
  return { ...(await response.json()), client }
}

// ── Health ──────────────────────────────────────────────────────────────────

test('health reports database, cache and AI status', async () => {
  const body = await (await anon.get('/api/health')).json()

  assert.equal(body.status, 'ok')
  assert.equal(body.database.connected, true)
  assert.ok(body.ai.provider, 'the active AI provider is named')
  assert.ok(body.datasets.startups > 0)
  // Regression guard: the removed storage and AI providers must never reappear.
  const serialised = JSON.stringify(body).toLowerCase()
  for (const legacy of ['hydra', 'groq', 'claude', 'anthropic']) {
    assert.ok(!serialised.includes(legacy), `legacy provider reference "${legacy}" must not come back`)
  }
})

// ── Onboarding ──────────────────────────────────────────────────────────────

test('user init returns the contract the onboarding wizard expects', async () => {
  const body = await createUser()

  assert.ok(body.userId, 'the wizard stores data.userId in localStorage')
  assert.ok(body.user, 'and reads data.name from the returned user')
  assert.equal(body.user.name, 'API Test Dev')
  assert.deepEqual(body.user.stack.sort(), ['Node.js', 'React'])
})

test('user init rejects an empty stack', async () => {
  const response = await anon.post('/api/user/init', { experience: '1-2 years', stack: [] })
  assert.equal(response.status, 400)
  const body = await response.json()
  assert.equal(body.code, 'VALIDATION_ERROR')
})

test('user routes demand a session, then a well-formed owned id', async () => {
  // No session at all → 401, before any id validation runs.
  assert.equal((await anon.get('/api/user/3f2504e0-4f89-11d3-9a0c-0305e82c3301')).status, 401)
  const { userId, client } = await createUser()
  // With a session: malformed id → 400, somebody else's id → 403, own id → 200.
  assert.equal((await client.get('/api/user/not-a-uuid')).status, 400)
  assert.equal((await client.get('/api/user/3f2504e0-4f89-11d3-9a0c-0305e82c3301')).status, 403)
  assert.equal((await client.get(`/api/user/${userId}`)).status, 200)
})

// ── Matching ────────────────────────────────────────────────────────────────

test('analyze returns ranked startups with the renamed analysis field', async () => {
  const { userId, client } = await createUser()
  const body = await (await client.post('/api/analyze', { userId, stack: ['React', 'Node.js'] })).json()

  assert.ok(Array.isArray(body.startups))
  assert.ok(body.startups.length > 0)
  assert.ok(body.topMatch)
  assert.equal(body.total, body.startups.length)

  const top = body.startups[0]
  assert.equal(typeof top.match_score, 'number')
  assert.ok(top.analysis, 'the shortlist carries a detailed analysis')
  assert.equal(typeof top.analysis.match_percentage, 'number')
  assert.ok(Array.isArray(top.analysis.matching_skills))
  assert.ok(!('claude_analysis' in top), 'the misleading claude_analysis field is gone')

  // Ranking must be monotonically non-increasing.
  const scores = body.startups.map(startup => startup.match_score)
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a))
})

test('gaps returns a priority-ordered report and persists it', async () => {
  const { userId, client } = await createUser()
  const body = await (await client.post('/api/gaps', { userId, stack: ['React'] })).json()

  assert.ok(typeof body.summary === 'string' && body.summary.length > 0)
  assert.ok(Array.isArray(body.priority_skills))
  assert.ok(body.priority_skills.length > 0)
  assert.ok(body.priority_skills[0].skill)
  assert.ok(body.priority_skills[0].resource, 'each gap carries a learning resource')

  // The analysis must have been remembered, not just returned.
  const journey = await (await client.get(`/api/journey/${userId}`)).json()
  assert.ok(journey.journey.some(event => event.type === 'gap_analysis_run'))
})

test('hackathons rank by stack and drop past deadlines', async () => {
  const { userId, client } = await createUser()
  const body = await (await client.get(`/api/hackathons/${userId}?stack=React,Node.js`)).json()

  assert.ok(Array.isArray(body.ranked_hackathons))
  assert.ok(body.ranked_hackathons.every(item => item.days_left == null || item.days_left > 0))
  const scores = body.ranked_hackathons.map(item => item.match_score)
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a))
})

test('skills catalogue is served', async () => {
  const body = await (await anon.get('/api/skills')).json()
  assert.ok(Array.isArray(body) && body.length > 0)
  assert.ok(body[0].name)
})

// ── Memory-backed routes ────────────────────────────────────────────────────

test('journey persists across requests and is newest-first', async () => {
  const { userId, client } = await createUser()
  await client.post('/api/user/' + userId + '/stack', { stack: ['React', 'Go'] })

  const body = await (await client.get(`/api/journey/${userId}`)).json()
  assert.ok(Array.isArray(body.journey))
  assert.ok(body.journey.some(event => event.type === 'account_created'))
  assert.ok(body.journey.some(event => event.type === 'profile_update'))
  assert.ok(body.journey[0].timestamp, 'JourneyView reads entry.timestamp')
})

test('graph-data is served from the memory layer and is internally consistent', async () => {
  const { userId, client } = await createUser()
  const body = await (await client.get(`/api/graph-data/${userId}`)).json()

  assert.ok(Array.isArray(body.nodes))
  assert.ok(body.nodes.length > 0, 'the previously-unused endpoint now returns real nodes')
  assert.ok(Array.isArray(body.edges))
  assert.ok(body.stats)

  const ids = new Set(body.nodes.map(node => node.id))
  assert.ok(body.edges.every(edge => ids.has(edge.from) && ids.has(edge.to)))
  assert.ok(body.nodes.some(node => node.group === 'user'))
  assert.ok(body.nodes.some(node => node.group === 'skill_known'))
})

test('wiki listing and return-context respond for a new user', async () => {
  const { userId, client } = await createUser()

  const wiki = await (await client.get(`/api/wiki-pages/${userId}`)).json()
  assert.deepEqual(wiki, { pages: [], total: 0 })

  const context = await (await client.get(`/api/return-context/${userId}`)).json()
  assert.equal(typeof context.hasHistory, 'boolean')
  assert.ok(Array.isArray(context.urgentItems))
})

test('return-context requires the session owner', async () => {
  const alice = await createUser({ name: 'Alice' })
  const bob = await createUser({ name: 'Bob' })
  assert.equal((await anon.get(`/api/return-context/${alice.userId}`)).status, 401)
  assert.equal((await bob.client.get(`/api/return-context/${alice.userId}`)).status, 403)
  assert.equal((await alice.client.get(`/api/return-context/${alice.userId}`)).status, 200)
})

test('memory search returns ranked results with an explainable breakdown', async () => {
  const { userId, client } = await createUser()
  const body = await (await client.post(`/api/memory/${userId}/search`, { query: 'what are my goals' })).json()

  assert.ok(Array.isArray(body.results))
  assert.ok(body.results.length > 0)
  assert.ok(body.results[0].breakdown.semantic !== undefined)
  assert.ok(body.results[0].score >= 0 && body.results[0].score <= 1)
})

test('memory stats report counts by type', async () => {
  const { userId, client } = await createUser()
  const body = await (await client.get(`/api/memory/${userId}/stats`)).json()

  assert.ok(body.memories > 0)
  assert.ok(body.byType.SKILL >= 2)
  assert.equal(body.wikiPages, 0)
})

// ── Cross-user isolation over HTTP ──────────────────────────────────────────

test('one user cannot read another user\'s data through the API', async () => {
  const alice = await createUser({ name: 'Alice', target_companies: ['Stripe'] })
  const bob = await createUser({ name: 'Bob' })

  // Cross-user reads are rejected at the session boundary…
  assert.equal((await bob.client.get(`/api/user/${alice.userId}`)).status, 403)
  assert.equal((await bob.client.get(`/api/graph-data/${alice.userId}`)).status, 403)
  assert.equal((await bob.client.post(`/api/memory/${alice.userId}/search`, { query: 'Stripe' })).status, 403)

  // …while each owner still sees exactly their own data.
  const bobProfile = await (await bob.client.get(`/api/user/${bob.userId}`)).json()
  assert.equal(bobProfile.name, 'Bob')
  assert.ok(!bobProfile.target_companies.includes('Stripe'))

  const bobGraph = await (await bob.client.get(`/api/graph-data/${bob.userId}`)).json()
  const aliceGraph = await (await alice.client.get(`/api/graph-data/${alice.userId}`)).json()
  const bobIds = new Set(bobGraph.nodes.map(node => node.id))
  assert.ok(aliceGraph.nodes.every(node => !bobIds.has(node.id)), 'no node may be shared between users')
})

// ── Ingest safety ───────────────────────────────────────────────────────────

test('ingest refuses a private-network URL', async () => {
  const { userId, client } = await createUser()
  const response = await client.post('/api/ingest', { userId, input: 'http://169.254.169.254/latest/meta-data/' })

  assert.equal(response.status, 422)
  const body = await response.json()
  assert.equal(body.code, 'BLOCKED_URL')
})

test('ingest refuses a screenshot with an actionable message', async () => {
  const { userId, client } = await createUser()
  const response = await client.post('/api/ingest', { userId, input: 'data:image/png;base64,iVBORw0KGgo=' })

  assert.equal(response.status, 422)
  assert.equal((await response.json()).code, 'UNSUPPORTED_INPUT')
})

test('ingest requires input', async () => {
  const { userId, client } = await createUser()
  const response = await client.post('/api/ingest', { userId, input: '' })
  assert.equal(response.status, 400)
})

// ── Errors and hardening ────────────────────────────────────────────────────

test('unknown routes return a structured 404', async () => {
  const response = await anon.get('/api/does-not-exist')
  assert.equal(response.status, 404)
  assert.equal((await response.json()).code, 'NOT_FOUND')
})

test('security headers are present', async () => {
  const response = await anon.get('/api/health')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(response.headers.get('x-powered-by'), null, 'express must not advertise itself')
})

test('rate limit headers are exposed', async () => {
  const response = await anon.get('/api/health')
  assert.ok(response.headers.get('ratelimit-global-limit'))
  assert.ok(response.headers.get('ratelimit-global-remaining'))
})

test('error responses never leak internals', async () => {
  const response = await anon.get('/api/user/not-a-uuid')
  const body = await response.json()
  assert.ok(!('stack' in body))
  assert.ok(!JSON.stringify(body).toLowerCase().includes('postgres'))
})
