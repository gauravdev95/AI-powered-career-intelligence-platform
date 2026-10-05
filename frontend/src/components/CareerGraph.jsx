import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Network } from 'vis-network/standalone'
import { Icon } from './icons.jsx'
import { useTheme } from '../hooks/useTheme.js'
import { focusSubgraph } from '../lib/graph.js'

/**
 * Career graph canvas — a focused view, not a map of everything.
 *
 * The canvas shows exactly one node at the centre and its direct neighbours
 * around it. Clicking a neighbour re-centres on that node; everything unrelated
 * leaves the canvas rather than fading, because a dimmed node is still a node you
 * have to read past. The trail of focused nodes is the breadcrumb above.
 *
 * Layout is deterministic (see `focusSubgraph`): physics is off and every node is
 * placed on a lane arc. Force layout cannot promise that the focused node lands in
 * the centre or that "skills you have" stay on one side, and both are load-bearing
 * here — the left/right split *is* the readiness answer for a company.
 *
 * Blueprint Ledger: nodes are squares, edges are straight plotted lines, and depth
 * is a hard offset block (vis-network `shadow.size: 0` means no blur radius, so the
 * shadow renders as a solid displaced copy — the canvas equivalent of
 * `3px 3px 0 var(--ink)`).
 */

const FILTER_LABELS = {
  all: 'all',
  skills: 'skills',
  startups: 'startups',
  hackathons: 'hackathons',
}

/** Read a CSS custom property from :root at call time (theme-reactive). */
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** Maps a node group onto its `--node-*` token suffix. */
function tokenFor(group) {
  if (group === 'skill_known') return 'skill'
  if (group === 'skill_gap') return 'gap'
  if (group === 'startup') return 'company'
  return group
}

/** Build vis-network OPTIONS using current CSS vars — called fresh each render. */
function buildOptions() {
  const text = cssVar('--text')
  const bgBase = cssVar('--bg-base')
  const edge = cssVar('--node-edge')
  const accent = cssVar('--accent')
  const ink = cssVar('--ink')

  return {
    // Positions come from the focus layout, so the solver is off entirely. This
    // also removes the stabilisation pause on every re-focus.
    physics: { enabled: false },
    nodes: {
      // Squares, not dots — the system has no round geometry.
      shape: 'square',
      font: {
        color: text,
        size: 13,
        face: 'IBM Plex Mono',
        strokeWidth: 4,
        strokeColor: bgBase,
      },
      borderWidth: 2,
      borderWidthSelected: 3,
      // Hard offset block: size 0 = no blur radius.
      shadow: { enabled: true, color: ink, size: 0, x: 3, y: 3 },
    },
    edges: {
      // Straight plotted runs, not curves.
      smooth: false,
      color: { color: edge, highlight: accent, hover: accent, opacity: 0.85 },
      width: 2,
      selectionWidth: 2,
    },
    interaction: {
      hover: true,
      tooltipDelay: 80,
      zoomView: true,
      dragView: true,
      dragNodes: true,
    },
  }
}

/**
 * Per-node paint. `size` arrives from the model already encoded with the node's
 * score, so this only decides colour, weight and the focus ring.
 */
function nodeStyle(node, { isFocus }) {
  const base = cssVar(`--node-${tokenFor(node.group)}`)
  const accent = cssVar('--accent')
  const ink = cssVar('--ink')
  const text = cssVar('--text')
  const bgBase = cssVar('--bg-base')
  const bgSurf = cssVar('--bg-surface0')
  const isUser = node.group === 'user'

  return {
    ...node,
    borderWidth: isFocus ? 4 : isUser ? 3 : 2,
    borderWidthSelected: isFocus ? 4 : 3,
    color: {
      background: isFocus && !isUser ? bgSurf : base,
      border: isFocus || isUser ? accent : ink,
      highlight: { background: isFocus && !isUser ? bgSurf : base, border: accent },
      hover: { background: isFocus && !isUser ? bgSurf : base, border: accent },
    },
    font: {
      // Labels sit on the canvas background (below the square), so they must
      // contrast with the canvas — never with the node fill.
      color: text,
      size: isFocus ? 15 : 13,
      face: 'IBM Plex Mono',
      strokeWidth: 4,
      strokeColor: bgBase,
      bold: { color: text, size: isFocus ? 15 : 13, face: 'IBM Plex Mono', mod: 'bold' },
    },
    shadow: isFocus
      ? { enabled: true, color: accent, size: 0, x: 4, y: 4 }
      : { enabled: true, color: ink, size: 0, x: 3, y: 3 },
  }
}

/** Edge paint. `width` arrives encoded with skill-overlap strength. */
function edgeStyle(edge) {
  const ink = cssVar('--node-edge')
  const gap = cssVar('--node-gap')
  return {
    ...edge,
    color: edge.dashes
      ? { color: gap, opacity: 0.5 }
      : { color: ink, opacity: 0.85 },
  }
}

