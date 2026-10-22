import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Info, TriangleAlert } from 'lucide-react'
import { allowSignInPage } from '../routing'

// The workspace is a separate part of the site with its own router, so links
// into it are ordinary page loads rather than router links. Clicking one means
// the visitor wants in, so a signed-out visitor is shown sign-in, not the home page.
export function AppLink({ to = '/app', className, children }: { to?: string; className?: string; children: ReactNode }) {
  return (
    <a href={to} className={className} onClick={() => allowSignInPage()}>
      {children}
    </a>
  )
}

/** The only way onto the sign-in page: typing /login or /register goes to the home page. */
export function SignInLink({
  to = '/login',
  className,
  children,
}: {
  to?: '/login' | '/register'
  className?: string
  children: ReactNode
}) {
  return (
    <Link to={to} className={className} onClick={() => allowSignInPage()}>
      {children}
    </Link>
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
            <SignInLink to="/register" className="site-button site-button--primary">
              Get started
            </SignInLink>
            <Link to="/downloads" className="site-button site-button--secondary">
              Downloads
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * Long policy text beside an "On this page" list of its sections, which keeps
 * the reader's place and fills the space beside the column of text.
 */
export function ReadingLayout({ children }: { children: ReactNode }) {
  const proseRef = useRef<HTMLDivElement>(null)
  const [sections, setSections] = useState<{ id: string; title: string }[]>([])
  const [current, setCurrent] = useState<string | null>(null)

  useEffect(() => {
    const headings = [...(proseRef.current?.querySelectorAll<HTMLHeadingElement>('h2[id]') ?? [])]
    setSections(headings.map((heading) => ({ id: heading.id, title: heading.textContent ?? '' })))
    if (headings.length === 0 || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting)
        if (visible.length > 0) setCurrent(visible[0].target.id)
      },
      { rootMargin: '-90px 0px -65% 0px' },
    )
    headings.forEach((heading) => observer.observe(heading))
    return () => observer.disconnect()
  }, [])

  return (
    <div className="site-reading">
      <div className="site-prose" ref={proseRef}>
        {children}
      </div>
      {sections.length > 1 ? (
        <nav className="site-reading__toc" aria-label="On this page">
          <strong>On this page</strong>
          <ul>
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} aria-current={current === section.id ? 'location' : undefined}>
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  )
}
