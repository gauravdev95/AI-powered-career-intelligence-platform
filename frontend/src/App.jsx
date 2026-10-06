import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api, { aiRequest } from './lib/api.js'
import { buildGraph } from './lib/graph.js'
import ChatInterface from './components/ChatInterface.jsx'
import DetailPanel from './components/DetailPanel.jsx'
import EmptyGraphState from './components/EmptyGraphState.jsx'
import IngestPanel from './components/IngestPanel.jsx'
import JourneyView from './components/JourneyView.jsx'
import WikiPanel from './components/WikiPanel.jsx'
import LandingPage from './components/LandingPage.jsx'
import AuthScreen from './components/AuthScreen.jsx'
import MemoryBadge from './components/MemoryBadge.jsx'
import OnboardingWizard from './components/OnboardingWizard.jsx'
import ReturningScreen from './components/ReturningScreen.jsx'
import RoadmapView from './components/RoadmapView.jsx'
import Sidebar from './components/Sidebar.jsx'
import AppSidebar from './components/AppSidebar.jsx'
import AppTopBar from './components/AppTopBar.jsx'
import ComingSoon from './components/ComingSoon.jsx'
import Dashboard from './components/Dashboard.jsx'
import { Icon } from './components/icons.jsx'

const CareerGraph = lazy(() => import('./components/CareerGraph.jsx'))

/** Deepest focus trail we keep. Older hops fall off the front of the breadcrumb. */
const MAX_FOCUS_DEPTH = 6

const LOADING_STEPS = [
  'Loading your career memory...',
  'Matching your stack to startups...',
  'Connecting hackathons to your skills...',
  'Generating skill gap nodes...',
]

function classifyError(err) {
  if (!err.response) return 'network'
  const status = err.response.status
  const msg = (err.response.data?.error ?? '').toLowerCase()
  if (status === 408 || err.code === 'ECONNABORTED' || msg.includes('timeout')) return 'timeout'
  if (status === 503 || msg.includes('database') || msg.includes('memory')) return 'storage'
  return 'generic'
}

const ERROR_MESSAGES = {
  network: 'Could not connect to the backend.',
  timeout: 'AI took too long. Showing the graph with available data.',
  storage: 'Your career memory is temporarily unreachable. Nothing was lost - please retry.',
  generic: 'Something went wrong. Please try again.',
}

function LoadingScreen({ step }) {
  return (
    <main className="loading-screen">
      <section className="loading-card">
        <div className="spinner" />
        <h1 className="stack-logo loading-title">Growing your graph</h1>
        <p className="caption">{LOADING_STEPS[step] ?? LOADING_STEPS[0]}</p>
      </section>
    </main>
  )
}

