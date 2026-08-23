/**
 * Vocabulary of the Career Memory Engine.
 *
 * Memory type, status, and source are the three axes that drive storage,
 * conflict resolution and ranking. Keeping them here — rather than as scattered
 * string literals — is what makes the engine's behaviour auditable.
 */

/** What a memory is about. */
export const MEMORY_TYPES = Object.freeze({
  PROFILE: 'PROFILE',                 // who the developer is (experience, role, timeline)
  SKILL: 'SKILL',                     // a skill they have
  SKILL_GAP: 'SKILL_GAP',             // a skill they need but lack
  GOAL: 'GOAL',                       // what they are trying to achieve
  TARGET_COMPANY: 'TARGET_COMPANY',   // a company they are aiming for
  JOB: 'JOB',                         // a specific role/posting they engaged with
  COMPANY: 'COMPANY',                 // a company they encountered
  HACKATHON: 'HACKATHON',             // an event they encountered
  WIKI: 'WIKI',                       // a generated wiki page (document of record)
  WIKI_CHUNK: 'WIKI_CHUNK',           // retrieval-sized slice of a wiki page
  JOURNEY_EVENT: 'JOURNEY_EVENT',     // a milestone on their timeline
  CONVERSATION: 'CONVERSATION',       // a chat turn (short-term, trimmed)
  PREFERENCE: 'PREFERENCE',           // how they like to work or learn
  ROADMAP: 'ROADMAP',                 // a generated learning plan
})

export const MEMORY_TYPE_LIST = Object.freeze(Object.values(MEMORY_TYPES))

export function isMemoryType(value) {
  return MEMORY_TYPE_LIST.includes(value)
}

/** Lifecycle state. Only ACTIVE memories are retrievable by default. */
export const MEMORY_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',           // current truth
  SUPERSEDED: 'SUPERSEDED',   // replaced by a newer memory (points at it via superseded_by)
  CONFLICTED: 'CONFLICTED',   // contradicts another memory; needs resolution before use
  ARCHIVED: 'ARCHIVED',       // intentionally retired, kept for history
})

export const MEMORY_STATUS_LIST = Object.freeze(Object.values(MEMORY_STATUS))

/**
 * How a memory came to exist, and how much we trust that channel.
 * Source quality is an independent ranking signal from confidence: a low-quality
 * source can still yield a high-confidence fact, and vice versa.
 */
export const MEMORY_SOURCES = Object.freeze({
  ONBOARDING: 'onboarding',           // the developer typed it into the wizard
  USER_INPUT: 'user_input',           // the developer edited it in-app
  CURATED_DATASET: 'curated_dataset', // our researched startup/skill/hackathon data
  INGEST_TEXT: 'ingest_text',         // pasted job description
  INGEST_URL: 'ingest_url',           // scraped page
  AI_EXTRACTION: 'ai_extraction',     // model pulled it out of content
  CONVERSATION: 'conversation',       // said during chat
  INFERENCE: 'inference',             // derived by our own matching logic
  SYSTEM: 'system',                   // bookkeeping
})

const SOURCE_QUALITY = Object.freeze({
  [MEMORY_SOURCES.ONBOARDING]: 0.95,
  [MEMORY_SOURCES.USER_INPUT]: 0.95,
  [MEMORY_SOURCES.CURATED_DATASET]: 0.85,
  [MEMORY_SOURCES.INGEST_TEXT]: 0.70,
  [MEMORY_SOURCES.INGEST_URL]: 0.60,
  [MEMORY_SOURCES.AI_EXTRACTION]: 0.55,
  [MEMORY_SOURCES.CONVERSATION]: 0.50,
  [MEMORY_SOURCES.INFERENCE]: 0.40,
  [MEMORY_SOURCES.SYSTEM]: 0.40,
})

export function sourceQuality(source) {
  return SOURCE_QUALITY[source] ?? 0.4
}

/**
 * Baseline importance per type, used when a caller does not supply one.
 * Things the developer told us about themselves outrank things we scraped.
 */
const DEFAULT_IMPORTANCE = Object.freeze({
  [MEMORY_TYPES.PROFILE]: 0.95,
  [MEMORY_TYPES.GOAL]: 0.90,
  [MEMORY_TYPES.TARGET_COMPANY]: 0.85,
  [MEMORY_TYPES.SKILL]: 0.80,
  [MEMORY_TYPES.SKILL_GAP]: 0.75,
  [MEMORY_TYPES.PREFERENCE]: 0.70,
  [MEMORY_TYPES.ROADMAP]: 0.65,
  [MEMORY_TYPES.JOB]: 0.60,
  [MEMORY_TYPES.COMPANY]: 0.55,
  [MEMORY_TYPES.HACKATHON]: 0.55,
  [MEMORY_TYPES.WIKI]: 0.50,
  [MEMORY_TYPES.WIKI_CHUNK]: 0.45,
  [MEMORY_TYPES.JOURNEY_EVENT]: 0.40,
  [MEMORY_TYPES.CONVERSATION]: 0.25,
})

export function defaultImportance(type) {
  return DEFAULT_IMPORTANCE[type] ?? 0.5
}

/**
 * Types whose facts are mutually exclusive per natural key: storing a new one with
 * the same dedup_key supersedes the old rather than accumulating duplicates.
 */
export const SINGLETON_TYPES = Object.freeze(new Set([
  MEMORY_TYPES.PROFILE,
  MEMORY_TYPES.SKILL,
  MEMORY_TYPES.SKILL_GAP,
  MEMORY_TYPES.TARGET_COMPANY,
  MEMORY_TYPES.PREFERENCE,
  MEMORY_TYPES.ROADMAP,
]))

/** Edge labels in the memory graph. */
export const RELATIONS = Object.freeze({
  HAS_SKILL: 'HAS_SKILL',
  NEEDS_SKILL: 'NEEDS_SKILL',
  REQUIRES: 'REQUIRES',
  TARGETS: 'TARGETS',
  MENTIONS: 'MENTIONS',
  LINKS_TO: 'LINKS_TO',
  DERIVED_FROM: 'DERIVED_FROM',
  SUPERSEDES: 'SUPERSEDES',
  RELATES_TO: 'RELATES_TO',
})

/** Journey event types the frontend already knows how to render. */
export const JOURNEY_TYPES = Object.freeze({
  ACCOUNT_CREATED: 'account_created',
  PROFILE_UPDATE: 'profile_update',
  SKILL_LEARNED: 'skill_learned',
  WIKI_INGEST: 'wiki_ingest',
  ROADMAP_GEN: 'roadmap_gen',
  CHAT_SESSION: 'chat_session',
  STARTUP_VIEWED: 'startup_viewed',
  HACKATHON_VIEWED: 'hackathon_viewed',
  GAP_ANALYSIS_RUN: 'gap_analysis_run',
  RETURN_VISIT: 'return_visit',
})

export default {
  MEMORY_TYPES, MEMORY_TYPE_LIST, MEMORY_STATUS, MEMORY_STATUS_LIST,
  MEMORY_SOURCES, RELATIONS, JOURNEY_TYPES, SINGLETON_TYPES,
  sourceQuality, defaultImportance, isMemoryType,
}
