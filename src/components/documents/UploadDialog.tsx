import { AlertCircle, CheckCircle2, FileUp, FolderUp, Loader2, RotateCcw, X } from 'lucide-react'
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  if (!open) return null

  function queueFiles(files: FileList | File[]) {
    enqueueFiles(files, defaultCategory, defaultDescription, destinationFolderId)
  }

  const queuedCount = stats.pending + stats.retrying
  const completedCount = stats.completed
  const failedCount = stats.failed
  const totalCount = stats.total
  const aggregateProgress = stats.progress
  const allDone = totalCount > 0 && completedCount === totalCount && !stats.running && failedCount === 0

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="upload-dialog" role="dialog" aria-modal="true" aria-labelledby="upload-title">
        <header>
          <div>
            <h2 id="upload-title">Upload documents</h2>
            <p>
              {folderName
                ? `Files will be stored in folder: ${folderName}`
                : 'Files are stored in Google Drive. Metadata is saved in Firestore.'}
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close upload dialog">
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="upload-top-actions">
          <button type="button" className={allDone ? 'primary-button' : 'secondary-button'} onClick={onClose}>
            {allDone ? 'Done' : 'Close'}
          </button>
          {totalCount > completedCount ? (
            <button type="button" className="secondary-button danger-outline-button" onClick={cancelUploads}>
              Cancel Upload
            </button>
          ) : null}
          {failedCount > 0 ? (
            <button type="button" className="secondary-button" onClick={retryFailed}>
              <RotateCcw aria-hidden="true" />
              <span>Retry {failedCount} Failed</span>
            </button>
          ) : null}
          <button type="button" className="primary-button" onClick={start} disabled={queuedCount === 0 || stats.running}>
            {stats.running ? 'Uploading' : `Upload ${queuedCount > 0 ? queuedCount : ''}`}
          </button>
        </div>

        <div
          className={`dropzone ${isDragging ? 'is-dragging' : ''}`}
          onDragOver={(event) => {
            event.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setIsDragging(false)
            queueFiles(event.dataTransfer.files)
          }}
        >
          <div className="upload-picker-actions">
            <button type="button" className="primary-button" onClick={() => fileInputRef.current?.click()}>
              <FileUp aria-hidden="true" />
              <span>Upload File</span>
            </button>
            <button type="button" className="secondary-button" onClick={() => folderInputRef.current?.click()}>
              <FolderUp aria-hidden="true" />
              <span>Upload Folder</span>
            </button>
          </div>
          <strong>Drop files here or choose files or folders</strong>
          <span>Folder uploads preserve subfolders in Drive and Firestore.</span>
        </div>
        <div className="upload-defaults">
          <label>
            <span>Category</span>
            <select value={defaultCategory} onChange={(event) => setDefaultCategory(event.target.value as DocumentCategory)}>
              {categories.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Description</span>
            <input
              value={defaultDescription}
              onChange={(event) => setDefaultDescription(event.target.value)}
              placeholder="Applied to newly queued files"
            />
          </label>
        </div>
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          multiple
          onChange={(event) => {
            if (event.target.files) queueFiles(event.target.files)
            event.target.value = ''
          }}
        />
        <input
          ref={folderInputRef}
          className="sr-only"
          type="file"
          multiple
          {...{ webkitdirectory: '', directory: '' }}
          onChange={(event) => {
            if (event.target.files) queueFiles(event.target.files)
            event.target.value = ''
          }}
        />

        {totalCount > 0 ? (
          <div className="upload-summary" role="status" aria-live="polite">
          <div>
            <strong>
                {completedCount} / {totalCount} completed
              </strong>
              <span>
                {stats.uploading} uploading · {queuedCount} waiting · {failedCount} failed · {aggregateProgress}%
              </span>
            </div>
            <div className="upload-item-progress-track">
              <div className="upload-item-progress-fill" style={{ width: `${aggregateProgress}%` }} />
            </div>
          </div>
        ) : null}

        <div className="upload-list">
          {stats.total > items.length ? (
            <div className="upload-list-note">
              Showing active, failed, and first queued items. Total queue: {stats.total.toLocaleString()} files.
            </div>
          ) : null}
          {items.map((item) => (
            <div className="upload-item" key={item.id}>
              <div className="upload-item-details">
                <strong>{item.file.name}</strong>
                <span>
                  {item.originalSize !== undefined && item.compressedSize !== undefined ? (
                    <>
                      Original: {formatFileSize(item.originalSize)} · Compressed: {formatFileSize(item.compressedSize)} · Saved: {item.savedPercentage}%
                    </>
                  ) : (
                    <>
                      {getDocumentKind(item.file).toUpperCase()} · {formatFileSize(item.file.size)}
                    </>
                  )}
                </span>
                {item.relativePath && item.relativePath !== item.file.name ? <span>{item.relativePath}</span> : null}
                {item.error ? <small>{item.error}</small> : null}

                {item.status === 'COMPRESSING' && (
                  <div className="upload-item-progress-wrapper">
                    <div className="upload-item-progress-track">
                      <div
                        className="upload-item-progress-fill"
                        style={{ width: `${item.progress}%`, backgroundColor: '#2563eb' }}
                      />
                    </div>
                    <span className="upload-item-progress-lbl" style={{ color: '#2563eb' }}>
                      {item.progress}% - Optimizing file...
                    </span>
                  </div>
                )}

                {(item.status === 'UPLOADING' || item.status === 'COMPLETED') && (
                  <div className="upload-item-progress-wrapper">
                    <div className="upload-item-progress-track">
                      <div
                        className={`upload-item-progress-fill ${item.status === 'COMPLETED' ? 'success' : ''}`}
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                    <span className={`upload-item-progress-lbl ${item.status === 'COMPLETED' ? 'success' : ''}`}>
                      {item.progress}% - {item.status === 'COMPLETED' ? 'Completed' : 'Uploading...'}
                    </span>
                  </div>
                )}
              </div>
              <select
                value={item.category}
                onChange={(event) =>
                  updateItem(item.id, { category: event.target.value as DocumentCategory })
                }
                disabled={item.status === 'COMPRESSING' || item.status === 'UPLOADING' || item.status === 'COMPLETED'}
                aria-label={`Category for ${item.file.name}`}
              >
                {categories.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
              <input
                value={item.description}
                onChange={(event) => updateItem(item.id, { description: event.target.value })}
                placeholder="Description"
                disabled={item.status === 'COMPRESSING' || item.status === 'UPLOADING' || item.status === 'COMPLETED'}
                aria-label={`Description for ${item.file.name}`}
              />
              {item.status === 'FAILED' && !validateUploadFile(item.file) ? (
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => retryItem(item.id)}
                  aria-label={`Retry ${item.file.name}`}
                >
                  <RotateCcw aria-hidden="true" />
                </button>
              ) : (
                <StatusIcon status={item.status} />
              )}
            </div>
          ))}
        </div>

      </section>
    </div>
  )
}

function StatusIcon({ status }: { status: UploadItem['status'] }) {
  if (status === 'COMPLETED') return <CheckCircle2 className="status-success" aria-label="Uploaded" />
  if (status === 'FAILED') return <AlertCircle className="status-error" aria-label="Upload error" />
  if (status === 'UPLOADING' || status === 'RETRYING') return <Loader2 className="status-loading" aria-label="Uploading" />
  if (status === 'COMPRESSING') return <Loader2 className="status-loading" aria-label="Compressing" style={{ color: '#2563eb' }} />
  return <span className="queued-dot" aria-label="Queued" />
}
