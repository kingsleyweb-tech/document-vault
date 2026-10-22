import { Suspense, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { AppLink, SignInLink } from './ui'

// The 192-pixel app icon is the same mark as the workspace logo at a sixth of the size.
const logo = '/icon-192.png'

const primaryLinks = [
  { to: '/', label: 'Home', end: true },
  { to: '/features', label: 'Features' },
  { to: '/documentation', label: 'Documentation' },
  { to: '/downloads', label: 'Downloads' },
  { to: '/security', label: 'Security' },
]

export function SiteLayout() {
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [lastPath, setLastPath] = useState(location.pathname)

  // A new page closes the menu.
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname)
    setMenuOpen(false)
  }

  // New pages start at the top, or at the section a link points to.
  useEffect(() => {
    if (location.hash) {
      const target = document.getElementById(decodeURIComponent(location.hash.slice(1)))
      if (target) {
        target.scrollIntoView()
        return
      }
    }
    window.scrollTo(0, 0)
  }, [location.pathname, location.hash])

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  return (
    <div className="site">
      <a className="site-skip" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="site-container site-header__inner">
          <Link to="/" className="site-brand" aria-label="Document Vault home">
            <img src={logo} alt="" width="34" height="34" />
            <span>Document Vault</span>
          </Link>
          <nav className="site-nav" aria-label="Main">
            {primaryLinks.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end}>
                {link.label}
              </NavLink>
            ))}
          </nav>
          <div className="site-header__actions">
            <SignInLink to="/login" className="site-button site-button--ghost">
              Sign in
            </SignInLink>
            <SignInLink to="/register" className="site-button site-button--primary">
              Get started
            </SignInLink>
          </div>
          <button
            type="button"
            className="site-menu-button"
            aria-expanded={menuOpen}
            aria-controls="site-mobile-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
        <div id="site-mobile-menu" className="site-mobile-menu" data-open={menuOpen}>
          <div className="site-container">
            <nav aria-label="Main">
              {primaryLinks.map((link) => (
                <NavLink key={link.to} to={link.to} end={link.end}>
                  {link.label}
                </NavLink>
              ))}
            </nav>
            <div className="site-mobile-menu__actions">
              <SignInLink to="/register" className="site-button site-button--primary site-button--block">
                Get started
              </SignInLink>
              <SignInLink to="/login" className="site-button site-button--secondary site-button--block">
                Sign in
              </SignInLink>
            </div>
          </div>
        </div>
      </header>

      <main id="main" className="site-main" tabIndex={-1}>
        <Suspense fallback={<div className="site-boot" role="status">Loading...</div>}>
          <Outlet />
        </Suspense>
      </main>

      <SiteFooter />
    </div>
  )
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-container">
        <div className="site-footer__grid">
          <div className="site-footer__about">
            <Link to="/" className="site-brand">
              <img src={logo} alt="" width="34" height="34" />
              <span>Document Vault</span>
            </Link>
            <p>A private workspace for your important documents, stored in your own Google Drive.</p>
          </div>
          <nav aria-labelledby="footer-product">
            <h2 id="footer-product">Product</h2>
            <ul>
              <li><Link to="/features">Features</Link></li>
              <li><Link to="/downloads">Downloads</Link></li>
              <li><AppLink>Open the web app</AppLink></li>
              <li><Link to="/about">About</Link></li>
            </ul>
          </nav>
          <nav aria-labelledby="footer-help">
            <h2 id="footer-help">Help</h2>
            <ul>
              <li><Link to="/documentation">Documentation</Link></li>
              <li><Link to="/documentation/getting-started">Getting started</Link></li>
              <li><Link to="/documentation/troubleshooting">Troubleshooting</Link></li>
            </ul>
          </nav>
          <nav aria-labelledby="footer-trust">
            <h2 id="footer-trust">Trust</h2>
            <ul>
              <li><Link to="/security">Security</Link></li>
              <li><Link to="/privacy">Privacy</Link></li>
              <li><Link to="/terms">Terms</Link></li>
            </ul>
          </nav>
        </div>
        <div className="site-footer__base">
          <span>© {new Date().getFullYear()} Document Vault</span>
          <span>Files are stored in your own Google Drive.</span>
        </div>
      </div>
    </footer>
  )
}
