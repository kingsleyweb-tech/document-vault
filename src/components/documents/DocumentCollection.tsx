import { useMemo, useState, type ReactNode } from 'react'
import { Download, FolderInput, Grid2X2, List, RotateCcw, Star, Trash2, X } from 'lucide-react'
import type { VaultDocument, ViewMode } from '../../types/document'
import { DocumentCard, DocumentRow, type ItemActions } from './DocumentCard'

export interface BulkActions {
  onBulkTrash?: (items: VaultDocument[]) => void
  onBulkMove?: (items: VaultDocument[]) => void
  onBulkFavorite?: (items: VaultDocument[]) => void
  onBulkDownload?: (items: VaultDocument[]) => void
  onBulkRestore?: (items: VaultDocument[]) => void
  onBulkPermanentDelete?: (items: VaultDocument[]) => void
}

interface DocumentCollectionProps {
  items: VaultDocument[]
  allDocuments: VaultDocument[]
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  actions: ItemActions
  bulk?: BulkActions
  accessToken?: string | null
  inTrash?: boolean
  /** Shows each item's folder path under its name. */
  locationFor?: (item: VaultDocument) => string | undefined
  /** Filters and sort controls rendered at the left of the toolbar. */
  filters?: ReactNode
  empty?: ReactNode
}

// Grid or list of library items with selection and a bulk-action bar.
export function DocumentCollection({
  items,
  allDocuments,
  viewMode,
  onViewModeChange,
  actions,
  bulk = {},
  accessToken,
  inTrash,
  locationFor,
  filters,
  empty,
}: DocumentCollectionProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const childCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const record of allDocuments) {
      if (record.isDeleted || !record.parentId) continue
      counts.set(record.parentId, (counts.get(record.parentId) ?? 0) + 1)
    }
    return counts
  }, [allDocuments])

  const selected = items.filter((item) => selectedIds.has(item.id))
  const allSelected = items.length > 0 && selected.length === items.length
  const someSelected = selected.length > 0 && !allSelected

  const toggle = (id: string) =>
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const clear = () => setSelectedIds(new Set())
  const runBulk = (handler?: (items: VaultDocument[]) => void) => () => {
    handler?.(selected)
    clear()
  }

  return (
    <div className="collection">
      <div className="collection__toolbar">
        <div className="collection__filters">{filters}</div>
        <div className="collection__view">
          {items.length > 0 ? (
            <label className="select-all">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(element) => {
                  if (element) element.indeterminate = someSelected
                }}
                onChange={() => setSelectedIds(allSelected ? new Set() : new Set(items.map((item) => item.id)))}
              />
              <span>{allSelected ? 'Clear' : 'Select all'}</span>
            </label>
          ) : null}
          <div className="segmented-control" role="group" aria-label="Layout">
            <button
              type="button"
              className={viewMode === 'grid' ? 'is-active' : undefined}
              onClick={() => onViewModeChange('grid')}
              aria-label="Grid view"
              aria-pressed={viewMode === 'grid'}
            >
              <Grid2X2 aria-hidden="true" />
            </button>
            <button
              type="button"
              className={viewMode === 'list' ? 'is-active' : undefined}
              onClick={() => onViewModeChange('list')}
              aria-label="List view"
              aria-pressed={viewMode === 'list'}
            >
              <List aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        empty
      ) : viewMode === 'grid' ? (
        <div className="doc-grid">
          {items.map((item) => (
            <DocumentCard
              key={item.id}
              documentRecord={item}
              actions={actions}
              inTrash={inTrash}
              itemCount={childCounts.get(item.id)}
              location={locationFor?.(item)}
              accessToken={accessToken}
              isSelected={selectedIds.has(item.id)}
              onSelectToggle={() => toggle(item.id)}
            />
          ))}
        </div>
      ) : (
        <div className="doc-table" role="table" aria-label="Documents">
          <div className="doc-row doc-row--head" role="row">
            <span role="columnheader" />
            <span role="columnheader">Name</span>
            <span role="columnheader" className="doc-row__kind">Type</span>
            <span role="columnheader" className="doc-row__date">Modified</span>
            <span role="columnheader" className="doc-row__size">Size</span>
            <span role="columnheader" />
          </div>
          {items.map((item) => (
            <DocumentRow
              key={item.id}
              documentRecord={item}
              actions={actions}
              inTrash={inTrash}
              itemCount={childCounts.get(item.id)}
              location={locationFor?.(item)}
              accessToken={accessToken}
              isSelected={selectedIds.has(item.id)}
              onSelectToggle={() => toggle(item.id)}
            />
          ))}
        </div>
      )}

      {selected.length > 0 ? (
        <>
          <div className="bulk-bar-spacer" aria-hidden="true" />
          <div className="bulk-bar" role="toolbar" aria-label="Selected items">
            <span className="bulk-bar__count">
              <strong>{selected.length}</strong> selected
            </span>
            <div className="bulk-bar__actions">
              {inTrash ? (
                <>
                  {bulk.onBulkRestore ? (
                    <button type="button" className="ghost-button" onClick={runBulk(bulk.onBulkRestore)}>
                      <RotateCcw aria-hidden="true" />
                      <span>Restore</span>
                    </button>
                  ) : null}
                  {bulk.onBulkPermanentDelete ? (
                    <button type="button" className="ghost-button is-danger" onClick={runBulk(bulk.onBulkPermanentDelete)}>
                      <X aria-hidden="true" />
                      <span>Delete permanently</span>
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  {bulk.onBulkDownload ? (
                    <button type="button" className="ghost-button" onClick={runBulk(bulk.onBulkDownload)}>
                      <Download aria-hidden="true" />
                      <span>Download</span>
                    </button>
                  ) : null}
                  {bulk.onBulkFavorite ? (
                    <button type="button" className="ghost-button" onClick={runBulk(bulk.onBulkFavorite)}>
                      <Star aria-hidden="true" />
                      <span>Favorite</span>
                    </button>
                  ) : null}
                  {bulk.onBulkMove ? (
                    <button type="button" className="ghost-button" onClick={runBulk(bulk.onBulkMove)}>
                      <FolderInput aria-hidden="true" />
                      <span>Move</span>
                    </button>
                  ) : null}
                  {bulk.onBulkTrash ? (
                    <button type="button" className="ghost-button is-danger" onClick={runBulk(bulk.onBulkTrash)}>
                      <Trash2 aria-hidden="true" />
                      <span>Trash</span>
                    </button>
                  ) : null}
                </>
              )}
              <button type="button" className="icon-button" onClick={clear} aria-label="Clear selection">
                <X aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
