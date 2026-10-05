/**
 * One-shot import of Gaurav's real job-application history into the production
 * database. Reads scripts/job-applications.json (58 applications exported from
 * the weekly tracker) and writes them as typed memories through the app's own
 * MemoryEngine — so dedup, embeddings and relations all behave exactly like
 * data that arrived through the product.
 *
 * Usage:  DATABASE_URL=<prod-url> node scripts/inject-job-history.js
 *
 * The script is idempotent: rerunning it reinforces/skips existing memories
 * instead of duplicating them (dedup keys are stable per company / application).
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { initUser, rememberMany, getProfile } from '../memory/MemoryEngine.js'
import { MEMORY_TYPES, MEMORY_SOURCES } from '../memory/types.js'
import { dedupKeyFor } from '../memory/MemoryExtractor.js'
import { slugify } from '../lib/validate.js'
import { query } from '../db/pool.js'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const applications = JSON.parse(readFileSync(join(scriptDir, 'job-applications.json'), 'utf8'))

// ── Gaurav's profile: verified facts only ────────────────────────────────────
const PROFILE = {
  name: 'Gaurav Yadav',
  experience: '0-1 years',
  stack: ['Python', 'React', 'Node.js', 'PostgreSQL', 'MongoDB', 'Neo4j', 'LangChain', 'LangGraph', 'RAG', 'Prompt Engineering', 'SQL', 'Vector Search'],
  learningStack: [],
  goals: ['Land an AI Engineer / Software Engineer role as a 2027 fresher'],
  targetRole: 'AI Engineer',
  targetCompanies: [],
  timeline: 'Immediate',
  learningStyle: '',
}

function normDate(raw) {
  // '05-Oct-2026' | '2026-10-05' | '27-Sep-2026' → '2026-10-05'
  const m1 = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`
  const months = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' }
  const m2 = raw.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/)
  if (m2 && months[m2[2]]) return `${m2[3]}-${months[m2[2]]}-${m2[1]}`
  return raw
}

function jobContent(app) {
  // One consistent shape for every application — the user asked for uniform data.
  const lines = [
    `Applied on ${app.date} via ${app.platform}.`,
    `Role: ${app.role}`,
    `Company: ${app.company}`,
  ]
  if (app.location) lines.push(`Location: ${app.location}`)
  if (app.salary) lines.push(`Salary: ${app.salary}`)
  lines.push(`Status: ${app.status}`)
  if (app.notes) lines.push(`Details: ${app.notes}`)
  return lines.join('\n')
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')

  // Reuse the existing profile user if this script has run before.
  const existing = await query(`SELECT user_id FROM users WHERE name = 'Gaurav Yadav' LIMIT 1`)
  let userId
  if (existing.rows.length) {
    userId = existing.rows[0].user_id
    console.log(`reusing existing user ${userId}`)
  } else {
    const profile = await initUser(PROFILE)
    userId = profile.userId
    console.log(`created user ${userId} (${profile.name})`)
  }

  // One COMPANY memory per distinct company…
  const seenCompanies = new Map()
  for (const app of applications) {
    const key = slugify(app.Company)
    if (!seenCompanies.has(key)) seenCompanies.set(key, app.Company)
  }
  const companyCandidates = [...seenCompanies.entries()].map(([slug, name]) => {
    const locs = [...new Set(applications.filter(a => slugify(a.Company) === slug).map(a => a.Location).filter(Boolean))]
    return {
      type: MEMORY_TYPES.COMPANY,
      dedupKey: dedupKeyFor(MEMORY_TYPES.COMPANY, name),
      title: name,
      content: `Company encountered through job applications.${locs.length ? ` Locations seen: ${locs.join('; ')}.` : ''}`,
      data: { locations: locs, applicationCount: applications.filter(a => slugify(a.Company) === slug).length },
      source: MEMORY_SOURCES.USER_INPUT,
      confidence: 0.95,
    }
  })

  // …and one JOB memory per application, all in the same shape.
  const jobCandidates = applications.map(app => {
    const date = normDate(app.Date)
    const status = app.Status || 'Applied'
    return {
      type: MEMORY_TYPES.JOB,
      dedupKey: `job:${slugify(app.Company)}:${slugify(app.Role)}:${slugify(date)}`,
      title: `${app.Role} at ${app.Company}`,
      content: jobContent({ ...app, date }),
      data: {
        company: app.Company,
        role: app.Role,
        platform: app.Platform,
        location: app.Location || null,
        salary: app.Salary || null,
        status,
        date,
      },
      source: MEMORY_SOURCES.USER_INPUT,
      confidence: 0.95,
      // Shortlisted applications matter more for retrieval; rejections stay visible.
      importance: status === 'Shortlisted' ? 0.9 : 0.7,
    }
  })

  console.log(`writing ${companyCandidates.length} companies…`)
  const companies = await rememberMany(userId, companyCandidates)
  console.log(`writing ${jobCandidates.length} job applications…`)
  const jobs = await rememberMany(userId, jobCandidates)

  const profile = await getProfile(userId)
  console.log(`done. companies=${companies.length} jobs=${jobs.length} profile_stack=${(profile.stack || []).length}`)
}

main().catch(err => { console.error('IMPORT FAILED:', err.message); process.exit(1) })
