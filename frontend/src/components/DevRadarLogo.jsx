/**
 * Grafted mark — compact variant used in the sidebar, wizard and returning screen.
 *
 * The mark is a graft: a rootstock rising from below, two scions bound onto it at
 * a union, and buds carrying the graph's semantic palette. The previous mark was a
 * radar instrument — range rings, crosshair, sweep — which stated the old name's
 * metaphor literally and contradicts the new one, so the geometry is redrawn
 * rather than recoloured.
 *
 * Blueprint Ledger: squares not circles, hard strokes not glows, tokens not hex.
 *
 * NOTE: the component and file keep their `DevRadarLogo` name deliberately. The
 * brief scopes the rename to the display layer and excludes function names; the
 * identifier is not user-visible, and renaming it would touch every import.
 */
export default function DevRadarLogo({ size = 32, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`grafted-mark ${className}`}
      role="img"
      aria-label="Grafted logo"
    >
      {/* Instrument plate */}
      <rect x="1" y="1" width="38" height="38" fill="var(--bg-surface0)" stroke="var(--ink)" strokeWidth="2" />

      {/* Rootstock — what was already growing */}
      <path d="M20 36 V23" stroke="var(--ink)" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M20 31 L14 36 M20 32 L26 37" stroke="var(--ink)" strokeWidth="1" strokeLinecap="round" opacity="0.45" />

      {/* Scions — grafted on, each carrying a bud */}
      <path d="M20 23 V11" stroke="var(--node-skill)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M20 23 L29 13" stroke="var(--node-company)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M20 25 L11 15" stroke="var(--node-hackathon)" strokeWidth="1.5" strokeLinecap="round" />

      {/* Buds */}
      <rect x="17.5" y="8.5" width="5" height="5" fill="var(--node-skill)" />
      <rect x="26.5" y="10.5" width="5" height="5" fill="var(--node-company)" />
      <rect x="8.5" y="12.5" width="5" height="5" fill="var(--node-hackathon)" />

      {/* The union — you. The only ringed element, exactly as on the canvas. */}
      <rect x="17" y="20" width="6" height="6" fill="var(--ink)" />
      <rect x="14.5" y="17.5" width="11" height="11" stroke="var(--accent)" strokeWidth="1.5" fill="none" />

      {/* The binding across the join */}
      <path d="M15.5 30 H24.5 M16.5 33 H23.5" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
