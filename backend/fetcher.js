/**
 * Ingest input handling: classify what the user pasted, and turn it into clean text.
 *
 * All network access goes through lib/safeFetch.js, which enforces the SSRF controls
 * (scheme allowlist, private-range blocking, re-validated redirects, real timeout,
 * response size cap). This module only deals with content shaping.
 */

import TurndownService from 'turndown'
import config from './config.js'
import { safeFetchText } from './lib/safeFetch.js'
import { unprocessable } from './lib/errors.js'

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
// Anything left in these would survive as noise in the markdown.
turndown.remove(['script', 'style', 'noscript', 'iframe', 'svg', 'form'])

/** Classifies raw ingest input as a URL, an image, or plain text. */
export function detectInputType(input) {
  const trimmed = String(input ?? '').trim()
  if (trimmed.startsWith('data:image/')) return 'screenshot'
  if (/^https?:\/\/\S+\.(png|jpe?g|gif|webp|avif)(\?|#|$)/i.test(trimmed)) return 'screenshot'
  if (/^https?:\/\//i.test(trimmed)) return 'url'
  return 'text'
}

/** Removes structural chrome that carries no career signal before conversion. */
function stripChrome(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
}

/**
 * Fetches a URL safely and returns it as markdown.
 * Throws ApiError(422) with an actionable message when the page cannot be used.
 */
export async function fetchURL(url) {
  const { body, finalUrl } = await safeFetchText(url)

  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(body)
  const markdown = looksLikeHtml ? turndown.turndown(stripChrome(body)) : body

  const compressed = markdown.replace(/\n{3,}/g, '\n\n').trim()

  // Single-page apps return a shell with no readable content. Say so plainly rather
  // than sending an empty document to the model.
  if (compressed.replace(/\s+/g, '').length < 300) {
    throw unprocessable(
      'That page is mostly JavaScript-rendered, so there was nothing to read. Copy the job description text and paste it instead.',
      'EMPTY_PAGE',
    )
  }

  return { content: compressed.slice(0, config.ingest.maxInputChars), finalUrl }
}

/** Normalises pasted text: collapse runaway whitespace, bound the length. */
export function extractText(input) {
  return String(input ?? '')
    .trim()
    .replace(/[ \t]{3,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, config.ingest.maxInputChars)
}

export default { detectInputType, fetchURL, extractText }
