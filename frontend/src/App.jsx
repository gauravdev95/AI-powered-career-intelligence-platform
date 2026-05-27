import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from './lib/api.js'
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

const API_BASE = import.meta.env.VITE_API_URL || ''
const CareerGraph = lazy(() => import('./components/CareerGraph.jsx'))

const LOADING_STEPS = [
  'HydraDB is preparing your profile...',
  'Matching your stack to startups...',
  'Connecting hackathons to your skills...',
  'Generating skill gap nodes...',
]

function classifyError(err) {
  if (!err.response) return 'network'
  const status = err.response.status
  const msg = (err.response.data?.error ?? '').toLowerCase()
  if (status === 408 || err.code === 'ECONNABORTED' || msg.includes('timeout')) return 'timeout'
  if (msg.includes('hydra') || msg.includes('memory') || status === 503) return 'hydradb'
  return 'generic'
}

const ERROR_MESSAGES = {
  network: 'Could not connect to the backend.',
  timeout: 'AI took too long. Showing the graph with available data.',
  hydradb: 'Memory is temporarily unavailable. Running in local mode.',
  generic: 'Something went wrong. Please try again.',
}

function norm(value) {
  return String(value ?? '').toLowerCase().trim()
}

function isSameSkill(a, b) {
  const left = norm(a)
  const right = norm(b)
  return left === right || left.includes(right) || right.includes(left)
}

function cleanId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '-')
}

function buildGraph({ userStack, startups, hackathons, gapReport, learnedSkills }) {
  const knownSkills = Array.from(new Set([...(userStack.length ? userStack : ['React', 'Node.js', 'Python']), ...learnedSkills]))
  const knownSet = knownSkills.map(norm)
  const rawGaps = gapReport?.priority_skills?.length
    ? gapReport.priority_skills
    : inferGaps(startups, knownSkills)
  const gapSkills = rawGaps.filter(item => !knownSet.some(skill => isSameSkill(skill, item.skill)))

  const nodes = []
  const edges = []
  const nodeDetails = []
  const nodeMap = new Map()

  function addNode(node, detail) {
    nodes.push(node)
    nodeDetails.push(detail)
    nodeMap.set(node.id, detail)
  }

  addNode({
    id: 'user',
    label: 'You',
    group: 'user',
    title: 'Your DevRadar career profile',
  }, {
    id: 'user',
    type: 'user',
    label: 'Your Profile',
    icon: 'user',
    mobileView: 'dashboard',
    raw: { stack: knownSkills },
  })

  knownSkills.forEach(skill => {
    const id = `skill-known:${skill}`
    addNode({
      id,
      label: skill,
      group: 'skill_known',
      title: `${skill}<br>Known skill in your stack`,
    }, {
      id,
      type: 'skill_known',
      label: skill,
      icon: 'skill',
      mobileView: 'gaps',
      raw: { skill },
    })
    edges.push({ from: 'user', to: id, color: { color: '#d4f53c', opacity: 0.45 }, width: 1.5 })
  })

  gapSkills.forEach(item => {
    const id = `skill-gap:${item.skill}`
    addNode({
      id,
      label: item.skill,
      group: 'skill_gap',
      title: `${item.skill}<br>Skill gap to close`,
    }, {
      id,
      type: 'skill_gap',
      label: item.skill,
      icon: 'gap',
      mobileView: 'gaps',
      raw: item,
    })
    edges.push({ from: 'user', to: id, dashes: true, color: { color: '#e08080', opacity: 0.4 }, width: 1.2 })
  })

  startups.forEach(startup => {
    const score = startup.claude_analysis?.match_percentage ?? startup.match_score ?? 0
    const id = `startup:${startup.id}`
    addNode({
      id,
      label: startup.name,
      group: 'startup',
      title: `${startup.name}<br>${score}% match · ${startup.type}`,
    }, {
      id,
      type: 'startup',
      label: startup.name,
      icon: 'startup',
      score,
      mobileView: 'startups',
      raw: startup,
    })

    knownSkills.forEach(skill => {
      if (startup.skills_required?.some(required => isSameSkill(required, skill))) {
        edges.push({ from: `skill-known:${skill}`, to: id, color: { color: '#d4f53c', opacity: 0.35 } })
      }
    })
    gapSkills.forEach(gap => {
      if (startup.skills_required?.some(required => isSameSkill(required, gap.skill))) {
        edges.push({ from: `skill-gap:${gap.skill}`, to: id, dashes: true, color: { color: '#e08080', opacity: 0.30 } })
      }
    })
  })

  hackathons.forEach(hackathon => {
    const id = `hackathon:${hackathon.id}`
    addNode({
      id,
      label: hackathon.name,
      group: 'hackathon',
      title: `${hackathon.name}<br>${hackathon.match_score ?? 0}% match · ${hackathon.platform}`,
    }, {
      id,
      type: 'hackathon',
      label: hackathon.name,
      icon: 'hackathon',
      score: hackathon.match_score ?? 0,
      mobileView: 'hackathons',
      raw: {
        ...hackathon,
        matchedSkills: (hackathon.skills_relevant ?? []).filter(skill => knownSkills.some(known => isSameSkill(known, skill))),
      },
    })

    ;(hackathon.skills_relevant ?? []).forEach(skill => {
      const known = knownSkills.find(item => isSameSkill(item, skill))
      if (known) edges.push({ from: `skill-known:${known}`, to: id, color: { color: '#c4a0f4', opacity: 0.40 } })
      const gap = gapSkills.find(item => isSameSkill(item.skill, skill))
      if (gap) edges.push({ from: `skill-gap:${gap.skill}`, to: id, color: { color: '#e08080', opacity: 0.30 }, dashes: true })
    })
  })

  return { nodes, edges: dedupeEdges(edges), nodeDetails, nodeMap, gapSkills, knownSkills }
}

