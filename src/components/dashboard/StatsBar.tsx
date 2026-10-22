import type { DocumentKind, VaultDocument } from '../../types/document'
import { formatFileSize } from '../../utils/formatters'
import { kindLabel } from '../../utils/kinds'

const kinds: DocumentKind[] = ['pdf', 'word', 'spreadsheet', 'presentation', 'image', 'text', 'other']

// File-type breakdown of the active library, as one stacked bar and a legend.
export function StatsBar({ documents }: { documents: VaultDocument[] }) {
  const files = documents.filter((record) => record.fileType !== 'folder')
  const totalSize = files.reduce((sum, record) => sum + record.fileSize, 0)

  const counts = new Map<DocumentKind, { count: number; size: number }>()
  for (const record of files) {
    const kind: DocumentKind = kinds.includes(record.fileType) ? record.fileType : 'other'
    const entry = counts.get(kind) ?? { count: 0, size: 0 }
    entry.count += 1
    entry.size += record.fileSize
    counts.set(kind, entry)
  }
  const breakdown = kinds
    .map((kind) => ({ kind, ...(counts.get(kind) ?? { count: 0, size: 0 }) }))
    .filter((entry) => entry.count > 0)

  return (
    <div className="type-breakdown">
      <div className="type-breakdown__total">
        <strong>{formatFileSize(totalSize)}</strong>
        <span>
          across {files.length} {files.length === 1 ? 'file' : 'files'}
        </span>
      </div>
      {files.length > 0 ? (
        <>
          <div className="type-breakdown__bar" role="img" aria-label="Files by type">
            {breakdown.map((entry) => (
              <span
                key={entry.kind}
                className={`kind-bg--${entry.kind}`}
                style={{ width: `${(entry.count / files.length) * 100}%` }}
                title={`${kindLabel(entry.kind)}: ${entry.count}`}
              />
            ))}
          </div>
          <ul className="type-breakdown__legend">
            {breakdown.map((entry) => (
              <li key={entry.kind}>
                <span className={`legend-swatch kind-bg--${entry.kind}`} aria-hidden="true" />
                <span>{kindLabel(entry.kind)}</span>
                <strong>{entry.count}</strong>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted-text">No files yet.</p>
      )}
    </div>
  )
}
