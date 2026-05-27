import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  timeout: Number(import.meta.env.VITE_API_TIMEOUT_MS) || 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

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
