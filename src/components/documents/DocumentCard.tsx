import { useState, useRef, useEffect } from 'react'
import { Download, Eye, Folder, Heart, MoreVertical, Pencil, RotateCcw, Trash2, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { VaultDocument } from '../../types/document'
import { formatDate, formatFileSize } from '../../utils/formatters'
import { DocumentIcon } from './DocumentIcon'

interface DocumentCardProps {
  documentRecord: VaultDocument
  mode: 'grid' | 'list'
  inTrash?: boolean
  itemCount?: number
  pathLabel?: string
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

  // Use Google Drive's public thumbnail endpoint (works for publicly readable files)
  const thumbnailSrc = !isFolder && documentRecord.driveFileId
    ? `https://drive.google.com/thumbnail?id=${documentRecord.driveFileId}&sz=w400`
    : null

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
          {thumbnailSrc ? (
            <img src={thumbnailSrc} alt={`Preview of ${documentRecord.name}`} loading="lazy" />
          ) : (
            <div className="document-thumbnail-placeholder">
              <DocumentIcon kind={documentRecord.fileType} size={40} />
            </div>
          )}
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
          <DocumentIcon kind={documentRecord.fileType} />
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
