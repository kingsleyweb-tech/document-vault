import { useState, useMemo } from 'react'
import { Search, Archive, Trash2, FolderInput, Heart, Download } from 'lucide-react'
import { DocumentCard } from '../components/documents/DocumentCard'
import { EmptyState } from '../components/ui/EmptyState'
import { LoadingState } from '../components/ui/LoadingState'
import type { VaultDocument, SortMode } from '../types/document'
import type { VaultUser } from '../types/user'

interface AllFilesProps {
  documents: VaultDocument[]
  loading: boolean
  error: string | null
  currentUser: VaultUser
  onView: (documentRecord: VaultDocument) => void
  onDownload: (documentRecord: VaultDocument) => void
  onRename: (documentRecord: VaultDocument) => void
  onFavorite: (documentRecord: VaultDocument) => void
  onTrash: (documentRecord: VaultDocument) => void
  onMove: (documentRecord: VaultDocument) => void
  // Bulk actions
  onBulkTrash: (selectedItems: VaultDocument[]) => void
  onBulkMove: (selectedItems: VaultDocument[]) => void
  onBulkFavorite: (selectedItems: VaultDocument[]) => void
  onBulkDownload: (selectedItems: VaultDocument[]) => void
}

export function AllFiles({
  documents,
  loading,
  error,
  onView,
  onDownload,
  onRename,
  onFavorite,
  onTrash,
  onMove,
  onBulkTrash,
  onBulkMove,
  onBulkFavorite,
  onBulkDownload,
}: AllFilesProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [fileTypeFilter, setFileTypeFilter] = useState<string>('All')
  const [folderFilter, setFolderFilter] = useState<string>('All')
  const [sortMode, setSortMode] = useState<SortMode>('newest')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Get only file documents (exclude folders)
  const filesOnly = useMemo(() => {
    return documents.filter((d) => d.fileType !== 'folder' && !d.isDeleted)
  }, [documents])

  // Get list of unique folders for the filter dropdown
  const uniqueFolders = useMemo(() => {
    return documents.filter((d) => d.fileType === 'folder' && !d.isDeleted)
  }, [documents])

  // Helper to build location label
  const buildLocationLabel = (parentId: string | null): string => {
    if (!parentId) return 'Home'
    const names: string[] = []
    let current = documents.find((d) => d.id === parentId)
    while (current) {
      names.unshift(current.name)
      const pId = current.parentId
      current = pId ? documents.find((d) => d.id === pId) : undefined
    }
    return names.join(' / ')
  }

  // Filter and Sort files
  const filteredAndSortedFiles = useMemo(() => {
    let result = [...filesOnly]

    // 1. Search Query
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      result = result.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.originalName.toLowerCase().includes(q) ||
          (f.description && f.description.toLowerCase().includes(q))
      )
    }

    // 2. File Type Filter
    if (fileTypeFilter !== 'All') {
      result = result.filter((f) => f.fileType.toLowerCase() === fileTypeFilter.toLowerCase())
    }

    // 3. Folder Filter
    if (folderFilter !== 'All') {
      if (folderFilter === 'root') {
        result = result.filter((f) => f.parentId === null)
      } else {
        result = result.filter((f) => f.parentId === folderFilter)
      }
    }

    // 4. Sorting
    return result.sort((first, second) => {
      switch (sortMode) {
        case 'oldest':
          return first.uploadedAt.toMillis() - second.uploadedAt.toMillis()
        case 'name-asc':
          return first.name.localeCompare(second.name)
        case 'name-desc':
          return second.name.localeCompare(first.name)
        case 'largest':
          return second.fileSize - first.fileSize
        case 'smallest':
          return first.fileSize - second.fileSize
        case 'updated':
          return second.updatedAt.toMillis() - first.updatedAt.toMillis()
        case 'newest':
        default:
          return second.uploadedAt.toMillis() - first.uploadedAt.toMillis()
      }
    })
  }, [filesOnly, searchQuery, fileTypeFilter, folderFilter, sortMode])

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

  const handleSelectAll = () => {
    if (selectedIds.size === filteredAndSortedFiles.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredAndSortedFiles.map((f) => f.id)))
    }
  }

  const getSelectedItems = () => {
    return filteredAndSortedFiles.filter((f) => selectedIds.has(f.id))
  }

  return (
    <section className="page-section">
      <header className="page-header" style={{ marginBottom: '24px' }}>
        <h1>All Files</h1>
        <p>Browse every document in your vault regardless of location.</p>
      </header>

      <div className="toolbar" style={{ marginBottom: '20px' }}>
        <div className="toolbar-group">
          {/* File Type Filter */}
          <select
            value={fileTypeFilter}
            onChange={(e) => setFileTypeFilter(e.target.value)}
            aria-label="Filter by file type"
          >
            <option value="All">All Types</option>
            <option value="pdf">PDF</option>
            <option value="word">Word</option>
            <option value="spreadsheet">Spreadsheet</option>
            <option value="presentation">Presentation</option>
            <option value="image">Image</option>
            <option value="text">Text</option>
            <option value="ebook">Ebook</option>
          </select>

          {/* Folder Filter */}
          <select
            value={folderFilter}
            onChange={(e) => setFolderFilter(e.target.value)}
            aria-label="Filter by location"
          >
            <option value="All">All Locations</option>
            <option value="root">Vault Root Only</option>
            {uniqueFolders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>

          {/* Sort Mode */}
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            aria-label="Sort files"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="name-asc">Name A-Z</option>
            <option value="name-desc">Name Z-A</option>
            <option value="largest">Largest</option>
            <option value="smallest">Smallest</option>
            <option value="updated">Recently updated</option>
          </select>

          {/* Search Box */}
          <label className="search-box search-box--inline">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search files..."
              aria-label="Search files"
            />
          </label>
        </div>

        {filteredAndSortedFiles.length > 0 && (
          <div className="toolbar-group">
            <button type="button" className="secondary-button" onClick={handleSelectAll}>
              {selectedIds.size === filteredAndSortedFiles.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>
        )}
      </div>

      {error && <div className="notice notice--error">{error}</div>}
      {loading && <LoadingState />}

      {!loading && filteredAndSortedFiles.length === 0 ? (
        <EmptyState
          icon={<Archive aria-hidden="true" />}
          title={searchQuery || fileTypeFilter !== 'All' || folderFilter !== 'All' ? 'No files match your filters' : 'No files in vault'}
          message="Try resetting your search query or location filter dropdowns."
        />
      ) : null}

      {!loading && filteredAndSortedFiles.length > 0 ? (
        <div className="documents-list">
          {filteredAndSortedFiles.map((file) => (
            <DocumentCard
              key={file.id}
              documentRecord={file}
              mode="list"
              isSelected={selectedIds.has(file.id)}
              onSelectToggle={() => handleSelectToggle(file.id)}
              onMove={onMove}
              pathLabel={buildLocationLabel(file.parentId ?? null)}
              onView={onView}
              onDownload={onDownload}
              onRename={onRename}
              onFavorite={onFavorite}
              onTrash={onTrash}
              onRestore={() => {}}
              onPermanentDelete={() => {}}
            />
          ))}
        </div>
      ) : null}

      {/* Bulk actions contextual toolbar */}
      {selectedIds.size > 0 && (
        <div className="bulk-toolbar" role="toolbar" aria-label="Bulk actions toolbar">
          <div className="bulk-toolbar-info">
            <strong>{selectedIds.size}</strong> selected
          </div>
          <div className="bulk-toolbar-actions">
            <button
              type="button"
              className="bulk-action-btn danger"
              onClick={() => onBulkTrash(getSelectedItems())}
            >
              <Trash2 size={16} />
              <span>Trash</span>
            </button>
            <button
              type="button"
              className="bulk-action-btn"
              onClick={() => onBulkMove(getSelectedItems())}
            >
              <FolderInput size={16} />
              <span>Move</span>
            </button>
            <button
              type="button"
              className="bulk-action-btn"
              onClick={() => onBulkFavorite(getSelectedItems())}
            >
              <Heart size={16} />
              <span>Favorite</span>
            </button>
            <button
              type="button"
              className="bulk-action-btn"
              onClick={() => onBulkDownload(getSelectedItems())}
            >
              <Download size={16} />
              <span>Download</span>
            </button>
            <div className="bulk-toolbar-divider" />
            <button
              type="button"
              className="bulk-action-cancel"
              onClick={() => setSelectedIds(new Set())}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
export default AllFiles
