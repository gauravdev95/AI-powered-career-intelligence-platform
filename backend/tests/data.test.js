/**
 * Dataset integrity.
 *
 * The curated JSON under data/ is the one part of Grafted a user reads as fact:
 * deadlines they plan around, links they click, salary bands they negotiate against.
 * It also rots silently — an event passes, a company rebrands, a careers page moves —
 * and nothing in the app notices, because matching happily ranks stale rows.
 *
 * These tests pin the shape and the internal consistency. They deliberately do not
 * hit the network: link rot is a real failure but not a reason for `npm test` to go
 * red on a plane. See `npm run data:check` for the online link check.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

import * as matching from '../matching.js'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')
const load = name => readFile(join(dataDir, name), 'utf8').then(JSON.parse)

const startups = await load('startups.json')
const hackathons = await load('hackathons.json')
const skills = await load('skills.json')

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// ── Shape ───────────────────────────────────────────────────────────────────

test('every dataset carries enough rows to make matching meaningful', () => {
  assert.ok(startups.length >= 10, `expected at least 10 companies, found ${startups.length}`)
  assert.ok(hackathons.length >= 5, `expected at least 5 hackathons, found ${hackathons.length}`)
  assert.ok(skills.length >= 10, `expected at least 10 skills, found ${skills.length}`)
})

test('the company list spans both listed employers and early-stage startups', () => {
  // The product promises startups, not just the obvious unicorns. A dataset that
  // drifted to only-big-names would still pass every other test here.
  const early = startups.filter(s => /series|seed|acquired/i.test(s.stage ?? ''))
  assert.ok(early.length >= 2, `expected at least 2 startup-stage companies, found ${early.length}`)
})

test('companies have the fields matching.js and the panel read', () => {
  for (const startup of startups) {
    assert.ok(startup.id, 'missing id')
    assert.ok(startup.name, `${startup.id}: missing name`)
    assert.ok(Array.isArray(startup.skills_required) && startup.skills_required.length,
      `${startup.name}: skills_required drives the entire match score and must be non-empty`)
    assert.ok(Array.isArray(startup.roles_available), `${startup.name}: roles_available must be an array`)
    assert.ok(/^https:\/\//.test(startup.apply_url ?? ''), `${startup.name}: apply_url must be https`)
  }
})

test('hackathons have the fields matching.js and the panel read', () => {
  for (const hackathon of hackathons) {
    assert.ok(hackathon.id, 'missing id')
    assert.ok(hackathon.name, `${hackathon.id}: missing name`)
    assert.ok(Array.isArray(hackathon.skills_relevant) && hackathon.skills_relevant.length,
      `${hackathon.name}: skills_relevant drives the match score and must be non-empty`)
    assert.match(hackathon.deadline ?? '', ISO_DATE, `${hackathon.name}: deadline must be YYYY-MM-DD`)
    assert.match(hackathon.event_date ?? '', ISO_DATE, `${hackathon.name}: event_date must be YYYY-MM-DD`)
    assert.ok(/^https:\/\//.test(hackathon.registration_url ?? ''), `${hackathon.name}: registration_url must be https`)
    assert.ok(hackathon.team_size_min <= hackathon.team_size_max,
      `${hackathon.name}: team_size_min exceeds team_size_max`)
  }
})

test('ids are unique within each dataset', () => {
  for (const [label, rows] of [['startups', startups], ['hackathons', hackathons], ['skills', skills]]) {
    const ids = rows.map(row => row.id)
    assert.equal(new Set(ids).size, ids.length, `${label} contains duplicate ids`)
  }
})

// ── Honesty ─────────────────────────────────────────────────────────────────

test('every projected date is labelled as projected, with a reason', () => {
  // A date the organiser has not published must never render like one that has.
  for (const hackathon of hackathons) {
    assert.ok(['confirmed', 'expected'].includes(hackathon.date_status),
      `${hackathon.name}: date_status must be "confirmed" or "expected"`)
    if (hackathon.date_status === 'expected') {
      assert.ok((hackathon.date_status_reason ?? '').length > 30,
        `${hackathon.name}: an expected date needs a reason the UI can show the user`)
    }
  }
})

test('no dataset field is mojibake', () => {
  // The files were briefly saved as UTF-8 read as cp1252, turning every em dash into
  // "â€”" and shipping it to the panel. Cheap to assert, easy to reintroduce.
  const raw = JSON.stringify({ startups, hackathons, skills })
  const mojibake = raw.match(/â€|Ã[-¿]|ï¿½/g)
  assert.equal(mojibake, null, `found mis-decoded characters: ${mojibake?.slice(0, 3).join(', ')}`)
})

// ── Consistency with the code that consumes it ──────────────────────────────

test('at least five hackathons are still open for a mainstream stack', () => {
  // rankHackathons drops anything past its deadline. If the file is never refreshed
  // this silently empties the Events tab — the failure the old dataset was heading for.
  const open = matching.rankHackathons(['React', 'Node.js', 'Python'], hackathons)
  assert.ok(open.length >= 5,
    `only ${open.length} hackathons are still open — refresh data/hackathons.json`)
})

test('a common Indian-developer stack matches real companies, not zero', () => {
  const ranked = matching.rankStartups(['React', 'Node.js', 'PostgreSQL', 'TypeScript'], startups)
  assert.ok(ranked[0].match_score >= 60,
    `best match was only ${ranked[0].match_score}% — the skill vocabulary has drifted from the dataset`)
})

test('skills named in the gap report resolve to the skills catalog', () => {
  // buildGapReport falls back to a Google search link for unknown skills. A handful
  // of those is fine; a majority means the catalog no longer covers the demand.
  const required = new Set(startups.flatMap(startup => startup.skills_required))
  const known = new Set(skills.map(skill => skill.name.toLowerCase()))
  const covered = [...required].filter(skill => known.has(skill.toLowerCase()))
  assert.ok(covered.length / required.size >= 0.5,
    `only ${covered.length}/${required.size} required skills exist in skills.json`)
})
