/**
 * ContextBuilder — assembles the prompt context from ranked memories.
 *
 * This is the module that enforces the rule "never send the whole wiki to the model".
 * It takes an ordered shortlist and fills a character budget, highest-value first,
 * stopping when the budget is spent. A user with 500 wiki pages and a user with 5
 * produce the same size prompt; only the contents differ.
 *
 * Each entry is emitted with a stable `[key]` label. Those keys are the vocabulary
 * the model must cite from, and the same keys are used to resolve citations back to
 * real stored memories afterwards — so a fabricated citation cannot survive.
 */

import config from '../config.js'
import { MEMORY_TYPES } from './types.js'

/** Human-readable label for a memory, and the token the model cites. */
export function memoryKey(memory) {
  if (memory.type === MEMORY_TYPES.WIKI_CHUNK) {
    const pageKey = memory.data?.pageKey ?? memory.key ?? 'wiki'
    return `${pageKey}#${memory.data?.chunkIndex ?? 0}`
  }
  if (memory.dedupKey) return memory.dedupKey
  return `${memory.type.toLowerCase()}:${String(memory.id).slice(0, 8)}`
}

/** Trims a memory's text to fit, cutting at a sentence boundary where possible. */
function fit(text, maxChars) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (clean.length <= maxChars) return clean
  const truncated = clean.slice(0, maxChars)
  const lastStop = Math.max(truncated.lastIndexOf('. '), truncated.lastIndexOf('! '), truncated.lastIndexOf('? '))
  return lastStop > maxChars * 0.6 ? truncated.slice(0, lastStop + 1) : `${truncated.trimEnd()}…`
}

/**
 * Builds the context block.
 *
 * Returns the rendered text, the entries actually included (so the caller can record
 * accesses and resolve citations), and budget diagnostics.
 */
export function build(memories, {
  charBudget = config.memory.contextCharBudget,
  maxEntries = config.memory.retrievalTopK,
  perEntryChars = 700,
  header = 'Memory entries (each line is a fact from this developer\'s own career memory):',
} = {}) {
  const included = []
  const lines = []
  let used = 0

  for (const memory of memories) {
    if (included.length >= maxEntries) break

    const key = memoryKey(memory)
    const body = fit(memory.content, perEntryChars)
    // Type and key give the model the provenance it needs to cite accurately.
    const line = `[${key}] (${memory.type.toLowerCase()}) ${body}`

    if (used + line.length > charBudget) {
      // A single oversized entry should not end the loop — a later, smaller one may fit.
      if (line.length > charBudget * 0.5) continue
      break
    }

    lines.push(line)
    included.push({ ...memory, contextKey: key })
    used += line.length + 1
  }

  return {
    text: lines.length ? `${header}\n${lines.join('\n')}` : '',
    entries: included,
    stats: {
      charsUsed: used,
      charBudget,
      entriesIncluded: included.length,
      entriesConsidered: memories.length,
    },
  }
}

/**
 * Resolves the model's claimed citations against what was actually in the context.
 *
 * Anything the model cites that was not supplied is dropped. This is the last line of
 * defence against a plausible-looking hallucinated source, and it is why citations in
 * the UI can be trusted to point at real stored content.
 */
export function resolveCitations(citedKeys, entries) {
  const byKey = new Map(entries.map(entry => [entry.contextKey, entry]))
  const seen = new Set()
  const citations = []

  for (const rawKey of citedKeys ?? []) {
    const key = String(rawKey).trim().replace(/^\[|\]$/g, '')
    const entry = byKey.get(key)
    if (!entry || seen.has(key)) continue
    seen.add(key)

    citations.push({
      key,
      // pageName keeps the existing ChatInterface citation chip rendering intact.
      pageName: entry.title || entry.data?.pageName || key.split(/[:#]/)[1] || key,
      type: entry.type,
      excerpt: fit(entry.content, 220),
      memoryId: entry.isChunk ? (entry.data?.pageId ?? null) : entry.id,
    })
  }

  return citations
}

/**
 * Renders a compact profile preamble. Always included ahead of retrieved memories:
 * an answer that ignores who the developer is cannot be grounded, however well the
 * retrieved text matches the question.
 */
export function buildProfileBlock(coreMemories, { charBudget = 900 } = {}) {
  if (!coreMemories?.length) return ''
  const byType = new Map()
  for (const memory of coreMemories) {
    if (!byType.has(memory.type)) byType.set(memory.type, [])
    byType.get(memory.type).push(memory.content)
  }

  const sections = []
  let used = 0
  for (const [type, contents] of byType) {
    const line = `${type.toLowerCase()}: ${contents.slice(0, 5).join(' ')}`
    const fitted = fit(line, 300)
    if (used + fitted.length > charBudget) break
    sections.push(fitted)
    used += fitted.length
  }

  return sections.length ? `Developer profile:\n${sections.join('\n')}` : ''
}

export default { build, buildProfileBlock, resolveCitations, memoryKey }
