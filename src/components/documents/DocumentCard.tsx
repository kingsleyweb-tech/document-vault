import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Download, Eye, FolderInput, History, MoreHorizontal, Pencil, RotateCcw, Star, Tag, Trash2, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { VaultDocument } from '../../types/document'
import { loadThumbnailObjectUrl } from '../../services/thumbnails'
import { formatDate, formatFileSize } from '../../utils/formatters'
import { kindLabel } from '../../utils/kinds'
import { DocumentIcon } from './DocumentIcon'
import { usePreviewStatus } from '../../hooks/usePreviewStatus'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'

/** Below this width the item menu opens as a sheet from the bottom of the screen. */
const SHEET_QUERY = '(max-width: 640px)'

export interface ItemActions {
  onView: (documentRecord: VaultDocument) => void
  onDownload: (documentRecord: VaultDocument) => void
  onRename: (documentRecord: VaultDocument) => void
  onFavorite: (documentRecord: VaultDocument) => void
  onTrash: (documentRecord: VaultDocument) => void
  onMove?: (documentRecord: VaultDocument) => void
  onEditDetails?: (documentRecord: VaultDocument) => void
  onCopy?: (documentRecord: VaultDocument) => void
  onVersions?: (documentRecord: VaultDocument) => void
  onRestore?: (documentRecord: VaultDocument) => void
  onPermanentDelete?: (documentRecord: VaultDocument) => void
}

interface ItemProps {
  documentRecord: VaultDocument
  actions: ItemActions
  inTrash?: boolean
  itemCount?: number
  location?: string
  accessToken?: string | null
  isSelected?: boolean
  onSelectToggle?: () => void
}

function useOpenItem(documentRecord: VaultDocument, actions: ItemActions, inTrash?: boolean) {
  const navigate = useNavigate()
  return () => {
    if (inTrash) return
    if (documentRecord.fileType === 'folder') navigate(`/folders/${documentRecord.id}`)
    else actions.onView(documentRecord)
  }
}

function describe(documentRecord: VaultDocument, itemCount?: number) {
  if (documentRecord.fileType === 'folder') {
    const count = itemCount ?? 0
    return `${count} ${count === 1 ? 'item' : 'items'}`
  }
  return `${formatFileSize(documentRecord.fileSize)} · ${formatDate(documentRecord.updatedAt)}`
}

const missingHint = 'Google Drive no longer has this file. It may have been deleted in Drive. The vault keeps its details so you know what is missing.'

function TagChips({ tags }: { tags?: string[] }) {
  if (!tags || tags.length === 0) return null
  const shown = tags.slice(0, 3)
  return (
    <span className="doc-tags" title={tags.map((tag) => `#${tag}`).join(' ')}>
      {shown.map((tag) => (
        <span key={tag} className="doc-tag">
          #{tag}
        </span>
      ))}
      {tags.length > shown.length ? <span className="doc-tag doc-tag--more">+{tags.length - shown.length}</span> : null}
    </span>
  )
}

function MissingBadge({ documentRecord }: { documentRecord: VaultDocument }) {
  return documentRecord.driveMissing ? (
    <span className="chip chip--danger doc-missing" title={missingHint}>
      Missing from Drive
    </span>
  ) : null
}

const preparationLabels: Record<string, { label: string; className: string }> = {
  queued: { label: 'Queued', className: 'chip' },
  processing: { label: 'Preparing', className: 'chip chip--accent' },
  ready: { label: 'Ready', className: 'chip chip--success' },
  partial: { label: 'Partly ready', className: 'chip' },
  failed: { label: 'Preview failed', className: 'chip chip--danger' },
}

/** Whether this device has prepared the file for fast opening (services/previewQueue.ts). */
function PreparationBadge({ documentRecord }: { documentRecord: VaultDocument }) {
  const meta = usePreviewStatus(documentRecord.fileType === 'folder' ? undefined : documentRecord.driveFileId)
  if (!meta || meta.version !== (documentRecord.version ?? 1)) return null
  const shown = preparationLabels[meta.status]
  if (!shown) return null
  const waiting = meta.status === 'queued' && meta.waitingFor
    ? meta.waitingFor === 'drive' ? 'Waiting for Google Drive' : 'Waiting for the internet'
    : null
  const title = meta.status === 'ready'
    ? 'Prepared on this device: opens at once, also offline'
    : waiting ?? meta.error ?? 'Being prepared on this device for fast opening'
  return (
    <span className={`${shown.className} doc-preparation`} title={title} data-status={meta.status}>
      {waiting ? 'Waiting' : shown.label}
    </span>
  )
}