function MobileTabs({ active, onChange }) {
  const tabs = [
    ['dashboard', 'Graph', 'graph'],
    ['startups', 'Startups', 'startup'],
    ['hackathons', 'Events', 'hackathon'],
    ['gaps', 'Gaps', 'gap'],
    ['ingest', 'Ingest', 'menu'],
  ]
  return (
    <nav className="mobile-tabs" aria-label="Mobile navigation">
      {tabs.map(([id, label, icon]) => (
        <button className={`mobile-tab ${active === id ? 'active' : ''}`} key={id} type="button" onClick={() => onChange(id)}>
          <Icon name={icon} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}

export default function App() {
  const [user, setUser] = useState(null) // { userId, name, email, hasPassword } | null
  const [userId, setUserId] = useState(null)
  const [userStack, setUserStack] = useState([])
  // appState: 'checking' | 'auth' | 'landing' | 'onboarding' | 'returning' | 'app'
  const [appState, setAppState] = useState('checking')
  const [waking, setWaking] = useState(true)
  const [startups, setStartups] = useState([])
  const [hackathons, setHackathons] = useState([])
  const [gapReport, setGapReport] = useState(null)
  const [returnContext, setReturnContext] = useState(null)
  const [memoryVisible, setMemoryVisible] = useState(true)
  const [loading, setLoading] = useState(false)
  const [loadingStep, setLoadingStep] = useState(0)
  const [error, setError] = useState(null)
  const [selectedNode, setSelectedNode] = useState(null)
  const [graphFilter, setGraphFilter] = useState('all')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activeMobileView, setActiveMobileView] = useState('dashboard')
  const [learnedSkills, setLearnedSkills] = useState([])
  const [rightPanel, setRightPanel] = useState(null) // 'ingest' | 'chat' | 'roadmap' | null
  const [wikiPageCount, setWikiPageCount] = useState(0)
  const [profile, setProfile] = useState(null) // full /api/user profile for the dashboard
  // Primary navigation shell. 'dashboard' is the overview; 'graph' is the career
  // graph view; panel ids open their right-side panel over the graph view;
  // anything else is a coming-soon page.
  const [navView, setNavView] = useState('dashboard')
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [chatQuery, setChatQuery] = useState(null)
  const [chatNonce, setChatNonce] = useState(0)
  const [authMode, setAuthMode] = useState('login') // which tab the gate opens on
  const returnToAppRef = useRef(false) // guest upgraded mid-session → back to app
  // The focus trail. Its last entry is the node the canvas is centred on; the
  // whole array is the breadcrumb. It is the single source of truth for "where
  // am I", which is what keeps the canvas, breadcrumb and sidebar in step.
  const [focusPath, setFocusPath] = useState(['user'])
  const focusId = focusPath[focusPath.length - 1]

  // Render cold-start: poll backend health until it responds
  useEffect(() => {
    const url = (import.meta.env.VITE_API_URL || '') + '/api/health'
    fetch(url).then(() => setWaking(false)).catch(() => setWaking(false))
  }, [])

  // A 401 from any non-auth endpoint means the session died mid-app:
  // clear local state and drop back to the sign-in gate (no redirect loop —
  // the gate itself owns the /api/auth/* 401s).
  useEffect(() => {
    const drop = () => {
      setUser(null)
      setUserId(null)
      setUserStack([])
      setReturnContext(null)
      setAuthMode('login')
      setAppState('auth')
    }
    window.addEventListener('grafted:unauthorized', drop)
    return () => window.removeEventListener('grafted:unauthorized', drop)
  }, [])

  // On mount: the session cookie tells us who is signed in — no localStorage id.
  useEffect(() => {
    api.get('/api/auth/me')
      .then(({ data }) => {
        setUser(data.user)
        setUserId(data.user.userId)
        return api.get(`/api/return-context/${data.user.userId}`)
      })
      .then(({ data }) => {
        if (data.hasHistory) {
          setReturnContext(data)
          setAppState('returning')
        } else {
          setAppState('app')
        }
      })
      .catch(() => {
        // Nobody signed in yet → show the landing page first; its
        // "Get started" button leads to the signup/login gate.
        setAppState('landing')
      })
  }, [])

  // Logo click — go home from anywhere in the app
  const handleGoHome = useCallback(() => setAppState('landing'), [])

  const PANEL_NAV_IDS = useMemo(() => ['chat', 'roadmap', 'journey', 'ingest', 'wiki'], [])

  /** Primary nav: panel ids open their right-side panel over the graph view. */
  const handleNav = useCallback(id => {
    if (PANEL_NAV_IDS.includes(id)) {
      setNavView('graph')
      setSelectedNode(null)
      setRightPanel(id)
    } else {
      setSelectedNode(null)
      setRightPanel(null)
      setNavView(id)
    }
  }, [PANEL_NAV_IDS])

  /** Dashboard → open a gap node in the career graph view. */
  const handleSelectGap = useCallback(skill => {
    setNavView('graph')
    setSelectedNode(null)
    setRightPanel(null)
    focusNode(`skill-gap:${skill}`, { openPanel: true })
  }, [focusNode])

  /** Top-bar search / AI assistant → open Career Chat, optionally with a question. */
  const openChat = useCallback(question => {
    setNavView('graph')
    setSelectedNode(null)
    setRightPanel('chat')
    if (question) {
      setChatQuery(question)
      setChatNonce(n => n + 1)
    }
  }, [])

  // Called by AuthScreen after login / signup succeeds.
  // Signup → 4-step onboarding (fresh profile). Login → straight to the dashboard.
  const handleAuthed = useCallback(async (authedUser, mode) => {
    setUser(authedUser)
    setUserId(authedUser.userId)
    if (returnToAppRef.current) {
      // Guest upgraded mid-session: memories are intact, go straight back in.
      returnToAppRef.current = false
      setAppState('app')
      return
    }
    if (mode === 'signup') {
      setAppState('onboarding') // brand-new account — build the career profile first
      return
    }
    // Login on an existing account — go straight to the dashboard.
    setAppState('app')
    try {
      const { data } = await api.get(`/api/user/${authedUser.userId}`)
      const stack = data.stack ?? []
      setUserStack(stack)
      if (stack.length > 0) {
        await loadGraphData(authedUser.userId, stack, data.experience ?? 'beginner')
      }
    } catch {
      // Just show the dashboard — the user can ingest data from there.
    }
  }, [])

  // Guest path: explore without an account; signing up later keeps everything
  const handleGuest = useCallback(() => setAppState('landing'), [])

  // Guest upgrades to a full account without leaving the app.
  // The backend upgrades the same guest user in place — memories are kept.
  const handleUpgrade = useCallback(() => {
    returnToAppRef.current = true
    setAuthMode('signup')
    setAppState('auth')
  }, [])

  // Sign out: destroy the server session, then show the landing page again
  const handleLogout = useCallback(async () => {
    try { await api.post('/api/auth/logout') } catch { /* already gone */ }
    setUser(null)
    setUserId(null)
    setUserStack([])
    setProfile(null)
    setReturnContext(null)
    setAppState('landing')
  }, [])

  // Called by OnboardingWizard after user/init succeeds
  const handleOnboardComplete = useCallback(async ({ userId: newUserId, stack, experience }) => {
    setUserId(newUserId)
    setUserStack(stack)
    setAppState('app')
    await loadGraphData(newUserId, stack, experience)
  }, [])

  // Called by ReturningScreen when user clicks Continue
  const handleReturningContinue = useCallback(async () => {
    setAppState('app')
    try {
      const { data } = await api.get(`/api/user/${userId}`)
      const stack = data.stack ?? []
      setUserStack(stack)
      if (stack.length > 0) {
        await loadGraphData(userId, stack, data.experience ?? 'beginner')
      }
    } catch {
      // Just show app with empty graph — user can ingest data
    }
  }, [userId])

  // Retry the dashboard data load after a failure (cold backend, timeout).
  // Never bounces back to onboarding — the profile is already saved.
  const handleRetryGraph = useCallback(async () => {
    if (!userId) return
    setError(null)
    try {
      const { data } = await api.get(`/api/user/${userId}`)
      await loadGraphData(userId, data.stack ?? userStack, data.experience ?? 'beginner')
    } catch {
      // loadGraphData sets the error banner itself on failure
    }
  }, [userId, userStack])

  async function loadGraphData(uid, stack, experience) {
    setLoading(true)
    setLoadingStep(0)
    setError(null)
    setSelectedNode(null)
    setFocusPath(['user'])
    setMemoryVisible(true)

    try {
      setLoadingStep(1)
      const { data: profileData } = await api.get(`/api/user/${uid}`)
      setProfile(profileData)
      const { data: analyzeData } = await api.post('/api/analyze', { userId: uid, stack, experience }, aiRequest())
      const fetchedStartups = analyzeData.startups ?? []
      setStartups(fetchedStartups)
      setLoadingStep(2)
      const { data: hackData } = await api.get(`/api/hackathons/${uid}?stack=${encodeURIComponent(stack.join(','))}`, aiRequest())
      setHackathons(hackData.ranked_hackathons ?? [])

      setLoadingStep(3)
      const topCompanies = fetchedStartups.slice(0, 5).map(s => s.name)
      const { data: gapData } = await api.post('/api/gaps', { userId: uid, stack, targetCompanies: topCompanies }, aiRequest())
      setGapReport(gapData)
    } catch (err) {
      // Stay on the dashboard and show the error banner (with retry) — never
      // bounce the user back to onboarding step 1 after they completed it.
      const kind = classifyError(err)
      setError(ERROR_MESSAGES[kind])
    } finally {
      setLoading(false)
    }
  }

  const graph = useMemo(() => buildGraph({
    userStack,
    startups,
    hackathons,
    gapReport,
    learnedSkills,
  }), [userStack, startups, hackathons, gapReport, learnedSkills])

  // A node can vanish under us — marking a gap as learned replaces `skill-gap:X`
  // with `skill-known:X`. Fall back to the profile rather than a blank canvas.
  useEffect(() => {
    setFocusPath(prev => {
      const alive = prev.filter(id => graph.nodeMap.has(id))
      if (alive.length === prev.length) return prev // no change → no re-render
      return alive.length ? alive : ['user']
    })
  }, [graph])

  /**
   * Focus a node: centre it on the canvas, open its detail, and extend or rewind
   * the breadcrumb. Re-focusing a node already in the trail rewinds to it rather
   * than appending a duplicate, so the path never loops back on itself.
   */
  const focusNode = useCallback((id, { openPanel = true } = {}) => {
    const detail = graph.nodeMap.get(id)
    if (!detail) return

    setFocusPath(prev => {
      const at = prev.indexOf(id)
      const next = at === -1 ? [...prev, id] : prev.slice(0, at + 1)
      return next.slice(-MAX_FOCUS_DEPTH)
    })
    setSelectedNode(openPanel ? detail : null)
    setRightPanel(null)
    if (detail.mobileView) setActiveMobileView(detail.mobileView)
  }, [graph.nodeMap])

  function handleMobileTab(id) {
    setActiveMobileView(id)
    if (id === 'dashboard') {
      setGraphFilter('all')
      focusNode('user')
    } else if (id === 'startups') {
      setGraphFilter('startups')
      const first = graph.startups[0]
      if (first) focusNode(`startup:${first.id}`)
    } else if (id === 'hackathons') {
      setGraphFilter('hackathons')
      const first = graph.hackathons[0]
      if (first) focusNode(`hackathon:${first.id}`)
    } else if (id === 'gaps') {
      setGraphFilter('skills')
      const first = graph.gapSkills[0]
      if (first) focusNode(`skill-gap:${first.skill}`)
    }
  }

  if (appState === 'checking') {
    return <LoadingScreen step={0} />
  }

  if (appState === 'auth') {
    return (
      <AuthScreen
        initialMode={authMode}
        onAuthed={handleAuthed}
        onGuest={handleGuest}
      />
    )
  }

  if (appState === 'landing') {
    return (
      <LandingPage
        isReturning={!!userId}
        onStart={() => {
          if (userId) {
            setAppState('onboarding') // signed in, "Start fresh" → redo the profile
          } else {
            setAuthMode('signup') // fresh visitor, "Get started" → signup/login gate
            setAppState('auth')
          }
        }}
        onContinue={handleReturningContinue}
      />
    )
  }

  if (appState === 'onboarding') {
    return <OnboardingWizard onComplete={handleOnboardComplete} waking={waking} onGoHome={handleGoHome} />
  }

  if (appState === 'returning') {
    return <ReturningScreen returnContext={returnContext} onContinue={handleReturningContinue} waking={waking} onGoHome={handleGoHome} />
  }

  if (loading) {
    return <LoadingScreen step={loadingStep} />
  }

  // Both banners share one fixed stack so a cold start and an error cannot land
  // on top of each other.
  const banners = (waking || error) && (
    <div className="app-banners">
      {waking && (
        <div className="waking-banner" role="status">
          <span className="waking-mark" aria-hidden="true">⏳</span>
          <p className="waking-copy">
            backend warming up — <strong>give it ~30 seconds</strong> on first load (Render free tier)
          </p>
        </div>
      )}
      {error && (
        <p className="app-error" role="alert">
          {error}{' '}
          <button type="button" className="app-error-retry" onClick={handleRetryGraph}>
            Try again
          </button>
        </p>
      )}
    </div>
  )

  const hasRightPanel = selectedNode || rightPanel
  const graphIsEmpty = graph.nodes.length <= 1

  const sidebarProps = {
    graph,
    focusId,
    onFocusNode: focusNode,
    userStack: graph.knownSkills,
    startups: graph.startups,
    hackathons: graph.hackathons,
    gapSkills: graph.gapSkills,
    rightPanel,
    wikiPageCount,
    onGoHome: handleGoHome,
    userName: user ? (user.name || user.email) : 'Guest',
  }

  // Which nav item reads as active: an open panel wins over the graph view.
  const activeNavId = navView !== 'graph' ? navView : (rightPanel ?? 'graph')

  return (
    <div className="shell">
      {banners}
      <AppSidebar
        active={activeNavId}
        onSelect={handleNav}
        collapsed={navCollapsed}
        onToggle={() => setNavCollapsed(c => !c)}
      />
      <div className="shell-main">
        <AppTopBar
          user={user}
          onLogout={handleLogout}
          onUpgrade={handleUpgrade}
          onSearch={openChat}
          onAIAssistant={() => openChat(null)}
          onGoHome={() => { setNavView('graph'); focusNode('user') }}
        />
        <div className="shell-content">
          {navView === 'graph' ? (
      <div className={`graph-layout ${hasRightPanel ? 'panel-open' : ''}`}>
        <Sidebar
          {...sidebarProps}
          onSetRightPanel={panel => { setRightPanel(panel); setSelectedNode(null) }}
        />

        {graphIsEmpty ? (
          <EmptyGraphState
            onIngest={() => { setRightPanel('ingest'); setSelectedNode(null) }}
            onStartups={() => setActiveMobileView('startups')}
            onHackathons={() => setActiveMobileView('hackathons')}
          />
        ) : (
          <Suspense fallback={<LoadingScreen step={0} />}>
            <CareerGraph
              graph={graph}
              focusPath={focusPath}
              onFocusNode={focusNode}
              onClearSelection={() => setSelectedNode(null)}
              filter={graphFilter}
              setFilter={setGraphFilter}
              onOpenSidebar={() => setSidebarOpen(true)}
            >
              {memoryVisible && <MemoryBadge context={returnContext} onDismiss={() => setMemoryVisible(false)} />}
            </CareerGraph>
          </Suspense>
        )}

        {/* Right panel — either node detail or a feature panel */}
        {selectedNode && !rightPanel && (
          <DetailPanel
            node={selectedNode}
            onClose={() => setSelectedNode(null)}
            startups={graph.startups}
            hackathons={graph.hackathons}
            userStack={graph.knownSkills}
            userId={userId}
            gapSkills={graph.gapSkills}
            onFocusNode={focusNode}
            onLearned={skill => {
              setLearnedSkills(prev => prev.includes(skill) ? prev : [...prev, skill])
              setSelectedNode(null)
            }}
            onSave={() => window.dispatchEvent(new CustomEvent('grafted:memory-saved'))}
          />
        )}

        {rightPanel === 'ingest' && (
          <aside className="detail-panel">
            <div className="panel-header">
              <div className="panel-title-wrap">
                <span className="node-type-badge skill_known">Wiki</span>
                <span className="panel-title">Feed your wiki</span>
              </div>
              <button className="panel-close" type="button" onClick={() => setRightPanel(null)} aria-label="Close">×</button>
            </div>
            <IngestPanel
              userId={userId}
              onPagesCreated={pages => setWikiPageCount(prev => prev + pages.length)}
            />
          </aside>
        )}

        {rightPanel === 'chat' && (
          <aside className="detail-panel">
            <div className="panel-header">
              <div className="panel-title-wrap">
                <span className="node-type-badge hackathon">AI</span>
                <span className="panel-title">Career Chat</span>
              </div>
              <button className="panel-close" type="button" onClick={() => setRightPanel(null)} aria-label="Close">×</button>
            </div>
            <ChatInterface
              key={chatNonce}
              userId={userId}
              userStack={graph.knownSkills}
              wikiPageCount={wikiPageCount}
              initialQuery={chatQuery}
            />
          </aside>
        )}

        {rightPanel === 'roadmap' && (
          <aside className="detail-panel">
            <div className="panel-header">
              <div className="panel-title-wrap">
                <span className="node-type-badge startup">Plan</span>
                <span className="panel-title">Learning Roadmap</span>
              </div>
              <button className="panel-close" type="button" onClick={() => setRightPanel(null)} aria-label="Close">×</button>
            </div>
            <RoadmapView userId={userId} />
          </aside>
        )}

        {rightPanel === 'journey' && (
          <aside className="detail-panel">
            <div className="panel-header">
              <div className="panel-title-wrap">
                <span className="node-type-badge skill_known">Log</span>
                <span className="panel-title">My Journey</span>
              </div>
              <button className="panel-close" type="button" onClick={() => setRightPanel(null)} aria-label="Close">×</button>
            </div>
            <JourneyView userId={userId} />
          </aside>
        )}

        {rightPanel === 'wiki' && (
          <aside className="detail-panel">
            <div className="panel-header">
              <div className="panel-title-wrap">
                <span className="node-type-badge hackathon">Wiki</span>
                <span className="panel-title">Wiki Browser</span>
              </div>
              <button className="panel-close" type="button" onClick={() => setRightPanel(null)} aria-label="Close">×</button>
            </div>
            <WikiPanel userId={userId} />
          </aside>
        )}
      </div>
          ) : navView === 'dashboard' ? (
            <Dashboard
              user={user}
              profile={profile}
              graph={graph}
              onNavigate={handleNav}
              onOpenChat={openChat}
              onRunAnalysis={handleRetryGraph}
              onSelectGap={handleSelectGap}
            />
          ) : (
            <ComingSoon page={navView} onBack={() => setNavView('graph')} />
          )}
        </div>
      </div>

      <MobileTabs active={activeMobileView} onChange={handleMobileTab} />

      {sidebarOpen && (
        <>
          <button className="overlay-scrim" type="button" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar" />
          <div className="sidebar-overlay">
            <Sidebar
              {...sidebarProps}
              onFocusNode={id => { focusNode(id); setSidebarOpen(false) }}
              onSetRightPanel={panel => { setRightPanel(panel); setSelectedNode(null); setSidebarOpen(false) }}
            />
          </div>
        </>
      )}
    </div>
  )
}
