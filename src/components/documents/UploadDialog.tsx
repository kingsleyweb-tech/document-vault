import { AlertCircle, CheckCircle2, FileText, FileUp, FolderOpen, FolderUp, Loader2, Plus, RotateCcw, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { DocumentCategory, UploadItem } from '../../types/document'
import { formatFileSize } from '../../utils/formatters'
import { getDocumentKind } from '../../utils/fileUtils'
import { validateUploadFile } from '../../utils/validators'
import { useUploadQueue } from '../../hooks/useUploadQueue'

interface UploadDialogProps {
  open: boolean
  categories: DocumentCategory[]
  folderName?: string | null
  destinationFolderId: string | null
  onClose: () => void
}

export function UploadDialog({ open, categories, folderName, destinationFolderId, onClose }: UploadDialogProps) {
  const { items, stats, enqueueFiles, start, retryFailed, retryItem, updateItem, cancelUploads } = useUploadQueue()
  const [defaultCategory, setDefaultCategory] = useState<DocumentCategory>('Other')
  const [defaultDescription, setDefaultDescription] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  // Track folders queued in this session: rootFolderName -> file count
  const [queuedFolders, setQueuedFolders] = useState<Map<string, number>>(new Map())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const addFolderInputRef = useRef<HTMLInputElement>(null)

  if (!open) return null

  /** Queue files and record the root folder name for the summary panel */
  function queueFiles(files: FileList | File[], rootFolderName?: string) {
    enqueueFiles(files, defaultCategory, defaultDescription, destinationFolderId)
    if (rootFolderName) {
      setQueuedFolders((prev) => {
        const next = new Map(prev)
        next.set(rootFolderName, (next.get(rootFolderName) ?? 0) + files.length)
        return next
      })
    }
  }

  /** Handle folder input change — derive root folder name from relativePath */
  function handleFolderInput(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    // The first file's webkitRelativePath is "FolderName/..."
    const firstPath = fileList[0].webkitRelativePath
    const rootName = firstPath ? firstPath.split('/')[0] : 'Folder'
    queueFiles(fileList, rootName)
  }

  /** Handle drag-drop: support multiple folders via webkitGetAsEntry */
  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const items = Array.from(e.dataTransfer.items)
    const hasEntryAPI = items.length > 0 && typeof items[0].webkitGetAsEntry === 'function'

    if (hasEntryAPI) {
      for (const item of items) {
        const entry = item.webkitGetAsEntry()
        if (!entry) continue
        if (entry.isDirectory) {
          const files = await readDirectoryEntry(entry as FileSystemDirectoryEntry)
          queueFiles(files, entry.name)
        } else if (entry.isFile) {
          const file = await new Promise<File>((resolve, reject) =>
            (entry as FileSystemFileEntry).file(resolve, reject)
          )
          queueFiles([file])
        }
      }
    } else {
      queueFiles(e.dataTransfer.files)
    }
  }

  const queuedCount = stats.pending + stats.retrying
  const completedCount = stats.completed
  const failedCount = stats.failed
  const totalCount = stats.total
  const allDone = totalCount > 0 && completedCount === totalCount && !stats.running && failedCount === 0

  // Overall progress percentage
  const overallPct = totalCount > 0
    ? Math.round(((completedCount + failedCount) / totalCount) * 100)
    : 0

  // Show active items (not completed) first, then completed ones
  const activeItems = items.filter((i) => i.status !== 'COMPLETED')
  const doneItems = items.filter((i) => i.status === 'COMPLETED')

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="upload-dialog" role="dialog" aria-modal="true" aria-labelledby="upload-title">

        {/* ── HEADER ── */}
        <header>
          <div>
            <h2 id="upload-title">Upload Documents</h2>
            <p>
              {folderName
                ? `Uploading to: ${folderName}`
                : 'Files are saved to Google Drive & synced with your vault.'}
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close upload dialog">
            <X aria-hidden="true" />
          </button>
        </header>

        {/* ── OVERALL PROGRESS BANNER (only when queue is active) ── */}
        {totalCount > 0 && (
          <div className="uq-banner" role="status" aria-live="polite">
            <div className="uq-banner-top">
              <div className="uq-banner-label">
                {allDone ? (
                  <CheckCircle2 className="uq-banner-icon uq-icon-done" size={16} />
                ) : stats.running ? (
                  <Loader2 className="uq-banner-icon uq-icon-spin" size={16} />
                ) : failedCount > 0 ? (
                  <AlertCircle className="uq-banner-icon uq-icon-error" size={16} />
                ) : (
                  <Loader2 className="uq-banner-icon uq-icon-spin" size={16} />
                )}
                <span className="uq-banner-title">
                  {allDone
                    ? `All ${totalCount} files uploaded`
                    : stats.running
                    ? `Uploading… ${completedCount} of ${totalCount} done`
                    : failedCount > 0
                    ? `${failedCount} file${failedCount > 1 ? 's' : ''} failed`
                    : `${completedCount} / ${totalCount} uploaded`}
                </span>
              </div>
              <span className="uq-banner-pct">{overallPct}%</span>
            </div>

            {/* Single unified progress bar */}
            <div className="uq-progress-track">
              <div
                className={`uq-progress-fill${allDone ? ' uq-fill-done' : failedCount > 0 ? ' uq-fill-error' : ' uq-fill-active'}`}
                style={{ width: `${overallPct}%` }}
              />
            </div>

            {/* Counts summary */}
            <div className="uq-banner-counts">
              {completedCount > 0 && (
                <span className="uq-chip uq-chip-done">
                  <span className="uq-chip-dot" />
                  {completedCount} done
                </span>
              )}
              {stats.uploading > 0 && (
                <span className="uq-chip uq-chip-active">
                  <span className="uq-chip-dot" />
                  {stats.uploading} uploading
                </span>
              )}
              {stats.pending > 0 && (
                <span className="uq-chip uq-chip-pending">
                  <span className="uq-chip-dot" />
                  {stats.pending} waiting
                </span>
              )}
              {failedCount > 0 && (
                <span className="uq-chip uq-chip-error">
                  <span className="uq-chip-dot" />
                  {failedCount} failed
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── ACTION ROW ── */}
        <div className="upload-top-actions">
          <button type="button" className={allDone ? 'primary-button' : 'secondary-button'} onClick={onClose}>
            {allDone ? 'Done' : 'Close'}
          </button>
          {totalCount > completedCount ? (
            <button type="button" className="secondary-button danger-outline-button" onClick={cancelUploads}>
              Cancel
            </button>
          ) : null}
          {failedCount > 0 ? (
            <button type="button" className="secondary-button" onClick={retryFailed}>
              <RotateCcw size={14} aria-hidden="true" />
              <span>Retry {failedCount} Failed</span>
            </button>
          ) : null}
          <button
            type="button"
            className="primary-button"
            onClick={start}
            disabled={queuedCount === 0 || stats.running}
          >
            {stats.running ? (
              <>
                <Loader2 size={14} className="uq-btn-spin" />
                Uploading…
              </>
            ) : (
              `Upload${queuedCount > 0 ? ` ${queuedCount} file${queuedCount > 1 ? 's' : ''}` : ''}`
            )}
          </button>
        </div>

        {/* ── DROP ZONE ── */}
        <div
          className={`dropzone ${isDragging ? 'is-dragging' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <div className="upload-picker-actions">
            <button type="button" className="primary-button" onClick={() => fileInputRef.current?.click()}>
              <FileUp size={15} aria-hidden="true" />
              <span>Upload Files</span>
            </button>
            <button type="button" className="secondary-button" onClick={() => folderInputRef.current?.click()}>
              <FolderUp size={15} aria-hidden="true" />
              <span>Upload Folder</span>
            </button>
          </div>
          <strong>Drop files or folders here</strong>
          <span>Drag multiple folders at once, or click to add them one by one.</span>
        </div>

        {/* ── QUEUED FOLDERS SUMMARY ── */}
        {queuedFolders.size > 0 && (
          <div className="queued-folders-panel">
            <div className="queued-folders-header">
              <FolderOpen size={14} aria-hidden="true" />
              <span>{queuedFolders.size} folder{queuedFolders.size > 1 ? 's' : ''} queued</span>
              <button
                type="button"
                className="add-folder-btn"
                onClick={() => addFolderInputRef.current?.click()}
                title="Add another folder"
              >
                <Plus size={13} aria-hidden="true" />
                Add Another Folder
              </button>
            </div>
            <ul className="queued-folders-list">
              {Array.from(queuedFolders.entries()).map(([name, count]) => (
                <li key={name} className="queued-folder-item">
                  <FolderOpen size={13} className="queued-folder-icon" aria-hidden="true" />
                  <span className="queued-folder-name">{name}</span>
                  <span className="queued-folder-count">{count} file{count !== 1 ? 's' : ''}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── DEFAULTS ── */}
        <div className="upload-defaults">
          <label>
            <span>Category</span>
            <select value={defaultCategory} onChange={(e) => setDefaultCategory(e.target.value as DocumentCategory)}>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label>
            <span>Description</span>
            <input
              value={defaultDescription}
              onChange={(e) => setDefaultDescription(e.target.value)}
              placeholder="Applied to newly queued files"
            />
          </label>
        </div>

        {/* Hidden file inputs */}
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          multiple
          onChange={(e) => { if (e.target.files) queueFiles(e.target.files); e.target.value = '' }}
        />
        {/* Folder input — first folder picker */}
        <input
          ref={folderInputRef}
          className="sr-only"
          type="file"
          multiple
          {...{ webkitdirectory: '', directory: '' }}
          onChange={(e) => { handleFolderInput(e.target.files); e.target.value = '' }}
        />
        {/* Second folder input — for adding more folders without resetting */}
        <input
          ref={addFolderInputRef}
          className="sr-only"
          type="file"
          multiple
          {...{ webkitdirectory: '', directory: '' }}
          onChange={(e) => { handleFolderInput(e.target.files); e.target.value = '' }}
        />

        {/* ── QUEUE LIST ── */}
        {totalCount > 0 && (
          <div className="upload-list">
            {stats.total > items.length && (
              <div className="upload-list-note">
                Showing active and failed items. Total queue: {stats.total.toLocaleString()} files.
              </div>
            )}

            {/* Active / in-progress items */}
            {activeItems.map((item) => (
              <QueueItem
                key={item.id}
                item={item}
                categories={categories}
                onRetry={retryItem}
                onUpdate={updateItem}
              />
            ))}

            {/* Completed group — collapsed style */}
            {doneItems.length > 0 && (
              <details className="uq-completed-group" open={doneItems.length <= 5}>
                <summary className="uq-completed-summary">
                  <CheckCircle2 size={14} className="uq-icon-done" />
                  {doneItems.length} completed file{doneItems.length > 1 ? 's' : ''}
                </summary>
                <div className="uq-completed-list">
                  {doneItems.map((item) => (
                    <QueueItem
                      key={item.id}
                      item={item}
                      categories={categories}
                      onRetry={retryItem}
                      onUpdate={updateItem}
                    />
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

      </section>
    </div>
  )
}

/* ── Queue item row ── */
function QueueItem({
  item,
  categories,
  onRetry,
  onUpdate,
}: {
  item: UploadItem
  categories: DocumentCategory[]
  onRetry: (id: string) => void
  onUpdate: (id: string, v: Pick<Partial<UploadItem>, 'category' | 'description'>) => void
}) {
  const isActive = item.status === 'COMPRESSING' || item.status === 'UPLOADING' || item.status === 'RETRYING'
  const isDone   = item.status === 'COMPLETED'
  const isFailed = item.status === 'FAILED'
  const canRetry = isFailed && !validateUploadFile(item.file)
  const disabled = isActive || isDone

  const barPct = isDone ? 100 : item.progress

  return (
    <div className={`uq-item${isDone ? ' uq-item-done' : isFailed ? ' uq-item-failed' : ''}`}>
      {/* Left: file icon */}
      <div className="uq-item-icon">
        <FileText size={18} />
      </div>

      {/* Center: file info + bar */}
      <div className="uq-item-body">
        <div className="uq-item-name-row">
          <span className="uq-item-name">{item.file.name}</span>
          <span className="uq-item-meta">
            {item.originalSize !== undefined && item.compressedSize !== undefined
              ? `${formatFileSize(item.originalSize)} → ${formatFileSize(item.compressedSize)} (−${item.savedPercentage}%)`
              : `${getDocumentKind(item.file).toUpperCase()} · ${formatFileSize(item.file.size)}`}
          </span>
        </div>

        {item.relativePath && item.relativePath !== item.file.name && (
          <span className="uq-item-path">{item.relativePath}</span>
        )}

        {/* Progress bar — shown while active or done */}
        {(isActive || isDone) && (
          <div className="uq-item-bar-wrap">
            <div className="uq-item-bar-track">
              <div
                className={`uq-item-bar-fill${isDone ? ' uq-item-bar-done' : isActive ? ' uq-item-bar-active' : ''}`}
                style={{ width: `${barPct}%` }}
              />
            </div>
            <span className={`uq-item-bar-pct${isDone ? ' uq-item-bar-pct-done' : ''}`}>
              {isDone
                ? 'Done'
                : item.status === 'COMPRESSING'
                ? `Optimizing ${barPct}%`
                : `${barPct}%`}
            </span>
          </div>
        )}

        {/* Error message */}
        {item.error && (
          <span className="uq-item-error">{item.error}</span>
        )}

        {/* Editable fields for pending items */}
        {!disabled && (
          <div className="uq-item-fields">
            <select
              value={item.category}
              onChange={(e) => onUpdate(item.id, { category: e.target.value as DocumentCategory })}
              aria-label={`Category for ${item.file.name}`}
            >
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
            <input
              value={item.description}
              onChange={(e) => onUpdate(item.id, { description: e.target.value })}
              placeholder="Description"
              aria-label={`Description for ${item.file.name}`}
            />
          </div>
        )}
      </div>

      {/* Right: status icon / retry */}
      <div className="uq-item-status">
        {canRetry ? (
          <button
            type="button"
            className="uq-retry-btn"
            onClick={() => onRetry(item.id)}
            title="Retry"
          >
            <RotateCcw size={14} />
          </button>
        ) : (
          <StatusIcon status={item.status} />
        )}
      </div>
    </div>
  )
}

function StatusIcon({ status }: { status: UploadItem['status'] }) {
  if (status === 'COMPLETED')   return <CheckCircle2 size={18} className="uq-icon-done"    aria-label="Uploaded" />
  if (status === 'FAILED')      return <AlertCircle  size={18} className="uq-icon-error"   aria-label="Failed" />
  if (status === 'UPLOADING' || status === 'RETRYING')
                                return <Loader2      size={18} className="uq-icon-spin"    aria-label="Uploading" />
  if (status === 'COMPRESSING') return <Loader2      size={18} className="uq-icon-spin"    aria-label="Compressing" style={{ color: '#7c3aed' }} />
  return <span className="uq-queued-dot" aria-label="Queued" />
}

/** Recursively reads all files inside a directory entry (for drag-drop multi-folder support) */
async function readDirectoryEntry(dir: FileSystemDirectoryEntry): Promise<File[]> {
  const files: File[] = []
  const reader = dir.createReader()

  const readBatch = () =>
    new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))

  let batch: FileSystemEntry[]
  do {
    batch = await readBatch()
    for (const entry of batch) {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject)
        )
        files.push(file)
      } else if (entry.isDirectory) {
        const subFiles = await readDirectoryEntry(entry as FileSystemDirectoryEntry)
        files.push(...subFiles)
      }
    }
  } while (batch.length > 0)

  return files
}

