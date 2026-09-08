import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FileText,
  Folder,
  Star,
  Upload,
  Search,
  Clock,
  MoreVertical,
  ArrowUpRight,
  ShieldCheck,
  Eye,
  Download,
  Edit2,
  Trash2,
  FolderInput,
  Heart,
  HardDrive,
  FolderPlus,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
} from 'lucide-react'
import type { VaultDocument } from '../../types/document'
import type { VaultUser } from '../../types/user'
import { useUploadQueue } from '../../hooks/useUploadQueue'

interface DashboardViewProps {
  user: VaultUser
  documents: VaultDocument[]
  driveConnected: boolean
  onUploadClick: () => void
  onCreateFolder: () => void
  onSearchFocus: () => void
  onView: (documentRecord: VaultDocument) => void
  onDownload: (documentRecord: VaultDocument) => void
  onRename: (documentRecord: VaultDocument) => void
  onFavorite: (documentRecord: VaultDocument) => void
  onTrash: (documentRecord: VaultDocument) => void
  onMove: (documentRecord: VaultDocument) => void
  onReconnectDrive: () => void
}

export function DashboardView({
  user,
  documents,
  driveConnected,
  onUploadClick,
  onCreateFolder,
  onSearchFocus,
  onView,
  onDownload,
  onRename,
  onFavorite,
  onTrash,
  onMove,
  onReconnectDrive,
}: DashboardViewProps) {
  const navigate = useNavigate()
  const { stats, clearCompleted } = useUploadQueue()
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Auto-hide upload widget a few seconds after all uploads complete
  const [uploadWidgetVisible, setUploadWidgetVisible] = useState(false)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (stats.total === 0) {
      setUploadWidgetVisible(false)
      return
    }
    // Show as soon as any upload starts
    setUploadWidgetVisible(true)
    // If everything is done (no pending/uploading/retrying), hide after 3 s
    const allDone = !stats.running && stats.pending === 0 && stats.uploading === 0 && stats.retrying === 0
    if (allDone) {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
      hideTimerRef.current = setTimeout(() => {
        clearCompleted()
        setUploadWidgetVisible(false)
      }, 3000)
    } else {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
    }
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [stats, clearCompleted])

  // Real data filtering
  const activeDocs = useMemo(
    () => documents.filter((d) => !d.isDeleted && d.fileType !== 'folder'),
    [documents]
  )
  const activeFolders = useMemo(
    () => documents.filter((d) => !d.isDeleted && d.fileType === 'folder'),
    [documents]
  )
  const favoriteDocs = useMemo(
    () => documents.filter((d) => !d.isDeleted && d.isFavorite),
    [documents]
  )
  const trashDocs = useMemo(
    () => documents.filter((d) => d.isDeleted),
    [documents]
  )

  // Sort real active files by newest timestamp
  const recentFiles = useMemo(() => {
    return [...activeDocs].sort((a, b) => {
      const aTime = a.updatedAt?.toMillis() ?? a.uploadedAt?.toMillis() ?? 0
      const bTime = b.updatedAt?.toMillis() ?? b.uploadedAt?.toMillis() ?? 0
      return bTime - aTime
    }).slice(0, 10)
  }, [activeDocs])

  // Sort real active folders by newest
  const recentFolders = useMemo(() => {
    return [...activeFolders].sort((a, b) => {
      const aTime = a.updatedAt?.toMillis() ?? a.uploadedAt?.toMillis() ?? 0
      const bTime = b.updatedAt?.toMillis() ?? b.uploadedAt?.toMillis() ?? 0
      return bTime - aTime
    }).slice(0, 5)
  }, [activeFolders])

  // Dynamic real recent activity items generated from user documents
  const recentActivities = useMemo(() => {
    const activities: Array<{ id: string; type: 'upload' | 'opened' | 'moved' | 'deleted'; text: string; timeAgo: string; timestamp: number }> = []

    documents.forEach((d) => {
      const ts = d.updatedAt?.toMillis() ?? d.uploadedAt?.toMillis() ?? Date.now()
      if (d.isDeleted) {
        activities.push({
          id: `del-${d.id}`,
          type: 'deleted',
          text: `You deleted ${d.name}`,
          timeAgo: formatTimeAgo(ts),
          timestamp: ts,
        })
      } else if (d.lastViewedAt) {
        const viewTs = d.lastViewedAt.toMillis()
        activities.push({
          id: `view-${d.id}`,
          type: 'opened',
          text: `You opened ${d.name}`,
          timeAgo: formatTimeAgo(viewTs),
          timestamp: viewTs,
        })
      } else {
        activities.push({
          id: `up-${d.id}`,
          type: 'upload',
          text: `You uploaded ${d.name}`,
          timeAgo: formatTimeAgo(ts),
          timestamp: ts,
        })
      }
    })

    return activities.sort((a, b) => b.timestamp - a.timestamp).slice(0, 5)
  }, [documents])

  const firstName = user.displayName?.split(' ')[0] || 'John'

  const allSelected = recentFiles.length > 0 && recentFiles.every((d) => selectedIds.has(d.id))

  const handleSelectToggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSelectAllToggle = () => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(recentFiles.map((d) => d.id)))
    }
  }

  const selectedDocuments = recentFiles.filter((d) => selectedIds.has(d.id))

  return (
    <div className="dashboard-container">
      {/* 1. WELCOME BANNER */}
      <section className="welcome-banner">
        <div className="welcome-content">
          <h1>Welcome back, {firstName}!</h1>
          <p>Your Document Vault is ready. Access, manage and organize your files with ease and security.</p>
        </div>
        <div className="welcome-illustration">
          <div className="cloud-graphic">
            <div className="cloud-shape">
              <Upload className="cloud-icon" />
            </div>
            <div className="security-badge">
              <ShieldCheck className="shield-icon" />
            </div>
            <div className="floating-tooltip">Your documents are safe with us</div>
          </div>
        </div>
      </section>

      {/* 2. STATS CARDS ROW */}
      <section className="stats-grid">
        <div className="stat-card">
          <div className="stat-header">
            <div className="stat-icon-wrapper stat-blue">
              <FileText />
            </div>
            <span className="stat-badge-pill badge-green">↑ Active</span>
          </div>
          <div className="stat-body">
            <span className="stat-label">Total Files</span>
            <div className="stat-value">{activeDocs.length.toLocaleString()}</div>
            <span className="stat-subtext">Stored in your vault</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <div className="stat-icon-wrapper stat-green">
              <Folder />
            </div>
            <span className="stat-badge-pill badge-green">↑ Folders</span>
          </div>
          <div className="stat-body">
            <span className="stat-label">Folders</span>
            <div className="stat-value">{activeFolders.length.toLocaleString()}</div>
            <span className="stat-subtext">Organized folders</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <div className="stat-icon-wrapper stat-orange">
              <Star />
            </div>
            <span className="stat-badge-pill badge-green">★ Starred</span>
          </div>
          <div className="stat-body">
            <span className="stat-label">Favorites</span>
            <div className="stat-value">{favoriteDocs.length.toLocaleString()}</div>
            <span className="stat-subtext">Starred items</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-header">
            <div className="stat-icon-wrapper stat-purple">
              <Trash2 />
            </div>
            <span className="stat-badge-pill badge-green">Trash</span>
          </div>
          <div className="stat-body">
            <span className="stat-label">Trash Items</span>
            <div className="stat-value">{trashDocs.length.toLocaleString()}</div>
            <span className="stat-subtext">Deleted documents</span>
          </div>
        </div>
      </section>

      {/* 3. MAIN DASHBOARD CONTENT GRID */}
      <div className="dashboard-main-grid">
        {/* LEFT COLUMN: RECENT FILES & FOLDERS */}
        <div className="dashboard-left-col">
          {/* RECENT FILES CARD */}
          <div className="dashboard-card">
            <div className="card-header">
              <div className="card-title">
                <FileText className="title-icon text-blue" />
                <h2>Recent Files</h2>
              </div>
              <div className="card-actions-strip">
                {recentFiles.length > 0 && (
                  <button
                    type="button"
                    className="secondary-button btn-sm"
                    onClick={handleSelectAllToggle}
                  >
                    {allSelected ? 'Clear Selection' : 'Select All'}
                  </button>
                )}
                <button type="button" className="link-button" onClick={() => navigate('/files')}>
                  View all <ArrowUpRight className="link-arrow" />
                </button>
              </div>
            </div>

            <div className="recent-table-wrapper">
              {recentFiles.length > 0 ? (
                <table className="recent-files-table">
                  <thead>
                    <tr>
                      <th className="col-checkbox">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={handleSelectAllToggle}
                          aria-label="Select all files"
                        />
                      </th>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Modified</th>
                      <th>Category</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentFiles.map((doc) => {
                      const fileExt = getFileExtension(doc.name, doc.mimeType)
                      const isSelected = selectedIds.has(doc.id)
                      return (
                        <tr key={doc.id} className={`file-table-row ${isSelected ? 'is-row-selected' : ''}`}>
                          <td className="col-checkbox" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleSelectToggle(doc.id)}
                              aria-label={`Select ${doc.name}`}
                            />
                          </td>
                          <td className="col-name" onClick={() => onView(doc)}>
                            <SmallDocumentThumbnail doc={doc} />
                            <span className="file-name-text" title={doc.name}>
                              {doc.name}
                            </span>
                          </td>
                          <td className="col-type">{getTypeLabel(fileExt)}</td>
                          <td className="col-modified">
                            {formatTimeAgo(doc.updatedAt?.toMillis() ?? doc.uploadedAt?.toMillis())}
                          </td>
                          <td className="col-location">{doc.category || 'Personal'}</td>
                          <td className="col-actions">
                            <div className="menu-container">
                              <button
                                type="button"
                                className="action-icon-btn"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setActiveMenuId(activeMenuId === doc.id ? null : doc.id)
                                }}
                                aria-label="File options"
                              >
                                <MoreVertical size={16} />
                              </button>
                              {activeMenuId === doc.id && (
                                <div className="dropdown-menu" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveMenuId(null)
                                      onView(doc)
                                    }}
                                  >
                                    <Eye size={14} /> Open
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveMenuId(null)
                                      onDownload(doc)
                                    }}
                                  >
                                    <Download size={14} /> Download
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveMenuId(null)
                                      onFavorite(doc)
                                    }}
                                  >
                                    <Heart size={14} /> {doc.isFavorite ? 'Unfavorite' : 'Favorite'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveMenuId(null)
                                      onMove(doc)
                                    }}
                                  >
                                    <FolderInput size={14} /> Move
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveMenuId(null)
                                      onRename(doc)
                                    }}
                                  >
                                    <Edit2 size={14} /> Rename
                                  </button>
                                  <div className="menu-divider" />
                                  <button
                                    type="button"
                                    className="danger"
                                    onClick={() => {
                                      setActiveMenuId(null)
                                      onTrash(doc)
                                    }}
                                  >
                                    <Trash2 size={14} /> Move to Trash
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="inline-empty-state">
                  <Upload className="empty-icon text-blue" />
                  <h3>No documents in your vault yet</h3>
                  <p>Upload your first document or folder to get started with Document Vault.</p>
                  <button type="button" className="primary-button" onClick={onUploadClick}>
                    <Upload size={16} />
                    <span>Upload Document</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* YOUR FOLDERS CARD */}
          <div className="dashboard-card">
            <div className="card-header">
              <div className="card-title">
                <Folder className="title-icon text-yellow" />
                <h2>Your Folders</h2>
              </div>
              <button type="button" className="link-button" onClick={() => navigate('/folders')}>
                View all <ArrowUpRight className="link-arrow" />
              </button>
            </div>

            {recentFolders.length > 0 ? (
              <div className="folders-grid">
                {recentFolders.map((folder) => {
                  const nestedCount = documents.filter((d) => d.parentId === folder.id && !d.isDeleted).length
                  return (
                    <div
                      key={folder.id}
                      className="folder-card"
                      onClick={() => navigate(`/folders/${folder.id}`)}
                    >
                      <div className="folder-icon-wrapper">
                        <Folder className="folder-icon" />
                      </div>
                      <div className="folder-details">
                        <h3 className="folder-name" title={folder.name}>
                          {folder.name}
                        </h3>
                        <span className="folder-count">{nestedCount} {nestedCount === 1 ? 'file' : 'files'}</span>
                        <span className="folder-modified">
                          Modified {formatTimeAgo(folder.updatedAt?.toMillis() ?? folder.uploadedAt?.toMillis())}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="inline-empty-state">
                <FolderPlus className="empty-icon text-yellow" />
                <h3>No folders created yet</h3>
                <p>Create folders to keep your documents structured and organized.</p>
                <button type="button" className="secondary-button" onClick={onCreateFolder}>
                  <FolderPlus size={16} />
                  <span>Create Folder</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: WIDGETS */}
        <div className="dashboard-right-col">
          {/* UPLOAD PROGRESS WIDGET — only shown while an upload session is active */}
          {uploadWidgetVisible && (
            <div className="upload-status-card">
              {/* Header row */}
              <div className="usc-header">
                <div className="usc-title">
                  {stats.running || stats.uploading > 0 ? (
                    <Loader2 className="usc-icon spinning" size={16} />
                  ) : stats.failed > 0 ? (
                    <AlertCircle className="usc-icon usc-icon-error" size={16} />
                  ) : (
                    <CheckCircle2 className="usc-icon usc-icon-done" size={16} />
                  )}
                  <span className="usc-label">
                    {stats.running || stats.uploading > 0
                      ? 'Uploading files…'
                      : stats.failed > 0
                      ? 'Some uploads failed'
                      : `${stats.completed} / ${stats.total} uploaded`}
                  </span>
                </div>
                <button
                  type="button"
                  className="usc-dismiss"
                  title="Dismiss"
                  onClick={() => { clearCompleted(); setUploadWidgetVisible(false) }}
                >
                  <X size={14} />
                </button>
              </div>

              {/* Progress bar */}
              <div className="usc-bar-track">
                <div
                  className={`usc-bar-fill${
                    stats.failed > 0 ? ' usc-bar-error' : stats.running ? ' usc-bar-active' : ' usc-bar-done'
                  }`}
                  style={{ width: `${stats.total > 0 ? Math.round(((stats.completed + stats.failed) / stats.total) * 100) : 0}%` }}
                />
              </div>

              {/* Stats row */}
              <div className="usc-stats">
                <span className="usc-stat">
                  <span className="usc-dot usc-dot-done" />
                  {stats.completed} done
                </span>
                {stats.uploading > 0 && (
                  <span className="usc-stat">
                    <span className="usc-dot usc-dot-active" />
                    {stats.uploading} uploading
                  </span>
                )}
                {stats.pending > 0 && (
                  <span className="usc-stat">
                    <span className="usc-dot usc-dot-pending" />
                    {stats.pending} pending
                  </span>
                )}
                {stats.failed > 0 && (
                  <span className="usc-stat">
                    <span className="usc-dot usc-dot-error" />
                    {stats.failed} failed
                  </span>
                )}
                <button type="button" className="usc-action" onClick={onUploadClick}>
                  Details
                </button>
              </div>
            </div>
          )}

          {/* QUICK ACTIONS WIDGET */}
          <div className="dashboard-card">
            <div className="card-header">
              <div className="card-title">
                <Clock className="title-icon" />
                <h2>Quick Actions</h2>
              </div>
            </div>

            <div className="quick-actions-grid">
              <button type="button" className="action-tile btn-blue" onClick={onUploadClick}>
                <Upload className="tile-icon" />
                <span>Upload Files</span>
              </button>

              <button type="button" className="action-tile btn-green" onClick={onCreateFolder}>
                <Folder className="tile-icon" />
                <span>Create Folder</span>
              </button>

              <button
                type="button"
                className="action-tile btn-drive"
                onClick={driveConnected ? onUploadClick : onReconnectDrive}
              >
                <HardDrive className="tile-icon" />
                <span>Google Drive</span>
              </button>

              <button type="button" className="action-tile btn-blue-outline" onClick={onSearchFocus}>
                <Search className="tile-icon" />
                <span>Search</span>
              </button>
            </div>
          </div>

          {/* RECENT ACTIVITY WIDGET */}
          <div className="dashboard-card">
            <div className="card-header">
              <div className="card-title">
                <Clock className="title-icon" />
                <h2>Recent Activity</h2>
              </div>
              <button type="button" className="link-button" onClick={() => navigate('/recent')}>
                View all <ArrowUpRight className="link-arrow" />
              </button>
            </div>

            <div className="activity-list">
              {recentActivities.length > 0 ? (
                recentActivities.map((act) => (
                  <div key={act.id} className="activity-item">
                    <div className={`activity-badge badge-${act.type}`}>
                      {act.type === 'upload' && <Upload size={14} />}
                      {act.type === 'opened' && <FileText size={14} />}
                      {act.type === 'moved' && <FolderInput size={14} />}
                      {act.type === 'deleted' && <Trash2 size={14} />}
                    </div>
                    <div className="activity-info">
                      <span className="activity-text">{act.text}</span>
                      <span className="activity-time">{act.timeAgo}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="empty-subtext">No recent activity logged yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* BULK TOOLBAR FOR SELECTED RECENT FILES */}
      {selectedDocuments.length > 0 && (
        <div className="bulk-toolbar" role="toolbar" aria-label="Bulk actions">
          <span className="bulk-toolbar-info">
            <strong>{selectedDocuments.length}</strong> {selectedDocuments.length === 1 ? 'item' : 'items'} selected
          </span>
          <div className="bulk-toolbar-actions">
            <button
              type="button"
              className="bulk-action-btn"
              onClick={() => {
                selectedDocuments.forEach(onDownload)
                setSelectedIds(new Set())
              }}
            >
              <Download size={14} />
              Download
            </button>
            <button
              type="button"
              className="bulk-action-btn"
              onClick={() => {
                selectedDocuments.forEach(onFavorite)
                setSelectedIds(new Set())
              }}
            >
              <Heart size={14} />
              Favorite
            </button>
            <button
              type="button"
              className="bulk-action-btn"
              onClick={() => {
                if (selectedDocuments[0]) onMove(selectedDocuments[0])
                setSelectedIds(new Set())
              }}
            >
              <FolderInput size={14} />
              Move
            </button>
            <div className="bulk-toolbar-divider" />
            <button
              type="button"
              className="bulk-action-btn danger"
              onClick={() => {
                selectedDocuments.forEach(onTrash)
                setSelectedIds(new Set())
              }}
            >
              <Trash2 size={14} />
              Delete
            </button>
            <div className="bulk-toolbar-divider" />
            <button type="button" className="bulk-action-cancel" onClick={() => setSelectedIds(new Set())}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SmallDocumentThumbnail({ doc }: { doc: VaultDocument }) {
  const [imgError, setImgError] = useState(false)
  const isFolder = doc.fileType === 'folder'

  const driveThumbnailUrl = useMemo(() => {
    if (isFolder) return null
    if (doc.thumbnailUrl) {
      return doc.thumbnailUrl.replace(/=s\d+/, '=s200')
    }
    if (doc.driveFileId) {
      return `https://lh3.googleusercontent.com/d/${doc.driveFileId}=s200`
    }
    return null
  }, [isFolder, doc.thumbnailUrl, doc.driveFileId])

  const isImage = doc.fileType === 'image'
  const directImageUrl = (isImage && (doc.thumbnailUrl || (doc as { storageUrl?: string }).storageUrl)) || null
  const targetUrl = driveThumbnailUrl || directImageUrl

  if (targetUrl && !imgError && !isFolder) {
    return (
      <div className="small-doc-thumbnail-wrap">
        <img
          src={targetUrl}
          alt={`Thumbnail of ${doc.name}`}
          className="small-doc-thumbnail-img"
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setImgError(true)}
        />
      </div>
    )
  }

  const fileExt = getFileExtension(doc.name, doc.mimeType)
  return <FileTypeBadge ext={fileExt} name={doc.name} />
}

function FileTypeBadge({ ext, name }: { ext: string; name: string }) {
  const lowerExt = ext.toLowerCase() || getFileExtension(name)
  let badgeClass = 'ext-badge-slate'
  let label = lowerExt.toUpperCase()

  if (['pdf'].includes(lowerExt)) {
    badgeClass = 'ext-badge-red'
    label = 'PDF'
  } else if (['docx', 'doc', 'document', 'word'].includes(lowerExt)) {
    badgeClass = 'ext-badge-blue'
    label = 'W'
  } else if (['xlsx', 'xls', 'spreadsheet', 'excel', 'csv'].includes(lowerExt)) {
    badgeClass = 'ext-badge-green'
    label = 'X'
  } else if (['pptx', 'ppt', 'presentation', 'powerpoint'].includes(lowerExt)) {
    badgeClass = 'ext-badge-orange'
    label = 'P'
  } else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'image'].includes(lowerExt)) {
    badgeClass = 'ext-badge-purple'
    label = 'IMG'
  } else if (['html', 'htm'].includes(lowerExt)) {
    badgeClass = 'ext-badge-pink'
    label = 'HTML'
  } else if (['zip', 'rar', '7z', 'tar', 'gz'].includes(lowerExt)) {
    badgeClass = 'ext-badge-amber'
    label = 'ZIP'
  } else if (['txt', 'md', 'text'].includes(lowerExt)) {
    badgeClass = 'ext-badge-slate'
    label = 'TXT'
  }

  return <span className={`file-type-badge ${badgeClass}`}>{label}</span>
}

function getFileExtension(filename: string, mimeType?: string): string {
  if (mimeType?.includes('pdf')) return 'pdf'
  if (mimeType?.includes('word') || mimeType?.includes('document')) return 'docx'
  if (mimeType?.includes('sheet') || mimeType?.includes('excel')) return 'xlsx'
  if (mimeType?.includes('presentation') || mimeType?.includes('powerpoint')) return 'pptx'
  if (mimeType?.includes('image')) return 'jpg'
  if (mimeType?.includes('html')) return 'html'

  const parts = filename.split('.')
  if (parts.length > 1) return parts.pop()!
  return 'file'
}

function getTypeLabel(ext: string): string {
  const e = ext.toLowerCase()
  if (e === 'pdf') return 'PDF'
  if (['docx', 'doc', 'document'].includes(e)) return 'Word'
  if (['xlsx', 'xls', 'spreadsheet', 'csv'].includes(e)) return 'Excel'
  if (['pptx', 'ppt', 'presentation'].includes(e)) return 'PowerPoint'
  if (['jpg', 'jpeg', 'png', 'image'].includes(e)) return 'Image'
  if (['html', 'htm'].includes(e)) return 'HTML'
  if (['txt', 'text'].includes(e)) return 'Text'
  if (['zip', 'rar'].includes(e)) return 'Zip Archive'
  return 'Document'
}

function formatTimeAgo(timestampMs?: number): string {
  if (!timestampMs) return 'Recently'
  const diffHours = Math.floor((Date.now() - timestampMs) / (1000 * 60 * 60))
  if (diffHours < 1) return 'Just now'
  if (diffHours === 1) return '1 hour ago'
  if (diffHours < 24) return `${diffHours} hours ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return '1 day ago'
  return `${diffDays} days ago`
}
