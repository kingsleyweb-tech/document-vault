import {
  ArrowUp,
  Bell,
  CheckCircle2,
  CloudUpload,
  Files,
  FolderOpen,
  HardDrive,
  History,
  Home,
  LogOut,
  Menu,
  Monitor,
  Moon,
  PauseCircle,
  RotateCw,
  Search,
  Settings,
  Star,
  Sun,
  Tags,
  Trash2,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useUploadQueue } from '../../hooks/useUploadQueue'
import { useDeleteQueue } from '../../hooks/useDeleteQueue'
import dvLogo from '../../assets/dv.png'
import type { ThemeMode } from '../../types/document'
import type { VaultUser } from '../../types/user'
import { getDriveStorageQuota, type DriveStorageQuota } from '../../services/googleDrive'
import { formatFileSize } from '../../utils/formatters'
import { Dialog } from '../ui/Dialog'

interface AppLayoutProps {
  user: VaultUser
  trashCount: number
  search: string
  searchPlaceholder?: string
  onSearchChange: (value: string) => void
  onUploadClick: () => void
  onUploadProgressClick: () => void
  driveConnected: boolean
  accessToken?: string | null
  onReconnectDrive: () => void
  onLogout: () => void
  themeMode: ThemeMode
  onThemeModeChange: (themeMode: ThemeMode) => void
  children: ReactNode
}

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

const libraryNav: NavItem[] = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/files', label: 'All files', icon: Files },
  { to: '/folders', label: 'Folders', icon: FolderOpen },
  { to: '/recent', label: 'Recent', icon: History },
  { to: '/favorites', label: 'Favorites', icon: Star },
  { to: '/categories', label: 'Categories', icon: Tags },
  { to: '/desktop', label: 'Desktop Files', icon: Monitor },
]

const tabbarNav: NavItem[] = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/files', label: 'Files', icon: Files },
  { to: '/folders', label: 'Folders', icon: FolderOpen },
  { to: '/recent', label: 'Recent', icon: History },
]

