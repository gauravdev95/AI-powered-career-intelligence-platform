/** @type {import('tailwindcss').Config} */

/**
 * Blueprint Ledger — Tailwind is pointed at the SAME CSS variables defined in
 * src/index.css. There is exactly one source of truth for the palette: change a
 * token there and every Tailwind utility follows.
 *
 * The previous config carried a second, contradictory palette that no component
 * ever used. It has been removed.
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)'],
        body: ['var(--font-body)'],
        mono: ['var(--font-mono)'],
      },
      colors: {
        // Paper
        paper: 'var(--bg-base)',
        mantle: 'var(--bg-mantle)',
        crust: 'var(--bg-crust)',
        surface: {
          0: 'var(--bg-surface0)',
          1: 'var(--bg-surface1)',
          2: 'var(--bg-surface2)',
        },
        // Ink — 4-step text hierarchy
        ink: {
          DEFAULT: 'var(--ink)',
          2: 'var(--ink-2)',
          3: 'var(--ink-3)',
          4: 'var(--ink-4)',
        },
        // Signal
        accent: {
          DEFAULT: 'var(--accent)',
          alt: 'var(--accent-alt)',
          bg: 'var(--accent-bg)',
          ink: 'var(--accent-ink)',
        },
        blue: {
          DEFAULT: 'var(--blue)',
          bg: 'var(--blue-bg)',
        },
        ochre: {
          DEFAULT: 'var(--ochre)',
          bg: 'var(--ochre-bg)',
        },
        moss: {
          DEFAULT: 'var(--moss)',
          bg: 'var(--moss-bg)',
        },
        rule: 'var(--border)',
        hair: 'var(--border-hair)',
      },
      // Zero radius is the point of the system.
      borderRadius: {
        none: '0',
        DEFAULT: '0',
        card: '0',
        pill: '0',
        btn: '0',
      },
      // Depth is a hard offset block, never a blur.
      boxShadow: {
        block: 'var(--shadow-block)',
        'block-sm': 'var(--shadow-block-sm)',
        press: 'var(--shadow-press)',
        modal: 'var(--shadow-modal)',
        none: 'none',
      },
      borderWidth: {
        rule: 'var(--rule-width)',
      },
      transitionTimingFunction: {
        mech: 'var(--ease-mech)',
      },
      transitionDuration: {
        fast: '120ms',
        base: '180ms',
        slow: '240ms',
      },
      backgroundImage: {
        grid: 'linear-gradient(to right, var(--grid-ink) 1px, transparent 1px), linear-gradient(to bottom, var(--grid-ink) 1px, transparent 1px)',
      },
      backgroundSize: {
        grid: 'var(--grid-size) var(--grid-size)',
      },
    },
  },
  plugins: [],
}
