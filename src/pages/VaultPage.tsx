import { Archive, FolderPlus, Grid2X2, List, Search, Upload, Trash2, FolderInput, Heart, Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DocumentCard } from '../components/documents/DocumentCard'
import { EmptyState } from '../components/ui/EmptyState'
import { LoadingState } from '../components/ui/LoadingState'
import type { DocumentCategory, SortMode, VaultDocument, ViewMode } from '../types/document'
import type { VaultUser } from '../types/user'
import { filterAndSortDocuments } from '../hooks/useDocuments'
import { Breadcrumbs } from '../components/ui/Breadcrumbs'
import { StatsBar } from '../components/dashboard/StatsBar'

interface VaultPageProps {
  title: string
  description: string
  documents: VaultDocument[]
  loading: boolean
  error: string | null
  search: string
  viewMode: ViewMode
  sortMode: SortMode
  category: DocumentCategory | 'All'
  categories: DocumentCategory[]
  currentUser: VaultUser
  emptyTitle: string
  emptyMessage: string
  inTrash?: boolean
  documentOnly?: boolean
  onCreateFolder?: () => void
  currentFolderId?: string | null
  folderPath?: VaultDocument[]
  onViewModeChange: (mode: ViewMode) => void
  onSortModeChange: (mode: SortMode) => void
  onCategoryChange: (category: DocumentCategory | 'All') => void
  onUploadClick: () => void
  onView: (documentRecord: VaultDocument) => void
  onDownload: (documentRecord: VaultDocument) => void
  onRename: (documentRecord: VaultDocument) => void
  onFavorite: (documentRecord: VaultDocument) => void
  onTrash: (documentRecord: VaultDocument) => void
  onRestore: (documentRecord: VaultDocument) => void
  onPermanentDelete: (documentRecord: VaultDocument) => void
  onMove?: (documentRecord: VaultDocument) => void
  onBulkTrash?: (selectedItems: VaultDocument[]) => void
  onBulkMove?: (selectedItems: VaultDocument[]) => void
  onBulkFavorite?: (selectedItems: VaultDocument[]) => void
  onBulkDownload?: (selectedItems: VaultDocument[]) => void
}

