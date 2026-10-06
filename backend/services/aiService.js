/**
 * Provider-agnostic AI service.
 *
 * Everything above this file speaks in career-domain tasks ("extract entities from
 * this job description") rather than provider primitives. Swapping Gemini for another
 * model means adding one module under providers/ and changing AI_PROVIDER — no caller
 * changes.
 *
 * Every task degrades to a deterministic fallback when the provider is unavailable,
 * so Grafted stays usable (with reduced intelligence) without an API key.
 */

import config from '../config.js'
import * as gemini from './providers/gemini.js'
import { redact } from '../lib/errors.js'

const PROVIDERS = { gemini }

function provider() {
  const selected = PROVIDERS[config.ai.provider]
  if (!selected) throw new Error(`Unknown AI_PROVIDER "${config.ai.provider}". Available: ${Object.keys(PROVIDERS).join(', ')}`)
  return selected
}

export function isAvailable(apiKey) {
  return provider().isAvailable(apiKey)
}

export function describe() {
  const active = provider()
  return {
    provider: active.name,
    model: active.modelId(),
    embeddingModel: config.ai.embeddingModel,
    embeddingDimensions: config.ai.embeddingDimensions,
    available: active.isAvailable(),
  }
}

/**
 * Parses model output as JSON, tolerating fenced code blocks and leading prose.
 * Returns `fallback` rather than throwing: a malformed generation must never 500.
 */
export function parseJson(text, fallback = null) {
  if (!text) return fallback
  try {
    return JSON.parse(text)
  } catch { /* fall through to extraction */ }

  const cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch { /* fall through to extraction */ }

  const match = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
  if (!match) return fallback
  try {
    return JSON.parse(match[0])
  } catch {
    return fallback
  }
}

/**
 * Runs a generation task, logging and swallowing provider failures.
 *
 * Rate limits used to be rethrown so the route could 429. That made a quota problem
 * look like a broken product: the user asked a question and got an error page, even
 * though their memory, matching and search were all fine and every task here has a
 * deterministic fallback. A 429 now degrades like any other provider failure —
 * `reason` tells the caller why, so the UI can say so instead of pretending the
 * fallback is a real answer.
 */
async function tryGenerate(task, options, fallback) {
  // A per-user key counts as "available" even when the server key is missing or
  // exhausted — the provider prefers it and falls back to the server key.
  const { apiKey, ...providerOptions } = options ?? {}
  if (!isAvailable(apiKey)) return { text: fallback, reason: 'unconfigured' }
  try {
    return { text: await provider().generate({ ...providerOptions, ...(apiKey ? { apiKey } : null) }), reason: null }
  } catch (err) {
    console.error(`[ai] ${task} failed:`, redact(err.message))
    return {
      text: fallback,
      reason: err.code === 'AI_RATE_LIMITED' ? 'rate_limited' : 'unavailable',
      message: err.code === 'AI_RATE_LIMITED' ? err.message : undefined,
    }
  }
}

// ── Embeddings ──────────────────────────────────────────────────────────────

/**
 * Embeds texts. Returns one vector (or null) per input, preserving order.
 * Callers must handle nulls — embeddings.js layers caching and a local fallback
 * encoder on top of this.
 */
export async function embed(texts, options = {}) {
  const inputs = Array.isArray(texts) ? texts : [texts]
  if (!isAvailable(options.apiKey) || inputs.length === 0) return inputs.map(() => null)
  try {
    return await provider().embed(inputs, options)
  } catch (err) {
    console.error('[ai] embed failed:', redact(err.message))
    return inputs.map(() => null)
  }
}

// ── Career tasks ────────────────────────────────────────────────────────────

const ENTITY_SCHEMA = {
  type: 'object',
  properties: {
    companies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string' },
          skills_required: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
        },
      },
    },
    skills: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          category: { type: 'string' },
          relevance: { type: 'string' },
        },
      },
    },
    hackathons: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          platform: { type: 'string' },
          skills_relevant: { type: 'array', items: { type: 'string' } },
          deadline: { type: 'string' },
          prize: { type: 'string' },
        },
      },
    },
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          skill: { type: 'string' },
          why: { type: 'string' },
          urgency: { type: 'string' },
        },
      },
    },
    summary: { type: 'string' },
  },
  required: ['summary'],
}