export function DocumentCard({ documentRecord, actions, inTrash, itemCount, location, accessToken, isSelected, onSelectToggle }: ItemProps) {
  const open = useOpenItem(documentRecord, actions, inTrash)
  const isFolder = documentRecord.fileType === 'folder'

  return (
    <article className={`doc-card${isFolder ? ' is-folder' : ''}${isSelected ? ' is-selected' : ''}`}>
      {onSelectToggle ? (
        <label className="doc-card__check" title="Select">
          <input type="checkbox" checked={Boolean(isSelected)} onChange={onSelectToggle} aria-label={`Select ${documentRecord.name}`} />
        </label>
      ) : null}
      {documentRecord.isFavorite && !inTrash ? (
        <span className="doc-card__star" title="Favorite">
          <Star aria-hidden="true" />
        </span>
      ) : null}

      {isFolder ? (
        <button type="button" className="doc-card__folder" onClick={open} disabled={inTrash} aria-label={`Open ${documentRecord.name}`}>
          <DocumentIcon kind="folder" size={26} />
        </button>
      ) : (
        <button type="button" className="doc-card__preview" onClick={open} disabled={inTrash} aria-label={`Open ${documentRecord.name}`}>
          <DocumentThumbnail documentRecord={documentRecord} accessToken={accessToken} />
          <span className={`doc-card__kind kind-text--${documentRecord.fileType}`}>{kindLabel(documentRecord.fileType)}</span>
        </button>
      )}

      <div className="doc-card__body">
        <div className="doc-card__text">
          <h3 title={documentRecord.originalName || documentRecord.name}>
            {isFolder ? (
              documentRecord.name
            ) : (
              <button type="button" className="link-reset" onClick={open} disabled={inTrash}>
                {documentRecord.name}
              </button>
            )}
          </h3>
          <p>{describe(documentRecord, itemCount)}</p>
          <TagChips tags={documentRecord.tags} />
          <MissingBadge documentRecord={documentRecord} />
          <PreparationBadge documentRecord={documentRecord} />
          {location ? <p className="doc-card__location" title={location}>{inTrash ? `From ${location}` : location}</p> : null}
        </div>
        <ItemMenu documentRecord={documentRecord} actions={actions} inTrash={inTrash} />
      </div>
    </article>
  )
}

export function DocumentRow({ documentRecord, actions, inTrash, itemCount, location, accessToken, isSelected, onSelectToggle }: ItemProps) {
  const open = useOpenItem(documentRecord, actions, inTrash)
  const isFolder = documentRecord.fileType === 'folder'
  void accessToken

  return (
    <div className={`doc-row${isSelected ? ' is-selected' : ''}`} role="row">
      <span className="doc-row__check" role="cell">
        {onSelectToggle ? (
          <input type="checkbox" checked={Boolean(isSelected)} onChange={onSelectToggle} aria-label={`Select ${documentRecord.name}`} />
        ) : null}
      </span>
      <span className="doc-row__name" role="cell">
        <SmallThumbnail documentRecord={documentRecord} />
        <span className="doc-row__title">
          <button type="button" className="link-reset" onClick={open} disabled={inTrash} title={documentRecord.originalName || documentRecord.name}>
            {documentRecord.name}
          </button>
          {location ? <small title={location}>{inTrash ? `From ${location}` : location}</small> : null}
          <TagChips tags={documentRecord.tags} />
          <MissingBadge documentRecord={documentRecord} />
          <PreparationBadge documentRecord={documentRecord} />
        </span>
        {documentRecord.isFavorite && !inTrash ? <Star className="doc-row__star" aria-label="Favorite" /> : null}
      </span>
      <span className="doc-row__kind" role="cell">{kindLabel(documentRecord.fileType)}</span>
      <span className="doc-row__date" role="cell">{formatDate(documentRecord.updatedAt)}</span>
      <span className="doc-row__size" role="cell">
        {isFolder ? `${itemCount ?? 0} ${itemCount === 1 ? 'item' : 'items'}` : formatFileSize(documentRecord.fileSize)}
      </span>
      <span className="doc-row__actions" role="cell">
        {inTrash && actions.onRestore ? (
          <button type="button" className="ghost-button button--small doc-row__restore" onClick={() => actions.onRestore?.(documentRecord)}>
            <RotateCcw aria-hidden="true" />
            <span>Restore</span>
          </button>
        ) : null}
        <ItemMenu documentRecord={documentRecord} actions={actions} inTrash={inTrash} />
      </span>
    </div>
  )
}

