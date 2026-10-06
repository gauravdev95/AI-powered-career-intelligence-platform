import { Icon } from './icons.jsx'

const COPY = {
  dashboard: {
    title: 'Dashboard',
    text: 'Your career overview is coming soon — stats, streaks and recent activity in one place.',
  },
  'job-match': {
    title: 'Job Match',
    text: 'Company matching is coming soon — your stack scored against live openings.',
  },
  'skill-gaps': {
    title: 'Skill Gaps',
    text: 'A dedicated gaps workspace is coming soon — priorities, learning paths and progress.',
  },
  'resume-helper': {
    title: 'Resume Helper',
    text: 'AI resume tailoring is coming soon — one resume per application, verified facts only.',
  },
  'interview-prep': {
    title: 'Interview Prep',
    text: 'Interview practice is coming soon — questions grounded in your actual stack.',
  },
  settings: {
    title: 'Settings',
    text: 'Workspace settings are coming soon.',
  },
  help: {
    title: 'Help & Feedback',
    text: 'Help center and feedback are coming soon.',
  },
}

/** Placeholder for sections that get their own page in the next step. */
export default function ComingSoon({ page, onBack }) {
  const copy = COPY[page] ?? { title: 'Coming soon', text: 'This section is on its way.' }
  return (
    <div className="comingsoon">
      <div className="comingsoon-card">
        <span className="comingsoon-icon" aria-hidden="true">
          <Icon name="sparkles" className="comingsoon-svg" />
        </span>
        <h1 className="comingsoon-title">{copy.title}</h1>
        <p className="comingsoon-text">{copy.text}</p>
        <button type="button" className="comingsoon-back" onClick={onBack}>
          Back to Career Graph
        </button>
      </div>
    </div>
  )
}
