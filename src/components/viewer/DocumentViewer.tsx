import { ArrowLeft, Copy, Download, Heart, Maximize2, Minus, Plus, RotateCcw, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { VaultDocument } from '../../types/document'
import { loadDocumentPreview, type DocumentPreview } from '../../services/documentViewer'
import { normalizeRelativePath } from '../../utils/fileUtils'

interface DocumentViewerProps {
  documentRecord: VaultDocument | null
  documents: VaultDocument[]
  accessToken: string | null
  onClose: () => void
  onDownload: (documentRecord: VaultDocument) => void
  onOpenDocument: (documentRecord: VaultDocument) => void
  onFavorite: (documentRecord: VaultDocument) => void
}

export function DocumentViewer({
  documentRecord,
  documents,
  accessToken,
  onClose,
  onDownload,
  onOpenDocument,
  onFavorite,
}: DocumentViewerProps) {
  const [preview, setPreview] = useState<DocumentPreview | null>(null)
  const [previewDocumentId, setPreviewDocumentId] = useState<string | null>(null)
  const [errorState, setErrorState] = useState<{ documentId: string; message: string } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [textSearch, setTextSearch] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const viewerRef = useRef<HTMLDivElement>(null)
  const htmlFrameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!documentRecord || !accessToken) return undefined

    let cancelled = false
    let loadedUrl: string | null = null

    loadDocumentPreview(accessToken, documentRecord)
      .then((nextPreview) => {
        if (cancelled) {
          URL.revokeObjectURL(nextPreview.objectUrl)
          return
        }
        loadedUrl = nextPreview.objectUrl
        setPreview(nextPreview)
        setPreviewDocumentId(documentRecord.id)
        setErrorState(null)
      })
      .catch((viewerError) => {
        console.error(viewerError)
        if (!cancelled) setErrorState({ documentId: documentRecord.id, message: 'Unable to preview this document.' })
      })

    return () => {
      cancelled = true
      if (loadedUrl) URL.revokeObjectURL(loadedUrl)
    }
  }, [documentRecord, accessToken])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === viewerRef.current)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const documentPathIndex = useMemo(() => buildDocumentPathIndex(documents), [documents])

  if (!documentRecord) return null

  const activePreview = previewDocumentId === documentRecord.id ? preview : null
  const activeError = errorState?.documentId === documentRecord.id ? errorState.message : null
  const loading = !activeError && !activePreview
  const zoomOut = () => setZoom((currentZoom) => Math.max(0.5, currentZoom - 0.1))
  const zoomIn = () => setZoom((currentZoom) => Math.min(2, currentZoom + 0.1))
  const enterFullscreen = () => {
    void viewerRef.current?.requestFullscreen()
  }
  const retry = () => {
    if (!documentRecord || !accessToken) return
    setPreview(null)
    setPreviewDocumentId(null)
    setErrorState(null)
    loadDocumentPreview(accessToken, documentRecord)
      .then((nextPreview) => {
        setPreview(nextPreview)
        setPreviewDocumentId(documentRecord.id)
      })
      .catch((viewerError) => {
        console.error(viewerError)
        setErrorState({ documentId: documentRecord.id, message: 'Unable to preview this document.' })
      })
  }
  const copyText = async () => {
    if (activePreview?.text) await navigator.clipboard.writeText(activePreview.text)
  }
  const matchingText = activePreview?.text && textSearch.trim()
    ? activePreview.text.toLowerCase().includes(textSearch.trim().toLowerCase())
    : true
  const openRelativeHtmlLink = (href: string) => {
    const matchedDocument = resolveHtmlLink(documentRecord, href, documentPathIndex)
    if (matchedDocument) {
      onOpenDocument(matchedDocument)
      return true
    }
    return false
  }

  return (
    <div
      className={isFullscreen ? 'viewer is-fullscreen' : 'viewer'}
      ref={viewerRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Viewing ${documentRecord.name}`}
    >
      <header className="viewer-toolbar">
        <button type="button" className="icon-button" onClick={onClose} aria-label="Back to documents">
          <ArrowLeft aria-hidden="true" />
        </button>
        <div>
          <strong>{documentRecord.name}</strong>
          <span>{documentRecord.originalName}</span>
        </div>
        <div className="viewer-controls">
          <button
            type="button"
            onClick={zoomOut}
            aria-label="Zoom out"
          >
            <Minus aria-hidden="true" />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={zoomIn}
            aria-label="Zoom in"
          >
            <Plus aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setZoom(1)} aria-label="Fit width">
            <RotateCcw aria-hidden="true" />
          </button>
          <button type="button" onClick={enterFullscreen} aria-label="Full screen">
            <Maximize2 aria-hidden="true" />
          </button>
          <button
            type="button"
            className={documentRecord.isFavorite ? 'is-active' : ''}
            onClick={() => onFavorite(documentRecord)}
            aria-label={documentRecord.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Heart aria-hidden="true" />
          </button>
          <button type="button" onClick={() => onDownload(documentRecord)} aria-label="Download original file">
            <Download aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="viewer-stage">
        {loading ? <div className="viewer-message">Opening document...</div> : null}
        {activeError ? (
          <div className="viewer-message viewer-message--error">
            <strong>{activeError}</strong>
            <span>The file may be missing, deleted, unsupported, or your Drive authorization may have expired.</span>
            <div className="viewer-message-actions">
              <button type="button" className="secondary-button" onClick={retry}>Try Again</button>
              <button type="button" className="primary-button" onClick={() => onDownload(documentRecord)}>
                <Download aria-hidden="true" />
                <span>Download</span>
              </button>
            </div>
          </div>
        ) : null}
        {!loading && !activeError && activePreview?.kind === 'pdf' ? (
          <object
            className="pdf-frame"
            data={`${activePreview.objectUrl}#zoom=${Math.round(zoom * 100)}`}
            type="application/pdf"
            aria-label={documentRecord.name}
          >
            <div className="viewer-message">This browser cannot display the PDF inline.</div>
          </object>
        ) : null}
        {!loading && !activeError && activePreview?.kind === 'image' ? (
          <img
            className="image-preview"
            src={activePreview.objectUrl}
            alt={documentRecord.name}
            style={{ transform: `scale(${zoom})` }}
          />
        ) : null}
        {!loading && !activeError && activePreview?.kind === 'html' ? (
          <iframe
            ref={htmlFrameRef}
            className="html-frame"
            title={documentRecord.name}
            sandbox="allow-same-origin allow-popups allow-downloads"
            srcDoc={activePreview.html}
            onLoad={() => wireHtmlLinks(htmlFrameRef.current, openRelativeHtmlLink)}
            style={{ transform: `scale(${zoom})` }}
          />
        ) : null}
        {!loading && !activeError && activePreview?.kind === 'text' ? (
          <div className="text-viewer" style={{ transform: `scale(${zoom})` }}>
            <div className="text-viewer-toolbar">
              <label className="search-box">
                <Search aria-hidden="true" />
                <input
                  value={textSearch}
                  onChange={(event) => setTextSearch(event.target.value)}
                  placeholder="Search within document"
                  type="search"
                />
              </label>
              <button type="button" className="secondary-button" onClick={copyText}>
                <Copy aria-hidden="true" />
                <span>Copy text</span>
              </button>
            </div>
            {!matchingText ? <div className="notice">No text matches found.</div> : null}
            <pre>{activePreview.text}</pre>
          </div>
        ) : null}
        {!loading && !activeError && activePreview?.kind === 'office' ? (
          <div className="office-fallback">
            <strong>Preview unavailable</strong>
            <span>
              This file was downloaded successfully from Google Drive, but this browser build does not include an
              Office renderer for {documentRecord.originalName}.
            </span>
            <button type="button" className="primary-button" onClick={() => onDownload(documentRecord)}>
              <Download aria-hidden="true" />
              <span>Download Document</span>
            </button>
          </div>
        ) : null}
        {!loading && !activeError && activePreview?.kind === 'fallback' ? (
          <div className="office-fallback">
            <strong>Preview unavailable</strong>
            <span>This file type is stored safely in your vault and can be downloaded.</span>
            <button type="button" className="primary-button" onClick={() => onDownload(documentRecord)}>
              <Download aria-hidden="true" />
              <span>Download</span>
            </button>
          </div>
        ) : null}
        {!loading && !activeError && activePreview?.kind === 'office' && documentRecord.fileType === 'presentation' ? (
          <div className="slide-counter">Slide preview requires an Office renderer. Download is available.</div>
        ) : null}
        {!loading && !activeError && activePreview?.kind === 'office' && documentRecord.fileType === 'spreadsheet' ? (
          <div className="slide-counter">Spreadsheet preview requires an Office renderer. Download is available.</div>
        ) : null}
        {!loading && !activeError && activePreview?.kind === 'office' && documentRecord.fileType === 'word' ? (
          <div className="slide-counter">Document preview requires an Office renderer. Download is available.</div>
        ) : null}
      </div>

      {isFullscreen ? (
        <div className="fullscreen-magnifier" aria-label="Fullscreen zoom controls">
          <Search aria-hidden="true" />
          <button type="button" onClick={zoomOut} aria-label="Zoom out">
            <Minus aria-hidden="true" />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={zoomIn} aria-label="Zoom in">
            <Plus aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  )
}

