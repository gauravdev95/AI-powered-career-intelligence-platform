/**
 * Durability test — the requirement that motivated this refactor.
 *
 * The previous implementation kept everything in a process-local Map, so a Render
 * restart (or the free tier idling out) erased every profile, wiki page and journey
 * event. This test proves the replacement actually survives a restart: it writes in
 * one Node process, lets that process exit completely, then reads back in a second,
 * freshly-spawned process pointed at the same on-disk database.
 */

import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const run = promisify(execFile)
const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..')

const dataDir = await mkdtemp(join(tmpdir(), 'devradar-persist-'))
after(() => rm(dataDir, { recursive: true, force: true }))

/** Runs a script in a brand-new Node process against the on-disk test database. */
async function inFreshProcess(script) {
  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script], {
    cwd: backendDir,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_DRIVER: 'pglite',
      PGLITE_DATA_DIR: dataDir,
      DATABASE_AUTO_MIGRATE: 'true',
      REDIS_ENABLED: 'false',
      GEMINI_API_KEY: '',
    },
    timeout: 120000,
  })
  const marker = stdout.lastIndexOf('__RESULT__')
  assert.notEqual(marker, -1, `script produced no result. Output:\n${stdout}`)
  return JSON.parse(stdout.slice(marker + '__RESULT__'.length).trim())
}

test('memory survives a full process restart', async () => {
  // ── Process 1: write a complete user's worth of memory, then exit ──────────
  const written = await inFreshProcess(`
    import { migrate } from './db/migrate.js'
    import { close } from './db/pool.js'
    import engine from './memory/index.js'

    await migrate({ verbose: false })

    const profile = await engine.initUser({
      name: 'Persistent Dev',
      experience: '2-3 years',
      stack: ['React', 'Node.js'],
      learningStack: ['TypeScript'],
      goals: ['Join a payments company'],
      targetCompanies: ['Razorpay'],
      targetRole: 'Backend Engineer',
      timeline: '6 months',
    })

    await engine.saveWikiPage(profile.userId, 'company', 'razorpay',
      '# Razorpay\\n\\n## Overview\\nRazorpay pays 18-32 LPA for backend engineers in Bangalore.\\n\\n## Relevance\\nNeeds [[skill/typescript]].', { source: 'pasted text' })

    await engine.recordJourney(profile.userId, 'skill_learned', { title: 'Learned TypeScript' })
    await engine.recordEntityView(profile.userId, 'startup', { id: 'razorpay', name: 'Razorpay', type: 'Fintech', hiring: true })

    const stats = await engine.getStats(profile.userId)
    await close()
    console.log('__RESULT__' + JSON.stringify({ userId: profile.userId, stats }))
  `)

  assert.ok(written.userId)
  assert.ok(written.stats.memories > 0)
  assert.equal(written.stats.wikiPages, 1)

  // ── Process 2: a cold start that has never seen the data in memory ────────
  const readBack = await inFreshProcess(`
    import { migrate } from './db/migrate.js'
    import { close } from './db/pool.js'
    import engine from './memory/index.js'

    await migrate({ verbose: false })

    const userId = ${JSON.stringify(written.userId)}
    const profile = await engine.getProfile(userId)
    const pages = await engine.getWikiPages(userId)
    const journey = await engine.getJourney(userId)
    const graph = await engine.getGraphData(userId)
    const stats = await engine.getStats(userId)
    const recalled = await engine.recall(userId, 'what does Razorpay pay backend engineers')

    await close()
    console.log('__RESULT__' + JSON.stringify({
      profile, pageCount: pages.length, pageKey: pages[0]?.key,
      journeyTypes: journey.map(e => e.type),
      graphNodes: graph.nodes.length, graphEdges: graph.edges.length,
      stats, recalledEntries: recalled.entries.length, context: recalled.context,
    }))
  `)

  // Profile
  assert.equal(readBack.profile.name, 'Persistent Dev')
  assert.equal(readBack.profile.experience, '2-3 years')
  assert.deepEqual(readBack.profile.stack.sort(), ['Node.js', 'React'])
  assert.deepEqual(readBack.profile.learning_stack, ['TypeScript'])
  assert.deepEqual(readBack.profile.goals, ['Join a payments company'])
  assert.deepEqual(readBack.profile.target_companies, ['Razorpay'])

  // Wiki
  assert.equal(readBack.pageCount, 1)
  assert.equal(readBack.pageKey, 'company/razorpay')

  // Journey
  assert.ok(readBack.journeyTypes.includes('account_created'))
  assert.ok(readBack.journeyTypes.includes('skill_learned'))
  assert.ok(readBack.journeyTypes.includes('startup_viewed'))

  // Graph
  assert.ok(readBack.graphNodes > 0)
  assert.ok(readBack.graphEdges > 0)

  // Embeddings survived too — semantic recall works on a cold process.
  assert.ok(readBack.recalledEntries > 0, 'vector search must work against stored embeddings after restart')
  assert.match(readBack.context, /18-32 LPA/, 'the stored wiki content must be retrievable by meaning')

  assert.equal(readBack.stats.memories, written.stats.memories, 'no memory was lost across the restart')
})
