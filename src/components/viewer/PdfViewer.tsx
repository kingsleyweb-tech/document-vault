import { AlertCircle, ChevronLeft, ChevronRight, PanelLeft, RefreshCw, Search, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import { getPageImage, savePageImage } from '../../services/offlineStore'
import { drawPage, encodePicture, openPdf, pictureWidthFor, readPageSizes, releaseCanvas, renderPagePicture, yieldToBrowser } from '../../services/pdfPages'
import { defaultPageDisplayWidth, notePageImageStored, PREPARED_PAGES } from '../../services/previewQueue'
import { isMemoryConstrained } from '../../utils/device'
import { anchoredOffset, computePageTops, PAGE_GAP, pageIndexAt } from './pdfLayout'

// ─────────────────────────────────────────────────────────────────────────────
// VIRTUALIZED PDF VIEWER
//
// Every page's box is computed from its size in the PDF and the shown width,
// before anything is drawn, so drawing a page never changes the layout. When
// the layout does change (sizes read from the file, zoom, window width), the
// page at the top of the view is kept in place. Earlier versions estimated
// heights and corrected them as pages finished, which made the view drift
// down by itself while pages loaded.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_PAGE_WIDTH = 900
// Phones and tablets keep fewer pages in memory and draw one at a time: iOS
// closes a page that holds too many drawn pages ("A problem repeatedly occurred").
const CONSTRAINED = isMemoryConstrained()
const OVERSCAN_PAGES = CONSTRAINED ? 1 : 2
const KEEP_PAGES = CONSTRAINED ? 2 : 6
const MAX_CONCURRENT_RENDERS = CONSTRAINED ? 1 : 2
/** Pages drawn while reading that are also kept on this device, per document and visit. */
const MAX_STORED_WHILE_READING = CONSTRAINED ? 15 : 40
/** Pages whose size a phone reads up front. */
const SIZED_PAGES_CONSTRAINED = 50

interface SearchMatch {
  pageNumber: number
  text: string
}

/**
 * A freshly drawn page is shown straight from its canvas; it is turned into a
 * small picture file once the browser is idle, which frees the canvas memory.
 */
interface PagePicture {
  url?: string
  canvas?: HTMLCanvasElement
  width: number
}

export interface PdfManifest {
  pageCount: number
  /** [width, height, width, height, ...] in points. */
  pageSizes: number[]
}

export function PdfVirtualizedViewer({
  blob,
  documentName,
  documentId,
  fileId,
  manifest,
  waitingLabel,
  zoom,
  goToPage,
}: {
  /** The PDF, or null while it is still downloading (stored pages show meanwhile). */
  blob: Blob | null
  documentName: string
  documentId: string
  /** Drive file id; when given, pages are read from and kept on this device. */
  fileId?: string
  manifest?: PdfManifest | null
  waitingLabel?: string
  zoom: number
  /** Shows this page once the document is laid out; a new key jumps again, even to the same page. */
  goToPage?: { page: number; key: number } | null
}) {
  const [pdfProxy, setPdfProxy] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState<number | null>(manifest?.pageCount ?? null)
  const [pageSizes, setPageSizes] = useState<number[]>(() => manifest?.pageSizes ?? [])
  const [pictures, setPictures] = useState<Record<number, PagePicture>>({})
  const [pageErrors, setPageErrors] = useState<Record<number, string>>({})
  const [errorState, setErrorState] = useState<string | null>(null)

  const [currentPage, setCurrentPage] = useState(1)
  const [pageInputText, setPageInputText] = useState('1')
  /** Scroll offset measured from the top of the first page. */
  const [viewY, setViewY] = useState(0)
  const [stageHeight, setStageHeight] = useState(800)
  const [contentWidth, setContentWidth] = useState(() => defaultPageDisplayWidth())

  const [showThumbnails, setShowThumbnails] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<number, string>>({})

  // Resume prompt. The viewer is keyed by document, so this is read once per
  // opened document and the document always starts on page 1.
  const [savedLastPage] = useState<number | null>(() => {
    const pageNum = Number.parseInt(localStorage.getItem(`vault_last_read_page_${documentId}`) ?? '', 10)
    return pageNum > 1 ? pageNum : null
  })
  // Not offered when the document was opened at a particular page (a search match).
  const [showResumeBanner, setShowResumeBanner] = useState(() => savedLastPage !== null && !goToPage)

  const stageRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const thumbnailListRef = useRef<HTMLDivElement>(null)
  // Everything that must be released on unmount is tracked in refs, so the
  // cleanup sees what was actually created rather than first-render state.
  const objectUrlsRef = useRef<Set<string>>(new Set())
  const picturesRef = useRef(pictures)
  const renderingRef = useRef<Set<number>>(new Set())
  const lookedUpRef = useRef<Set<number>>(new Set())
  const storedCountRef = useRef(0)
  const wantedRef = useRef<number[]>([])
  const pumpRef = useRef<() => void>(() => undefined)
  const scrollFrameRef = useRef(0)
  // Canvases no longer shown; freed after the next paint, so a page never goes blank first.
  const discardedRef = useRef<Set<HTMLCanvasElement>>(new Set())
  const releaseTimerRef = useRef<number | undefined>(undefined)
  const discardCanvas = useCallback((canvas: HTMLCanvasElement) => {
    discardedRef.current.add(canvas)
    // Not pushed back by later discards: while flicking through pages they come constantly.
    if (releaseTimerRef.current !== undefined) return
    releaseTimerRef.current = window.setTimeout(() => {
      releaseTimerRef.current = undefined
      const shown = new Set(Object.values(picturesRef.current).map((picture) => picture.canvas))
      for (const item of discardedRef.current) {
        if (!shown.has(item)) releaseCanvas(item)
      }
      discardedRef.current.clear()
    }, 100)
  }, [])

  // ── 1. Geometry ───────────────────────────────────────────────────────────
  const pageWidth = Math.max(120, Math.round(Math.min(contentWidth, MAX_PAGE_WIDTH) * zoom))
  const pictureWidth = pictureWidthFor(pageWidth)

  /** tops[i] is where page i+1's card starts; tops[numPages] is the total height. */
  const tops = useMemo(() => computePageTops(numPages ?? 0, pageSizes, pageWidth), [numPages, pageSizes, pageWidth])

  const contentTop = () => containerRef.current?.offsetTop ?? 0

  // Keeps the page at the top of the view in place when the layout changes.
  const previousTopsRef = useRef<Float64Array | null>(null)
  useLayoutEffect(() => {
    const previous = previousTopsRef.current
    previousTopsRef.current = tops
    const stage = stageRef.current
    if (!previous || !stage || previous === tops) return
    const offset = contentTop()
    const y = stage.scrollTop - offset
    const next = anchoredOffset(previous, tops, y)
    if (Math.abs(next - y) >= 1) {
      stage.scrollTop = next + offset
      setViewY(stage.scrollTop - offset)
    }
  }, [tops])

  // ── 2. Open the PDF; read page sizes in the background ────────────────────
  useEffect(() => {
    if (!blob) return undefined
    let cancelled = false
    let task: PDFDocumentLoadingTask | null = null
    const controller = new AbortController()

    void (async () => {
      try {
        const opened = await openPdf(blob)
        task = opened.task
        if (cancelled) return
        const pdf = opened.pdf
        if (!manifest || manifest.pageCount !== pdf.numPages || manifest.pageSizes.length !== pdf.numPages * 2) {
          // The first page's size first, so the layout is right for most documents at once.
          const first = (await pdf.getPage(1)).getViewport({ scale: 1 })
          if (cancelled) return
          setPageSizes([first.width, first.height])
          setNumPages(pdf.numPages)
          setPdfProxy(pdf)
          // Each page read stays in pdf.js's memory until the document closes, so
          // a phone reads only the first pages of a long one; the rest are
          // assumed to be shaped like the last of those.
          const limit = CONSTRAINED ? SIZED_PAGES_CONSTRAINED : Infinity
          const last = Math.min(pdf.numPages, limit)
          await readPageSizes(pdf, {
            limit,
            signal: controller.signal,
            onChunk: (sizes, upTo) => {
              if (!cancelled && (upTo === last || upTo % 200 === 0)) setPageSizes(sizes.slice())
            },
          })
        } else {
          setNumPages(pdf.numPages)
          setPdfProxy(pdf)
        }
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return
        console.error(err)
        setErrorState(err instanceof Error ? err.message : 'Could not load PDF document.')
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
      // Destroying the loading task also releases the document and its worker.
      void task?.destroy()
    }
  }, [blob, manifest])

  useEffect(() => {
    const objectUrls = objectUrlsRef.current
    const discarded = discardedRef.current
    return () => {
      objectUrls.forEach((url) => URL.revokeObjectURL(url))
      objectUrls.clear()
      window.clearTimeout(releaseTimerRef.current)
      window.cancelAnimationFrame(scrollFrameRef.current)
      discarded.forEach(releaseCanvas)
      discarded.clear()
      Object.values(picturesRef.current).forEach((picture) => {
        if (picture.canvas) releaseCanvas(picture.canvas)
      })
    }
  }, [])

  // Save last read page to localStorage as user reads
  useEffect(() => {
    if (documentId && currentPage > 0) {
      localStorage.setItem(`vault_last_read_page_${documentId}`, currentPage.toString())
    }
  }, [documentId, currentPage])

  // Track the stage's size; the page width follows the space available.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return undefined
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (!box) return
      setStageHeight(box.height)
      setContentWidth(Math.max(120, Math.floor(box.width)))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [numPages])

  // ── 3. Visible range ──────────────────────────────────────────────────────
  const [visibleStart, visibleEnd] = useMemo(() => {
    if (!numPages) return [1, 0]
    const y = Math.max(0, viewY)
    const first = pageIndexAt(tops, y) + 1
    const last = pageIndexAt(tops, y + stageHeight) + 1
    return [Math.max(1, first - OVERSCAN_PAGES), Math.min(numPages, last + OVERSCAN_PAGES)]
  }, [numPages, viewY, stageHeight, tops])

  // ── 4. Page pictures: stored ones first, then drawn by pdf.js ─────────────
  const setPicture = useCallback((page: number, picture: PagePicture) => {
    if (picture.url) objectUrlsRef.current.add(picture.url)
    setPictures((prev) => {
      const old = prev[page]
      if (old?.url) {
        URL.revokeObjectURL(old.url)
        objectUrlsRef.current.delete(old.url)
      }
      if (old?.canvas && old.canvas !== picture.canvas) discardCanvas(old.canvas)
      const next = { ...prev, [page]: picture }
      picturesRef.current = next
      return next
    })
  }, [discardCanvas])

  const pump = useCallback(() => {
    const queue = wantedRef.current
    for (const page of queue) {
      if (renderingRef.current.size >= MAX_CONCURRENT_RENDERS) return
      if (renderingRef.current.has(page)) continue
      const have = picturesRef.current[page]
      if (have && have.width >= pictureWidth) continue

      // A picture kept on this device shows at once, even before the PDF is open.
      if (fileId && !have && !lookedUpRef.current.has(page)) {
        lookedUpRef.current.add(page)
        renderingRef.current.add(page)
        void getPageImage(fileId, page).then((stored) => {
          renderingRef.current.delete(page)
          if (stored && !picturesRef.current[page]) setPicture(page, { url: URL.createObjectURL(stored.blob), width: stored.width })
          pumpRef.current()
        })
        continue
      }
      if (!pdfProxy) continue

      const width = pictureWidth
      renderingRef.current.add(page)
      void drawPage(pdfProxy, page, width)
        .then((canvas) => {
          setPicture(page, { canvas, width })
          setPageErrors((prev) => {
            if (!(page in prev)) return prev
            const next = { ...prev }
            delete next[page]
            return next
          })
          const store = Boolean(fileId) && (page <= PREPARED_PAGES || storedCountRef.current < MAX_STORED_WHILE_READING)
          if (store && page > PREPARED_PAGES) storedCountRef.current += 1
          // Encoding waits until the browser is idle so it never delays showing a page.
          // A page scrolled away meanwhile is not encoded; its canvas is already freed.
          void yieldToBrowser(500)
            .then(() => {
              if (picturesRef.current[page]?.canvas !== canvas) throw new Error('Page no longer shown')
              return encodePicture(canvas)
            })
            .then((picture) => {
              if (picturesRef.current[page]?.canvas === canvas) setPicture(page, { url: URL.createObjectURL(picture), width })
              if (store && fileId) void savePageImage(fileId, page, width, picture).then((bytes) => notePageImageStored(fileId, bytes))
            })
            .catch(() => undefined)
        })
        .catch((err: unknown) => {
          if (!pdfProxy || (err instanceof Error && /destroyed|Transport/i.test(err.message))) return
          console.error(`Error rendering PDF page ${page}:`, err)
          setPageErrors((prev) => ({ ...prev, [page]: 'Failed to render this page.' }))
        })
        .finally(() => {
          renderingRef.current.delete(page)
          pumpRef.current()
        })
    }
  }, [fileId, pdfProxy, pictureWidth, setPicture])

  useEffect(() => {
    pumpRef.current = pump
  }, [pump])

  useEffect(() => {
    if (!numPages) return
    // Closest to the current page first.
    const pages: number[] = []
    for (let page = visibleStart; page <= visibleEnd; page += 1) {
      if (!pageErrors[page]) pages.push(page)
    }
    pages.sort((a, b) => Math.abs(a - currentPage) - Math.abs(b - currentPage))
    wantedRef.current = pages
    pump()

    // Release pictures far outside the view to keep memory low.
    const minKeep = Math.max(1, visibleStart - KEEP_PAGES)
    const maxKeep = Math.min(numPages, visibleEnd + KEEP_PAGES)
    setPictures((prev) => {
      let next: Record<number, PagePicture> | null = null
      for (const key of Object.keys(prev)) {
        const page = Number(key)
        if (page >= minKeep && page <= maxKeep) continue
        next ??= { ...prev }
        const { url, canvas } = prev[page]
        if (url) {
          URL.revokeObjectURL(url)
          objectUrlsRef.current.delete(url)
        }
        if (canvas) discardCanvas(canvas)
        lookedUpRef.current.delete(page)
        delete next[page]
      }
      if (next) picturesRef.current = next
      return next ?? prev
    })
  }, [visibleStart, visibleEnd, currentPage, numPages, pageErrors, pump, discardCanvas])

  // ── 5. Scrolling and navigation ───────────────────────────────────────────
  // At most one update per frame: scroll events can fire far more often while flicking.
  const handleScroll = () => {
    if (scrollFrameRef.current) return
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = 0
      readScrollPosition()
    })
  }

  const readScrollPosition = () => {
    const stage = stageRef.current
    if (!stage || !numPages) return
    const top = stage.scrollTop - contentTop()
    setViewY(top)
    const y = top + stage.clientHeight / 3
    const page = Math.min(numPages, pageIndexAt(tops, Math.max(0, y)) + 1)
    setCurrentPage(page)
    setPageInputText(page.toString())
  }

  const jumpToPage = (targetPage: number) => {
    const stage = stageRef.current
    if (!numPages || !stage) return
    const clamped = Math.max(1, Math.min(numPages, targetPage))
    setCurrentPage(clamped)
    setPageInputText(clamped.toString())
    // An instant jump: a smooth scroll across hundreds of pages would draw every page on the way.
    stage.scrollTop = contentTop() + tops[clamped - 1]
    setViewY(stage.scrollTop - contentTop())
  }

  // Each requested page is shown once, as soon as the page count is known.
  const appliedRequestRef = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (!goToPage || !numPages || appliedRequestRef.current === goToPage.key) return
    appliedRequestRef.current = goToPage.key
    jumpToPage(goToPage.page)
  })

  const handlePageInputSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = parseInt(pageInputText, 10)
    if (!isNaN(parsed)) {
      jumpToPage(parsed)
    }
  }

  // ── 6. Text search ────────────────────────────────────────────────────────
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
        page.cleanup()
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

  // ── 7. Sidebar thumbnails on demand ───────────────────────────────────────
  const renderThumbnailOnDemand = useCallback(
    async (pageNum: number) => {
      if (thumbnailUrls[pageNum] || !pdfProxy) return
      try {
        const url = URL.createObjectURL(await renderPagePicture(pdfProxy, pageNum, 160))
        objectUrlsRef.current.add(url)
        setThumbnailUrls((prev) => ({ ...prev, [pageNum]: url }))
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
        <div className="pdf-page-skeleton-spinner" />
        <span>{waitingLabel ?? 'Preparing PDF document...'}</span>
      </div>
    )
  }

  const virtualizedCards = []
  for (let i = visibleStart; i <= visibleEnd; i++) {
    virtualizedCards.push(i)
  }

  return (
    <div className="viewer-main-layout">
      <aside className={showThumbnails ? 'viewer-thumbnail-sidebar' : 'viewer-thumbnail-sidebar is-collapsed'}>
        <div className="thumbnail-sidebar-header">
          <span>Page Thumbnails ({numPages})</span>
          <button type="button" className="icon-button" onClick={() => setShowThumbnails(false)} aria-label="Close sidebar">
            <X aria-hidden="true" size={16} />
          </button>
        </div>
        {showThumbnails ? (
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
        ) : null}
      </aside>

      <div className="viewer-content-stage" ref={stageRef} onScroll={handleScroll}>
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

        <div className="pdf-floating-controls">
          <button
            type="button"
            className={showThumbnails ? 'icon-button is-active' : 'icon-button'}
            onClick={() => setShowThumbnails((prev) => !prev)}
            aria-label="Toggle page thumbnails"
            title="Thumbnails sidebar"
            disabled={!pdfProxy}
          >
            <PanelLeft aria-hidden="true" size={18} />
          </button>

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

          <button
            type="button"
            className={showSearch ? 'icon-button is-active' : 'icon-button'}
            onClick={() => setShowSearch((prev) => !prev)}
            aria-label="Search within document"
            title="Search inside PDF"
            disabled={!pdfProxy}
          >
            <Search aria-hidden="true" size={18} />
          </button>
          {!blob && waitingLabel ? <span className="pdf-waiting-label" role="status">{waitingLabel}</span> : null}
        </div>

        {showSearch ? (
          <div className="pdf-search-panel" role="search">
            <div className="pdf-search-header">
              <strong>Search in PDF</strong>
              <button type="button" className="icon-button" onClick={() => setShowSearch(false)} aria-label="Close search">
                <X aria-hidden="true" size={14} />
              </button>
            </div>
            <form onSubmit={handlePerformSearch} className="pdf-search-input-wrapper">
              <Search aria-hidden="true" size={16} />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search text (e.g. contract)..."
              />
              <button type="submit" className="primary-button primary-button--small">
                Find
              </button>
            </form>

            {isSearching ? <div className="pdf-search-note">Searching document pages...</div> : null}

            {!isSearching && searchResults.length > 0 ? (
              <div className="pdf-search-results-list">
                <div className="pdf-search-count">
                  Found {searchResults.length} {searchResults.length === 1 ? 'match' : 'matches'}:
                </div>
                {searchResults.map((match, idx) => (
                  <button key={idx} type="button" className="pdf-search-result-item" onClick={() => jumpToPage(match.pageNumber)}>
                    <strong>Page {match.pageNumber}</strong>
                    <span>{match.text}</span>
                  </button>
                ))}
              </div>
            ) : null}

            {!isSearching && searchQuery && searchResults.length === 0 ? (
              <div className="pdf-search-note">No text matches found.</div>
            ) : null}
          </div>
        ) : null}

        <div className="pdf-virtual-wrapper" style={pageWidth > contentWidth ? { width: pageWidth, maxWidth: 'none' } : undefined}>
          <div className="pdf-virtual-container" ref={containerRef} style={{ height: tops[numPages] }}>
            {virtualizedCards.map((pageNum) => {
              const cardHeight = tops[pageNum] - tops[pageNum - 1] - PAGE_GAP
              const picture = pictures[pageNum]
              return (
                <div
                  key={pageNum}
                  className="pdf-virtual-page-wrapper"
                  style={{ top: tops[pageNum - 1], height: cardHeight + PAGE_GAP }}
                >
                  <article className="pdf-page-card" style={{ width: pageWidth, height: cardHeight }}>
                    <div className="pdf-page-card-header">
                      <span>
                        {documentName} — Page {pageNum} of {numPages}
                      </span>
                    </div>

                    <div className="pdf-page-render-area">
                      {picture?.url ? (
                        <img src={picture.url} alt={`${documentName} page ${pageNum}`} draggable={false} />
                      ) : picture?.canvas ? (
                        <CanvasPicture canvas={picture.canvas} label={`${documentName} page ${pageNum}`} />
                      ) : pageErrors[pageNum] ? (
                        <div className="pdf-page-error">
                          <AlertCircle aria-hidden="true" size={24} />
                          <p>{pageErrors[pageNum]}</p>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() =>
                              setPageErrors((prev) => {
                                const next = { ...prev }
                                delete next[pageNum]
                                return next
                              })
                            }
                          >
                            <RefreshCw aria-hidden="true" size={14} />
                            <span>Retry Page {pageNum}</span>
                          </button>
                        </div>
                      ) : (
                        <div className="pdf-page-skeleton">
                          <div className="pdf-page-skeleton-spinner" />
                          <span>{blob ? `Rendering page ${pageNum}...` : `Page ${pageNum}`}</span>
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
    <button ref={itemRef} type="button" className={isActive ? 'thumbnail-card is-active' : 'thumbnail-card'} onClick={onClick}>
      <div className="thumbnail-preview-box">
        {thumbnailUrl ? <img src={thumbnailUrl} alt={`Thumbnail ${pageNumber}`} /> : <span className="thumbnail-placeholder">Page {pageNumber}</span>}
      </div>
      <span>Page {pageNumber}</span>
    </button>
  )
}

/** Shows a page drawn moments ago, before it has been turned into a picture file. */
function CanvasPicture({ canvas, label }: { canvas: HTMLCanvasElement; label: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-label', label)
    host.replaceChildren(canvas)
    return () => {
      if (canvas.parentNode === host) host.removeChild(canvas)
    }
  }, [canvas, label])
  return <div ref={hostRef} className="pdf-page-canvas" />
}
