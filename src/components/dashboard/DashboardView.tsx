import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Eye,
  FolderPlus,
  Loader2,
  Search,
  Upload,
  X,
} from 'lucide-react'
import type { VaultDocument, ViewMode } from '../../types/document'
import type { VaultUser } from '../../types/user'
import { useUploadQueue } from '../../hooks/useUploadQueue'
import { DocumentCollection, type BulkActions } from '../documents/DocumentCollection'
import type { ItemActions } from '../documents/DocumentCard'
import { DocumentIcon } from '../documents/DocumentIcon'
import { EmptyState } from '../ui/EmptyState'
import { LoadingState } from '../ui/LoadingState'
import { StatsBar } from './StatsBar'
import { lastActivity } from '../../utils/sorting'

interface DashboardViewProps {
  user: VaultUser
  documents: VaultDocument[]
  allDocuments: VaultDocument[]
  trashCount: number
  loading: boolean
  error: string | null
  accessToken?: string | null
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  actions: ItemActions
  bulk: BulkActions
  onUploadClick: () => void
  onUploadProgressClick: () => void
  onCreateFolder: () => void
  search: string
  onSearchChange: (value: string) => void
}

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function DashboardView({
  user,
  documents,
  allDocuments,
  trashCount,
  loading,
  error,
  accessToken,
  viewMode,
  onViewModeChange,
  actions,
  bulk,
  onUploadClick,
  onUploadProgressClick,
  onCreateFolder,
  search,
  onSearchChange,
}: DashboardViewProps) {
  const files = useMemo(() => documents.filter((record) => record.fileType !== 'folder'), [documents])
  const folders = useMemo(() => documents.filter((record) => record.fileType === 'folder'), [documents])
  const favoriteCount = useMemo(() => documents.filter((record) => record.isFavorite).length, [documents])

  const recentFiles = useMemo(
    () => [...files].sort((first, second) => lastActivity(second) - lastActivity(first)).slice(0, 8),
    [files],
  )
  const recentFolders = useMemo(
    () => [...folders].sort((first, second) => second.updatedAt.toMillis() - first.updatedAt.toMillis()).slice(0, 6),
    [folders],
  )
  const childCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const record of documents) {
      if (record.parentId) counts.set(record.parentId, (counts.get(record.parentId) ?? 0) + 1)
    }
    return counts
  }, [documents])
  const recentlyOpened = useMemo(
    () =>
      files
        .filter((record) => record.lastViewedAt)
        .sort((first, second) => second.lastViewedAt!.toMillis() - first.lastViewedAt!.toMillis())
        .slice(0, 5),
    [files],
  )

  const firstName = user.displayName?.split(' ')[0] || 'there'

  const summary = [
    { label: files.length === 1 ? 'file' : 'files', value: files.length, to: '/files' },
    { label: folders.length === 1 ? 'folder' : 'folders', value: folders.length, to: '/folders' },
    { label: favoriteCount === 1 ? 'favorite' : 'favorites', value: favoriteCount, to: '/favorites' },
    { label: 'in Trash', value: trashCount, to: '/trash' },
  ]

  return (
    <section className="page dashboard">
      <header className="dash-hero">
        <div>
          <p className="dash-hero__eyebrow">{greeting()}</p>
          <h1>Welcome back, {firstName}</h1>
        </div>
        <div className="dash-hero__actions">
          <button type="button" className="secondary-button" onClick={onCreateFolder}>
            <FolderPlus aria-hidden="true" />
            <span>New folder</span>
          </button>
          <button type="button" className="primary-button" onClick={onUploadClick}>
            <Upload aria-hidden="true" />
            <span>Upload</span>
          </button>
        </div>
        <label className="search-box dash-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search names, #tags and text inside documents"
            aria-label="Search your vault"
          />
        </label>
        {loading || documents.length === 0 ? null : (
          <nav className="dash-summary" aria-label="Library summary">
            {summary.map((item) => (
              <Link key={item.to} to={item.to}>
                <strong>{item.value.toLocaleString()}</strong> {item.label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      {error ? <div className="notice notice--error">{error}</div> : null}

      <div className="dashboard__grid">
        <div className="dashboard__main">
          <section className="panel">
            <header className="panel__header">
              <h2>Recent files</h2>
              <Link to="/recent" className="panel__link">
                View all <ArrowRight aria-hidden="true" />
              </Link>
            </header>
            {loading ? (
              <LoadingState />
            ) : (
              <DocumentCollection
                items={recentFiles}
                allDocuments={allDocuments}
                viewMode={viewMode}
                onViewModeChange={onViewModeChange}
                actions={actions}
                bulk={bulk}
                accessToken={accessToken}
                empty={
                  <EmptyState
                    icon={<Upload aria-hidden="true" />}
                    title="Your vault is empty"
                    message="Upload files or a whole folder from your computer. They are stored in your Google Drive."
                    action={
                      <button type="button" className="primary-button" onClick={onUploadClick}>
                        <Upload aria-hidden="true" />
                        <span>Upload documents</span>
                      </button>
                    }
                  />
                }
              />
            )}
          </section>

          <section className="panel">
            <header className="panel__header">
              <h2>Folders</h2>
              <Link to="/folders" className="panel__link">
                View all <ArrowRight aria-hidden="true" />
              </Link>
            </header>
            {recentFolders.length > 0 ? (
              <div className="folder-tiles">
                {recentFolders.map((folder) => {
                  const count = childCounts.get(folder.id) ?? 0
                  return (
                    <Link key={folder.id} to={`/folders/${folder.id}`} className="folder-tile">
                      <DocumentIcon kind="folder" size={20} />
                      <span className="folder-tile__text">
                        <strong title={folder.name}>{folder.name}</strong>
                        <span>
                          {count} {count === 1 ? 'item' : 'items'}
                        </span>
                      </span>
                    </Link>
                  )
                })}
              </div>
            ) : (
              <div className="panel__empty">
                <p>No folders yet. Folders keep related documents together.</p>
                <button type="button" className="secondary-button button--small" onClick={onCreateFolder}>
                  <FolderPlus aria-hidden="true" />
                  <span>New folder</span>
                </button>
              </div>
            )}
          </section>
        </div>

        <aside className="dashboard__side">
          <UploadStatusCard onOpen={onUploadProgressClick} />

          <section className="panel">
            <header className="panel__header">
              <h2>Storage by type</h2>
            </header>
            <StatsBar documents={documents} />
          </section>

          <section className="panel">
            <header className="panel__header">
              <h2>Recently opened</h2>
            </header>
            {recentlyOpened.length > 0 ? (
              <ul className="opened-list">
                {recentlyOpened.map((record) => (
                  <li key={record.id}>
                    <button type="button" onClick={() => actions.onView(record)}>
                      <DocumentIcon kind={record.fileType} size={16} />
                      <span className="opened-list__name">{record.name}</span>
                      <span className="opened-list__time">{timeAgo(record.lastViewedAt!.toMillis())}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="panel__empty-text">
                <Eye aria-hidden="true" />
                Documents you open will be listed here.
              </p>
            )}
          </section>
        </aside>
      </div>
    </section>
  )
}

// Upload summary shown while a batch is running, cleared a few seconds after it finishes.
function UploadStatusCard({ onOpen }: { onOpen: () => void }) {
  const { stats, clearCompleted } = useUploadQueue()
  const active = stats.running || stats.pending > 0 || stats.uploading > 0 || stats.retrying > 0
  const finishedCleanly = stats.total > 0 && !active && stats.failed === 0

  useEffect(() => {
    if (!finishedCleanly) return undefined
    const timer = setTimeout(clearCompleted, 4000)
    return () => clearTimeout(timer)
  }, [finishedCleanly, clearCompleted])

  if (stats.total === 0) return null

  const percent = Math.round(((stats.completed + stats.failed) / stats.total) * 100)
  const tone = stats.failed > 0 ? 'is-error' : active ? 'is-active' : 'is-done'

  return (
    <section className={`panel upload-card ${tone}`}>
      <header className="upload-card__header">
        {active ? (
          <Loader2 className="spinning" aria-hidden="true" />
        ) : stats.failed > 0 ? (
          <AlertCircle aria-hidden="true" />
        ) : (
          <CheckCircle2 aria-hidden="true" />
        )}
        <strong>
          {active ? 'Uploading files' : stats.failed > 0 ? 'Some uploads failed' : 'Upload complete'}
        </strong>
        <button type="button" className="icon-button" onClick={clearCompleted} aria-label="Dismiss">
          <X aria-hidden="true" />
        </button>
      </header>
      <div className="progress-track" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="upload-card__meta">
        {stats.completed} of {stats.total} done
        {stats.failed > 0 ? ` · ${stats.failed} failed` : ''}
        {stats.pending > 0 ? ` · ${stats.pending} waiting` : ''}
      </p>
      <button type="button" className="ghost-button button--small" onClick={onOpen}>
        Show details
      </button>
    </section>
  )
}

function timeAgo(timestamp: number) {
  const minutes = Math.floor((Date.now() - timestamp) / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} d ago`
  return new Date(timestamp).toLocaleDateString()
}
