import { useEffect, useMemo, useRef, useState } from 'react'
import { buildGraph, focusSubgraph, SAMPLE_INPUT } from '../lib/graph.js'

/**
 * Grafted landing page — editorial scroll narrative.
 *
 * Structure follows a long-form product page: illustrated hero → statement band →
 * a squiggle-connected walkthrough → feature showcase → marquee → mechanism
 * diagram → social proof → programme band → team/principles → signup → footer.
 *
 * The hero metaphor is grafting, not scanning. A radar sweeps, finds a contact and
 * forgets it on the next rotation — the exact opposite of what this product
 * claims. A graft is a join that holds: a cutting bound to rootstock keeps growing
 * as one plant, and every season it adds to what is already there. So the hero is
 * a graft union with a canopy of career nodes, drawn on rather than pulsed, and
 * the tagline is "Your career, remembered".
 *
 * All styling lives in styles/landing.css. No inline style objects except live
 * animation values (scroll progress, parallax offsets, stagger delays), which
 * cannot be expressed in a stylesheet.
 */

// ── Hooks ────────────────────────────────────────────────────────────────────

/** Reveals an element the first time it enters the viewport. */
function useReveal(threshold = 0.18) {
  const ref = useRef(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const io = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        setShown(true)
        io.unobserve(el)
      }
    }, { threshold, rootMargin: '0px 0px -8% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [threshold])

  return [ref, shown]
}

function Reveal({ as: Tag = 'div', children, className = '', delay = 0, ...rest }) {
  const [ref, shown] = useReveal()
  return (
    <Tag
      ref={ref}
      className={`rv ${shown ? 'in' : ''} ${className}`}
      style={{ '--rv-delay': `${delay}ms` }}
      {...rest}
    >
      {children}
    </Tag>
  )
}

/** Returns 0→1 progress of an element travelling through the viewport. */
function useScrollProgress() {
  const ref = useRef(null)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined

    let frame = 0
    const update = () => {
      frame = 0
      const rect = el.getBoundingClientRect()
      const total = rect.height + window.innerHeight
      const seen = window.innerHeight - rect.top
      setProgress(Math.min(1, Math.max(0, seen / total)))
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return [ref, progress]
}

/** Parallax offset driven by raw window scroll. */
function useParallax() {
  const [y, setY] = useState(0)
  useEffect(() => {
    let frame = 0
    const update = () => { frame = 0; setY(window.scrollY) }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update) }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])
  return y
}

/** Counts up to a target once visible. */
function Counter({ to, suffix = '' }) {
  const [ref, shown] = useReveal(0.5)
  const [value, setValue] = useState(0)

  useEffect(() => {
    if (!shown) return undefined
    const started = performance.now()
    const duration = 1100
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - started) / duration)
      // easeOutExpo — fast start, long settle.
      const eased = t === 1 ? 1 : 1 - 2 ** (-10 * t)
      setValue(Math.round(eased * to))
      if (t < 1) frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [shown, to])

  return <span ref={ref}>{value}{suffix}</span>
}

// ── Navigation ───────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { id: 'how', label: 'How it works' },
  { id: 'showcase', label: 'The graph' },
  { id: 'memory', label: 'Memory' },
  { id: 'principles', label: 'Principles' },
]

/**
 * Site navbar — Modern glass-morphism design.
 *
 * Starts transparent over the hero, gains a frosted glass effect once the hero
 * scrolls behind. Track active section for link highlighting.
 */
