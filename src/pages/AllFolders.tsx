import { useState, useMemo } from 'react'
import {
  FolderPlus,
  Search,
  Archive,
  Folder,
  FileText,
  HardDrive,
  Cloud,
  UploadCloud,
  Sparkles,
  LayoutGrid,
  List,
  Filter,
  ArrowUpRight,
  ChevronDown,
} from 'lucide-react'
import { DocumentCard } from '../components/documents/DocumentCard'
import { EmptyState } from '../components/ui/EmptyState'
import { LoadingState } from '../components/ui/LoadingState'
import type { VaultDocument } from '../types/document'
import type { VaultUser } from '../types/user'
import { formatFileSize } from '../utils/formatters'

interface AllFoldersProps {
  documents: VaultDocument[]
  accessToken?: string | null
  loading: boolean
  error: string | null
  currentUser: VaultUser
  onCreateFolder: () => void
  onUploadClick?: () => void
  onView: (documentRecord: VaultDocument) => void
  onDownload: (documentRecord: VaultDocument) => void
  onRename: (documentRecord: VaultDocument) => void
  onFavorite: (documentRecord: VaultDocument) => void
  onTrash: (documentRecord: VaultDocument) => void
  onMove: (documentRecord: VaultDocument) => void
}

export function AllFolders({
  documents,
  accessToken,
  loading,
  error,
  onCreateFolder,
  onUploadClick,
  onView,
  onDownload,
  onRename,
  onFavorite,
  onTrash,
  onMove,
}: AllFoldersProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [sortBy, setSortBy] = useState<'name' | 'items' | 'date'>('name')

  // Filter & sort folders
  const folders = useMemo(() => {
    const all = documents.filter((d) => d.fileType === 'folder' && !d.isDeleted)
    const q = searchQuery.trim().toLowerCase()
    let filtered = q ? all.filter((f) => f.name.toLowerCase().includes(q)) : all

    return filtered.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      if (sortBy === 'date') return (b.updatedAt?.toMillis() ?? 0) - (a.updatedAt?.toMillis() ?? 0)
      if (sortBy === 'items') {
        const countA = documents.filter((d) => d.parentId === a.id && !d.isDeleted).length
        const countB = documents.filter((d) => d.parentId === b.id && !d.isDeleted).length
        return countB - countA
      }
      return 0
    })
  }, [documents, searchQuery, sortBy])

  // Total Files count (non-folder active documents)
  const totalFilesCount = useMemo(() => {
    return documents.filter((d) => d.fileType !== 'folder' && !d.isDeleted).length
  }, [documents])

  // Total Storage bytes
  const totalStorageBytes = useMemo(() => {
    return documents
      .filter((d) => d.fileType !== 'folder' && !d.isDeleted)
      .reduce((sum, doc) => sum + (doc.fileSize || 0), 0)
  }, [documents])

  const formattedStorage = useMemo(() => {
    if (totalStorageBytes === 0) return '0 B'
    return formatFileSize(totalStorageBytes)
  }, [totalStorageBytes])

  const isDriveConnected = Boolean(accessToken)

  return (
    <div className="all-folders-container">
      {/* ── 1. Page Header ── */}
      <div className="all-folders-header">
        <div className="all-folders-header-left">
          <div className="all-folders-title-badge">
            <Folder size={22} className="all-folders-icon-main" />
          </div>
          <div>
            <h1 className="all-folders-title">All Folders</h1>
            <p className="all-folders-subtitle">
              Browse and manage all your folders. Click on a folder to view its contents.
            </p>
          </div>
        </div>

        <div className="all-folders-header-actions">
          <button type="button" className="all-folders-new-btn" onClick={onCreateFolder}>
            <FolderPlus size={16} />
            <span>New Folder</span>
          </button>

          <div className="all-folders-sort-dropdown">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'name' | 'items' | 'date')}
              aria-label="Sort folders"
            >
              <option value="name">Sort: Name (A-Z)</option>
              <option value="items">Sort: File Count</option>
              <option value="date">Sort: Date Modified</option>
            </select>
            <ChevronDown size={14} className="sort-chevron" />
          </div>

          <div className="all-folders-view-toggle">
            <button
              type="button"
              className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid View"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              type="button"
              className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title="List View"
            >
              <List size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* ── 2. Metric Stat Cards Row ── */}
      <div className="all-folders-stats-grid">
        {/* Card 1: Total Folders */}
        <div className="stat-card">
          <div className="stat-card-header">
            <div className="stat-icon-chip blue-chip">
              <Folder size={18} />
            </div>
            <span className="stat-label">Total Folders</span>
          </div>
          <div className="stat-value">{folders.length}</div>
          <div className="stat-badge green-badge">
            <ArrowUpRight size={13} />
            <span>+2 this month</span>
          </div>
        </div>

        {/* Card 2: Total Files */}
        <div className="stat-card">
          <div className="stat-card-header">
            <div className="stat-icon-chip blue-chip">
              <FileText size={18} />
            </div>
            <span className="stat-label">Total Files</span>
          </div>
          <div className="stat-value">{totalFilesCount.toLocaleString()}</div>
          <div className="stat-badge green-badge">
            <ArrowUpRight size={13} />
            <span>+88 this month</span>
          </div>
        </div>

        {/* Card 3: Storage Used */}
        <div className="stat-card">
          <div className="stat-card-header">
            <div className="stat-icon-chip blue-chip">
              <HardDrive size={18} />
            </div>
            <span className="stat-label">Storage Used</span>
          </div>
          <div className="stat-value">{formattedStorage}</div>
          <div className="stat-progress-bar">
            <div className="stat-progress-fill" style={{ width: '43%' }} />
          </div>
          <span className="stat-progress-text">43% of 100 GB</span>
        </div>

        {/* Card 4: Google Drive */}
        <div className="stat-card">
          <div className="stat-card-header">
            <div className="stat-icon-chip drive-chip">
              <Cloud size={18} />
            </div>
            <span className="stat-label">Google Drive</span>
          </div>
          <div className="stat-value-sm">Google Drive</div>
          <div className={`stat-status-tag ${isDriveConnected ? 'connected' : 'disconnected'}`}>
            <span className="status-dot-pulse" />
            <span>{isDriveConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
        </div>
      </div>

      {/* ── 3. Your Folders Sub-Header & Search ── */}
      <div className="your-folders-bar">
        <div className="your-folders-title-wrap">
          <Folder size={18} className="your-folders-icon" />
          <h2 className="your-folders-title">Your Folders</h2>
        </div>

        <div className="your-folders-search-wrap">
          <div className="your-folders-search-box">
            <Search size={16} />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search folders..."
              aria-label="Search folders"
            />
          </div>
          <button type="button" className="your-folders-filter-btn" title="Filter folders">
            <Filter size={15} />
          </button>
        </div>
      </div>

      {/* ── 4. Content Area: Folders Grid/List ── */}
      {error && <div className="notice notice--error">{error}</div>}
      {loading && <LoadingState />}

      {!loading && folders.length === 0 ? (
        <EmptyState
          icon={<Archive aria-hidden="true" />}
          title={searchQuery ? `No folders found for "${searchQuery}"` : 'No folders yet'}
          message={
            searchQuery
              ? 'Try searching for a different folder name.'
              : 'Create your first folder to organize files in your vault.'
          }
          action={
            <button type="button" className="primary-button" onClick={onCreateFolder}>
              <FolderPlus aria-hidden="true" />
              <span>Create Folder</span>
            </button>
          }
        />
      ) : null}

      {!loading && folders.length > 0 ? (
        <div className={viewMode === 'grid' ? 'folders-grid-layout' : 'documents-list'}>
          {folders.map((folder) => {
            const itemCount = documents.filter((d) => d.parentId === folder.id && !d.isDeleted).length
            return (
              <DocumentCard
                key={folder.id}
                documentRecord={folder}
                mode={viewMode}
                itemCount={itemCount}
                accessToken={accessToken}
                onView={onView}
                onDownload={onDownload}
                onRename={onRename}
                onFavorite={onFavorite}
                onTrash={onTrash}
                onMove={onMove}
                onRestore={() => {}}
                onPermanentDelete={() => {}}
              />
            )
          })}
        </div>
      ) : null}

      {/* ── 5. Bottom Folder Upload Callout Banner ── */}
      <div className="folder-upload-banner">
        <div className="banner-left">
          <div className="banner-icon-circle">
            <Sparkles size={20} />
          </div>
          <div className="banner-text">
            <strong>Need to upload a new folder?</strong>
            <p>You can upload an entire folder with multiple files and subfolders at once.</p>
          </div>
        </div>
        {onUploadClick && (
          <button type="button" className="banner-upload-btn" onClick={onUploadClick}>
            <UploadCloud size={16} />
            <span>Upload Folder</span>
          </button>
        )}
      </div>
    </div>
  )
}
