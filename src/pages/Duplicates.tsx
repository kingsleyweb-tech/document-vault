import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Copy, EyeOff, FolderOpen, RotateCcw } from 'lucide-react'
import { CompanionSetup } from '../components/desktop/CompanionSetup'
import { dateFormat, errorText, numberFormat } from '../components/library/libraryText'
import { EmptyState } from '../components/ui/EmptyState'
import { PageHeader } from '../components/ui/PageHeader'
import { useCompanion } from '../hooks/useCompanion'
import { companion, type DuplicateKind, type DuplicateSet, type DuplicateSummary } from '../services/desktopCompanion'
import { formatFileSize } from '../utils/formatters'

const tabs: Array<{ value: DuplicateKind; label: string; note: string }> = [
  { value: 'exact', label: 'Identical files', note: 'These files have exactly the same content, byte for byte.' },
  {
    value: 'text',
    label: 'Same text, different file',
    note: 'These files contain the same words but are not identical files, for example a book saved again with new details. Compare them before removing anything.',
  },
]

// Duplicate books across all libraries. Listed only: Document Vault never
// deletes, moves or renames a file. The owner removes copies themselves.
export function Duplicates() {
  const { connection, status, refresh } = useCompanion()
  const [kind, setKind] = useState<DuplicateKind>('exact')
  const [library, setLibrary] = useState<number | null>(null)
  const [showDismissed, setShowDismissed] = useState(false)
  const [reload, setReload] = useState(0)
  const [summary, setSummary] = useState<DuplicateSummary | null>(null)
  const [list, setList] = useState<{ key: string; groups: DuplicateSet[]; error: string | null } | null>(null)
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)

  const ready = connection === 'ready' && status !== null
  const libraries = (status?.roots ?? []).filter((root) => root.state !== 'revoked')
  const key = `${kind}:${library ?? ''}:${showDismissed}:${reload}`

  useEffect(() => {
    if (!ready) return
    const controller = new AbortController()
    companion.duplicates({ kind, library, dismissed: showDismissed }, controller.signal).then(
      (result) => setList({ key, groups: result.groups, error: null }),
      (error: unknown) => {
        if (!controller.signal.aborted) setList({ key, groups: [], error: errorText(error, 'The duplicates could not be loaded.') })
      },
    )
    companion.duplicateSummary(controller.signal).then(setSummary, () => {})
    return () => controller.abort()
  }, [ready, kind, library, showDismissed, key])

  const act = async (task: () => Promise<unknown>, done?: string) => {
    setMessage(null)
    try {
      await task()
      if (done) setMessage({ tone: 'info', text: done })
    } catch (error) {
      setMessage({ tone: 'error', text: errorText(error) })
    }
  }

  const dismiss = (group: DuplicateSet, dismissed: boolean) =>
    void act(async () => {
      await companion.dismissDuplicate(group.kind, group.key, dismissed)
      setReload((value) => value + 1)
    }, dismissed ? 'Marked as not duplicates. The group comes back if another copy appears.' : 'The group is listed again.')

  const header = (
    <PageHeader title="Duplicate books" description={<SummaryLine summary={summary} />}>
      <Link to="/libraries" className="text-button library-detail__back">
        <ArrowLeft aria-hidden="true" />
        My Libraries
      </Link>
    </PageHeader>
  )

  if (!ready || !status) {
    return (
      <section className="page desktop-page">
        {header}
        {connection !== 'ready' ? <CompanionSetup connection={connection} onConnected={() => void refresh()} onRetry={() => void refresh()} /> : null}
      </section>
    )
  }

  const active = tabs.find((item) => item.value === kind) ?? tabs[0]
  const loading = !list || list.key !== key

  return (
    <section className="page desktop-page duplicates-page">
      {header}

      <p className="notice">Document Vault never deletes or moves files. To remove a copy, use Show in folder; the library updates by itself.</p>

      <div className="duplicates-toolbar">
        <div className="tabs library-detail__tabs" role="tablist" aria-label="Kinds of duplicates">
          {tabs.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={kind === item.value}
              className={kind === item.value ? 'is-active' : ''}
              onClick={() => setKind(item.value)}
            >
              {item.label}
              {summary ? ` (${numberFormat.format(summary[item.value].groups)})` : ''}
            </button>
          ))}
        </div>
        <label className="duplicates-toolbar__field">
          <span>Library</span>
          <select value={library ?? ''} onChange={(event) => setLibrary(event.target.value ? Number(event.target.value) : null)}>
            <option value="">All libraries</option>
            {libraries.map((root) => (
              <option key={root.id} value={root.id}>
                {root.name}
              </option>
            ))}
          </select>
        </label>
        <label className="duplicates-toolbar__check">
          <input type="checkbox" checked={showDismissed} onChange={(event) => setShowDismissed(event.target.checked)} />
          <span>Show groups marked as not duplicates</span>
        </label>
      </div>

      <p className="duplicates-note">{active.note}</p>

      {message ? (
        <p className={`notice${message.tone === 'error' ? ' notice--error' : ''}`} role={message.tone === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      ) : null}

      {loading ? (
        <p className="health-list__loading">Loading...</p>
      ) : list.error ? (
        <p className="notice notice--error">{list.error}</p>
      ) : list.groups.length === 0 ? (
        <EmptyState
          icon={<Copy aria-hidden="true" />}
          title={showDismissed ? 'Nothing marked as not duplicates' : kind === 'exact' ? 'No identical files' : 'No files with the same text'}
          message={
            summary && summary.checking.pending > 0
              ? `Still comparing ${numberFormat.format(summary.checking.pending)} files; this list fills in as they are checked.`
              : 'Nothing to tidy up here.'
          }
        />
      ) : (
        <ul className="duplicate-groups" aria-label={active.label}>
          {list.groups.map((group) => (
            <DuplicateCard
              key={group.key}
              group={group}
              onOpen={(id) => void act(() => companion.open(id))}
              onReveal={(id) => void act(() => companion.reveal(id))}
              onDismiss={(dismissed) => dismiss(group, dismissed)}
            />
          ))}
          {list.groups.length === 200 ? <li className="health-list__detail">Showing the 200 groups that use the most space.</li> : null}
        </ul>
      )}
    </section>
  )
}

