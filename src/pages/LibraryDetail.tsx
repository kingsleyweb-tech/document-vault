import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, EyeOff, Search, X } from 'lucide-react'
import { CompanionSetup } from '../components/desktop/CompanionSetup'
import { useLocalOpener } from '../components/desktop/openLocalEntry'
import { LocalPreview } from '../components/desktop/LocalPreview'
import { FolderTree } from '../components/library/FolderTree'
import { LibraryHealth } from '../components/library/LibraryHealth'
import { LibraryReferences } from '../components/library/LibraryReferences'
import { LibrarySettings } from '../components/library/LibrarySettings'
import { OcrOffer } from '../components/library/OcrOffer'
import { dateFormat, errorText, libraryState, numberFormat, ocrProgress } from '../components/library/libraryText'
import { Dialog } from '../components/ui/Dialog'
import { PageHeader } from '../components/ui/PageHeader'
import { useCompanion } from '../hooks/useCompanion'
import { companion, type LocalEntry, type TreeFolder } from '../services/desktopCompanion'

type Tab = 'folders' | 'references' | 'health' | 'settings'

const tabs: Array<{ value: Tab; label: string }> = [
  { value: 'folders', label: 'Folders' },
  { value: 'references', label: 'Book links' },
  { value: 'health', label: 'Health' },
  { value: 'settings', label: 'Settings & access' },
]

