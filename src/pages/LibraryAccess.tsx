import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bot, ShieldCheck } from 'lucide-react'
import { CompanionSetup } from '../components/desktop/CompanionSetup'
import { dateFormat, errorText, libraryState, numberFormat } from '../components/library/libraryText'
import { PageHeader } from '../components/ui/PageHeader'
import { useCompanion } from '../hooks/useCompanion'
import { companion, type AccessOverview } from '../services/desktopCompanion'

const eventLabels: Record<string, string> = {
  'library-added': 'Library added',
  'library-paused': 'Paused',
  'library-resumed': 'Resumed',
  'library-revoked': 'Access revoked',
  'library-reauthorized': 'Access granted again',
  'library-purged': 'Index cleared',
  'library-removed': 'Library removed',
  'exclusion-added': 'Folder excluded',
  'exclusion-removed': 'Folder included again',
  'settings-changed': 'Settings changed',
}

// Library Access: exactly what Document Vault may read on this computer, and
// a record of every change to that access.
export function LibraryAccess() {
  const { connection, status, refresh } = useCompanion()
  const [overview, setOverview] = useState<{ key: string; value: AccessOverview | null; error: string | null } | null>(null)
  const key = status ? status.roots.map((root) => `${root.id}:${root.state}:${root.status}:${root.exclusions.length}`).join('|') : ''

  useEffect(() => {
    if (connection !== 'ready') return undefined
    const controller = new AbortController()
    companion.access(controller.signal).then(
      (value) => setOverview({ key, value, error: null }),
      (error: unknown) => {
        if (!controller.signal.aborted) setOverview({ key, value: null, error: errorText(error, 'Library access could not be loaded.') })
      },
    )
    return () => controller.abort()
  }, [connection, key])

  if (connection !== 'ready') {
    return (
      <section className="page desktop-page">
        <PageHeader title="Library Access" description="What Document Vault may read on this computer." />
        <CompanionSetup connection={connection} onConnected={() => void refresh()} onRetry={() => void refresh()} />
      </section>
    )
  }

  const value = overview?.value
  const names = new Map(value?.libraries.map((library) => [library.id, library.name]))

  return (
    <section className="page desktop-page access-page">
      <PageHeader title="Library Access" description="Exactly what Document Vault may read on this computer, and every change to that access." />

      <div className="access-cards">
        <article className="settings-card">
          <h2>
            <ShieldCheck aria-hidden="true" /> How access works
          </h2>
          <ul className="library-wizard__facts">
            <li>Document Vault reads only the folders you added as libraries, minus the folders you excluded.</li>
            <li>The index of names and text is stored on this computer. Library content is not uploaded.</li>
            <li>
              <strong>Pause</strong> stops indexing; <strong>Revoke</strong> also hides the library from all searches;{' '}
              <strong>Clear index</strong> deletes what was indexed; <strong>Remove</strong> does both and removes the library.
            </li>
            <li>None of these change, move or delete your files.</li>
          </ul>
        </article>
        <article className="settings-card">
          <h2>
            <Bot aria-hidden="true" /> AI search: off
          </h2>
          <p>{value?.ai.note ?? 'No assistant is connected. Library content never leaves this computer.'}</p>
          <p className="field-hint">
            If an assistant is added in a future version, it will be off until you turn it on, and it will only see the libraries
            you choose.
          </p>
        </article>
      </div>

      {overview?.error ? (
        <p className="notice notice--error" role="alert">
          {overview.error}
        </p>
      ) : null}

      <section className="settings-card" aria-labelledby="access-libraries">
        <h2 id="access-libraries">Libraries</h2>
        {!value ? (
          <p className="results-empty" role="status">
            <span className="app-spinner app-spinner--small" aria-hidden="true" /> Loading...
          </p>
        ) : value.libraries.length === 0 ? (
          <p className="results-empty">
            Document Vault may not read any folder on this computer. <Link to="/libraries">Add a library</Link> to allow it.
          </p>
        ) : (
          <div className="access-table-wrap">
            <table className="access-table">
              <thead>
                <tr>
                  <th scope="col">Library</th>
                  <th scope="col">Access</th>
                  <th scope="col">Excluded folders</th>
                  <th scope="col">Last checked</th>
                  <th scope="col">Problems</th>
                </tr>
              </thead>
              <tbody>
                {value.libraries.map((library) => {
                  const state = libraryState(library)
                  const failed = library.extraction.failed ?? 0
                  return (
                    <tr key={library.id}>
                      <td>
                        <Link to={`/libraries/${library.id}`}>{library.name}</Link>
                        <span className="access-table__path break-anywhere">{library.path}</span>
                      </td>
                      <td>
                        <span className={`chip${state.tone ? ` chip--${state.tone}` : ''}`}>{state.label}</span>
                        {library.revokedAt ? <span className="access-table__path">since {dateFormat.format(library.revokedAt)}</span> : null}
                      </td>
                      <td>
                        {library.exclusions.length === 0 ? (
                          'None'
                        ) : (
                          <ul className="access-table__list">
                            {library.exclusions.map((exclusion) => (
                              <li key={exclusion.id} className="break-anywhere">
                                {exclusion.path}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td>{library.lastScanAt ? dateFormat.format(library.lastScanAt) : 'Not yet'}</td>
                      <td>{failed > 0 ? `${numberFormat.format(failed)} documents could not be read` : 'None'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="settings-card" aria-labelledby="access-events">
        <h2 id="access-events">Recent changes</h2>
        {!value || value.events.length === 0 ? (
          <p className="results-empty">No changes recorded yet.</p>
        ) : (
          <ul className="access-events">
            {value.events.map((event, position) => (
              <li key={`${event.at}-${position}`}>
                <span className="access-events__when">{dateFormat.format(event.at)}</span>
                <strong>{eventLabels[event.kind] ?? event.kind}</strong>
                <span className="break-anywhere">
                  {event.libraryId !== null ? (names.get(event.libraryId) ?? `Library ${event.libraryId}`) : ''}
                  {event.detail ? `${event.libraryId !== null ? ': ' : ''}${event.detail}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  )
}
