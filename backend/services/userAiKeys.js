/**
 * Bring-your-own Gemini API key — per-user key storage and resolution.
 *
 * Problem: the server's GEMINI_API_KEY quota can be exhausted, degrading AI
 * features for everyone. A user with their own key can store it here; every AI
 * call made on their behalf then prefers their key and falls back to the server
 * key when they haven't stored one.
 *
 * Security model:
 * - The raw key is stored ENCRYPTED (AES-256-GCM) in `user_ai_keys`. The
 *   encryption key is derived from SESSION_SECRET via scrypt, so a database
 *   dump alone never exposes a usable key. Rotating SESSION_SECRET invalidates
 *   stored keys (users re-enter them) — fail closed, never fail open.
 * - The raw key is NEVER returned by any route and NEVER logged. Only a masked
 *   hint (last 4 characters) is ever exposed.
 * - Decryption happens in exactly one place: getDecryptedAiKey(), which is for
 *   the AI call path only. Routes use getAiKeyStatus(), which cannot see the key.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import config from '../config.js'
import { query } from '../db/pool.js'
import { badRequest } from '../lib/errors.js'

const ALGORITHM = 'aes-256-gcm'
const KEY_VERSION = 'v1'
// Distinct scrypt salt: the derived key must differ from anything else built on
// SESSION_SECRET (session signing uses it directly).
const SCRYPT_SALT = 'grafted-ai-key-encryption-v1'

const MIN_KEY_LENGTH = 8
const MAX_KEY_LENGTH = 512

// Process-ephemeral fallback, mirroring server.js: when SESSION_SECRET is unset
// (dev/test only — production refuses to boot without it), encryption still
// works but stored keys do not survive a restart.
let ephemeralSecret = null

function baseSecret() {
  if (config.auth.sessionSecret) return config.auth.sessionSecret
  if (!ephemeralSecret) {
    ephemeralSecret = randomBytes(32).toString('hex')
    console.warn('[ai-keys] SESSION_SECRET is not set — using an ephemeral encryption secret. Stored API keys will not survive a restart.')
  }
  return ephemeralSecret
}

function encryptionKey() {
  return scryptSync(baseSecret(), SCRYPT_SALT, 32)
}

/** Encrypts a raw key. Returns a versioned `v1.<iv>.<ciphertext>.<tag>` blob. */
export function encryptKey(rawKey) {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(rawKey, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [KEY_VERSION, iv.toString('base64'), ciphertext.toString('base64'), tag.toString('base64')].join('.')
}

/** Decrypts a blob from encryptKey(). Throws on tampering or version mismatch. */
export function decryptKey(blob) {
  const parts = String(blob ?? '').split('.')
  if (parts.length !== 4 || parts[0] !== KEY_VERSION) {
    throw new Error('Unsupported AI key blob format.')
  }
  const [, ivB64, ctB64, tagB64] = parts
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

/** Public-safe hint: never reveals more than the last 4 characters. */
export function maskHint(rawKey) {
  const tail = String(rawKey).slice(-4)
  return `••••${tail}`
}

/** Validates a user-supplied key. Returns the trimmed key or throws 400. */
export function validateKey(raw) {
  const key = typeof raw === 'string' ? raw.trim() : ''
  if (key.length < MIN_KEY_LENGTH) {
    throw badRequest('Enter a valid Gemini API key.', 'INVALID_AI_KEY')
  }
  if (key.length > MAX_KEY_LENGTH) {
    throw badRequest('That key looks too long to be a Gemini API key.', 'INVALID_AI_KEY')
  }
  if (/\s/.test(key)) {
    throw badRequest('API keys do not contain spaces — check for a copy/paste error.', 'INVALID_AI_KEY')
  }
  return key
}

/** Stores (or replaces) the user's key. Returns { hint }. Never logs the key. */
export async function setAiKey(userId, rawKey) {
  const key = validateKey(rawKey)
  const hint = maskHint(key)
  await query(
    `INSERT INTO user_ai_keys (user_id, key_encrypted, key_hint, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id) DO UPDATE
       SET key_encrypted = EXCLUDED.key_encrypted,
           key_hint      = EXCLUDED.key_hint,
           updated_at    = now()`,
    [userId, encryptKey(key), hint],
  )
  return { hint }
}

/** Route-safe status: { configured, hint }. The raw key is never selected here. */
export async function getAiKeyStatus(userId) {
  const { rows } = await query(
    'SELECT key_hint FROM user_ai_keys WHERE user_id = $1',
    [userId],
  )
  const row = rows[0]
  return row
    ? { configured: true, hint: row.key_hint }
    : { configured: false, hint: null }
}

/** Removes the user's key. Returns true when a row was deleted. */
export async function clearAiKey(userId) {
  const { rowCount } = await query(
    'DELETE FROM user_ai_keys WHERE user_id = $1',
    [userId],
  )
  return rowCount > 0
}

/**
 * INTERNAL — AI call path only. Returns the decrypted raw key, or null when the
 * user has none (or it cannot be decrypted — e.g. after a SESSION_SECRET rotation,
 * in which case the user simply re-enters the key). Never throws for missing keys;
 * never logs the key.
 */
export async function getDecryptedAiKey(userId) {
  if (!userId) return null
  let rows
  try {
    ;({ rows } = await query(
      'SELECT key_encrypted FROM user_ai_keys WHERE user_id = $1',
      [userId],
    ))
  } catch {
    return null
  }
  const blob = rows[0]?.key_encrypted
  if (!blob) return null
  try {
    return decryptKey(blob)
  } catch {
    return null
  }
}

export default { encryptKey, decryptKey, maskHint, validateKey, setAiKey, getAiKeyStatus, clearAiKey, getDecryptedAiKey }