const EMPTY_ENTITIES = { companies: [], skills: [], hackathons: [], gaps: [], summary: '' }

/** Step 1 of ingest: pull career entities out of raw job/careers-page content. */
export async function extractEntities(content, userStack = [], { apiKey } = {}) {
  const baseOptions = {
    system: 'You extract structured career intelligence for Indian software developers. '
      + 'Only report entities that genuinely appear in the source. Never invent companies, '
      + 'salaries, or deadlines. Respond with JSON only.',
    prompt: `Developer's current stack: ${userStack.length ? userStack.join(', ') : 'unknown'}

Source content:
---
${content.slice(0, 6000)}
---

Extract the companies, skills, hackathons and skill gaps this content implies for
this developer. "gaps" are skills the content requires that are missing from the
developer's stack. Write a one-sentence summary of what this content is.

Respond as JSON: {"companies": [{"name": "...", "type": "...", "skills_required": ["..."], "notes": "..."}], "skills": [{"name": "...", "category": "...", "relevance": "..."}], "hackathons": [{"name": "...", "platform": "...", "skills_relevant": ["..."], "deadline": "...", "prize": "..."}], "gaps": [{"skill": "...", "why": "...", "urgency": "..."}], "summary": "..."}`,
    json: true,
    maxOutputTokens: 1600,
    // Structured extraction is slow on some models — allow extra headroom
    // beyond the default AI_TIMEOUT_MS so it doesn't fail on large inputs.
    timeoutMs: 90000,
  }

  // First try: strict responseSchema. Some providers/models reject nested
  // schemas — retry once without it rather than silently returning nothing.
  let { text } = await tryGenerate('extractEntities', { ...baseOptions, schema: ENTITY_SCHEMA, ...(apiKey ? { apiKey } : null) }, null)
  let parsed = parseJson(text, null)
  if (!parsed) {
    const retry = await tryGenerate('extractEntities:plain-json', { ...baseOptions, ...(apiKey ? { apiKey } : null) }, null)
    parsed = parseJson(retry.text, null)
  }

  if (!parsed) return { ...EMPTY_ENTITIES }
  return {
    companies: Array.isArray(parsed.companies) ? parsed.companies : [],
    skills: Array.isArray(parsed.skills) ? parsed.skills : [],
    hackathons: Array.isArray(parsed.hackathons) ? parsed.hackathons : [],
    gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [],
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
  }
}

/** Step 2 of ingest: render one entity as a markdown wiki page with wikilinks. */
export async function generateWikiPage(entityType, entity, userStack = [], sourceContent = '', { apiKey } = {}) {
  const today = new Date().toISOString().slice(0, 10)
  const title = entity.name ?? entity.skill ?? 'Unknown'

  const { text: markdown } = await tryGenerate('generateWikiPage', {
    system: 'You write concise career wiki pages in markdown with YAML frontmatter. '
      + 'Cross-reference related pages using [[type/name]] wikilinks, where type is one of '
      + 'company, skill, hackathon or gap and name is a lowercase hyphenated slug. '
      + 'Output markdown only — no code fences, no commentary.',
    prompt: `Write the wiki page.
Type: ${entityType}
Entity: ${JSON.stringify(entity).slice(0, 1200)}
Developer's stack: ${userStack.join(', ') || 'unknown'}
Source excerpt: ${sourceContent.slice(0, 600)}

Required structure:
---
type: ${entityType}
name: ${title}
tags: []
updated: ${today}
---

# ${title}

## Overview
Two or three sentences on why this matters for this specific developer.

## Key Details
- concrete detail drawn from the source
- concrete detail drawn from the source

## Career Relevance
Explain the connection, using [[skill/typescript]] style wikilinks to related pages.

## Action Items
- [ ] one specific, achievable next step`,
    maxOutputTokens: 900,
    temperature: 0.4,
    ...(apiKey ? { apiKey } : null),
  }, null)

  if (markdown?.trim()) return markdown.trim()

  // Deterministic fallback so a page always exists and stays linkable.
  const details = Object.entries(entity)
    .filter(([key, value]) => key !== 'name' && key !== 'skill' && value != null && String(value).length)
    .slice(0, 4)
    .map(([key, value]) => `- ${key.replace(/_/g, ' ')}: ${Array.isArray(value) ? value.join(', ') : value}`)
    .join('\n')

  return `---
type: ${entityType}
name: ${title}
tags: []
updated: ${today}
---

# ${title}

## Overview
Captured from your ingested content. AI enrichment was unavailable, so this page holds the raw extracted facts.

## Key Details
${details || '- No additional detail was extracted.'}

## Action Items
- [ ] Review this page and add your own notes`
}

