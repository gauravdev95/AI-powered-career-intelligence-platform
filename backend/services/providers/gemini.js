/**
 * Gemini provider — the concrete implementation behind aiService.
 *
 * Talks to the Generative Language REST API directly (no SDK) so the dependency
 * surface stays small and the request shape is explicit. The API key travels in the
 * `x-goog-api-key` header rather than the query string, so it cannot leak through
 * URL logging.
 *
 * The model id is never hard-coded — config.ai.model comes from GEMINI_MODEL.
 */

import config from '../../config.js'
import { rateLimited, redact, upstream } from '../../lib/errors.js'

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504])

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function endpoint(model, method) {
  const base = config.ai.baseUrl.replace(/\/+$/, '')
  const name = model.startsWith('models/') ? model : `models/${model}`
  return `${base}/${name}:${method}`
}

/**
 * Pulls the machine-readable parts out of a Google API error body.
 *
 * Two things matter here and both live in `error.details`, not in headers:
 *
 * - RetryInfo.retryDelay ("27s") is how long the provider wants us to wait. Gemini
 *   does not send a `Retry-After` header, so a client that only reads headers backs
 *   off on a fixed schedule that has nothing to do with when the quota frees up.
 * - QuotaFailure.violations[].quotaId distinguishes "you sent too many requests this
 *   minute" (wait and it works) from "your daily free-tier allowance is gone" (wait
 *   and it still fails). Operators cannot act on a 429 without knowing which.
 */
export function parseErrorDetails(rawBody) {
  try {
    const details = JSON.parse(rawBody)?.error?.details
    if (!Array.isArray(details)) return {}

    const retryInfo = details.find(entry => String(entry['@type'] ?? '').endsWith('RetryInfo'))
    const quotaFailure = details.find(entry => String(entry['@type'] ?? '').endsWith('QuotaFailure'))
    const seconds = Number(String(retryInfo?.retryDelay ?? '').replace(/s$/, ''))

    return {
      retryDelayMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null,
      quotas: (quotaFailure?.violations ?? [])
        .map(violation => violation.quotaId ?? violation.quotaMetric)
        .filter(Boolean),
    }
  } catch {
    return {}
  }
}

async function callGemini(url, body, { timeoutMs = config.ai.timeoutMs, maxRetries = config.ai.maxRetries } = {}) {
  if (!config.ai.apiKey) {
    throw upstream('AI provider is not configured (GEMINI_API_KEY missing).', 'AI_UNAVAILABLE')
  }

  let lastError = null

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': config.ai.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      // Network failure or timeout — retry if we have budget left.
      lastError = err.name === 'TimeoutError' || err.name === 'AbortError'
        ? upstream('The AI provider timed out.', 'AI_TIMEOUT')
        : upstream('Could not reach the AI provider.', 'AI_UNREACHABLE')
      if (attempt < maxRetries) {
        await sleep(2 ** attempt * 400)
        continue
      }
      throw lastError
    }

    if (response.ok) return response.json()

    const detail = await response.text().catch(() => '')
    const { retryDelayMs, quotas = [] } = parseErrorDetails(detail)

    if (RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
      // Prefer what the provider asked for: the header if it sent one, else the
      // retryDelay in the body, else exponential backoff. Capped so a request never
      // outlives the caller's patience — a long wait is the caller's decision, and
      // it can see AI_RATE_LIMITED and choose.
      const retryAfterHeader = Number(response.headers.get('retry-after'))
      const requested = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
        ? retryAfterHeader * 1000
        : retryDelayMs
      await sleep(requested ? Math.min(requested, 8000) : 2 ** attempt * 500)
      continue
    }

    // Never surface the provider's raw body: it can echo the request, which may
    // contain the user's pasted content. The quota ids are safe and are the only
    // part an operator can act on, so they are logged separately rather than being
    // lost inside the truncated body.
    console.error('[gemini] request failed', {
      status: response.status,
      quotas: quotas.length ? quotas : undefined,
      detail: redact(detail).slice(0, 300),
    })
    if (response.status === 429) {
      // 429, not 502 — see `rateLimited` in lib/errors.js. The user needs to read
      // this message, and 5xx bodies are stripped before they leave the server.
      // A per-day quota will not clear "in a moment", so do not claim it will.
      const exhaustedForToday = quotas.some(quota => /per_?day|daily/i.test(quota))
      throw rateLimited(
        exhaustedForToday
          ? 'The AI provider\'s daily quota for this key is used up. Grafted keeps working — matching, memory and search are unaffected — but generated answers resume tomorrow or on a higher plan.'
          : 'AI rate limit reached. Please try again in a moment.',
        'AI_RATE_LIMITED',
      )
    }
    if (response.status === 400) {
      throw upstream('The AI provider rejected the request.', 'AI_BAD_REQUEST')
    }
    if (response.status === 401 || response.status === 403) {
      throw upstream('AI provider authentication failed.', 'AI_UNAUTHORIZED')
    }
    throw upstream(`AI provider error (${response.status}).`, 'AI_ERROR')
  }

  throw lastError ?? upstream('AI provider error.', 'AI_ERROR')
}

/** Concatenates the text parts of the first candidate. */
function extractText(payload) {
  const candidate = payload?.candidates?.[0]
  if (!candidate) return ''
  if (candidate.finishReason === 'SAFETY') return ''
  return (candidate.content?.parts ?? [])
    .map(part => part.text ?? '')
    .join('')
    .trim()
}

export const name = 'gemini'

export function isAvailable() {
  return Boolean(config.ai.apiKey)
}

export function modelId() {
  return config.ai.model
}

/**
 * Free-form generation.
 * When `json` is true the model is put in JSON mode and, if a schema is supplied,
 * constrained to it — far more reliable than asking for JSON in the prompt.
 */
export async function generate({ system, prompt, json = false, schema, maxOutputTokens = 1200, temperature = config.ai.temperature, timeoutMs }) {
  const generationConfig = { temperature, maxOutputTokens }
  if (json) {
    generationConfig.responseMimeType = 'application/json'
    if (schema) generationConfig.responseSchema = schema
  }

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig,
  }
  if (system) body.systemInstruction = { parts: [{ text: system }] }

  const payload = await callGemini(endpoint(config.ai.model, 'generateContent'), body,
    timeoutMs ? { timeoutMs } : undefined)
  return extractText(payload)
}

/**
 * Embeds a batch of texts in one round-trip.
 * `taskType` materially affects quality: documents and queries are embedded into
 * the same space but with different optimisation targets.
 */
export async function embed(texts, { taskType = 'RETRIEVAL_DOCUMENT' } = {}) {
  const inputs = Array.isArray(texts) ? texts : [texts]
  if (inputs.length === 0) return []

  const model = config.ai.embeddingModel
  const modelName = model.startsWith('models/') ? model : `models/${model}`

  const body = {
    requests: inputs.map(text => ({
      model: modelName,
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: config.ai.embeddingDimensions,
    })),
  }

  const payload = await callGemini(endpoint(model, 'batchEmbedContents'), body)
  const embeddings = payload?.embeddings ?? []

  return inputs.map((_, index) => {
    const values = embeddings[index]?.values
    return Array.isArray(values) ? values : null
  })
}

export default { name, isAvailable, modelId, generate, embed }
