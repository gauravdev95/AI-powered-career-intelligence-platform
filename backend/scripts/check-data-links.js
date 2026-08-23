/**
 * Online link check for the curated datasets.
 *
 * Kept out of `npm test` on purpose: link rot is a real failure but a network-
 * dependent one, and a red test suite on a flaky connection teaches people to
 * ignore red test suites. Run it when you touch data/, and before a release.
 *
 *   npm run data:check
 *
 * Exits non-zero if any URL 4xx/5xxs or fails to resolve. Redirects are reported
 * but not failures — they usually mean a company moved its careers page, which is
 * worth knowing and worth fixing in the dataset, but the link still works.
 */

import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')

// Some corporate sites reject the default fetch agent outright.
const USER_AGENT = 'Mozilla/5.0 (compatible; GraftedLinkCheck/1.0; +https://github.com/)'
const TIMEOUT_MS = 20000
const CONCURRENCY = 6

const FILES = [
  ['startups.json', 'apply_url'],
  ['hackathons.json', 'registration_url'],
  ['skills.json', 'resource_url'],
]

async function check(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    })
    return { status: response.status, finalUrl: response.url }
  } catch (err) {
    return { status: 'ERR', finalUrl: err.message.slice(0, 80) }
  } finally {
    clearTimeout(timer)
  }
}

const targets = []
for (const [file, field] of FILES) {
  const rows = JSON.parse(await readFile(join(dataDir, file), 'utf8'))
  for (const row of rows) {
    if (row[field]) targets.push({ file, name: row.name, url: row[field] })
  }
}

const checked = []
for (let i = 0; i < targets.length; i += CONCURRENCY) {
  const batch = targets.slice(i, i + CONCURRENCY)
  const outcomes = await Promise.all(batch.map(target => check(target.url)))
  batch.forEach((target, index) => checked.push({ ...target, ...outcomes[index] }))
  process.stdout.write(`\rchecked ${Math.min(i + CONCURRENCY, targets.length)}/${targets.length}`)
}
process.stdout.write('\n\n')

const broken = checked.filter(row => row.status === 'ERR' || (typeof row.status === 'number' && row.status >= 400))
const moved = checked.filter(row =>
  typeof row.status === 'number' && row.status < 400
  && row.finalUrl && row.finalUrl.replace(/\/$/, '') !== row.url.replace(/\/$/, ''))

if (moved.length) {
  console.log(`${moved.length} link(s) redirect — consider updating the dataset to the destination:`)
  for (const row of moved) console.log(`  ${row.name}: ${row.url}\n    -> ${row.finalUrl}`)
  console.log('')
}

if (broken.length) {
  console.error(`${broken.length} broken link(s):`)
  for (const row of broken) console.error(`  [${row.file}] ${row.name}: ${row.url} (${row.status} ${row.finalUrl})`)
  process.exit(1)
}

console.log(`All ${checked.length} dataset links resolve.`)