function buildDocumentPathIndex(documents: VaultDocument[]) {
  const index = new Map<string, VaultDocument>()
  documents
    .filter((documentRecord) => documentRecord.fileType !== 'folder')
    .forEach((documentRecord) => {
      const path = normalizeRelativePath(
        [documentRecord.folderPath, documentRecord.originalName].filter(Boolean).join('/'),
      ).toLowerCase()
      index.set(path, documentRecord)
      index.set(normalizeRelativePath(documentRecord.originalName).toLowerCase(), documentRecord)
    })
  return index
}

function resolveHtmlLink(currentDocument: VaultDocument, href: string, index: Map<string, VaultDocument>) {
  if (!href || /^(https?:|mailto:|tel:|#)/i.test(href)) return null

  const decodedHref = normalizeRelativePath(decodeURIComponent(href.split('#')[0].split('?')[0]))
  const currentFolderParts = normalizeRelativePath(currentDocument.folderPath ?? '').split('/').filter(Boolean)
  const targetParts = [...currentFolderParts]

  decodedHref.split('/').forEach((part) => {
    if (!part || part === '.') return
    if (part === '..') {
      targetParts.pop()
      return
    }
    targetParts.push(part)
  })

  const resolvedPath = targetParts.join('/').toLowerCase()
  return index.get(resolvedPath) ?? index.get(decodedHref.toLowerCase()) ?? null
}

function wireHtmlLinks(frame: HTMLIFrameElement | null, openRelativeHtmlLink: (href: string) => boolean) {
  const frameDocument = frame?.contentDocument
  if (!frameDocument) return

  frameDocument.querySelectorAll('a[href]').forEach((anchor) => {
    anchor.addEventListener('click', (event) => {
      const href = anchor.getAttribute('href')
      if (href && openRelativeHtmlLink(href)) {
        event.preventDefault()
      }
    })
  })
}
