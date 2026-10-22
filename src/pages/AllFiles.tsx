import { useMemo, useState } from 'react'
import { Files, Upload } from 'lucide-react'
import { DocumentCollection } from '../components/documents/DocumentCollection'
import { EmptyState } from '../components/ui/EmptyState'
import { LoadingState } from '../components/ui/LoadingState'
import { PageHeader } from '../components/ui/PageHeader'
import type { DocumentKind, SortMode } from '../types/document'
import { locationResolver } from '../utils/trash'
import { matchesSearch, sortDocuments, sortOptions } from '../utils/sorting'
import type { LibraryPageProps } from './VaultPage'

const typeOptions: Array<{ value: DocumentKind | 'All'; label: string }> = [
  { value: 'All', label: 'All types' },
  { value: 'pdf', label: 'PDF' },
  { value: 'word', label: 'Word' },
  { value: 'spreadsheet', label: 'Spreadsheets' },
  { value: 'presentation', label: 'Slides' },
  { value: 'image', label: 'Images' },
  { value: 'text', label: 'Text' },
  { value: 'ebook', label: 'eBooks' },
  { value: 'other', label: 'Other' },
]

// Every file in the vault, wherever it lives.
export function AllFiles({
  documents,
  allDocuments,
  accessToken,
  loading,
  error,
  search,
  viewMode,
  sortMode,
  onViewModeChange,
  onSortModeChange,
  actions,
  bulk,
  onUploadClick,
}: LibraryPageProps) {
  const [typeFilter, setTypeFilter] = useState<DocumentKind | 'All'>('All')
  const [folderFilter, setFolderFilter] = useState<string>('All')

  const folders = useMemo(
    () => documents.filter((record) => record.fileType === 'folder').sort((a, b) => a.name.localeCompare(b.name)),
    [documents],
  )
  const files = useMemo(() => {
    const filtered = documents.filter((record) => {
      if (record.fileType === 'folder') return false
      if (typeFilter !== 'All' && record.fileType !== typeFilter) return false
      if (folderFilter === 'root' && record.parentId) return false
      if (folderFilter !== 'All' && folderFilter !== 'root' && record.parentId !== folderFilter) return false
      return matchesSearch(record, search)
    })
    return sortDocuments(filtered, sortMode)
  }, [documents, typeFilter, folderFilter, search, sortMode])

  const resolveLocation = useMemo(() => locationResolver(allDocuments), [allDocuments])
  const totalFiles = documents.filter((record) => record.fileType !== 'folder').length
  const filtered = typeFilter !== 'All' || folderFilter !== 'All' || Boolean(search.trim())

  return (
    <section className="page">
      <PageHeader
        title="All files"
        description={`${totalFiles} ${totalFiles === 1 ? 'file' : 'files'} across your vault.`}
        actions={
          <button type="button" className="primary-button" onClick={onUploadClick}>
            <Upload aria-hidden="true" />
            <span>Upload</span>
          </button>
        }
      />
      {error ? <div className="notice notice--error">{error}</div> : null}
      {loading ? (
        <LoadingState />
      ) : (
        <DocumentCollection
          items={files}
          allDocuments={allDocuments}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          actions={actions}
          bulk={bulk}
          accessToken={accessToken}
          locationFor={resolveLocation}
          filters={
            <>
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as DocumentKind | 'All')} aria-label="File type">
                {typeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select value={folderFilter} onChange={(event) => setFolderFilter(event.target.value)} aria-label="Location">
                <option value="All">All locations</option>
                <option value="root">My Vault (top level)</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
              <select value={sortMode} onChange={(event) => onSortModeChange(event.target.value as SortMode)} aria-label="Sort">
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {filtered && (typeFilter !== 'All' || folderFilter !== 'All') ? (
                <button
                  type="button"
                  className="ghost-button button--small"
                  onClick={() => {
                    setTypeFilter('All')
                    setFolderFilter('All')
                  }}
                >
                  Reset filters
                </button>
              ) : null}
            </>
          }
          empty={
            <EmptyState
              icon={<Files aria-hidden="true" />}
              title={filtered ? 'No files match' : 'No files yet'}
              message={filtered ? 'Try another search, type or location.' : 'Upload your first document to get started.'}
              action={
                filtered ? undefined : (
                  <button type="button" className="primary-button" onClick={onUploadClick}>
                    <Upload aria-hidden="true" />
                    <span>Upload documents</span>
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

export default AllFiles
