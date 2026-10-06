-- Grafted Career Memory Engine — canonical schema.
-- {{EMBEDDING_DIM}} is substituted by db/migrate.js from config.ai.embeddingDimensions.
-- Every statement is idempotent: migrate.js may run on every boot.

CREATE EXTENSION IF NOT EXISTS vector;

-- ── Identity ────────────────────────────────────────────────────────────────
-- Scalar profile fields only. Everything list-shaped (skills, goals, target
-- companies) lives in `memories` so it participates in ranking and retrieval.

CREATE TABLE IF NOT EXISTS users (
  user_id        TEXT PRIMARY KEY,
  name           TEXT        NOT NULL DEFAULT 'Developer',
  experience     TEXT        NOT NULL DEFAULT '0-1 years',
  target_role    TEXT        NOT NULL DEFAULT '',
  timeline       TEXT        NOT NULL DEFAULT '',
  learning_style TEXT        NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_visit_at  TIMESTAMPTZ
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users (email);

-- ── Bring-your-own AI keys ──────────────────────────────────────────────────
-- One row per user. The key is stored ENCRYPTED (AES-256-GCM, see
-- services/userAiKeys.js) — the raw key is never returned by any endpoint and
-- never logged. Only a masked hint (last 4 chars) is ever exposed.

CREATE TABLE IF NOT EXISTS user_ai_keys (
  user_id       TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  key_encrypted TEXT NOT NULL,
  key_hint      TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Memories ────────────────────────────────────────────────────────────────
-- One row = one durable fact about one user. `dedup_key` is a stable natural key
-- (e.g. 'skill:react') used for upsert-style conflict resolution; NULL means the
-- memory is only deduplicated by embedding similarity.

CREATE TABLE IF NOT EXISTS memories (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          TEXT        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  type             TEXT        NOT NULL,
  dedup_key        TEXT,
  title            TEXT        NOT NULL DEFAULT '',
  content          TEXT        NOT NULL,
  data             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  importance       REAL        NOT NULL DEFAULT 0.5 CHECK (importance  BETWEEN 0 AND 1),
  confidence       REAL        NOT NULL DEFAULT 0.5 CHECK (confidence  BETWEEN 0 AND 1),
  source           TEXT        NOT NULL DEFAULT 'system',
  source_quality   REAL        NOT NULL DEFAULT 0.5 CHECK (source_quality BETWEEN 0 AND 1),
  status           TEXT        NOT NULL DEFAULT 'ACTIVE'
                     CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'CONFLICTED', 'ARCHIVED')),
  superseded_by    UUID        REFERENCES memories(id) ON DELETE SET NULL,
  content_hash     TEXT        NOT NULL,
  embedding        VECTOR({{EMBEDDING_DIM}}),
  access_count     INTEGER     NOT NULL DEFAULT 0,
  last_accessed_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one ACTIVE memory may hold a given natural key per user. Superseded and
-- archived revisions of the same key are retained for audit and conflict history.
CREATE UNIQUE INDEX IF NOT EXISTS memories_active_dedup_key_idx
  ON memories (user_id, type, dedup_key)
  WHERE dedup_key IS NOT NULL AND status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS memories_user_type_status_idx ON memories (user_id, type, status);
CREATE INDEX IF NOT EXISTS memories_user_updated_idx     ON memories (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS memories_user_hash_idx        ON memories (user_id, content_hash);

-- ── Relationships (the graph layer) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS memory_relations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  from_id    UUID        NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  to_id      UUID        NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  relation   TEXT        NOT NULL,
  weight     REAL        NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT memory_relations_unique UNIQUE (user_id, from_id, to_id, relation),
  CONSTRAINT memory_relations_no_self_loop CHECK (from_id <> to_id)
);

CREATE INDEX IF NOT EXISTS memory_relations_user_from_idx ON memory_relations (user_id, from_id);
CREATE INDEX IF NOT EXISTS memory_relations_user_to_idx   ON memory_relations (user_id, to_id);

-- ── Wiki: page is the document of record, chunks are the retrieval unit ──────

CREATE TABLE IF NOT EXISTS wiki_pages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  page_key   TEXT        NOT NULL,
  page_type  TEXT        NOT NULL,
  page_name  TEXT        NOT NULL,
  content    TEXT        NOT NULL,
  meta       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  memory_id  UUID        REFERENCES memories(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wiki_pages_user_key_unique UNIQUE (user_id, page_key)
);

CREATE INDEX IF NOT EXISTS wiki_pages_user_updated_idx ON wiki_pages (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS wiki_chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  page_id     UUID        NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  page_key    TEXT        NOT NULL,
  chunk_index INTEGER     NOT NULL,
  content     TEXT        NOT NULL,
  char_count  INTEGER     NOT NULL DEFAULT 0,
  embedding   VECTOR({{EMBEDDING_DIM}}),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wiki_chunks_page_index_unique UNIQUE (page_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS wiki_chunks_user_idx ON wiki_chunks (user_id);

-- ── Journey: append-only, user-visible career timeline ──────────────────────

CREATE TABLE IF NOT EXISTS journey_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  type        TEXT        NOT NULL,
  title       TEXT        NOT NULL DEFAULT '',
  description TEXT,
  data        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS journey_events_user_created_idx ON journey_events (user_id, created_at DESC);

-- ── Conversations: short-term memory, deliberately disposable ───────────────
-- Durable facts extracted from these turns are promoted into `memories`;
-- the raw turns themselves are trimmed to a rolling window.

CREATE TABLE IF NOT EXISTS conversation_turns (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role       TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversation_turns_user_created_idx ON conversation_turns (user_id, created_at DESC);

-- ── Ingest audit log ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ingest_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  input_type    TEXT        NOT NULL,
  source        TEXT        NOT NULL DEFAULT '',
  pages_created INTEGER     NOT NULL DEFAULT 0,
  summary       TEXT        NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ingest_log_user_created_idx ON ingest_log (user_id, created_at DESC);

-- Extracted entity names per ingestion, for the Ingest page history.
ALTER TABLE ingest_log ADD COLUMN IF NOT EXISTS entities JSONB NOT NULL DEFAULT '{}';
