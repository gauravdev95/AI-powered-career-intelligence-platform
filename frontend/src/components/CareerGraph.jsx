import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Network } from 'vis-network/standalone'
import { Icon } from './icons.jsx'
import { fullGraphView } from '../lib/graph.js'

/**
 * Career Graph page — the reference-style interactive constellation.
 *
 * Always dark navy, always the full filtered graph at once: the profile at the
 * centre, one glowing cluster per group (skills / companies / projects /
 * learning). Clicking a node opens its detail panel; the canvas never
 * re-centres or hides anything, so the graph stays a stable map you can read.
 *
 * Skill dots are coloured by demand (green = high, amber = medium, red = low);
 * everything else glows in its group neon. Positions are deterministic —
 * Reset View restores them exactly.
 */

const TABS = [
  ['all', 'All'],
  ['skills', 'Skills'],
  ['companies', 'Companies'],
  ['projects', 'Projects'],
  ['learning', 'Learning'],
]

const NEON = {
  user: '#a78bfa',
  skill_known: { high: '#22c55e', medium: '#f59e0b', low: '#f43f5e' },
  skill_gap: '#fb7185',
  skill_learning: '#22d3ee',
  startup: '#fb923c',
  hackathon: '#3b82f6',
}

const TYPE_LABEL = {
  user: 'You',
  skill_known: 'Skill',
  skill_gap: 'Skill gap',
  skill_learning: 'Learning',
  startup: 'Company',
  hackathon: 'Project',
}

/** Demand tier for a skill node: share of matched orgs that require it. */
function demandTone(node) {
  const { demand = 0, totalOrgs = 1 } = node.raw ?? {}
  const ratio = demand / Math.max(1, totalOrgs)
  if (ratio >= 0.5) return 'high'
  if (ratio >= 0.2) return 'medium'
  return 'low'
}

function nodeColor(node) {
  if (node.group === 'skill_known') return NEON.skill_known[demandTone(node)]
  return NEON[node.group] ?? '#94a3b8'
}

/** Per-node paint: glowing dot, white label underneath. */
function nodeStyle(node, { selected }) {
  const color = nodeColor(node)
  const isUser = node.group === 'user'
  return {
    ...node,
    shape: 'dot',
    size: node.size,
    borderWidth: selected ? 3 : 2,
    color: {
      background: color,
      border: selected ? '#ffffff' : color,
      highlight: { background: color, border: '#ffffff' },
      hover: { background: color, border: '#ffffff' },
    },
    shadow: { enabled: true, color, size: isUser ? 34 : 18, x: 0, y: 0 },
    font: {
      color: '#eef2ff',
      size: isUser ? 16 : 12,
      face: 'Inter, system-ui, -apple-system, sans-serif',
      strokeWidth: 4,
      strokeColor: 'rgba(7,11,26,0.92)',
    },
    labelHighlightBold: true,
  }
}

/** Edge paint: faint curved runs, rose dashes for "needs". */
function edgeStyle(edge) {
  return {
    ...edge,
    smooth: { enabled: true, type: 'curvedCW', roundness: 0.12 },
    color: {
      color: edge.dashes ? 'rgba(251,113,133,0.38)' : 'rgba(148,163,184,0.30)',
      highlight: '#a78bfa',
      hover: '#a78bfa',
      opacity: 1,
    },
    width: Math.max(1, edge.width ?? 1.5),
    dashes: edge.dashes ? [5, 7] : false,
    selectionWidth: 2,
  }
}

function buildOptions() {
  return {
    physics: { enabled: false },
    interaction: {
      hover: true,
      tooltipDelay: 120,
      zoomView: true,
      dragView: true,
      dragNodes: true,
      navigationButtons: false,
      keyboard: false,
    },
    nodes: { shape: 'dot' },
    edges: {},
  }
}