export function AppLayout({
  user,
  trashCount,
  search,
  searchPlaceholder = 'Search documents',
  onSearchChange,
  onUploadClick,
  onUploadProgressClick,
  driveConnected,
  accessToken,
  onReconnectDrive,
  onLogout,
  themeMode,
  onThemeModeChange,
  children,
}: AppLayoutProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const [openPopover, setOpenPopover] = useState<'activity' | 'account' | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [quotaState, setQuotaState] = useState<{ token: string; quota: DriveStorageQuota | null } | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const location = useLocation()

  // Close the drawer and any popover whenever the route changes.
  const [lastPath, setLastPath] = useState(location.pathname)
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname)
    setDrawerOpen(false)
    setOpenPopover(null)
  }

  useEffect(() => {
    if (!accessToken) return undefined
    let cancelled = false
    void getDriveStorageQuota(accessToken).then((quota) => {
      if (!cancelled) setQuotaState({ token: accessToken, quota })
    })
    return () => {
      cancelled = true
    }
  }, [accessToken])

  const driveQuota = accessToken && quotaState?.token === accessToken ? quotaState.quota : null
  const quotaLoading = Boolean(accessToken) && quotaState?.token !== accessToken

  useEffect(() => {
    const handleScroll = () => setShowScrollTop(window.scrollY > 480)
    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInputRef.current?.focus()
      }
      if (event.key === 'Escape') {
        setOpenPopover(null)
        setDrawerOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [drawerOpen])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.getRegistration()
        await registration?.update()
      } catch (error) {
        console.error('Service worker update check failed:', error)
      }
    }
    window.setTimeout(() => window.location.reload(), 300)
  }

  const displayName = user.displayName || user.email || 'Signed in'
  const initials = getInitials(user.displayName || user.email)

  const storage = driveQuota && driveQuota.limitBytes > 0
    ? { used: driveQuota.usageBytes, limit: driveQuota.limitBytes, percent: Math.min(100, (driveQuota.usageBytes / driveQuota.limitBytes) * 100) }
    : null

  const sidebar = (
    <>
      <div className="sidebar__brand">
        <NavLink to="/" className="brand" aria-label="Document Vault home">
          <img src={dvLogo} alt="" />
          <span>Document Vault</span>
        </NavLink>
        <button type="button" className="icon-button sidebar__close" onClick={() => setDrawerOpen(false)} aria-label="Close menu">
          <X aria-hidden="true" />
        </button>
      </div>

      <button type="button" className="primary-button sidebar__upload" onClick={onUploadClick}>
        <Upload aria-hidden="true" />
        <span>Upload</span>
      </button>

      <nav className="sidebar__nav" aria-label="Primary">
        <span className="sidebar__label">Library</span>
        {libraryNav.map((item) => (
          <SidebarLink key={item.to} item={item} />
        ))}
        <div className="sidebar__divider" />
        <SidebarLink item={{ to: '/trash', label: 'Trash', icon: Trash2 }} count={trashCount} />
        <SidebarLink item={{ to: '/settings', label: 'Settings', icon: Settings }} />
      </nav>

      <div className="sidebar__footer">
        <div className="drive-card">
          <div className="drive-card__row">
            <span className="drive-card__icon">
              <HardDrive aria-hidden="true" />
            </span>
            <div className="drive-card__text">
              <strong>Google Drive</strong>
              <span>
                <span className={driveConnected ? 'status-dot is-on' : 'status-dot is-off'} />
                {driveConnected ? 'Connected' : 'Not connected'}
              </span>
            </div>
          </div>
          {driveConnected ? (
            <div className="storage-meter" aria-label="Google Drive storage">
              <div className="storage-meter__track">
                <div className="storage-meter__fill" style={{ width: `${storage ? storage.percent.toFixed(1) : 0}%` }} />
              </div>
              <span>
                {storage
                  ? `${formatFileSize(storage.used)} of ${formatFileSize(storage.limit)} used`
                  : quotaLoading
                    ? 'Checking storage...'
                    : 'Storage unavailable'}
              </span>
            </div>
          ) : (
            <button type="button" className="secondary-button drive-card__connect" onClick={onReconnectDrive}>
              Connect Drive
            </button>
          )}
        </div>
      </div>
    </>
  )

  return (
    <div className="shell">
      <aside className={drawerOpen ? 'sidebar is-open' : 'sidebar'} aria-label="Sidebar">
        {sidebar}
      </aside>
      {drawerOpen ? <div className="sidebar-scrim" onClick={() => setDrawerOpen(false)} aria-hidden="true" /> : null}

      <div className="shell__main">
        <header className="topbar">
          <button
            type="button"
            className="icon-button topbar__menu"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
          >
            <Menu aria-hidden="true" />
          </button>

          <label className="search-box topbar__search">
            <Search aria-hidden="true" />
            <input
              ref={searchInputRef}
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              type="search"
              aria-label="Search documents"
            />
            <kbd>Ctrl K</kbd>
          </label>

          <div className="topbar__actions">
            <DeleteIndicator />
            <UploadIndicator onOpen={onUploadProgressClick} />

            <ActivityMenu
              open={openPopover === 'activity'}
              onToggle={() => setOpenPopover((current) => (current === 'activity' ? null : 'activity'))}
              onClose={() => setOpenPopover(null)}
              driveConnected={driveConnected}
              onReconnectDrive={onReconnectDrive}
              onOpenUploads={onUploadProgressClick}
            />

            <button
              type="button"
              className="icon-button topbar__optional"
              onClick={() => void handleRefresh()}
              disabled={isRefreshing}
              aria-label="Reload and check for updates"
              title="Reload and check for updates"
            >
              <RotateCw aria-hidden="true" className={isRefreshing ? 'spinning' : undefined} />
            </button>

            <button
              type="button"
              className="icon-button"
              onClick={() => onThemeModeChange(themeMode === 'dark' ? 'light' : 'dark')}
              aria-label={themeMode === 'dark' ? 'Use light theme' : 'Use dark theme'}
              title={themeMode === 'dark' ? 'Use light theme' : 'Use dark theme'}
            >
              {themeMode === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
            </button>

            <div className="popover-anchor">
              <button
                type="button"
                className="avatar-button"
                onClick={() => setOpenPopover((current) => (current === 'account' ? null : 'account'))}
                aria-label="Account"
                aria-expanded={openPopover === 'account'}
              >
                <Avatar photoURL={user.photoURL} initials={initials} />
              </button>
              {openPopover === 'account' ? (
                <>
                  <div className="popover-scrim" onClick={() => setOpenPopover(null)} aria-hidden="true" />
                  <div className="popover account-popover" role="menu">
                    <div className="account-popover__head">
                      <Avatar photoURL={user.photoURL} initials={initials} large />
                      <div>
                        <strong>{displayName}</strong>
                        {user.email ? <span>{user.email}</span> : null}
                      </div>
                    </div>
                    <div className="menu-divider" />
                    <NavLink to="/settings" className="popover__item" role="menuitem">
                      <Settings aria-hidden="true" />
                      <span>Settings</span>
                    </NavLink>
                    <button
                      type="button"
                      className="popover__item"
                      role="menuitem"
                      onClick={() => {
                        setOpenPopover(null)
                        setLogoutConfirmOpen(true)
                      }}
                    >
                      <LogOut aria-hidden="true" />
                      <span>Log out</span>
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </header>

        {!driveConnected ? (
          <div className="drive-banner" role="status">
            <HardDrive aria-hidden="true" />
            <p>
              <strong>Google Drive is not connected.</strong> Connect it to open, upload and manage your files.
            </p>
            <button type="button" className="primary-button button--small" onClick={onReconnectDrive}>
              Connect Drive
            </button>
          </div>
        ) : null}

        <main className="page">{children}</main>
      </div>

      <nav className="tabbar" aria-label="Quick navigation">
        {tabbarNav.slice(0, 2).map((item) => (
          <TabbarLink key={item.to} item={item} />
        ))}
        <button type="button" className="tabbar__upload" onClick={onUploadClick} aria-label="Upload">
          <Upload aria-hidden="true" />
        </button>
        {tabbarNav.slice(2).map((item) => (
          <TabbarLink key={item.to} item={item} />
        ))}
      </nav>

      {showScrollTop ? (
        <button
          type="button"
          className="scroll-top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Back to top"
        >
          <ArrowUp aria-hidden="true" />
        </button>
      ) : null}

      <Dialog
        open={logoutConfirmOpen}
        title="Log out?"
        description="You will need to sign in with Google again to open your vault."
        icon={<LogOut aria-hidden="true" />}
        onClose={() => setLogoutConfirmOpen(false)}
        footer={
          <>
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
          </>
        }
      />
    </div>
  )
}

function SidebarLink({ item, count }: { item: NavItem; count?: number }) {
  const Icon = item.icon
  return (
    <NavLink to={item.to} end={item.to === '/'} className="sidebar__link">
      <Icon aria-hidden="true" />
      <span>{item.label}</span>
      {count ? <span className="sidebar__count">{count > 99 ? '99+' : count}</span> : null}
    </NavLink>
  )
}

function TabbarLink({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <NavLink to={item.to} end={item.to === '/'} className="tabbar__link">
      <Icon aria-hidden="true" />
      <span>{item.label}</span>
    </NavLink>
  )
}

function Avatar({ photoURL, initials, large }: { photoURL?: string; initials: string; large?: boolean }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className={large ? 'avatar avatar--large' : 'avatar'} aria-hidden="true">
      {photoURL && !failed ? (
        <img src={photoURL} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        initials
      )}
    </span>
  )
}

function getInitials(value?: string | null) {
  if (!value) return 'DV'
  const parts = value.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
  return (parts.slice(0, 2).map((part) => part[0]).join('') || 'DV').toUpperCase()
}

interface ActivityItem {
  id: string
  icon: LucideIcon
  tone: 'success' | 'accent' | 'danger'
  title: string
  detail: string
  action?: { label: string; run: () => void }
}

function ActivityMenu({
  open,
  onToggle,
  onClose,
  driveConnected,
  onReconnectDrive,
  onOpenUploads,
}: {
  open: boolean
  onToggle: () => void
  onClose: () => void
  driveConnected: boolean
  onReconnectDrive: () => void
  onOpenUploads: () => void
}) {
  const { stats } = useUploadQueue()
  const { stats: deleteStats } = useDeleteQueue()
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())

  const items = useMemo(() => {
    const list: ActivityItem[] = []
    list.push(
      driveConnected
        ? { id: 'drive-on', icon: HardDrive, tone: 'success', title: 'Google Drive connected', detail: 'Your vault is in sync with Drive.' }
        : {
            id: 'drive-off',
            icon: HardDrive,
            tone: 'danger',
            title: 'Google Drive not connected',
            detail: 'Connect Drive to open and upload files.',
            action: { label: 'Connect', run: onReconnectDrive },
          },
    )
    if (stats.pausedForAuth) {
      list.push({
        id: 'upload-paused',
        icon: PauseCircle,
        tone: 'danger',
        title: 'Upload paused',
        detail: 'Reconnect Google Drive to continue.',
        action: { label: 'View', run: onOpenUploads },
      })
    } else if (stats.pausedForNetwork) {
      list.push({
        id: 'upload-offline',
        icon: PauseCircle,
        tone: 'danger',
        title: 'Upload waiting for connection',
        detail: 'It continues by itself when the connection returns.',
        action: { label: 'View', run: onOpenUploads },
      })
    } else if (stats.needsFile > 0 && !stats.running) {
      list.push({
        id: `upload-needs-file-${stats.needsFile}`,
        icon: PauseCircle,
        tone: 'danger',
        title: `${stats.needsFile} upload${stats.needsFile === 1 ? '' : 's'} need their files again`,
        detail: 'Add the same files or folder again to continue. Finished files are skipped.',
        action: { label: 'View', run: onOpenUploads },
      })
    } else if (stats.running) {
      list.push({
        id: 'upload-running',
        icon: CloudUpload,
        tone: 'accent',
        title: `Uploading ${stats.completed + stats.failed} of ${stats.total}`,
        detail: `${stats.progress}% complete`,
        action: { label: 'View', run: onOpenUploads },
      })
    } else if (stats.total > 0) {
      list.push({
        id: `upload-done-${stats.total}-${stats.failed}`,
        icon: stats.failed > 0 ? X : CheckCircle2,
        tone: stats.failed > 0 ? 'danger' : 'success',
        title: stats.failed > 0 ? `${stats.failed} uploads failed` : 'Uploads finished',
        detail: `${stats.completed} of ${stats.total} files uploaded.`,
        action: { label: 'View', run: onOpenUploads },
      })
    }
    if (deleteStats.total > 0) {
      list.push({
        id: `delete-${deleteStats.mode}-${deleteStats.total}`,
        icon: Trash2,
        tone: deleteStats.running ? 'accent' : 'success',
        title: deleteStats.running
          ? deleteStats.mode === 'permanent' ? 'Deleting permanently' : 'Moving to Trash'
          : deleteStats.mode === 'permanent' ? 'Deleted permanently' : 'Moved to Trash',
        detail: `${deleteStats.completed} of ${deleteStats.total} items`,
      })
    }
    return list.filter((item) => !dismissed.has(item.id))
  }, [driveConnected, stats, deleteStats, dismissed, onReconnectDrive, onOpenUploads])

  const attention = items.filter((item) => item.tone !== 'success').length

  return (
    <div className="popover-anchor">
      <button
        type="button"
        className="icon-button"
        onClick={onToggle}
        aria-label={attention ? `Activity, ${attention} need attention` : 'Activity'}
        aria-expanded={open}
      >
        <Bell aria-hidden="true" />
        {attention ? <span className="icon-badge">{attention}</span> : null}
      </button>
      {open ? (
        <>
          <div className="popover-scrim" onClick={onClose} aria-hidden="true" />
          <div className="popover activity-popover" role="dialog" aria-label="Activity">
            <div className="popover__header">
              <strong>Activity</strong>
              <button type="button" className="icon-button" onClick={onClose} aria-label="Close activity">
                <X aria-hidden="true" />
              </button>
            </div>
            {items.length ? (
              <ul className="activity-list">
                {items.map((item) => {
                  const Icon = item.icon
                  return (
                    <li key={item.id} className={`activity-item is-${item.tone}`}>
                      <span className="activity-item__icon">
                        <Icon aria-hidden="true" />
                      </span>
                      <div className="activity-item__text">
                        <strong>{item.title}</strong>
                        <span>{item.detail}</span>
                      </div>
                      {item.action ? (
                        <button
                          type="button"
                          className="ghost-button button--small"
                          onClick={() => {
                            onClose()
                            item.action?.run()
                          }}
                        >
                          {item.action.label}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="icon-button activity-item__dismiss"
                          onClick={() => setDismissed((current) => new Set(current).add(item.id))}
                          aria-label="Dismiss"
                        >
                          <X aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="activity-empty">Nothing needs your attention.</p>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}

function UploadIndicator({ onOpen }: { onOpen: () => void }) {
  const { stats } = useUploadQueue()
  if (stats.total === 0) return null
  const processed = stats.completed + stats.failed

  return (
    <button type="button" className="progress-pill" onClick={onOpen} aria-label="Open upload manager">
      {stats.pausedForAuth || stats.pausedForNetwork || (stats.paused > 0 && !stats.running) ? (
        <PauseCircle aria-hidden="true" />
      ) : stats.running ? (
        <span className="app-spinner" aria-hidden="true" />
      ) : (
        <CheckCircle2 aria-hidden="true" />
      )}
      <span className="progress-pill__label">
        {stats.pausedForNetwork
          ? 'Offline'
          : stats.pausedForAuth || (stats.paused > 0 && !stats.running)
            ? 'Paused'
            : stats.running
              ? 'Uploading'
              : 'Uploads'}
      </span>
      <strong>
        {processed.toLocaleString()}/{stats.total.toLocaleString()}
      </strong>
      {stats.failed > 0 ? <em>{stats.failed} failed</em> : null}
    </button>
  )
}

function DeleteIndicator() {
  const { stats } = useDeleteQueue()
  if (stats.total === 0) return null
  const label = stats.running
    ? stats.mode === 'permanent' ? 'Deleting' : 'Trashing'
    : 'Done'

  return (
    <div
      className="progress-pill"
      role="status"
      title={stats.currentItemName ? `${label}: ${stats.currentItemName}` : label}
    >
      {stats.running ? <span className="app-spinner" aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
      <span className="progress-pill__label">{label}</span>
      <strong>
        {stats.completed}/{stats.total}
      </strong>
    </div>
  )
}