function ItemMenu({ documentRecord, actions, inTrash }: { documentRecord: VaultDocument; actions: ItemActions; inTrash?: boolean }) {
  // `sheet`: a phone-sized screen, where the menu slides up from the bottom
  // instead of hanging off the button (it would not fit above or below it).
  const [position, setPosition] = useState<{ top: number; left: number; sheet: boolean } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const open = useOpenItem(documentRecord, actions, inTrash)
  const isFolder = documentRecord.fileType === 'folder'

  const place = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    if (window.matchMedia?.(SHEET_QUERY).matches) {
      setPosition({ top: 0, left: 0, sheet: true })
      return
    }
    const rect = trigger.getBoundingClientRect()
    const width = 210
    // Measured once shown (see below); this first guess only decides the side.
    const height = menuRef.current?.offsetHeight ?? 380
    setPosition({ ...menuPlacement(rect, width, height), sheet: false })
  }, [])

  // The real height is only known once the menu is on screen: move it so it fits.
  useLayoutEffect(() => {
    const menu = menuRef.current
    const trigger = triggerRef.current
    if (!position || position.sheet || !menu || !trigger) return
    const next = menuPlacement(trigger.getBoundingClientRect(), menu.offsetWidth, menu.offsetHeight)
    if (Math.abs(next.top - position.top) > 1 || Math.abs(next.left - position.left) > 1) setPosition({ ...next, sheet: false })
  }, [position])

  useBodyScrollLock(Boolean(position?.sheet))

  const close = useCallback(() => setPosition(null), [])

  useEffect(() => {
    if (!position) return undefined
    const handlePointer = (event: globalThis.MouseEvent) => {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) close()
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
        triggerRef.current?.focus()
      }
    }
    // Scrolling the page moves the button away from the menu; scrolling inside the menu does not.
    const handleScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('mousedown', handlePointer, true)
    document.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', close)
    document.addEventListener('keydown', handleKey)
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => {
      document.removeEventListener('mousedown', handlePointer, true)
      document.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', close)
      document.removeEventListener('keydown', handleKey)
    }
  }, [position, close])

  const run = (action: () => void) => (event: MouseEvent) => {
    event.stopPropagation()
    close()
    action()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="icon-button item-menu-trigger"
        onClick={(event) => {
          event.stopPropagation()
          if (position) close()
          else place()
        }}
        aria-label={`Actions for ${documentRecord.name}`}
        aria-haspopup="menu"
        aria-expanded={Boolean(position)}
      >
        <MoreHorizontal aria-hidden="true" />
      </button>
      {position
        ? createPortal(
            <>
            {position.sheet ? <div className="menu-backdrop" aria-hidden="true" onClick={close} /> : null}
            <div
              ref={menuRef}
              className={position.sheet ? 'menu menu--sheet' : 'menu'}
              role="menu"
              aria-label={documentRecord.name}
              style={position.sheet ? undefined : { top: position.top, left: position.left }}
            >
              {position.sheet ? <div className="menu-sheet__title">{documentRecord.name}</div> : null}
              {inTrash ? (
                <>
                  {actions.onRestore ? (
                    <button type="button" role="menuitem" onClick={run(() => actions.onRestore?.(documentRecord))}>
                      <RotateCcw aria-hidden="true" />
                      <span>Restore</span>
                    </button>
                  ) : null}
                  {actions.onPermanentDelete ? (
                    <>
                      <div className="menu-divider" />
                      <button type="button" role="menuitem" className="is-danger" onClick={run(() => actions.onPermanentDelete?.(documentRecord))}>
                        <X aria-hidden="true" />
                        <span>Delete permanently</span>
                      </button>
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  <button type="button" role="menuitem" onClick={run(open)}>
                    <Eye aria-hidden="true" />
                    <span>{isFolder ? 'Open' : 'Preview'}</span>
                  </button>
                  {!isFolder ? (
                    <button type="button" role="menuitem" onClick={run(() => actions.onDownload(documentRecord))}>
                      <Download aria-hidden="true" />
                      <span>Download</span>
                    </button>
                  ) : null}
                  <button type="button" role="menuitem" onClick={run(() => actions.onRename(documentRecord))}>
                    <Pencil aria-hidden="true" />
                    <span>Rename</span>
                  </button>
                  {!isFolder && actions.onEditDetails ? (
                    <button type="button" role="menuitem" onClick={run(() => actions.onEditDetails?.(documentRecord))}>
                      <Tag aria-hidden="true" />
                      <span>Edit details</span>
                    </button>
                  ) : null}
                  {!isFolder && actions.onCopy ? (
                    <button type="button" role="menuitem" onClick={run(() => actions.onCopy?.(documentRecord))}>
                      <Copy aria-hidden="true" />
                      <span>Make a copy</span>
                    </button>
                  ) : null}
                  {!isFolder && actions.onVersions ? (
                    <button type="button" role="menuitem" onClick={run(() => actions.onVersions?.(documentRecord))}>
                      <History aria-hidden="true" />
                      <span>Version history</span>
                    </button>
                  ) : null}
                  {actions.onMove ? (
                    <button type="button" role="menuitem" onClick={run(() => actions.onMove?.(documentRecord))}>
                      <FolderInput aria-hidden="true" />
                      <span>Move to folder</span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    className={documentRecord.isFavorite ? 'is-active' : undefined}
                    onClick={run(() => actions.onFavorite(documentRecord))}
                  >
                    <Star aria-hidden="true" />
                    <span>{documentRecord.isFavorite ? 'Remove from favorites' : 'Add to favorites'}</span>
                  </button>
                  <div className="menu-divider" />
                  <button type="button" role="menuitem" className="is-danger" onClick={run(() => actions.onTrash(documentRecord))}>
                    <Trash2 aria-hidden="true" />
                    <span>Move to Trash</span>
                  </button>
                </>
              )}
            </div>
            </>,
            document.body,
          )
        : null}
    </>
  )
}

/** Below the button when it fits, above it otherwise, and always fully on screen. */
function menuPlacement(rect: DOMRect, width: number, height: number) {
  const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
  const below = rect.bottom + 6
  const above = rect.top - height - 6
  const top = below + height <= window.innerHeight - 8 ? below : above >= 8 ? above : Math.max(8, window.innerHeight - height - 8)
  return { top, left }
}

function driveThumbnailUrl(documentRecord: VaultDocument, size: number) {
  if (documentRecord.thumbnailUrl) return documentRecord.thumbnailUrl.replace(/=s\d+/, `=s${size}`)
  if (documentRecord.driveFileId) return `https://lh3.googleusercontent.com/d/${documentRecord.driveFileId}=s${size}`
  return null
}

export function DocumentThumbnail({ documentRecord, accessToken }: { documentRecord: VaultDocument; accessToken?: string | null }) {
  const [failedFileId, setFailedFileId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ fileId: string; objectUrl: string | null } | null>(null)
  const fileId = documentRecord.driveFileId
  const version = documentRecord.version ?? 1
  const previewKey = `${fileId}@${version}`
  const cdnUrl = useMemo(() => driveThumbnailUrl(documentRecord, 600), [documentRecord])
  const canLoadAuthenticated = Boolean(accessToken && fileId) && documentRecord.fileType !== 'folder'
  const activePreview = preview?.fileId === previewKey ? preview : null

  useEffect(() => {
    if (!canLoadAuthenticated || !accessToken) return undefined
    let cancelled = false
    loadThumbnailObjectUrl(accessToken, { driveFileId: fileId, fileType: documentRecord.fileType, thumbnailUrl: documentRecord.thumbnailUrl, version, fileSize: documentRecord.fileSize })
      .then((objectUrl) => {
        if (!cancelled) setPreview({ fileId: previewKey, objectUrl })
      })
      .catch(() => {
        if (!cancelled) setPreview({ fileId: previewKey, objectUrl: null })
      })
    return () => {
      cancelled = true
    }
  }, [accessToken, canLoadAuthenticated, fileId, previewKey, version, documentRecord.fileType, documentRecord.thumbnailUrl, documentRecord.fileSize])

  if (activePreview?.objectUrl) {
    return <img className="doc-thumb" src={activePreview.objectUrl} alt="" decoding="async" />
  }

  if (cdnUrl && failedFileId !== fileId) {
    return (
      <img
        className="doc-thumb"
        src={cdnUrl}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailedFileId(fileId)}
      />
    )
  }

  return (
    <span className={`doc-thumb-fallback kind-bg--${documentRecord.fileType}`}>
      <DocumentIcon kind={documentRecord.fileType} size={30} />
    </span>
  )
}

function SmallThumbnail({ documentRecord }: { documentRecord: VaultDocument }) {
  const [failed, setFailed] = useState(false)
  const url = documentRecord.fileType === 'image' && !failed ? driveThumbnailUrl(documentRecord, 96) : null

  if (url) {
    return (
      <span className="small-thumb">
        <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      </span>
    )
  }
  return <DocumentIcon kind={documentRecord.fileType} size={18} />
}
