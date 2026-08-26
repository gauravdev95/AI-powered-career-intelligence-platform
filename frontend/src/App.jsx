import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api from './lib/api.js'
import { buildGraph } from './lib/graph.js'
import ChatInterface from './components/ChatInterface.jsx'
import DetailPanel from './components/DetailPanel.jsx'
import EmptyGraphState from './components/EmptyGraphState.jsx'
import IngestPanel from './components/IngestPanel.jsx'
import JourneyView from './components/JourneyView.jsx'
import WikiPanel from './components/WikiPanel.jsx'
import LandingPage from './components/LandingPage.jsx'
import MemoryBadge from './components/MemoryBadge.jsx'
import OnboardingWizard from './components/OnboardingWizard.jsx'
import ReturningScreen from './components/ReturningScreen.jsx'
import RoadmapView from './components/RoadmapView.jsx'
import Sidebar from './components/Sidebar.jsx'
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
  const [userId, setUserId] = useState(null)
  const [userStack, setUserStack] = useState([])
  // appState: 'checking' | 'landing' | 'onboarding' | 'returning' | 'app'
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
  // The focus trail. Its last entry is the node the canvas is centred on; the
  // whole array is the breadcrumb. It is the single source of truth for "where
  // am I", which is what keeps the canvas, breadcrumb and sidebar in step.
  const [focusPath, setFocusPath] = useState(['user'])
  const dashboardRevealedRef = useRef(false)

  const focusId = focusPath[focusPath.length - 1]

  // Render cold-start: poll backend health until it responds
  useEffect(() => {
    const url = (import.meta.env.VITE_API_URL || '') + '/api/health'
    fetch(url).then(() => setWaking(false)).catch(() => setWaking(false))
  }, [])

  // On mount: check for existing user → route to correct screen
  useEffect(() => {
    // Support old and new localStorage keys during migration
    const savedId = localStorage.getItem('grafted_userId')
      || localStorage.getItem('devradar_userId')
      || localStorage.getItem('devradar_user_id')
    if (!savedId) {
      setAppState('landing')
      return
    }
    // Migrate old keys → new key and clean up
    localStorage.setItem('grafted_userId', savedId)
    localStorage.removeItem('devradar_userId')
    localStorage.removeItem('devradar_user_id')
    setUserId(savedId)
    api.get(`/api/return-context/${savedId}`)
      .then(({ data }) => {
        if (data.hasHistory) {
          setReturnContext(data)
          setAppState('returning')
        } else {
          setAppState('app')
        }
      })
      .catch(() => {
        setAppState('app')
      })
  }, [])

  // Logo click — go home from anywhere in the app
  const handleGoHome = useCallback(() => setAppState('landing'), [])

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

  async function loadGraphData(uid, stack, experience) {
    dashboardRevealedRef.current = false
    setLoading(true)
    setLoadingStep(0)
    setError(null)
    setSelectedNode(null)
    setFocusPath(['user'])
    setMemoryVisible(true)

    try {
      setLoadingStep(1)
      const { data: analyzeData } = await api.post('/api/analyze', { userId: uid, stack, experience })
      const fetchedStartups = analyzeData.startups ?? []
      setStartups(fetchedStartups)
      dashboardRevealedRef.current = true

      setLoadingStep(2)
      const { data: hackData } = await api.get(`/api/hackathons/${uid}?stack=${encodeURIComponent(stack.join(','))}`)
      setHackathons(hackData.ranked_hackathons ?? [])

      setLoadingStep(3)
      const topCompanies = fetchedStartups.slice(0, 5).map(s => s.name)
      const { data: gapData } = await api.post('/api/gaps', { userId: uid, stack, targetCompanies: topCompanies })
      setGapReport(gapData)
    } catch (err) {
      const kind = classifyError(err)
      setError(ERROR_MESSAGES[kind])
      if (!dashboardRevealedRef.current) setAppState('onboarding')
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

  if (appState === 'landing') {
    return (
      <LandingPage
        isReturning={!!userId}
        onStart={() => setAppState('onboarding')}
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
      {error && <p className="app-error" role="alert">{error}</p>}
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
  }

  return (
    <div className="app-shell">
      {banners}
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
              userId={userId}
              userStack={graph.knownSkills}
              wikiPageCount={wikiPageCount}
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
