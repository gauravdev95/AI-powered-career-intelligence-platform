export default function EmptyGraphState({ onIngest, onStartups, onHackathons }) {
  return (
    <div className="empty-graph-state">
      <div className="empty-graph-inner">
        {/* Icon */}
        <div className="empty-graph-icon">
          <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" width="48" height="48">
            <circle cx="24" cy="24" r="22" stroke="var(--accent)" strokeWidth="2" strokeDasharray="4 3" opacity="0.5" />
            <circle cx="24" cy="24" r="6" fill="var(--accent)" opacity="0.8" />
            <circle cx="10" cy="16" r="3.5" fill="var(--node-skill)" opacity="0.6" />
            <circle cx="38" cy="16" r="3.5" fill="var(--node-hackathon)" opacity="0.6" />
            <circle cx="10" cy="34" r="3.5" fill="var(--node-company)" opacity="0.6" />
            <circle cx="38" cy="34" r="3.5" fill="var(--node-gap)" opacity="0.6" />
            <line x1="24" y1="24" x2="10" y2="16" stroke="var(--border-active)" strokeWidth="1" strokeDasharray="2 2" opacity="0.5" />
            <line x1="24" y1="24" x2="38" y2="16" stroke="var(--border-active)" strokeWidth="1" strokeDasharray="2 2" opacity="0.5" />
            <line x1="24" y1="24" x2="10" y2="34" stroke="var(--border-active)" strokeWidth="1" strokeDasharray="2 2" opacity="0.5" />
            <line x1="24" y1="24" x2="38" y2="34" stroke="var(--border-active)" strokeWidth="1" strokeDasharray="2 2" opacity="0.5" />
          </svg>
        </div>

        <h2 className="empty-graph-title">Your graph is ready to grow</h2>
        <p className="empty-graph-body">
          Feed Grafted some data and it will graft your career onto a live knowledge graph — startups, skills, gaps and hackathons, all held together.
        </p>

        {/* Action cards */}
        <div className="empty-graph-cards">
          <button type="button" className="empty-graph-card" onClick={onIngest}>
            <span className="empty-graph-card-icon">📄</span>
            <span className="empty-graph-card-label">Paste a job description</span>
            <span className="empty-graph-card-sub">Extract skills &amp; companies automatically</span>
          </button>

          <button type="button" className="empty-graph-card" onClick={onIngest}>
            <span className="empty-graph-card-icon">🔗</span>
            <span className="empty-graph-card-label">Add a URL</span>
            <span className="empty-graph-card-sub">LinkedIn, Devfolio, AngelList, startup sites</span>
          </button>

          <button type="button" className="empty-graph-card" onClick={onIngest}>
            <span className="empty-graph-card-icon">📸</span>
            <span className="empty-graph-card-label">Upload a screenshot</span>
            <span className="empty-graph-card-sub">Screenshot of any job post or profile</span>
          </button>
        </div>

        {/* Browse shortcuts */}
        <div className="empty-graph-browse">
          <span className="empty-graph-browse-label">Or explore what&apos;s already loaded:</span>
          <div className="empty-graph-browse-btns">
            <button type="button" className="chip" onClick={onStartups}>
              Browse startups
            </button>
            <button type="button" className="chip" onClick={onHackathons}>
              Browse hackathons
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
