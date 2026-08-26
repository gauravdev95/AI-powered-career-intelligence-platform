# Architecture

```
                         React 18 + vis-network
                                  │
                                  ▼
                          Express API (server.js)
                                  │
                                  ▼
                       Career Memory Engine
             ┌────────────────────┼────────────────────┐
             ▼                    ▼                    ▼
        PostgreSQL            pgvector               Redis
     (source of truth)    (semantic search)      (cache, optional)
             └────────────────────┼────────────────────┘
                                  ▼
                             Gemini API
                                  ▼
                     Grounded career intelligence
```

---

## 1. Why this shape

Grafted's product promise is *"your career, always remembered."* That makes storage
the product, not a detail. The architecture is therefore organised around one
question: **what does the system durably know about this developer, and how does it
decide what to say?**

Three separable concerns fall out of that:

| Concern | Answer | Where |
|---|---|---|
| What do we know? | Typed, scored memories in PostgreSQL | `memory/MemoryStore.js` |
| What is relevant right now? | Hybrid retrieval + multi-signal ranking | `MemoryRetriever`, `MemoryRanker` |
| What do we say? | Budgeted context → Gemini → verified citations | `ContextBuilder`, `aiService` |

Everything else — matching, the graph, the journey — is a projection of the memory
layer.

---

## 2. The Career Memory Engine

```
backend/memory/
├── index.js                 public entry point
├── MemoryEngine.js          orchestration façade — the only module the API calls
├── MemoryStore.js           durable persistence, user-scoped SQL
├── MemoryRetriever.js       hybrid vector + keyword candidate search
├── MemoryRanker.js          six-signal configurable scoring
├── MemoryExtractor.js       raw material → candidate memories
├── MemoryDeduplicator.js    skip / reinforce / supersede / conflict
├── ContextBuilder.js        budgeted context + citation verification
├── MemoryGraph.js           relationships, wikilinks, graph projection
└── types.js                 memory types, statuses, sources, relations
```

### 2.1 Write path — `remember()`

```
candidate → embed → deduplicate → resolve conflict → persist → relate
```

1. **Embed.** The candidate's title + content is embedded once.
2. **Deduplicate.** `MemoryDeduplicator.resolve()` compares it against what is stored and returns one of five actions:

   | Action | When | Effect |
   |---|---|---|
   | `skip` | Byte-identical content hash | Bump access stats only |
   | `reinforce` | Same natural key restated, or cosine ≥ 0.92 | Merge upward: confidence rises, best source wins, longer content kept |
   | `supersede` | Same natural key, materially different content | New row becomes `ACTIVE`, old becomes `SUPERSEDED` and points at its replacement |
   | `conflict` | Same key, contradictory, and the stored memory is better evidenced by > 0.25 | Both flagged `CONFLICTED` and removed from retrieval |
   | `insert` | Novel | Straight insert |

   The evidence score is `0.6 × confidence + 0.4 × sourceQuality`. This is what stops
   a low-quality scrape from silently overwriting something the developer typed into
   onboarding.

3. **Persist and relate.** Skills, gaps, goals and targets are wired to the `PROFILE`.
   memory, so the graph always has a root.

`rememberMany()` embeds a whole batch in one call and collapses in-batch duplicates
first, so a posting that mentions React five times costs one embedding and produces
one memory.

### 2.2 Read path — `recall()`

```
question → embed → pgvector ANN ─┐
                    wiki chunks ─┼→ merge → rank → budget → context
                keyword literal ─┘
```

Retrieval is deliberately hybrid. Embeddings handle paraphrase; a literal keyword
pass catches rare tokens (`Zerodha`, `DSA`) that fall below the similarity floor.


**Ranking** blends six signals, each normalised to `[0,1]`:


| Signal     | Default weight | Rationale |
|--------|----------------|-----------|
| `semantic` | 0.40 | Cosine similarity to the query |
| `importance` | 0.15 | How central the fact is to their career |
| `recency` | 0.15 | Exponential decay, 30-day half-life |
| `confidence` | 0.10 | How sure we are it is true |
| `sourceQuality` | 0.10 | How much we trust the channel |
| `accessFrequency` | 0.10 | `log1p`-saturated proof of usefulness |

Weights come from `RANK_W_*` environment variables and are re-normalised at use time,
so tuning never requires a code change. Every ranked result carries a `rankBreakdown`
showing each component's contribution — visible through
`POST /api/memory/:userId/search`.

