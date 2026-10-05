/** Typed application error carrying an HTTP status and a stable machine code. */
export class ApiError extends Error {
  constructor(statusCode, message, code = 'API_ERROR', details) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.code = code
    if (details !== undefined) this.details = details
  }
}

export const badRequest = (message, code = 'VALIDATION_ERROR') => new ApiError(400, message, code)
export const unauthorized = (message, code = 'UNAUTHORIZED') => new ApiError(401, message, code)
export const forbidden = (message, code = 'FORBIDDEN') => new ApiError(403, message, code)
export const conflict = (message, code = 'CONFLICT') => new ApiError(409, message, code)
export const notFound = (message, code = 'NOT_FOUND') => new ApiError(404, message, code)
export const unprocessable = (message, code = 'UNPROCESSABLE') => new ApiError(422, message, code)
export const upstream = (message, code = 'UPSTREAM_ERROR') => new ApiError(502, message, code)

/**
 * A quota/throttle refusal the user can act on by waiting.
 *
 * Deliberately 429 rather than 502: the error middleware suppresses every 5xx
 * message (they can leak connection strings and upstream payloads), so a rate
 * limit raised as `upstream()` reached the user as "Internal server error" —
 * unactionable, and indistinguishable from a genuine crash. At 4xx the message
 * survives, which is the whole point of raising it.
 */
export const rateLimited = (message, code = 'RATE_LIMITED') => new ApiError(429, message, code)

/** Wraps an async Express handler so a rejected promise reaches the error middleware. */
export function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

/**
 * Strips anything secret-shaped from a value before it reaches a log sink.
 * Applied to every error we log, because upstream SDKs happily embed keys in URLs.
 */
export function redact(value) {
  if (value == null) return value
  const text = typeof value === 'string' ? value : String(value)
  return text
    .replace(/(key=)[^&\s"']+/gi, '$1[redacted]')
    .replace(/(bearer\s+)[A-Za-z0-9._-]+/gi, '$1[redacted]')
    .replace(/(AIza)[0-9A-Za-z_-]{10,}/g, '$1[redacted]')
    .replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+@/gi, '$1[redacted]@')
    .replace(/(redis:\/\/[^:]+:)[^@]+@/gi, '$1[redacted]@')
}