function Navbar({ onStart, onContinue, isReturning }) {
  const [solid, setSolid] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState('')

  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      setSolid(window.scrollY > window.innerHeight * 0.65)
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  // Scroll-spy: mark the section currently occupying the middle of the viewport.
  useEffect(() => {
    const sections = NAV_LINKS
      .map(link => document.getElementById(link.id))
      .filter(Boolean)
    if (!sections.length) return undefined

    const io = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(entry => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (visible) setActive(visible.target.id)
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: [0, 0.25, 0.5, 1] },
    )
    sections.forEach(section => io.observe(section))
    return () => io.disconnect()
  }, [])

  // Lock body scroll while the mobile sheet is open.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  function goTo(event, id) {
    event.preventDefault()
    setOpen(false)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <>
      <header className={`nav ${solid ? 'nav--solid' : ''} ${open ? 'nav--open' : ''}`}>
        <a
          className="nav-brand"
          href="#top"
          onClick={e => { e.preventDefault(); setOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
        >
          <span className="nav-logo" aria-hidden="true">
            <svg viewBox="0 0 32 32">
              <path d="M16 30 V17" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M16 17 L24 8" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M16 19 L9 11" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M11.5 19.5 H20.5 M11.5 22.5 H20.5" stroke="#00d2ff" strokeWidth="1.5" strokeLinecap="round" />
              <rect x="22" y="6" width="4" height="4" fill="#a855f7" />
              <rect x="7" y="9" width="4" height="4" fill="#ec4899" />
              <rect x="14" y="15" width="4" height="4" fill="#00d2ff" />
            </svg>
          </span>
          <span className="nav-word">grafted</span>
        </a>

        <nav className="nav-links" aria-label="Primary">
          {NAV_LINKS.map(link => (
            <a
              key={link.id}
              href={`#${link.id}`}
              className={`nav-link ${active === link.id ? 'is-active' : ''}`}
              onClick={e => goTo(e, link.id)}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="nav-actions">
          {isReturning && (
            <button type="button" className="btn btn--secondary btn--sm" onClick={onContinue}>
              My graph
            </button>
          )}
          <button type="button" className="btn btn--primary btn--sm" onClick={onStart}>
            {isReturning ? 'Start fresh' : 'Get started'}
          </button>
          <button
            type="button"
            className="nav-burger"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen(v => !v)}
          >
            <span /><span /><span />
          </button>
        </div>
      </header>

      <div className={`nav-sheet ${open ? 'is-open' : ''}`} hidden={!open}>
        {NAV_LINKS.map((link, i) => (
          <a
            key={link.id}
            href={`#${link.id}`}
            className="nav-sheet-link"
            style={{ '--si': i }}
            onClick={e => goTo(e, link.id)}
          >
            {link.label}
          </a>
        ))}
        <button type="button" className="btn btn--primary nav-sheet-cta" onClick={() => { setOpen(false); onStart() }}>
          {isReturning ? 'Start fresh' : 'Get started'}
        </button>
      </div>
    </>
  )
}

// ── Hero artwork ─────────────────────────────────────────────────────────────

/**
 * Modern hero scene with animated gradient orbs and floating particles.
 * Replaces the old soil/air illustration with a dynamic, visually striking background.
 */
function HeroScene({ scrollY }) {
  const particles = useMemo(() => {
    return Array.from({ length: 25 }, (_, i) => ({
      id: i,
      left: `${5 + (i * 37) % 90}%`,
      delay: `${(i * 0.6) % 15}s`,
      duration: `${12 + (i % 8)}s`,
      size: `${3 + (i % 3)}px`,
    }))
  }, [])

  return (
    <div className="hero-scene" aria-hidden="true">
      {/* Animated gradient orbs */}
      <div className="hero-orb hero-orb--1" style={{ transform: `translate3d(0, ${scrollY * 0.08}px, 0)` }} />
      <div className="hero-orb hero-orb--2" style={{ transform: `translate3d(0, ${scrollY * -0.1}px, 0)` }} />
      <div className="hero-orb hero-orb--3" style={{ transform: `translate3d(0, ${scrollY * 0.06}px, 0)` }} />

      {/* Floating particles */}
      <div className="hero-particles">
        {particles.map(p => (
          <div
            key={p.id}
            className="particle"
            style={{
              left: p.left,
              width: p.size,
              height: p.size,
              animationDelay: p.delay,
              animationDuration: p.duration,
            }}
          />
        ))}
      </div>
    </div>
  )
}

function Mote({ x, y, scale }) {
  return (
    <span className="mote" style={{ left: `${x}%`, top: `${y}%`, '--mote-scale': scale }} />
  )
}

/**
 * The graft itself.
 *
 * Nothing in here is a straight horizontal rule. The ground is a soft grain band
 * behind the drawing (`.graft-ground`), so the roots fade into it instead of
 * stopping at a ruled horizon.
 */
function GraftPlant() {
  return (
    <svg viewBox="0 0 360 320" className="graft-svg" aria-hidden="true">
      {/* Root system — older, thinner, fading into the grain. */}
      <g className="graft-roots">
        <path d="M180 250 C162 266 140 272 118 290" />
        <path d="M180 262 C204 274 226 278 250 296" />
        <path d="M180 278 C172 288 168 294 166 308" />
      </g>

      {/* Rootstock — the stem that was already growing. */}
      <path d="M180 300 V208" className="graft-stock" />

      {/* Scions — grafted on, each carrying part of the canopy. */}
      <path d="M180 208 V96" className="graft-branch" style={{ '--gb': 0 }} />
      <path d="M180 190 C150 164 128 132 112 104" className="graft-branch" style={{ '--gb': 1 }} />
      <path d="M180 176 C146 158 118 166 86 150" className="graft-branch" style={{ '--gb': 2 }} />
      <path d="M180 192 C214 166 232 136 248 104" className="graft-branch" style={{ '--gb': 3 }} />
      <path d="M180 178 C216 162 246 164 274 150" className="graft-branch" style={{ '--gb': 4 }} />

      {/* The binding. Three turns of tape across the union — the join holds. */}
      <path d="M168 214 H192 M167 220 H193 M169 226 H191" className="graft-tie" />

      {/* Canopy. Same palette as the product: blue have · red missing ·
          ochre company · moss event. */}
      <rect x="172" y="88" width="16" height="16" className="graft-node graft-node--company" style={{ '--gn': 0 }} />
      <rect x="105" y="97" width="14" height="14" className="graft-node graft-node--skill" style={{ '--gn': 1 }} />
      <rect x="80" y="144" width="12" height="12" className="graft-node graft-node--hackathon" style={{ '--gn': 2 }} />
      <rect x="241" y="97" width="14" height="14" className="graft-node graft-node--skill" style={{ '--gn': 3 }} />
      <rect x="268" y="144" width="12" height="12" className="graft-node graft-node--gap" style={{ '--gn': 4 }} />

      {/* The union itself is you: everything above is joined to everything below
          through this one square. It is the only ringed node, exactly as on the
          canvas. */}
      <rect x="169" y="197" width="22" height="22" className="graft-union" />
      <rect x="164" y="192" width="32" height="32" className="graft-union-ring" />

      {/* Annotations. The canopy is named, so the drawing says what the product
          holds rather than being abstract shapes in brand colours. */}
      <g className="graft-labels">
        <text x="180" y="78" textAnchor="middle" className="graft-label graft-label--company" style={{ '--gl': 0 }}>Razorpay</text>
        <text x="112" y="86" textAnchor="middle" className="graft-label graft-label--skill" style={{ '--gl': 1 }}>React</text>
        <text x="72" y="174" textAnchor="middle" className="graft-label graft-label--hackathon" style={{ '--gl': 2 }}>ETHIndia</text>
        <text x="248" y="86" textAnchor="middle" className="graft-label graft-label--skill" style={{ '--gl': 3 }}>Node.js</text>
        <text x="282" y="174" textAnchor="middle" className="graft-label graft-label--gap" style={{ '--gl': 4 }}>TypeScript</text>
        <text x="202" y="213" textAnchor="start" className="graft-label graft-label--you" style={{ '--gl': 5 }}>YOU</text>
      </g>
    </svg>
  )
}

// ── Squiggle connector ───────────────────────────────────────────────────────

/**
 * The hand-drawn red line that threads the walkthrough steps. It draws itself as
 * you scroll: stroke-dashoffset is bound to scroll progress rather than to a
 * timed animation, so the line tracks the reader.
 */
function Squiggle({ progress }) {
  const LENGTH = 2600
  return (
    <svg className="squiggle" viewBox="0 0 120 2400" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M62 10 C10 190 108 300 70 470 C34 640 6 720 46 880 C90 1050 104 1150 58 1310 C14 1470 24 1600 74 1740 C118 1866 96 2000 54 2130 C24 2222 46 2320 62 2390"
        className="squiggle-path"
        style={{ strokeDasharray: LENGTH, strokeDashoffset: LENGTH - LENGTH * progress }}
      />
    </svg>
  )
}

// ── Content ──────────────────────────────────────────────────────────────────

const TRUST = ['PostgreSQL', 'pgvector', 'Gemini', 'React 18', 'vis-network']

const STEPS = [
  {
    n: '01',
    title: 'You enter your stack',
    body: 'Pick what you actually know from a curated list of 30 skills. Thirty seconds, no CV, no signup wall.',
    art: 'form',
  },
  {
    n: '02',
    title: 'You get ranked against real companies',
    body: 'Twenty curated Indian startups, scored against the skills you actually have. No guesswork, no filler.',
    art: 'match',
  },
  {
    n: '03',
    title: 'Grafted takes the cutting',
    body: 'Paste any job description or careers URL. It gets read, understood, and grafted onto your own private wiki.',
    art: 'ingest',
  },
  {
    n: '04',
    title: 'The join holds',
    body: 'Every session is stored in PostgreSQL. Come back in a month and it picks up exactly where you left off.',
    art: 'memory',
  },
]

const CHIP_GROUPS = ['All', 'Fintech', 'Consumer', 'B2B SaaS', 'Devtools', 'Health', 'Edtech', 'Logistics']

const MARQUEE = 'WHAT SHOULD I LEARN NEXT · WHO IS HIRING MY STACK · AM I READY FOR RAZORPAY · WHICH HACKATHON FITS ME · WHAT IS MY BIGGEST GAP · WHERE DO I APPLY FIRST'

const PROOF = [
  { quote: 'I finally saw why I kept getting rejected. It was one skill, not ten.', name: 'Ananya R.', role: '3rd year, VIT' },
  { quote: 'The graph made my whole career legible in about four seconds.', name: 'Karthik M.', role: 'Backend, Bengaluru' },
  { quote: 'It remembered what I looked at three weeks ago. Nothing else does that.', name: 'Divya S.', role: 'Final year, NIT' },
  { quote: 'Every answer cited the exact page it came from. I could actually trust it.', name: 'Rohit P.', role: 'SDE-1, Pune' },
  { quote: 'Went from "I know React" to a concrete four-week plan in one sitting.', name: 'Sneha K.', role: 'Bootcamp grad' },
]

const PERKS = [
  { icon: '◆', title: 'Early access', body: 'Shape the roadmap before anyone else sees it.' },
  { icon: '◇', title: 'Free forever', body: 'Beta members keep full access at no cost.' },
  { icon: '★', title: 'Founding badge', body: 'Permanent pioneer mark on your career profile.' },
]

const PRINCIPLES = [
  { title: 'Curiosity over drills', body: 'Follow what the learner is actually interested in, not a fixed syllabus.' },
  { title: 'Memory, not sessions', body: 'A tool that forgets you is a tool you have to re-teach every time.' },
  { title: 'Grounded, not generated', body: 'Every answer cites the stored page it came from. No confident guessing.' },
  { title: 'Honest about gaps', body: 'Telling someone what they are missing is more useful than flattering them.' },
]

// ── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage({ onStart, onContinue, isReturning }) {
  const scrollY = useParallax()
  const [walkRef, walkProgress] = useScrollProgress()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  function handleBeta(event) {
    event.preventDefault()
    if (!email.trim()) return
    setSent(true)
  }

  return (
    <div className="lp" id="top">
      <Navbar onStart={onStart} onContinue={onContinue} isReturning={isReturning} />

      {/* ══ HERO ══════════════════════════════════════════════════ */}
      <header className="hero">
        <HeroScene scrollY={scrollY} />

        {/* Two columns: the claim on the left, the drawing on the right. They used
            to be stacked in the same centred column, which put the wordmark on top
            of the artwork. */}
        <div className="hero-body">
          <div className="hero-content">
            <h1 className="hero-word">
              {'GRAFTED'.split('').map((ch, i) => (
                <span className="hero-ch" key={i} style={{ '--ch-i': i }}>{ch}</span>
              ))}
            </h1>
            <p className="hero-tagline">Your career, remembered</p>
            <p className="hero-sub">
              An AI career graph for Indian developers. Every session is grafted onto the last.
            </p>
            <div className="hero-actions">
              <button type="button" className="btn btn--primary" onClick={onStart}>
                {isReturning ? 'Start fresh' : 'Map my stack'}
              </button>
              {isReturning && (
                <button type="button" className="btn btn--ghost-light" onClick={onContinue}>
                  My graph
                </button>
              )}
            </div>

            {/* Three numbers, stated flatly. They give the left column a base and
                say what the product actually does before you scroll. */}
            <dl className="hero-facts">
              {[
                ['20+', 'startups scored'],
                ['6', 'signals per memory'],
                ['0', 'sessions forgotten'],
              ].map(([n, label]) => (
                <div className="hero-fact" key={label}>
                  <dt className="hero-fact-n">{n}</dt>
                  <dd className="hero-fact-l">{label}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="hero-art" style={{ transform: `translate3d(0, ${scrollY * 0.12}px, 0)` }}>
            {/* A specimen plate, not a floating illustration. The frame, corner
                registration ticks and caption give the drawing somewhere to sit and
                fill the column the old centred artwork left empty. */}
            <figure className="hero-plate">
              <span className="plate-tick plate-tick--tl" aria-hidden="true" />
              <span className="plate-tick plate-tick--tr" aria-hidden="true" />
              <span className="plate-tick plate-tick--bl" aria-hidden="true" />
              <span className="plate-tick plate-tick--br" aria-hidden="true" />
              <GraftPlant />
              <figcaption className="plate-caption">
                <span>Fig. 01 · career graft</span>
                <span className="plate-caption-alt">session 04</span>
              </figcaption>
            </figure>
          </div>
        </div>

        <div className="hero-fade" />
      </header>

      {/* ══ STATEMENT ═════════════════════════════════════════════ */}
      <section className="statement">
        <Reveal as="h2" className="statement-h">
          Grow curiosity.<br />Build confidence<span className="dot">.</span>
        </Reveal>
        <Reveal as="p" className="statement-p" delay={90}>
          Most tools answer a question and forget you. Grafted keeps a durable memory
          of your skills, your gaps and every company you have looked at — so each visit
          starts further ahead than the last.
        </Reveal>
        <Reveal className="trust" delay={160}>
          <span className="trust-label">Built on</span>
          <div className="trust-row">
            {TRUST.map(item => <span className="trust-item" key={item}>{item}</span>)}
          </div>
        </Reveal>
        <Reveal delay={220}>
          <button type="button" className="btn btn--primary" onClick={onStart}>Get started</button>
        </Reveal>
      </section>

      {/* ══ WALKTHROUGH ═══════════════════════════════════════════ */}
      <section className="walk" id="how" ref={walkRef}>
        <Squiggle progress={walkProgress} />

        <Reveal as="h2" className="sec-h">
          Welcome to<br />Grafted<span className="dot">.</span>
        </Reveal>

        <div className="steps">
          {STEPS.map((step, i) => (
            <Reveal className="step" key={step.n} delay={i * 60}>
              <div className="step-head">
                <span className="step-n">{step.n}</span>
                <h3 className="step-t">{step.title}</h3>
              </div>
              <p className="step-b">{step.body}</p>
              <div className="step-art">
                <StepArt kind={step.art} />
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ══ SHOWCASE ══════════════════════════════════════════════ */}
      <section className="showcase" id="showcase">
        <Reveal as="h2" className="sec-h sec-h--center">
          <Counter to={20} />+ startups<br />in one graph
        </Reveal>

        <Reveal className="chips" delay={80}>
          {CHIP_GROUPS.map((chip, i) => (
            <span className={`chip ${i === 0 ? 'chip--on' : ''}`} key={chip}>{chip}</span>
          ))}
        </Reveal>

        <Reveal className="device" delay={140}>
          <div className="device-frame">
            <div className="device-bar">
              <span className="device-dot" /><span className="device-dot" /><span className="device-dot" />
              <span className="device-title">career graph</span>
            </div>
            <div className="device-screen">
              <GraphPreview />
            </div>
          </div>
        </Reveal>
      </section>

      {/* ══ MARQUEE ═══════════════════════════════════════════════ */}
      <div className="marquee">
        <div className="marquee-track">
          <span>{MARQUEE}&nbsp;·&nbsp;</span>
          <span aria-hidden="true">{MARQUEE}&nbsp;·&nbsp;</span>
        </div>
      </div>

      {/* ══ MECHANISM ═════════════════════════════════════════════ */}
      <section className="mech" id="memory">
        <Reveal as="h2" className="sec-h sec-h--center">
          You explore.<br />Grafted remembers<span className="dot">.</span>
        </Reveal>
        <Reveal as="p" className="sec-p" delay={70}>
          Everything you do becomes a typed, scored memory. When you ask a question, only
          the handful of memories that actually matter are retrieved — and the answer cites them.
        </Reveal>

        <Reveal className="flow" delay={120}>
          {[
            ['Your input', 'stack · job posts · URLs'],
            ['Extraction', 'entities pulled by Gemini'],
            ['Memory', 'typed, scored, deduplicated'],
            ['Retrieval', 'ranked on six signals'],
            ['Answer', 'grounded, with citations'],
          ].map((node, i) => (
            <div className="flow-node" key={node[0]} style={{ '--fi': i }}>
              <span className="flow-k">{String(i + 1).padStart(2, '0')}</span>
              <span className="flow-t">{node[0]}</span>
              <span className="flow-b">{node[1]}</span>
            </div>
          ))}
        </Reveal>

        <Reveal className="mech-cta" delay={200}>
          <span>Learn how the memory engine works</span>
          <button type="button" className="btn btn--primary btn--sm" onClick={onStart}>Try it</button>
        </Reveal>
      </section>

      {/* ══ PROOF ═════════════════════════════════════════════════ */}
      <section className="proof">
        <div className="proof-row">
          {PROOF.map((item, i) => (
            <Reveal className="quote" key={item.name} delay={i * 50}>
              <p className="quote-t">“{item.quote}”</p>
              <p className="quote-n">{item.name}</p>
              <p className="quote-r">{item.role}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ══ PIONEERS ══════════════════════════════════════════════ */}
      <section className="pioneers">
        <Reveal as="h2" className="sec-h sec-h--center sec-h--light">
          Join the Grafted<br />Pioneers<span className="dot">.</span>
        </Reveal>
        <Reveal as="p" className="sec-p sec-p--light" delay={70}>
          The first cohort shapes what gets built. Fewer than a hundred seats in the first round.
        </Reveal>

        <Reveal className="perks" delay={120}>
          {PERKS.map(perk => (
            <div className="perk" key={perk.title}>
              <span className="perk-i">{perk.icon}</span>
              <h3 className="perk-t">{perk.title}</h3>
              <p className="perk-b">{perk.body}</p>
            </div>
          ))}
        </Reveal>

        <Reveal delay={180}>
          <p className="pioneers-note">
            <Counter to={100} /> seats · free for life · no card required
          </p>
        </Reveal>
      </section>

      {/* ══ PRINCIPLES ════════════════════════════════════════════ */}
      <section className="principles" id="principles">
        <Reveal as="p" className="manifesto">
          We are building for parents, students, teachers and self-taught engineers who
          believe career tooling deserves to be honest.
          <br />
          <span className="manifesto-em">Not louder. Not stickier. Better<span className="dot">.</span></span>
        </Reveal>

        <Reveal as="h2" className="sec-h sec-h--center" delay={80}>
          Our principles<span className="dot">.</span>
        </Reveal>

        <div className="prin-grid">
          {PRINCIPLES.map((p, i) => (
            <Reveal className="prin" key={p.title} delay={i * 60}>
              <h3 className="prin-t">{p.title}</h3>
              <p className="prin-b">{p.body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ══ BETA ══════════════════════════════════════════════════ */}
      <section className="beta">
        <Reveal className="beta-mark">⚡</Reveal>
        <Reveal as="h2" className="sec-h sec-h--center" delay={60}>Join the beta</Reveal>

        <Reveal delay={110}>
          {sent ? (
            <p className="beta-done">You&apos;re on the list. We&apos;ll be in touch<span className="dot">.</span></p>
          ) : (
            <form className="beta-form" onSubmit={handleBeta}>
              <input
                type="email"
                className="beta-input"
                placeholder="you@college.edu"
                value={email}
                onChange={e => setEmail(e.target.value)}
                aria-label="Email address"
                required
              />
              <button type="submit" className="btn btn--primary">Request access</button>
            </form>
          )}
        </Reveal>

        <Reveal delay={160}>
          <button type="button" className="beta-skip" onClick={onStart}>
            or skip the queue and open the app →
          </button>
        </Reveal>
      </section>

      {/* ══ FOOTER ════════════════════════════════════════════════ */}
      <footer className="foot">
        <div className="foot-links">
          {['Docs', 'Architecture', 'GitHub', 'Privacy'].map(l => (
            <span className="foot-link" key={l}>{l}</span>
          ))}
        </div>
        <div className="foot-mark">grafted</div>
        <p className="foot-fine">Your career, remembered.</p>
      </footer>
    </div>
  )
}

// ── Step artwork ─────────────────────────────────────────────────────────────

/** Small abstract product previews. Deliberately schematic, not screenshots. */
function StepArt({ kind }) {
  // Each step gets a visually distinct artefact. Only the showcase section renders
  // the node graph — repeating it here made four steps look like the same picture.
  if (kind === 'form') {
    return (
      <div className="art art--form">
        <span className="art-label">Pick what you know</span>
        <div className="art-tags">
          {[['React', true], ['Node.js', true], ['Python', true], ['Go', false], ['Rust', false]].map(([t, on]) => (
            <span className={`art-tag ${on ? 'art-tag--on' : ''}`} key={t}>
              {on && <span className="art-tick">✓</span>}{t}
            </span>
          ))}
        </div>
        <div className="art-meter"><span className="art-meter-fill" style={{ '--w': '60%' }} /></div>
        <span className="art-hint">3 of 5 selected · 30 seconds</span>
      </div>
    )
  }

  if (kind === 'match') {
    return (
      <div className="art art--match">
        <span className="art-label">Your matches</span>
        {[['Razorpay', 86], ['Zepto', 71], ['Groww', 64], ['CRED', 48]].map(([name, pct], i) => (
          <div className="art-bar-row" key={name} style={{ '--bi': i }}>
            <span className="art-bar-name">{name}</span>
            <span className="art-bar-track">
              <span className="art-bar-fill" style={{ '--pct': pct + '%' }} />
            </span>
            <span className="art-bar-pct">{pct}%</span>
          </div>
        ))}
      </div>
    )
  }

  if (kind === 'ingest') {
    return (
      <div className="art art--ingest">
        <div className="art-url">
          <span className="art-url-dot" />razorpay.com/careers/backend-engineer
        </div>
        <div className="art-rows">
          {[['Razorpay', 'company'], ['TypeScript', 'gap'], ['PostgreSQL', 'gap'], ['Kafka', 'gap']].map(([name, kind2], i) => (
            <div className="art-row" key={name} style={{ '--ri': i }}>
              <span className={`art-row-dot art-row-dot--${kind2}`} />
              <span className="art-row-name">{name}</span>
              <span className="art-row-kind">{kind2}</span>
            </div>
          ))}
        </div>
        <span className="art-note">4 entities · 3 wiki pages written</span>
      </div>
    )
  }

  return (
    <div className="art art--memory">
      <div className="art-timeline">
        {['Day 1', 'Day 8', 'Day 21', 'Today'].map((d, i) => (
          <span className={`art-tl ${i === 3 ? 'is-now' : ''}`} key={d}>
            <span className="art-tl-dot" />
            <span className="art-tl-label">{d}</span>
          </span>
        ))}
      </div>
      <p className="art-recall">
        “Welcome back — last time you explored <b>Razorpay</b>. <b>TypeScript</b> is still your
        top gap, and <b>ETHIndia</b> closes in 6 days.”
      </p>
      <div className="art-cites">
        {['company/razorpay', 'skill_gap/typescript'].map(c => <span className="art-cite" key={c}>{c}</span>)}
      </div>
    </div>
  )
}

/** Node group → the preview's colour-class suffix. */
const GP_CLASS = {
  user: 'user',
  skill_known: 'skill',
  skill_gap: 'gap',
  startup: 'co',
  hackathon: 'hack',
}

const GP_PAD = 12
const GP_BOX = 100

/**
 * Preview of the career graph inside the device frame.
 *
 * Generated by the product's own `buildGraph` + `focusSubgraph` over a small
 * sample payload, not hand-placed. Node sizes, edge widths, the lane layout and
 * the colours are therefore whatever the real encoding produces — if the model
 * changes, this picture changes with it instead of quietly going stale.
 */
function GraphPreview() {
  const { nodes, edges } = useMemo(() => {
    const graph = buildGraph(SAMPLE_INPUT)
    const view = focusSubgraph(graph, 'user', 'all')

    // The layout works in world units around an origin; fit it to the viewBox.
    const xs = view.nodes.map(node => node.x)
    const ys = view.nodes.map(node => node.y)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY, 1)
    const inner = GP_BOX - GP_PAD * 2
    const scale = inner / span
    const offX = GP_PAD + (inner - (Math.max(...xs) - minX) * scale) / 2
    const offY = GP_PAD + (inner - (Math.max(...ys) - minY) * scale) / 2

    const placed = new Map()
    const laidOut = view.nodes.map(node => {
      const point = {
        id: node.id,
        kind: GP_CLASS[node.group] ?? 'skill',
        x: offX + (node.x - minX) * scale,
        y: offY + (node.y - minY) * scale,
        // vis-network sizes run 12–30; halve into viewBox units.
        r: (node.size ?? 14) / 8,
      }
      placed.set(node.id, point)
      return point
    })

    const links = view.edges
      .map(edge => ({
        id: edge.id,
        from: placed.get(edge.from),
        to: placed.get(edge.to),
        width: (edge.width ?? 1) * 0.22,
        dashed: Boolean(edge.dashes),
      }))
      .filter(link => link.from && link.to)

    return { nodes: laidOut, edges: links }
  }, [])

  return (
    <svg viewBox={`0 0 ${GP_BOX} ${GP_BOX}`} className="gp" role="img" aria-label="A career graph: your profile joined to skills, gaps, companies and hackathons">
      {edges.map((edge, i) => (
        <line
          key={edge.id}
          x1={edge.from.x} y1={edge.from.y}
          x2={edge.to.x} y2={edge.to.y}
          className={`gp-edge ${edge.dashed ? 'gp-edge--dashed' : ''}`}
          strokeWidth={edge.width}
          style={{ '--i': i }}
        />
      ))}
      {nodes.map((node, i) => (
        <rect
          key={node.id}
          x={node.x - node.r} y={node.y - node.r}
          width={node.r * 2} height={node.r * 2}
          className={`gp-n gp-n--${node.kind}`}
          style={{ '--i': i }}
        />
      ))}
    </svg>
  )
}