export default function CareerGraph({
  graph,
  filter,
  setFilter,
  onFocusNode,
  onClearSelection,
  selectedId,
  children,
}) {
  const containerRef = useRef(null)
  const wrapRef = useRef(null)
  const networkRef = useRef(null)
  const [viewMode, setViewMode] = useState('graph')
  const [query, setQuery] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const view = useMemo(() => fullGraphView(graph, filter), [graph, filter])
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId

  const handlers = useRef({ onFocusNode, onClearSelection })
  handlers.current = { onFocusNode, onClearSelection }

  // Create the network once.
  useEffect(() => {
    if (!containerRef.current) return undefined
    const network = new Network(containerRef.current, { nodes: [], edges: [] }, buildOptions())
    networkRef.current = network

    network.on('click', params => {
      const nodeId = params.nodes?.[0]
      if (nodeId) {
        network.selectNodes([nodeId])
        handlers.current.onFocusNode(nodeId)
      } else {
        handlers.current.onClearSelection?.()
      }
    })

    return () => {
      network.destroy()
      networkRef.current = null
    }
  }, [])

  // Swap in the filtered slice. Re-fitting keeps the constellation centred.
  useEffect(() => {
    const network = networkRef.current
    if (!network) return
    network.setData({
      nodes: view.nodes.map(node => nodeStyle(node, { selected: node.id === selectedIdRef.current })),
      edges: view.edges.map(edgeStyle),
    })
    if (selectedIdRef.current && view.nodes.some(node => node.id === selectedIdRef.current)) {
      network.selectNodes([selectedIdRef.current])
    }
    network.fit({ animation: { duration: 260, easingFunction: 'easeInOutQuad' } })
  }, [view])

  // Re-paint the selection ring when the detail panel opens/closes — update only
  // the two affected nodes so dragged positions are never reset.
  const prevSelectedRef = useRef(null)
  useEffect(() => {
    const network = networkRef.current
    if (!network || viewMode !== 'graph') return
    const ds = network.body?.data?.nodes
    if (!ds) return
    const byId = new Map(view.nodes.map(node => [node.id, node]))
    const prev = prevSelectedRef.current
    if (prev && prev !== selectedId && byId.has(prev)) {
      ds.update(nodeStyle(byId.get(prev), { selected: false }))
    }
    if (selectedId && byId.has(selectedId)) {
      ds.update(nodeStyle(byId.get(selectedId), { selected: true }))
      network.selectNodes([selectedId])
    } else {
      network.unselectAll()
    }
    prevSelectedRef.current = selectedId
  }, [selectedId, viewMode]) // eslint-disable-line react-hooks/exhaustive-deps

  const resetView = useCallback(() => {
    const network = networkRef.current
    if (!network) return
    network.setData({
      nodes: view.nodes.map(node => nodeStyle(node, { selected: node.id === selectedIdRef.current })),
      edges: view.edges.map(edgeStyle),
    })
    network.fit({ animation: { duration: 300, easingFunction: 'easeInOutQuad' } })
  }, [view])

  const zoomBy = useCallback(factor => {
    const network = networkRef.current
    if (!network) return
    network.moveTo({ scale: network.getScale() * factor, animation: { duration: 200, easingFunction: 'easeInOutQuad' } })
  }, [])

  const fitView = useCallback(() => {
    networkRef.current?.fit({ animation: { duration: 300, easingFunction: 'easeInOutQuad' } })
  }, [])

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else el.requestFullscreen?.().catch(() => {})
  }, [])

  // Search: select + zoom to matches; empty query clears.
  const runSearch = useCallback(text => {
    setQuery(text)
    const network = networkRef.current
    if (!network) return
    const q = text.trim().toLowerCase()
    if (!q) {
      network.unselectAll()
      return
    }
    const matches = view.nodes.filter(node => node.label.toLowerCase().includes(q)).map(node => node.id)
    if (matches.length) {
      network.selectNodes(matches)
      network.fit({ nodes: matches, animation: { duration: 300, easingFunction: 'easeInOutQuad' } })
    }
  }, [view])

  const counts = useMemo(() => {
    const tally = { user: 0, skill_known: 0, skill_gap: 0, skill_learning: 0, startup: 0, hackathon: 0 }
    graph.nodes.forEach(node => { if (tally[node.group] !== undefined) tally[node.group] += 1 })
    return tally
  }, [graph])

  return (
    <section className="cg-page">
      <header className="cg-header">
        <div className="cg-title-block">
          <h1 className="cg-title">Your Career Graph</h1>
          <p className="cg-subtitle">Explore your skills, goals, companies and opportunities in an interactive graph.</p>
        </div>
        <div className="cg-header-actions">
          <div className="cg-view-toggle" role="tablist" aria-label="View mode">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'graph'}
              className={`cg-view-btn ${viewMode === 'graph' ? 'active' : ''}`}
              onClick={() => setViewMode('graph')}
            >
              Graph View
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'list'}
              className={`cg-view-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
            >
              List View
            </button>
          </div>
          <button className="cg-icon-btn" type="button" onClick={toggleFullscreen} aria-label="Fullscreen graph">
            <Icon name="fullscreen" />
          </button>
          <label className="cg-search">
            <Icon name="search" />
            <input
              type="search"
              placeholder="Search nodes…"
              value={query}
              onChange={event => runSearch(event.target.value)}
              aria-label="Search nodes"
            />
          </label>
        </div>
      </header>

      <div className="cg-tabs-row">
        <div className="cg-tabs" role="tablist" aria-label="Graph filter">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              className={`cg-tab ${filter === id ? 'active' : ''}`}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="cg-legend">
          <span className="cg-legend-item"><i className="cg-dot" style={{ background: '#22c55e' }} />High Demand</span>
          <span className="cg-legend-item"><i className="cg-dot" style={{ background: '#f59e0b' }} />Medium</span>
          <span className="cg-legend-item"><i className="cg-dot" style={{ background: '#f43f5e' }} />Low</span>
          <div className="cg-filters-wrap">
            <button
              type="button"
              className="cg-filters-btn"
              onClick={() => setFiltersOpen(open => !open)}
              aria-expanded={filtersOpen}
            >
              <Icon name="filter" /> Filters
            </button>
            {filtersOpen && (
              <div className="cg-filters-menu">
                {[
                  ['skills', 'Skills', counts.skill_known, '#22c55e'],
                  ['companies', 'Companies', counts.startup, '#fb923c'],
                  ['projects', 'Projects', counts.hackathon, '#3b82f6'],
                  ['learning', 'Learning', counts.skill_gap + counts.skill_learning, '#22d3ee'],
                ].map(([id, label, count, color]) => (
                  <button
                    key={id}
                    type="button"
                    className="cg-filters-item"
                    onClick={() => { setFilter(id); setFiltersOpen(false) }}
                  >
                    <i className="cg-dot" style={{ background: color }} />
                    {label}
                    <span className="cg-filters-count">{count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="cg-canvas-card">
        <div className="cg-canvas-wrap" ref={wrapRef}>
          {viewMode === 'graph' ? (
            <>
              <div className="cg-network" ref={containerRef} />
              {children}
              <div className="cg-zoom-controls">
                <button type="button" onClick={() => zoomBy(1.3)} aria-label="Zoom in">+</button>
                <button type="button" onClick={() => zoomBy(1 / 1.3)} aria-label="Zoom out">−</button>
                <button type="button" onClick={toggleFullscreen} aria-label="Fullscreen">
                  <Icon name="fullscreen" />
                </button>
                <button type="button" className="cg-reset" onClick={resetView}>Reset View</button>
              </div>
              <Minimap networkRef={networkRef} viewKey={`${filter}:${view.nodes.length}`} />
              {view.hidden > 0 && (
                <p className="cg-hidden-note">+{view.hidden} more nodes — refine the filter to see them</p>
              )}
            </>
          ) : (
            <GraphListView graph={graph} filter={filter} onFocusNode={onFocusNode} />
          )}
        </div>
      </div>
    </section>
  )
}

/** Live thumbnail: node dots + viewport rect, refreshed on pan/zoom/drag. */
function Minimap({ networkRef, viewKey }) {
  const [frame, setFrame] = useState(null)

  const refresh = useCallback(() => {
    const network = networkRef.current
    if (!network) return
    const positions = network.getPositions()
    const ids = Object.keys(positions)
    if (!ids.length) { setFrame(null); return }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    ids.forEach(id => {
      const p = positions[id]
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
    })
    const pad = 80
    minX -= pad; maxX += pad; minY -= pad; maxY += pad

    const W = 132, H = 96
    const sx = W / Math.max(1, maxX - minX)
    const sy = H / Math.max(1, maxY - minY)
    const s = Math.min(sx, sy)
    const toMini = (x, y) => [
      (x - minX) * s + (W - (maxX - minX) * s) / 2,
      (y - minY) * s + (H - (maxY - minY) * s) / 2,
    ]

    const nodes = ids.map(id => {
      const node = network.body.nodes[id]?.options
      const [x, y] = toMini(positions[id].x, positions[id].y)
      return { id, x, y, color: node?.color?.background ?? '#94a3b8', r: node?.group === 'user' ? 4 : 2.4 }
    })

    // Viewport rect in world coords → minimap coords.
    const container = network.body.container
    const scale = network.getScale()
    const center = network.getViewPosition()
    const vw = container.clientWidth / scale
    const vh = container.clientHeight / scale
    const [vx, vy] = toMini(center.x - vw / 2, center.y - vh / 2)

    setFrame({ nodes, view: { x: vx, y: vy, w: vw * s, h: vh * s } })
  }, [networkRef])

  useEffect(() => {
    const network = networkRef.current
    if (!network) return undefined
    const timer = setTimeout(refresh, 350)
    network.on('dragEnd', refresh)
    network.on('zoom', refresh)
    return () => {
      clearTimeout(timer)
      network.off('dragEnd', refresh)
      network.off('zoom', refresh)
    }
  }, [refresh, viewKey])

  if (!frame) return null
  return (
    <svg className="cg-minimap" viewBox="0 0 132 96" aria-hidden="true">
      {frame.nodes.map(node => (
        <circle key={node.id} cx={node.x} cy={node.y} r={node.r} fill={node.color} opacity={0.9} />
      ))}
      <rect
        x={frame.view.x} y={frame.view.y}
        width={frame.view.w} height={frame.view.h}
        fill="none" stroke="#a78bfa" strokeWidth={1.2} rx={3} opacity={0.9}
      />
    </svg>
  )
}

/** Grouped node list — the accessible twin of the canvas. */
function GraphListView({ graph, filter, onFocusNode }) {
  const groups = useMemo(() => {
    const defs = [
      { key: 'skill_known', title: 'Skills you have' },
      { key: 'startup', title: 'Companies' },
      { key: 'hackathon', title: 'Projects' },
      { key: 'skill_learning', title: 'Learning in progress' },
      { key: 'skill_gap', title: 'Skill gaps' },
    ]
    const byType = new Map(graph.nodeDetails.map(detail => [detail.id, detail]))
    return defs
      .map(def => ({
        ...def,
        items: graph.nodes
          .filter(node => node.group === def.key && (filter === 'all' || fullFilterGroups(filter).has(node.group)))
          .map(node => byType.get(node.id))
          .filter(Boolean),
      }))
      .filter(group => group.items.length > 0)
  }, [graph, filter])

  return (
    <div className="cg-list">
      {groups.map(group => (
        <div className="cg-list-group" key={group.key}>
          <p className="cg-list-title">{group.title}<span>{group.items.length}</span></p>
          <ul>
            {group.items.map(detail => (
              <li key={detail.id}>
                <button type="button" className="cg-list-row" onClick={() => onFocusNode(detail.id)}>
                  <i className="cg-dot" style={{ background: listColor(detail.type) }} />
                  <span className="cg-list-label">{detail.label}</span>
                  <span className="cg-list-meta">{listMeta(detail)}</span>
                  <Icon name="chevron" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function fullFilterGroups(filter) {
  if (filter === 'skills') return new Set(['skill_known'])
  if (filter === 'companies') return new Set(['startup'])
  if (filter === 'projects') return new Set(['hackathon'])
  if (filter === 'learning') return new Set(['skill_gap', 'skill_learning'])
  return new Set(['skill_known', 'startup', 'hackathon', 'skill_gap', 'skill_learning'])
}

function listColor(type) {
  if (type === 'skill_known') return '#22c55e'
  if (type === 'skill_gap') return '#fb7185'
  if (type === 'skill_learning') return '#22d3ee'
  if (type === 'startup') return '#fb923c'
  if (type === 'hackathon') return '#3b82f6'
  return '#94a3b8'
}

function listMeta(detail) {
  const raw = detail.raw ?? {}
  if (detail.type === 'startup') return `${raw.analysis?.match_percentage ?? raw.match_score ?? 0}% match`
  if (detail.type === 'hackathon') return raw.days == null ? 'Date TBD' : `${raw.days}d left`
  if (detail.type === 'skill_known') return `${raw.demand ?? 0} orgs`
  if (detail.type === 'skill_gap') return raw.priority ? `Priority ${raw.priority}` : `${raw.demand ?? 0} req`
  if (detail.type === 'skill_learning') return 'In progress'
  return ''
}
