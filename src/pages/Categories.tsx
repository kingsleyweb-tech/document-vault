import { useMemo, useState } from 'react'
import { Award, BarChart3, Briefcase, FolderOpen, GraduationCap, Home, Shield, Tags, type LucideIcon } from 'lucide-react'
import { DocumentCollection } from '../components/documents/DocumentCollection'
import { EmptyState } from '../components/ui/EmptyState'
import { LoadingState } from '../components/ui/LoadingState'
import { PageHeader } from '../components/ui/PageHeader'
import type { DocumentCategory, SortMode } from '../types/document'
import { locationResolver } from '../utils/trash'
import { matchesSearch, sortDocuments, sortOptions } from '../utils/sorting'
import type { LibraryPageProps } from './VaultPage'

const categoryIcons: Record<DocumentCategory, LucideIcon> = {
  Personal: Home,
  School: GraduationCap,
  Military: Shield,
  Work: Briefcase,
  Certificates: Award,
  Reports: BarChart3,
  Other: FolderOpen,
}

// Files grouped by the category chosen at upload.
export function Categories({
  documents,
  allDocuments,
  categories,
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
}: LibraryPageProps) {
  const [selected, setSelected] = useState<DocumentCategory>(categories[0])
  const files = useMemo(() => documents.filter((record) => record.fileType !== 'folder'), [documents])

  const counts = useMemo(() => {
    const map = new Map<DocumentCategory, number>()
    for (const record of files) map.set(record.category, (map.get(record.category) ?? 0) + 1)
    return map
  }, [files])

  const items = useMemo(
    () => sortDocuments(files.filter((record) => record.category === selected && matchesSearch(record, search)), sortMode),
    [files, selected, search, sortMode],
  )
  const resolveLocation = useMemo(() => locationResolver(allDocuments), [allDocuments])

  return (
    <section className="page">
      <PageHeader title="Categories" description="Every file belongs to one category, chosen when it was uploaded." />

      <div className="category-tiles" role="tablist" aria-label="Categories">
        {categories.map((category) => {
          const Icon = categoryIcons[category] ?? FolderOpen
          const count = counts.get(category) ?? 0
          return (
            <button
              key={category}
              type="button"
              role="tab"
              aria-selected={selected === category}
              className={selected === category ? 'category-tile is-active' : 'category-tile'}
              onClick={() => setSelected(category)}
            >
              <span className="category-tile__icon">
                <Icon aria-hidden="true" />
              </span>
              <span className="category-tile__text">
                <strong>{category}</strong>
                <span>
                  {count} {count === 1 ? 'file' : 'files'}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {error ? <div className="notice notice--error">{error}</div> : null}
      {loading ? (
        <LoadingState />
      ) : (
        <DocumentCollection
          key={selected}
          items={items}
          allDocuments={allDocuments}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          actions={actions}
          bulk={bulk}
          accessToken={accessToken}
          locationFor={resolveLocation}
          filters={
            <>
              <h2 className="collection__title">{selected}</h2>
              <select value={sortMode} onChange={(event) => onSortModeChange(event.target.value as SortMode)} aria-label="Sort">
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </>
          }
          empty={
            <EmptyState
              icon={<Tags aria-hidden="true" />}
              title={search.trim() ? 'No matches in this category' : `Nothing in ${selected} yet`}
              message="Pick a category when uploading to file documents here."
            />
          }
        />
      )}
    </section>
  )
}
