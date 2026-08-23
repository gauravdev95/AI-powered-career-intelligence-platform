import { useEffect, useState } from 'react'

/**
 * Blueprint Ledger graft mark — the large, animated variant.
 *
 * Drawn with strokes and animated by stroke-dashoffset: the plant draws itself on
 * like a plotter laying down ink, once, then holds. That "once, then holds" is the
 * point — the mark it replaces was a radar sweep on an infinite loop, which is the
 * opposite of what the product claims to do with your history.
 *
 * Every colour is a token, so the mark themes for free and costs one paint instead
 * of a permanent animation frame loop.
 *
 * NOTE: this module currently has no importers — `DevRadarLogo` is what the app
 * renders. It is kept and rebranded rather than deleted so the two marks cannot
 * drift apart if it is picked up again.
 */

const VIEW = 160
const C = VIEW / 2

/** Scion paths, drawn outward from the union in order. */
const SCIONS = [
  { d: `M${C} 108 V38`, width: 4, delay: 0 },
  { d: `M${C} 100 C58 78 42 58 30 40`, width: 3, delay: 110 },
  { d: `M${C} 100 C102 78 118 58 130 40`, width: 3, delay: 220 },
]

/** Bud squares at the scion tips, in the graph's semantic palette. */
const BUDS = [
  { x: C - 8, y: 30, size: 16, fill: 'var(--node-skill)' },
  { x: 22, y: 32, size: 14, fill: 'var(--node-hackathon)' },
  { x: 124, y: 32, size: 14, fill: 'var(--node-company)' },
]

export function LogoMark({ size = 28, style, className = '', animate = true }) {
  const [drawn, setDrawn] = useState(!animate)

  useEffect(() => {
    if (!animate) return undefined
    // One frame's delay so the initial dashoffset is committed before it animates.
    const id = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(id)
  }, [animate])

  // Detail scales down: at small sizes the roots and buds become noise.
  const detailed = size >= 40

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      className={`logo-mark ${drawn ? 'is-drawn' : ''} ${className}`}
      style={style}
      role="img"
      aria-label="Grafted"
      fill="none"
    >
      {/* Plate — a hard-bordered instrument face */}
      <rect
        x="1.5"
        y="1.5"
        width={VIEW - 3}
        height={VIEW - 3}
        fill="var(--bg-surface0)"
        stroke="var(--ink)"
        strokeWidth="3"
      />

      {/* Rootstock */}
      <path d={`M${C} 150 V100`} stroke="var(--ink)" strokeWidth="8" strokeLinecap="round" />

      {detailed && (
        <g stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" opacity="0.4">
          <path d={`M${C} 126 C64 136 52 140 40 150`} />
          <path d={`M${C} 132 C96 142 108 144 120 152`} />
        </g>
      )}

      {/* Scions draw on outward from the union */}
      {SCIONS.map(scion => (
        <path
          key={scion.d}
          d={scion.d}
          stroke="var(--ink)"
          strokeWidth={scion.width}
          strokeLinecap="round"
          style={{
            strokeDasharray: 180,
            strokeDashoffset: drawn ? 0 : 180,
            transition: `stroke-dashoffset 520ms var(--ease-mech) ${scion.delay}ms`,
          }}
        />
      ))}

      {detailed && BUDS.map(bud => (
        <rect
          key={bud.fill + bud.x}
          x={bud.x}
          y={bud.y}
          width={bud.size}
          height={bud.size}
          fill={bud.fill}
          style={{ opacity: drawn ? 1 : 0, transition: 'opacity 1ms linear 620ms' }}
        />
      ))}

      {/* The union — the one accent-ringed element, matching the canvas */}
      <rect x={C - 9} y="91" width="18" height="18" fill="var(--ink)" />
      <rect
        x={C - 15}
        y="85"
        width="30"
        height="30"
        stroke="var(--accent)"
        strokeWidth="3"
        fill="none"
        style={{ opacity: drawn ? 1 : 0, transition: 'opacity 1ms linear 560ms' }}
      />

      {/* The binding across the join. The only other accent stroke. */}
      <path
        d={`M${C - 18} 122 H${C + 18} M${C - 14} 134 H${C + 14}`}
        stroke="var(--accent)"
        strokeWidth="4"
        strokeLinecap="round"
        style={{ opacity: drawn ? 1 : 0, transition: 'opacity 1ms linear 680ms' }}
      />
    </svg>
  )
}

export function LogoText({ size = 'lg', style, className = '' }) {
  return (
    <span className={`logo-text logo-text--${size} ${className}`} style={style}>
      grafted
    </span>
  )
}

export default LogoMark
