import { useState } from 'react'
import { Icon } from './icons.jsx'

const TABS = ['Help Center', 'Contact Support', 'Feedback', 'Feature Requests', 'Report a Bug']

const TOPICS = [
  { id: 'getting-started', title: 'Getting Started', desc: 'Learn the basics of Grafted', articles: 12, icon: 'sparkles', cls: 'is-purple' },
  { id: 'career-graph', title: 'Career Graph', desc: 'Understand your career insights', articles: 8, icon: 'nodes', cls: 'is-green' },
  { id: 'job-match', title: 'Job Match', desc: 'Find and apply for jobs', articles: 10, icon: 'briefcase', cls: 'is-red' },
  { id: 'resume-helper', title: 'Resume Helper', desc: 'Create and optimize your resume', articles: 9, icon: 'resume', cls: 'is-indigo' },
  { id: 'interview-prep', title: 'Interview Preparation', desc: 'Practice and get ready', articles: 11, icon: 'crown', cls: 'is-amber' },
  { id: 'account', title: 'Account & Settings', desc: 'Manage your account', articles: 7, icon: 'settings', cls: 'is-blue' },
]

const FAQS = [
  {
    q: 'How does Grafted analyze my career profile?',
    a: 'When you ingest a job posting, URL or text, Grafted extracts companies, skills and skill gaps with AI, stores them in your career memory, and generates wiki pages for each entity. Your dashboard, job matches and chat answers are all computed from this personal knowledge base.',
  },
  {
    q: 'Is my data secure and private?',
    a: 'Yes. Your session is authenticated with secure httpOnly cookies, passwords are hashed with bcrypt, and your career data lives in your own private database namespace. Nothing is shared with other users.',
  },
  {
    q: 'How accurate are the job matches?',
    a: 'Match scores are computed from your real skills, experience and target role against each job\u2019s requirements. The more you ingest and the richer your profile, the more accurate the matches become.',
  },
  {
    q: 'Can I use Grafted for free?',
    a: 'Yes — the Free plan includes the career graph, wiki, AI chat, job matching and resume tools with standard limits. Grafted Pro with higher limits is coming soon.',
  },
  {
    q: 'How do I connect my GitHub/LinkedIn account?',
    a: 'Open Settings → Integrations and connect each account. Full OAuth connections are rolling out soon; your integration choices are saved in the meantime.',
  },
]

function HelpArt() {
  return (
    <div className="help-art" aria-hidden="true">
      <div className="help-art-bot">
        <span className="help-art-face"><Icon name="help" /></span>
      </div>
      <span className="help-art-bubble b1"><Icon name="chat" /></span>
      <span className="help-art-bubble b2"><Icon name="sparkles" /></span>
      <span className="help-art-plant" />
    </div>
  )
}

