import { useState } from 'react'
import api from '../lib/api.js'

/**
 * Grafted sign-in screen. Session cookie is httpOnly — this component never
 * touches it; it only reports the authenticated user upward.
 *
 * Modes: 'login' | 'signup'. onAuthed(user, mode) on success, onGuest() when the
 * user wants to try the product before creating an account.
 */
export default function AuthScreen({ onAuthed, onGuest, initialMode = 'login' }) {
  const [mode, setMode] = useState(initialMode)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const path = mode === 'login' ? '/api/auth/login' : '/api/auth/signup'
      const payload = mode === 'login'
        ? { email, password }
        : { email, password, name: name.trim() || undefined }
      const { data } = await api.post(path, payload)
      onAuthed(data.user, mode)
    } catch (err) {
      setError(err.appMessage ?? 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const switchMode = (next) => {
    setMode(next)
    setError('')
  }

  return (
    <div className="auth-screen">
      <div className="auth-card" role="dialog" aria-label={mode === 'login' ? 'Log in' : 'Create account'}>
        <p className="auth-kicker">Grafted</p>
        <h1 className="auth-title">
          {mode === 'login' ? 'Welcome back.' : 'Your career, remembered.'}
        </h1>
        <p className="auth-sub">
          {mode === 'login'
            ? 'Pick up exactly where your memory left off.'
            : 'One account holds your whole career memory — across every device.'}
        </p>

        <div className="auth-tabs" role="tablist">
          {['login', 'signup'].map(m => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={`auth-tab${mode === m ? ' active' : ''}`}
              onClick={() => switchMode(m)}
            >
              {m === 'login' ? 'Log in' : 'Sign up'}
            </button>
          ))}
        </div>

        <form className="auth-form" onSubmit={submit}>
          {mode === 'signup' && (
            <label className="auth-field">
              <span>Name</span>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Ada Lovelace"
                autoComplete="name"
              />
            </label>
          )}
          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              required
              minLength={mode === 'signup' ? 8 : 1}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>

          {error && <p className="auth-error" role="alert">{error}</p>}

          <button type="submit" className="auth-submit" disabled={busy}>
            {busy ? 'Working…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>

        <button type="button" className="auth-guest" onClick={onGuest}>
          Continue as guest — no account needed
        </button>
        <p className="auth-note">
          Guest memories live in this browser session. Sign up anytime and they
          carry over into your account.
        </p>
      </div>
    </div>
  )
}
