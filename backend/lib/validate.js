/**
 * Input validation and normalisation.
 *
 * Every value that arrives from a client passes through here before it reaches the
 * memory engine or the database. Sanitisation strips control characters and bounds
 * length; it is a defence-in-depth measure layered on top of parameterised SQL,
 * not a substitute for it.
 */

import { badRequest } from './errors.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// Strips C0/C1 control characters and DEL, but deliberately preserves tab, newline
// and carriage return — pasted job descriptions are multi-line and must survive.
const CONTROL_CHARS = new RegExp('[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]', 'g')

/** Collapses control characters and trims to a maximum length. */
export function sanitizeString(value, max = 2000) {
  if (value == null) return ''
  return String(value)
    .replace(CONTROL_CHARS, '')
    .trim()
    .slice(0, max)
}

/** Sanitises, de-duplicates (case-insensitively) and bounds an array of strings. */
export function sanitizeStringArray(value, maxItems = 30, maxLength = 80) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const item of value) {
    const clean = sanitizeString(item, maxLength)
    if (!clean) continue
    const fingerprint = clean.toLowerCase()
    if (seen.has(fingerprint)) continue
    seen.add(fingerprint)
    out.push(clean)
    if (out.length >= maxItems) break
  }
  return out
}

export function requireNonEmptyArray(value, field, maxItems = 30, maxLength = 80) {
  const clean = sanitizeStringArray(value, maxItems, maxLength)
  if (clean.length === 0) throw badRequest(`${field} must be a non-empty array`)
  return clean
}

export function requireString(value, field, max = 2000) {
  const clean = sanitizeString(value, max)
  if (!clean) throw badRequest(`${field} is required`)
  return clean
}

/**
 * Validates a user id. Ids are server-minted UUIDs; rejecting anything else keeps
 * malformed identifiers out of the memory layer entirely.
 */
export function requireUserId(value) {
  const clean = sanitizeString(value, 64)
  if (!UUID_RE.test(clean)) throw badRequest('A valid userId is required', 'INVALID_USER_ID')
  return clean
}

export function isUuid(value) {
  return UUID_RE.test(String(value ?? ''))
}

/** URL-and-filesystem-safe slug used for wiki page keys and graph node ids. */
export function slugify(value, max = 80) {
  return sanitizeString(value, max)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max) || 'untitled'
}

/** Clamps a number into [min, max], falling back when the input is not finite. */
export function clamp(value, min, max, fallback = min) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

/** Parses a positive integer query parameter with a bounded default. */
export function parseLimit(value, fallback, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, max)
}
