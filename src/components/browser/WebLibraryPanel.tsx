import { useMemo, useState, type FormEvent } from 'react'
import { BookOpen, Copy, ExternalLink, FolderPlus, Link2, Pencil, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { displayUrl, LINK_CHECK_LABELS, webBrowser, type WebBookmark, type WebLibrary } from '../../services/webBrowser'
import { Dialog } from '../ui/Dialog'

export type WebPanelView = 'saved' | 'recent'

interface WebLibraryPanelProps {
  library: WebLibrary | null
  reload: () => void
  view: WebPanelView
  onViewChange: (view: WebPanelView) => void
  editingId: string | null
  onEditingChange: (id: string | null) => void
  onOpen: (url: string, newTab: boolean) => void
  onMessage: (text: string, tone?: 'info' | 'error') => void
  onClose: () => void
}

const ALL = '\u0000all'
const UNFILED = '\u0000none'
const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

// Saved references (with folders, notes, duplicate marks and link checks) and
// recently visited pages, beside the web page.
export function WebLibraryPanel({ library, reload, view, onViewChange, editingId, onEditingChange, onOpen, onMessage, onClose }: WebLibraryPanelProps) {
  const [filter, setFilter] = useState('')
  const [folder, setFolder] = useState(ALL)
  const [checking, setChecking] = useState(false)
  const [folderDialog, setFolderDialog] = useState<{ mode: 'add' | 'rename'; value: string } | null>(null)
  const [confirm, setConfirm] = useState<'history' | 'data' | 'folder' | null>(null)

  const run = async (work: () => Promise<unknown>, success?: string) => {
    try {
      await work()
      if (success) onMessage(success)
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'That did not work.', 'error')
    } finally {
      reload()
    }
  }

  const words = filter.trim().toLowerCase()
  const bookmarks = useMemo(
    () =>
      (library?.bookmarks ?? []).filter(
        (item) =>
          (folder === ALL || (folder === UNFILED ? !item.folder : item.folder === folder)) &&
          (!words || `${item.title} ${item.url} ${item.note} ${item.folder}`.toLowerCase().includes(words)),
      ),
    [library, folder, words],
  )
  const history = useMemo(
    () => (library?.history ?? []).filter((item) => !words || `${item.title} ${item.url}`.toLowerCase().includes(words)),
    [library, words],
  )
  const duplicates = library?.bookmarks.filter((item) => item.duplicate).length ?? 0

  const checkLinks = async () => {
    setChecking(true)
    const ids = bookmarks.map((item) => item.id)
    await run(async () => {
      const { checked } = await webBrowser.checkLinks(ids)
      onMessage(checked === 1 ? 'Checked 1 link.' : `Checked ${checked} links.`)
    })
    setChecking(false)
  }

  const submitFolder = (event?: FormEvent) => {
    event?.preventDefault()
    if (!folderDialog) return
    const name = folderDialog.value.trim()
    const dialog = folderDialog
    setFolderDialog(null)
    if (!name) return
    void run(async () => {
      if (dialog.mode === 'add') setFolder(await webBrowser.addFolder(name))
      else {
        await webBrowser.renameFolder(folder, name)
        setFolder(name)
      }
    })
  }

  return (
    <aside className="web-panel" aria-label="Saved references and recent pages">
      <header className="web-panel__header">
        <div className="tabs" role="tablist" aria-label="Show">
          <button type="button" role="tab" aria-selected={view === 'saved'} className={view === 'saved' ? 'is-active' : ''} onClick={() => onViewChange('saved')}>
            Saved
          </button>
          <button type="button" role="tab" aria-selected={view === 'recent'} className={view === 'recent' ? 'is-active' : ''} onClick={() => onViewChange('recent')}>
            Recent
          </button>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close saved and recent pages">
          <X aria-hidden="true" />
        </button>
      </header>

      <label className="web-panel__search">
        <Search aria-hidden="true" />
        <input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={view === 'saved' ? 'Find a saved reference' : 'Find a recent page'} aria-label="Filter" />
      </label>

      {view === 'saved' ? (
        <>
          <div className="web-panel__tools">
            <select value={folder} onChange={(event) => setFolder(event.target.value)} aria-label="Folder">
              <option value={ALL}>All folders</option>
              <option value={UNFILED}>Not in a folder</option>
              {library?.folders.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <button type="button" className="icon-button" onClick={() => setFolderDialog({ mode: 'add', value: '' })} aria-label="New folder" title="New folder">
              <FolderPlus aria-hidden="true" />
            </button>
            {folder !== ALL && folder !== UNFILED ? (
              <>
                <button type="button" className="icon-button" onClick={() => setFolderDialog({ mode: 'rename', value: folder })} aria-label="Rename folder" title="Rename folder">
                  <Pencil aria-hidden="true" />
                </button>
                <button type="button" className="icon-button" onClick={() => setConfirm('folder')} aria-label="Remove folder" title="Remove folder">
                  <Trash2 aria-hidden="true" />
                </button>
              </>
            ) : null}
          </div>
          <div className="web-panel__tools web-panel__tools--wrap">
            <button type="button" className="secondary-button button--small" onClick={() => void checkLinks()} disabled={checking || bookmarks.length === 0}>
              <RefreshCw aria-hidden="true" className={checking ? 'spinning' : undefined} />
              <span>{checking ? 'Checking links...' : 'Check for broken links'}</span>
            </button>
            {duplicates > 0 ? <span className="chip chip--warning">{duplicates} duplicates</span> : null}
          </div>

          {bookmarks.length === 0 ? (
            <p className="web-panel__empty">
              {library?.bookmarks.length ? 'No saved references match.' : 'No saved references yet. Use the bookmark button in the toolbar to save the page you are reading.'}
            </p>
          ) : (
            <ul className="web-panel__list">
              {bookmarks.map((item) =>
                item.id === editingId ? (
                  <BookmarkEditor
                    key={item.id}
                    bookmark={item}
                    folders={library?.folders ?? []}
                    onCancel={() => onEditingChange(null)}
                    onSave={(changes) => {
                      onEditingChange(null)
                      void run(() => webBrowser.updateBookmark(item.id, changes), 'Saved.')
                    }}
                  />
                ) : (
                  <li key={item.id} className="web-panel__item">
                    <button type="button" className="web-panel__open" onClick={() => onOpen(item.url, false)} title={item.url}>
                      <strong>{item.title}</strong>
                      <span>{displayUrl(item.url)}</span>
                    </button>
                    <div className="web-panel__meta">
                      {item.folder ? <span className="chip">{item.folder}</span> : null}
                      {item.duplicate ? <span className="chip chip--warning">Duplicate</span> : null}
                      {item.check ? (
                        <span
                          className={`chip${item.check.status === 'ok' || item.check.status === 'redirected' ? ' chip--success' : ' chip--danger'}`}
                          title={`${item.check.detail ?? LINK_CHECK_LABELS[item.check.status]} Checked ${timeFormat.format(item.check.checkedAt)}.`}
                        >
                          {LINK_CHECK_LABELS[item.check.status]}
                        </span>
                      ) : null}
                      {item.source ? (
                        <span className="web-panel__source" title="Saved while reading this document">
                          <BookOpen aria-hidden="true" />
                          {item.source.name}
                        </span>
                      ) : null}
                    </div>
                    {item.note ? <p className="web-panel__note">{item.note}</p> : null}
                    <div className="web-panel__actions">
                      <button type="button" className="icon-button" onClick={() => onOpen(item.url, true)} aria-label={`Open ${item.title} in a new tab`} title="Open in new tab">
                        <Plus aria-hidden="true" />
                      </button>
                      <button type="button" className="icon-button" onClick={() => onEditingChange(item.id)} aria-label={`Edit ${item.title}`} title="Edit, add a note or move to a folder">
                        <Pencil aria-hidden="true" />
                      </button>
                      <button type="button" className="icon-button" onClick={() => void run(() => webBrowser.copy(item.url), 'Link copied.')} aria-label={`Copy link to ${item.title}`} title="Copy link">
                        <Copy aria-hidden="true" />
                      </button>
                      <button type="button" className="icon-button" onClick={() => void webBrowser.openExternal(item.url)} aria-label={`Open ${item.title} in your default browser`} title="Open in default browser">
                        <ExternalLink aria-hidden="true" />
                      </button>
                      <button type="button" className="icon-button" onClick={() => void run(() => webBrowser.removeBookmark(item.id), 'Removed from saved references.')} aria-label={`Remove ${item.title}`} title="Remove">
                        <Trash2 aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
        </>
      ) : (
        <>
          <div className="web-panel__tools web-panel__tools--wrap">
            <button type="button" className="secondary-button button--small" onClick={() => setConfirm('history')} disabled={!library?.history.length}>
              <Trash2 aria-hidden="true" />
              <span>Clear recent pages</span>
            </button>
            <button type="button" className="ghost-button button--small" onClick={() => setConfirm('data')}>
              <span>Clear website data</span>
            </button>
          </div>
          {history.length === 0 ? (
            <p className="web-panel__empty">{library?.history.length ? 'No recent pages match.' : 'Pages you visit appear here.'}</p>
          ) : (
            <ul className="web-panel__list">
              {history.map((item) => (
                <li key={item.id} className="web-panel__item web-panel__item--row">
                  <button type="button" className="web-panel__open" onClick={() => onOpen(item.url, false)} title={item.url}>
                    <strong>{item.title}</strong>
                    <span>
                      {displayUrl(item.url)} · {timeFormat.format(item.visitedAt)}
                    </span>
                  </button>
                  <button type="button" className="icon-button" onClick={() => void run(() => webBrowser.removeVisit(item.id))} aria-label={`Remove ${item.title} from recent pages`} title="Remove">
                    <X aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <Dialog
        open={folderDialog !== null}
        title={folderDialog?.mode === 'rename' ? 'Rename folder' : 'New folder'}
        icon={<FolderPlus aria-hidden="true" />}
        onClose={() => setFolderDialog(null)}
        onSubmit={submitFolder}
        footer={
          <>
            <button type="button" className="secondary-button" onClick={() => setFolderDialog(null)}>
              Cancel
            </button>
            <button type="submit" className="primary-button">
              {folderDialog?.mode === 'rename' ? 'Rename' : 'Create folder'}
            </button>
          </>
        }
      >
        <label className="field">
          <span>Folder name</span>
          <input value={folderDialog?.value ?? ''} maxLength={80} onChange={(event) => setFolderDialog((current) => current && { ...current, value: event.target.value })} autoFocus />
        </label>
      </Dialog>

      <Dialog
        open={confirm !== null}
        title={confirm === 'history' ? 'Clear recent pages?' : confirm === 'data' ? 'Clear website data?' : 'Remove this folder?'}
        tone="danger"
        onClose={() => setConfirm(null)}
        footer={
          <>
            <button type="button" className="secondary-button" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="danger-button"
              onClick={() => {
                const what = confirm
                setConfirm(null)
                if (what === 'history') void run(() => webBrowser.clearHistory(), 'Recent pages cleared.')
                else if (what === 'data') void run(() => webBrowser.clearBrowsingData(), 'Website data cleared. You are signed out of websites.')
                else if (what === 'folder') {
                  const name = folder
                  setFolder(ALL)
                  void run(() => webBrowser.removeFolder(name), 'Folder removed. Its references were kept.')
                }
              }}
            >
              {confirm === 'folder' ? 'Remove folder' : 'Clear'}
            </button>
          </>
        }
      >
        <p>
          {confirm === 'history'
            ? 'The list of recently visited pages is deleted. Saved references are kept.'
            : confirm === 'data'
              ? 'Cookies, sign-ins and stored data of all websites opened in Document Vault are deleted. Saved references and recent pages are kept.'
              : `The folder “${folder}” is removed. The references in it are kept, outside any folder.`}
        </p>
      </Dialog>
    </aside>
  )
}

interface EditorProps {
  bookmark: WebBookmark
  folders: string[]
  onCancel: () => void
  onSave: (changes: { title: string; url: string; note: string; folder: string }) => void
}

function BookmarkEditor({ bookmark, folders, onCancel, onSave }: EditorProps) {
  const [title, setTitle] = useState(bookmark.title)
  const [url, setUrl] = useState(bookmark.url)
  const [note, setNote] = useState(bookmark.note)
  const [folder, setFolder] = useState(bookmark.folder)
  const listId = `web-folders-${bookmark.id}`
  return (
    <li className="web-panel__item web-panel__editor">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onSave({ title, url, note, folder })
        }}
      >
        <label className="field">
          <span>Title</span>
          <input value={title} maxLength={300} onChange={(event) => setTitle(event.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>
            <Link2 aria-hidden="true" /> Address
          </span>
          <input value={url} type="url" onChange={(event) => setUrl(event.target.value)} />
        </label>
        <label className="field">
          <span>Folder</span>
          <input value={folder} maxLength={80} list={listId} placeholder="Not in a folder" onChange={(event) => setFolder(event.target.value)} />
          <datalist id={listId}>
            {folders.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>Note</span>
          <textarea value={note} maxLength={4000} rows={3} onChange={(event) => setNote(event.target.value)} placeholder="Why this reference matters, pinpoint sections, how far it was checked" />
        </label>
        <div className="web-panel__editor-actions">
          <button type="button" className="secondary-button button--small" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary-button button--small">
            Save
          </button>
        </div>
      </form>
    </li>
  )
}
