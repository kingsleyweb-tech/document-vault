import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Info, TriangleAlert } from 'lucide-react'

// The workspace is a separate part of the site with its own router, so links
// into it are ordinary page loads rather than router links.
export function AppLink({ to = '/app', className, children }: { to?: string; className?: string; children: ReactNode }) {
  return (
    <a href={to} className={className}>
      {children}
    </a>
  )
}

export function PageHead({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <header className="site-page-head">
      <div className="site-container">
        {eyebrow ? <span className="site-eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {children ? <p>{children}</p> : null}
      </div>
    </header>
  )
}

export function SectionHead({
  eyebrow,
  title,
  children,
  center,
  id,
}: {
  eyebrow?: string
  title: string
  children?: ReactNode
  center?: boolean
  id?: string
}) {
  return (
    <div className={`site-section__head${center ? ' site-section__head--center' : ''}`}>
      {eyebrow ? <span className="site-eyebrow">{eyebrow}</span> : null}
      <h2 id={id}>{title}</h2>
      {children ? <p>{children}</p> : null}
    </div>
  )
}

export function ArrowLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="site-link-arrow">
      {children}
      <ArrowRight aria-hidden="true" />
    </Link>
  )
}

export function Callout({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: ReactNode }) {
  const Icon = tone === 'warn' ? TriangleAlert : Info
  return (
    <div className={`site-callout${tone === 'warn' ? ' site-callout--warn' : ''}`}>
      <Icon aria-hidden="true" />
      <div>{children}</div>
    </div>
  )
}

export function ReviewNote({ children = 'Needs legal review' }: { children?: ReactNode }) {
  return <span className="site-review-note">{children}</span>
}

export function ClosingCta() {
  return (
    <section className="site-section site-section--tight">
      <div className="site-container">
        <div className="site-cta">
          <div>
            <h2>Bring your records into one place</h2>
            <p>Sign in with Google to create your vault. Your files stay in your own Google Drive.</p>
          </div>
          <div className="site-cta__actions">
            <Link to="/register" className="site-button site-button--primary">
              Get started
            </Link>
            <Link to="/downloads" className="site-button site-button--secondary">
              Downloads
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
