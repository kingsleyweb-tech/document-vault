import { useMemo, useState } from 'react'
import { FolderPlus, Folders, Upload } from 'lucide-react'
import { DocumentCollection } from '../components/documents/DocumentCollection'
import { EmptyState } from '../components/ui/EmptyState'
import { LoadingState } from '../components/ui/LoadingState'
import { PageHeader } from '../components/ui/PageHeader'
import { locationResolver } from '../utils/trash'
import { matchesSearch } from '../utils/sorting'
import type { LibraryPageProps } from './VaultPage'

type FolderSort = 'name' | 'items' | 'date'
type FolderScope = 'top' | 'all'

// Folder browser: top-level folders by default, or every folder in the vault.
export function AllFolders({
  documents,
  allDocuments,
  accessToken,
  loading,
  error,
  search,
  viewMode,
  onViewModeChange,
  actions,
  bulk,
  onCreateFolder,
  onUploadClick,
}: LibraryPageProps) {
  const [sortBy, setSortBy] = useState<FolderSort>('name')
  const [scope, setScope] = useState<FolderScope>('top')

  const childCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const record of documents) {
      if (record.parentId) counts.set(record.parentId, (counts.get(record.parentId) ?? 0) + 1)
    }
    return counts
  }, [documents])

  const searching = Boolean(search.trim())
  const folders = useMemo(() => {
    const list = documents.filter(
      (record) => record.fileType === 'folder' && (scope === 'all' || searching || !record.parentId) && matchesSearch(record, search),
    )
    return list.sort((a, b) => {
      if (sortBy === 'items') return (childCounts.get(b.id) ?? 0) - (childCounts.get(a.id) ?? 0)
      if (sortBy === 'date') return b.updatedAt.toMillis() - a.updatedAt.toMillis()
      return a.name.localeCompare(b.name, undefined, { numeric: true })
    })
  }, [documents, scope, searching, search, sortBy, childCounts])

  const resolveLocation = useMemo(() => locationResolver(allDocuments), [allDocuments])
  const folderCount = documents.filter((record) => record.fileType === 'folder').length

  return (
    <section className="page">
      <PageHeader
        title="Folders"
        description={`${folderCount} ${folderCount === 1 ? 'folder' : 'folders'} in your vault.`}
        actions={
          <>
            <button type="button" className="secondary-button" onClick={onUploadClick}>
              <Upload aria-hidden="true" />
              <span>Upload folder</span>
            </button>
            <button type="button" className="primary-button" onClick={onCreateFolder}>
              <FolderPlus aria-hidden="true" />
              <span>New folder</span>
            </button>
          </>
        }
      />
      {error ? <div className="notice notice--error">{error}</div> : null}
      {loading ? (
        <LoadingState />
      ) : (
        <DocumentCollection
          items={folders}
          allDocuments={allDocuments}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          actions={actions}
          bulk={bulk}
          accessToken={accessToken}
          locationFor={scope === 'all' || searching ? resolveLocation : undefined}
          filters={
            <>
              <div className="tabs" role="tablist" aria-label="Which folders">
                <button type="button" role="tab" aria-selected={scope === 'top'} className={scope === 'top' ? 'is-active' : undefined} onClick={() => setScope('top')}>
                  Top level
                </button>
                <button type="button" role="tab" aria-selected={scope === 'all'} className={scope === 'all' ? 'is-active' : undefined} onClick={() => setScope('all')}>
                  All folders
                </button>
              </div>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value as FolderSort)} aria-label="Sort folders">
                <option value="name">Name</option>
                <option value="items">Most items</option>
                <option value="date">Recently changed</option>
              </select>
            </>
          }
          empty={
            <EmptyState
              icon={<Folders aria-hidden="true" />}
              title={searching ? `No folders match "${search.trim()}"` : 'No folders yet'}
              message={searching ? 'Try a different folder name.' : 'Create a folder, or upload a whole folder from your computer.'}
              action={
                searching ? undefined : (
                  <button type="button" className="primary-button" onClick={onCreateFolder}>
                    <FolderPlus aria-hidden="true" />
                    <span>New folder</span>
                  </button>
                )
              }
            />
          }
        />
      )}
    </section>
  )
}
