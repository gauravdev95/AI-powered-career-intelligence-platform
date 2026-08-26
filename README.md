# Grafted

**Your career, remembered.**

An AI career-intelligence platform for Indian developers. Enter your tech stack and
Grafted renders a live knowledge graph — you at the centre, and one neighbourhood
at a time: your skills, your gaps, the startups you match and the hackathons worth
entering. Click any node to re-centre on it. Paste a job description and the graph
grows. Ask it a question and it answers from your own stored memory, with citations.

Built on a custom **Career Memory Engine**: PostgreSQL + pgvector for durable,
semantic, relationship-aware memory, with Gemini for extraction and generation.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, vis-network |
| API | Node 20, Express (ESM) |
| Memory | PostgreSQL 14+ with pgvector |
| Cache | Redis (optional) |
| AI | Gemini — generation + embeddings, behind a provider abstraction |
| Deploy | Vercel (frontend) · Render (API + Postgres) |

---

## Quick start

### Prerequisites

- Node.js **20.6+** (the test runner uses `--env-file`)
- PostgreSQL 14+ with the `pgvector` extension — or nothing at all for local
  development, see below
- A Gemini API key (optional — the app runs without one)

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env`:

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/grafted
GEMINI_API_KEY=your-key-here     # optional
```

Apply the schema and start:

```bash
npm run db:migrate
npm run dev
```

The API listens on `http://localhost:3001`. Check it:

```bash
npm run health
```

**No PostgreSQL installed?** Leave `DATABASE_URL` empty. Outside production the app
falls back to `DATABASE_DRIVER=pglite`, an in-process PostgreSQL build with real
pgvector — zero setup. Set `PGLITE_DATA_DIR=./.pglite` to keep the data between
restarts. This driver is for development and tests only and is rejected when
`NODE_ENV=production`.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. To point at a non-default API, create `frontend/.env`:

```bash
VITE_API_URL=http://localhost:3001
```

### 3. Tests

```bash
cd backend
npm test
```

91 tests. No API key, no Docker, no running database required — integration tests use
an in-process PostgreSQL with the real pgvector extension.

---

## Running without a Gemini key

Grafted degrades honestly rather than breaking:

| Feature | Without a key |
|---|---|
| Startup / hackathon matching, gap analysis | **Unaffected** — deterministic, not AI |
| Storage, retrieval, ranking, graph, journey | **Unaffected** |
| Vector search | Works, using a deterministic local encoder (lexical, so paraphrases are missed) |
| Entity extraction, wiki generation | Returns a structured placeholder page |
| Chat, roadmap | Returns a clearly-labelled fallback response |

---

## API

Base URL: `http://localhost:3001`

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/health` | Database, cache, AI and dataset status |
| `POST` | `/api/user/init` | Create a profile; returns `userId` |
| `GET` | `/api/user/:userId` | Assembled profile |
| `POST` | `/api/user/:userId/stack` | Replace known skills |
| `POST` | `/api/analyze` | Rank startups against a stack |
| `POST` | `/api/gaps` | Priority skill gaps with salary impact |
| `GET` | `/api/hackathons/:userId` | Ranked hackathons with deadline urgency |
| `GET` | `/api/skills` | Curated skills catalogue |
| `GET` | `/api/return-context/:userId` | Personalised welcome-back summary |
| `POST` | `/api/ingest` | Ingest a job description or URL → wiki pages |
| `GET` | `/api/wiki-pages/:userId` | List wiki pages |
| `GET` | `/api/wiki/:userId/:type/:name` | One wiki page |
| `POST` | `/api/chat` | Grounded answer with verified citations |
| `GET` | `/api/roadmap/:userId` | Four-week learning roadmap |
| `GET` | `/api/journey/:userId` | Career timeline |
| `GET` | `/api/graph-data/:userId` | Knowledge graph nodes and edges |
| `GET` | `/api/memory/:userId/stats` | Memory counts by type |
| `POST` | `/api/memory/:userId/search` | Ranked memory search with score breakdown |

### Inspecting the memory engine

The clearest window into how ranking works:

```bash
curl -X POST http://localhost:3001/api/memory/<userId>/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"what should I learn next"}'
```

Each result carries its blended `score` plus the `breakdown` of all six signals
(`semantic`, `importance`, `recency`, `confidence`, `sourceQuality`,
`accessFrequency`).

---

## How it works

```
Onboarding → memories (PROFILE, SKILL, GOAL, TARGET_COMPANY)
     ↓
Career graph ← matching (deterministic) + memory relations
     ↓
Ingest (job description / URL) → Gemini extraction → memories + wiki pages
                                → chunked → embedded → pgvector
     ↓
