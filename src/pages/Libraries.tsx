import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { BookOpen, FolderPlus, Library, Pause, Play, RefreshCw, Search, ShieldCheck, Unplug } from 'lucide-react'
import { CompanionSetup } from '../components/desktop/CompanionSetup'
import { AddLibraryDialog } from '../components/library/AddLibraryDialog'
import { OcrOffer } from '../components/library/OcrOffer'
import { dateFormat, errorText, libraryState, numberFormat, ocrProgress, textProgress } from '../components/library/libraryText'
import { EmptyState } from '../components/ui/EmptyState'
import { PageHeader } from '../components/ui/PageHeader'
import { useCompanion } from '../hooks/useCompanion'
import { companion, desktopBridge, type CompanionStatus, type LocalRoot } from '../services/desktopCompanion'

// My Libraries: the folders on this computer that Document Vault may search.
export function Libraries() {
  const { connection, status, version, refresh } = useCompanion()
  const [adding, setAdding] = useState(false)
  const location = useLocation()
  // A message passed on by the page that sent us here (for example after removing a library).
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(() => {
    const text = (location.state as { message?: string } | null)?.message
    return text ? { tone: 'info', text } : null
  })
  const navigate = useNavigate()

  const run = async (task: () => Promise<string | void>) => {
    setMessage(null)
    try {
      const text = await task()
      if (text) setMessage({ tone: 'info', text })
    } catch (error) {
      setMessage({ tone: 'error', text: errorText(error) })
    } finally {
      void refresh()
    }
  }

  const ready = connection === 'ready' && status
  const roots = status?.roots ?? []

  return (
    <section className="page desktop-page libraries-page">
      <PageHeader
        title="My Libraries"
        description="Folders on this computer that Document Vault may search, including the text inside your books. Nothing is uploaded."
        actions={
          ready ? (
            <>
              <Link to="/search" className="secondary-button">
                <Search aria-hidden="true" />
                <span>Search libraries</span>
              </Link>
              <button type="button" className="primary-button" onClick={() => setAdding(true)}>
                <FolderPlus aria-hidden="true" />
                <span>Add library</span>
              </button>
            </>
          ) : null
        }
      />

      {!ready ? (
        <>
          {!desktopBridge() ? (
            <p className="notice">
              Libraries are folders on a computer, so they need the Document Vault desktop app (or the companion) running on that
              computer. A web browser cannot read your folders by itself.
            </p>
          ) : null}
          {connection !== 'ready' ? <CompanionSetup connection={connection} onConnected={() => void refresh()} onRetry={() => void refresh()} /> : null}
        </>
      ) : (
        <>
          {status.recovered ? (
            <p className="notice notice--warning" role="status">
              The library index was damaged and has been rebuilt. Your libraries are being indexed again; your files were not
              affected.
            </p>
          ) : null}

          <IndexActivity status={status} />

          {message ? (
            <p className={`notice${message.tone === 'error' ? ' notice--error' : ''}`} role={message.tone === 'error' ? 'alert' : 'status'}>
              {message.text}
            </p>
          ) : null}

          {roots.length === 0 ? (
            <EmptyState
              icon={<Library aria-hidden="true" />}
              title="No libraries yet"
              message="Add the folder that holds your books or documents. You choose it in your computer's own folder window, and only that folder is read."
              action={
                <button type="button" className="primary-button" onClick={() => setAdding(true)}>
                  <FolderPlus aria-hidden="true" />
                  <span>Add library</span>
                </button>
              }
            />
          ) : (
            <ul className="library-cards" aria-label="Libraries">
              {roots.map((root) => (
                <LibraryCard
                  key={root.id}
                  root={root}
                  status={status}
                  onPause={() => void run(async () => void (await companion.pauseLibrary(root.id)))}
                  onResume={() => void run(async () => void (await companion.resumeLibrary(root.id)))}
                  onRescan={() => void run(async () => (await companion.rescanLibrary(root.id), `Checking ${root.name} for changes.`))}
                  onOcrDecided={() => void refresh()}
                  onReauthorize={() =>
                    void run(async () => {
                      const result = await companion.reauthorizeLibrary(root.id)
                      return result.cancelled ? undefined : `Access to ${root.name} was granted again.`
                    })
                  }
                />
              ))}
            </ul>
          )}

          <footer className="libraries-footer">
            <Link to="/access" className="text-button">
              <ShieldCheck aria-hidden="true" />
              Library access and privacy
            </Link>
            <span>Companion {version ?? ''} on this computer</span>
            {!desktopBridge() ? (
              <button type="button" className="text-button" onClick={() => void companion.unpair().finally(() => void refresh())}>
                <Unplug aria-hidden="true" />
                Disconnect this browser
              </button>
            ) : null}
          </footer>
        </>
      )}

      <AddLibraryDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(root, note) => {
          setAdding(false)
          setMessage({ tone: 'info', text: note })
          void refresh()
          navigate(`/libraries/${root.id}`)
        }}
      />
    </section>
  )
}

