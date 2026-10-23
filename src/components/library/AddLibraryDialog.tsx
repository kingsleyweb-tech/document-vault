import { useState } from 'react'
import { FolderPlus } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { companion, type LocalKind, type LocalRoot, type PickedFolder } from '../../services/desktopCompanion'
import { errorText, libraryFileTypes } from './libraryText'

interface AddLibraryDialogProps {
  open: boolean
  onClose: () => void
  onAdded: (root: LocalRoot, note: string) => void
}

type Step = 'intro' | 'settings'

const depthOptions = [
  { value: '', label: 'All levels' },
  { value: '1', label: '1 level of subfolders' },
  { value: '2', label: '2 levels' },
  { value: '3', label: '3 levels' },
  { value: '5', label: '5 levels' },
  { value: '10', label: '10 levels' },
]

// Adding a library: explain what happens, let the user choose the folder in
// the system picker, then name it and choose what is indexed before anything
// is read. The folder's path comes from the picker, never from typing.
export function AddLibraryDialog({ open, onClose, onAdded }: AddLibraryDialogProps) {
  const [step, setStep] = useState<Step>('intro')
  const [picked, setPicked] = useState<PickedFolder | null>(null)
  const [name, setName] = useState('')
  const [recursive, setRecursive] = useState(true)
  const [depth, setDepth] = useState('')
  const [allTypes, setAllTypes] = useState(true)
  const [types, setTypes] = useState<Set<LocalKind>>(() => new Set(libraryFileTypes.filter((type) => type.text).map((type) => type.kind)))
  const [extractText, setExtractText] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setStep('intro')
    setPicked(null)
    setName('')
    setRecursive(true)
    setDepth('')
    setAllTypes(true)
    setExtractText(true)
    setError(null)
    setBusy(false)
  }

  const close = () => {
    reset()
    onClose()
  }

  const choose = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await companion.pickFolder()
      if ('cancelled' in result) return
      setPicked(result)
      setName(result.suggestedName)
      if (!result.problem && result.existingId === null) setStep('settings')
    } catch (failure) {
      setError(errorText(failure, 'The folder picker could not be shown.'))
    } finally {
      setBusy(false)
    }
  }

  const add = async () => {
    if (!picked) return
    setBusy(true)
    setError(null)
    try {
      const result = await companion.addLibrary({
        path: picked.path,
        name: name.trim() || picked.suggestedName,
        recursive,
        maxDepth: recursive && depth ? Number(depth) : null,
        fileTypes: allTypes ? null : [...types],
        extractText,
      })
      const merged = result.merged?.length ? ` It now includes ${result.merged.join(', ')}, which were separate libraries.` : ''
      const note = result.alreadyIndexed ? `${result.root.name} is already a library.` : `Added ${result.root.name}. Its documents are being indexed.${merged}`
      reset()
      onAdded(result.root, note)
    } catch (failure) {
      setError(errorText(failure))
      setBusy(false)
    }
  }

  const toggleType = (kind: LocalKind) =>
    setTypes((previous) => {
      const next = new Set(previous)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })

  const canAdd = Boolean(picked) && (allTypes || types.size > 0) && !busy

  return (
    <Dialog
      open={open}
      title={step === 'intro' ? 'Add a library' : 'Set up this library'}
      icon={<FolderPlus aria-hidden="true" />}
      wide
      onClose={close}
      onSubmit={step === 'settings' && canAdd ? () => void add() : undefined}
      footer={
        step === 'intro' ? (
          <>
            <button type="button" className="secondary-button" onClick={close}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={() => void choose()} disabled={busy}>
              {busy ? 'Waiting for your choice...' : 'Choose folder'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="secondary-button" onClick={() => setStep('intro')} disabled={busy}>
              Back
            </button>
            <button type="submit" className="primary-button" disabled={!canAdd}>
              {busy ? 'Adding...' : 'Add library'}
            </button>
          </>
        )
      }
    >
      {step === 'intro' ? (
        <div className="library-wizard">
          <p>
            A library is a folder you allow Document Vault to search, such as the folder that holds your law books. You choose
            it in your computer's own folder window.
          </p>
          <ul className="library-wizard__facts">
            <li>Only the folder you choose, and the subfolders you allow, are read.</li>
            <li>Names, dates and the text inside documents are kept in an index on this computer. Nothing is uploaded.</li>
            <li>Your files are never changed, moved or deleted. Removing a library only removes its index.</li>
            <li>You can exclude subfolders, pause, or revoke access at any time.</li>
          </ul>
          {picked?.problem ? (
            <p className="notice notice--error" role="alert">
              <strong className="break-anywhere">{picked.path}</strong>: {picked.problem}
            </p>
          ) : null}
          {picked && picked.existingId !== null ? (
            <p className="notice" role="status">
              <strong className="break-anywhere">{picked.path}</strong> is already a library. Choose a different folder, or open
              that library to change its settings.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="library-wizard">
          <p className="library-wizard__path">
            <span>Folder</span>
            <strong className="break-anywhere">{picked?.path}</strong>
          </p>

          <label className="field">
            <span>Library name</span>
            <input className="field-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus />
          </label>

          <fieldset className="library-wizard__group">
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
            <p className="field-hint">You can exclude particular subfolders after the library is added.</p>
          </fieldset>

          <fieldset className="library-wizard__group">
            <legend>File types</legend>
            <label className="check-row">
              <input type="radio" name="library-types" checked={allTypes} onChange={() => setAllTypes(true)} />
              <span>All files</span>
            </label>
            <label className="check-row">
              <input type="radio" name="library-types" checked={!allTypes} onChange={() => setAllTypes(false)} />
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
            {!allTypes && types.size === 0 ? <p className="field-hint">Choose at least one type.</p> : null}
          </fieldset>

          <fieldset className="library-wizard__group">
            <legend>Text inside documents</legend>
            <label className="check-row">
              <input type="checkbox" checked={extractText} onChange={(event) => setExtractText(event.target.checked)} />
              <span>Read the text of PDF, Word, EPUB, PowerPoint, web pages and text files for full-text search</span>
            </label>
            <p className="field-hint">
              The text stays in the index on this computer. If the folder holds scanned PDFs (pictures of pages), you are asked
              once whether to recognise their text; until then they are found by name.
            </p>
          </fieldset>
        </div>
      )}
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  )
}
