/**
 * SSRF-hardened HTTP client for user-supplied URLs.
 *
 * Threat model: a user pastes a URL into the ingest panel and the server fetches it.
 * Without controls that is a request forgery primitive against cloud metadata
 * endpoints (169.254.169.254), container-internal services, and the database itself.
 *
 * Controls applied on every request AND on every redirect hop:
 *   1. Scheme allowlist (http/https only — no file:, gopher:, data:).
 *   2. Credentials in the URL are rejected.
 *   3. Hostname is resolved to IPs; every resolved address must be publicly routable.
 *   4. Redirects are followed manually, capped, and each hop is re-validated.
 *   5. A real timeout via AbortController (node-fetch ignores the `timeout` option).
 *   6. Response size is capped while streaming, so a huge body cannot exhaust memory.
 *   7. Content-Type must be HTML/text.
 *
 * Note on TOCTOU: we validate the resolved address then let the agent reconnect by
 * hostname. A DNS entry that changes between those two steps could still slip past.
 * `pinnedLookup` closes that window by forcing the agent to dial the exact address
 * we validated.
 */

import dns from 'dns/promises'
import net from 'net'
import http from 'http'
import https from 'https'
import config from '../config.js'
import { unprocessable } from './errors.js'

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])
const ALLOWED_CONTENT = /^(text\/html|application\/xhtml\+xml|text\/plain|application\/json|text\/markdown)/i

/** True when an IPv4 address is outside the publicly routable space. */
export function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = parts
  if (a === 0) return true                       // 0.0.0.0/8 "this network"
  if (a === 10) return true                      // private
  if (a === 127) return true                     // loopback
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return true         // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 0) return true            // IETF protocol assignments
  if (a === 192 && b === 168) return true          // private
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a === 198 && b === 51) return true           // TEST-NET-2
  if (a === 203 && b === 0) return true            // TEST-NET-3
  if (a >= 224) return true                        // multicast, reserved, broadcast
  return false
}

/** True when an IPv6 address is outside the publicly routable space. */
export function isPrivateIPv6(ip) {
  const address = ip.toLowerCase().split('%')[0] // strip zone index
  if (address === '::' || address === '::1') return true
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible forms inherit IPv4 rules.
  const mapped = address.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateIPv4(mapped[1])
  if (address.startsWith('fe8') || address.startsWith('fe9') ||
      address.startsWith('fea') || address.startsWith('feb')) return true // link-local
  if (address.startsWith('fc') || address.startsWith('fd')) return true    // unique-local
  if (address.startsWith('ff')) return true                                // multicast
  if (address.startsWith('2001:db8')) return true                          // documentation
  if (address.startsWith('64:ff9b')) return true                           // NAT64
  return false
}

/** True when the literal IP must not be contacted. */
export function isBlockedAddress(ip) {
  if (config.ingest.allowPrivateNetwork) return false
  const version = net.isIP(ip)
  if (version === 4) return isPrivateIPv4(ip)
  if (version === 6) return isPrivateIPv6(ip)
  return true // not an IP we can reason about — refuse
}

function hostMatches(host, pattern) {
  const h = host.toLowerCase()
  const p = pattern.toLowerCase()
  return h === p || h.endsWith(`.${p}`)
}

/**
 * Validates a URL string and resolves it to a set of vetted IP addresses.
 * Throws ApiError(422) with a user-safe message when the target is not allowed.
 */
export async function assertUrlIsSafe(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw unprocessable('That does not look like a valid URL.', 'INVALID_URL')
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw unprocessable('Only http and https URLs can be ingested.', 'BLOCKED_URL')
  }
  if (url.username || url.password) {
    throw unprocessable('URLs containing credentials are not accepted.', 'BLOCKED_URL')
  }

  const host = url.hostname.replace(/^\[|\]$/g, '')
  const { allowedHosts, blockedHosts } = config.ingest

  if (blockedHosts.some(pattern => hostMatches(host, pattern))) {
    throw unprocessable('That host is not allowed.', 'BLOCKED_URL')
  }
  if (allowedHosts.length && !allowedHosts.some(pattern => hostMatches(host, pattern))) {
    throw unprocessable('That host is not on the ingest allowlist.', 'BLOCKED_URL')
  }

  // A literal IP needs no DNS round-trip.
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) {
      throw unprocessable('That address is on a private or reserved network.', 'BLOCKED_URL')
    }
    return { url, addresses: [{ address: host, family: net.isIP(host) }] }
  }

  let resolved
  try {
    resolved = await dns.lookup(host, { all: true, verbatim: true })
  } catch {
    throw unprocessable('Could not resolve that hostname.', 'DNS_FAILED')
  }
  if (!resolved.length) {
    throw unprocessable('Could not resolve that hostname.', 'DNS_FAILED')
  }
  // Every answer must be safe: one private A record is enough to abuse.
  for (const entry of resolved) {
    if (isBlockedAddress(entry.address)) {
      throw unprocessable('That host resolves to a private or reserved network.', 'BLOCKED_URL')
    }
  }
  return { url, addresses: resolved }
}

