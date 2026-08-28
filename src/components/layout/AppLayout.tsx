import {
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  Folder,
  Heart,
  LogOut,
  Menu,
  Search,
  Settings,
  Trash2,
  Upload,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import type { ThemeMode } from '../../types/document'
import type { VaultUser } from '../../types/user'
import vaultLogo from '../../assets/dv.png'

interface AppLayoutProps {
  user: VaultUser
  search: string
  onSearchChange: (value: string) => void
  onUploadClick: () => void
  onLogout: () => void
  themeMode: ThemeMode
  onThemeModeChange: (themeMode: ThemeMode) => void
  children: ReactNode
}

const navItems = [
  { to: '/', label: 'All Documents', icon: FileText },
  { to: '/recent', label: 'Recent', icon: Clock },
  { to: '/favorites', label: 'Favorites', icon: Heart },
  { to: '/categories', label: 'Categories', icon: Folder },
  { to: '/trash', label: 'Trash', icon: Trash2 },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function AppLayout({
  user,
  search,
  onSearchChange,
  onUploadClick,
  onLogout,
  themeMode,
  onThemeModeChange,
  children,
}: AppLayoutProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(true)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)

  useEffect(() => {
    const handleScroll = () => setShowScrollTop(window.scrollY > 360)
    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src={vaultLogo} alt="" aria-hidden="true" />
          <span>Document Vault</span>
        </div>
        <nav aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink key={item.to} to={item.to} end={item.to === '/'}>
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            )
          })}
        </nav>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <button className="icon-button mobile-only" type="button" aria-label="Open navigation">
            <Menu aria-hidden="true" />
          </button>
          <label className="search-box">
            <Search aria-hidden="true" />
            <span className="sr-only">Search documents</span>
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search documents"
              type="search"
            />
          </label>
          <button className="primary-button" type="button" onClick={onUploadClick}>
            <Upload aria-hidden="true" />
            <span>Upload</span>
          </button>
          <div className="theme-switcher" aria-label="Theme">
            <button
              type="button"
              className={themeMode === 'light' ? 'is-active' : ''}
              onClick={() => onThemeModeChange('light')}
            >
              Light
            </button>
            <button
              type="button"
              className={themeMode === 'dark' ? 'is-active' : ''}
              onClick={() => onThemeModeChange('dark')}
            >
              Dark
            </button>
          </div>
          <div className="profile">
            {user.photoURL ? <img src={user.photoURL} alt="" /> : <span>{user.email?.[0]}</span>}
            <div>
              <strong>{user.displayName ?? 'Vault user'}</strong>
              <small>{user.email}</small>
            </div>
          </div>
          <button className="icon-button" type="button" onClick={() => setLogoutConfirmOpen(true)} aria-label="Log out">
            <LogOut aria-hidden="true" />
          </button>
        </header>

        <main>{children}</main>
      </div>

      <div className="mobile-theme-switcher">
        <div className="theme-switcher" aria-label="Theme">
          <button
            type="button"
            className={themeMode === 'light' ? 'is-active' : ''}
            onClick={() => onThemeModeChange('light')}
          >
            Light
          </button>
          <button
            type="button"
            className={themeMode === 'dark' ? 'is-active' : ''}
            onClick={() => onThemeModeChange('dark')}
          >
            Dark
          </button>
        </div>
      </div>

      <div className={mobileNavOpen ? 'mobile-pill-shell' : 'mobile-pill-shell is-folded'}>
        <button
          type="button"
          className="mobile-pill-toggle"
          onClick={() => setMobileNavOpen((open) => !open)}
          aria-label={mobileNavOpen ? 'Fold mobile navigation' : 'Show mobile navigation'}
        >
          {mobileNavOpen ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
        </button>
        <nav className="bottom-nav" aria-label="Mobile navigation">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink key={item.to} to={item.to} end={item.to === '/'} aria-label={item.label}>
                <Icon aria-hidden="true" />
              </NavLink>
            )
          })}
        </nav>
      </div>

      {showScrollTop ? (
        <button
          type="button"
          className="scroll-top-button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Scroll to top"
        >
          <ArrowUp aria-hidden="true" />
        </button>
      ) : null}

      {logoutConfirmOpen ? (
        <div className="dialog-backdrop" role="presentation">
          <section className="prompt-dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="logout-title">
            <header>
              <h2 id="logout-title">Log out?</h2>
            </header>
            <div className="dialog-body">
              <p>Are you sure you want to log out of Document Vault?</p>
            </div>
            <footer>
              <button type="button" className="secondary-button" onClick={() => setLogoutConfirmOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  setLogoutConfirmOpen(false)
                  onLogout()
                }}
              >
                Log out
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  )
}
