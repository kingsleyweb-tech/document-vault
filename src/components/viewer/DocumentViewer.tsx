import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Heart,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  Search,
} from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { VaultDocument } from '../../types/document'
import { getPreviewKind, loadDocumentPreview, type DocumentPreview } from '../../services/documentViewer'
import { queueContentIndex } from '../../services/contentIndex'
import { backfillContentHash } from '../../services/contentHash'
import { GoogleDriveError, isDriveAuthorizationError } from '../../services/googleDrive'
import { getPageImage, getPreviewMeta, SLIDE_SNAPSHOT_PAGE } from '../../services/offlineStore'
import type { PptxDocument, PptxSnapshot } from '../../services/pptx'
import { enqueuePreview, setForegroundDocument } from '../../services/previewQueue'
import { normalizeRelativePath } from '../../utils/fileUtils'
import { formatFileSize, highlightPlainText } from '../../utils/formatters'
import { ArchiveListing } from './ArchiveListing'
import { PdfVirtualizedViewer, type PdfManifest } from './PdfViewer'


// The slide engine is only needed for presentations, so it is not part of the
// app's first download. It is fetched while the browser is idle, so opening a
// deck rarely waits for it.
const loadPresentationViewer = () => import('./PresentationViewer')
const PresentationViewer = lazy(() => loadPresentationViewer().then((module) => ({ default: module.PresentationViewer })))
const EpubViewer = lazy(() => import('./EpubViewer').then((module) => ({ default: module.EpubViewer })))
if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
  window.requestIdleCallback(() => void loadPresentationViewer().catch(() => undefined), { timeout: 10000 })
}

interface DocumentViewerProps {
  documentRecord: VaultDocument | null
  documents: VaultDocument[]
  accessToken: string | null
  onClose: () => void
  onDownload: (documentRecord: VaultDocument) => void
  onOpenDocument: (documentRecord: VaultDocument) => void
  onFavorite: (documentRecord: VaultDocument) => void
  onReauthRequired?: () => void
}

