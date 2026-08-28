import { AlertCircle, CheckCircle2, FileUp, FolderUp, Loader2, RotateCcw, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { DocumentCategory, UploadItem } from '../../types/document'
import { formatFileSize } from '../../utils/formatters'
import { getDocumentKind } from '../../utils/fileUtils'
import { validateUploadFile } from '../../utils/validators'
import { GoogleDriveError } from '../../services/googleDrive'

interface UploadDialogProps {
  open: boolean
  categories: DocumentCategory[]
  folderName?: string | null
  onClose: () => void
  onUpload: (file: File, category: DocumentCategory, description: string, relativePath?: string) => Promise<void>
}

export function UploadDialog({ open, categories, folderName, onClose, onUpload }: UploadDialogProps) {
  const [items, setItems] = useState<UploadItem[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  if (!open) return null

  function queueFiles(files: FileList | File[]) {
    const nextItems: UploadItem[] = Array.from(files).map((file) => {
      const error = validateUploadFile(file)
      return {
        id: crypto.randomUUID(),
        file,
        status: error ? 'error' : 'queued',
        progress: 0,
        category: 'Other' as DocumentCategory,
        description: '',
        relativePath: getRelativePath(file),
        error: error ?? undefined,
      }
    })
    setItems((currentItems) => [...currentItems, ...nextItems])
  }

  async function uploadQueued() {
    for (const item of items.filter((queuedItem) => queuedItem.status === 'queued')) {
      let progress = 10
      setItems((currentItems) =>
        currentItems.map((currentItem) =>
          currentItem.id === item.id ? { ...currentItem, status: 'uploading', progress } : currentItem,
        ),
      )

      // Simulate smooth progress increments while actual upload network call is pending
      const interval = setInterval(() => {
        progress = Math.min(progress + Math.floor(Math.random() * 12) + 4, 92)
        setItems((currentItems) =>
          currentItems.map((currentItem) =>
            currentItem.id === item.id ? { ...currentItem, progress } : currentItem,
          ),
        )
      }, 150)

      try {
        await onUpload(item.file, item.category, item.description, item.relativePath)
        clearInterval(interval)
        setItems((currentItems) =>
          currentItems.map((currentItem) =>
            currentItem.id === item.id ? { ...currentItem, status: 'success', progress: 100 } : currentItem,
          ),
        )
      } catch (error) {
        clearInterval(interval)
        console.error(error)
        setItems((currentItems) =>
          currentItems.map((currentItem) =>
            currentItem.id === item.id
              ? {
                  ...currentItem,
                  status: 'error',
                  progress: 0,
                  error: getUploadErrorMessage(error),
                }
              : currentItem,
          ),
        )
      }
    }
  }

  function updateItem(id: string, values: Partial<UploadItem>) {
    setItems((currentItems) =>
      currentItems.map((currentItem) => (currentItem.id === id ? { ...currentItem, ...values } : currentItem)),
    )
  }

  const queuedCount = items.filter((item) => item.status === 'queued').length
  const completedCount = items.filter((item) => item.status === 'success').length
  const failedCount = items.filter((item) => item.status === 'error' && item.progress === 0 && item.error).length
  const totalCount = items.length
  const aggregateProgress = totalCount === 0
    ? 0
    : Math.round(items.reduce((sum, item) => sum + item.progress, 0) / totalCount)

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
                {completedCount} / {totalCount} files completed
              </strong>
              <span>
                {failedCount > 0 ? `${failedCount} failed` : `${queuedCount} waiting`} · {aggregateProgress}%
              </span>
            </div>
            <div className="upload-item-progress-track">
              <div className="upload-item-progress-fill" style={{ width: `${aggregateProgress}%` }} />
            </div>
          </div>
        ) : null}

        <div className="upload-list">
          {items.map((item) => (
            <div className="upload-item" key={item.id}>
              <div className="upload-item-details">
                <strong>{item.file.name}</strong>
                <span>
                  {getDocumentKind(item.file).toUpperCase()} · {formatFileSize(item.file.size)}
                </span>
                {item.relativePath && item.relativePath !== item.file.name ? <span>{item.relativePath}</span> : null}
                {item.error ? <small>{item.error}</small> : null}

                {(item.status === 'uploading' || item.status === 'success') && (
                  <div className="upload-item-progress-wrapper">
                    <div className="upload-item-progress-track">
                      <div
                        className={`upload-item-progress-fill ${item.status === 'success' ? 'success' : ''}`}
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                    <span className={`upload-item-progress-lbl ${item.status === 'success' ? 'success' : ''}`}>
                      {item.progress}% - {item.status === 'success' ? 'Completed' : 'Uploading...'}
                    </span>
                  </div>
                )}
              </div>
              <select
                value={item.category}
                onChange={(event) =>
                  updateItem(item.id, { category: event.target.value as DocumentCategory })
                }
                disabled={item.status === 'uploading' || item.status === 'success'}
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
                disabled={item.status === 'uploading' || item.status === 'success'}
                aria-label={`Description for ${item.file.name}`}
              />
              {item.status === 'error' && !validateUploadFile(item.file) ? (
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => updateItem(item.id, { status: 'queued', progress: 0, error: undefined })}
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

        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="primary-button" onClick={uploadQueued} disabled={queuedCount === 0}>
            Upload {queuedCount > 0 ? queuedCount : ''}
          </button>
        </footer>
      </section>
    </div>
  )
}

function getRelativePath(file: File) {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
}

function getUploadErrorMessage(error: unknown) {
  if (error instanceof GoogleDriveError) {
    if (error.status === 401) {
      return 'Google Drive authorization expired. Sign out, sign back in, and grant Drive access.'
    }

    if (error.status === 403 && error.reason === 'accessNotConfigured') {
      return 'Enable Google Drive API in the Google Cloud project that owns your OAuth client.'
    }

    if (error.status === 403) {
      return 'Google Drive permission was denied. Sign in again and approve Drive access.'
    }

    return 'Google Drive upload failed. Please try again in a moment.'
  }

  if (error instanceof Error && error.message.includes('Google Drive authorization')) {
    return error.message
  }

  return 'Upload failed. Check your Drive connection and try again.'
}

function StatusIcon({ status }: { status: UploadItem['status'] }) {
  if (status === 'success') return <CheckCircle2 className="status-success" aria-label="Uploaded" />
  if (status === 'error') return <AlertCircle className="status-error" aria-label="Upload error" />
  if (status === 'uploading') return <Loader2 className="status-loading" aria-label="Uploading" />
  return <span className="queued-dot" aria-label="Queued" />
}
