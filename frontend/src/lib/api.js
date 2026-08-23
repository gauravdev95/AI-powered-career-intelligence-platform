import axios from 'axios'

const DEFAULT_API_URL = 'https://ai-powered-career-intelligence-platform-9bdm.onrender.com'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || DEFAULT_API_URL,
  timeout: Number(import.meta.env.VITE_API_TIMEOUT_MS) || 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

/**
 * Timeout for routes that wait on a model round-trip: ingest, chat and roadmap.
 *
 * The 30s default is right for CRUD but wrong for these — a measured job-description
 * ingest takes ~18s and a roadmap ~11s, so a slightly longer paste blows the budget.
 * That failure is the bad kind: the request aborts in the browser while the server
 * finishes and commits the memories, so the user sees an error for work that
 * actually succeeded, and a retry duplicates it.
 */
export const AI_TIMEOUT_MS = Number(import.meta.env.VITE_AI_TIMEOUT_MS) || 90000

/** Request config for an AI-backed call. */
export const aiRequest = (extra = {}) => ({ timeout: AI_TIMEOUT_MS, ...extra })

api.interceptors.response.use(
  response => response,
  error => {
    const message = error.response?.data?.error
      || error.response?.data?.message
      || (error.code === 'ECONNABORTED' ? 'Request timed out. Please try again.' : error.message)

    error.appMessage = message || 'Something went wrong. Please try again.'
    return Promise.reject(error)
  },
)

export default api
