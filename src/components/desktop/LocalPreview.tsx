import { createPortal } from 'react-dom'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'
import { lazy, Suspense, useEffect, useState } from 'react'
import { ExternalLink, FolderOpen, X } from 'lucide-react'
import { companion, CompanionError, type LocalEntry } from '../../services/desktopCompanion'
import { renderDocx, renderSpreadsheet, type SpreadsheetSheet } from '../../services/documentViewer'
import { PdfVirtualizedViewer } from '../viewer/PdfViewer'

const PresentationViewer = lazy(() =>
  import('../viewer/PresentationViewer').then((module) => ({ default: module.PresentationViewer })),
)

// Text previews show the start of very large files only.
const TEXT_PREVIEW_BYTES = 1024 * 1024

type Loaded =
  | { kind: 'pdf' | 'presentation'; blob: Blob }
  | { kind: 'image' | 'audio' | 'video'; url: string }
  | { kind: 'text'; text: string; truncated: boolean }
  | { kind: 'word'; html: string }
  | { kind: 'spreadsheet'; sheets: SpreadsheetSheet[] }

function previewKind(entry: LocalEntry) {
  const extension = entry.extension
  if (extension === 'pdf') return 'pdf'
  if (extension === 'docx') return 'word'
  if (extension === 'xlsx' || extension === 'xls') return 'spreadsheet'
  if (extension === 'pptx') return 'presentation'
  if (entry.kind === 'image' || entry.kind === 'audio' || entry.kind === 'video') return entry.kind
  return 'text'
}

interface LocalPreviewProps {
  entry: LocalEntry
  onClose: () => void
  onOpen: (entry: LocalEntry) => void
  onReveal: (entry: LocalEntry) => void
}

// Read-only preview of a file on this computer, streamed through the companion.
// Nothing is uploaded; the bytes stay in this tab's memory.
export function LocalPreview({ entry, onClose, onOpen, onReveal }: LocalPreviewProps) {
  const [loaded, setLoaded] = useState<{ id: number; value: Loaded } | null>(null)
  const [failure, setFailure] = useState<{ id: number; message: string } | null>(null)
  const [activeSheet, setActiveSheet] = useState(0)

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
            <PdfVirtualizedViewer blob={current.blob} documentName={entry.name} documentId={previewId} zoom={1} />
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
          ) : current.kind === 'word' ? (
            <iframe className="word-frame" title={entry.name} sandbox="allow-same-origin" srcDoc={current.html} />
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
      </div>
    </div>,
    document.body,
  )
}