A **type-diversity quota** stops one category monopolising the window: with 200 wiki
chunks stored, the developer's goals still reach the prompt.

**ContextBuilder** then fills a hard character budget (`MEMORY_CONTEXT_CHAR_BUDGET`,
default 6000) highest-value-first. This is the mechanism that guarantees the whole
wiki is never sent to the model, however large it grows.

### 2.3 Citations

Every context entry is labelled with a stable key. The model is instructed to cite
those keys, and `resolveCitations()` discards any key that was not actually supplied.
A fabricated citation cannot reach the UI — verified by test.

### 2.4 Memory types

`PROFILE` · `SKILL` · `SKILL_GAP` · `GOAL` · `TARGET_COMPANY` · `JOB` · `COMPANY` ·
`HACKATHON` · `WIKI` · `WIKI_CHUNK` · `JOURNEY_EVENT` · `CONVERSATION` · `PREFERENCE`
· `ROADMAP`

Statuses: `ACTIVE` · `SUPERSEDED` · `CONFLICTED` · `ARCHIVED`. Only `ACTIVE` memories
are retrievable; the rest are retained because "what they once believed" is itself
career history.

### 2.5 Three tiers of chat memory

| Tier | Storage | Lifetime |
|---|---|---|
| Short-term | `conversation_turns` | Rolling 50-turn window, trimmed on write |
| Long-term | `memories` | Durable — only facts the developer stated about themselves |
| Semantic | `wiki_chunks` + embeddings | Durable, retrieved by meaning |

Raw chat is **not** promoted wholesale. `MemoryExtractor.fromConversation()` asks the
model for durable self-statements only, filters the result to a five-type allowlist,
and caps confidence at 0.75 — a claim made in passing is weaker evidence than the same
claim entered in onboarding. Small talk leaves no trace.

---

## 3. Data model

```sql
users              -- scalar identity; lists live as memories
memories           -- one durable fact; typed, scored, embedded, status-tracked
memory_relations   -- the graph: HAS_SKILL, NEEDS_SKILL, REQUIRES, TARGETS, LINKS_TO…
wiki_pages         -- the document of record
wiki_chunks        -- retrieval-sized slices, embedded
journey_events     -- append-only career timeline
conversation_turns -- short-term chat window
ingest_log         -- ingest audit trail
```

Indexes: HNSW (`vector_cosine_ops`) on both embedding columns, btree on
`(user_id, type, status)`, and a **partial unique index** on
`(user_id, type, dedup_key) WHERE status = 'ACTIVE'` — the constraint that makes
"one active fact per natural key" a database guarantee rather than a convention.

The profile projection is deliberate: `stack`, `goals` and `target_companies` are not
columns. They are `SKILL` / `GOAL` / `TARGET_COMPANY` memories reassembled by
`getProfile()`. That is what lets a skill participate in ranking, deduplication and
the graph while the pre-existing API response shape stays unchanged.

---

## 4. Wiki pipeline

```
page → strip frontmatter → chunk on headings (900 chars, 150 overlap)
     → embed each chunk → wiki_chunks
     → WIKI memory for the page
     → parse [[type/name]] → resolve or create target → LINKS_TO edge
```

Re-saving a page deletes and rebuilds its chunks, so superseded content cannot keep
answering questions. Wikilinks pointing at something not yet ingested create a
low-confidence **stub** memory, so the edge has a real endpoint that a later ingest
enriches rather than duplicates.

---

## 5. Knowledge graph

`GET /api/graph-data/:userId` projects memories and relations into the node/edge shape
vis-network already renders. Memory types map onto the frontend's existing groups
(`user`, `skill_known`, `skill_gap`, `startup`, `hackathon`, `wiki`, `goal`), node size
derives from importance, and every edge is guaranteed to connect two nodes that exist.

---

## 6. AI layer

```
services/
├── aiService.js           provider-agnostic career tasks
├── providers/gemini.js    the only provider today
└── embeddings.js          cache → provider → deterministic local fallback
```

`aiService` exposes domain tasks (`extractEntities`, `generateWikiPage`,
`answerFromContext`, `generateRoadmap`, `extractDurableMemories`, `summarize`), never
provider primitives. Adding a provider means one new module plus `AI_PROVIDER`.

Structured tasks use Gemini's JSON mode with an explicit `responseSchema`, which is far
more reliable than asking for JSON in the prompt.

