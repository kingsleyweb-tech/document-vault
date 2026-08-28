import { AlertCircle, CheckCircle2, FileUp, Loader2, X } from 'lucide-react'
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
  onUpload: (file: File, category: DocumentCategory, description: string) => Promise<void>
}

export function UploadDialog({ open, categories, folderName, onClose, onUpload }: UploadDialogProps) {
  const [items, setItems] = useState<UploadItem[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

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
        await onUpload(item.file, item.category, item.description)
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

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="upload-dialog" role="dialog" aria-modal="true" aria-labelledby="upload-title">
        <header>
          <div>
            <h2 id="upload-title">Upload documents</h2>
            <p>
              {folderName
                ? `Files will be stored in folder: ${folderName}`
                : 'Files are stored in Google Drive. Metadata is saved in this browser.'}
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close upload dialog">
            <X aria-hidden="true" />
          </button>
        </header>

        <button
          type="button"
          className={`dropzone ${isDragging ? 'is-dragging' : ''}`}
          onClick={() => inputRef.current?.click()}
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
          <FileUp aria-hidden="true" />
          <strong>Drop files here or choose files</strong>
          <span>All file types are supported.</span>
        </button>
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          multiple
          onChange={(event) => {
            if (event.target.files) queueFiles(event.target.files)
            event.target.value = ''
          }}
        />

        <div className="upload-list">
          {items.map((item) => (
            <div className="upload-item" key={item.id}>
              <div className="upload-item-details">
                <strong>{item.file.name}</strong>
                <span>
                  {getDocumentKind(item.file).toUpperCase()} · {formatFileSize(item.file.size)}
                </span>
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
              <StatusIcon status={item.status} />
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

    return `Google Drive upload failed (${error.status}: ${error.reason ?? error.message}).`
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
