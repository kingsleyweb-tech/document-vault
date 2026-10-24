import { useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { companion, type CompanionStatus, type LocalRoot } from '../../services/desktopCompanion'
import { elapsedText, errorText, numberFormat } from './libraryText'

interface IndexingActivityProps {
  root: LocalRoot
  status: CompanionStatus
  onChanged: () => void
}

// What is happening to this library right now: counts of what has been found
// and what is still to do. There is no percentage, because how many files a
// folder holds is not known until it has been walked.
export function IndexingActivity({ root, status, onChanged }: IndexingActivityProps) {
  const [error, setError] = useState<string | null>(null)
  const index = status.index
  const current = index.current?.rootId === root.id ? index.current : null
  const paused = index.state === 'paused'
  const toRead = root.settings.extractText ? (root.extraction.pending ?? 0) + (root.extraction.processing ?? 0) : 0
  if (!current && !(paused && root.status === 'indexing') && toRead === 0) return null

  const toggle = () => {
    setError(null)
    ;(paused ? companion.resume() : companion.pause()).then(onChanged, (reason: unknown) => setError(errorText(reason)))
  }
  const title = paused ? 'Indexing is paused' : current ? (current.full === false ? 'Picking up changes' : 'Finding files') : 'Reading the text of documents'

  return (
    <section className="index-activity" aria-label="Indexing activity" role="status" aria-live="polite">
      <div className="index-activity__head">
        <p className="index-activity__title">
          {paused ? <Pause aria-hidden="true" /> : <span className="app-spinner app-spinner--small" aria-hidden="true" />}
          {title}
        </p>
        <button type="button" className="secondary-button" onClick={toggle}>
          {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
          <span>{paused ? 'Resume' : 'Pause'}</span>
        </button>
      </div>
      <dl className="index-activity__counts">
        {current ? (
          <>
            <div>
              <dt>Folders found</dt>
              <dd>{numberFormat.format(current.folders ?? 0)}</dd>
            </div>
            <div>
              <dt>Files found</dt>
              <dd>{numberFormat.format(current.files ?? current.scanned)}</dd>
            </div>
            {current.waiting !== undefined ? (
              <div>
                <dt>Folders still to open</dt>
                <dd>{numberFormat.format(current.waiting)}</dd>
              </div>
            ) : null}
            <div>
              <dt>Could not be read</dt>
              <dd>{numberFormat.format(current.errors ?? 0)}</dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>{current.elapsedMs !== undefined ? elapsedText(current.elapsedMs) : "—"}</dd>
            </div>
          </>
        ) : null}
        {root.settings.extractText ? (
          <div>
            <dt>Text still to read</dt>
            <dd>{numberFormat.format(toRead)}</dd>
          </div>
        ) : null}
      </dl>
      {current ? <p className="index-activity__folder break-anywhere">{current.folder}</p> : null}
      <p className="index-activity__note">
        {current
          ? 'Files can be browsed and searched by name as soon as they are found. Their text is read after all files have been found, and only then can it be searched.'
          : 'Search by name covers every file. Text search covers only documents whose text has been read.'}
      </p>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