function dedupeEdges(edges) {
  const seen = new Set()
  return edges.filter(edge => {
    const key = `${edge.from}->${edge.to}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).map((edge, index) => ({ id: `edge:${index}:${cleanId(edge.from)}:${cleanId(edge.to)}`, ...edge }))
}

function inferGaps(startups, stack) {
  const counts = new Map()
  startups.slice(0, 8).forEach(startup => {
    ;(startup.skills_required ?? []).forEach(skill => {
      if (stack.some(known => isSameSkill(known, skill))) return
      counts.set(skill, (counts.get(skill) ?? 0) + 1)
    })
  })
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([skill, count]) => ({
      skill,
      why: `Required by ${count} matching companies`,
      time_weeks: count > 2 ? 2 : 1,
      difficulty: 'Beginner friendly',
      resource: `https://www.google.com/search?q=learn+${encodeURIComponent(skill)}`,
      salary_impact: '+10-15%',
    }))
}

function LoadingScreen({ step }) {
  return (
    <main className="loading-screen">
      <section className="loading-card">
        <div className="spinner" />
        <h1 className="stack-logo" style={{ marginBottom: 8 }}>Generating your graph</h1>
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
  const dashboardRevealedRef = useRef(false)

  // Render cold-start: poll backend health until it responds
  useEffect(() => {
    const url = (import.meta.env.VITE_API_URL || '') + '/api/health'
    fetch(url).then(() => setWaking(false)).catch(() => setWaking(false))
  }, [])

  // On mount: check for existing user → route to correct screen
  useEffect(() => {
    // Support both old and new localStorage key during migration
    const savedId = localStorage.getItem('devradar_userId') || localStorage.getItem('devradar_user_id')
    if (!savedId) {
      setAppState('landing')
      return
    }
    // Migrate old key → new key
    if (!localStorage.getItem('devradar_userId')) {
      localStorage.setItem('devradar_userId', savedId)
    }
    setUserId(savedId)
    axios.get(`${API_BASE}/api/return-context/${savedId}`)
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
  const handleOnboardComplete = useCallback(async ({ userId: newUserId, stack, learning_stack, experience, goals }) => {
    setUserId(newUserId)
    setUserStack(stack)
    setAppState('app')
    await loadGraphData(newUserId, stack, experience)
  }, [])

  // Called by ReturningScreen when user clicks Continue
  const handleReturningContinue = useCallback(async () => {
    setAppState('app')
    try {
      const { data } = await axios.get(`${API_BASE}/api/user/${userId}`)
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
    setMemoryVisible(true)

    try {
      setLoadingStep(1)
      const { data: analyzeData } = await axios.post(`${API_BASE}/api/analyze`, { userId: uid, stack, experience })
      const fetchedStartups = analyzeData.startups ?? []
      setStartups(fetchedStartups)
      dashboardRevealedRef.current = true

      setLoadingStep(2)
      const { data: hackData } = await axios.get(`${API_BASE}/api/hackathons/${uid}?stack=${encodeURIComponent(stack.join(','))}`)
      setHackathons(hackData.ranked_hackathons ?? [])

      setLoadingStep(3)
      const topCompanies = fetchedStartups.slice(0, 5).map(s => s.name)
      const { data: gapData } = await axios.post(`${API_BASE}/api/gaps`, { userId: uid, stack, targetCompanies: topCompanies })
      setGapReport(gapData)
    } catch (err) {
      const kind = classifyError(err)
      setError(ERROR_MESSAGES[kind])
      if (!dashboardRevealedRef.current) setAppState('onboarding')
    } finally {
      setLoading(false)
    }
  }

  // Legacy submit handler (unused — kept as fallback)
  const handleSubmit = useCallback(async (stack, experience, goals = []) => {
    try {
      const { data: initData } = await axios.post(`${API_BASE}/api/user/init`, { stack, experience, goals })
      const newUserId = initData.userId
      setUserId(newUserId)
      setUserStack(stack)
      localStorage.setItem('devradar_userId', newUserId)
      setAppState('app')
      await loadGraphData(newUserId, stack, experience)
    } catch (err) {
      setError(ERROR_MESSAGES[classifyError(err)])
    }
  }, [])

  const graph = useMemo(() => buildGraph({
    userStack,
    startups,
    hackathons,
    gapReport,
    learnedSkills,
  }), [userStack, startups, hackathons, gapReport, learnedSkills])

  const selectNode = useCallback(node => {
    setSelectedNode(node)
    if (node?.mobileView) setActiveMobileView(node.mobileView)
  }, [])

  const focusNode = useCallback(id => {
    const node = graph.nodeMap.get(id)
    if (node) selectNode(node)
  }, [graph.nodeMap, selectNode])

  function handleMobileTab(id) {
    setActiveMobileView(id)
    if (id === 'dashboard' || id === 'journey') {
      setGraphFilter('all')
      selectNode(graph.nodeMap.get('user'))
    } else if (id === 'startups') {
      setGraphFilter('startups')
      const first = startups[0]
      if (first) focusNode(`startup:${first.id}`)
    } else if (id === 'hackathons') {
      setGraphFilter('hackathons')
      const first = hackathons[0]
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

  const wakingBanner = waking && (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 20px',
      background: 'var(--warning-bg)',
      borderBottom: '1px solid var(--warning-border)',
    }}>
      <span style={{ fontSize: 13 }}>⏳</span>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>
        backend warming up — <span style={{ color: 'var(--text)', fontWeight: 700 }}>give it ~30 seconds</span> on first load (Render free tier)
      </p>
    </div>
  )

  const hasRightPanel = selectedNode || rightPanel
  const graphIsEmpty = graph.nodes.length <= 1

  return (
    <div className="app-shell">
      {wakingBanner}
      <div className={`graph-layout ${hasRightPanel ? 'panel-open' : ''}`}>
        <Sidebar
          graph={graph}
          selectedNode={selectedNode}
          onSelectNode={selectNode}
          userStack={graph.knownSkills}
          startups={startups}
          hackathons={hackathons}
          gapSkills={graph.gapSkills}
          activeMobileView={activeMobileView}
          setActiveMobileView={setActiveMobileView}
          rightPanel={rightPanel}
          onSetRightPanel={panel => { setRightPanel(panel); setSelectedNode(null) }}
          wikiPageCount={wikiPageCount}
          onGoHome={handleGoHome}
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
              selectedNode={selectedNode}
              onSelectNode={node => { selectNode(node); setRightPanel(null) }}
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
            startups={startups}
            hackathons={hackathons}
            userStack={graph.knownSkills}
            userId={userId}
            gapSkills={graph.gapSkills}
            onFocusNode={focusNode}
            onLearned={skill => {
              setLearnedSkills(prev => prev.includes(skill) ? prev : [...prev, skill])
              setSelectedNode(null)
            }}
            onSave={() => window.dispatchEvent(new CustomEvent('devradar:memory-saved'))}
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
              graph={graph}
              selectedNode={selectedNode}
              onSelectNode={node => {
                selectNode(node)
                setSidebarOpen(false)
              }}
              userStack={graph.knownSkills}
              startups={startups}
              hackathons={hackathons}
              gapSkills={graph.gapSkills}
              activeMobileView={activeMobileView}
              setActiveMobileView={setActiveMobileView}
              rightPanel={rightPanel}
              onSetRightPanel={panel => { setRightPanel(panel); setSelectedNode(null); setSidebarOpen(false) }}
              wikiPageCount={wikiPageCount}
              onGoHome={handleGoHome}
            />
          </div>
        </>
      )}
    </div>
  )
}