/**
 * Grounded question answering. `context` is the already-retrieved, already-ranked
 * and already-budgeted memory context — this function never sees the full wiki.
 */
export async function answerFromContext({ question, context, userStack = [], recentTurns = [], apiKey }) {
  const fallback = {
    answer: context
      ? 'I found related notes in your wiki but could not reach the AI provider to summarise them. Try again shortly.'
      : 'Your career memory is empty. Ingest a job posting or URL first, then ask again.',
    cited_keys: [],
  }

  if (!context) return { ...fallback, degraded: 'no_context' }

  const history = recentTurns.length
    ? `\nRecent conversation (for pronoun resolution only, not a source of facts):\n${
      recentTurns.map(turn => `${turn.role}: ${turn.content.slice(0, 300)}`).join('\n')}\n`
    : ''

  const { text, reason, message } = await tryGenerate('answerFromContext', {
    system: 'You are Grafted, a career assistant for an Indian software developer. '
      + `Their stack is: ${userStack.join(', ') || 'not yet recorded'}. `
      + 'Answer ONLY from the numbered memory entries provided. If they do not contain the '
      + 'answer, say so plainly and suggest what the developer should ingest next. '
      + 'Cite the entries you used by their exact key in a cited_keys array. '
      + 'Be specific and actionable. Respond with JSON only.',
    prompt: `${history}
Memory entries:
${context}

Question: ${question}

Respond as JSON: {"answer": "...", "cited_keys": ["<key>", ...]}`,
    json: true,
    schema: {
      type: 'object',
      properties: {
        answer: { type: 'string' },
        cited_keys: { type: 'array', items: { type: 'string' } },
      },
      required: ['answer'],
    },
    maxOutputTokens: 900,
    ...(apiKey ? { apiKey } : null),
  }, null)

  const parsed = parseJson(text, null)
  if (!parsed?.answer) {
    return {
      ...fallback,
      // A quota message is worth showing verbatim: it tells the user whether waiting
      // a minute helps or whether the key is spent for the day.
      answer: reason === 'rate_limited' && message ? message : fallback.answer,
      degraded: reason ?? 'unavailable',
    }
  }
  return {
    answer: String(parsed.answer),
    cited_keys: Array.isArray(parsed.cited_keys) ? parsed.cited_keys.map(String) : [],
    degraded: null,
  }
}