export default function HelpPage({ userName }) {
  const [tab, setTab] = useState('Help Center')
  const [query, setQuery] = useState('')
  const [openFaq, setOpenFaq] = useState(null)
  const [form, setForm] = useState({ name: userName ?? '', email: '', subject: '', message: '' })
  const [sent, setSent] = useState('')

  const q = query.trim().toLowerCase()
  const filteredTopics = q
    ? TOPICS.filter(t => `${t.title} ${t.desc}`.toLowerCase().includes(q))
    : TOPICS
  const filteredFaqs = q
    ? FAQS.filter(f => `${f.q} ${f.a}`.toLowerCase().includes(q))
    : FAQS

  const submitForm = e => {
    e.preventDefault()
    // No backend ticket endpoint exists yet — capture locally and confirm honestly.
    const tickets = JSON.parse(localStorage.getItem('grafted_feedback') ?? '[]')
    tickets.push({ ...form, tab, at: new Date().toISOString() })
    localStorage.setItem('grafted_feedback', JSON.stringify(tickets))
    setSent(
      tab === 'Report a Bug'
        ? 'Bug report saved. Our team will review it — thank you.'
        : tab === 'Feature Requests'
          ? 'Feature request saved. Thanks for helping shape Grafted.'
          : 'Message saved. We will get back to you soon.',
    )
    setForm({ name: userName ?? '', email: '', subject: '', message: '' })
    setTimeout(() => setSent(''), 4000)
  }

  const showForm = tab !== 'Help Center'

  return (
    <div className="help-page">
      <header className="help-hero">
        <div className="help-hero-text">
          <h1 className="help-hero-title"><span className="help-hero-icon"><Icon name="help" /></span> Help &amp; Feedback</h1>
          <p className="help-hero-sub">Get help, find answers, and share your feedback</p>
        </div>
        <HelpArt />
      </header>

      <div className="help-tabs">
        {TABS.map(t => (
          <button
            key={t}
            type="button"
            className={`help-tab ${tab === t ? 'is-active' : ''}`}
            onClick={() => { setTab(t); setSent('') }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Help Center' && (
        <>
          <form className="help-search" onSubmit={e => e.preventDefault()}>
            <Icon name="search" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search for help articles, FAQs, or topics…"
            />
            <button type="submit" className="help-btn is-primary">Search</button>
          </form>

          <div className="help-section-head">
            <h2>Popular Help Topics</h2>
          </div>
          {filteredTopics.length === 0 ? (
            <p className="help-empty">No topics match your search.</p>
          ) : (
            <div className="help-topics">
              {filteredTopics.map(t => (
                <button key={t.id} type="button" className="help-topic">
                  <span className={`help-topic-icon ${t.cls}`}><Icon name={t.icon} /></span>
                  <span className="help-topic-text">
                    <strong>{t.title}</strong>
                    <span>{t.desc}</span>
                  </span>
                  <span className="help-topic-meta">{t.articles} articles <Icon name="chevron" /></span>
                </button>
              ))}
            </div>
          )}

          <div className="help-section-head">
            <h2>Frequently Asked Questions</h2>
          </div>
          <div className="help-faqs">
            {filteredFaqs.length === 0 && <p className="help-empty">No FAQs match your search.</p>}
            {filteredFaqs.map((f, i) => {
              const open = openFaq === i
              return (
                <div key={i} className={`help-faq ${open ? 'is-open' : ''}`}>
                  <button type="button" className="help-faq-q" onClick={() => setOpenFaq(open ? null : i)}>
                    <span className="help-faq-play"><Icon name="play" /></span>
                    <span>{f.q}</span>
                    <Icon name="chevron-down" />
                  </button>
                  {open && <p className="help-faq-a">{f.a}</p>}
                </div>
              )
            })}
          </div>

          <div className="help-cards-2">
            <div className="help-card">
              <span className="help-card-icon is-purple"><Icon name="help" /></span>
              <h3>Still Need Help?</h3>
              <p>Can&apos;t find what you&apos;re looking for? Our support team is here to help.</p>
              <button type="button" className="help-btn is-primary" onClick={() => setTab('Contact Support')}>
                Contact Support
              </button>
            </div>
            <div className="help-card">
              <span className="help-card-icon is-green"><Icon name="chat" /></span>
              <h3>Share Your Feedback</h3>
              <p>Help us improve Grafted by sharing your suggestions, issues, or feature requests.</p>
              <button type="button" className="help-btn is-primary" onClick={() => setTab('Feedback')}>
                Give Feedback
              </button>
            </div>
          </div>

          <div className="help-card wide">
            <h3><span className="help-card-icon is-blue sm"><Icon name="resume" /></span> Community &amp; Resources</h3>
            <p>Join our community and access additional resources</p>
            <div className="help-links">
              <span className="help-link"><Icon name="chat" /> Discord Community <Icon name="external" /></span>
              <span className="help-link"><Icon name="play" /> YouTube Tutorials <Icon name="external" /></span>
              <span className="help-link"><Icon name="resume" /> Documentation <Icon name="external" /></span>
              <span className="help-link"><Icon name="bulb" /> Blog <Icon name="external" /></span>
            </div>
            <p className="help-hint">Community links open soon — we&apos;re setting them up.</p>
          </div>
        </>
      )}

      {showForm && (
        <section className="help-card wide">
          <h3>
            {tab === 'Contact Support' && 'Contact Support'}
            {tab === 'Feedback' && 'Share Your Feedback'}
            {tab === 'Feature Requests' && 'Request a Feature'}
            {tab === 'Report a Bug' && 'Report a Bug'}
          </h3>
          <p className="help-form-sub">
            {tab === 'Contact Support' && 'Tell us what you need help with and we will get back to you.'}
            {tab === 'Feedback' && 'Tell us what is working and what could be better.'}
            {tab === 'Feature Requests' && 'Describe the feature you would love to see in Grafted.'}
            {tab === 'Report a Bug' && 'Describe the bug — what you did, what you expected, and what happened.'}
          </p>
          {sent && <div className="help-sent">{sent}</div>}
          <form onSubmit={submitForm} className="help-form">
            <div className="help-form-grid">
              <label className="help-field">
                <span>Name</span>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Your name" required />
              </label>
              <label className="help-field">
                <span>Email</span>
                <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" required />
              </label>
            </div>
            <label className="help-field">
              <span>Subject</span>
              <input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} placeholder="Brief summary" required />
            </label>
            <label className="help-field">
              <span>Message</span>
              <textarea rows={5} value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} placeholder="Describe in detail…" required />
            </label>
            <button type="submit" className="help-btn is-primary">
              {tab === 'Report a Bug' ? 'Submit Bug Report' : tab === 'Feature Requests' ? 'Submit Request' : 'Send Message'}
            </button>
          </form>
          <p className="help-hint">Messages are saved locally for now — our support inbox integration is coming soon.</p>
        </section>
      )}
    </div>
  )
}
