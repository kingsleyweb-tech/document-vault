import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, List } from 'lucide-react'
import type { EpubBook } from '../../services/epub'

interface EpubViewerProps {
  blob: Blob
  documentId: string
  zoom: number
}

const positionKey = (documentId: string) => `documentVault.epubPosition.${documentId}`

function readPosition(documentId: string) {
  try {
    return Number(localStorage.getItem(positionKey(documentId))) || 0
  } catch {
    return 0
  }
}

// Shows an EPUB book one chapter at a time, with a contents list, and
// remembers the chapter each book was left at.
export function EpubViewer({ blob, documentId, zoom }: EpubViewerProps) {
  const [book, setBook] = useState<{ blob: Blob; value: EpubBook } | { blob: Blob; error: string } | null>(null)
  const [chapter, setChapter] = useState(() => readPosition(documentId))
  const [content, setContent] = useState<{ index: number; html: string } | null>(null)
  const [showToc, setShowToc] = useState(false)
  const [pendingFragment, setPendingFragment] = useState<string | undefined>()
  const frameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    let cancelled = false
    import('../../services/epub')
      .then(({ openEpub }) => openEpub(blob))
      .then((value) => {
        if (!cancelled) setBook({ blob, value })
      })
      .catch((error: unknown) => {
        console.error(error)
        if (!cancelled) setBook({ blob, error: error instanceof Error && error.name === 'EpubError' ? error.message : 'This book could not be opened. It may be damaged or protected.' })
      })
    return () => {
      cancelled = true
    }
  }, [blob])

  const current = book?.blob === blob ? book : null
  const loaded = current && 'value' in current ? current.value : null
  const chapterCount = loaded?.chapters.length ?? 0
  const index = Math.min(Math.max(chapter, 0), Math.max(chapterCount - 1, 0))

  useEffect(() => {
    if (!loaded) return undefined
    let cancelled = false
    loaded
      .renderChapter(index)
      .then((html) => {
        if (!cancelled) setContent({ index, html })
      })
      .catch((error: unknown) => {
        console.error(error)
        if (!cancelled) setContent({ index, html: '<!doctype html><p style="font-family:sans-serif;padding:2em">This chapter could not be shown.</p>' })
      })
    try {
      localStorage.setItem(positionKey(documentId), String(index))
    } catch {
      // Remembering the position is optional.
    }
    return () => {
      cancelled = true
    }
  }, [loaded, index, documentId])

  if (!current) {
    return (
      <div className="viewer-message" aria-busy="true">
        <span className="app-spinner app-spinner--small" aria-hidden="true" /> Opening book...
      </div>
    )
  }
  if ('error' in current) return <div className="office-fallback">{current.error}</div>
  const bookValue = current.value

  const goTo = (nextIndex: number, fragment?: string) => {
    setPendingFragment(fragment)
    setChapter(Math.min(Math.max(nextIndex, 0), bookValue.chapters.length - 1))
    setShowToc(false)
  }

  // Links between chapters open inside the reader; outside links are not followed.
  const wireFrame = () => {
    const frameDocument = frameRef.current?.contentDocument
    if (!frameDocument) return
    if (pendingFragment) {
      frameDocument.getElementById(pendingFragment)?.scrollIntoView()
      setPendingFragment(undefined)
    } else {
      frameDocument.scrollingElement?.scrollTo(0, 0)
    }
    frameDocument.addEventListener('click', (event) => {
      const anchor = (event.target as Element | null)?.closest?.('a[href]')
      if (!anchor) return
      const href = anchor.getAttribute('href') ?? ''
      if (/^[a-z]+:/i.test(href)) return
      event.preventDefault()
      if (href.startsWith('#')) {
        frameDocument.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView()
        return
      }
      void import('../../services/epub').then(({ resolvePath }) => {
        const target = resolvePath(bookValue.chapters[index].path, href)
        const targetIndex = bookValue.chapters.findIndex((item) => item.path === target)
        const hashIndex = href.indexOf('#')
        if (targetIndex >= 0) goTo(targetIndex, hashIndex >= 0 ? decodeURIComponent(href.slice(hashIndex + 1)) : undefined)
      })
    })
  }

  const contents = bookValue.toc.length > 0 ? bookValue.toc : bookValue.chapters.map((item, chapterIndex) => ({ title: item.title, chapterIndex, depth: 0, fragment: undefined }))

  return (
    <div className="epub-viewer">
      <div className="epub-toolbar">
        <button type="button" className="ghost-button button--small" onClick={() => setShowToc((open) => !open)} aria-expanded={showToc}>
          <List aria-hidden="true" />
          <span>Contents</span>
        </button>
        <div className="epub-toolbar__title">
          <strong>{bookValue.title}</strong>
          {bookValue.author ? <span>{bookValue.author}</span> : null}
        </div>
        <div className="epub-toolbar__nav">
          <button type="button" className="icon-button" onClick={() => goTo(index - 1)} disabled={index === 0} aria-label="Previous chapter">
            <ChevronLeft aria-hidden="true" />
          </button>
          <span>
            {index + 1} / {bookValue.chapters.length}
          </span>
          <button
            type="button"
            className="icon-button"
            onClick={() => goTo(index + 1)}
            disabled={index >= bookValue.chapters.length - 1}
            aria-label="Next chapter"
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="epub-body">
        {showToc ? (
          <nav className="epub-toc" aria-label="Contents">
            <ol>
              {contents.map((entry, entryIndex) => (
                <li key={`${entry.chapterIndex}-${entry.fragment ?? ''}-${entryIndex}`} style={{ paddingLeft: `${entry.depth * 14}px` }}>
                  <button
                    type="button"
                    className={entry.chapterIndex === index && !entry.fragment ? 'is-active' : undefined}
                    onClick={() => goTo(entry.chapterIndex, entry.fragment)}
                  >
                    {entry.title}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        {content && content.index === index ? (
          <iframe
            ref={frameRef}
            className="epub-frame"
            title={`${bookValue.title}: ${bookValue.chapters[index].title}`}
            sandbox="allow-same-origin"
            srcDoc={content.html}
            onLoad={wireFrame}
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
          />
        ) : (
          <div className="viewer-message" aria-busy="true">
            <span className="app-spinner app-spinner--small" aria-hidden="true" /> Loading chapter...
          </div>
        )}
      </div>
    </div>
  )
}
