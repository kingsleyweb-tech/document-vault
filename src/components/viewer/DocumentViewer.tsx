import { ArrowLeft, Download, Maximize2, Minus, Plus, RotateCcw, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { VaultDocument } from '../../types/document'
import { getDriveFileBlob } from '../../services/googleDrive'

interface DocumentViewerProps {
  documentRecord: VaultDocument | null
  accessToken: string | null
  onClose: () => void
  onDownload: (documentRecord: VaultDocument) => void
}

export function DocumentViewer({ documentRecord, accessToken, onClose, onDownload }: DocumentViewerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const viewerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!documentRecord || !accessToken) return undefined

    let currentUrl: string | null = null

    getDriveFileBlob(accessToken, documentRecord.driveFileId)
      .then((blob) => {
        currentUrl = URL.createObjectURL(blob)
        setBlobUrl(currentUrl)
      })
      .catch((viewerError) => {
        console.error(viewerError)
        setError('Unable to open this document. Reconnect Google Drive and try again.')
      })

    return () => {
      if (currentUrl) URL.revokeObjectURL(currentUrl)
      setBlobUrl(null)
      setError(null)
    }
  }, [documentRecord, accessToken])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === viewerRef.current)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const canRenderInline = useMemo(
    () => documentRecord?.fileType === 'pdf' || documentRecord?.fileType === 'image',
    [documentRecord],
  )

  if (!documentRecord) return null

  const loading = !error && !blobUrl && canRenderInline
  const zoomOut = () => setZoom((currentZoom) => Math.max(0.5, currentZoom - 0.1))
  const zoomIn = () => setZoom((currentZoom) => Math.min(2, currentZoom + 0.1))
  const enterFullscreen = () => {
    void viewerRef.current?.requestFullscreen()
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
          <button type="button" onClick={() => onDownload(documentRecord)} aria-label="Download original file">
            <Download aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="viewer-stage">
        {loading ? <div className="viewer-message">Opening document...</div> : null}
        {error ? <div className="viewer-message viewer-message--error">{error}</div> : null}
        {!loading && !error && blobUrl && documentRecord.fileType === 'pdf' ? (
          <object
            className="pdf-frame"
            data={blobUrl}
            type="application/pdf"
            style={{ transform: `scale(${zoom})` }}
            aria-label={documentRecord.name}
          >
            <div className="viewer-message">This browser cannot display the PDF inline.</div>
          </object>
        ) : null}
        {!loading && !error && blobUrl && documentRecord.fileType === 'image' ? (
          <img
            className="image-preview"
            src={blobUrl}
            alt={documentRecord.name}
            style={{ transform: `scale(${zoom})` }}
          />
        ) : null}
        {!loading && !error && !canRenderInline ? (
          <div className="office-viewer-container" style={{ transform: `scale(${zoom})` }}>
            <iframe
              className="office-frame"
              src={`https://drive.google.com/file/d/${documentRecord.driveFileId}/preview`}
              title={documentRecord.name}
              aria-label={documentRecord.name}
              allow="autoplay"
            />
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
