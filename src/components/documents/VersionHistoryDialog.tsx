import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, History, RotateCcw, Trash2, Upload } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import type { DriveRevision } from '../../services/googleDrive'
import type { VaultDocument } from '../../types/document'
import { formatFileSize } from '../../utils/formatters'
import { validateUploadFile } from '../../utils/validators'

export interface VersionActions {
  listVersions: (documentRecord: VaultDocument) => Promise<DriveRevision[]>
  downloadVersion: (documentRecord: VaultDocument, revision: DriveRevision) => Promise<Blob>
  restoreVersion: (documentRecord: VaultDocument, revision: DriveRevision) => Promise<void>
  deleteVersion: (documentRecord: VaultDocument, revision: DriveRevision) => Promise<void>
  uploadNewVersion: (
    documentRecord: VaultDocument,
    file: File,
    options?: { onProgress?: (loaded: number, total: number) => void },
  ) => Promise<void>
}

interface VersionHistoryDialogProps {
  documentRecord: VaultDocument | null
  actions: VersionActions
  onClose: () => void
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void
  /** Runs a Drive task with the app's usual error handling (reconnect prompts and messages). */
  runTask: (task: () => Promise<void>) => Promise<void>
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

type Busy = { kind: 'load' } | { kind: 'upload'; percent: number } | { kind: 'row'; id: string } | null

// Lists the versions Google Drive keeps for a file. Uploading a new version or
// restoring an old one adds a version; nothing is overwritten.
export function VersionHistoryDialog({ documentRecord, actions, onClose, onNotify, runTask }: VersionHistoryDialogProps) {
  const [revisions, setRevisions] = useState<DriveRevision[] | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const recordId = documentRecord?.id

  const load = useCallback(async (record: VaultDocument) => {
    setBusy({ kind: 'load' })
    setLoadError(null)
    try {
      setRevisions(await actions.listVersions(record))
    } catch (error) {
      console.error(error)
      setLoadError('Could not load versions from Google Drive. Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }, [actions])

  // A different document starts from an empty list.
  const [shownId, setShownId] = useState(recordId)
  if (shownId !== recordId) {
    setShownId(recordId)
    setRevisions(null)
    setConfirmDelete(null)
    setLoadError(null)
  }

  useEffect(() => {
    if (!documentRecord) return
    let current = true
    actions.listVersions(documentRecord).then(
      (list) => {
        if (current) setRevisions(list)
      },
      (error: unknown) => {
        console.error(error)
        if (current) setLoadError('Could not load versions from Google Drive. Check your connection and try again.')
      },
    )
    return () => {
      current = false
    }
    // Reload when a different document is shown, not on every record update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId])

  if (!documentRecord) return null
  const record = documentRecord
  const newestFirst = revisions ? [...revisions].reverse() : []
  const working = busy !== null && busy.kind !== 'load'

  const uploadVersion = (file: File) =>
    runTask(async () => {
      setBusy({ kind: 'upload', percent: 0 })
      try {
        await actions.uploadNewVersion(record, file, {
          onProgress: (loaded, total) => setBusy({ kind: 'upload', percent: total > 0 ? Math.round((loaded / total) * 100) : 0 }),
        })
        onNotify(`Uploaded a new version of "${record.name}".`, 'success')
      } finally {
        setBusy(null)
      }
      await load(record)
    })

  const rowTask = (revision: DriveRevision, task: () => Promise<void>) =>
    runTask(async () => {
      setBusy({ kind: 'row', id: revision.id })
      try {
        await task()
      } finally {
        setBusy(null)
      }
    })

  const download = (revision: DriveRevision) =>
    rowTask(revision, async () => {
      const blob = await actions.downloadVersion(record, revision)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = revision.originalFilename || record.originalName || record.name
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    })

  const restore = (revision: DriveRevision) =>
    rowTask(revision, async () => {
      await actions.restoreVersion(record, revision)
      onNotify(`Restored the version from ${dateFormat.format(new Date(revision.modifiedTime))}.`, 'success')
      await load(record)
    })

  const remove = (revision: DriveRevision) =>
    rowTask(revision, async () => {
      await actions.deleteVersion(record, revision)
      setConfirmDelete(null)
      onNotify('Deleted that version.', 'success')
      await load(record)
    })

  return (
    <Dialog
      open
      wide
      title="Version history"
      description={record.originalName || record.name}
      icon={<History aria-hidden="true" />}
      onClose={() => {
        if (!working) onClose()
      }}
      footer={
        <>
          <input
            ref={fileInputRef}
            type="file"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              const problem = validateUploadFile(file)
              if (problem) onNotify(problem, 'error')
              else void uploadVersion(file)
            }}
          />
          <button type="button" className="secondary-button" onClick={onClose} disabled={working}>
            Close
          </button>
          <button type="button" className="primary-button" onClick={() => fileInputRef.current?.click()} disabled={working}>
            <Upload aria-hidden="true" />
            <span>Upload new version</span>
          </button>
        </>
      }
    >
      <p className="field-hint">
        Uploading a new version keeps this file's name, location, tags and details. Earlier versions stay here and can be
        downloaded or restored.
      </p>

      {busy?.kind === 'upload' ? (
        <div className="version-upload" role="status">
          <span>Uploading new version… {busy.percent}%</span>
          <div className="progress-track">
            <span style={{ width: `${busy.percent}%` }} />
          </div>
        </div>
      ) : null}

      {loadError ? <p className="dialog-warning">{loadError}</p> : null}
      {!revisions && !loadError ? (
        <p className="version-loading">
          <span className="app-spinner" aria-hidden="true" /> Loading versions…
        </p>
      ) : null}

      {revisions ? (
        <ol className="version-list">
          {newestFirst.map((revision, index) => {
            const current = index === 0
            const rowBusy = busy?.kind === 'row' && busy.id === revision.id
            return (
              <li key={revision.id} className={`version-row${current ? ' is-current' : ''}`}>
                <div className="version-row__text">
                  <strong>
                    {dateFormat.format(new Date(revision.modifiedTime))}
                    {current ? <span className="chip chip--accent">Current</span> : null}
                  </strong>
                  <span>
                    {[
                      revision.originalFilename,
                      revision.size ? formatFileSize(Number(revision.size)) : null,
                      current ? null : revision.keepForever ? 'Kept until deleted' : 'Google Drive removes this after 30 days',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
                <div className="version-row__actions">
                  {confirmDelete === revision.id ? (
                    <>
                      <span className="version-row__confirm">Delete this version?</span>
                      <button type="button" className="secondary-button button--small" onClick={() => setConfirmDelete(null)} disabled={working}>
                        Cancel
                      </button>
                      <button type="button" className="danger-button button--small" onClick={() => void remove(revision)} disabled={working}>
                        Delete
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="ghost-button button--small" onClick={() => void download(revision)} disabled={working} title="Download this version">
                        {rowBusy ? <span className="app-spinner" aria-hidden="true" /> : <Download aria-hidden="true" />}
                        <span>Download</span>
                      </button>
                      {!current ? (
                        <>
                          <button type="button" className="ghost-button button--small" onClick={() => void restore(revision)} disabled={working} title="Make this the current version">
                            <RotateCcw aria-hidden="true" />
                            <span>Restore</span>
                          </button>
                          <button
                            type="button"
                            className="ghost-button button--small is-danger"
                            onClick={() => setConfirmDelete(revision.id)}
                            disabled={working}
                            aria-label="Delete this version"
                            title="Delete this version"
                          >
                            <Trash2 aria-hidden="true" />
                          </button>
                        </>
                      ) : null}
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      ) : null}
    </Dialog>
  )
}
