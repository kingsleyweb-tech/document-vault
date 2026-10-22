import { useMemo } from 'react'
import { Clock3, FolderOpen, FolderPlus, Star, Trash2, Upload } from 'lucide-react'
import { DocumentCollection, type BulkActions } from '../components/documents/DocumentCollection'
import type { ItemActions } from '../components/documents/DocumentCard'
import { Breadcrumbs } from '../components/ui/Breadcrumbs'
import { EmptyState } from '../components/ui/EmptyState'
import { LoadingState } from '../components/ui/LoadingState'
import { PageHeader } from '../components/ui/PageHeader'
import { filterAndSortDocuments } from '../hooks/useDocuments'
import type { DocumentCategory, SortMode, VaultDocument, ViewMode } from '../types/document'
import { locationResolver } from '../utils/trash'
import { lastActivity, matchesSearch, sortDocuments, sortOptions } from '../utils/sorting'

export interface LibraryPageProps {
  /** Items this page lists from: active items, or trashed items on the Trash page. */
  documents: VaultDocument[]
  /** The whole library, used for folder paths and item counts. */
  allDocuments: VaultDocument[]
  accessToken?: string | null
  loading: boolean
  error: string | null
  search: string
  viewMode: ViewMode
  sortMode: SortMode
  category: DocumentCategory | 'All'
  categories: DocumentCategory[]
  onViewModeChange: (mode: ViewMode) => void
  onSortModeChange: (mode: SortMode) => void
  onCategoryChange: (category: DocumentCategory | 'All') => void
  actions: ItemActions
  bulk: BulkActions
  onUploadClick: () => void
  onCreateFolder: () => void
}

type Variant = 'folder' | 'recent' | 'favorites' | 'trash'

interface VaultPageProps extends LibraryPageProps {
  variant: Variant
  currentFolderId?: string | null
  folderPath?: VaultDocument[]
  onEmptyTrash?: () => void
}

const copy: Record<Variant, { title: string; description: string; emptyTitle: string; emptyMessage: string }> = {
  folder: {
    title: 'Folder',
    description: '',
    emptyTitle: 'This folder is empty',
    emptyMessage: 'Upload documents here or create a subfolder to keep things organised.',
  },
  recent: {
    title: 'Recent',
    description: 'Documents you opened, uploaded or changed most recently.',
    emptyTitle: 'Nothing recent yet',
    emptyMessage: 'Documents you open or upload will show up here.',
  },
  favorites: {
    title: 'Favorites',
    description: 'Your starred documents and folders, all in one place.',
    emptyTitle: 'No favorites yet',
    emptyMessage: 'Open an item menu and choose Add to favorites to pin it here.',
  },
  trash: {
    title: 'Trash',
    description: 'Items you move to Trash stay here until you restore them or delete them permanently.',
    emptyTitle: 'Trash is empty',
    emptyMessage: 'Anything you move to Trash will appear here, ready to restore.',
  },
}

const emptyIcons: Record<Variant, typeof FolderOpen> = {
  folder: FolderOpen,
  recent: Clock3,
  favorites: Star,
  trash: Trash2,
}

