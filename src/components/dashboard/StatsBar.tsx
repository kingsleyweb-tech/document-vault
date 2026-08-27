import type { VaultDocument } from '../../types/document'
import { formatFileSize } from '../../utils/formatters'

interface StatsBarProps {
  documents: VaultDocument[]
}

export function StatsBar({ documents }: StatsBarProps) {
  const activeItems = documents.filter((d) => !d.isDeleted)
  const files = activeItems.filter((d) => d.fileType !== 'folder')
  const foldersCount = activeItems.filter((d) => d.fileType === 'folder').length
  const filesCount = files.length
  const totalSize = files.reduce((sum, f) => sum + f.fileSize, 0)

  // Calculate file type counts
  const typeCounts = files.reduce((acc, f) => {
    acc[f.fileType] = (acc[f.fileType] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  const types = [
    { key: 'pdf', label: 'PDF', color: 'var(--type-pdf-color, #e53e3e)' },
    { key: 'word', label: 'Word', color: 'var(--type-word-color, #3182ce)' },
    { key: 'spreadsheet', label: 'Spreadsheet', color: 'var(--type-excel-color, #38a169)' },
    { key: 'presentation', label: 'Presentation', color: 'var(--type-powerpoint-color, #dd6b20)' },
    { key: 'image', label: 'Image', color: 'var(--type-image-color, #805ad5)' },
    { key: 'other', label: 'Other', color: 'var(--type-other-color, #718096)' },
  ]

  const statsBreakdown = types
    .map((t) => {
      const count = typeCounts[t.key] ?? 0
      const percentage = filesCount > 0 ? (count / filesCount) * 100 : 0
      return { ...t, count, percentage }
    })
    .filter((t) => t.count > 0)

  return (
    <div className="dashboard-stats-card">
      <div className="stats-header">
        <div className="stats-summary-item">
          <strong>{formatFileSize(totalSize)}</strong>
          <span>Storage Used</span>
        </div>
        <div className="stats-summary-item">
          <strong>{filesCount}</strong>
          <span>Files</span>
        </div>
        <div className="stats-summary-item">
          <strong>{foldersCount}</strong>
          <span>Folders</span>
        </div>
      </div>

      {filesCount > 0 ? (
        <div className="stats-visualization">
          <div className="stats-progress-bar" role="img" aria-label="Storage distribution by file type">
            {statsBreakdown.map((item) => (
              <div
                key={item.key}
                className={`progress-segment progress-segment--${item.key}`}
                style={{
                  width: `${item.percentage}%`,
                  backgroundColor: item.color,
                }}
                title={`${item.label}: ${item.count} files (${Math.round(item.percentage)}%)`}
              />
            ))}
          </div>

          <div className="stats-legend">
            {statsBreakdown.map((item) => (
              <div key={item.key} className="legend-item">
                <span className="legend-dot" style={{ backgroundColor: item.color }} />
                <span className="legend-label">
                  {item.label} ({item.count})
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="stats-empty-message">No documents stored in the vault yet.</div>
      )}
    </div>
  )
}
