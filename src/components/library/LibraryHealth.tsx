import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { companion, type DuplicateGroup, type HealthItem, type HealthSection, type HealthSummary } from '../../services/desktopCompanion'
import { formatFileSize } from '../../utils/formatters'
import { errorText, numberFormat } from './libraryText'

interface LibraryHealthProps {
  libraryId: number
  version: string
  onOpenEntry: (entryId: number) => void
  onReveal: (entryId: number) => void
}

interface Check {
  section: HealthSection
  title: string
  help: string
  count: (summary: HealthSummary) => number
  tone: 'danger' | 'warning' | ''
}

const checks: Check[] = [
  { section: 'inaccessible', title: 'Cannot be read', help: 'The system refused access to these items.', count: (s) => s.inaccessible, tone: 'danger' },
  { section: 'failed', title: 'Text could not be read', help: 'The document may be damaged, protected by a password or too complex to read.', count: (s) => s.text.failed ?? 0, tone: 'danger' },
  { section: 'broken-links', title: 'Broken book links', help: 'Web pages in this library link to books that are not where the link says.', count: (s) => s.links.broken ?? 0, tone: 'danger' },
  { section: 'outside-links', title: 'Links outside the library', help: 'Links that point outside your libraries. They are never followed.', count: (s) => s.links.outside ?? 0, tone: 'warning' },
  { section: 'needs-ocr', title: 'Scanned, text not recognised yet', help: 'Pages without a text layer (pictures of pages). They are found by name, not by their words, until their text is recognised. Turn on text recognition in Settings & access.', count: (s) => s.needsOcr, tone: 'warning' },
  { section: 'ocr-failed', title: 'Scanned pages not recognised', help: 'Text recognition failed on some or all pages of these documents. The scan may be damaged or protected.', count: (s) => s.ocrFailed ?? 0, tone: 'danger' },
  { section: 'ocr-low-confidence', title: 'Recognised with low confidence', help: 'The scan may be faint, skewed or handwritten, so searches can miss words. Open the document to read it.', count: (s) => s.ocrLowConfidence ?? 0, tone: 'warning' },
  { section: 'truncated', title: 'Only partly read', help: 'Very large documents; only the first part of the text is searchable.', count: (s) => s.truncated, tone: 'warning' },
  { section: 'waiting', title: 'Waiting', help: 'Documents waiting for permission, a drive, or stopped before they were read.', count: (s) => (s.text.waiting_permission ?? 0) + (s.text.waiting_drive ?? 0) + (s.text.cancelled ?? 0), tone: '' },
  { section: 'unindexed-links', title: 'Links to items not indexed', help: 'Targets inside the library that are excluded or not indexed by the current settings.', count: (s) => s.links.unindexed ?? 0, tone: '' },
  { section: 'skipped', title: 'Skipped while indexing', help: 'Links, system folders and folders deeper than the depth you set. Each is listed with its reason.', count: (s) => Object.values(s.skipped).reduce((a, b) => a + b, 0), tone: '' },
  { section: 'names-only', title: 'Found by name only', help: 'File types whose text Document Vault does not read yet (for example images and spreadsheets).', count: (s) => s.namesOnly, tone: '' },
  { section: 'duplicates', title: 'Identical copies', help: 'Files with exactly the same content. Listed only; nothing is ever deleted.', count: (s) => s.duplicateGroups, tone: '' },
]

