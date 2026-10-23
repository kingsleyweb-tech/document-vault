import { createPortal } from 'react-dom'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'
import { lazy, Suspense, useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, ExternalLink, FolderOpen, X } from 'lucide-react'
import { companion, CompanionError, type LocalEntry, type TextExcerpt } from '../../services/desktopCompanion'
import { Highlighted } from '../library/Highlighted'
import { OCR_NOTE, whereLabel } from '../library/libraryText'
import { decodeHtml, renderDocx, renderSpreadsheet, sanitizeHtml, type SpreadsheetSheet } from '../../services/documentViewer'
import { PdfVirtualizedViewer } from '../viewer/PdfViewer'
import { linkFileName, safeDecode, wireHtmlLinks } from '../../utils/htmlLinks'

const PresentationViewer = lazy(() =>
  import('../viewer/PresentationViewer').then((module) => ({ default: module.PresentationViewer })),
)

// Text previews show the start of very large files only.
const TEXT_PREVIEW_BYTES = 1024 * 1024

type Loaded =
  | { kind: 'pdf' | 'presentation'; blob: Blob }
  | { kind: 'image' | 'audio' | 'video'; url: string }
  | { kind: 'text'; text: string; truncated: boolean }
  | { kind: 'word' | 'html'; html: string }
  | { kind: 'spreadsheet'; sheets: SpreadsheetSheet[] }

function previewKind(entry: LocalEntry) {
  const extension = entry.extension
  if (extension === 'pdf') return 'pdf'
  if (extension === 'docx') return 'word'
  if (extension === 'xlsx' || extension === 'xls') return 'spreadsheet'
  if (extension === 'pptx') return 'presentation'
  if (entry.kind === 'html') return 'html'
  if (entry.kind === 'image' || entry.kind === 'audio' || entry.kind === 'video') return entry.kind
  return 'text'
}

interface LocalPreviewProps {
  entry: LocalEntry
  onClose: () => void
  onOpen: (entry: LocalEntry) => void
  onReveal: (entry: LocalEntry) => void
  /** Shows another file in this preview, for links between pages. */
  onNavigate: (entry: LocalEntry) => void
  /** Words searched for; the passages that match can then be stepped through. */
  query?: string
  /** The page to show first (from a search match). */
  initialPage?: number | null
}

/** Resolves a link in a page against the folder the page is in, as a path on this computer. */
function resolveLocalPath(folder: string, href: string) {
  const separator = folder.includes('\\') ? '\\' : '/'
  const parts = folder.replace(/[\\/]+$/, '').split(/[\\/]/)
  for (const part of safeDecode(href.split('#')[0].split('?')[0]).split(/[\\/]/)) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length > 1) parts.pop()
      continue
    }
    parts.push(part)
  }
  return { path: parts.join(separator), folder: parts.slice(0, -1).join(separator) || separator, caseless: separator === '\\' }
}