export default function CareerGraph({
  graph,
  focusPath,
  onFocusNode,
  onClearSelection,
  filter,
  setFilter,
  onOpenSidebar,
  children,
}) {
  const containerRef = useRef(null)
  const networkRef = useRef(null)
  const { theme } = useTheme() // triggers re-render on theme change
  const [cursor, setCursor] = useState(null)

  const focusId = focusPath[focusPath.length - 1]
  const view = useMemo(() => focusSubgraph(graph, focusId, filter), [graph, focusId, filter])

  // Click handlers change identity every render; the network is created once per
  // theme. A ref keeps the listener current without tearing the canvas down.
  const handlers = useRef({ onFocusNode, onClearSelection })
  handlers.current = { onFocusNode, onClearSelection }

  // Create the network. Theme is in the dependency list because vis-network reads
  // colours at construction time and has no way to re-read a CSS variable.
  useEffect(() => {
    if (!containerRef.current) return undefined
    const network = new Network(containerRef.current, { nodes: [], edges: [] }, buildOptions())
    networkRef.current = network

    network.on('click', params => {
      const nodeId = params.nodes?.[0]
      if (nodeId) handlers.current.onFocusNode(nodeId)
      else handlers.current.onClearSelection?.()
    })

    return () => {
      network.destroy()
      networkRef.current = null
    }
  }, [theme])

  // Swap in the focused slice. Re-fitting after every focus change is what makes
  // the new centre actually land in the middle of the viewport.
  useEffect(() => {
    const network = networkRef.current
    if (!network) return

    network.setData({
      nodes: view.nodes.map(node => nodeStyle(node, { isFocus: node.id === focusId })),
      edges: view.edges.map(edgeStyle),
    })
    network.selectNodes([focusId], false)
    network.fit({ animation: { duration: 240, easingFunction: 'linear' } })
  }, [view, focusId, theme])

  // Crosshair — drafting-table pointer. The readout it used to feed now reports
  // graph state instead of pixel coordinates; the crosshair itself is unchanged.
  const handlePointerMove = useCallback(event => {
    const rect = event.currentTarget.getBoundingClientRect()
    setCursor({
      x: Math.round(event.clientX - rect.left),
      y: Math.round(event.clientY - rect.top),
    })
  }, [])

  const legendItems = [
    ['You', cssVar('--node-user')],
    ['Skills you know', cssVar('--node-skill')],
    ['Skills to learn', cssVar('--node-gap')],
    ['Startups', cssVar('--node-company')],
    ['Hackathons', cssVar('--node-hackathon')],
  ]

  const leftLane = view.lanes.find(lane => lane.side === 'left')
  const rightLane = view.lanes.find(lane => lane.side === 'right')

  return (
    <section className="graph-zone">
      <div className="graph-topbar">
        <div className="topbar-left">
          <button className="icon-button hamburger" type="button" onClick={onOpenSidebar} aria-label="Open sidebar">
            <Icon name="menu" />
          </button>
          <Icon name="graph" />
          <span className="topbar-title">Career Graph</span>
        </div>

        <div className="topbar-right">
          <div className="segmented" aria-label="Graph filter">
            {[
              ['all', 'All'],
              ['skills', 'Skills'],
              ['startups', 'Startups'],
              ['hackathons', 'Hackathons'],
            ].map(([id, label]) => (
              <button
                className={`segment-button ${filter === id ? 'active' : ''}`}
                key={id}
                type="button"
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="topbar-separator desktop-actions" />
          <button
            className="icon-button desktop-actions"
            type="button"
            onClick={() => networkRef.current?.fit({ animation: true })}
            aria-label="Fit graph to view"
          >
            <Icon name="fullscreen" />
          </button>
        </div>
      </div>

      <Breadcrumb graph={graph} path={focusPath} onFocusNode={onFocusNode} hidden={view.hidden} />

      {children}

      <div
        className="graph-canvas"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setCursor(null)}
      >
        <div className="graph-network" ref={containerRef} />

        {/* Lane captions. Only rendered for the split plans, where left/right
            carries meaning the colour alone does not spell out. */}
        {leftLane && <LaneCaption lane={leftLane} />}
        {rightLane && <LaneCaption lane={rightLane} />}

        {cursor && (
          <div className="graph-crosshair" aria-hidden="true">
            <span className="graph-crosshair-x" style={{ top: `${cursor.y}px` }} />
            <span className="graph-crosshair-y" style={{ left: `${cursor.x}px` }} />
          </div>
        )}

        {/* State readout — what is on the canvas right now, not where the mouse is. */}
        <div className="graph-readout" role="status">
          <span><span className="graph-readout-k">NODES</span> {String(view.nodes.length).padStart(2, '0')}</span>
          <span><span className="graph-readout-k">EDGES</span> {String(view.edges.length).padStart(2, '0')}</span>
          <span><span className="graph-readout-k">FILTER</span> {FILTER_LABELS[filter] ?? filter}</span>
        </div>
      </div>

      <div className="node-legend">
        <p className="legend-title">Node Types</p>
        {legendItems.map(([label, color]) => (
          <div className="legend-row" key={label}>
            <span className="legend-dot" style={{ background: color }} />
            {label}
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * Focus trail. Every segment is a jump target: clicking one rewinds the trail to
 * that node rather than pushing a new hop.
 */
function Breadcrumb({ graph, path, onFocusNode, hidden }) {
  return (
    <nav className="graph-breadcrumb" aria-label="Focus path">
      <ol className="crumb-list">
        {path.map((id, index) => {
          const detail = graph.nodeMap.get(id)
          if (!detail) return null
          const isLast = index === path.length - 1
          return (
            <li className="crumb" key={id}>
              {index > 0 && <span className="crumb-sep" aria-hidden="true">→</span>}
              <button
                type="button"
                className={`crumb-btn crumb-btn--${detail.type} ${isLast ? 'is-current' : ''}`}
                onClick={() => onFocusNode(id)}
                aria-current={isLast ? 'location' : undefined}
              >
                {detail.label}
              </button>
            </li>
          )
        })}
      </ol>
      {hidden > 0 && (
        <p className="crumb-note">
          +{hidden} more in the list
        </p>
      )}
    </nav>
  )
}

function LaneCaption({ lane }) {
  return (
    <p className={`focus-lane focus-lane--${lane.side} focus-lane--${lane.group}`} aria-hidden="true">
      <span className="focus-lane-label">{lane.label}</span>
      <span className="focus-lane-count">{lane.shown < lane.total ? `${lane.shown}/${lane.total}` : lane.total}</span>
    </p>
  )
}
