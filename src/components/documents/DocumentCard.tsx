import { useState, useRef, useEffect, useMemo } from 'react'
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
          <SmallDocumentThumbnailCard documentRecord={documentRecord} />
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
  const [imgError, setImgError] = useState(false)
  const [previewState, setPreviewState] = useState<{ fileId: string; objectUrl: string | null; failed: boolean } | null>(null)
  const isFolder = documentRecord.fileType === 'folder'

  // High-res Google Drive thumbnail CDN URL (=s800 renders full-resolution Slide 1 / Page 1)
  const driveThumbnailUrl = useMemo(() => {
    if (isFolder) return null
    if (documentRecord.thumbnailUrl) {
      return documentRecord.thumbnailUrl.replace(/=s\d+/, '=s800')
    }
    if (documentRecord.driveFileId) {
      return `https://lh3.googleusercontent.com/d/${documentRecord.driveFileId}=s800`
    }
    return null
  }, [isFolder, documentRecord.thumbnailUrl, documentRecord.driveFileId])

  const isImage = documentRecord.fileType === 'image'
  const directImageUrl = (isImage && (documentRecord.thumbnailUrl || (documentRecord as { storageUrl?: string }).storageUrl)) || null
  const canLoadAuthenticatedPreview = !isFolder && Boolean(accessToken && documentRecord.driveFileId)
  const activePreview = previewState?.fileId === documentRecord.driveFileId ? previewState : null

  useEffect(() => {
    let cancelled = false
    setImgError(false)

    if (!canLoadAuthenticatedPreview || !accessToken || !documentRecord.driveFileId) {
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
        console.warn('Authenticated thumbnail blob fallback for:', documentRecord.name, error)
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

  if (isFolder) {
    return (
      <div className="document-thumbnail-folder-preview">
        <DocumentIcon kind="folder" size={54} />
      </div>
    )
  }

  // 1. Render authenticated blob preview (from PDFjs or drive blob) if available
  if (activePreview?.objectUrl && !activePreview.failed) {
    return (
      <img
        src={activePreview.objectUrl}
        alt={`First page preview of ${documentRecord.name}`}
        loading="eager"
        decoding="async"
        fetchPriority="high"
        className="document-thumbnail-img"
      />
    )
  }

  // 2. Direct high-res Google Drive CDN thumbnail (renders real Slide 1 / Page 1 image!)
  if (driveThumbnailUrl && !imgError) {
    return (
      <img
        src={driveThumbnailUrl}
        alt={`First page preview of ${documentRecord.name}`}
        loading="eager"
        decoding="async"
        referrerPolicy="no-referrer"
        className="document-thumbnail-img"
        onError={() => setImgError(true)}
      />
    )
  }

  // 3. Direct image storage URL
  if (directImageUrl && !imgError) {
    return (
      <img
        src={directImageUrl}
        alt={`Preview of ${documentRecord.name}`}
        loading="eager"
        decoding="async"
        className="document-thumbnail-img"
        onError={() => setImgError(true)}
      />
    )
  }

  // Fallback sheet if thumbnail image could not be loaded
  return <FirstPageDocumentSheet documentRecord={documentRecord} />
}

function SmallDocumentThumbnailCard({ documentRecord }: { documentRecord: VaultDocument }) {
  const [imgError, setImgError] = useState(false)
  const isFolder = documentRecord.fileType === 'folder'

  const driveThumbnailUrl = useMemo(() => {
    if (isFolder) return null
    if (documentRecord.thumbnailUrl) {
      return documentRecord.thumbnailUrl.replace(/=s\d+/, '=s200')
    }
    if (documentRecord.driveFileId) {
      return `https://lh3.googleusercontent.com/d/${documentRecord.driveFileId}=s200`
    }
    return null
  }, [isFolder, documentRecord.thumbnailUrl, documentRecord.driveFileId])

  const isImage = documentRecord.fileType === 'image'
  const directImageUrl = (isImage && (documentRecord.thumbnailUrl || (documentRecord as { storageUrl?: string }).storageUrl)) || null
  const targetUrl = driveThumbnailUrl || directImageUrl

  if (targetUrl && !imgError && !isFolder) {
    return (
      <div className="small-doc-thumbnail-wrap">
        <img
          src={targetUrl}
          alt={`Thumbnail of ${documentRecord.name}`}
          className="small-doc-thumbnail-img"
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setImgError(true)}
        />
      </div>
    )
  }

  return <DocumentIcon kind={documentRecord.fileType} />
}

function FirstPageDocumentSheet({ documentRecord }: { documentRecord: VaultDocument }) {
  const fileType = documentRecord.fileType
  const name = documentRecord.name || 'Untitled Document'

  const typeConfig: Record<string, { color: string; badge: string; label: string }> = {
    pdf: { color: '#ef4444', badge: 'PDF', label: 'Page 1' },
    presentation: { color: '#f97316', badge: 'PPTX', label: 'Slide 1' },
    document: { color: '#2563eb', badge: 'DOCX', label: 'Page 1' },
    spreadsheet: { color: '#10b981', badge: 'XLSX', label: 'Sheet 1' },
    image: { color: '#8b5cf6', badge: 'IMAGE', label: 'Preview' },
    audio: { color: '#ec4899', badge: 'AUDIO', label: 'Track' },
    video: { color: '#06b6d4', badge: 'VIDEO', label: 'Clip' },
    code: { color: '#6366f1', badge: 'CODE', label: 'Source' },
    other: { color: '#64748b', badge: 'FILE', label: 'Page 1' },
  }

  const config = typeConfig[fileType] || typeConfig.other

  return (
    <div className="first-page-sheet-container">
      <div className="first-page-sheet" style={{ borderTop: `4px solid ${config.color}` }}>
        <div className="first-page-sheet-header">
          <div className="first-page-sheet-badge" style={{ backgroundColor: `${config.color}15`, color: config.color }}>
            {config.badge}
          </div>
          <span className="first-page-sheet-label">{config.label}</span>
        </div>
        <div className="first-page-sheet-body">
          <div className="first-page-sheet-icon-wrap" style={{ color: config.color }}>
            <DocumentIcon kind={fileType} size={28} />
          </div>
          <div className="first-page-sheet-title">{name}</div>
          {fileType === 'presentation' ? (
            <div className="first-page-slide-frame">
              <div className="slide-box-header" style={{ backgroundColor: `${config.color}30` }} />
              <div className="slide-box-line line-long" />
              <div className="slide-box-line line-med" />
            </div>
          ) : fileType === 'spreadsheet' ? (
            <div className="first-page-sheet-grid">
              <div className="grid-cell" />
              <div className="grid-cell" />
              <div className="grid-cell" />
              <div className="grid-cell" />
            </div>
          ) : (
            <div className="first-page-sheet-lines">
              <div className="sheet-line line-h1" style={{ backgroundColor: `${config.color}35` }} />
              <div className="sheet-line line-p1" />
              <div className="sheet-line line-p2" />
              <div className="sheet-line line-p3" />
            </div>
          )}
        </div>
      </div>
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
