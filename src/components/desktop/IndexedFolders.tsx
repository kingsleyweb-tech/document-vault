import { useState } from 'react'
import { AlertTriangle, FolderPlus, HardDrive, Pause, Play, RefreshCw, Trash2, Unplug } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { companion, CompanionError, type CompanionStatus, type LocalRoot } from '../../services/desktopCompanion'

interface IndexedFoldersProps {
  status: CompanionStatus
  version: string | null
  onChanged: () => void
  onDisconnected: () => void
  onSearchRoot: (root: LocalRoot) => void
}

const numberFormat = new Intl.NumberFormat()
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function rootStatus(root: LocalRoot, indexingId: number | null) {
  if (root.id === indexingId) return { label: 'Indexing', tone: 'accent' }
  switch (root.status) {
    case 'ready':
      return { label: root.watching ? 'Up to date' : 'Indexed', tone: 'success' }
    case 'unavailable':
      return { label: 'Not available', tone: 'danger' }
    case 'indexing':
    case 'pending':
    default:
      return { label: 'Waiting', tone: '' }
  }
}

// The folders and drives the companion indexes, with indexing controls.
export function IndexedFolders({ status, version, onChanged, onDisconnected, onSearchRoot }: IndexedFoldersProps) {
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)
  const [typedPath, setTypedPath] = useState('')
  const [confirmPath, setConfirmPath] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<LocalRoot | null>(null)
  const [busy, setBusy] = useState(false)
  const [showErrors, setShowErrors] = useState(false)

  const run = async (task: () => Promise<string | void>) => {
    setBusy(true)
    setMessage(null)
    try {
      const text = await task()
      if (text) setMessage({ tone: 'info', text })
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof CompanionError ? error.message : 'The companion could not do that.' })
    } finally {
      setBusy(false)
      onChanged()
    }
  }

  const pick = () =>
    run(async () => {
      const result = await companion.pickRoot()
      if (result.cancelled) return
      return result.alreadyIndexed ? `${result.root?.path} is already indexed.` : `Added ${result.root?.path}. Its contents are being indexed.`
    })

  const addTyped = () => {
    const target = confirmPath
    setConfirmPath(null)
    if (!target) return
    void run(async () => {
      const result = await companion.addRoot(target)
      setTypedPath('')
      return result.alreadyIndexed ? `${result.root.path} is already indexed.` : `Added ${result.root.path}. Its contents are being indexed.`
    })
  }

  const index = status.index
  const indexingId = index.current?.rootId ?? null
  const paused = index.state === 'paused'

  return (
    <section className="local-roots" aria-labelledby="local-roots-title">
      <header className="local-roots__header">
        <div>
          <h2 id="local-roots-title">Indexed folders</h2>
          <p>
            {numberFormat.format(index.totals.files)} files and {numberFormat.format(index.totals.folders)} folders indexed
          </p>
        </div>
        <div className="local-roots__actions">
          <button type="button" className="primary-button button--small" onClick={() => void pick()} disabled={busy}>
            <FolderPlus aria-hidden="true" />
            <span>Add folder</span>
          </button>
          <button
            type="button"
            className="secondary-button button--small"
            onClick={() => void run(async () => (await companion.rescan(), 'Checking every indexed folder for changes.'))}
            disabled={busy || status.roots.length === 0}
          >
            <RefreshCw aria-hidden="true" />
            <span>Rescan all</span>
          </button>
          <button
            type="button"
            className="secondary-button button--small"
            onClick={() => void run(async () => void (paused ? await companion.resume() : await companion.pause()))}
            disabled={busy}
            aria-pressed={paused}
          >
            {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
            <span>{paused ? 'Resume indexing' : 'Pause indexing'}</span>
          </button>
        </div>
      </header>

      <div className="index-progress" role="status" aria-live="polite">
        {index.state === 'indexing' && index.current ? (
          <>
            <span className="app-spinner app-spinner--small" aria-hidden="true" />
            <span>
              Indexing <strong>{index.current.root}</strong>: {numberFormat.format(index.current.scanned)} items so far
              <span className="index-progress__folder">{index.current.folder}</span>
            </span>
          </>
        ) : paused ? (
          <>
            <Pause aria-hidden="true" />
            <span>Indexing is paused. Search still works with what is already indexed.</span>
          </>
        ) : index.state === 'updating' ? (
          <span>Applying recent changes...</span>
        ) : (
          <span>Changes in these folders are picked up automatically while the companion runs.</span>
        )}
      </div>

      {status.roots.length === 0 ? (
        <p className="local-roots__empty">
          No folders yet. Add the folders you want to search, such as Documents or Desktop. Only names, sizes and dates are
          indexed; file contents are not read.
        </p>
      ) : (
        <ul className="local-roots__list">
          {status.roots.map((root) => {
            const state = rootStatus(root, indexingId)
            return (
              <li key={root.id} className="local-root">
                <HardDrive aria-hidden="true" className="local-root__icon" />
                <div className="local-root__text">
                  <button type="button" className="local-root__path" onClick={() => onSearchRoot(root)} title="Search only this folder">
                    {root.path}
                  </button>
                  <span className="local-root__meta">
                    <span className={`chip${state.tone ? ` chip--${state.tone}` : ''}`}>{state.label}</span>
                    <span>
                      {numberFormat.format(root.files)} files, {numberFormat.format(root.folders)} folders
                    </span>
                    {root.lastScanAt ? <span>Checked {dateFormat.format(root.lastScanAt)}</span> : null}
                  </span>
                  {root.status === 'unavailable' && root.error ? <span className="local-root__error">{root.error}</span> : null}
                </div>
                <div className="local-root__actions">
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => void run(async () => void (await companion.rescan(root.id)))}
                    aria-label={`Rescan ${root.path}`}
                    title="Rescan"
                    disabled={busy}
                  >
                    <RefreshCw aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setRemoveTarget(root)}
                    aria-label={`Stop indexing ${root.path}`}
                    title="Stop indexing"
                    disabled={busy}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <form
        className="local-roots__add"
        onSubmit={(event) => {
          event.preventDefault()
          if (typedPath.trim()) setConfirmPath(typedPath.trim())
        }}
      >
        <label className="sr-only" htmlFor="local-root-path">
          Folder path
        </label>
        <input
          id="local-root-path"
          className="field-input"
          value={typedPath}
          onChange={(event) => setTypedPath(event.target.value)}
          placeholder="Or type a folder path, e.g. C:\Users\you\Documents"
          spellCheck={false}
        />
        <button type="submit" className="secondary-button button--small" disabled={!typedPath.trim() || busy}>
          Add path
        </button>
      </form>

      {message ? (
        <p className={`notice${message.tone === 'error' ? ' notice--error' : ''}`} role={message.tone === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      ) : null}

      {index.errors.length > 0 ? (
        <div className="local-roots__errors">
          <button type="button" className="text-button" onClick={() => setShowErrors((open) => !open)} aria-expanded={showErrors}>
            <AlertTriangle aria-hidden="true" />
            {index.errors.length} {index.errors.length === 1 ? 'location' : 'locations'} could not be read
          </button>
          {showErrors ? (
            <ul>
              {index.errors.map((error, position) => (
                <li key={`${error.path}-${position}`}>
                  <span className="local-roots__error-path">{error.path ?? 'Indexer'}</span>
                  <span>{error.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <footer className="local-roots__footer">
        <span>Companion {version ?? ''} on this computer</span>
        <button type="button" className="text-button" onClick={() => void companion.unpair().finally(onDisconnected)}>
          <Unplug aria-hidden="true" />
          Disconnect this browser
        </button>
      </footer>

      <Dialog
        open={confirmPath !== null}
        title="Index this folder?"
        icon={<FolderPlus aria-hidden="true" />}
        onClose={() => setConfirmPath(null)}
        onSubmit={addTyped}
        footer={
          <>
            <button type="button" className="secondary-button" onClick={() => setConfirmPath(null)}>
              Cancel
            </button>
            <button type="submit" className="primary-button">
              Index folder
            </button>
          </>
        }
      >
        <p>
          <strong className="break-anywhere">{confirmPath}</strong>
        </p>
        <p>
          The companion will record the names, sizes, dates and locations of the files and folders inside, so you can search
          for them here. File contents are not read or uploaded. You can stop indexing it at any time.
        </p>
      </Dialog>

      <Dialog
        open={removeTarget !== null}
        title="Stop indexing this folder?"
        icon={<Trash2 aria-hidden="true" />}
        onClose={() => setRemoveTarget(null)}
        footer={
          <>
            <button type="button" className="secondary-button" onClick={() => setRemoveTarget(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                const target = removeTarget
                setRemoveTarget(null)
                if (target) void run(async () => (await companion.removeRoot(target.id), `Stopped indexing ${target.path}.`))
              }}
            >
              Stop indexing
            </button>
          </>
        }
      >
        <p>
          <strong className="break-anywhere">{removeTarget?.path}</strong> will be removed from the search index. The folder
          and its files stay on your computer untouched.
        </p>
      </Dialog>
    </section>
  )
}
