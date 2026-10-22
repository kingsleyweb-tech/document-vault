import type { SortMode, VaultDocument } from '../types/document'

export function compareDocuments(first: VaultDocument, second: VaultDocument, sortMode: SortMode) {
  switch (sortMode) {
    case 'oldest':
      return first.uploadedAt.toMillis() - second.uploadedAt.toMillis()
    case 'name-asc':
      return first.name.localeCompare(second.name, undefined, { numeric: true })
    case 'name-desc':
      return second.name.localeCompare(first.name, undefined, { numeric: true })
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
}

// Folders first, then the chosen order.
export function sortDocuments(items: VaultDocument[], sortMode: SortMode) {
  return [...items].sort((first, second) => {
    const firstFolder = first.fileType === 'folder'
    const secondFolder = second.fileType === 'folder'
    if (firstFolder !== secondFolder) return firstFolder ? -1 : 1
    return compareDocuments(first, second, sortMode)
  })
}

/** Words written as "#tax" must match one of the record's tags exactly; the rest of the query is matched anywhere. */
export function matchesSearch(record: VaultDocument, query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const isTag = (word: string) => word.length > 1 && word.startsWith('#')
  const tags = record.tags ?? []
  if (words.some((word) => isTag(word) && !tags.includes(word.slice(1)))) return false
  const text = words.filter((word) => !isTag(word)).join(' ')
  if (!text) return true
  return [record.name, record.originalName, record.category, record.description, record.fileType, record.mimeType, record.folderPath, ...tags]
    .join(' ')
    .toLowerCase()
    .includes(text)
}

export function lastActivity(record: VaultDocument) {
  return (record.lastViewedAt ?? record.updatedAt ?? record.uploadedAt).toMillis()
}

export const sortOptions = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'name-asc', label: 'Name A to Z' },
  { value: 'name-desc', label: 'Name Z to A' },
  { value: 'largest', label: 'Largest' },
  { value: 'smallest', label: 'Smallest' },
] as const