// Library Health: what could not be indexed or read, and why. Every list is
// read-only; nothing here changes or deletes a file.
export function LibraryHealth({ libraryId, version, onOpenEntry, onReveal }: LibraryHealthProps) {
  const [summary, setSummary] = useState<{ key: string; value: HealthSummary | null; error: string | null } | null>(null)
  const [section, setSection] = useState<HealthSection | null>(null)
  const key = `${libraryId}:${version}`

  useEffect(() => {
    const controller = new AbortController()
    companion.health(libraryId, controller.signal).then(
      (result) => setSummary({ key, value: result.summary, error: null }),
      (error: unknown) => {
        if (!controller.signal.aborted) setSummary({ key, value: null, error: errorText(error, 'Library Health could not be loaded.') })
      },
    )
    return () => controller.abort()
  }, [libraryId, key])

  if (!summary) {
    return (
      <p className="results-empty" role="status">
        <span className="app-spinner app-spinner--small" aria-hidden="true" /> Checking the library...
      </p>
    )
  }
  if (!summary.value) {
    return (
      <p className="notice notice--error" role="alert">
        {summary.error}
      </p>
    )
  }
  const value = summary.value
  const readText = value.text.completed ?? 0

  return (
    <div className="library-health">
      <dl className="health-totals">
        <div>
          <dt>Documents</dt>
          <dd>{numberFormat.format(value.files)}</dd>
        </div>
        <div>
          <dt>Folders</dt>
          <dd>{numberFormat.format(value.folders)}</dd>
        </div>
        <div>
          <dt>Text searchable</dt>
          <dd>{numberFormat.format(readText)}</dd>
        </div>
        <div>
          <dt>Catalog pages</dt>
          <dd>{numberFormat.format(value.catalogs)}</dd>
        </div>
        <div>
          <dt>Verified book links</dt>
          <dd>{numberFormat.format(value.links.verified ?? 0)}</dd>
        </div>
      </dl>

      {value.skippedByType > 0 ? (
        <p className="notice">
          {numberFormat.format(value.skippedByType)} files were left out because this library only indexes the file types chosen
          in its settings.
        </p>
      ) : null}

      <ul className="health-checks">
        {checks.map((check) => {
          const count = check.count(value)
          const open = section === check.section
          return (
            <li key={check.section} className={`health-check${count === 0 ? ' is-clear' : ''}`}>
              <button
                type="button"
                className="health-check__head"
                onClick={() => setSection(open ? null : check.section)}
                disabled={count === 0}
                aria-expanded={open}
              >
                <span className={`health-check__count${count > 0 && check.tone ? ` is-${check.tone}` : ''}`}>{numberFormat.format(count)}</span>
                <span className="health-check__text">
                  <strong>{check.title}</strong>
                  <span>{check.help}</span>
                </span>
              </button>
              {open ? <HealthList libraryId={libraryId} section={check.section} version={version} onOpenEntry={onOpenEntry} onReveal={onReveal} /> : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function HealthList({ libraryId, section, version, onOpenEntry, onReveal }: { libraryId: number; section: HealthSection; version: string } & Pick<LibraryHealthProps, 'onOpenEntry' | 'onReveal'>) {
  const [items, setItems] = useState<{ key: string; list: Array<HealthItem | DuplicateGroup>; error: string | null } | null>(null)
  const key = `${libraryId}:${section}:${version}`

  useEffect(() => {
    const controller = new AbortController()
    companion.healthSection<HealthItem | DuplicateGroup>(libraryId, section, controller.signal).then(
      (result) => setItems({ key, list: result.items, error: null }),
      (error: unknown) => {
        if (!controller.signal.aborted) setItems({ key, list: [], error: errorText(error, 'This list could not be loaded.') })
      },
    )
    return () => controller.abort()
  }, [libraryId, section, key])

  if (!items || items.key !== key) return <p className="health-list__loading">Loading...</p>
  if (items.error) return <p className="notice notice--error">{items.error}</p>

  return (
    <ul className="health-list">
      {section === 'duplicates' ? (
        <li className="health-list__detail">
          <Link to="/libraries/duplicates">See duplicates across all libraries</Link>, including files with the same text.
        </li>
      ) : null}
      {items.list.map((item, position) =>
        'copies' in item ? (
          <li key={item.hash} className="health-list__group">
            <span className="health-list__detail">
              {item.copies.length} identical copies ({formatFileSize(item.copies[0]?.size ?? 0)} each)
            </span>
            <ul>
              {item.copies.map((copy) => (
                <li key={copy.entryId} className="health-list__item">
                  <button type="button" className="link-button" onClick={() => onOpenEntry(copy.entryId)}>
                    {copy.name}
                  </button>
                  <span className="health-list__folder">{copy.folder}</span>
                  <button type="button" className="text-button" onClick={() => onReveal(copy.entryId)}>
                    Show in folder
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ) : (
          <li key={`${item.entryId ?? item.name}-${position}`} className="health-list__item">
            {item.entryId ? (
              <button type="button" className="link-button" onClick={() => onOpenEntry(item.entryId as number)}>
                {item.name}
              </button>
            ) : (
              <strong>{item.name}</strong>
            )}
            <span className="health-list__folder">{item.folder}</span>
            {item.href ? (
              <span className="health-list__detail">
                Links to <code className="break-anywhere">{item.href}</code>
                {item.label ? ` (“${item.label}”)` : ''}
              </span>
            ) : item.detail ? (
              <span className="health-list__detail">{item.detail}</span>
            ) : null}
          </li>
        ),
      )}
      {items.list.length === 200 ? <li className="health-list__detail">Showing the first 200.</li> : null}
    </ul>
  )
}