export function LibraryDetail() {
  const { libraryId } = useParams()
  const id = Number(libraryId)
  const navigate = useNavigate()
  const { connection, status, refresh } = useCompanion()
  const [tab, setTab] = useState<Tab>('folders')
  const [preview, setPreview] = useState<LocalEntry | null>(null)
  const [excluding, setExcluding] = useState<TreeFolder | null>(null)
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)

  const root = status?.roots.find((item) => item.id === id) ?? null
  // Lists reload when the index changes (a scan finishes, settings change).
  const version = root
    ? [root.files, root.folders, root.state, root.status, root.lastScanAt, root.exclusions.length, root.extraction.completed ?? 0, root.ocr?.recognisedPages ?? 0, root.ocr?.pref ?? '', JSON.stringify(root.settings)].join(':')
    : ''

  const say = (text?: string) => {
    if (text) setMessage({ tone: 'info', text })
    void refresh()
  }
  const fail = (error: unknown) => setMessage({ tone: 'error', text: errorText(error) })

  // Files, and what shortcuts point to, are shown inside the app when they can be.
  const show = useLocalOpener(setPreview)

  const openEntry = async (entryId: number) => {
    setMessage(null)
    try {
      await show(await companion.entry(entryId))
    } catch (error) {
      fail(error)
    }
  }

  const showFile = (entry: LocalEntry) => {
    setMessage(null)
    show(entry).catch(fail)
  }

  if (connection !== 'ready') {
    return (
      <section className="page desktop-page">
        <PageHeader title="Library" />
        <CompanionSetup connection={connection} onConnected={() => void refresh()} onRetry={() => void refresh()} />
      </section>
    )
  }

  if (!root) {
    return (
      <section className="page desktop-page">
        <PageHeader title="Library not found" description="This library was removed, or the link is out of date." />
        <Link to="/libraries" className="secondary-button">
          <ArrowLeft aria-hidden="true" />
          <span>My Libraries</span>
        </Link>
      </section>
    )
  }

  const state = libraryState(root, status?.index)
  const recognising = ocrProgress(root)
  const revoked = root.state === 'revoked'
  const activeTab = revoked ? 'settings' : tab

  return (
    <section className="page desktop-page library-detail">
      <PageHeader
        title={root.name}
        description={<span className="break-anywhere">{root.path}</span>}
        actions={
          !revoked ? (
            <Link to={`/search?library=${root.id}`} className="secondary-button">
              <Search aria-hidden="true" />
              <span>Search this library</span>
            </Link>
          ) : null
        }
      >
        <Link to="/libraries" className="text-button library-detail__back">
          <ArrowLeft aria-hidden="true" />
          My Libraries
        </Link>
      </PageHeader>

      <div className="library-detail__summary">
        <span className={`chip${state.tone ? ` chip--${state.tone}` : ''}`}>{state.label}</span>
        <span>
          {numberFormat.format(root.files)} documents in {numberFormat.format(root.folders)} folders
        </span>
        {root.lastScanAt ? <span>Last checked {dateFormat.format(root.lastScanAt)}</span> : null}
        {root.exclusions.length > 0 ? <span>{root.exclusions.length} excluded {root.exclusions.length === 1 ? 'folder' : 'folders'}</span> : null}
        {recognising ? (
          <span>
            Scanned pages recognised: {numberFormat.format(recognising.done)} of {numberFormat.format(recognising.total)}
          </span>
        ) : null}
        <span>AI search: off</span>
      </div>
      <OcrOffer root={root} onDecided={(changed) => say(changed.ocr?.pref === 'on' ? 'Recognising scanned pages in the background.' : 'Scanned pages stay searchable by name only. You can change this in Settings & access.')} />
      {state.detail && state.tone === 'danger' ? (
        <p className="notice notice--error" role="status">
          {state.detail}
        </p>
      ) : null}

      {message ? (
        <p className={`notice${message.tone === 'error' ? ' notice--error' : ''} desktop-toast`} role={message.tone === 'error' ? 'alert' : 'status'}>
          <span>{message.text}</span>
          <button type="button" className="icon-button" onClick={() => setMessage(null)} aria-label="Dismiss">
            <X aria-hidden="true" />
          </button>
        </p>
      ) : null}

      <div className="tabs library-detail__tabs" role="tablist" aria-label="Library sections">
        {tabs.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={activeTab === item.value}
            className={activeTab === item.value ? 'is-active' : ''}
            onClick={() => setTab(item.value)}
            disabled={revoked && item.value !== 'settings'}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="library-detail__panel">
        {activeTab === 'folders' ? (
          <FolderTree libraryId={root.id} version={version} onFile={showFile} onExclude={setExcluding} />
        ) : activeTab === 'references' ? (
          <LibraryReferences libraryId={root.id} version={version} onOpenEntry={(entryId) => void openEntry(entryId)} />
        ) : activeTab === 'health' ? (
          <LibraryHealth
            libraryId={root.id}
            version={version}
            onOpenEntry={(entryId) => void openEntry(entryId)}
            onReveal={(entryId) => void companion.reveal(entryId).catch(fail)}
          />
        ) : (
          <LibrarySettings
            key={`${root.id}:${JSON.stringify(root.settings)}:${root.name}`}
            root={root}
            onChanged={say}
            onRemoved={(text) => {
              void refresh()
              navigate('/libraries', { state: { message: text } })
            }}
          />
        )}
      </div>

      <Dialog
        open={excluding !== null}
        title="Exclude this folder?"
        icon={<EyeOff aria-hidden="true" />}
        onClose={() => setExcluding(null)}
        footer={
          <>
            <button type="button" className="secondary-button" onClick={() => setExcluding(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                const folder = excluding
                setExcluding(null)
                if (folder) {
                  companion.excludeFolder(root.id, { entryId: folder.id }).then(
                    () => say(`${folder.name} is excluded. Nothing from it is read or searched.`),
                    fail,
                  )
                }
              }}
            >
              Exclude folder
            </button>
          </>
        }
      >
        <p>
          <strong className="break-anywhere">{excluding?.path}</strong>
        </p>
        <p>
          Document Vault stops reading this folder and removes what was indexed from it, including its text. The folder and its
          files are not changed. You can include it again in Settings & access.
        </p>
      </Dialog>

      {preview ? (
        <LocalPreview
          key={preview.id}
          entry={preview}
          onClose={() => setPreview(null)}
          onOpen={(entry) => void companion.open(entry.id).catch(fail)}
          onReveal={(entry) => void companion.reveal(entry.id).catch(fail)}
          onNavigate={setPreview}
        />
      ) : null}
    </section>
  )
}
