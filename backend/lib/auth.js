/**
 * Authentication primitives: password hashing and credential validation.
 *
 * Passwords are hashed with bcrypt (12 rounds by default). The raw password is
 * never persisted and never leaves this module except into bcrypt itself.
 */

import bcrypt from 'bcryptjs'
import config from '../config.js'
import { badRequest } from './errors.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 128

/** Lowercase + trim. Returns '' for non-strings. */
export function normalizeEmail(raw) {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

/** Returns the normalized email or throws 400. */
export function requireEmail(raw) {
  const email = normalizeEmail(raw)
  if (!EMAIL_RE.test(email)) {
    throw badRequest('A valid email address is required', 'INVALID_EMAIL')
  }
  return email
}

/** Returns the password or throws 400 when it is too weak. */
export function requirePassword(raw) {
  if (typeof raw !== 'string' || raw.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      'WEAK_PASSWORD',
    )
  }
  if (raw.length > MAX_PASSWORD_LENGTH) {
    throw badRequest('Password is too long', 'WEAK_PASSWORD')
  }
  return raw
}

export async function hashPassword(password) {
  return bcrypt.hash(password, config.auth.bcryptRounds)
}

/** Always false — never true — when there is no hash to compare against. */
export async function verifyPassword(password, hash) {
  if (typeof password !== 'string' || typeof hash !== 'string' || !hash) return false
  try {
    return await bcrypt.compare(password, hash)
  } catch {
    return false
  }
}
