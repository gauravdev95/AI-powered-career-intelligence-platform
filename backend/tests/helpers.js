/**
 * Shared test fixtures.
 *
 * Each test file runs in its own process (node --test), so each gets a private
 * in-process PostgreSQL instance. Schema is applied once per file.
 */

import { randomUUID } from 'crypto'
import { migrate } from '../db/migrate.js'
import { close } from '../db/pool.js'
import { closeCache } from '../services/cache.js'
import engine from '../memory/index.js'

let migrated = false

export async function setupDatabase() {
  if (!migrated) {
    await migrate({ verbose: false })
    migrated = true
  }
}

export async function teardown() {
  await closeCache()
  await close()
}

/** Creates a user with a realistic onboarding profile. */
export async function createTestUser(overrides = {}) {
  return engine.initUser({
    userId: randomUUID(),
    name: 'Test Developer',
    experience: '1-2 years',
    stack: ['React', 'Node.js', 'JavaScript'],
    learningStack: ['TypeScript'],
    goals: ['Join a funded fintech startup'],
    targetRole: 'Backend Engineer',
    targetCompanies: ['Razorpay'],
    timeline: '6 months',
    learningStyle: 'building projects',
    ...overrides,
  })
}

export const SAMPLE_JOB_POST = `
Senior Backend Engineer — Razorpay, Bangalore

We are hiring a backend engineer to work on our payments platform.

Requirements:
- 2+ years with Node.js and TypeScript
- Strong PostgreSQL and Redis experience
- Familiarity with Kafka and event-driven architecture
- Understanding of distributed systems and system design

Salary: 18-32 LPA. We are actively hiring for the payments core team.
`

export const SAMPLE_WIKI_PAGE = `---
type: company
name: Razorpay
tags: [fintech, payments]
updated: 2026-08-10
---

# Razorpay

## Overview
Razorpay is an Indian fintech unicorn building payment infrastructure for over ten
million businesses. For a developer with a Node.js background it is one of the most
accessible unicorn targets in Bangalore.

## Key Details
- Stage: Unicorn, headquartered in Bangalore
- Core stack: Node.js, React, TypeScript, Java, PostgreSQL
- Salary band: 18-32 LPA for engineers with one to three years of experience
- Interview focus: data structures, system design, low-level design

## Career Relevance
Your existing React and Node.js work maps directly onto their platform teams. The
gap to close is [[skill/typescript]], which appears in every one of their backend
postings, followed by [[skill/postgresql]] for their data-heavy services.

## Action Items
- [ ] Build one TypeScript service that talks to PostgreSQL
- [ ] Review their published engineering blog on payment idempotency
`