function SummaryLine({ summary }: { summary: DuplicateSummary | null }) {
  if (!summary) return <>Copies of the same book across your libraries.</>
  const { exact, checking } = summary
  const books = exact.groups === 1 ? '1 book has' : `${numberFormat.format(exact.groups)} books have`
  return (
    <>
      {exact.groups > 0 ? `${books} identical copies, using ${formatFileSize(exact.extraBytes)} more than one copy each would.` : 'No identical copies found.'}
      {checking.pending > 0 ? ` Comparing ${numberFormat.format(checking.pending)} more files.` : ''}
    </>
  )
}

interface DuplicateCardProps {
  group: DuplicateSet
  onOpen: (entryId: number) => void
  onReveal: (entryId: number) => void
  onDismiss: (dismissed: boolean) => void
}

function DuplicateCard({ group, onOpen, onReveal, onDismiss }: DuplicateCardProps) {
  const title = group.sameName ? group.copies[0]?.name : `${group.copies.length} files`
  const size =
    group.kind === 'exact'
      ? `${group.copies.length} copies of ${formatFileSize(group.copies[0]?.size ?? 0)}`
      : `${group.copies.length} files with the same text`
  return (
    <li className="duplicate-group">
      <div className="duplicate-group__head">
        <div>
          <strong className="break-anywhere">{title}</strong>
          <span className="duplicate-group__meta">
            {size} · {formatFileSize(group.extraBytes)} in extra copies
          </span>
        </div>
        {group.dismissedAt ? (
          <button type="button" className="text-button" onClick={() => onDismiss(false)}>
            <RotateCcw aria-hidden="true" />
            List again
          </button>
        ) : (
          <button type="button" className="text-button" onClick={() => onDismiss(true)}>
            <EyeOff aria-hidden="true" />
            Keep all: not duplicates
          </button>
        )}
      </div>
      <ul className="duplicate-group__copies">
        {group.copies.map((copy) => (
          <li key={copy.entryId} className="duplicate-copy">
            <button type="button" className="link-button break-anywhere" onClick={() => onOpen(copy.entryId)}>
              {copy.name}
            </button>
            <span className="duplicate-copy__where break-anywhere">
              {copy.libraryName} · {copy.folder}
            </span>
            <span className="duplicate-copy__meta">
              {formatFileSize(copy.size)}
              {copy.mtime ? ` · modified ${dateFormat.format(copy.mtime)}` : ''}
            </span>
            <button type="button" className="text-button duplicate-copy__reveal" onClick={() => onReveal(copy.entryId)}>
              <FolderOpen aria-hidden="true" />
              Show in folder
            </button>
          </li>
        ))}
      </ul>
    </li>
  )
}
