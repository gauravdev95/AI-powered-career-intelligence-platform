/**
 * MemoryExtractor — turns raw material into candidate memories.
 *
 * Four inbound channels, each with different trust characteristics:
 *   onboarding   the developer fills the wizard        → high confidence, high quality
 *   ingest       a job description or scraped page     → AI-extracted, medium quality
 *   conversation the developer says something in chat  → selective, low-medium quality
 *   inference    our own matching produces a gap       → derived, lowest quality
 *
 * The extractor's job is to normalise all four into the same candidate shape, assign
 * honest importance/confidence/source values, and attach a stable `dedupKey` so the
 * deduplicator can recognise the same fact arriving twice through different channels.
 * It does not write anything — MemoryEngine owns persistence.
 */

import * as aiService from '../services/aiService.js'
import { slugify } from '../lib/validate.js'
import { MEMORY_TYPES, MEMORY_SOURCES, defaultImportance, isMemoryType } from './types.js'

/** Canonical natural key for a fact, so the same skill always lands in one slot. */
export function dedupKeyFor(type, name) {
  return `${type.toLowerCase()}:${slugify(name)}`
}

function candidate({ type, name, content, data = {}, source, importance, confidence, title }) {
  return {
    type,
    dedupKey: name ? dedupKeyFor(type, name) : null,
    title: title ?? name ?? '',
    content,
    data,
    source,
    importance: importance ?? defaultImportance(type),
    confidence: confidence ?? 0.7,
  }
}

// ── Onboarding ──────────────────────────────────────────────────────────────

/**
 * Expands a completed onboarding wizard into durable memories.
 * These are the highest-trust facts in the system: the developer stated them
 * directly about themselves.
 */
export function fromOnboarding(profile) {
  const source = MEMORY_SOURCES.ONBOARDING
  const out = []
  const name = profile.name || 'This developer'

  const profileParts = [
    `${name} is a developer with ${profile.experience || 'unspecified'} of experience`,
    profile.targetRole ? `targeting ${profile.targetRole} roles` : null,
    profile.timeline ? `on a ${profile.timeline} timeline` : null,
  ].filter(Boolean)

  out.push(candidate({
    type: MEMORY_TYPES.PROFILE,
    name: 'identity',
    title: name,
    content: `${profileParts.join(', ')}.`,
    data: {
      name,
      experience: profile.experience,
      targetRole: profile.targetRole,
      timeline: profile.timeline,
      learningStyle: profile.learningStyle,
    },
    source,
    confidence: 0.95,
  }))

  for (const skill of profile.stack ?? []) {
    out.push(candidate({
      type: MEMORY_TYPES.SKILL,
      name: skill,
      content: `${name} knows ${skill} and considers it part of their current stack.`,
      data: { skill, proficiency: 'known' },
      source,
      confidence: 0.9,
    }))
  }

  for (const skill of profile.learningStack ?? []) {
    out.push(candidate({
      type: MEMORY_TYPES.SKILL,
      name: skill,
      content: `${name} is currently learning ${skill}.`,
      data: { skill, proficiency: 'learning' },
      source,
      importance: 0.7,
      confidence: 0.85,
    }))
  }

  for (const goal of profile.goals ?? []) {
    out.push(candidate({
      type: MEMORY_TYPES.GOAL,
      name: goal,
      content: `${name}'s career goal: ${goal}.`,
      data: { goal },
      source,
      confidence: 0.9,
    }))
  }

  for (const company of profile.targetCompanies ?? []) {
    out.push(candidate({
      type: MEMORY_TYPES.TARGET_COMPANY,
      name: company,
      content: `${name} is targeting ${company} as a company they want to work at.`,
      data: { company },
      source,
      confidence: 0.9,
    }))
  }

  if (profile.learningStyle) {
    out.push(candidate({
      type: MEMORY_TYPES.PREFERENCE,
      name: 'learning-style',
      content: `${name} prefers to learn by ${profile.learningStyle}.`,
      data: { learningStyle: profile.learningStyle },
      source,
      confidence: 0.85,
    }))
  }

  return out
}

// ── Ingest ──────────────────────────────────────────────────────────────────

/**
 * Runs AI entity extraction over ingested content and converts the result into
 * candidates. Returns both the candidates and the raw entity payload, because the
 * ingest endpoint reports entity counts back to the UI.
 */