**Graceful degradation.** With no `GEMINI_API_KEY`, Grafted still runs: matching,
storage, retrieval, ranking, the graph and the journey are all unaffected. Embeddings
fall back to a deterministic local hashing encoder (lexical rather than semantic —
lower recall on paraphrase, but real vector search), and generative features return
honest canned responses. The test suite runs entirely in this mode, which is why it
needs no API key.

---

## 7. Security

| Control | Implementation |
|---|---|
| SQL injection | Every statement parameterised; no interpolation above `db/pool.js` |
| User isolation | `user_id` is a mandatory parameter in every store method and appears in every `WHERE` clause — there is no method that reads a memory without naming its owner |
| Input validation | `lib/validate.js` — UUID-shaped ids, control-character stripping, bounded lengths |
| Rate limiting | Global bucket plus a tighter bucket on token-spending routes |
| Payload limits | 1 MB body cap; ingest input capped at 12 000 chars |
| Secret hygiene | `redact()` on every logged error; API key sent as a header, never a query param; 5xx bodies never echoed |
| SSRF | See below |
| Security headers | `nosniff`, `DENY`, `no-referrer`, HSTS in production |

### SSRF controls on URL ingestion

Applied on the initial request **and re-applied on every redirect hop**:

1. Scheme allowlist — `http`/`https` only.
2. URLs containing credentials rejected.
3. Hostname resolved; **every** returned address must be publicly routable. Blocked:
   loopback, private ranges, CGNAT, link-local (**including `169.254.169.254` cloud
   metadata**), multicast, reserved, and the IPv6 equivalents including IPv4-mapped
   forms.
4. Redirects followed manually, capped at 3.
5. A real timeout via a per-hop deadline — the previous code passed node-fetch a
   `timeout` option that v3 ignores entirely, so there was no timeout at all.
6. Response size capped while streaming.
7. Content-Type must be HTML/text.
8. Connections are pinned to the exact validated address, closing the DNS-rebinding
   window between validation and connection.

### Authorisation model — a known limitation

Grafted has no login. A `userId` is a server-minted UUIDv4 held in `localStorage` and
used as a **bearer capability**. Every route resolves it against PostgreSQL and every
query is scoped to it, so one user can never read another's memory — but anyone who
obtains the id has full access to that profile. Real accounts are the documented
upgrade path; the memory layer needs no change, since it is already user-scoped.

---

## 8. Testing

91 tests, all runnable with no API key and no Docker.

Integration tests execute against **PGlite** — PostgreSQL compiled to WebAssembly with
the real pgvector extension — so the SQL, the `<=>` cosine operator, the constraints
and the schema under test are the production ones, not mocks.

| Area | Covered |
|---|---|
| Persistence across restart | Writes in one process, exits, reads back in a freshly spawned process |
| Vector search | Ranks related above unrelated; type filtering; valid cosine range |
| Ranking | Half-life decay, saturation, weight configurability, diversity quota |
| Deduplication | Skip, reinforce, supersede-with-history, conflict flagging |
| Cross-user isolation | Direct fetch, vector search, keyword search, recall, and mutation |
| Wiki | Chunking, re-save replacing stale chunks, semantic retrieval, isolation |
| Citations | Fabricated keys dropped; real keys resolved |
| Journey | Persistence, ordering, user scoping |
| SSRF | Address classifier, URL gate, live loopback request refused, redirect re-validation |
| API contracts | Response shapes the React frontend depends on |

---
## 9. What changed from v1

| v1 | v2 |
|---|---|
| Storage SDK never installed → 100% in-process `Map`; all data lost on restart | PostgreSQL as source of truth; restart durability proven by test |
| Single hard-coded AI provider; a `claude_analysis` field produced by no model at all | Gemini behind `aiService`; field renamed `analysis` |
| `analyzer.js` dead and reading fields the JSON never had | `matching.js`, wired in and tested |
| `updateJourney()` exported but never called → timeline always empty | `recordJourney()` called across the app; persisted and tested |
| `/api/graph-data/:userId` implemented but never called; wikilink graph unreachable | Serves the real memory graph; wikilinks are durable edges |
| Return context read `gap_analyses[].gaps[0].skill`, a key never written | Reads real `SKILL_GAP` memories; regression test pins it |
| `fetchURL` had no timeout and no SSRF guard | Full SSRF control set, verified against a live loopback server |
| Whole wiki concatenated into the prompt | Retrieval + ranking + hard character budget |
