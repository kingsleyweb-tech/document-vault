import { useState, type ReactNode } from 'react'
import { Ban, Eraser, KeyRound, Pause, Play, RefreshCw, Trash2, X } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { companion, type LocalKind, type LocalRoot } from '../../services/desktopCompanion'
import { dateFormat, errorText, libraryFileTypes } from './libraryText'

interface LibrarySettingsProps {
  root: LocalRoot
  onChanged: (message?: string) => void
  onRemoved: (message: string) => void
}

type Confirm = 'revoke' | 'purge' | 'remove' | null

const depthOptions = [
  { value: '', label: 'All levels' },
  { value: '1', label: '1 level of subfolders' },
  { value: '2', label: '2 levels' },
  { value: '3', label: '3 levels' },
  { value: '5', label: '5 levels' },
  { value: '10', label: '10 levels' },
]

// What a library includes, and every way to limit or withdraw access to it.
export function LibrarySettings({ root, onChanged, onRemoved }: LibrarySettingsProps) {
  const [name, setName] = useState(root.name)
  const [recursive, setRecursive] = useState(root.settings.recursive)
  const [depth, setDepth] = useState(root.settings.maxDepth ? String(root.settings.maxDepth) : '')
  const [allTypes, setAllTypes] = useState(root.settings.fileTypes === null)
  const [types, setTypes] = useState<Set<LocalKind>>(() => new Set(root.settings.fileTypes ?? libraryFileTypes.filter((type) => type.text).map((type) => type.kind)))
  const [extractText, setExtractText] = useState(root.settings.extractText)
  // Absent with an older companion, which cannot recognise scans.
  const ocrSupported = root.settings.ocr !== undefined
  const [ocr, setOcr] = useState(root.settings.ocr ?? false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const revoked = root.state === 'revoked'

  const run = async (task: () => Promise<string | void>, after: (message?: string) => void = onChanged) => {
    setBusy(true)
    setError(null)
    try {
      after((await task()) ?? undefined)
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setBusy(false)
    }
  }

  const changes = {
    name: name.trim() || root.name,
    recursive,
    maxDepth: recursive && depth ? Number(depth) : null,
    fileTypes: allTypes ? null : [...types].sort(),
    extractText,
    // Sent only when changed, so saving other settings does not answer the one-time question.
    ...(ocrSupported && ocr !== root.settings.ocr ? { ocr } : {}),
  }
  const dirty =
    changes.name !== root.name ||
    changes.recursive !== root.settings.recursive ||
    changes.maxDepth !== root.settings.maxDepth ||
    JSON.stringify(changes.fileTypes) !== JSON.stringify(root.settings.fileTypes ? [...root.settings.fileTypes].sort() : null) ||
    changes.extractText !== root.settings.extractText ||
    changes.ocr !== undefined

  const save = () =>
    run(async () => {
      const result = await companion.updateLibrary(root.id, changes)
      return result.rescanning ? 'Saved. The library is being indexed again with the new settings.' : 'Saved.'
    })

  const toggleType = (kind: LocalKind) =>
    setTypes((previous) => {
      const next = new Set(previous)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })

  return (
    <div className="library-settings">
      <form
        className="settings-card"
        onSubmit={(event) => {
          event.preventDefault()
          if (dirty && (allTypes || types.size > 0)) void save()
        }}
      >
        <h2>What is indexed</h2>
        <p className="library-wizard__path">
          <span>Folder</span>
          <strong className="break-anywhere">{root.path}</strong>
        </p>
        <label className="field">
          <span>Library name</span>
          <input className="field-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} disabled={revoked} />
        </label>
        <fieldset className="library-wizard__group" disabled={revoked}>
          <legend>Subfolders</legend>
          <label className="check-row">
            <input type="checkbox" checked={recursive} onChange={(event) => setRecursive(event.target.checked)} />
            <span>Include subfolders</span>
          </label>
          {recursive ? (
            <label className="field library-wizard__depth">
              <span>How deep</span>
              <select value={depth} onChange={(event) => setDepth(event.target.value)}>
                {depthOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </fieldset>
        <fieldset className="library-wizard__group" disabled={revoked}>
          <legend>File types</legend>
          <label className="check-row">
            <input type="radio" name="settings-types" checked={allTypes} onChange={() => setAllTypes(true)} />
            <span>All files</span>
          </label>
          <label className="check-row">
            <input type="radio" name="settings-types" checked={!allTypes} onChange={() => setAllTypes(false)} />
            <span>Only the types I choose</span>
          </label>
          {!allTypes ? (
            <div className="library-wizard__types">
              {libraryFileTypes.map((type) => (
                <label key={type.kind} className="check-row">
                  <input type="checkbox" checked={types.has(type.kind)} onChange={() => toggleType(type.kind)} />
                  <span>{type.label}</span>
                </label>
              ))}
            </div>
          ) : null}
        </fieldset>
        <fieldset className="library-wizard__group" disabled={revoked}>
          <legend>Text inside documents</legend>
          <label className="check-row">
            <input type="checkbox" checked={extractText} onChange={(event) => setExtractText(event.target.checked)} />
            <span>Read the text of documents for full-text search</span>
          </label>
          <p className="field-hint">Turning this off stops reading new text. Text already read stays searchable until you clear the index.</p>
          {ocrSupported ? (
            <>
              <label className="check-row">
                <input type="checkbox" checked={ocr} onChange={(event) => setOcr(event.target.checked)} />
                <span>Recognise text in scanned PDFs and pictures (OCR)</span>
              </label>
              <p className="field-hint">
                Scanned pages are pictures, so their words can only be searched after they are recognised. This runs on this
                computer in the background, about 5 to 10 seconds per page (a 300-page book can take 30 to 50 minutes), in English. Recognised text may contain errors. Turning it
                off stops recognition; text already recognised stays searchable.
                {root.ocr && root.ocr.scannedDocs > 0
                  ? ` This library has ${root.ocr.scannedDocs} scanned ${root.ocr.scannedDocs === 1 ? 'document' : 'documents'} (${root.ocr.scannedPages} pages).`
                  : ''}
              </p>
            </>
          ) : null}
        </fieldset>
        <div className="settings-card__footer">
          <button type="submit" className="primary-button button--small" disabled={!dirty || busy || revoked || (!allTypes && types.size === 0)}>
            Save changes
          </button>
        </div>
      </form>

      <section className="settings-card" aria-labelledby="exclusions-title">
        <h2 id="exclusions-title">Excluded folders</h2>
        <p className="field-hint">
          Excluded folders are not read, listed or searched, and anything already indexed from them is removed from the index.
          Exclude a folder from the Folders tab.
        </p>
        {root.exclusions.length === 0 ? (
          <p className="results-empty">No folders are excluded.</p>
        ) : (
          <ul className="exclusion-list">
            {root.exclusions.map((exclusion) => (
              <li key={exclusion.id}>
                <span className="break-anywhere">{exclusion.path}</span>
                <span className="field-hint">since {dateFormat.format(exclusion.addedAt)}</span>
                <button
                  type="button"
                  className="icon-button"
                  disabled={busy || revoked}
                  onClick={() => void run(async () => (await companion.removeExclusion(root.id, exclusion.id), 'The folder is included again and is being indexed.'))}
                  aria-label={`Include ${exclusion.path} again`}
                  title="Include again"
                >
                  <X aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="settings-card" aria-labelledby="access-title">
        <h2 id="access-title">Access</h2>
        <ul className="access-actions">
          {revoked || root.needsPermission ? (
            <AccessAction
              icon={<KeyRound aria-hidden="true" />}
              title="Grant access again"
              help="Opens your computer's folder window at this library's folder. Only the same folder is accepted."
              action="Grant access"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await companion.reauthorizeLibrary(root.id)
                  return result.cancelled ? undefined : 'Access granted again. The library is being checked for changes.'
                })
              }
            />
          ) : null}
          {!revoked ? (
            root.state === 'paused' ? (
              <AccessAction
                icon={<Play aria-hidden="true" />}
                title="Resume"
                help="Picks up changes again and continues reading text."
                action="Resume"
                disabled={busy}
                onClick={() => void run(async () => (await companion.resumeLibrary(root.id), 'Resumed.'))}
              />
            ) : (
              <>
                <AccessAction
                  icon={<RefreshCw aria-hidden="true" />}
                  title="Check for changes"
                  help="Looks through the folder again now. Changes are also picked up automatically."
                  action="Check now"
                  disabled={busy}
                  onClick={() => void run(async () => (await companion.rescanLibrary(root.id), 'Checking for changes.'))}
                />
                <AccessAction
                  icon={<Pause aria-hidden="true" />}
                  title="Pause"
                  help="Stops indexing and reading. What is already indexed can still be searched."
                  action="Pause"
                  disabled={busy}
                  onClick={() => void run(async () => (await companion.pauseLibrary(root.id), 'Paused.'))}
                />
              </>
            )
          ) : null}
          {!revoked ? (
            <AccessAction
              icon={<Ban aria-hidden="true" />}
              title="Revoke access"
              help="Stops all reading at once and hides the library from every search and list. The index is kept so access can be granted again."
              action="Revoke"
              danger
              disabled={busy}
              onClick={() => setConfirm('revoke')}
            />
          ) : null}
          <AccessAction
            icon={<Eraser aria-hidden="true" />}
            title="Clear the index"
            help="Deletes the names, text and links indexed from this library. The library stays listed, paused, so you can index it again later."
            action="Clear index"
            danger
            disabled={busy}
            onClick={() => setConfirm('purge')}
          />
          <AccessAction
            icon={<Trash2 aria-hidden="true" />}
            title="Remove library"
            help="Removes the library and everything indexed from it."
            action="Remove"
            danger
            disabled={busy}
            onClick={() => setConfirm('remove')}
          />
        </ul>
        <p className="notice">Your files are never changed, moved or deleted by any of these actions.</p>
      </section>

      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}

      <Dialog
        open={confirm !== null}
        title={confirm === 'revoke' ? 'Revoke access to this library?' : confirm === 'purge' ? 'Clear this library’s index?' : 'Remove this library?'}
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
                const action = confirm
                setConfirm(null)
                if (action === 'revoke') void run(async () => (await companion.revokeLibrary(root.id), `Access to ${root.name} was revoked.`))
                else if (action === 'purge') void run(async () => (await companion.purgeLibrary(root.id), `The index of ${root.name} was cleared. The library is paused.`))
                else if (action === 'remove') void run(async () => (await companion.removeRoot(root.id), `${root.name} was removed. Its files were not touched.`), (message) => onRemoved(message ?? ''))
              }}
            >
              {confirm === 'revoke' ? 'Revoke access' : confirm === 'purge' ? 'Clear index' : 'Remove library'}
            </button>
          </>
        }
      >
        <p>
          <strong className="break-anywhere">{root.path}</strong>
        </p>
        {confirm === 'revoke' ? (
          <p>Document Vault stops reading this folder immediately. Nothing from it appears in search, lists or references until you grant access again.</p>
        ) : confirm === 'purge' ? (
          <p>Everything indexed from this folder (names, text, metadata and links) is deleted from this computer’s index. Corrections you made to titles or authors are deleted too.</p>
        ) : (
          <p>The library and its index are removed from Document Vault.</p>
        )}
        <p>The folder and its files stay on your computer, untouched.</p>
      </Dialog>
    </div>
  )
}

interface AccessActionProps {
  icon: ReactNode
  title: string
  help: string
  action: string
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}

function AccessAction({ icon, title, help, action, danger = false, disabled, onClick }: AccessActionProps) {
  return (
    <li className="access-action">
      <span className="access-action__icon">{icon}</span>
      <span className="access-action__text">
        <strong>{title}</strong>
        <span>{help}</span>
      </span>
      <button type="button" className={danger ? 'secondary-button button--small is-danger' : 'secondary-button button--small'} onClick={onClick} disabled={disabled}>
        {action}
      </button>
    </li>
  )
}