export function DocumentViewer({
  documentRecord,
  documents,
  accessToken,
  onClose,
  onDownload,
  onOpenDocument,
  onFavorite,
  onReauthRequired,
}: DocumentViewerProps) {
  const [preview, setPreview] = useState<DocumentPreview | null>(null)
  const [previewDocumentId, setPreviewDocumentId] = useState<string | null>(null)
  const [errorState, setErrorState] = useState<{ documentId: string; message: string; needsDrive?: boolean } | null>(null)
  const [download, setDownload] = useState<{ documentId: string; loaded: number; total: number } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [textSearch, setTextSearch] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [activeSheetIndex, setActiveSheetIndex] = useState(0)
  const viewerRef = useRef<HTMLDivElement>(null)
  // Callers pass a fresh function each render; reading it through a ref keeps
  // those re-renders from restarting the document download.
  const onReauthRequiredRef = useRef(onReauthRequired)
  useEffect(() => {
    onReauthRequiredRef.current = onReauthRequired
  }, [onReauthRequired])
  const htmlFrameRef = useRef<HTMLIFrameElement>(null)
  // Page count and sizes prepared earlier on this device, so a PDF's layout
  // and stored first pages show while the file itself is still loading.
  const [pdfManifest, setPdfManifest] = useState<{ documentId: string; manifest: PdfManifest } | null>(null)
  // A deck's first slides prepared earlier on this device, shown the same way.
  const [deckSnapshot, setDeckSnapshot] = useState<{ documentId: string; deck: PptxDocument } | null>(null)

  const viewedRecordId = documentRecord?.id
  const viewedFileId = documentRecord?.driveFileId
  const viewedVersion = documentRecord?.version ?? 1
  useEffect(() => {
    if (!viewedRecordId || !viewedFileId) return undefined
    let current = true
    // Background preparation waits while a document is open.
    setForegroundDocument(viewedFileId)
    let deck: PptxDocument | null = null
    void getPreviewMeta(viewedFileId).then(async (meta) => {
      // Anything prepared from another version of the file is ignored.
      if (!current || !meta || meta.version !== viewedVersion) return
      if (meta.pageCount && meta.pageSizes) {
        setPdfManifest({ documentId: viewedRecordId, manifest: { pageCount: meta.pageCount, pageSizes: meta.pageSizes } })
      } else if (meta.previewKind === 'presentation' && meta.imageBytes > 0) {
        const stored = await getPageImage(viewedFileId, SLIDE_SNAPSHOT_PAGE)
        if (!current || !stored) return
        try {
          const { pptxFromSnapshot } = await import('../../services/pptx')
          const snapshot = JSON.parse(await stored.blob.text()) as PptxSnapshot
          if (!current) return
          deck = pptxFromSnapshot(snapshot, stored.media ?? {})
          setDeckSnapshot({ documentId: viewedRecordId, deck })
        } catch (error) {
          console.warn('The stored first slides could not be read:', error)
        }
      }
    })
    return () => {
      current = false
      setForegroundDocument(null)
      deck?.dispose()
    }
  }, [viewedRecordId, viewedFileId, viewedVersion])

  useEffect(() => {
    let cancelled = false
    let loadedUrl: string | null = null
    const resetTimer = window.setTimeout(() => {
      if (cancelled) return
      setActiveSheetIndex(0)
      setTextSearch('')
    }, 0)

    if (!documentRecord) {
      return () => {
        cancelled = true
        window.clearTimeout(resetTimer)
      }
    }

    // Opening another document stops this download instead of letting it
    // compete for the connection.
    const controller = new AbortController()
    let lastProgressAt = 0
    loadDocumentPreview(accessToken, documentRecord, {
      signal: controller.signal,
      onProgress: (loaded, total) => {
        const now = performance.now()
        if (now - lastProgressAt < 100 && loaded !== total) return
        lastProgressAt = now
        if (!cancelled) setDownload({ documentId: documentRecord.id, loaded, total })
      },
    })
      .then((nextPreview) => {
        if (cancelled) {
          if (nextPreview.objectUrl) URL.revokeObjectURL(nextPreview.objectUrl)
          return
        }
        loadedUrl = nextPreview.objectUrl
        setPreview(nextPreview)
        setPreviewDocumentId(documentRecord.id)
        setErrorState(null)
        queueContentIndex(documentRecord, nextPreview.blob)
        backfillContentHash(documentRecord, nextPreview.blob)
        // Prepares it for next time (page sizes, first pages) once the viewer closes.
        enqueuePreview(documentRecord, 'open')
      })
      .catch((viewerError) => {
        if (cancelled) return
        console.error(viewerError)
        const needsDrive = isDriveAuthorizationError(viewerError)
        // A missing token is already known to the app; only a rejected one needs reporting.
        if (needsDrive && accessToken) onReauthRequiredRef.current?.()
        setErrorState({ documentId: documentRecord.id, message: getPreviewErrorMessage(viewerError), needsDrive })
      })

    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(resetTimer)
      if (loadedUrl) URL.revokeObjectURL(loadedUrl)
    }
  }, [documentRecord, accessToken, reloadKey])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === viewerRef.current)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const documentPathIndex = useMemo(() => buildDocumentPathIndex(documents), [documents])
  const openableDocuments = useMemo(
    () => documents.filter((document) => document.fileType !== 'folder' && !document.isDeleted),
    [documents],
  )
  const currentDocumentIndex = useMemo(
    () => openableDocuments.findIndex((document) => document.id === documentRecord?.id),
    [documentRecord?.id, openableDocuments],
  )
  const previousDocument = currentDocumentIndex > 0 ? openableDocuments[currentDocumentIndex - 1] : null
  const nextDocument =
    currentDocumentIndex >= 0 && currentDocumentIndex < openableDocuments.length - 1
      ? openableDocuments[currentDocumentIndex + 1]
      : null

  useEffect(() => {
    if (!documentRecord) return undefined

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (isTypingTarget(event.target)) return
      // Paged viewers (presentations) use the arrow keys for their own navigation.
      if (event.defaultPrevented) return

      if (event.key === 'ArrowLeft' && previousDocument) {
        event.preventDefault()
        onOpenDocument(previousDocument)
      }
      if (event.key === 'ArrowRight' && nextDocument) {
        event.preventDefault()
        onOpenDocument(nextDocument)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [documentRecord, nextDocument, onOpenDocument, previousDocument])

  const highlightedText = useMemo(() => {
    const currentPreviewText = previewDocumentId === documentRecord?.id ? preview?.text : undefined
    if (!currentPreviewText) return ''
    return highlightPlainText(currentPreviewText, textSearch)
  }, [preview?.text, previewDocumentId, documentRecord?.id, textSearch])

  if (!documentRecord) return null

  const activePreview = previewDocumentId === documentRecord.id ? preview : null
  const activeError = errorState?.documentId === documentRecord.id ? errorState.message : null
  const activeManifest = pdfManifest?.documentId === documentRecord.id ? pdfManifest.manifest : null
  // A prepared PDF shows its layout and stored pages while it is still loading.
  const earlyPdf = !activeError && !activePreview && Boolean(activeManifest) && getPreviewKind(documentRecord) === 'pdf'
  const activeSnapshot = deckSnapshot?.documentId === documentRecord.id ? deckSnapshot.deck : null
  // Snapshots exist only for slide decks.
  const earlyDeck = !activeError && !activePreview && Boolean(activeSnapshot)
  const loading = !activeError && !activePreview && !earlyPdf && !earlyDeck
  const zoomOut = () => setZoom((currentZoom) => Math.max(0.5, currentZoom - 0.1))
  const zoomIn = () => setZoom((currentZoom) => Math.min(2, currentZoom + 0.1))
  const enterFullscreen = () => {
    void viewerRef.current?.requestFullscreen()
  }
  const activeDownload = download?.documentId === documentRecord.id ? download : null
  const retry = () => {
    setPreview(null)
    setPreviewDocumentId(null)
    setErrorState(null)
    setDownload(null)
    setActiveSheetIndex(0)
    setReloadKey((key) => key + 1)
  }
  const copyText = async () => {
    if (activePreview?.text) await navigator.clipboard.writeText(activePreview.text)
  }
  const matchingText =
    activePreview?.text && textSearch.trim()
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
          <button type="button" onClick={zoomOut} aria-label="Zoom out">
            <Minus aria-hidden="true" />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={zoomIn} aria-label="Zoom in">
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
        {previousDocument ? (
          <button
            type="button"
            className="viewer-side-nav viewer-side-nav--left"
            onClick={() => onOpenDocument(previousDocument)}
            aria-label={`Open previous file: ${previousDocument.name}`}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
        ) : null}
        {nextDocument ? (
          <button
            type="button"
            className="viewer-side-nav viewer-side-nav--right"
            onClick={() => onOpenDocument(nextDocument)}
            aria-label={`Open next file: ${nextDocument.name}`}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        ) : null}

        {loading ? (
          <div className="viewer-message" role="status" aria-live="polite">
            <span>{getLoadingLabel(activeDownload, documentRecord.fileSize)}</span>
            <progress
              className="viewer-progress"
              max={1}
              value={activeDownload ? downloadFraction(activeDownload, documentRecord.fileSize) ?? undefined : undefined}
            />
          </div>
        ) : null}

        {activeError ? (
          <div className="viewer-message viewer-message--error">
            <strong>{activeError}</strong>
            <div className="viewer-message-actions">
              {errorState?.needsDrive && onReauthRequired ? (
                <button type="button" className="secondary-button" onClick={onReauthRequired}>
                  Reconnect Google Drive
                </button>
              ) : (
                <button type="button" className="secondary-button" onClick={retry}>
                  Try Again
                </button>
              )}
              <button type="button" className="primary-button" onClick={() => onDownload(documentRecord)}>
                <Download aria-hidden="true" />
                <span>Download</span>
              </button>
            </div>
          </div>
        ) : null}

        {earlyPdf || (!loading && !activeError && activePreview?.kind === 'pdf') ? (
          <PdfVirtualizedViewer
            key={documentRecord.id}
            blob={activePreview?.blob ?? null}
            documentName={documentRecord.name}
            documentId={documentRecord.id}
            fileId={documentRecord.driveFileId || undefined}
            manifest={activeManifest}
            waitingLabel={earlyPdf ? getLoadingLabel(activeDownload, documentRecord.fileSize) : undefined}
            zoom={zoom}
          />
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
            srcDoc={activePreview.html || ''}
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
            <pre dangerouslySetInnerHTML={{ __html: highlightedText }} />
          </div>
        ) : null}

        {!loading && !activeError && activePreview?.kind === 'word' ? (
          <iframe
            className="word-frame"
            title={documentRecord.name}
            sandbox="allow-same-origin allow-popups allow-downloads"
            srcDoc={activePreview.html}
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
          />
        ) : null}

        {!loading && !activeError && activePreview?.kind === 'spreadsheet' && activePreview.sheets ? (
          <div className="spreadsheet-viewer" style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}>
            <div className="spreadsheet-content">
              <div
                className="sheet-table-wrapper"
                dangerouslySetInnerHTML={{ __html: activePreview.sheets[activeSheetIndex]?.html || '' }}
              />
            </div>
            {activePreview.sheets.length > 1 && (
              <div className="spreadsheet-tabs">
                {activePreview.sheets.map((sheet, index) => (
                  <button
                    key={sheet.name}
                    type="button"
                    className={index === activeSheetIndex ? 'sheet-tab is-active' : 'sheet-tab'}
                    onClick={() => setActiveSheetIndex(index)}
                  >
                    {sheet.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {earlyDeck || (!loading && !activeError && activePreview?.kind === 'presentation') ? (
          <Suspense fallback={<div className="viewer-message">Preparing slides...</div>}>
            <PresentationViewer
              key={documentRecord.id}
              blob={activePreview?.kind === 'presentation' ? activePreview.blob : null}
              snapshot={activeSnapshot}
              waitingLabel={earlyDeck ? getLoadingLabel(activeDownload, documentRecord.fileSize) : undefined}
              documentId={documentRecord.id}
              documentName={documentRecord.name}
              zoom={zoom}
            />
          </Suspense>
        ) : null}

        {!loading && !activeError && activePreview?.kind === 'embed' && activePreview.embedUrl ? (
          <iframe className="office-embed-frame" title={documentRecord.name} src={activePreview.embedUrl} allow="autoplay" />
        ) : null}

        {!loading && !activeError && activePreview?.kind === 'media' ? (
          activePreview.blob.type.startsWith('audio/') || /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/i.test(documentRecord.originalName) ? (
            <div className="media-preview">
              <audio controls preload="metadata" src={activePreview.objectUrl} aria-label={documentRecord.name} />
            </div>
          ) : (
            <div className="media-preview">
              <video controls preload="metadata" src={activePreview.objectUrl} aria-label={documentRecord.name} />
            </div>
          )
        ) : null}

        {!loading && !activeError && activePreview?.kind === 'archive' ? <ArchiveListing blob={activePreview.blob} /> : null}

        {!loading && !activeError && activePreview?.kind === 'epub' ? (
          <Suspense fallback={<div className="viewer-message">Opening book...</div>}>
            <EpubViewer key={documentRecord.id} blob={activePreview.blob} documentId={documentRecord.id} zoom={zoom} />
          </Suspense>
        ) : null}

        {!loading && !activeError && (activePreview?.kind === 'office' || activePreview?.kind === 'fallback') ? (
          <div className="office-fallback">
            <strong>Preview unavailable</strong>
            <span>
              {/\.(lnk|exe|msi|dll|jar|scr|com)$/i.test(documentRecord.originalName)
                ? 'Programs and shortcuts are never opened or run from Document Vault. You can download the file.'
                : 'This format cannot be shown here. It is safely stored in your vault and ready for download.'}
            </span>
            <button type="button" className="primary-button" onClick={() => onDownload(documentRecord)}>
              <Download aria-hidden="true" />
              <span>Download File</span>
            </button>
          </div>
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

// ─────────────────────────────────────────────────────────────────────────────
// GENERAL VIEWER UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────


/** Share of the download done, or null while the size is unknown. */
function downloadFraction(progress: { loaded: number; total: number }, recordedSize?: number) {
  // Drive omits Content-Length for some files; the size saved at upload stands in.
  const total = progress.total || recordedSize || 0
  return total > 0 ? Math.min(1, progress.loaded / total) : null
}

function getLoadingLabel(progress: { loaded: number; total: number } | null, recordedSize?: number) {
  if (!progress || progress.loaded === 0) return 'Opening document...'
  const fraction = downloadFraction(progress, recordedSize)
  if (fraction === null) return `Downloading ${formatFileSize(progress.loaded)}...`
  if (fraction >= 1) return 'Preparing preview...'
  return `Downloading ${formatFileSize(progress.loaded)} of ${formatFileSize(progress.total || recordedSize || 0)} (${Math.round(fraction * 100)}%)`
}

function getPreviewErrorMessage(error: unknown) {
  if (error instanceof GoogleDriveError) {
    if (error.reason === 'tokenMissing') return 'Connect Google Drive to open this document. Documents you opened before also work offline.'
    if (error.status === 404) return 'Document is no longer available in Google Drive.'
    if (isDriveAuthorizationError(error))
      return 'Your Google Drive connection needs to be renewed. Reconnect Drive, then try again.'
    if (error.status === 403) return 'You do not currently have permission to access this document.'
    if (error.status === 429) return 'Google Drive is temporarily limiting requests. Retrying...'
    return `Google Drive request failed (${error.status}): ${error.message}`
  }
  if (error instanceof TypeError || (error instanceof Error && /network|failed to fetch/i.test(error.message))) {
    return 'Could not reach Google Drive. Check your internet connection, then try again.'
  }
  if (error instanceof Error) return error.message || 'Unable to preview this document.'
  return 'Unable to preview this document.'
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable
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