export async function fromIngest(content, { userStack = [], inputType = 'text', sourceUrl = '', apiKey } = {}) {
  const entities = await aiService.extractEntities(content, userStack, { ...(apiKey ? { apiKey } : null) })
  const source = inputType === 'url' ? MEMORY_SOURCES.INGEST_URL : MEMORY_SOURCES.INGEST_TEXT
  const provenance = sourceUrl ? { sourceUrl } : {}
  const out = []

  for (const company of entities.companies ?? []) {
    if (!company?.name) continue
    const skills = Array.isArray(company.skills_required) ? company.skills_required : []
    out.push(candidate({
      type: MEMORY_TYPES.COMPANY,
      name: company.name,
      content: `${company.name}${company.type ? ` (${company.type})` : ''} appeared in the developer's ingested content.`
        + `${skills.length ? ` It requires ${skills.join(', ')}.` : ''}`
        + `${company.notes ? ` ${company.notes}` : ''}`,
      data: { ...provenance, company: company.name, type: company.type, skillsRequired: skills, notes: company.notes },
      source,
      confidence: 0.75,
    }))
  }

  for (const skill of entities.skills ?? []) {
    if (!skill?.name) continue
    out.push(candidate({
      type: MEMORY_TYPES.JOB,
      name: `skill-demand-${skill.name}`,
      title: skill.name,
      content: `${skill.name}${skill.category ? ` (${skill.category})` : ''} was requested in content the developer ingested.`
        + `${skill.relevance ? ` Relevance: ${skill.relevance}` : ''}`,
      data: { ...provenance, skill: skill.name, category: skill.category },
      source,
      importance: 0.5,
      confidence: 0.7,
    }))
  }

  for (const hackathon of entities.hackathons ?? []) {
    if (!hackathon?.name) continue
    out.push(candidate({
      type: MEMORY_TYPES.HACKATHON,
      name: hackathon.name,
      content: `${hackathon.name}${hackathon.platform ? ` on ${hackathon.platform}` : ''} is an event relevant to the developer.`
        + `${hackathon.deadline ? ` Deadline: ${hackathon.deadline}.` : ''}`
        + `${hackathon.prize ? ` Prize: ${hackathon.prize}.` : ''}`,
      data: {
        ...provenance,
        hackathon: hackathon.name,
        platform: hackathon.platform,
        deadline: hackathon.deadline,
        prize: hackathon.prize,
        skillsRelevant: hackathon.skills_relevant ?? [],
      },
      source,
      confidence: 0.7,
    }))
  }

  for (const gap of entities.gaps ?? []) {
    if (!gap?.skill) continue
    out.push(candidate({
      type: MEMORY_TYPES.SKILL_GAP,
      name: gap.skill,
      content: `${gap.skill} is a gap for this developer.${gap.why ? ` ${gap.why}` : ''}`,
      data: { ...provenance, skill: gap.skill, why: gap.why, urgency: gap.urgency ?? 'medium' },
      source,
      importance: gap.urgency === 'high' ? 0.85 : defaultImportance(MEMORY_TYPES.SKILL_GAP),
      confidence: 0.65,
    }))
  }

  return { candidates: out, entities }
}

// ── Conversation ────────────────────────────────────────────────────────────

const ALLOWED_CONVERSATION_TYPES = new Set([
  MEMORY_TYPES.GOAL,
  MEMORY_TYPES.PREFERENCE,
  MEMORY_TYPES.TARGET_COMPANY,
  MEMORY_TYPES.SKILL,
  MEMORY_TYPES.SKILL_GAP,
])

/**
 * Extracts durable facts from a chat exchange.
 *
 * Deliberately conservative: chat is mostly transient, and promoting every turn to
 * long-term memory would poison retrieval within a few sessions. The model is asked
 * for durable self-statements only, the result is filtered to a safe type allowlist,
 * and confidence is capped — a claim made in passing is weaker evidence than the
 * same claim entered in onboarding.
 */
export async function fromConversation({ question, answer, userStack = [], apiKey }) {
  if (!aiService.isAvailable(apiKey)) return []

  const extracted = await aiService.extractDurableMemories({ question, answer, userStack, ...(apiKey ? { apiKey } : null) })

  return extracted
    .filter(item => item?.content && isMemoryType(item.type) && ALLOWED_CONVERSATION_TYPES.has(item.type))
    .slice(0, 5)
    .map(item => candidate({
      type: item.type,
      name: item.content.slice(0, 60),
      content: String(item.content).slice(0, 500),
      data: { origin: 'chat' },
      source: MEMORY_SOURCES.CONVERSATION,
      importance: Math.min(Number(item.importance) || 0.5, 0.8),
      confidence: Math.min(Number(item.confidence) || 0.6, 0.75),
    }))
}

// ── Inference ───────────────────────────────────────────────────────────────

/** Converts computed skill gaps into memories, tagged as derived rather than stated. */
export function fromGapAnalysis(gaps, { targets = [] } = {}) {
  return (gaps ?? []).map(gap => candidate({
    type: MEMORY_TYPES.SKILL_GAP,
    name: gap.skill,
    content: `${gap.skill} is a skill gap${targets.length ? ` for target companies ${targets.slice(0, 3).join(', ')}` : ''}.`
      + `${gap.reason ? ` ${gap.reason}` : ''}`,
    data: { skill: gap.skill, reason: gap.reason, weeksToLearn: gap.weeks_to_learn, salaryBoost: gap.salary_boost, targets },
    source: MEMORY_SOURCES.INFERENCE,
    importance: 0.7,
    confidence: 0.6,
  }))
}

/** Records that the developer engaged with a company or event from our dataset. */
export function fromCuratedEntity(kind, entity) {
  const type = kind === 'hackathon' ? MEMORY_TYPES.HACKATHON : MEMORY_TYPES.COMPANY
  return candidate({
    type,
    name: entity.name,
    content: kind === 'hackathon'
      ? `${entity.name} (${entity.platform ?? 'hackathon'}) is an event the developer looked at.`
        + `${entity.deadline ? ` Deadline ${entity.deadline}.` : ''}`
      : `${entity.name} is a ${entity.type ?? 'company'} in ${entity.location ?? 'India'} the developer looked at.`
        + `${entity.skills_required?.length ? ` It hires for ${entity.skills_required.join(', ')}.` : ''}`
        + `${entity.salary_range_lpa ? ` Salary range ${entity.salary_range_lpa} LPA.` : ''}`,
    data: { entityId: entity.id, ...entity },
    source: MEMORY_SOURCES.CURATED_DATASET,
    importance: 0.55,
    confidence: 0.9,
  })
}

export default {
  fromOnboarding, fromIngest, fromConversation, fromGapAnalysis, fromCuratedEntity, dedupKeyFor,
}
