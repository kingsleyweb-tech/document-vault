import { Link } from 'react-router-dom'
import { AppLink } from '../ui'
import { usePageMeta } from '../meta'

export default function NotFound() {
  usePageMeta('Page not found', 'The page you were looking for does not exist.')

  return (
    <section className="site-container site-notfound">
      <span className="site-eyebrow">404</span>
      <h1>This page does not exist</h1>
      <p>The link may be old or mistyped. These are good places to start:</p>
      <div className="site-hero__actions site-hero__actions--flush">
        <Link to="/" className="site-button site-button--primary">
          Home
        </Link>
        <Link to="/documentation" className="site-button site-button--secondary">
          Documentation
        </Link>
        <AppLink className="site-button site-button--secondary">Open the web app</AppLink>
      </div>
    </section>
  )
}