/** Generates a four-week learning roadmap grounded in the user's gaps and memory. */
export async function generateRoadmap({ userStack = [], gapSkills = [], goals = [], context = '', apiKey }) {
  const primaryGap = gapSkills[0]?.skill ?? gapSkills[0]?.name ?? 'your strongest skill'

  const fallback = {
    weeks: [
      {
        week: 1,
        theme: 'Foundation',
        focus_skill: primaryGap,
        tasks: [
          `Audit where ${primaryGap} appears in your target companies' job posts`,
          'Block two focused hours per day for study',
          'Write down what "done" looks like for week 4',
        ],
        resources: [],
        milestone: 'A written four-week plan with a measurable end state',
      },
      {
        week: 2,
        theme: 'Skill building',
        focus_skill: primaryGap,
        tasks: [`Work through a structured ${primaryGap} tutorial end to end`, 'Commit code daily', 'Take notes into your Grafted wiki'],
        resources: [],
        milestone: `A small project that genuinely uses ${primaryGap}`,
      },
      {
        week: 3,
        theme: 'Application',
        focus_skill: primaryGap,
        tasks: ['Extend the project with tests', 'Write a short README explaining your design choices', 'Ingest two more job descriptions'],
        resources: [],
        milestone: 'A portfolio-ready repository',
      },
      {
        week: 4,
        theme: 'Proof',
        focus_skill: primaryGap,
        tasks: ['Ship the project publicly', 'Prepare answers for the interview topics your targets list', 'Apply to three matched companies'],
        resources: [],
        milestone: 'Applications sent with a project to point at',
      },
    ],
    summary: `Close your highest-impact gap (${primaryGap}) with one project you can show, then apply.`,
  }

  const { text, reason } = await tryGenerate('generateRoadmap', {
    system: 'You are a pragmatic career coach for Indian developers. Produce specific, '
      + 'checkable tasks — never generic advice. Prefer free, well-known resources and only '
      + 'use URLs you are confident exist. Respond with JSON only.',
    prompt: `Developer stack: ${userStack.join(', ') || 'unknown'}
Goals: ${goals.length ? goals.join(', ') : 'get hired at a funded startup'}
Priority gaps: ${gapSkills.slice(0, 6).map(gap => `${gap.skill ?? gap.name}${gap.why ? ` (${gap.why})` : ''}`).join('; ') || 'none recorded'}

Relevant memory:
${context.slice(0, 2500) || '(no memory yet)'}

Produce exactly 4 weeks as JSON:
{"weeks":[{"week":1,"theme":"","focus_skill":"","tasks":["..."],"resources":[{"title":"","url":"https://...","type":"course|docs|project|article"}],"milestone":""}],"summary":""}`,
    json: true,
    maxOutputTokens: 1800,
    ...(apiKey ? { apiKey } : null),
  }, null)

  const parsed = parseJson(text, null)
  if (!Array.isArray(parsed?.weeks) || parsed.weeks.length === 0) {
    // The fallback is a real, usable four-week plan built from the user's own top
    // gap — worth returning rather than failing the request.
    return { ...fallback, degraded: reason ?? 'unavailable' }
  }
  return {
    weeks: parsed.weeks.slice(0, 8),
    summary: typeof parsed.summary === 'string' ? parsed.summary : fallback.summary,
    degraded: null,
  }
}

/**
 * Durable-memory extraction: decides which facts from a conversation are worth
 * remembering permanently. Deliberately conservative — most chat is disposable.
 */
export async function extractDurableMemories({ question, answer, userStack = [], apiKey }) {
  const { text } = await tryGenerate('extractDurableMemories', {
    system: 'You decide what is worth remembering about a developer long-term. '
      + 'Extract ONLY durable facts the developer stated about themselves: goals, '
      + 'preferences, constraints, companies they are targeting, skills they claim or '
      + 'want. Ignore small talk, questions, and anything the assistant said. '
      + 'Return an empty array when nothing durable was stated. Respond with JSON only.',
    prompt: `Known stack: ${userStack.join(', ') || 'unknown'}

Developer said: ${question.slice(0, 1200)}
Assistant replied: ${answer.slice(0, 600)}

JSON: {"memories":[{"type":"GOAL|PREFERENCE|TARGET_COMPANY|SKILL|SKILL_GAP","content":"one factual sentence in third person","importance":0.0-1.0,"confidence":0.0-1.0}]}`,
    json: true,
    schema: {
      type: 'object',
      properties: {
        memories: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              content: { type: 'string' },
              importance: { type: 'number' },
              confidence: { type: 'number' },
            },
            required: ['type', 'content'],
          },
        },
      },
      required: ['memories'],
    },
    maxOutputTokens: 600,
    temperature: 0.1,
    ...(apiKey ? { apiKey } : null),
  }, null)

  const parsed = parseJson(text, null)
  return Array.isArray(parsed?.memories) ? parsed.memories : []
}

/** Compresses text when it would otherwise blow the context budget. */
export async function summarize(text, { maxWords = 90, apiKey } = {}) {
  if (!text || text.length < 400) return text ?? ''
  const { text: result } = await tryGenerate('summarize', {
    system: 'You compress career notes. Preserve concrete facts — company names, skills, '
      + 'numbers, dates. Drop filler. Output plain prose only.',
    prompt: `Summarise in at most ${maxWords} words:\n\n${text.slice(0, 6000)}`,
    maxOutputTokens: 300,
    temperature: 0.2,
    ...(apiKey ? { apiKey } : null),
  }, null)
  return result?.trim() || text.slice(0, maxWords * 8)
}

export default {
  isAvailable, describe, parseJson, embed,
  extractEntities, generateWikiPage, answerFromContext,
  generateRoadmap, extractDurableMemories, summarize,
}
