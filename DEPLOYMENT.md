# DevRadar Production Deployment

## Local Development

1. Install dependencies:
   ```bash
   cd backend && npm ci
   cd ../frontend && npm ci
   ```
2. Configure environment:
   ```bash
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env.local
   ```
3. Start both apps:
   ```bash
   cd backend && npm run dev
   cd frontend && npm run dev
   ```

Frontend: `http://localhost:5173`
Backend: `http://localhost:3001/api/health`

## Backend: Render or Railway

Root directory: `backend`

Build command:
```bash
npm ci
```

Start command:
```bash
npm start
```

Required production variables:
```bash
NODE_ENV=production
PORT=3001
CORS_ORIGIN=https://your-frontend.vercel.app
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=120
GROQ_API_KEY=...
ANTHROPIC_API_KEY=...
HYDRADB_API_KEY=...
HYDRADB_PROJECT_ID=...
```

## Frontend: Vercel

Root directory: `frontend`

Build command:
```bash
npm run build
```

Output directory:
```bash
dist
```

Required production variables:
```bash
VITE_API_URL=https://your-backend.onrender.com
VITE_API_TIMEOUT_MS=30000
```

## Production Checklist

- Backend `/api/health` returns `status: ok`.
- `CORS_ORIGIN` contains only your Vercel production and preview origins.
- HydraDB keys are set for persistent memory.
- At least one AI key is configured. Groq is preferred; Anthropic is fallback.
- Frontend build passes with `npm run build`.
- Backend syntax check passes with `npm run build`.
- No real secrets are committed to Git.
