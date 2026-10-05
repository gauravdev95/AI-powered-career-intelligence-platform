import { useState, useEffect, useRef } from 'react'
import { useTheme } from '../hooks/useTheme.js'

/**
 * Compact theme picker: a single row showing the active theme's dots.
 * Clicking opens a small popover with the three themes.
 */
export default function ThemeSwitcher() {
  const { theme, setTheme, themes } = useTheme()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const active = themes[theme] ?? Object.values(themes)[0]

  useEffect(() => {
    if (!open) return undefined
    const close = event => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [open])

  return (
    <div className="theme-picker" ref={wrapRef}>
      <button
        type="button"
        className="theme-picker-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        title={`Theme: ${active.label}`}
      >
        <span className="theme-dots" aria-hidden="true">
          {active.preview.map((color, i) => (
            <span key={i} className="theme-dot" style={{ background: color }} />
          ))}
        </span>
        <span className="theme-picker-label">{active.label}</span>
      </button>
      {open && (
        <div className="theme-popover" role="listbox" aria-label="Theme">
          {Object.values(themes).map(t => (
            <button
              key={t.id}
              type="button"
              role="option"
              aria-selected={theme === t.id}
              className={`theme-option ${theme === t.id ? 'is-active' : ''}`}
              onClick={() => { setTheme(t.id); setOpen(false) }}
            >
              <span className="theme-dots" aria-hidden="true">
                {t.preview.map((color, i) => (
                  <span key={i} className="theme-dot" style={{ background: color }} />
                ))}
              </span>
              <span className="theme-option-label">{t.label}</span>
              {theme === t.id && <span className="theme-check" aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
