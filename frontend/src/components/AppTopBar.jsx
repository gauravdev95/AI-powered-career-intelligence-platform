import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons.jsx'

/**
 * Top navigation bar: global search, AI Assistant shortcut, notifications,
 * and the user chip with an account dropdown menu.
 */
export default function AppTopBar({ user, onLogout, onUpgrade, onSearch, onAIAssistant, onGoHome }) {
  const [query, setQuery] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [bellOpen, setBellOpen] = useState(false)
  const menuRef = useRef(null)
  const bellRef = useRef(null)

  const displayName = user ? (user.name || user.email) : 'Guest'
  const plan = user ? 'Free Plan' : 'Guest'
  const initial = (displayName.trim()[0] || 'G').toUpperCase()

  useEffect(() => {
    const close = event => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false)
      if (bellRef.current && !bellRef.current.contains(event.target)) setBellOpen(false)
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  function submitSearch(event) {
    event.preventDefault()
    const q = query.trim()
    if (!q) return
    setQuery('')
    onSearch(q)
  }

  return (
    <header className="apptop">
      <form className="apptop-search" onSubmit={submitSearch} role="search">
        <Icon name="search" className="apptop-search-icon" />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Ask anything about your career..."
          aria-label="Ask anything about your career"
        />
        <button type="submit" className="apptop-search-go" aria-label="Search">
          <Icon name="search" className="apptop-svg-sm" />
        </button>
      </form>

      <div className="apptop-actions">
        <button type="button" className="apptop-ai" onClick={onAIAssistant}>
          <Icon name="sparkles" className="apptop-svg-sm" />
          <span>AI Assistant</span>
        </button>

        <div className="apptop-bellwrap" ref={bellRef}>
          <button
            type="button"
            className="apptop-iconbtn"
            onClick={() => setBellOpen(o => !o)}
            aria-label="Notifications"
            aria-expanded={bellOpen}
          >
            <Icon name="bell" className="apptop-svg" />
            <span className="apptop-bell-dot" aria-hidden="true" />
          </button>
          {bellOpen && (
            <div className="apptop-popover" role="status">
              <p className="apptop-popover-title">Notifications</p>
              <p className="apptop-popover-empty">You're all caught up.</p>
            </div>
          )}
        </div>

        <div className="apptop-userwrap" ref={menuRef}>
          <button
            type="button"
            className="apptop-user"
            onClick={() => setMenuOpen(o => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <span className="apptop-avatar" aria-hidden="true">{initial}</span>
            <span className="apptop-usertext">
              <strong>{displayName}</strong>
              <small className={user ? 'is-free' : ''}>{plan}</small>
            </span>
            <Icon name="chevron-down" className="apptop-svg-sm" />
          </button>
          {menuOpen && (
            <div className="apptop-popover apptop-menu" role="menu">
              <p className="apptop-menu-name">{displayName}</p>
              {user?.email && <p className="apptop-menu-email">{user.email}</p>}
              {!user && <p className="apptop-menu-email">Guest — memory lives in this browser</p>}
              {user ? (
                <>
                  <button type="button" className="apptop-menu-btn" onClick={() => { setMenuOpen(false); onGoHome() }}>
                    My profile
                  </button>
                  <button type="button" className="apptop-menu-btn" onClick={() => { setMenuOpen(false); onLogout() }}>
                    Log out
                  </button>
                </>
              ) : (
                <button type="button" className="apptop-menu-btn accent" onClick={() => { setMenuOpen(false); onUpgrade() }}>
                  Create account
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
