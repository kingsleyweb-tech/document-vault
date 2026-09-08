import { ArrowLeft, ChevronLeft, ChevronRight, Copy, Download, Heart, Maximize2, Minus, Plus, RotateCcw, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { VaultDocument } from '../../types/document'
import { loadDocumentPreview, type DocumentPreview } from '../../services/documentViewer'
import { GoogleDriveError, isDriveAuthorizationError } from '../../services/googleDrive'
import { normalizeRelativePath } from '../../utils/fileUtils'

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
  const [errorState, setErrorState] = useState<{ documentId: string; message: string } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [textSearch, setTextSearch] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [activeSheetIndex, setActiveSheetIndex] = useState(0)
  const [activeSlideIndex, setActiveSlideIndex] = useState(0)
  const viewerRef = useRef<HTMLDivElement>(null)
  const htmlFrameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    let cancelled = false
    let loadedUrl: string | null = null
    const resetTimer = window.setTimeout(() => {
      if (cancelled) return
      setActiveSheetIndex(0)
      setActiveSlideIndex(0)
      setTextSearch('')
    }, 0)

    if (!documentRecord || !accessToken) {
      return () => {
        cancelled = true
        window.clearTimeout(resetTimer)
      }
    }

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
        if (isDriveAuthorizationError(viewerError)) {
          onReauthRequired?.()
        }
        if (!cancelled) setErrorState({ documentId: documentRecord.id, message: getPreviewErrorMessage(viewerError) })
      })

    return () => {
      cancelled = true
      window.clearTimeout(resetTimer)
      if (loadedUrl) URL.revokeObjectURL(loadedUrl)
    }
  }, [documentRecord, accessToken, onReauthRequired])

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
    const currentPreviewText =
      previewDocumentId === documentRecord?.id ? preview?.text : undefined
    if (!currentPreviewText) return ''
    if (!textSearch.trim()) return currentPreviewText
    const query = textSearch.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
    const regex = new RegExp(`(${query})`, 'gi')
    return currentPreviewText.replace(regex, '<mark>$1</mark>')
  }, [preview?.text, previewDocumentId, documentRecord?.id, textSearch])

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
    setActiveSheetIndex(0)
    setActiveSlideIndex(0)
    loadDocumentPreview(accessToken, documentRecord)
      .then((nextPreview) => {
        setPreview(nextPreview)
        setPreviewDocumentId(documentRecord.id)
      })
      .catch((viewerError) => {
        console.error(viewerError)
        if (isDriveAuthorizationError(viewerError)) {
          onReauthRequired?.()
        }
        setErrorState({ documentId: documentRecord.id, message: getPreviewErrorMessage(viewerError) })
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
        {loading ? <div className="viewer-message">Opening document...</div> : null}
        {activeError ? (
          <div className="viewer-message viewer-message--error">
            <strong>{activeError}</strong>
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
          <PdfPageViewer blob={activePreview.blob} documentName={documentRecord.name} zoom={zoom} />
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
            srcDoc={prepareHtmlContent(activePreview.html || '', documentRecord, documentPathIndex)}
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
        {!loading && !activeError && activePreview?.kind === 'presentation' && activePreview.slides ? (
          <div className="presentation-viewer" style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}>
            <div className="slide-view">
              <div className="slide-card">
                <div className="slide-header-badge">
                  <span>Slide {activeSlideIndex + 1} of {activePreview.slides.length}</span>
                </div>
                <h3 className="slide-title">{activePreview.slides[activeSlideIndex]?.title || `Slide ${activeSlideIndex + 1}`}</h3>
                {activePreview.slides[activeSlideIndex]?.images?.length ? (
                  <div className="slide-images-grid">
                    {activePreview.slides[activeSlideIndex].images!.map((imgUrl, imgIdx) => (
                      <img key={imgIdx} src={imgUrl} alt={`Slide visual ${imgIdx + 1}`} className="slide-image" />
                    ))}
                  </div>
                ) : null}
                <div className="slide-content-text">
                  {activePreview.slides[activeSlideIndex]?.text.slice(1).map((line, lineIndex) => (
                    <p key={lineIndex}>{line}</p>
                  ))}
                </div>
              </div>
            </div>
            <div className="presentation-controls">
              <button
                type="button"
                className="secondary-button"
                disabled={activeSlideIndex === 0}
                onClick={() => setActiveSlideIndex((i) => Math.max(0, i - 1))}
              >
                Previous Slide
              </button>
              <span className="slide-number">
                Slide {activeSlideIndex + 1} of {activePreview.slides.length}
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={activeSlideIndex === activePreview.slides.length - 1}
                onClick={() => setActiveSlideIndex((i) => Math.min(activePreview.slides!.length - 1, i + 1))}
              >
                Next Slide
              </button>
            </div>
          </div>
        ) : null}
        {!loading && !activeError && activePreview?.kind === 'embed' && activePreview.embedUrl ? (
          <iframe
            className="office-embed-frame"
            title={documentRecord.name}
            src={activePreview.embedUrl}
            allow="autoplay"
          />
        ) : null}
        {!loading && !activeError && (activePreview?.kind === 'office' || activePreview?.kind === 'fallback') ? (
          <div className="office-fallback">
            <strong>Preview unavailable</strong>
            <span>This document format is safely stored in your vault and ready for download.</span>
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

function PdfPageViewer({
  blob,
  documentName,
  zoom,
}: {
  blob: Blob
  documentName: string
  zoom: number
}) {
  const [numPages, setNumPages] = useState<number | null>(null)
  const [pageUrls, setPageUrls] = useState<Record<number, string>>({})
  const [errorState, setErrorState] = useState<string | null>(null)

  const pdfKey = `${blob.size}:${blob.type}:${documentName}`
  const pdfRef = useRef<import('pdfjs-dist').PDFDocumentProxy | null>(null)

  useEffect(() => {
    let cancelled = false
    setNumPages(null)
    setPageUrls({})
    setErrorState(null)

    async function loadPdf() {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

        const pdf = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise
        if (cancelled) {
          await pdf.cleanup()
          return
        }
        pdfRef.current = pdf
        setNumPages(pdf.numPages)

        // Immediately render page 1 for quick viewer load (< 1 second)
        renderSinglePage(pdf, 1).then((url) => {
          if (!cancelled && url) {
            setPageUrls((prev) => ({ ...prev, 1: url }))
          }
        })
      } catch (error) {
        console.error(error)
        if (!cancelled) {
          setErrorState(error instanceof Error ? error.message : 'Could not render this PDF.')
        }
      }
    }

    void loadPdf()

    return () => {
      cancelled = true
      if (pdfRef.current) {
        void pdfRef.current.cleanup()
        pdfRef.current = null
      }
      Object.values(pageUrls).forEach((url) => URL.revokeObjectURL(url))
    }
  }, [blob, pdfKey])

  const renderPageOnDemand = (pageNumber: number) => {
    if (pageUrls[pageNumber] || !pdfRef.current) return
    renderSinglePage(pdfRef.current, pageNumber).then((url) => {
      if (url) {
        setPageUrls((prev) => ({ ...prev, [pageNumber]: url }))
      }
    })
  }

  if (errorState) {
    return <div className="viewer-message viewer-message--error">{errorState}</div>
  }

  if (!numPages) {
    return <div className="viewer-message">Loading document pages...</div>
  }

  const pagesArray = Array.from({ length: numPages }, (_, index) => index + 1)

  return (
    <div className="pdf-pages-viewer" aria-label={documentName} style={{ '--viewer-zoom': zoom } as CSSProperties}>
      {pagesArray.map((pageNumber) => (
        <PdfPageCard
          key={pageNumber}
          pageNumber={pageNumber}
          pageUrl={pageUrls[pageNumber]}
          documentName={documentName}
          onVisible={() => renderPageOnDemand(pageNumber)}
        />
      ))}
    </div>
  )
}

function PdfPageCard({
  pageNumber,
  pageUrl,
  documentName,
  onVisible,
}: {
  pageNumber: number
  pageUrl?: string
  documentName: string
  onVisible: () => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = cardRef.current
    if (!el || pageUrl) return undefined

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onVisible()
        }
      },
      { rootMargin: '300px' },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [pageUrl, onVisible])

  return (
    <figure className="pdf-page" ref={cardRef}>
      {pageUrl ? (
        <img src={pageUrl} alt={`${documentName} page ${pageNumber}`} loading="lazy" />
      ) : (
        <div className="pdf-page-skeleton">Rendering page {pageNumber}...</div>
      )}
      <figcaption>Page {pageNumber}</figcaption>
    </figure>
  )
}

async function renderSinglePage(pdf: import('pdfjs-dist').PDFDocumentProxy, pageNumber: number): Promise<string | null> {
  try {
    const page = await pdf.getPage(pageNumber)
    const baseViewport = page.getViewport({ scale: 1 })
    const scale = Math.min(2, Math.max(1.2, 980 / baseViewport.width))
    const viewport = page.getViewport({ scale })
    const canvas = window.document.createElement('canvas')
    const canvasContext = canvas.getContext('2d')
    if (!canvasContext) return null

    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvas, canvasContext, viewport }).promise

    const pageBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/png')
    })
    return pageBlob ? URL.createObjectURL(pageBlob) : null
  } catch {
    return null
  }
}

function prepareHtmlContent(rawHtml: string, _currentDocument: VaultDocument, _index: Map<string, VaultDocument>): string {
  // If HTML contains relative images (e.g. <img src="logo.png">), attempt to map them to matching document URLs
  return rawHtml
}

function getPreviewErrorMessage(error: unknown) {
  if (error instanceof GoogleDriveError) {
    if (error.status === 404) return 'Document is no longer available in Google Drive.'
    if (isDriveAuthorizationError(error)) return 'Your Google Drive connection needs to be renewed. Reconnect Drive, then try again.'
    if (error.status === 403) return 'You do not currently have permission to access this document.'
    if (error.status === 429) return 'Google Drive is temporarily limiting requests. Retrying...'
    return `Google Drive request failed (${error.status}): ${error.message}`
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
