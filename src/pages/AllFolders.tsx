import { useState, useMemo } from 'react'
import { FolderPlus, Search, Archive } from 'lucide-react'
import { DocumentCard } from '../components/documents/DocumentCard'
import { EmptyState } from '../components/ui/EmptyState'
import { LoadingState } from '../components/ui/LoadingState'
import type { VaultDocument } from '../types/document'
import type { VaultUser } from '../types/user'

interface AllFoldersProps {
  documents: VaultDocument[]
  loading: boolean
  error: string | null
  currentUser: VaultUser
  onCreateFolder: () => void
  onView: (documentRecord: VaultDocument) => void
  onDownload: (documentRecord: VaultDocument) => void
  onRename: (documentRecord: VaultDocument) => void
  onFavorite: (documentRecord: VaultDocument) => void
  onTrash: (documentRecord: VaultDocument) => void
  onMove: (documentRecord: VaultDocument) => void
}

export function AllFolders({
  documents,
  loading,
  error,
  onCreateFolder,
  onView,
  onDownload,
  onRename,
  onFavorite,
  onTrash,
  onMove,
}: AllFoldersProps) {
  const [searchQuery, setSearchQuery] = useState('')

  // Filter folders
  const folders = useMemo(() => {
    const all = documents.filter((d) => d.fileType === 'folder' && !d.isDeleted)
    const q = searchQuery.trim().toLowerCase()
    if (!q) return all
    return all.filter((f) => f.name.toLowerCase().includes(q))
  }, [documents, searchQuery])

  return (
    <section className="page-section">
      <header className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1>All Folders</h1>
          <p>Browse and manage your directory hierarchy.</p>
        </div>
        <button type="button" className="secondary-button" onClick={onCreateFolder}>
          <FolderPlus size={18} />
          <span>New Folder</span>
        </button>
      </header>

      <div className="toolbar" style={{ marginBottom: '20px' }}>
        <div className="toolbar-group">
          <label className="search-box search-box--inline">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search folders..."
              aria-label="Search folders"
            />
          </label>
        </div>
      </div>

      {error && <div className="notice notice--error">{error}</div>}
      {loading && <LoadingState />}

      {!loading && folders.length === 0 ? (
        <EmptyState
          icon={<Archive aria-hidden="true" />}
          title={searchQuery ? `No folders found for "${searchQuery}"` : "No folders yet"}
          message={searchQuery ? "Try searching for a different directory name." : "Create your first folder to organize files."}
          action={
            <button type="button" className="primary-button" onClick={onCreateFolder}>
              <FolderPlus aria-hidden="true" />
              <span>Create Folder</span>
            </button>
          }
        />
      ) : null}

      {!loading && folders.length > 0 ? (
        <div className="documents-grid">
          {folders.map((folder) => {
            const itemCount = documents.filter((d) => d.parentId === folder.id && !d.isDeleted).length
            return (
              <DocumentCard
                key={folder.id}
                documentRecord={folder}
                mode="grid"
                itemCount={itemCount}
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
    </section>
  )
}
