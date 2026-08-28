import { useState, useRef, useEffect } from 'react'
import { Download, Eye, Folder, Heart, MoreVertical, Pencil, RotateCcw, Trash2, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { VaultDocument } from '../../types/document'
import { getDriveFileContent, getDriveFileThumbnail } from '../../services/googleDrive'
import { formatDate, formatFileSize } from '../../utils/formatters'
import { DocumentIcon } from './DocumentIcon'

const THUMBNAIL_CACHE_MAX = 160
const thumbnailCache = new Map<string, { objectUrl: string; accessedAt: number }>()
const thumbnailRequests = new Map<string, Promise<string>>()

interface DocumentCardProps {
  documentRecord: VaultDocument
  mode: 'grid' | 'list'
  inTrash?: boolean
  itemCount?: number
  pathLabel?: string
  accessToken?: string | null
  isSelected?: boolean
  onSelectToggle?: () => void
  onMove?: (documentRecord: VaultDocument) => void
  onView: (documentRecord: VaultDocument) => void
  onDownload: (documentRecord: VaultDocument) => void
  onRename: (documentRecord: VaultDocument) => void
  onFavorite: (documentRecord: VaultDocument) => void
  onTrash: (documentRecord: VaultDocument) => void
  onRestore: (documentRecord: VaultDocument) => void
  onPermanentDelete: (documentRecord: VaultDocument) => void
}

export function DocumentCard({
  documentRecord,
  mode,
  inTrash,
  itemCount,
  pathLabel,
  accessToken,
  isSelected = false,
  onSelectToggle,
  onMove,
  onView,
  onDownload,
  onRename,
  onFavorite,
  onTrash,
  onRestore,
  onPermanentDelete,
}: DocumentCardProps) {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const className = mode === 'grid' ? 'document-card' : 'document-row'

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  const handleView = () => {
    if (documentRecord.fileType === 'folder') {
      if (!inTrash) {
        navigate(`/folders/${documentRecord.id}`)
      }
    } else {
      onView(documentRecord)
    }
  }

  const closeAndRun = (action: () => void) => {
    setMenuOpen(false)
    action()
  }

  const isFolder = documentRecord.fileType === 'folder'

  return (
    <article className={`${className} ${isFolder ? 'is-folder' : ''} ${isSelected ? 'is-selected' : ''}`}>
      {/* Checkbox overlay for grid mode */}
      {mode === 'grid' && onSelectToggle && (
        <div className={`document-select-checkbox-wrapper ${isSelected ? 'is-selected' : ''}`} onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            className="document-select-checkbox"
            checked={isSelected}
            onChange={onSelectToggle}
            aria-label={`Select ${documentRecord.name}`}
          />
        </div>
      )}

      {/* Thumbnail preview for grid mode */}
      {mode === 'grid' && (
        <div className="document-thumbnail" onClick={handleView} style={{ cursor: 'pointer' }}>
          <DocumentThumbnail documentRecord={documentRecord} accessToken={accessToken} />
        </div>
      )}

      <div className="document-main" onClick={handleView} style={{ cursor: 'pointer' }}>
        {/* Checkbox for list mode */}
        {mode === 'list' && onSelectToggle && (
          <div className={`document-select-checkbox-wrapper ${isSelected ? 'is-selected' : ''}`} onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              className="document-select-checkbox"
              checked={isSelected}
              onChange={onSelectToggle}
              aria-label={`Select ${documentRecord.name}`}
            />
          </div>
        )}

        <div className={`file-icon file-icon--${documentRecord.fileType}`}>
          <DocumentIcon kind={documentRecord.fileType} />
        </div>
        <div className="document-copy">
          <h3 title={documentRecord.originalName}>{documentRecord.name}</h3>
          <p className="document-meta-inline">
            {isFolder ? (
              <>
                Folder · {itemCount !== undefined ? `${itemCount} ${itemCount === 1 ? 'item' : 'items'}` : '0 items'}
              </>
            ) : (
              <>
                Modified: {formatDate(documentRecord.updatedAt)}
                <span className="meta-separator">|</span>
                {formatFileSize(documentRecord.fileSize)}
                <span className="meta-separator">|</span>
                {documentRecord.category}
              </>
            )}
          </p>
          {pathLabel ? <p className="document-path-label">Folder: {pathLabel}</p> : null}
        </div>
      </div>

      {/* Three-dot menu */}
      <div className="document-menu-wrapper" ref={menuRef}>
        <button
          type="button"
          className="document-menu-trigger"
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen(!menuOpen)
          }}
          aria-label="More actions"
          aria-expanded={menuOpen}
        >
          <MoreVertical size={18} />
        </button>

        {menuOpen && (
          <div className="document-context-menu" role="menu">
            {!inTrash ? (
              <>
                <button type="button" role="menuitem" onClick={() => closeAndRun(handleView)}>
                  <Eye size={16} />
                  <span>{isFolder ? 'Open' : 'Preview'}</span>
                </button>
                {!isFolder && (
                  <button type="button" role="menuitem" onClick={() => closeAndRun(() => onDownload(documentRecord))}>
                    <Download size={16} />
                    <span>Download</span>
                  </button>
                )}
                <button type="button" role="menuitem" onClick={() => closeAndRun(() => onRename(documentRecord))}>
                  <Pencil size={16} />
                  <span>Rename</span>
                </button>
                {onMove && (
                  <button type="button" role="menuitem" onClick={() => closeAndRun(() => onMove(documentRecord))}>
                    <Folder size={16} />
                    <span>Move</span>
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className={documentRecord.isFavorite ? 'is-active' : ''}
                  onClick={() => closeAndRun(() => onFavorite(documentRecord))}
                >
                  <Heart size={16} />
                  <span>{documentRecord.isFavorite ? 'Unfavorite' : 'Favorite'}</span>
                </button>
                <div className="context-menu-divider" />
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  onClick={() => closeAndRun(() => onTrash(documentRecord))}
                >
                  <Trash2 size={16} />
                  <span>Move to Trash</span>
                </button>
              </>
            ) : (
              <>
                <button type="button" role="menuitem" onClick={() => closeAndRun(() => onRestore(documentRecord))}>
                  <RotateCcw size={16} />
                  <span>Restore</span>
                </button>
                <div className="context-menu-divider" />
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  onClick={() => closeAndRun(() => onPermanentDelete(documentRecord))}
                >
                  <X size={16} />
                  <span>Delete Permanently</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </article>
  )
}

function DocumentThumbnail({
  documentRecord,
  accessToken,
}: {
  documentRecord: VaultDocument
  accessToken?: string | null
}) {
  const [previewState, setPreviewState] = useState<{ fileId: string; objectUrl: string | null; failed: boolean } | null>(null)
  const isFolder = documentRecord.fileType === 'folder'
  const canLoadAuthenticatedPreview = !isFolder && Boolean(accessToken && documentRecord.driveFileId)
  const activePreview = previewState?.fileId === documentRecord.driveFileId ? previewState : null
  const failed = activePreview?.failed ?? false

  useEffect(() => {
    let cancelled = false

    if (!canLoadAuthenticatedPreview || !accessToken) {
      return () => {
        cancelled = true
      }
    }

    loadThumbnailObjectUrl(accessToken, {
      driveFileId: documentRecord.driveFileId,
      fileType: documentRecord.fileType,
      thumbnailUrl: documentRecord.thumbnailUrl,
    })
      .then((objectUrl) => {
        if (cancelled) return
        setPreviewState({ fileId: documentRecord.driveFileId, objectUrl, failed: false })
      })
      .catch((error) => {
        console.warn('Unable to load authenticated document thumbnail:', documentRecord.name, error)
        if (!cancelled) setPreviewState({ fileId: documentRecord.driveFileId, objectUrl: null, failed: true })
      })

    return () => {
      cancelled = true
    }
  }, [
    accessToken,
    canLoadAuthenticatedPreview,
    documentRecord.driveFileId,
    documentRecord.fileType,
    documentRecord.name,
    documentRecord.thumbnailUrl,
  ])

  if (activePreview?.objectUrl && !failed) {
    return (
      <img
        src={activePreview.objectUrl}
        alt={`Preview of ${documentRecord.name}`}
        loading="eager"
        decoding="async"
        fetchPriority="high"
        onError={() => setPreviewState({ fileId: documentRecord.driveFileId, objectUrl: null, failed: true })}
      />
    )
  }

  if (canLoadAuthenticatedPreview && !failed) {
    return <div className="document-thumbnail-loading" aria-label={`Loading preview of ${documentRecord.name}`} />
  }

  return (
    <div className="document-thumbnail-placeholder">
      <DocumentIcon kind={isFolder ? 'folder' : documentRecord.fileType} size={40} />
    </div>
  )
}

async function loadThumbnailObjectUrl(
  accessToken: string,
  documentRecord: Pick<VaultDocument, 'driveFileId' | 'fileType' | 'thumbnailUrl'>,
) {
  const cached = thumbnailCache.get(documentRecord.driveFileId)
  if (cached) {
    cached.accessedAt = Date.now()
    return cached.objectUrl
  }

  const pending = thumbnailRequests.get(documentRecord.driveFileId)
  if (pending) return pending

  const request = loadThumbnailBlob(accessToken, documentRecord)
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob)
      storeThumbnailObjectUrl(documentRecord.driveFileId, objectUrl)
      return objectUrl
    })
    .finally(() => {
      thumbnailRequests.delete(documentRecord.driveFileId)
    })

  thumbnailRequests.set(documentRecord.driveFileId, request)
  return request
}

async function loadThumbnailBlob(
  accessToken: string,
  documentRecord: Pick<VaultDocument, 'driveFileId' | 'fileType' | 'thumbnailUrl'>,
) {
  try {
    return await getDriveFileThumbnail(accessToken, documentRecord.driveFileId, documentRecord.thumbnailUrl)
  } catch (error) {
    if (documentRecord.fileType === 'image') {
      return getDriveFileContent(accessToken, documentRecord.driveFileId)
    }
    if (documentRecord.fileType === 'pdf') {
      const pdfBlob = await getDriveFileContent(accessToken, documentRecord.driveFileId)
      return renderPdfFirstPageThumbnail(pdfBlob)
    }
    throw error
  }
}

async function renderPdfFirstPageThumbnail(pdfBlob: Blob) {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

  const pdf = await pdfjs.getDocument({ data: await pdfBlob.arrayBuffer() }).promise
  try {
    const page = await pdf.getPage(1)
    const baseViewport = page.getViewport({ scale: 1 })
    const scale = Math.min(1, 420 / baseViewport.width)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    const canvasContext = canvas.getContext('2d')
    if (!canvasContext) throw new Error('Could not render PDF preview.')

    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvas, canvasContext, viewport }).promise

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('Could not create PDF preview image.'))
        }
      }, 'image/png')
    })
  } finally {
    await pdf.cleanup()
  }
}

function storeThumbnailObjectUrl(fileId: string, objectUrl: string) {
  if (thumbnailCache.size >= THUMBNAIL_CACHE_MAX) {
    let oldestKey = ''
    let oldestTime = Infinity
    for (const [key, entry] of thumbnailCache) {
      if (entry.accessedAt < oldestTime) {
        oldestKey = key
        oldestTime = entry.accessedAt
      }
    }
    const oldest = thumbnailCache.get(oldestKey)
    if (oldest) {
      URL.revokeObjectURL(oldest.objectUrl)
      thumbnailCache.delete(oldestKey)
    }
  }

  thumbnailCache.set(fileId, { objectUrl, accessedAt: Date.now() })
}
