import {
  ArrowUp,
  Clock,
  FileText,
  Folder,
  Star,
  LogOut,
  Menu,
  Search,
  Settings,
  Bell,
  HardDrive,
  CheckCircle2,
  X,
  Trash2,
  Upload,
  CloudUpload,
  FileCheck2,
  Sparkles,
  BellRing,
  CheckCheck,
  LayoutDashboard,
  Files,
  FolderOpen,
  Heart,
  Tag,
  History,
  Moon,
  Sun,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import React from 'react'
import { NavLink, useNavigate, useMatch, useResolvedPath } from 'react-router-dom'
import { useUploadQueue } from '../../hooks/useUploadQueue'
import dvLogo from '../../assets/dv.png'
import type { ThemeMode, VaultDocument } from '../../types/document'
import type { VaultUser } from '../../types/user'

interface AppLayoutProps {
  user: VaultUser
  documents?: VaultDocument[]
  search: string
  searchPlaceholder?: string
  onSearchChange: (value: string) => void
  onUploadClick: () => void
  onUploadProgressClick: () => void
  driveConnected: boolean
  onReconnectDrive: () => void
  onLogout: () => void
  themeMode: ThemeMode
  onThemeModeChange: (themeMode: ThemeMode) => void
  children: ReactNode
}

const mainNavItems = [
  { to: '/',           label: 'Dashboard',   icon: LayoutDashboard, color: '#22c55e' },
  { to: '/files',      label: 'All Files',   icon: Files,           color: '#60a5fa' },
  { to: '/folders',    label: 'All Folders', icon: FolderOpen,      color: '#fbbf24' },
  { to: '/favorites',  label: 'Favorites',   icon: Heart,           color: '#f472b6' },
  { to: '/categories', label: 'Categories',  icon: Tag,             color: '#a78bfa' },
  { to: '/recent',     label: 'Recent',      icon: History,         color: '#34d399' },
  { to: '/trash',      label: 'Trash',       icon: Trash2,          color: '#f87171' },
]

export function AppLayout({
  user,
  documents,
  search,
  searchPlaceholder = 'Search files, folders, or documents...',
  onSearchChange,
  onUploadClick,
  onUploadProgressClick,
  driveConnected,
  onReconnectDrive,
  onLogout,
  themeMode,
  onThemeModeChange,
  children,
}: AppLayoutProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { stats } = useUploadQueue()
  const navigate = useNavigate()

  // Real-time dynamic notifications state
  const [notifications, setNotifications] = useState<
    Array<{ id: string; title: string; subtitle: string; icon: 'green' | 'blue' | 'orange' }>
  >([])

  useEffect(() => {
    const list: Array<{ id: string; title: string; subtitle: string; icon: 'green' | 'blue' | 'orange' }> = []

    if (driveConnected) {
      list.push({
        id: 'drive-status',
        title: 'Google Drive connected',
        subtitle: 'Vault is synchronized with Drive',
        icon: 'green',
      })
    }

    if (stats.running) {
      list.push({
        id: 'upload-status',
        title: `Uploading ${stats.completed}/${stats.total} files`,
        subtitle: `${stats.progress}% progress`,
        icon: 'blue',
      })
    } else if (stats.completed > 0 && stats.completed === stats.total) {
      list.push({
        id: 'upload-complete',
        title: 'Upload queue completed',
        subtitle: `${stats.completed} files successfully uploaded`,
        icon: 'green',
      })
    }

    if (documents && documents.length > 0) {
      const recentDoc = [...documents]
        .filter((d) => !d.isDeleted)
        .sort((a, b) => (b.uploadedAt?.toMillis() ?? 0) - (a.uploadedAt?.toMillis() ?? 0))[0]
      if (recentDoc) {
        list.push({
          id: `doc-${recentDoc.id}`,
          title: `Document synced`,
          subtitle: `${recentDoc.name} is stored safely`,
          icon: 'blue',
        })
      }
    }

    setNotifications(list)
  }, [driveConnected, stats.running, stats.completed, stats.total, stats.progress, documents])

  useEffect(() => {
    const handleScroll = () => setShowScrollTop(window.scrollY > 360)
    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Keyboard shortcut: Ctrl + K (or Cmd + K) to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const userInitials = user.displayName
    ? user.displayName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : 'JD'

  return (
    <div className="app-shell">
      {/* FULL-SCREEN MOBILE MENU OVERLAY */}
      {mobileNavOpen && (
        <div className="mobile-fullscreen-menu" role="dialog" aria-modal="true" aria-label="Navigation menu">
          {/* Header */}
          <div className="mfm-header">
            <div className="mfm-brand">
              <img src={dvLogo} alt="Document Vault" className="mfm-logo" />
              <div className="mfm-brand-text">
                <span className="mfm-brand-title">DOCUMENT VAULT</span>
              </div>
            </div>
            <button
              type="button"
              className="mfm-close-btn"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close menu"
            >
              <X size={20} />
            </button>
          </div>

          {/* Navigation Items */}
          <nav className="mfm-nav" aria-label="Primary navigation">
            {mainNavItems.map((item) => (
              <MobileNavItem
                key={item.to}
                to={item.to}
                label={item.label}
                Icon={item.icon}
                color={item.color}
                onClose={() => setMobileNavOpen(false)}
              />
            ))}
          </nav>

          {/* Drive Status */}
          <div className="mfm-drive-section">
            <div className="mfm-drive-card" onClick={onReconnectDrive}>
              <span className={`mfm-drive-dot ${driveConnected ? 'is-connected' : ''}`} />
              <span className="mfm-drive-label">
                GOOGLE DRIVE — {driveConnected ? 'CONNECTED' : 'DISCONNECTED'}
              </span>
            </div>
          </div>

          {/* User Profile Footer */}
          <div className="mfm-footer">
            <div className="mfm-avatar">
              {user.photoURL
                ? <img src={user.photoURL} alt={user.displayName ?? ''} />
                : <span>{userInitials}</span>
              }
            </div>
            <div className="mfm-user-info">
              <span className="mfm-user-name">{user.displayName ?? 'User'}</span>
              <span className="mfm-user-role">Document Vault Member</span>
            </div>
            <button
              type="button"
              className="mfm-logout-btn"
              onClick={() => { setMobileNavOpen(false); setLogoutConfirmOpen(true) }}
              aria-label="Log out"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      )}

      {/* BACKDROP when mobile menu open */}
      {mobileNavOpen && (
        <div className="sidebar-backdrop" onClick={() => setMobileNavOpen(false)} aria-hidden="true" />
      )}

      {/* LEFT NAVY SIDEBAR (desktop only) */}
      <aside className="sidebar">
        <div className="sidebar-top">
          {/* BRAND LOGO */}
          <div className="brand-wrapper">
            <div className="brand" onClick={() => { navigate('/'); setMobileNavOpen(false) }} style={{ cursor: 'pointer' }}>
              <div className="brand-logo-icon">
                <img src={dvLogo} alt="Document Vault" className="brand-logo-img" />
              </div>
              <div className="brand-text-block">
                <span className="brand-title">Document Vault</span>
                <span className="brand-tagline">Your Files. Safe. Always.</span>
              </div>
            </div>
            <button
              type="button"
              className="icon-button mobile-only close-sidebar-btn"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
          </div>

          {/* NAVIGATION LINKS */}
          <nav aria-label="Primary navigation" className="sidebar-nav">
            {mainNavItems.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  onClick={() => setMobileNavOpen(false)}
                >
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                </NavLink>
              )
            })}
          </nav>

          {/* MY DRIVE SECTION */}
          <div className="sidebar-section">
            <span className="section-label">MY DRIVE</span>
            <div className="drive-status-card" onClick={onReconnectDrive}>
              <div className="drive-icon-badge">
                <HardDrive size={16} />
              </div>
              <div className="drive-info">
                <span className="drive-title">Google Drive</span>
                <span className={driveConnected ? 'drive-status connected' : 'drive-status disconnected'}>
                  <span className="status-dot" />
                  {driveConnected ? 'Connected' : 'Reconnect required'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* SIDEBAR FOOTER & STORAGE USAGE */}
        <div className="sidebar-bottom">
          <div className="storage-widget">
            <div className="storage-header">
              <span>Storage Usage</span>
            </div>
            <div className="storage-progress-bar">
              <div className="storage-progress-fill" style={{ width: '43%' }} />
            </div>
            <div className="storage-legend">
              <span>42.6 GB of 100 GB</span>
              <span>43%</span>
            </div>
          </div>

          <NavLink
            to="/settings"
            className="sidebar-settings-link"
            onClick={() => setMobileNavOpen(false)}
          >
            <Settings aria-hidden="true" />
            <span>Settings</span>
          </NavLink>
        </div>
      </aside>

      {/* WORKSPACE & TOP HEADER */}
      <div className="workspace">
        <header className="topbar">
          <button
            className="icon-button mobile-only hamburger-btn"
            type="button"
            aria-label="Open navigation"
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            <Menu aria-hidden="true" />
          </button>

          {/* SEARCH BAR WITH CTRL+K BADGE */}
          <label className="search-box">
            <Search aria-hidden="true" className="search-icon" />
            <input
              ref={searchInputRef}
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              type="search"
            />
            <kbd className="shortcut-badge">Ctrl + K</kbd>
          </label>

          <div className="topbar-actions">
            {stats.total > 0 ? <UploadIndicator onOpen={onUploadProgressClick} /> : null}

            {/* UPLOAD BUTTON */}
            <button
              type="button"
              className="topbar-upload-btn"
              onClick={onUploadClick}
              title="Upload files"
              aria-label="Upload files"
            >
              <Upload size={15} />
              <span>Upload</span>
            </button>

            {/* NOTIFICATION BELL */}
            <div className="notification-wrapper">
              <button
                type="button"
                className="icon-button notification-btn"
                aria-label="Notifications"
                onClick={() => setNotificationsOpen((open) => !open)}
              >
                <Bell size={18} />
                {notifications.length > 0 && (
                  <span className="notification-badge">{notifications.length}</span>
                )}
              </button>

              {notificationsOpen && (
                <div className="notif-popover" role="dialog" aria-label="Notifications">

                  {/* ── Header ── */}
                  <div className="notif-header">
                    <div className="notif-header-left">
                      <span className="notif-title">Notifications</span>
                      {notifications.length > 0 && (
                        <span className="notif-count-badge">{notifications.length}</span>
                      )}
                    </div>
                    <div className="notif-header-right">
                      {notifications.length > 0 && (
                        <button
                          type="button"
                          className="notif-clear-btn"
                          onClick={() => setNotifications([])}
                          title="Clear all"
                        >
                          Clear all
                        </button>
                      )}
                      <button
                        type="button"
                        className="notif-close-btn"
                        onClick={() => setNotificationsOpen(false)}
                        aria-label="Close"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>

                  {/* ── List ── */}
                  <div className="notif-list">
                    {notifications.length > 0 ? (
                      notifications.map((item) => {
                        const IconComp =
                          item.id.startsWith('drive')
                            ? HardDrive
                            : item.id === 'upload-status'
                            ? CloudUpload
                            : item.id === 'upload-complete'
                            ? CheckCheck
                            : item.id.startsWith('doc-')
                            ? FileCheck2
                            : item.icon === 'green'
                            ? CheckCircle2
                            : BellRing

                        return (
                          <div key={item.id} className={`notif-item notif-item-${item.icon}`}>
                            <div className={`notif-icon-chip notif-chip-${item.icon}`}>
                              <IconComp size={15} />
                            </div>
                            <div className="notif-item-body">
                              <div className="notif-item-header-row">
                                <span className="notif-item-title">{item.title}</span>
                                <span className="notif-item-time">Active</span>
                              </div>
                              <span className="notif-item-sub">{item.subtitle}</span>
                            </div>
                            <button
                              type="button"
                              className="notif-dismiss"
                              onClick={() => setNotifications((prev) => prev.filter((n) => n.id !== item.id))}
                              title="Dismiss notification"
                              aria-label="Dismiss notification"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        )
                      })
                    ) : (
                      <div className="notif-empty">
                        <div className="notif-empty-icon-wrap">
                          <Sparkles size={24} className="notif-sparkle-icon" />
                        </div>
                        <span className="notif-empty-title">All caught up!</span>
                        <span className="notif-empty-sub">You have no unread notifications.</span>
                      </div>
                    )}
                  </div>

                  {/* ── Footer ── */}
                  <div className="notif-footer">
                    <span className="notif-status-dot" />
                    <span>{notifications.length === 0 ? 'All notifications cleared' : `${notifications.length} active updates`}</span>
                  </div>

                </div>
              )}
            </div>

            {/* DARK / LIGHT MODE TOGGLE */}
            <button
              type="button"
              className="theme-toggle-btn"
              onClick={() => onThemeModeChange(themeMode === 'dark' ? 'light' : 'dark')}
              aria-label={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {themeMode === 'dark'
                ? <Sun size={18} aria-hidden="true" />
                : <Moon size={18} aria-hidden="true" />
              }
            </button>

            {/* USER PROFILE */}
            <div className="profile-pill" onClick={() => navigate('/settings')}>
              <div className="avatar-circle">
                {user.photoURL ? <img src={user.photoURL} alt="" /> : <span>{userInitials}</span>}
              </div>
              <div className="profile-text">
                <strong className="profile-name">{user.displayName ?? 'John Doe'}</strong>
                <span className="profile-role">Administrator</span>
              </div>
            </div>

            {/* LOG OUT BUTTON */}
            <button
              className="icon-button logout-btn"
              type="button"
              onClick={() => setLogoutConfirmOpen(true)}
              aria-label="Log out"
              title="Log out"
            >
              <LogOut aria-hidden="true" size={18} />
            </button>
          </div>
        </header>

        <main className="main-content-area">{children}</main>
      </div>

      {/* MOBILE BOTTOM NAV — icon-only quick-nav pill */}
      <div className="mobile-pill-shell is-folded">
        <nav className="bottom-nav" aria-label="Mobile navigation">
          {mainNavItems.slice(0, 5).map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                aria-label={item.label}
                style={{ '--nav-icon-color': item.color } as React.CSSProperties}
              >
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

function UploadIndicator({ onOpen }: { onOpen: () => void }) {
  const { stats } = useUploadQueue()
  const processed = stats.completed + stats.failed

  return (
    <button type="button" className="upload-indicator" onClick={onOpen} aria-label="Open upload manager">
      {stats.pausedForAuth ? (
        <>
          <span>⏸ Upload Paused</span>
          <strong>
            {processed.toLocaleString()} / {stats.total.toLocaleString()}
          </strong>
        </>
      ) : (
        <>
          <span className={stats.running ? 'upload-indicator-spinner is-spinning' : 'upload-indicator-spinner'} aria-hidden="true" />
          <span>{stats.running ? 'Uploading' : 'Upload Queue'}</span>
          <strong>
            {processed.toLocaleString()} / {stats.total.toLocaleString()}
          </strong>
          <span>{stats.progress}%</span>
        </>
      )}
      {stats.failed > 0 ? <em>{stats.failed.toLocaleString()} failed</em> : null}
    </button>
  )
}

// ── Mobile fullscreen menu nav item ──────────────────────────────────────
function MobileNavItem({
  to,
  label,
  Icon,
  color,
  onClose,
}: {
  to: string
  label: string
  Icon: React.ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' | 'false' }>
  color: string
  onClose: () => void
}) {
  const resolved = useResolvedPath(to)
  const match = useMatch({ path: resolved.pathname, end: to === '/' })
  const isActive = !!match

  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={`mfm-nav-item ${isActive ? 'is-active' : ''}`}
      onClick={onClose}
    >
      <span className="mfm-nav-icon" style={{ color }}>
        <Icon size={26} aria-hidden="true" />
      </span>
      <span className="mfm-nav-label" style={isActive ? { color } : {}}>
        {label.toUpperCase()}
      </span>
      {isActive && <span className="mfm-nav-dot" style={{ background: color }} />}
    </NavLink>
  )
}
