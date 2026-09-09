import {
  AlertCircle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Heart,
  Maximize2,
  Minus,
  PanelLeft,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
    const currentPreviewText = previewDocumentId === documentRecord?.id ? preview?.text : undefined
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

        {loading ? <div className="viewer-message">Opening document...</div> : null}

        {activeError ? (
          <div className="viewer-message viewer-message--error">
            <strong>{activeError}</strong>
            <div className="viewer-message-actions">
              <button type="button" className="secondary-button" onClick={retry}>
                Try Again
              </button>
              <button type="button" className="primary-button" onClick={() => onDownload(documentRecord)}>
                <Download aria-hidden="true" />
                <span>Download</span>
              </button>
            </div>
          </div>
        ) : null}

        {!loading && !activeError && activePreview?.kind === 'pdf' ? (
          <PdfVirtualizedViewer
            blob={activePreview.blob}
            documentName={documentRecord.name}
            documentId={documentRecord.id}
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
                  <span>
                    Slide {activeSlideIndex + 1} of {activePreview.slides.length}
                  </span>
                </div>
                <h3 className="slide-title">
                  {activePreview.slides[activeSlideIndex]?.title || `Slide ${activeSlideIndex + 1}`}
                </h3>
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
          <iframe className="office-embed-frame" title={documentRecord.name} src={activePreview.embedUrl} allow="autoplay" />
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

// ─────────────────────────────────────────────────────────────────────────────
// HIGH-PERFORMANCE VIRTUALIZED PDF VIEWER & RENDER QUEUE
// ─────────────────────────────────────────────────────────────────────────────

interface SearchMatch {
  pageNumber: number
  text: string
}

function PdfVirtualizedViewer({
  blob,
  documentName,
  documentId,
  zoom,
}: {
  blob: Blob
  documentName: string
  documentId: string
  zoom: number
}) {
  const [numPages, setNumPages] = useState<number | null>(null)
  const [pdfProxy, setPdfProxy] = useState<import('pdfjs-dist').PDFDocumentProxy | null>(null)
  const [pageUrls, setPageUrls] = useState<Record<number, string>>({})
  const [pageHeights, setPageHeights] = useState<Record<number, number>>({})
  const [pageErrors, setPageErrors] = useState<Record<number, string>>({})
  const [renderingPages, setRenderingPages] = useState<Record<number, boolean>>({})

  // Navigation & Virtualization states
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [pageInputText, setPageInputText] = useState<string>('1')
  const [scrollTop, setScrollTop] = useState<number>(0)
  const [stageHeight, setStageHeight] = useState<number>(800)
  const [errorState, setErrorState] = useState<string | null>(null)

  // Drawer & Overlay states
  const [showThumbnails, setShowThumbnails] = useState<boolean>(false)
  const [showSearch, setShowSearch] = useState<boolean>(false)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([])
  const [isSearching, setIsSearching] = useState<boolean>(false)

  // Resume prompt
  const [savedLastPage, setSavedLastPage] = useState<number | null>(null)
  const [showResumeBanner, setShowResumeBanner] = useState<boolean>(false)

  // Queue references
  const renderQueueRef = useRef<Map<number, { pageNumber: number; priority: number }>>(new Map())
  const activeRendersCountRef = useRef<number>(0)
  const MAX_CONCURRENT_RENDERS = 2
  const stageRef = useRef<HTMLDivElement>(null)
  const thumbnailListRef = useRef<HTMLDivElement>(null)
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<number, string>>({})

  const defaultPageHeight = Math.round(900 * zoom)

  // ── 1. Load PDF Proxy & Reset Position to Page 1 ─────────────────────────
  useEffect(() => {
    let cancelled = false
    setNumPages(null)
    setPdfProxy(null)
    setPageUrls({})
    setPageHeights({})
    setPageErrors({})
    setErrorState(null)
    setCurrentPage(1)
    setPageInputText('1')
    setScrollTop(0)

    // Check if user previously read this document
    const savedKey = `vault_last_read_page_${documentId}`
    const saved = localStorage.getItem(savedKey)
    if (saved) {
      const pageNum = parseInt(saved, 10)
      if (pageNum > 1) {
        setSavedLastPage(pageNum)
        setShowResumeBanner(true)
      }
    }

    // Explicitly reset container scroll position to 0 on initial document mount
    if (stageRef.current) {
      stageRef.current.scrollTop = 0
    }

    async function loadPdf() {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString()

        const pdf = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise
        if (cancelled) {
          await pdf.cleanup()
          return
        }
        setPdfProxy(pdf)
        setNumPages(pdf.numPages)

        // Pre-fetch Page 1 viewport dimensions to establish base height ratio
        try {
          const page1 = await pdf.getPage(1)
          const viewport1 = page1.getViewport({ scale: 1 })
          const aspectRatio = viewport1.height / viewport1.width
          const baseHeight = Math.round(800 * aspectRatio * zoom)
          setPageHeights({ 1: baseHeight })
        } catch {
          // fallback
        }
      } catch (err) {
        console.error(err)
        if (!cancelled) {
          setErrorState(err instanceof Error ? err.message : 'Could not load PDF document.')
        }
      }
    }

    void loadPdf()

    return () => {
      cancelled = true
      if (pdfProxy) {
        void pdfProxy.cleanup()
      }
      Object.values(pageUrls).forEach((url) => URL.revokeObjectURL(url))
      Object.values(thumbnailUrls).forEach((url) => URL.revokeObjectURL(url))
    }
  }, [blob, documentId])

  // Save last read page to localStorage as user reads
  useEffect(() => {
    if (documentId && currentPage > 0) {
      localStorage.setItem(`vault_last_read_page_${documentId}`, currentPage.toString())
    }
  }, [documentId, currentPage])

  // ── 2. Calculate Cumulative Heights & Positions ──────────────────────────
  const getPageTop = useCallback(
    (pageNum: number): number => {
      let top = 0
      for (let i = 1; i < pageNum; i++) {
        top += (pageHeights[i] ?? defaultPageHeight) + 24 // 24px margin
      }
      return top
    },
    [defaultPageHeight, pageHeights],
  )

  const totalContainerHeight = useMemo(() => {
    if (!numPages) return 0
    let total = 0
    for (let i = 1; i <= numPages; i++) {
      total += (pageHeights[i] ?? defaultPageHeight) + 24
    }
    return total
  }, [numPages, pageHeights, defaultPageHeight])

  // ── 3. Queue Processor Engine with Concurrency Control & Priorities ──────
  const processRenderQueue = useCallback(async () => {
    if (!pdfProxy || activeRendersCountRef.current >= MAX_CONCURRENT_RENDERS) return
    if (renderQueueRef.current.size === 0) return

    // Pick highest priority task
    let highestPriority = -Infinity
    let targetPageNum: number | null = null

    for (const [pageNum, item] of renderQueueRef.current.entries()) {
      if (!pageUrls[pageNum] && !renderingPages[pageNum] && item.priority > highestPriority) {
        highestPriority = item.priority
        targetPageNum = pageNum
      }
    }

    if (targetPageNum === null) return

    renderQueueRef.current.delete(targetPageNum)
    const pageNumToRender = targetPageNum

    activeRendersCountRef.current += 1
    setRenderingPages((prev) => ({ ...prev, [pageNumToRender]: true }))

    try {
      const urlAndHeight = await renderSinglePdfPage(pdfProxy, pageNumToRender, zoom)
      if (urlAndHeight) {
        setPageUrls((prev) => ({ ...prev, [pageNumToRender]: urlAndHeight.url }))
        setPageHeights((prev) => ({ ...prev, [pageNumToRender]: urlAndHeight.height }))
        setPageErrors((prev) => {
          const next = { ...prev }
          delete next[pageNumToRender]
          return next
        })
      }
    } catch (err) {
      console.error(`Error rendering PDF page ${pageNumToRender}:`, err)
      setPageErrors((prev) => ({
        ...prev,
        [pageNumToRender]: 'Failed to render this page.',
      }))
    } finally {
      activeRendersCountRef.current -= 1
      setRenderingPages((prev) => ({ ...prev, [pageNumToRender]: false }))
      // Continue processing next queued item
      void processRenderQueue()
    }
  }, [pdfProxy, pageUrls, renderingPages, zoom])

  const enqueuePageRender = useCallback(
    (pageNum: number, priority: number) => {
      if (pageUrls[pageNum] || renderingPages[pageNum]) return
      renderQueueRef.current.set(pageNum, { pageNumber: pageNum, priority })
      void processRenderQueue()
    },
    [pageUrls, renderingPages, processRenderQueue],
  )

  // ── 4. Virtualization Range & Memory Eviction ─────────────────────────────
  const visibleStartIndex = useMemo(() => {
    if (!numPages) return 1
    let accumulated = 0
    for (let i = 1; i <= numPages; i++) {
      const h = (pageHeights[i] ?? defaultPageHeight) + 24
      if (accumulated + h >= scrollTop) {
        return Math.max(1, i - 2) // 2 pages overscan
      }
      accumulated += h
    }
    return 1
  }, [numPages, scrollTop, pageHeights, defaultPageHeight])

  const visibleEndIndex = useMemo(() => {
    if (!numPages) return 1
    let accumulated = 0
    const viewBottom = scrollTop + stageHeight
    for (let i = 1; i <= numPages; i++) {
      const h = (pageHeights[i] ?? defaultPageHeight) + 24
      accumulated += h
      if (accumulated >= viewBottom) {
        return Math.min(numPages, i + 2) // 2 pages overscan
      }
    }
    return numPages
  }, [numPages, scrollTop, stageHeight, pageHeights, defaultPageHeight])

  // Handle Container Scroll Events
  const handleScroll = () => {
    if (!stageRef.current || !numPages) return
    const currentScrollTop = stageRef.current.scrollTop
    setScrollTop(currentScrollTop)

    // Calculate current visible page index
    let currentFound = 1
    let accumulated = 0
    const viewCenter = currentScrollTop + stageRef.current.clientHeight / 3
    for (let i = 1; i <= numPages; i++) {
      const h = (pageHeights[i] ?? defaultPageHeight) + 24
      accumulated += h
      if (accumulated >= viewCenter) {
        currentFound = i
        break
      }
    }
    setCurrentPage(currentFound)
    setPageInputText(currentFound.toString())
  }

  // Trigger priority queueing when visible window changes
  useEffect(() => {
    if (!numPages) return

    // Priority 1: Page 1 always gets high priority on initial open
    if (!pageUrls[1] && !renderingPages[1]) {
      enqueuePageRender(1, 100)
    }

    // Priority 2: Currently active page
    if (!pageUrls[currentPage] && !renderingPages[currentPage]) {
      enqueuePageRender(currentPage, 90)
    }

    // Priority 3: Visible range
    for (let i = visibleStartIndex; i <= visibleEndIndex; i++) {
      if (!pageUrls[i] && !renderingPages[i]) {
        const priority = 80 - Math.abs(i - currentPage)
        enqueuePageRender(i, priority)
      }
    }

    // Evict Blob URLs for pages far outside the virtualized window to keep memory low
    const EVICTION_WINDOW = 6
    const minKeep = Math.max(1, visibleStartIndex - EVICTION_WINDOW)
    const maxKeep = Math.min(numPages, visibleEndIndex + EVICTION_WINDOW)

    setPageUrls((prev) => {
      const next = { ...prev }
      let evicted = false
      Object.keys(next).forEach((key) => {
        const p = Number(key)
        if (p < minKeep || p > maxKeep) {
          URL.revokeObjectURL(next[p])
          delete next[p]
          evicted = true
        }
      })
      return evicted ? next : prev
    })
  }, [visibleStartIndex, visibleEndIndex, currentPage, numPages, enqueuePageRender, pageUrls, renderingPages])

  // Track stage height on resize
  useEffect(() => {
    const el = stageRef.current
    if (!el) return undefined
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        setStageHeight(entries[0].contentRect.height)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // ── 5. Page Navigation Controls ──────────────────────────────────────────
  const jumpToPage = (targetPage: number) => {
    if (!numPages || !stageRef.current) return
    const clamped = Math.max(1, Math.min(numPages, targetPage))
    setCurrentPage(clamped)
    setPageInputText(clamped.toString())

    const targetTop = getPageTop(clamped)
    stageRef.current.scrollTo({ top: targetTop, behavior: 'smooth' })

    // Immediately enqueue target page with highest priority
    enqueuePageRender(clamped, 100)
  }

  const handlePageInputSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = parseInt(pageInputText, 10)
    if (!isNaN(parsed)) {
      jumpToPage(parsed)
    }
  }

  // ── 6. PDF Text Search Implementation ────────────────────────────────────
  const handlePerformSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pdfProxy || !searchQuery.trim()) return
    setIsSearching(true)
    setSearchResults([])

    const matches: SearchMatch[] = []
    const query = searchQuery.toLowerCase().trim()

    for (let i = 1; i <= pdfProxy.numPages; i++) {
      try {
        const page = await pdfProxy.getPage(i)
        const textContent = await page.getTextContent()
        const textStr = textContent.items.map((item) => ('str' in item ? item.str : '')).join(' ')
        if (textStr.toLowerCase().includes(query)) {
          matches.push({
            pageNumber: i,
            text: textStr.length > 80 ? `${textStr.slice(0, 80)}...` : textStr,
          })
        }
        if (matches.length >= 30) break // limit matches for performance
      } catch {
        // continue
      }
    }

    setSearchResults(matches)
    setIsSearching(false)
  }

  // ── 7. Render Sidebar Thumbnail on Demand ────────────────────────────────
  const renderThumbnailOnDemand = useCallback(
    async (pageNum: number) => {
      if (thumbnailUrls[pageNum] || !pdfProxy) return
      try {
        const url = await renderPdfThumbnail(pdfProxy, pageNum)
        if (url) {
          setThumbnailUrls((prev) => ({ ...prev, [pageNum]: url }))
        }
      } catch {
        // ignore thumbnail errors
      }
    },
    [pdfProxy, thumbnailUrls],
  )

  if (errorState) {
    return <div className="viewer-message viewer-message--error">{errorState}</div>
  }

  if (!numPages) {
    return (
      <div className="viewer-message">
        <div className="pdf-page-skeleton-spinner" style={{ margin: '0 auto 12px auto' }} />
        <span>Preparing PDF document...</span>
      </div>
    )
  }

  // Generate array of visible page cards inside virtualized range
  const virtualizedCards = []
  for (let i = visibleStartIndex; i <= visibleEndIndex; i++) {
    virtualizedCards.push(i)
  }

  return (
    <div className="viewer-main-layout">
      {/* ── Optional Thumbnails Sidebar Drawer ──────────────────────────────── */}
      <aside className={showThumbnails ? 'viewer-thumbnail-sidebar' : 'viewer-thumbnail-sidebar is-collapsed'}>
        <div className="thumbnail-sidebar-header">
          <span>Page Thumbnails ({numPages})</span>
          <button type="button" className="icon-button" onClick={() => setShowThumbnails(false)} aria-label="Close sidebar">
            <X aria-hidden="true" size={16} />
          </button>
        </div>
        <div className="thumbnail-list" ref={thumbnailListRef}>
          {Array.from({ length: numPages }, (_, idx) => idx + 1).map((pageNum) => (
            <ThumbnailCardItem
              key={pageNum}
              pageNumber={pageNum}
              isActive={pageNum === currentPage}
              thumbnailUrl={thumbnailUrls[pageNum]}
              onClick={() => jumpToPage(pageNum)}
              onVisible={() => renderThumbnailOnDemand(pageNum)}
            />
          ))}
        </div>
      </aside>

      {/* ── Stage Area & Virtual Container ───────────────────────────────────── */}
      <div className="viewer-content-stage" ref={stageRef} onScroll={handleScroll}>
        {/* Resume Banner Prompt */}
        {showResumeBanner && savedLastPage ? (
          <div className="resume-reading-banner" role="status">
            <span>
              You previously stopped reading at <strong>Page {savedLastPage}</strong>
            </span>
            <div className="resume-banner-actions">
              <button
                type="button"
                className="resume-banner-btn resume-banner-btn--primary"
                onClick={() => {
                  setShowResumeBanner(false)
                  jumpToPage(savedLastPage)
                }}
              >
                Continue from Page {savedLastPage}
              </button>
              <button
                type="button"
                className="resume-banner-btn resume-banner-btn--secondary"
                onClick={() => setShowResumeBanner(false)}
              >
                Start from Page 1
              </button>
            </div>
          </div>
        ) : null}

        {/* Floating Controls Overlay */}
        <div
          style={{
            position: 'sticky',
            top: 12,
            zIndex: 80,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 20,
          }}
        >
          {/* Thumbnails Sidebar Toggle */}
          <button
            type="button"
            className={showThumbnails ? 'icon-button is-active' : 'icon-button'}
            onClick={() => setShowThumbnails((prev) => !prev)}
            aria-label="Toggle page thumbnails"
            title="Thumbnails sidebar"
          >
            <PanelLeft aria-hidden="true" size={18} />
          </button>

          {/* Page Navigation Input */}
          <form onSubmit={handlePageInputSubmit} className="page-nav-controls">
            <button
              type="button"
              className="icon-button"
              disabled={currentPage <= 1}
              onClick={() => jumpToPage(currentPage - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft aria-hidden="true" size={16} />
            </button>
            <input
              type="text"
              className="page-number-input"
              value={pageInputText}
              onChange={(e) => setPageInputText(e.target.value)}
              onBlur={handlePageInputSubmit}
              aria-label="Current page number"
            />
            <span className="page-total-label">/ {numPages}</span>
            <button
              type="button"
              className="icon-button"
              disabled={currentPage >= numPages}
              onClick={() => jumpToPage(currentPage + 1)}
              aria-label="Next page"
            >
              <ChevronRight aria-hidden="true" size={16} />
            </button>
          </form>

          {/* Search Toggle Button */}
          <button
            type="button"
            className={showSearch ? 'icon-button is-active' : 'icon-button'}
            onClick={() => setShowSearch((prev) => !prev)}
            aria-label="Search within document"
            title="Search inside PDF"
          >
            <Search aria-hidden="true" size={18} />
          </button>
        </div>

        {/* ── Document Search Overlay Drawer ───────────────────────────────────── */}
        {showSearch ? (
          <div className="pdf-search-panel" role="search">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <strong style={{ fontSize: 13, color: '#f4f4f5' }}>Search in PDF</strong>
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowSearch(false)}
                aria-label="Close search"
              >
                <X aria-hidden="true" size={14} />
              </button>
            </div>
            <form onSubmit={handlePerformSearch} className="pdf-search-input-wrapper">
              <Search aria-hidden="true" size={16} style={{ color: '#a1a1aa' }} />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search text (e.g. contract)..."
              />
              <button type="submit" className="primary-button" style={{ padding: '4px 10px', fontSize: 12 }}>
                Find
              </button>
            </form>

            {isSearching ? <div style={{ fontSize: 12, color: '#a1a1aa' }}>Searching document pages...</div> : null}

            {!isSearching && searchResults.length > 0 ? (
              <div className="pdf-search-results-list">
                <div style={{ fontSize: 11, color: '#60a5fa', fontWeight: 600 }}>
                  Found {searchResults.length} {searchResults.length === 1 ? 'match' : 'matches'}:
                </div>
                {searchResults.map((match, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="pdf-search-result-item"
                    onClick={() => jumpToPage(match.pageNumber)}
                  >
                    <strong>Page {match.pageNumber}</strong>
                    <span>{match.text}</span>
                  </button>
                ))}
              </div>
            ) : null}

            {!isSearching && searchQuery && searchResults.length === 0 ? (
              <div style={{ fontSize: 12, color: '#a1a1aa' }}>No text matches found.</div>
            ) : null}
          </div>
        ) : null}

        {/* ── Virtualized PDF Canvas Area ─────────────────────────────────────── */}
        <div className="pdf-virtual-wrapper">
          <div className="pdf-virtual-container" style={{ height: totalContainerHeight }}>
            {virtualizedCards.map((pageNum) => {
              const topPos = getPageTop(pageNum)
              const cardHeight = pageHeights[pageNum] ?? defaultPageHeight

              return (
                <div
                  key={pageNum}
                  className="pdf-virtual-page-wrapper"
                  style={{ top: topPos, height: cardHeight + 24 }}
                >
                  <article className="pdf-page-card" style={{ height: cardHeight }}>
                    <div className="pdf-page-card-header">
                      <span>
                        {documentName} — Page {pageNum} of {numPages}
                      </span>
                    </div>

                    <div className="pdf-page-render-area">
                      {pageUrls[pageNum] ? (
                        <img src={pageUrls[pageNum]} alt={`${documentName} page ${pageNum}`} />
                      ) : pageErrors[pageNum] ? (
                        <div className="pdf-page-error">
                          <AlertCircle aria-hidden="true" size={24} />
                          <p>{pageErrors[pageNum]}</p>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => enqueuePageRender(pageNum, 100)}
                          >
                            <RefreshCw aria-hidden="true" size={14} />
                            <span>Retry Page {pageNum}</span>
                          </button>
                        </div>
                      ) : (
                        <div className="pdf-page-skeleton">
                          <div className="pdf-page-skeleton-spinner" />
                          <span>Rendering page {pageNum}...</span>
                        </div>
                      )}
                    </div>
                  </article>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LAZY THUMBNAIL CARD COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

function ThumbnailCardItem({
  pageNumber,
  isActive,
  thumbnailUrl,
  onClick,
  onVisible,
}: {
  pageNumber: number
  isActive: boolean
  thumbnailUrl?: string
  onClick: () => void
  onVisible: () => void
}) {
  const itemRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const el = itemRef.current
    if (!el || thumbnailUrl) return undefined

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onVisible()
        }
      },
      { rootMargin: '200px' },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [thumbnailUrl, onVisible])

  return (
    <button
      ref={itemRef}
      type="button"
      className={isActive ? 'thumbnail-card is-active' : 'thumbnail-card'}
      onClick={onClick}
    >
      <div className="thumbnail-preview-box">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt={`Thumbnail ${pageNumber}`} />
        ) : (
          <span style={{ fontSize: 11, color: '#666' }}>Page {pageNumber}</span>
        )}
      </div>
      <span>Page {pageNumber}</span>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF PAGE & THUMBNAIL RENDER HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function renderSinglePdfPage(
  pdf: import('pdfjs-dist').PDFDocumentProxy,
  pageNumber: number,
  zoom: number,
): Promise<{ url: string; height: number } | null> {
  try {
    const page = await pdf.getPage(pageNumber)
    const baseViewport = page.getViewport({ scale: 1 })
    const targetWidth = Math.min(1000, Math.max(600, 900 * zoom))
    const scale = targetWidth / baseViewport.width
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

    if (!pageBlob) return null
    return {
      url: URL.createObjectURL(pageBlob),
      height: Math.ceil(viewport.height),
    }
  } catch (err) {
    console.error(`Page ${pageNumber} render failed:`, err)
    return null
  }
}

async function renderPdfThumbnail(
  pdf: import('pdfjs-dist').PDFDocumentProxy,
  pageNumber: number,
): Promise<string | null> {
  try {
    const page = await pdf.getPage(pageNumber)
    const baseViewport = page.getViewport({ scale: 1 })
    const scale = 160 / baseViewport.width
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

// ─────────────────────────────────────────────────────────────────────────────
// GENERAL VIEWER UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function prepareHtmlContent(
  rawHtml: string,
  _currentDocument: VaultDocument,
  _index: Map<string, VaultDocument>,
): string {
  return rawHtml
}

function getPreviewErrorMessage(error: unknown) {
  if (error instanceof GoogleDriveError) {
    if (error.status === 404) return 'Document is no longer available in Google Drive.'
    if (isDriveAuthorizationError(error))
      return 'Your Google Drive connection needs to be renewed. Reconnect Drive, then try again.'
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