function IndexActivity({ status }: { status: CompanionStatus }) {
  const index = status.index
  const text = status.text
  const reading = text?.current[0]
  const recognising = status.ocr?.current
  return (
    <div className="index-progress" role="status" aria-live="polite">
      {index.state === 'indexing' && index.current ? (
        <>
          <span className="app-spinner app-spinner--small" aria-hidden="true" />
          <span>
            Indexing <strong>{status.roots.find((root) => root.id === index.current?.rootId)?.name ?? index.current.root}</strong>:{' '}
            {numberFormat.format(index.current.scanned)} items so far
          </span>
        </>
      ) : index.state === 'paused' ? (
        <>
          <Pause aria-hidden="true" />
          <span>Indexing is paused. Search still works with what is already indexed.</span>
        </>
      ) : reading ? (
        <>
          <span className="app-spinner app-spinner--small" aria-hidden="true" />
          <span>
            Reading the text of <strong>{reading.name}</strong>
            {text?.counts.pending ? ` (${numberFormat.format(text.counts.pending)} documents waiting)` : ''}
          </span>
        </>
      ) : recognising ? (
        <>
          <span className="app-spinner app-spinner--small" aria-hidden="true" />
          <span>
            Recognising the scanned pages of <strong>{recognising.name}</strong>
            {recognising.total ? `: page ${numberFormat.format(Math.min(recognising.done + 1, recognising.total))} of ${numberFormat.format(recognising.total)}` : ''}
          </span>
        </>
      ) : (
        <span>Changes in your libraries are picked up automatically while Document Vault is open.</span>
      )}
    </div>
  )
}

interface LibraryCardProps {
  root: LocalRoot
  status: CompanionStatus
  onPause: () => void
  onResume: () => void
  onRescan: () => void
  onReauthorize: () => void
  onOcrDecided: () => void
}

function LibraryCard({ root, status, onPause, onResume, onRescan, onReauthorize, onOcrDecided }: LibraryCardProps) {
  const state = libraryState(root, status.index)
  const progress = textProgress(root)
  const recognising = ocrProgress(root)
  const revoked = root.state === 'revoked'
  return (
    <li className={`library-card${revoked ? ' is-revoked' : ''}`}>
      <div className="library-card__head">
        <BookOpen aria-hidden="true" className="library-card__icon" />
        <div className="library-card__title">
          <Link to={`/libraries/${root.id}`} className="library-card__name">
            {root.name}
          </Link>
          <span className="library-card__path" title={root.path}>
            {root.path}
          </span>
        </div>
        <span className={`chip${state.tone ? ` chip--${state.tone}` : ''}`}>{state.label}</span>
      </div>

      {state.detail && state.tone === 'danger' ? <p className="library-card__problem">{state.detail}</p> : null}

      <dl className="library-card__stats">
        <div>
          <dt>Documents</dt>
          <dd>{numberFormat.format(root.files)}</dd>
        </div>
        <div>
          <dt>Folders</dt>
          <dd>{numberFormat.format(root.folders)}</dd>
        </div>
        <div>
          <dt>Text searchable</dt>
          <dd>{root.settings.extractText ? numberFormat.format(progress.readable) : 'Off'}</dd>
        </div>
        <div>
          <dt>Last checked</dt>
          <dd>{root.lastScanAt ? dateFormat.format(root.lastScanAt) : 'Not yet'}</dd>
        </div>
      </dl>

      {root.settings.extractText && progress.total > 0 && progress.done < progress.total && !revoked ? (
        <div className="library-card__meter">
          <progress max={progress.total} value={progress.done} aria-label={`Text read for ${root.name}`} />
          <span>
            Text read for {numberFormat.format(progress.done)} of {numberFormat.format(progress.total)} documents
          </span>
        </div>
      ) : null}

      {recognising && !revoked ? (
        <div className="library-card__meter">
          <progress max={recognising.total} value={recognising.done} aria-label={`Scanned pages recognised for ${root.name}`} />
          <span>
            Recognising scanned pages: {numberFormat.format(recognising.done)} of {numberFormat.format(recognising.total)}
          </span>
        </div>
      ) : null}

      <OcrOffer root={root} onDecided={onOcrDecided} />

      <div className="library-card__actions">
        <Link to={`/libraries/${root.id}`} className="secondary-button button--small">
          Open library
        </Link>
        {revoked || root.needsPermission ? (
          <button type="button" className="secondary-button button--small" onClick={onReauthorize}>
            Grant access again
          </button>
        ) : root.state === 'paused' ? (
          <button type="button" className="secondary-button button--small" onClick={onResume}>
            <Play aria-hidden="true" />
            <span>Resume</span>
          </button>
        ) : (
          <>
            <button type="button" className="icon-button" onClick={onRescan} aria-label={`Check ${root.name} for changes`} title="Check for changes">
              <RefreshCw aria-hidden="true" />
            </button>
            <button type="button" className="icon-button" onClick={onPause} aria-label={`Pause ${root.name}`} title="Pause">
              <Pause aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </li>
  )
}
