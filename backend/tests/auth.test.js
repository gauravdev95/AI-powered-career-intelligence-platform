/**
 * Authentication contract tests: signup, login, logout, session ownership.
 *
 * Boots the real server in a child process (same as api.test.js) so the session
 * middleware, cookie handling and rate limiting are exercised over HTTP.
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
  dataDir = await mkdtemp(join(tmpdir(), 'devradar-auth-'))

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
    const exited = new Promise(resolve => child.once('exit', resolve))
    child.kill('SIGKILL')
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))])
  }
  if (dataDir) {
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      .catch(() => {})
  }
})

/** One simulated browser: own cookie jar, own session. */
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
    put: (path, body) => request(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    cookieValue: (name) => jar.get(name),
  }
}

const anon = makeClient()
let n = 0
const email = () => `auth${++n}@example.com`

// ── Signup ──────────────────────────────────────────────────────────────────

test('signup creates an account and signs the session in', async () => {
  const client = makeClient()
  const response = await client.post('/api/auth/signup', {
    email: 'NewUser@Example.COM', password: 'correct-horse-1', name: 'New User',
  })
  assert.equal(response.status, 201)
  assert.ok(response.headers.getSetCookie?.()?.some(c => c.startsWith('grafted.sid=')),
    'signup must set the session cookie')

  const body = await response.json()
  assert.equal(body.user.email, 'newuser@example.com', 'email is normalized to lowercase')
  assert.equal(body.user.hasPassword, true)
  assert.ok(!('password_hash' in body.user), 'the hash must never be serialized')

  const me = await client.get('/api/auth/me')
  assert.equal(me.status, 200)
  assert.equal((await me.json()).user.userId, body.userId)
})

test('signup rejects duplicates, weak passwords and bad emails', async () => {
  const client = makeClient()
  const first = await client.post('/api/auth/signup', { email: email(), password: 'valid-pass-1' })
  assert.equal(first.status, 201)
  const dupEmail = (await first.json()).user.email

  const dup = await makeClient().post('/api/auth/signup', { email: dupEmail, password: 'valid-pass-2' })
  assert.equal(dup.status, 409)
  assert.equal((await dup.json()).code, 'EMAIL_TAKEN')

  assert.equal((await anon.post('/api/auth/signup', { email: email(), password: 'short' })).status, 400)
  assert.equal((await anon.post('/api/auth/signup', { email: 'not-an-email', password: 'valid-pass-1' })).status, 400)
  assert.equal((await anon.post('/api/auth/signup', { password: 'valid-pass-1' })).status, 400)
})

// ── Login / logout ──────────────────────────────────────────────────────────

test('login accepts good credentials and rejects bad ones without enumeration', async () => {
  const em = email()
  const signupClient = makeClient()
  await signupClient.post('/api/auth/signup', { email: em, password: 'right-password-1' })

  const client = makeClient()
  const ok = await client.post('/api/auth/login', { email: em, password: 'right-password-1' })
  assert.equal(ok.status, 200)
  assert.equal((await client.get('/api/auth/me')).status, 200)

  const wrongPass = await makeClient().post('/api/auth/login', { email: em, password: 'wrong-password-1' })
  assert.equal(wrongPass.status, 401)
  const unknown = await makeClient().post('/api/auth/login', { email: email(), password: 'wrong-password-1' })
  assert.equal(unknown.status, 401)
  // Identical message either way: no user enumeration.
  assert.equal((await wrongPass.json()).error, (await unknown.json()).error)
})

test('login rotates the session id (fixation resistance)', async () => {
  const em = email()
  const c = makeClient()
  await c.post('/api/auth/signup', { email: em, password: 'some-password-1' })
  const before = c.cookieValue('grafted.sid')

  const c2 = makeClient()
  await c2.post('/api/auth/login', { email: em, password: 'some-password-1' })
  const after = c2.cookieValue('grafted.sid')
  assert.ok(before && after && before !== after, 'a fresh session id is minted at login')
})

test('logout destroys the session', async () => {
  const client = makeClient()
  await client.post('/api/auth/signup', { email: email(), password: 'logout-test-1' })
  assert.equal((await client.get('/api/auth/me')).status, 200)

  const out = await client.post('/api/auth/logout', {})
  assert.equal(out.status, 200)
  assert.equal((await client.get('/api/auth/me')).status, 401)
})

test('me without a session is 401', async () => {
  const response = await anon.get('/api/auth/me')
  assert.equal(response.status, 401)
  assert.equal((await response.json()).code, 'NOT_SIGNED_IN')
})

// ── Guest flow ──────────────────────────────────────────────────────────────

test('guest init binds to the session and is idempotent', async () => {
  const client = makeClient()
  const first = await client.post('/api/user/init', {
    name: 'Guest', stack: ['React'], experience: '0-1 years',
  })
  assert.equal(first.status, 201)
  const { userId } = await first.json()

  const second = await client.post('/api/user/init', {
    name: 'Guest', stack: ['React'], experience: '0-1 years',
  })
  assert.equal(second.status, 200)
  assert.equal((await second.json()).userId, userId, 'same session → same user, no duplicate')
})

test('guest signup upgrades in place and keeps every memory', async () => {  const client = makeClient()
  const guestId = (await (await client.post('/api/user/init', {
    name: 'Guest', stack: ['React'], experience: '0-1 years',
  })).json()).userId

  const em = email()
  const upgraded = await client.post('/api/auth/signup', { email: em, password: 'upgrade-pass-1' })
  assert.equal(upgraded.status, 201)
  const body = await upgraded.json()
  assert.equal(body.userId, guestId, 'the guest user becomes the account — nothing is orphaned')
  assert.equal(body.user.email, em)

  // The onboarding memories survived the upgrade.
  const profile = await (await client.get(`/api/user/${guestId}`)).json()
  assert.ok(profile.stack.includes('React'))
})

test('PUT /api/user/:id/profile applies wizard answers to an existing account', async () => {
  // Fresh signup, straight into the wizard: init restores the session user,
  // then the wizard PUTs the answers here instead of losing them.
  const client = makeClient()
  const { userId } = await (await client.post('/api/auth/signup', {
    email: email(), password: 'profile-put-1', name: 'Wizard Dev',
  })).json()

  const restored = await client.post('/api/user/init', {
    name: 'Wizard Dev', stack: ['React'], experience: '0-1 years',
  })
  assert.equal(restored.status, 200)
  assert.equal((await restored.json()).message, 'Career memory restored')

  const put = await client.put(`/api/user/${userId}/profile`, {
    name: 'Wizard Dev',
    experience: '1-2 years',
    stack: ['React', 'Node.js'],
    goals: ['get hired'],
    target_role: 'SWE',
  })
  assert.equal(put.status, 200)
  const { profile } = await put.json()
  assert.deepEqual(profile.stack.sort(), ['Node.js', 'React'])
  assert.deepEqual(profile.goals, ['get hired'])
  assert.equal(profile.experience, '1-2 years')

  // Ownership holds on this route too.
  const other = makeClient()
  await other.post('/api/auth/signup', { email: email(), password: 'profile-put-2' })
  assert.equal((await other.put(`/api/user/${userId}/profile`, {
    name: 'Mallory', experience: 'x', stack: ['y'],
  })).status, 403)
  assert.equal((await anon.put(`/api/user/${userId}/profile`, {
    name: 'Mallory', experience: 'x', stack: ['y'],
  })).status, 401)
})