export function VaultPage({
  variant,
  documents,
  allDocuments,
  accessToken,
  loading,
  error,
  search,
  viewMode,
  sortMode,
  category,
  categories,
  onViewModeChange,
  onSortModeChange,
  onCategoryChange,
  actions,
  bulk,
  onUploadClick,
  onCreateFolder,
  currentFolderId = null,
  folderPath = [],
  onEmptyTrash,
}: VaultPageProps) {
  const text = copy[variant]
  const currentFolder = folderPath[folderPath.length - 1]
  const title = variant === 'folder' ? currentFolder?.name ?? text.title : text.title

  const items = useMemo(() => {
    switch (variant) {
      case 'folder':
        return filterAndSortDocuments(documents, search, sortMode, category, currentFolderId)
      case 'recent':
        return documents
          .filter((record) => record.fileType !== 'folder' && matchesSearch(record, search))
          .sort((first, second) => lastActivity(second) - lastActivity(first))
          .slice(0, 100)
      case 'favorites':
        return sortDocuments(
          documents.filter((record) => record.isFavorite && matchesSearch(record, search)),
          sortMode,
        )
      case 'trash':
        return documents
          .filter((record) => matchesSearch(record, search))
          .sort((first, second) => second.updatedAt.toMillis() - first.updatedAt.toMillis())
    }
  }, [variant, documents, search, sortMode, category, currentFolderId])

  const showLocation = variant !== 'folder' || Boolean(search.trim())
  const resolveLocation = useMemo(() => locationResolver(allDocuments), [allDocuments])
  const locationFor = showLocation ? resolveLocation : undefined

  const EmptyIcon = emptyIcons[variant]
  const empty = search.trim() ? (
    <EmptyState
      icon={<EmptyIcon aria-hidden="true" />}
      title={`No matches for "${search.trim()}"`}
      message="Try a different name, file type or category."
    />
  ) : (
    <EmptyState
      icon={<EmptyIcon aria-hidden="true" />}
      title={text.emptyTitle}
      message={text.emptyMessage}
      action={
        variant === 'folder' ? (
          <>
            <button type="button" className="primary-button" onClick={onUploadClick}>
              <Upload aria-hidden="true" />
              <span>Upload here</span>
            </button>
            <button type="button" className="secondary-button" onClick={onCreateFolder}>
              <FolderPlus aria-hidden="true" />
              <span>New folder</span>
            </button>
          </>
        ) : undefined
      }
    />
  )

  const description =
    variant === 'folder'
      ? `${items.length} ${items.length === 1 ? 'item' : 'items'}`
      : variant === 'trash' && documents.length > 0
        ? `${text.description} ${documents.length} ${documents.length === 1 ? 'item' : 'items'} in Trash.`
        : text.description

  const headerActions =
    variant === 'folder' ? (
      <>
        <button type="button" className="secondary-button" onClick={onCreateFolder}>
          <FolderPlus aria-hidden="true" />
          <span>New folder</span>
        </button>
        <button type="button" className="primary-button" onClick={onUploadClick}>
          <Upload aria-hidden="true" />
          <span>Upload</span>
        </button>
      </>
    ) : variant === 'trash' && documents.length > 0 && onEmptyTrash ? (
      <button type="button" className="danger-outline-button secondary-button" onClick={onEmptyTrash}>
        <Trash2 aria-hidden="true" />
        <span>Empty trash</span>
      </button>
    ) : null

  const filters =
    variant === 'folder' || variant === 'favorites' ? (
      <>
        {variant === 'folder' ? (
          <select
            value={category}
            onChange={(event) => onCategoryChange(event.target.value as DocumentCategory | 'All')}
            aria-label="Filter by category"
          >
            <option value="All">All categories</option>
            {categories.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : null}
        <select value={sortMode} onChange={(event) => onSortModeChange(event.target.value as SortMode)} aria-label="Sort">
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </>
    ) : null

  return (
    <section className="page">
      <PageHeader title={title} description={description} actions={headerActions}>
        {variant === 'folder' ? <Breadcrumbs path={folderPath} /> : null}
      </PageHeader>

      {variant === 'trash' && documents.length > 0 ? (
        <div className="notice trash-notice">
          Restoring an item puts it back where it was. Deleting permanently also removes it from your Google Drive.
        </div>
      ) : null}
      {error ? <div className="notice notice--error">{error}</div> : null}

      {loading ? (
        <LoadingState />
      ) : (
        <DocumentCollection
          key={`${variant}:${currentFolderId ?? ''}`}
          items={items}
          allDocuments={allDocuments}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          actions={actions}
          bulk={bulk}
          accessToken={accessToken}
          inTrash={variant === 'trash'}
          locationFor={locationFor}
          filters={filters}
          empty={empty}
        />
      )}
    </section>
  )
}
