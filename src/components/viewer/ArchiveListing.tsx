import { useEffect, useState } from 'react'
import { FileArchive, Folder } from 'lucide-react'
import { formatFileSize } from '../../utils/formatters'

interface ArchiveEntry {
  name: string
  isFolder: boolean
  size: number | null
}

const MAX_ENTRIES = 2000

// Lists what a zip file contains. Nothing is extracted or opened: only the
// archive's directory is read, so a hostile archive cannot run anything.
export function ArchiveListing({ blob }: { blob: Blob }) {
  const [state, setState] = useState<{ blob: Blob; entries: ArchiveEntry[]; total: number } | { blob: Blob; error: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    import('jszip')
      .then(async ({ default: JSZip }) => {
        const zip = await JSZip.loadAsync(blob)
        const entries: ArchiveEntry[] = []
        let total = 0
        zip.forEach((relativePath, file) => {
          total += 1
          if (entries.length >= MAX_ENTRIES) return
          const size = (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
          entries.push({ name: relativePath, isFolder: file.dir, size: typeof size === 'number' ? size : null })
        })
        entries.sort((first, second) => first.name.localeCompare(second.name))
        if (!cancelled) setState({ blob, entries, total })
      })
      .catch(() => {
        if (!cancelled) setState({ blob, error: 'This archive could not be read. It may be damaged or use an unsupported format.' })
      })
    return () => {
      cancelled = true
    }
  }, [blob])

  const current = state?.blob === blob ? state : null
  if (!current) {
    return (
      <div className="archive-listing" aria-busy="true">
        <span className="app-spinner app-spinner--small" aria-hidden="true" /> Reading archive...
      </div>
    )
  }
  if ('error' in current) return <div className="office-fallback">{current.error}</div>

  return (
    <div className="archive-listing">
      <p className="archive-listing__summary">
        <FileArchive aria-hidden="true" />
        {current.total.toLocaleString()} {current.total === 1 ? 'item' : 'items'} in this archive. Download it to extract the files.
      </p>
      <ul>
        {current.entries.map((entry) => (
          <li key={entry.name}>
            {entry.isFolder ? <Folder aria-hidden="true" /> : <span className="archive-listing__dot" aria-hidden="true" />}
            <span className="break-anywhere">{entry.name}</span>
            {!entry.isFolder && entry.size !== null ? <span className="archive-listing__size">{formatFileSize(entry.size)}</span> : null}
          </li>
        ))}
      </ul>
      {current.total > current.entries.length ? <p className="notice">Showing the first {MAX_ENTRIES.toLocaleString()} items.</p> : null}
    </div>
  )
}
