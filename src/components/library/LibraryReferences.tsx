import { useEffect, useState } from 'react'
import { companion, type LibraryLink, type LinkStatus } from '../../services/desktopCompanion'
import { errorText, linkStatusLabels } from './libraryText'

interface LibraryReferencesProps {
  libraryId: number
  version: string
  onOpenEntry: (entryId: number) => void
}

const statuses: LinkStatus[] = ['verified', 'broken', 'unindexed', 'outside', 'external']

// The links found in this library's web pages (book catalogs), grouped by
// what was found at each target. Links are read from the index; none is
// followed or fetched to build this list.
export function LibraryReferences({ libraryId, version, onOpenEntry }: LibraryReferencesProps) {
  const [status, setStatus] = useState<LinkStatus>('verified')
  const [result, setResult] = useState<{ key: string; items: LibraryLink[]; error: string | null } | null>(null)
  const key = `${libraryId}:${status}:${version}`

  useEffect(() => {
    const controller = new AbortController()
    companion.libraryLinks(libraryId, status, controller.signal).then(
      (response) => setResult({ key, items: response.items, error: null }),
      (error: unknown) => {
        if (!controller.signal.aborted) setResult({ key, items: [], error: errorText(error, 'The links could not be loaded.') })
      },
    )
    return () => controller.abort()
  }, [libraryId, status, key])

  const current = result?.key === key ? result : null
  const info = linkStatusLabels[status]

  return (
    <div className="library-references">
      <div className="tabs library-references__filter" role="tablist" aria-label="Link status">
        {statuses.map((value) => (
          <button key={value} type="button" role="tab" aria-selected={status === value} className={status === value ? 'is-active' : ''} onClick={() => setStatus(value)}>
            {linkStatusLabels[value].label}
          </button>
        ))}
      </div>
      <p className="field-hint">{info.help}</p>

      {!current ? (
        <p className="results-empty" role="status">
          <span className="app-spinner app-spinner--small" aria-hidden="true" /> Loading links...
        </p>
      ) : current.error ? (
        <p className="notice notice--error" role="alert">
          {current.error}
        </p>
      ) : current.items.length === 0 ? (
        <p className="results-empty">No links of this kind were found in this library's web pages.</p>
      ) : (
        <ul className="reference-list">
          {current.items.map((link, position) => (
            <li key={`${link.entryId}-${position}`} className="reference-row">
              <div className="reference-row__text">
                <span className="reference-row__label">{link.label || link.href}</span>
                <span className="reference-row__href">
                  <code className="break-anywhere">{link.href}</code>
                </span>
                <span className="reference-row__source">
                  In{' '}
                  <button type="button" className="link-button" onClick={() => onOpenEntry(link.entryId)}>
                    {link.name}
                  </button>
                </span>
              </div>
              <div className="reference-row__actions">
                <span className={`chip${info.tone ? ` chip--${info.tone}` : ''}`}>{info.label}</span>
                {link.targetId ? (
                  <button type="button" className="secondary-button button--small" onClick={() => onOpenEntry(link.targetId as number)}>
                    Open book
                  </button>
                ) : null}
              </div>
            </li>
          ))}
          {current.items.length === 200 ? <li className="field-hint">Showing the first 200 links.</li> : null}
        </ul>
      )}
    </div>
  )
}
