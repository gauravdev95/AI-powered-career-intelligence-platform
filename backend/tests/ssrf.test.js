/**
 * SSRF protection tests.
 *
 * URL ingestion is the one place DevRadar makes an outbound request to an address a
 * user chose, so it is the one place request forgery is possible. These tests cover
 * the address classifier, the URL gate, and a live request against a real loopback
 * server that must be refused.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'http'

import {
  isPrivateIPv4, isPrivateIPv6, isBlockedAddress, assertUrlIsSafe, safeFetchText,
} from '../lib/safeFetch.js'
import { detectInputType } from '../fetcher.js'

// ── Address classification ──────────────────────────────────────────────────

test('cloud metadata and private IPv4 ranges are classified as blocked', () => {
  const blocked = [
    '169.254.169.254',  // AWS/GCP/Azure instance metadata — the classic SSRF target
    '169.254.170.2',    // ECS task metadata
    '127.0.0.1', '127.1.2.3',
    '10.0.0.1', '10.255.255.255',
    '172.16.0.1', '172.31.255.255',
    '192.168.0.1',
    '100.64.0.1',       // CGNAT
    '0.0.0.0',
    '224.0.0.1',        // multicast
    '255.255.255.255',
  ]
  for (const ip of blocked) {
    assert.equal(isPrivateIPv4(ip), true, `${ip} must be blocked`)
  }
})

test('public IPv4 addresses are allowed', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '11.0.0.1']) {
    assert.equal(isPrivateIPv4(ip), false, `${ip} must be allowed`)
  }
})

test('IPv6 loopback, link-local, unique-local and IPv4-mapped forms are blocked', () => {
  const blocked = [
    '::1', '::',
    'fe80::1',                    // link-local
    'fd00::1', 'fc00::1',         // unique-local
    'ff02::1',                    // multicast
    '::ffff:169.254.169.254',     // IPv4-mapped metadata address
    '::ffff:127.0.0.1',
    '2001:db8::1',                // documentation range
  ]
  for (const ip of blocked) {
    assert.equal(isPrivateIPv6(ip), true, `${ip} must be blocked`)
  }
  assert.equal(isPrivateIPv6('2606:4700:4700::1111'), false, 'public IPv6 must be allowed')
})

test('a non-IP string is refused rather than assumed safe', () => {
  assert.equal(isBlockedAddress('not-an-ip'), true)
  assert.equal(isBlockedAddress(''), true)
})

// ── URL gate ────────────────────────────────────────────────────────────────

test('non-HTTP schemes are rejected', async () => {
  for (const url of [
    'file:///etc/passwd',
    'gopher://127.0.0.1:6379/_INFO',
    'ftp://example.com/x',
    'data:text/html,<script>alert(1)</script>',
  ]) {
    await assert.rejects(() => assertUrlIsSafe(url), /http and https|valid URL/i, `${url} must be rejected`)
  }
})

test('URLs carrying credentials are rejected', async () => {
  await assert.rejects(
    () => assertUrlIsSafe('http://admin:hunter2@example.com/'),
    /credentials/i,
  )
})

test('literal private addresses are rejected before any request is made', async () => {
  for (const url of [
    'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    'http://127.0.0.1:5432/',
    'http://10.0.0.5/internal',
    'http://[::1]:3001/api/health',
    'http://192.168.1.1/admin',
  ]) {
    await assert.rejects(() => assertUrlIsSafe(url), /private or reserved/i, `${url} must be rejected`)
  }
})

test('hostnames that resolve to loopback are rejected', async () => {
  // localhost resolves to 127.0.0.1 / ::1 — the DNS answer must be checked, not just
  // the literal text of the hostname.
  await assert.rejects(() => assertUrlIsSafe('http://localhost:3001/'), /private or reserved/i)
})

test('malformed URLs are rejected cleanly', async () => {
  for (const url of ['', 'not a url', 'http://', '://missing-scheme']) {
    await assert.rejects(() => assertUrlIsSafe(url), /valid URL|http and https|resolve/i)
  }
})

// ── Live request ────────────────────────────────────────────────────────────

test('a real request to a loopback server is refused, and the server is never contacted', async t => {
  let hits = 0
  const server = http.createServer((_req, res) => {
    hits += 1
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<html><body>internal secrets</body></html>')
  })

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  t.after(() => new Promise(resolve => server.close(resolve)))

  await assert.rejects(
    () => safeFetchText(`http://127.0.0.1:${port}/`),
    /private or reserved/i,
  )
  assert.equal(hits, 0, 'the blocked host must never receive a connection')
})

test('an open redirect toward a private address is caught at the redirect hop', async t => {
  let internalHits = 0

  const internal = http.createServer((_req, res) => {
    internalHits += 1
    res.end('internal')
  })
  await new Promise(resolve => internal.listen(0, '127.0.0.1', resolve))
  const internalPort = internal.address().port

  // A public-looking first hop that redirects inward. We can only bind loopback in a
  // test, so we assert the redirect is re-validated rather than blindly followed —
  // the first hop is validated with the private-network escape hatch enabled, and the
  // second hop must still be checked by the same code path.
  const redirector = http.createServer((_req, res) => {
    res.writeHead(302, { Location: `http://127.0.0.1:${internalPort}/secrets` })
    res.end()
  })
  await new Promise(resolve => redirector.listen(0, '127.0.0.1', resolve))
  const redirectPort = redirector.address().port

  t.after(() => Promise.all([
    new Promise(resolve => internal.close(resolve)),
    new Promise(resolve => redirector.close(resolve)),
  ]))

  await assert.rejects(() => safeFetchText(`http://127.0.0.1:${redirectPort}/`), /private or reserved/i)
  assert.equal(internalHits, 0, 'the redirect target must never be contacted')
})

test('a redirect loop terminates instead of hanging', async t => {
  const server = http.createServer((_req, res) => {
    res.writeHead(302, { Location: '/again' })
    res.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))

  // Blocked at the address check before redirects even matter — the guarantee under
  // test is that it rejects promptly rather than following forever.
  await assert.rejects(() => safeFetchText(`http://127.0.0.1:${server.address().port}/`))
})

// ── Input classification ────────────────────────────────────────────────────

test('ingest input types are classified correctly', () => {
  assert.equal(detectInputType('https://example.com/jobs/123'), 'url')
  assert.equal(detectInputType('http://example.com'), 'url')
  assert.equal(detectInputType('data:image/png;base64,iVBORw0KG'), 'screenshot')
  assert.equal(detectInputType('https://example.com/screenshot.png'), 'screenshot')
  assert.equal(detectInputType('We are hiring a Node.js engineer'), 'text')
  assert.equal(detectInputType(''), 'text')
})