// Read-only preview of a file on this computer, streamed through the companion.
// Nothing is uploaded; the bytes stay in this tab's memory.
export function LocalPreview({ entry, onClose, onOpen, onReveal, onNavigate, query = '', initialPage = null }: LocalPreviewProps) {
  const [loaded, setLoaded] = useState<{ id: number; value: Loaded } | null>(null)
  const [failure, setFailure] = useState<{ id: number; message: string } | null>(null)
  const [activeSheet, setActiveSheet] = useState(0)
  const [linkNotice, setLinkNotice] = useState<string | null>(null)
  const [matches, setMatches] = useState<{ id: number; items: TextExcerpt[] } | null>(null)
  const [matchIndex, setMatchIndex] = useState(-1)
  const [goToPage, setGoToPage] = useState(() => (initialPage ? { page: initialPage, key: 0 } : null))

  // Passages are read from the local index, never from the file again.
  const words = query.trim()
  useEffect(() => {
    if (!words || entry.isFolder) return undefined
    const controller = new AbortController()
    companion.matches(entry.id, words, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return
        setMatches({ id: entry.id, items: result.matches })
        setMatchIndex(initialPage ? result.matches.findIndex((match) => match.page === initialPage) : -1)
      },
      () => {
        // Older companions have no text index; the preview works without it.
      },
    )
    return () => controller.abort()
  }, [entry.id, entry.isFolder, words, initialPage])

  const passages = matches?.id === entry.id ? matches.items : []
  const showMatch = (index: number) => {
    const match = passages[index]
    if (!match) return
    setMatchIndex(index)
    if (match.page) setGoToPage((previous) => ({ page: match.page as number, key: (previous?.key ?? 0) + 1 }))
  }
  const currentMatch = matchIndex >= 0 ? passages[matchIndex] : null

  useEffect(() => {
    if (!linkNotice) return undefined
    const timer = window.setTimeout(() => setLinkNotice(null), 6000)
    return () => window.clearTimeout(timer)
  }, [linkNotice])

  // A link to another file is looked up in the index: pages and documents open
  // in this preview, shortcuts and other files open as they would from a result.
  const followFileLink = async (href: string) => {
    const name = linkFileName(href)
    const target = resolveLocalPath(entry.folder, href)
    const same = (path: string) => (target.caseless ? path.toLowerCase() === target.path.toLowerCase() : path === target.path)
    try {
      const result = await companion.search({ q: name, within: target.folder, limit: 50 })
      const match = result.items.find((item) => same(item.path))
      if (!match) {
        setLinkNotice(`“${name}” is not in a folder Document Vault searches, so it cannot be opened from here.`)
      } else if (match.canPreview) {
        onNavigate(match)
      } else if (match.canOpen) {
        await companion.open(match.id)
      } else {
        setLinkNotice(`“${name}” is a program, and programs are not run from Document Vault.`)
      }
    } catch (error) {
      setLinkNotice(error instanceof CompanionError ? error.message : 'That link could not be opened.')
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | null = null
    const load = async (): Promise<Loaded> => {
      const blob = await companion.content(entry.id, controller.signal)
      const kind = previewKind(entry)
      switch (kind) {
        case 'pdf':
        case 'presentation':
          return { kind, blob }
        case 'image':
        case 'audio':
        case 'video':
          objectUrl = URL.createObjectURL(blob)
          return { kind, url: objectUrl }
        case 'word':
          return { kind, html: await renderDocx(blob) }
        case 'html':
          return { kind, html: sanitizeHtml(await decodeHtml(blob)) }
        case 'spreadsheet':
          return { kind, sheets: await renderSpreadsheet(blob) }
        default: {
          const truncated = blob.size > TEXT_PREVIEW_BYTES
          const text = await (truncated ? blob.slice(0, TEXT_PREVIEW_BYTES) : blob).text()
          return { kind: 'text', text, truncated }
        }
      }
    }
    load().then(
      (value) => {
        if (!controller.signal.aborted) setLoaded({ id: entry.id, value })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        const message =
          error instanceof CompanionError ? error.message : 'This file could not be previewed here. Open it on this computer instead.'
        setFailure({ id: entry.id, message })
      },
    )
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [entry])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useBodyScrollLock(true)

  const current = loaded?.id === entry.id ? loaded.value : null
  const error = failure?.id === entry.id ? failure.message : null
  const previewId = `local-${entry.id}`

  return createPortal(
    <div className="viewer local-preview" role="dialog" aria-modal="true" aria-label={`Preview of ${entry.name}`}>
      <div className="local-preview__panel">
        <header className="local-preview__header">
          <div className="local-preview__title">
            <strong>{entry.name}</strong>
            <span className="local-preview__path" title={entry.path}>
              <span className="source-badge source-badge--local">This computer</span>
              {entry.folder}
            </span>
          </div>
          <div className="local-preview__actions">
            {entry.canOpen ? (
              <button type="button" className="secondary-button button--small" onClick={() => onOpen(entry)}>
                <ExternalLink aria-hidden="true" />
                <span>Open</span>
              </button>
            ) : null}
            <button type="button" className="secondary-button button--small" onClick={() => onReveal(entry)}>
              <FolderOpen aria-hidden="true" />
              <span>Show in folder</span>
            </button>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close preview" autoFocus>
              <X aria-hidden="true" />
            </button>
          </div>
        </header>

        {passages.length > 0 ? (
          <div className="match-bar" role="region" aria-label="Matching passages">
            <span className="match-bar__count" role="status">
              {matchIndex >= 0 ? `Match ${matchIndex + 1} of ${passages.length}` : `${passages.length} matching ${passages.length === 1 ? 'passage' : 'passages'}`}
              {currentMatch ? <span className="match-bar__where">{whereLabel(currentMatch)}</span> : null}
            </span>
            {currentMatch ? (
              <span className="match-bar__text">
                <Highlighted text={currentMatch.text} />
                {currentMatch.source === 'ocr' ? <span className="ocr-note"> {OCR_NOTE}</span> : null}
              </span>
            ) : (
              <span className="match-bar__text">for “{words}”</span>
            )}
            <span className="match-bar__actions">
              <button type="button" className="icon-button" onClick={() => showMatch(matchIndex <= 0 ? passages.length - 1 : matchIndex - 1)} aria-label="Previous match">
                <ChevronUp aria-hidden="true" />
              </button>
              <button type="button" className="icon-button" onClick={() => showMatch(matchIndex >= passages.length - 1 ? 0 : matchIndex + 1)} aria-label="Next match">
                <ChevronDown aria-hidden="true" />
              </button>
            </span>
          </div>
        ) : null}

        <div className="local-preview__body">
          {error ? (
            <p className="notice notice--error" role="alert">
              {error}
            </p>
          ) : !current ? (
            <div className="local-preview__loading" role="status">
              <span className="app-spinner" aria-hidden="true" />
              <span>Loading preview...</span>
            </div>
          ) : current.kind === 'pdf' ? (
            <PdfVirtualizedViewer blob={current.blob} documentName={entry.name} documentId={previewId} zoom={1} goToPage={goToPage} />
          ) : current.kind === 'presentation' ? (
            <Suspense fallback={<div className="local-preview__loading">Loading slides...</div>}>
              <PresentationViewer blob={current.blob} documentName={entry.name} documentId={previewId} zoom={1} />
            </Suspense>
          ) : current.kind === 'image' ? (
            <img className="image-preview" src={current.url} alt={entry.name} />
          ) : current.kind === 'audio' ? (
            <audio className="local-preview__media" src={current.url} controls />
          ) : current.kind === 'video' ? (
            <video className="local-preview__media" src={current.url} controls />
          ) : current.kind === 'word' || current.kind === 'html' ? (
            <iframe
              className="word-frame"
              title={entry.name}
              sandbox="allow-same-origin"
              srcDoc={current.html}
              onLoad={(event) => wireHtmlLinks(event.currentTarget, (href) => void followFileLink(href))}
            />
          ) : current.kind === 'spreadsheet' ? (
            <div className="spreadsheet-viewer">
              <div className="spreadsheet-content">
                <div className="sheet-table-wrapper" dangerouslySetInnerHTML={{ __html: current.sheets[activeSheet]?.html ?? '' }} />
              </div>
              {current.sheets.length > 1 ? (
                <div className="spreadsheet-tabs">
                  {current.sheets.map((sheet, position) => (
                    <button
                      key={sheet.name}
                      type="button"
                      className={position === activeSheet ? 'sheet-tab is-active' : 'sheet-tab'}
                      onClick={() => setActiveSheet(position)}
                    >
                      {sheet.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : current.kind === 'text' ? (
            <div className="text-viewer">
              {current.truncated ? <p className="notice">Showing the first 1 MB of this file.</p> : null}
              <pre>{current.text}</pre>
            </div>
          ) : null}
        </div>
        {linkNotice ? (
          <div className="notice viewer-link-notice" role="status">
            {linkNotice}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
