# Deployment

Backend on Render (with managed PostgreSQL), frontend on Vercel.

---

## 1. Backend — Render

### Option A: Blueprint (recommended)

[`backend/render.yaml`](backend/render.yaml) declares the web service **and** the
PostgreSQL database together, so `DATABASE_URL` is wired automatically.

1. Push the repository to GitHub.
2. Render → **New** → **Blueprint** → select the repo.
3. Set the two secrets Render cannot infer:
   - `GEMINI_API_KEY` — your key (optional; the app runs without it)
   - `CORS_ORIGIN` — your Vercel URL, e.g. `https://grafted.vercel.app`
4. Deploy. The schema is applied automatically on first boot
   (`DATABASE_AUTO_MIGRATE=true`), including `CREATE EXTENSION vector`.

### Option B: Manual

1. Create a **PostgreSQL** instance (region: Singapore for Indian users). Render's
   PostgreSQL ships pgvector; so do Supabase, Neon and RDS.
2. Create a **Web Service**:
   - Root directory: `backend`
   - Build: `npm ci --omit=dev`
   - Start: `npm start`
   - Health check path: `/api/health`
3. Environment variables:

   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | the internal connection string |
   | `DATABASE_SSL` | `true` |
   | `CORS_ORIGIN` | your frontend URL |
   | `GEMINI_API_KEY` | your key (optional) |
   | `GEMINI_MODEL` | `gemini-3-flash-preview` |
   | `EMBEDDING_DIMENSIONS` | `768` |
   | `REDIS_URL` | optional |

### Verify

```bash
curl https://your-api.onrender.com/api/health
```

Expected:

```json
{
  "status": "ok",
  "database": { "connected": true, "driver": "pg", "persistent": true },
  "ai": { "provider": "gemini", "available": true }
}
```

`"driver": "pg"` and `"persistent": true` are the two fields that matter — they
confirm memory will survive restarts. The service refuses to start in production with
any other driver.

---

## 2. Frontend — Vercel

1. Vercel → **New Project** → import the repo.
2. Root directory: `frontend`. Framework preset (Vite), build command and output
   directory are already declared in [`frontend/vercel.json`](frontend/vercel.json).
3. Environment variable:

   | Key | Value |
   |---|---|
   | `VITE_API_URL` | `https://your-api.onrender.com` |

4. Deploy, then set that URL as `CORS_ORIGIN` on the backend and redeploy it.

Preview deployments on `*.vercel.app` are accepted by default; set
`CORS_ALLOW_VERCEL_PREVIEWS=false` to require an exact origin match.

---

## 3. Database operations

```bash
cd backend

npm run db:migrate     # apply schema (idempotent, safe to re-run)
npm run db:reset       # DROP every table, then re-apply — destructive
```

Migration is idempotent and runs on every boot by default. Set
`DATABASE_AUTO_MIGRATE=false` to make it an explicit deploy step instead.

### Changing the embedding model

`EMBEDDING_DIMENSIONS` must match the `vector(N)` column width. Changing it after
data exists would silently break every vector search, so `migrate.js` **refuses to
start** and tells you what to do. To change models deliberately:

```bash
# 1. Set the new GEMINI_EMBEDDING_MODEL and EMBEDDING_DIMENSIONS
# 2. Rebuild the schema (destroys stored memory — no partial path exists)
npm run db:reset
```

---

## 4. Free-tier behaviour

Render's free web services sleep after ~15 minutes idle and take ~30 seconds to wake.
The frontend already shows a "backend warming up" banner for this.

**This no longer costs data.** Under v1 a sleep or restart erased every profile, wiki
page and journey event, because storage was a process-local `Map`. Memory now lives in
PostgreSQL, so a cold start is a latency event only.

Free-tier PostgreSQL on Render expires after 90 days — set a reminder to upgrade or
migrate before then.

---

## 5. Production checklist

- [ ] `NODE_ENV=production` (rejects the in-process database driver outright)
- [ ] `DATABASE_URL` set and `DATABASE_SSL=true`
- [ ] `CORS_ORIGIN` set to the exact frontend origin
- [ ] `GEMINI_MODEL` verified against Google's current model list
- [ ] `/api/health` reports `"persistent": true`
- [ ] `INGEST_ALLOWED_HOSTS` set if users only ingest from known job boards — the
      strongest available SSRF control
- [ ] `INGEST_ALLOW_PRIVATE_NETWORK` unset (force-disabled in production regardless)
- [ ] `REDIS_URL` set if running more than one instance, so they share the embedding
      cache instead of each re-embedding the same text
- [ ] `AI_RATE_LIMIT_MAX` sized to your Gemini quota

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `DATABASE_URL is required` at boot | No database configured | Set `DATABASE_URL` |
| `DATABASE_DRIVER must be "pg" in production` | Dev driver in production | Set `DATABASE_URL`; unset `DATABASE_DRIVER` |
| `extension "vector" is not available` | Provider lacks pgvector | Use Render/Supabase/Neon Postgres, or install the extension |
| `memories.embedding is vector(N) but EMBEDDING_DIMENSIONS=M` | Embedding model changed | See §3 |
| Health shows `"available": false` | No `GEMINI_API_KEY` | Set it — everything else still works |
| CORS errors in the browser | Origin mismatch | Add the exact frontend origin to `CORS_ORIGIN` |
| `AI rate limit reached` | Gemini quota | Lower `AI_RATE_LIMIT_MAX` or raise the quota |
| URL ingest returns `BLOCKED_URL` | Target resolves to a private range | Working as intended; paste the text instead |
| URL ingest returns `EMPTY_PAGE` | JavaScript-rendered page | Paste the job description text |
