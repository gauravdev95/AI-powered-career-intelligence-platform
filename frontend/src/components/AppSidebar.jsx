import { useEffect, useRef, useState } from 'react'
import logo from '../assets/logo.png'
import { Icon } from './icons.jsx'

const MAIN_NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'home' },
  { id: 'graph', label: 'Career Graph', icon: 'graph' },
  { id: 'chat', label: 'Chat (AI)', icon: 'chat', dot: true },
  { id: 'roadmap', label: 'Roadmap', icon: 'roadmap' },
  { id: 'journey', label: 'Journey', icon: 'journey' },
  { id: 'ingest', label: 'Ingest', icon: 'ingest' },
  { id: 'wiki', label: 'Wiki', icon: 'wiki' },
]

const TOOL_NAV = [
  { id: 'job-match', label: 'Job Match', icon: 'briefcase' },
  { id: 'skill-gaps', label: 'Skill Gaps', icon: 'target' },
  { id: 'resume-helper', label: 'Resume Helper', icon: 'resume' },
  { id: 'interview-prep', label: 'Interview Prep', icon: 'interview' },
]

const SYSTEM_NAV = [
  { id: 'settings', label: 'Settings', icon: 'settings' },
  { id: 'help', label: 'Help & Feedback', icon: 'help' },
]

function NavItem({ item, active, collapsed, onSelect }) {
  return (
    <button
      type="button"
      className={`appnav-item ${active ? 'is-active' : ''}`}
      onClick={() => onSelect(item.id)}
      title={collapsed ? item.label : undefined}
      aria-current={active ? 'page' : undefined}
    >
      <span className="appnav-icon" aria-hidden="true">
        <Icon name={item.icon} className="appnav-svg" />
        {item.dot && <span className="appnav-dot" aria-hidden="true" />}
      </span>
      {!collapsed && <span className="appnav-label">{item.label}</span>}
    </button>
  )
}

/**
 * Primary app navigation — dark navy rail matching the product design.
 * Expanded: logo + full labels. Collapsed: logo only (click it to expand).
 * Drawer: mobile slide-in variant (<=767px), rendered when `drawer` is true.
 */
export default function AppSidebar({ active, onSelect, collapsed, onToggle, drawer, onCloseDrawer }) {
  const [toolsOpen, setToolsOpen] = useState(true)
  const [entered, setEntered] = useState(false)
  const drawerRef = useRef(null)

  useEffect(() => {
    if (!drawer) { setEntered(false); return }
    // Two RAFs so the slide-in transition runs after first paint.
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)))
    if (drawerRef.current) drawerRef.current.focus({ preventScroll: true })
    return () => cancelAnimationFrame(raf)
  }, [drawer])

  if (drawer) {
    return (
      <aside
        ref={drawerRef}
        className={`appnav appnav--drawer ${entered ? 'is-open' : ''}`}
        aria-label="Primary"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
      >
        <div className="appnav-brand">
          <img src={logo} alt="Grafted logo" className="appnav-logo-img" />
          <span className="appnav-word">Grafted</span>
          <button type="button" className="appnav-collapse" onClick={onCloseDrawer} title="Close navigation" aria-label="Close navigation">
            <Icon name="x" className="appnav-svg-sm" />
          </button>
        </div>

        <nav className="appnav-scroll">
          <div className="appnav-group">
            {MAIN_NAV.map(item => (
              <NavItem key={item.id} item={item} active={active === item.id} collapsed={false} onSelect={onSelect} />
            ))}
          </div>

          <div className="appnav-group">
            <button
              type="button"
              className="appnav-section-toggle"
              onClick={() => setToolsOpen(o => !o)}
              aria-expanded={toolsOpen}
            >
              <span>Tools</span>
              <Icon name="chevron-down" className={`appnav-svg-sm ${toolsOpen ? 'is-open' : ''}`} />
            </button>
            {toolsOpen && TOOL_NAV.map(item => (
              <NavItem key={item.id} item={item} active={active === item.id} collapsed={false} onSelect={onSelect} />
            ))}
          </div>

          <div className="appnav-group">
            {SYSTEM_NAV.map(item => (
              <NavItem key={item.id} item={item} active={active === item.id} collapsed={false} onSelect={onSelect} />
            ))}
          </div>
        </nav>

        <div className="appnav-upgrade">
          <span className="appnav-upgrade-icon" aria-hidden="true"><Icon name="crown" className="appnav-svg" /></span>
          <span className="appnav-upgrade-text">
            <strong>Upgrade to Pro</strong>
            <small>Unlock advanced AI insights, more matches and unlimited memory.</small>
          </span>
          <span className="appnav-upgrade-arrow" aria-hidden="true">›</span>
        </div>
      </aside>
    )
  }

  if (collapsed) {
    return (
      <aside className="appnav appnav--collapsed" aria-label="Primary">
        <button type="button" className="appnav-logo-only" onClick={onToggle} title="Expand navigation" aria-label="Expand navigation">
          <img src={logo} alt="Grafted" className="appnav-logo-img" />
        </button>
      </aside>
    )
  }

  return (
    <aside className="appnav" aria-label="Primary">
      <div className="appnav-brand">
        <img src={logo} alt="Grafted logo" className="appnav-logo-img" />
        <span className="appnav-word">Grafted</span>
        <button type="button" className="appnav-collapse" onClick={onToggle} title="Hide navigation" aria-label="Hide navigation">
          <Icon name="chevron-left" className="appnav-svg-sm" />
        </button>
      </div>

      <nav className="appnav-scroll">
        <div className="appnav-group">
          {MAIN_NAV.map(item => (
            <NavItem key={item.id} item={item} active={active === item.id} collapsed={false} onSelect={onSelect} />
          ))}
        </div>

        <div className="appnav-group">
          <button
            type="button"
            className="appnav-section-toggle"
            onClick={() => setToolsOpen(o => !o)}
            aria-expanded={toolsOpen}
          >
            <span>Tools</span>
            <Icon name="chevron-down" className={`appnav-svg-sm ${toolsOpen ? 'is-open' : ''}`} />
          </button>
          {toolsOpen && TOOL_NAV.map(item => (
            <NavItem key={item.id} item={item} active={active === item.id} collapsed={false} onSelect={onSelect} />
          ))}
        </div>

        <div className="appnav-group">
          {SYSTEM_NAV.map(item => (
            <NavItem key={item.id} item={item} active={active === item.id} collapsed={false} onSelect={onSelect} />
          ))}
        </div>
      </nav>

      <div className="appnav-upgrade">
        <span className="appnav-upgrade-icon" aria-hidden="true"><Icon name="crown" className="appnav-svg" /></span>
        <span className="appnav-upgrade-text">
          <strong>Upgrade to Pro</strong>
          <small>Unlock advanced AI insights, more matches and unlimited memory.</small>
        </span>
        <span className="appnav-upgrade-arrow" aria-hidden="true">›</span>
      </div>
    </aside>
  )
}