export function VaultPage({
  title,
  description,
  documents,
  loading,
  error,
  search,
  viewMode,
  sortMode,
  category,
  categories,
  currentUser,
  emptyTitle,
  emptyMessage,
  inTrash,
  documentOnly,
  onCreateFolder,
  currentFolderId = null,
  folderPath = [],
  onViewModeChange,
  onSortModeChange,
  onCategoryChange,
  onUploadClick,
  onView,
  onDownload,
  onRename,
  onFavorite,
  onTrash,
  onRestore,
  onPermanentDelete,
  onMove,
  onBulkTrash,
  onBulkMove,
  onBulkFavorite,
  onBulkDownload,
}: VaultPageProps) {
  const [categoryStatsOpen, setCategoryStatsOpen] = useState(false)
  const [folderSearch, setFolderSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const handleSelectToggle = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const effectiveSortMode = documentOnly ? 'newest' : sortMode
  const effectiveCategory = documentOnly ? 'All' : category
  const rawVisible = useMemo(
    () => filterAndSortDocuments(documents, search, effectiveSortMode, effectiveCategory, currentFolderId),
    [documents, search, effectiveSortMode, effectiveCategory, currentFolderId],
  )
  const visibleDocuments = useMemo(() => {
    const q = folderSearch.trim().toLowerCase()
    const filtered = q ? rawVisible.filter((d) => d.name.toLowerCase().includes(q)) : rawVisible
    // Folders always appear before files
    const folders = filtered.filter((d) => d.fileType === 'folder')
    const files = filtered.filter((d) => d.fileType !== 'folder')
    return [...folders, ...files]
  }, [rawVisible, folderSearch])

  const activeDocuments = documents.filter((documentRecord) => !documentRecord.isDeleted)
  const favoriteCount = activeDocuments.filter((documentRecord) => documentRecord.isFavorite).length
  const ownerName = currentUser.displayName?.split(' ')[0] ?? 'there'
  const folderPathLabel = useMemo(
    () => new Map(documents.map((documentRecord) => [documentRecord.id, buildPathLabel(documents, documentRecord.parentId ?? null)])),
    [documents],
  )

  return (
    <section className="page-section">
      {folderPath && folderPath.length > 0 && (
        <Breadcrumbs path={folderPath} />
      )}

      {!documentOnly ? (
        <>
          <div className="dashboard-hero">
            <div>
              <span>Good day, {ownerName}</span>
              <h1>{title}</h1>
              <p>{description}</p>
            </div>
            <div className="metric-strip">
              <div>
                <strong>{activeDocuments.length}</strong>
                <span>Documents</span>
              </div>
              <div>
                <strong>{favoriteCount}</strong>
                <span>Favorites</span>
              </div>
              <div>
                <strong>{documents.filter((documentRecord) => documentRecord.isDeleted).length}</strong>
                <span>Trash</span>
              </div>
            </div>
          </div>

          {!inTrash && <StatsBar documents={documents} />}
        </>
      ) : (
        <header className="document-only-header">
          <h1>{title}</h1>
          <p>{visibleDocuments.length} {visibleDocuments.length === 1 ? 'document' : 'documents'}</p>
        </header>
      )}

      {!documentOnly ? (
        <div className="toolbar">
          <div className="toolbar-group">
            <select
              value={category}
              onChange={(event) => onCategoryChange(event.target.value as DocumentCategory | 'All')}
              aria-label="Filter by category"
            >
              <option>All</option>
              {categories.map((categoryName) => (
                <option key={categoryName}>{categoryName}</option>
              ))}
            </select>
            <select
              value={sortMode}
              onChange={(event) => onSortModeChange(event.target.value as SortMode)}
              aria-label="Sort documents"
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="name-asc">Name A-Z</option>
              <option value="name-desc">Name Z-A</option>
              <option value="largest">Largest</option>
              <option value="smallest">Smallest</option>
              <option value="updated">Recently updated</option>
            </select>
            {currentFolderId ? (
              <label className="search-box search-box--inline">
                <Search aria-hidden="true" />
                <input
                  value={folderSearch}
                  onChange={(e) => setFolderSearch(e.target.value)}
                  placeholder="Search this folder…"
                  type="search"
                  aria-label="Search within current folder"
                />
              </label>
            ) : null}
          </div>
          <div className="toolbar-group">
            <button
              type="button"
              className={viewMode === 'grid' ? 'segmented is-active' : 'segmented'}
              onClick={() => onViewModeChange('grid')}
              aria-label="Grid view"
            >
              <Grid2X2 aria-hidden="true" />
            </button>
            <button
              type="button"
              className={viewMode === 'list' ? 'segmented is-active' : 'segmented'}
              onClick={() => onViewModeChange('list')}
              aria-label="List view"
            >
              <List aria-hidden="true" />
            </button>
            {onCreateFolder && !inTrash && (
              <button type="button" className="secondary-button" onClick={onCreateFolder} aria-label="New folder">
                <FolderPlus aria-hidden="true" />
                <span>New Folder</span>
              </button>
            )}
            <button type="button" className="secondary-button" onClick={() => setCategoryStatsOpen((open) => !open)}>
              Categories
            </button>
          </div>
        </div>
      ) : null}

      {categoryStatsOpen && !documentOnly ? (
        <div className="category-stats">
          {categories.map((categoryName) => (
            <div key={categoryName}>
              <strong>{documents.filter((documentRecord) => documentRecord.category === categoryName).length}</strong>
              <span>{categoryName}</span>
            </div>
          ))}
        </div>
      ) : null}

      {error ? <div className="notice notice--error">{error}</div> : null}
      {loading ? <LoadingState /> : null}
      {!loading && visibleDocuments.length === 0 ? (
        <EmptyState
          icon={<Archive aria-hidden="true" />}
          title={search ? `No documents found for "${search}"` : emptyTitle}
          message={search ? 'Try another name, category, file type, or description.' : emptyMessage}
          action={
            !inTrash ? (
              <button type="button" className="primary-button" onClick={onUploadClick}>
                <Upload aria-hidden="true" />
                <span>Upload document</span>
              </button>
            ) : undefined
          }
        />
      ) : null}
      {!loading && visibleDocuments.length > 0 ? (
        <div className={viewMode === 'grid' ? 'documents-grid' : 'documents-list'}>
          {visibleDocuments.map((documentRecord) => {
            const folderItemCount = documentRecord.fileType === 'folder'
              ? documents.filter((d) => d.parentId === documentRecord.id && !d.isDeleted).length
              : undefined

            return (
              <DocumentCard
                key={documentRecord.id}
                documentRecord={documentRecord}
                mode={viewMode}
                inTrash={inTrash}
                itemCount={folderItemCount}
                pathLabel={search ? folderPathLabel.get(documentRecord.id) : undefined}
                isSelected={selectedIds.has(documentRecord.id)}
                onSelectToggle={!inTrash ? () => handleSelectToggle(documentRecord.id) : undefined}
                onMove={!inTrash ? onMove : undefined}
                onView={onView}
                onDownload={onDownload}
                onRename={onRename}
                onFavorite={onFavorite}
                onTrash={onTrash}
                onRestore={onRestore}
                onPermanentDelete={onPermanentDelete}
              />
            )
          })}
        </div>
      ) : null}

      {/* Spacer that reserves vertical space equal to the toolbar height so
          the last row of cards is never hidden behind the fixed toolbar */}
      {selectedIds.size > 0 && !inTrash && (
        <div className="bulk-toolbar-spacer" aria-hidden="true" />
      )}

      {/* Bulk action toolbar – fixed to bottom of viewport */}
      {selectedIds.size > 0 && !inTrash && (
        <div className="bulk-toolbar" role="toolbar" aria-label="Bulk actions">
          <span className="bulk-toolbar-info">
            <strong>{selectedIds.size}</strong> {selectedIds.size === 1 ? 'item' : 'items'} selected
          </span>
          <div className="bulk-toolbar-actions">
            {onBulkDownload && (
              <button
                type="button"
                className="bulk-action-btn"
                onClick={() => { onBulkDownload(visibleDocuments.filter((d) => selectedIds.has(d.id))); setSelectedIds(new Set()) }}
              >
                <Download size={14} />
                Download
              </button>
            )}
            {onBulkFavorite && (
              <button
                type="button"
                className="bulk-action-btn"
                onClick={() => { onBulkFavorite(visibleDocuments.filter((d) => selectedIds.has(d.id))); setSelectedIds(new Set()) }}
              >
                <Heart size={14} />
                Favorite
              </button>
            )}
            {onBulkMove && (
              <button
                type="button"
                className="bulk-action-btn"
                onClick={() => { onBulkMove(visibleDocuments.filter((d) => selectedIds.has(d.id))); setSelectedIds(new Set()) }}
              >
                <FolderInput size={14} />
                Move
              </button>
            )}
            <div className="bulk-toolbar-divider" />
            {onBulkTrash && (
              <button
                type="button"
                className="bulk-action-btn danger"
                onClick={() => { onBulkTrash(visibleDocuments.filter((d) => selectedIds.has(d.id))); setSelectedIds(new Set()) }}
              >
                <Trash2 size={14} />
                Delete
              </button>
            )}
            <div className="bulk-toolbar-divider" />
            <button type="button" className="bulk-action-cancel" onClick={() => setSelectedIds(new Set())}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function buildPathLabel(documents: VaultDocument[], folderId: string | null) {
  const names: string[] = []
  let current = folderId ? documents.find((documentRecord) => documentRecord.id === folderId) : undefined
  while (current) {
    names.unshift(current.name)
    current = current.parentId ? documents.find((documentRecord) => documentRecord.id === current?.parentId) : undefined
  }
  return names.length > 0 ? names.join(' / ') : 'Home'
}