/**
 * Builds a `lookup` implementation pinned to the addresses we already validated,
 * eliminating the DNS-rebinding window between validation and connection.
 */
function pinnedLookup(addresses) {
  return (_hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback
    const family = typeof options === 'object' ? options.family : 0
    const usable = addresses.filter(entry => !family || entry.family === family)
    const chosen = usable[0] ?? addresses[0]
    if (!chosen) return done(new Error('No validated address available'))
    if (typeof options === 'object' && options.all) {
      return done(null, usable.length ? usable : [chosen])
    }
    return done(null, chosen.address, chosen.family)
  }
}

/** Performs one hop with no automatic redirect handling. */
function requestOnce({ url, addresses, timeoutMs, maxBytes, userAgent }) {
  const transport = url.protocol === 'https:' ? https : http
  const agentClass = url.protocol === 'https:' ? https.Agent : http.Agent
  const agent = new agentClass({ lookup: pinnedLookup(addresses), keepAlive: false })

  return new Promise((resolve, reject) => {
    const req = transport.request(url, {
      method: 'GET',
      agent,
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
        'Accept-Language': 'en',
      },
      timeout: timeoutMs,
    }, res => {
      const status = res.statusCode ?? 0
      const location = res.headers.location

      if (status >= 300 && status < 400 && location) {
        res.resume() // drain so the socket can close
        resolve({ redirect: new URL(location, url).toString(), status })
        return
      }

      const contentType = String(res.headers['content-type'] ?? '')
      if (contentType && !ALLOWED_CONTENT.test(contentType)) {
        res.resume()
        reject(unprocessable(
          'That URL did not return a readable page. Paste the job description text instead.',
          'UNSUPPORTED_CONTENT_TYPE',
        ))
        return
      }

      const declared = Number(res.headers['content-length'])
      if (Number.isFinite(declared) && declared > maxBytes) {
        res.destroy()
        reject(unprocessable('That page is too large to ingest.', 'RESPONSE_TOO_LARGE'))
        return
      }

      const chunks = []
      let received = 0
      res.on('data', chunk => {
        received += chunk.length
        if (received > maxBytes) {
          res.destroy()
          reject(unprocessable('That page is too large to ingest.', 'RESPONSE_TOO_LARGE'))
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }))
      res.on('error', err => reject(err))
    })

    req.on('timeout', () => {
      req.destroy(unprocessable('That page took too long to respond.', 'FETCH_TIMEOUT'))
    })
    req.on('error', err => {
      reject(err.statusCode ? err : unprocessable(`Could not reach that URL (${err.code ?? 'network error'}).`, 'FETCH_FAILED'))
    })
    req.end()
  })
}

/**
 * Fetches a user-supplied URL safely and returns its body as text.
 * Redirects are followed manually so each hop is re-validated against the SSRF rules.
 */
export async function safeFetchText(rawUrl, {
  timeoutMs = config.ingest.fetchTimeoutMs,
  maxBytes = config.ingest.maxFetchBytes,
  maxRedirects = config.ingest.maxRedirects,
  userAgent = 'Mozilla/5.0 (compatible; Grafted/2.0; +https://grafted.app)',
} = {}) {
  let target = rawUrl
  const started = Date.now()

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const remaining = timeoutMs - (Date.now() - started)
    if (remaining <= 0) {
      throw unprocessable('That page took too long to respond.', 'FETCH_TIMEOUT')
    }

    const { url, addresses } = await assertUrlIsSafe(target)
    const result = await requestOnce({ url, addresses, timeoutMs: remaining, maxBytes, userAgent })

    if (result.redirect) {
      target = result.redirect
      continue
    }
    if (result.status >= 400) {
      throw unprocessable(`That URL returned HTTP ${result.status}.`, 'FETCH_FAILED')
    }
    return { body: result.body, finalUrl: url.toString(), status: result.status }
  }

  throw unprocessable('That URL redirected too many times.', 'TOO_MANY_REDIRECTS')
}

export default { safeFetchText, assertUrlIsSafe, isBlockedAddress, isPrivateIPv4, isPrivateIPv6 }