Chat: question → embed → pgvector search → rank (6 signals)
                → budgeted context → Gemini → verified citations
     ↓
Everything persists in PostgreSQL → returning visits are context-aware
```

Full detail — write path, conflict resolution, ranking weights, security controls —
is in **[ARCHITECTURE.md](ARCHITECTURE.md)**.

---

## Configuration

Every tunable is an environment variable; see
[`backend/.env.example`](backend/.env.example) for the annotated list. The ones worth
knowing:

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | **Required in production** |
| `GEMINI_API_KEY` | — | Optional; enables generative features |
| `GEMINI_MODEL` | `gemini-3-flash-preview` | Model id — verify against Google's current list |
| `EMBEDDING_DIMENSIONS` | `768` | Must match the `vector(N)` column |
| `RANK_W_*` | see below | Six ranking weights, re-normalised at use time |
| `MEMORY_CONTEXT_CHAR_BUDGET` | `6000` | Hard cap on prompt context |
| `INGEST_ALLOWED_HOSTS` | — | Optional SSRF allowlist for URL ingestion |
| `REDIS_URL` | — | Optional shared cache |

Default ranking weights: semantic `0.40`, importance `0.15`, recency `0.15`,
confidence `0.10`, source quality `0.10`, access frequency `0.10`.

> **Model ids are configuration, not code.** Set `GEMINI_MODEL` to whichever
> generation you have access to; nothing else changes. Confirm the id against
> Google's published model list before deploying — an unavailable id fails at
> request time, not at boot.

---

## Deployment

See **[DEPLOYMENT.md](DEPLOYMENT.md)**. In short: `backend/render.yaml` provisions the
API and a managed PostgreSQL together, so `DATABASE_URL` is wired automatically and
the schema is applied on first boot.

**Migrating from v1:** there is no data to migrate. v1 stored everything in a
process-local `Map` that was erased on every restart, so every deployment started
empty regardless.

---

## Project layout

```
backend/
├── server.js              Express API — routes only
├── config.js              all environment configuration
├── matching.js            deterministic startup/hackathon/gap matching
├── fetcher.js             ingest input handling
├── memory/                the Career Memory Engine (see ARCHITECTURE.md)
├── services/              aiService, providers/gemini, embeddings, cache
├── db/                    pool, schema.sql, migrate
├── lib/                   errors, validation, SSRF-safe fetch, bounded concurrency
├── data/                  curated startups, hackathons, skills
├── scripts/               check-data-links.js (npm run data:check)
└── tests/                 109 tests

frontend/
└── src/
    ├── App.jsx            graph assembly and routing
    ├── components/        graph, panels, onboarding, chat, wiki
    └── lib/api.js         axios client
```

---

## The curated datasets

`backend/data/` holds the three files the matching layer ranks against: 20 companies,
15 hackathons, 30 skills. They are the one part of Grafted a user reads as fact, so
they follow rules:

- **Real entities only.** Every company is a real employer and every `apply_url` and
  `registration_url` resolves. `npm run data:check` verifies this over the network and
  exits non-zero on a dead link; it also reports redirects, which usually mean a
  company moved or rebranded and the dataset should follow.
- **Projected dates are labelled.** Each hackathon carries `date_status`. `confirmed`
  means the organiser published the date, with `date_note` recording what exactly was
  published. `expected` means it is projected from the event's previous editions —
  those rows must also carry `date_status_reason`, and the UI shows it as a caution
  rather than rendering the date like a fact. `tests/data.test.js` enforces this.
- **No unverifiable fields.** A `hackathons_sponsored` list was removed: nothing read
  it and its contents could not be sourced.
- **Salary bands are indicative.** `salary_range_lpa` is a market range for the role
  and location, not a company-published figure. Treat it as orientation, not an offer.

`tests/data.test.js` also fails the build if the deadlines have rotted far enough that
fewer than five hackathons are still open — the failure mode the Events tab would
otherwise reach silently.

---

## When the AI provider is unavailable

Every generation task has a deterministic fallback, and a rate limit is treated as one
more form of unavailable rather than an error. Chat, roadmaps and wiki generation keep
returning `200` with usable content and a `degraded` field (`rate_limited`,
`unconfigured`, `unavailable`) that the UI surfaces, so a canned reply is never
presented as a generated one. Matching, memory, retrieval and search do not use the
provider at all and are unaffected.

Ingest generates wiki pages `INGEST_WIKI_PAGE_CONCURRENCY` at a time (default 2). An
unbounded fan-out spent the provider's whole per-minute budget on a single paste and
rate-limited whatever the user did next.

---

## License

MIT
