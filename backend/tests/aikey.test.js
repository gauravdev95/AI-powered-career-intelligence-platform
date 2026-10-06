/**
 * Bring-your-own Gemini API key — verification tests.
 * No Gemini API calls are made: storage, encryption, masking, and the
 * provider key-override plumbing are exercised only.
 */
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'crypto'
import { setupDatabase, teardown, createTestUser } from './helpers.js'
import { query } from '../db/pool.js'
import * as userAiKeys from '../services/userAiKeys.js'
import * as aiService from '../services/aiService.js'
import * as gemini from '../services/providers/gemini.js'

describe('user AI keys', () => {
  let userId

  before(async () => {
    await setupDatabase()
    const user = await createTestUser()
    userId = user.id ?? user.userId
  })

  it('reports not configured for a fresh user', async () => {
    const status = await userAiKeys.getAiKeyStatus(userId)
    assert.equal(status.configured, false)
    assert.equal(status.hint, null)
  })

  it('stores the key encrypted and returns a masked hint', async () => {
    const rawKey = 'AIzaSyD-BYOK-TEST-KEY-9876'
    const { hint } = await userAiKeys.setAiKey(userId, rawKey)
    assert.equal(hint, '••••9876')

    const { rows } = await query(
      'SELECT key_encrypted, key_hint FROM user_ai_keys WHERE user_id = $1',
      [userId],
    )
    assert.match(rows[0].key_encrypted, /^v1\./)
    assert.ok(!rows[0].key_encrypted.includes(rawKey), 'raw key must not appear at rest')
    assert.equal(rows[0].key_hint, '••••9876')
  })

  it('status never exposes the raw key', async () => {
    const status = await userAiKeys.getAiKeyStatus(userId)
    assert.equal(status.configured, true)
    assert.equal(status.hint, '••••9876')
    assert.ok(!JSON.stringify(status).includes('AIzaSyD-BYOK'))
  })

  it('decrypts for the AI path only', async () => {
    assert.equal(await userAiKeys.getDecryptedAiKey(userId), 'AIzaSyD-BYOK-TEST-KEY-9876')
    assert.equal(await userAiKeys.getDecryptedAiKey(randomUUID()), null)
  })

  it('rejects invalid keys', async () => {
    for (const bad of ['', '   ', 'short', 'has space']) {
      await assert.rejects(() => userAiKeys.setAiKey(userId, bad), /INVALID_AI_KEY/)
    }
  })

  it('replaces and deletes', async () => {
    await userAiKeys.setAiKey(userId, 'AIzaSyD-SECOND-KEY-1111')
    assert.equal((await userAiKeys.getAiKeyStatus(userId)).hint, '••••1111')
    assert.equal(await userAiKeys.clearAiKey(userId), true)
    const status = await userAiKeys.getAiKeyStatus(userId)
    assert.equal(status.configured, false)
    assert.equal(await userAiKeys.getDecryptedAiKey(userId), null)
  })

  it('provider prefers the per-call key over the (absent) server key', async () => {
    // .env.test pins GEMINI_API_KEY empty: without an override nothing is available.
    assert.equal(gemini.isAvailable(), false)
    assert.equal(gemini.isAvailable('user-key-123'), true)
    assert.equal(aiService.isAvailable(), false)
    assert.equal(aiService.isAvailable('user-key-123'), true)
  })

  it('encryption round-trips and detects tampering', async () => {
    const blob = userAiKeys.encryptKey('AIzaSyD-ROUND-TRIP-0000')
    assert.equal(userAiKeys.decryptKey(blob), 'AIzaSyD-ROUND-TRIP-0000')
    assert.throws(() => userAiKeys.decryptKey(`${blob}tampered`))
    assert.equal(userAiKeys.maskHint('AIzaSyD-ROUND-TRIP-0000'), '••••0000')
  })
})
