import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, ExternalLink, Eye, FolderOpen, FolderSearch, HardDrive, Search, X } from 'lucide-react'
import { CompanionSetup } from '../components/desktop/CompanionSetup'
import { IndexedFolders } from '../components/desktop/IndexedFolders'
import { LocalPreview } from '../components/desktop/LocalPreview'
import { DocumentIcon } from '../components/documents/DocumentIcon'
import { EmptyState } from '../components/ui/EmptyState'
import { PageHeader } from '../components/ui/PageHeader'
import { useCompanion } from '../hooks/useCompanion'
import { searchDocumentContent, snippetParts, type ContentMatch } from '../services/contentIndex'
import {
  companion,
  CompanionError,
  type LocalEntry,
  type LocalKind,
  type LocalSearchParams,
  type LocalSearchResult,
} from '../services/desktopCompanion'
import type { DocumentKind, VaultDocument } from '../types/document'
import { formatFileSize } from '../utils/formatters'
import { matchesSearch } from '../utils/sorting'
import { locationResolver } from '../utils/trash'

type Source = 'local' | 'uploaded' | 'all'

interface DesktopFilesProps {
  documents: VaultDocument[]
  allDocuments: VaultDocument[]
  search: string
  onOpenDocument: (document: VaultDocument) => void
}

const PAGE_SIZE = 50
const UPLOADED_LIMIT = 100
const CONTENT_PAGE = 30
const DEBOUNCE_MS = 180
const DAY = 24 * 60 * 60 * 1000

const sourceOptions: Array<{ value: Source; label: string }> = [
  { value: 'local', label: 'This computer' },
  { value: 'uploaded', label: 'Uploaded documents' },
  { value: 'all', label: 'All sources' },
]

const typeOptions: Array<{ value: string; label: string }> = [
  { value: '', label: 'Files and folders' },
  { value: 'files', label: 'Files only' },
  { value: 'folder', label: 'Folders only' },
  { value: 'pdf', label: 'PDF' },
  { value: 'word', label: 'Word documents' },
  { value: 'spreadsheet', label: 'Spreadsheets' },
  { value: 'presentation', label: 'Presentations' },
  { value: 'image', label: 'Images' },
  { value: 'text', label: 'Text and data' },
  { value: 'ebook', label: 'eBooks' },
  { value: 'audio', label: 'Audio' },
  { value: 'video', label: 'Video' },
  { value: 'archive', label: 'Archives' },
  { value: 'shortcut', label: 'Shortcuts' },
  { value: 'program', label: 'Programs and scripts' },
  { value: 'other', label: 'Other files' },
]

const modifiedOptions = [
  { value: '', label: 'Any date' },
  { value: '1', label: 'Last 24 hours' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '365', label: 'Last year' },
  { value: 'older', label: 'Older than a year' },
]

const sizeOptions = [
  { value: '', label: 'Any size' },
  { value: 'small', label: 'Under 1 MB' },
  { value: 'medium', label: '1 MB to 100 MB' },
  { value: 'large', label: 'Over 100 MB' },
]

const sortOptions: Array<{ value: NonNullable<LocalSearchParams['sort']>; label: string }> = [
  { value: 'relevance', label: 'Best match' },
  { value: 'modified', label: 'Recently modified' },
  { value: 'name', label: 'Name' },
  { value: 'size', label: 'Largest first' },
]

const MB = 1024 * 1024

// Local kinds that DocumentIcon has a tile for; the rest use the generic one.
const iconKinds = new Set<DocumentKind>(['pdf', 'image', 'word', 'spreadsheet', 'presentation', 'folder', 'html', 'text', 'ebook'])

const kindLabels: Record<LocalKind, string> = {
  folder: 'Folder',
  pdf: 'PDF',
  word: 'Word',
  spreadsheet: 'Spreadsheet',
  presentation: 'Presentation',
  image: 'Image',
  text: 'Text',
  html: 'Web page',
  ebook: 'eBook',
  audio: 'Audio',
  video: 'Video',
  archive: 'Archive',
  shortcut: 'Shortcut',
  program: 'Program',
  other: 'File',
}

const availabilityLabels = {
  missing: 'No longer at this location',
  offline: 'Drive not connected',
  denied: 'Access denied',
} as const

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

interface Filters {
  type: string
  root: string
  within: string | null
  modified: string
  size: string
  sort: NonNullable<LocalSearchParams['sort']>
}

const emptyFilters: Filters = { type: '', root: '', within: null, modified: '', size: '', sort: 'relevance' }

function toParams(query: string, filters: Filters, offset: number): LocalSearchParams {
  const params: LocalSearchParams = { q: query, sort: filters.sort, limit: PAGE_SIZE, offset }
  if (filters.type === 'files') params.type = 'file'
  else if (filters.type === 'folder') params.type = 'folder'
  else if (filters.type) params.kind = [filters.type as LocalKind]
  if (filters.root) params.root = Number(filters.root)
  if (filters.within) params.within = filters.within
  if (filters.modified === 'older') params.modifiedBefore = Date.now() - 365 * DAY
  else if (filters.modified) params.modifiedAfter = Date.now() - Number(filters.modified) * DAY
  if (filters.size === 'small') params.maxSize = MB - 1
  else if (filters.size === 'medium') Object.assign(params, { minSize: MB, maxSize: 100 * MB })
  else if (filters.size === 'large') params.minSize = 100 * MB + 1
  return params
}

interface ContentResults {
  key: string
  items: ContentMatch[]
  total: number
  error: string | null
}

interface LocalResults {
  key: string
  items: LocalEntry[]
  total: number
  totalCapped: boolean
  fuzzy: boolean
  tookMs: number
  error: string | null
}

// Finds files and folders on this computer through the local companion, and
// optionally the uploaded vault too. Every result says where it comes from.
export function DesktopFiles({ documents, allDocuments, search, onOpenDocument }: DesktopFilesProps) {
  const { connection, status, version, refresh } = useCompanion()
  const [source, setSource] = useState<Source>('local')
  const [query, setQuery] = useState(search)
  const [debouncedQuery, setDebouncedQuery] = useState(search)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [results, setResults] = useState<LocalResults | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [preview, setPreview] = useState<LocalEntry | null>(null)
  const [toast, setToast] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)
  const [showFolders, setShowFolders] = useState(false)
  const [contentResults, setContentResults] = useState<ContentResults | null>(null)
  const [loadingMoreContent, setLoadingMoreContent] = useState(false)
  const moreController = useRef<AbortController | null>(null)

  const wantsLocal = source !== 'uploaded'
  const ready = connection === 'ready'
  const searchKey = JSON.stringify([debouncedQuery, filters])
  const indexVersion = status ? `${status.index.totals.files}:${status.index.totals.folders}:${status.index.state}` : ''

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query])

  // Each new search cancels the one before it, so results never arrive out of order.
  useEffect(() => {
    if (!wantsLocal || !ready) return undefined
    const controller = new AbortController()
    companion.search(toParams(debouncedQuery, filters, 0), controller.signal).then(
      (result: LocalSearchResult) => setResults({ key: searchKey, ...result, error: null }),
      (error: unknown) => {
        if (controller.signal.aborted) return
        const message = error instanceof CompanionError ? error.message : 'Search failed.'
        setResults({ key: searchKey, items: [], total: 0, totalCapped: false, fuzzy: false, tookMs: 0, error: message })
        if (error instanceof CompanionError && error.problem !== 'failed') void refresh()
      },
    )
    return () => {
      controller.abort()
      moreController.current?.abort()
    }
    // indexVersion re-runs the search when indexing adds or removes entries.
  }, [wantsLocal, ready, debouncedQuery, filters, searchKey, indexVersion, refresh])

  const searching = wantsLocal && ready && (results?.key !== searchKey || query.trim() !== debouncedQuery)
  const local = results?.key === searchKey ? results : null

  const loadMore = () => {
    if (!local) return
    moreController.current?.abort()
    const controller = new AbortController()
    moreController.current = controller
    setLoadingMore(true)
    companion
      .search(toParams(debouncedQuery, filters, local.items.length), controller.signal)
      .then(
        (next) => setResults((previous) => (previous && previous.key === searchKey ? { ...previous, items: [...previous.items, ...next.items] } : previous)),
        (error: unknown) => {
          if (!controller.signal.aborted) setToast({ tone: 'error', text: error instanceof CompanionError ? error.message : 'Could not load more results.' })
        },
      )
      .finally(() => setLoadingMore(false))
  }

  const resolveLocation = useMemo(() => locationResolver(allDocuments), [allDocuments])
  const uploaded = useMemo(() => {
    if (source === 'local') return []
    const text = debouncedQuery
    return documents
      .filter((record) => matchesSearch(record, text) && (filters.type !== 'folder' || record.fileType === 'folder'))
      .filter((record) => filters.type !== 'files' || record.fileType !== 'folder')
      .slice(0, UPLOADED_LIMIT)
  }, [documents, debouncedQuery, filters.type, source])

  // Words inside uploaded documents are searched in Postgres; names are matched above.
  const wantsContent = source !== 'local' && debouncedQuery.length > 0 && filters.type !== 'folder'
  useEffect(() => {
    if (!wantsContent) return undefined
    const controller = new AbortController()
    searchDocumentContent(debouncedQuery, CONTENT_PAGE, 0, controller.signal).then(
      (page) => {
        if (!controller.signal.aborted) setContentResults({ key: debouncedQuery, items: page?.items ?? [], total: page?.total ?? 0, error: null })
      },
      () => {
        if (!controller.signal.aborted) {
          setContentResults({ key: debouncedQuery, items: [], total: 0, error: 'Searching inside uploaded documents is unavailable right now. Names are still searched.' })
        }
      },
    )
    return () => controller.abort()
  }, [wantsContent, debouncedQuery])
  const content = wantsContent && contentResults?.key === debouncedQuery ? contentResults : null

  const loadMoreContent = () => {
    if (!content) return
    setLoadingMoreContent(true)
    searchDocumentContent(debouncedQuery, CONTENT_PAGE, content.items.length)
      .then((page) =>
        setContentResults((previous) =>
          previous && previous.key === debouncedQuery && page ? { ...previous, items: [...previous.items, ...page.items], total: page.total } : previous,
        ),
      )
      .catch(() => setToast({ tone: 'error', text: 'Could not load more results.' }))
      .finally(() => setLoadingMoreContent(false))
  }

  // Only documents still in the visible library are listed, so a stale database row never shows as available.
  const { snippets, textOnly } = useMemo(() => {
    const byId = new Map(documents.map((record) => [record.id, record]))
    const nameMatched = new Set(uploaded.map((record) => record.id))
    const snippetById = new Map<string, string>()
    const extra: VaultDocument[] = []
    for (const match of content?.items ?? []) {
      const record = byId.get(match.id)
      if (!record) continue
      if (match.snippet) snippetById.set(match.id, match.snippet)
      if (match.matchedContent && !nameMatched.has(match.id)) extra.push(record)
    }
    return { snippets: snippetById, textOnly: extra }
  }, [content, documents, uploaded])

  const act = async (entry: LocalEntry, action: 'open' | 'reveal') => {
    setToast(null)
    try {
      await (action === 'open' ? companion.open(entry.id) : companion.reveal(entry.id))
      setToast({ tone: 'info', text: action === 'open' ? `Opening ${entry.name} on this computer.` : `Showing ${entry.name} in File Explorer.` })
    } catch (error) {
      setToast({ tone: 'error', text: error instanceof CompanionError ? error.message : 'The companion could not do that.' })
      if (error instanceof CompanionError && error.problem === 'gone') {
        setResults((previous) => previous && { ...previous, items: previous.items.filter((item) => item.id !== entry.id), total: Math.max(0, previous.total - 1) })
      }
    }
  }

  const copyPath = async (entry: LocalEntry) => {
    try {
      await navigator.clipboard.writeText(entry.path)
      setToast({ tone: 'info', text: 'Path copied.' })
    } catch {
      setToast({ tone: 'error', text: 'Copying is not allowed here. Select the path and copy it instead.' })
    }
  }

  const setFilter = <K extends keyof Filters>(name: K, value: Filters[K]) => setFilters((previous) => ({ ...previous, [name]: value }))
  const filtersActive = JSON.stringify(filters) !== JSON.stringify(emptyFilters)
  const roots = status?.roots ?? []
  const noRoots = ready && roots.length === 0

  const localSection = !wantsLocal ? null : !ready ? (
    <CompanionSetup connection={connection} onConnected={() => void refresh()} onRetry={() => void refresh()} />
  ) : noRoots ? null : (
    <section className="local-results" aria-labelledby="local-results-title" aria-busy={searching}>
      <header className="results-heading">
        <h2 id="local-results-title">
          <HardDrive aria-hidden="true" />
          {debouncedQuery || filtersActive ? 'On this computer' : 'Recently changed on this computer'}
        </h2>
        <span className="results-heading__count" role="status">
          {searching ? (
            <>
              <span className="app-spinner app-spinner--small" aria-hidden="true" /> Searching...
            </>
          ) : local?.error ? null : local ? (
            `${local.totalCapped ? 'More than ' : ''}${local.total.toLocaleString()} ${local.total === 1 ? 'result' : 'results'}${local.fuzzy ? ' (close matches)' : ''} in ${local.tookMs} ms`
          ) : null}
        </span>
      </header>
      {local?.error ? (
        <p className="notice notice--error" role="alert">
          {local.error}
        </p>
      ) : null}
      {local && !local.error && local.items.length === 0 && !searching ? (
        <EmptyState
          icon={<FolderSearch aria-hidden="true" />}
          title={debouncedQuery ? `Nothing on this computer matches "${debouncedQuery}"` : 'Nothing indexed matches these filters'}
          message="Check the spelling, clear filters, or add the folder that holds the file to the indexed folders."
        />
      ) : null}
      {local && local.items.length > 0 ? (
        <ul className="result-list" aria-label="Files and folders on this computer">
          {local.items.map((entry) => (
            <LocalResultRow
              key={entry.id}
              entry={entry}
              onOpen={() => void act(entry, 'open')}
              onReveal={() => void act(entry, 'reveal')}
              onPreview={() => setPreview(entry)}
              onSearchInside={() => {
                setFilters((previous) => ({ ...previous, within: entry.path, root: '' }))
                setQuery('')
              }}
              onCopyPath={() => void copyPath(entry)}
            />
          ))}
        </ul>
      ) : null}
      {local && local.items.length < local.total ? (
        <button type="button" className="secondary-button load-more" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? 'Loading...' : `Show more (${(local.total - local.items.length).toLocaleString()}${local.totalCapped ? '+' : ''} left)`}
        </button>
      ) : null}
    </section>
  )

  const uploadedSection =
    source === 'local' ? null : (
      <section className="local-results" aria-labelledby="uploaded-results-title">
        <header className="results-heading">
          <h2 id="uploaded-results-title">Uploaded to Document Vault</h2>
          <span className="results-heading__count" role="status">
            {wantsContent && !content ? (
              <>
                <span className="app-spinner app-spinner--small" aria-hidden="true" /> Searching inside documents...
              </>
            ) : (
              <>
                {(uploaded.length + textOnly.length).toLocaleString()}
                {uploaded.length === UPLOADED_LIMIT || (content && content.items.length < content.total) ? '+' : ''}{' '}
                {uploaded.length + textOnly.length === 1 ? 'result' : 'results'}
              </>
            )}
          </span>
        </header>
        {content?.error ? <p className="notice">{content.error}</p> : null}
        {uploaded.length === 0 && textOnly.length === 0 ? (
          <p className="results-empty">{debouncedQuery ? `No uploaded documents match "${debouncedQuery}".` : 'No uploaded documents yet.'}</p>
        ) : (
          <ul className="result-list" aria-label="Uploaded documents">
            {uploaded.map((record) => (
              <UploadedResultRow
                key={record.id}
                record={record}
                location={resolveLocation(record)}
                snippet={snippets.get(record.id)}
                onOpen={() => onOpenDocument(record)}
              />
            ))}
            {textOnly.map((record) => (
              <UploadedResultRow
                key={record.id}
                record={record}
                location={resolveLocation(record)}
                snippet={snippets.get(record.id)}
                foundInText
                onOpen={() => onOpenDocument(record)}
              />
            ))}
          </ul>
        )}
        {content && content.items.length < content.total ? (
          <button type="button" className="secondary-button load-more" onClick={loadMoreContent} disabled={loadingMoreContent}>
            {loadingMoreContent ? 'Loading...' : 'Search further inside documents'}
          </button>
        ) : null}
      </section>
    )

  return (
    <section className="page desktop-page">
      <PageHeader
        title="Desktop Files"
        description="Find files and folders that are already on this computer, see exactly where they are and open them. Nothing is uploaded."
        actions={
          ready ? (
            <button type="button" className="secondary-button" onClick={() => setShowFolders((open) => !open)} aria-expanded={showFolders}>
              <FolderOpen aria-hidden="true" />
              <span>Indexed folders ({roots.length})</span>
            </button>
          ) : null
        }
      />

      <div className="segmented-control desktop-source" role="radiogroup" aria-label="Where to search">
        {sourceOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={source === option.value}
            className={source === option.value ? 'is-active' : ''}
            onClick={() => setSource(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {ready && status && (showFolders || noRoots) ? (
        <IndexedFolders
          status={status}
          version={version}
          onChanged={() => {
            setShowFolders(true)
            void refresh()
          }}
          onDisconnected={() => void refresh()}
          onSearchRoot={(root) => {
            setFilters((previous) => ({ ...previous, root: String(root.id), within: null }))
            setShowFolders(false)
          }}
        />
      ) : null}

      <div className="desktop-search">
        <label className="search-box desktop-search__box">
          <Search aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={source === 'uploaded' ? 'Search uploaded documents' : 'Search file and folder names, e.g. "annual report"'}
            aria-label="Search files and folders"
            autoFocus
          />
        </label>

        {wantsLocal && ready && !noRoots ? (
          <div className="desktop-filters">
            <select value={filters.type} onChange={(event) => setFilter('type', event.target.value)} aria-label="Type">
              {typeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={filters.root}
              onChange={(event) => setFilters((previous) => ({ ...previous, root: event.target.value, within: null }))}
              aria-label="Location"
            >
              <option value="">All indexed folders</option>
              {roots.map((root) => (
                <option key={root.id} value={root.id}>
                  {root.path}
                </option>
              ))}
            </select>
            <select value={filters.modified} onChange={(event) => setFilter('modified', event.target.value)} aria-label="Modified">
              {modifiedOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select value={filters.size} onChange={(event) => setFilter('size', event.target.value)} aria-label="Size">
              {sizeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={filters.sort}
              onChange={(event) => setFilter('sort', event.target.value as Filters['sort'])}
              aria-label="Sort by"
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {filtersActive ? (
              <button type="button" className="text-button" onClick={() => setFilters(emptyFilters)}>
                Clear filters
              </button>
            ) : null}
          </div>
        ) : null}

        {filters.within ? (
          <p className="desktop-within">
            <span>
              Searching inside <strong className="break-anywhere">{filters.within}</strong>
            </span>
            <button type="button" className="icon-button" onClick={() => setFilter('within', null)} aria-label="Search everywhere again">
              <X aria-hidden="true" />
            </button>
          </p>
        ) : null}
      </div>

      {toast ? (
        <p className={`notice${toast.tone === 'error' ? ' notice--error' : ''} desktop-toast`} role={toast.tone === 'error' ? 'alert' : 'status'}>
          <span>{toast.text}</span>
          <button type="button" className="icon-button" onClick={() => setToast(null)} aria-label="Dismiss">
            <X aria-hidden="true" />
          </button>
        </p>
      ) : null}

      {source === 'all' ? (
        <>
          {localSection}
          {uploadedSection}
        </>
      ) : (
        localSection ?? uploadedSection
      )}

      {preview ? (
        <LocalPreview
          key={preview.id}
          entry={preview}
          onClose={() => setPreview(null)}
          onOpen={(entry) => void act(entry, 'open')}
          onReveal={(entry) => void act(entry, 'reveal')}
        />
      ) : null}
    </section>
  )
}

interface LocalResultRowProps {
  entry: LocalEntry
  onOpen: () => void
  onReveal: () => void
  onPreview: () => void
  onSearchInside: () => void
  onCopyPath: () => void
}

function LocalResultRow({ entry, onOpen, onReveal, onPreview, onSearchInside, onCopyPath }: LocalResultRowProps) {
  const unavailable = entry.availability !== 'available'
  const iconKind: DocumentKind = iconKinds.has(entry.kind as DocumentKind) ? (entry.kind as DocumentKind) : 'other'
  const primary = entry.isFolder ? onSearchInside : entry.canPreview ? onPreview : entry.canOpen ? onOpen : onReveal

  return (
    <li className={`result-row${unavailable ? ' is-unavailable' : ''}`}>
      <DocumentIcon kind={iconKind} />
      <div className="result-row__text">
        <button type="button" className="result-row__name" onClick={primary} disabled={unavailable} title={entry.name}>
          {entry.name}
        </button>
        <span className="result-row__path" title={entry.path}>
          <span className="source-badge source-badge--local">This computer</span>
          <span className="result-row__full-path">{entry.path}</span>
        </span>
        <span className="result-row__meta">
          <span>{entry.isFolder ? 'Folder' : `${kindLabels[entry.kind]}${entry.extension ? ` (.${entry.extension})` : ''}`}</span>
          {!entry.isFolder ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{formatFileSize(entry.size)}</span>
            </>
          ) : null}
          {entry.modifiedAt ? (
            <>
              <span aria-hidden="true">·</span>
              <span>Modified {dateFormat.format(entry.modifiedAt)}</span>
            </>
          ) : null}
          {unavailable ? <span className="chip chip--danger">{availabilityLabels[entry.availability as keyof typeof availabilityLabels]}</span> : null}
          {entry.readOnly ? <span className="chip">Read-only</span> : null}
        </span>
      </div>
      <div className="result-row__actions">
        {entry.isFolder ? (
          <button type="button" className="secondary-button button--small" onClick={onSearchInside} disabled={unavailable}>
            <FolderSearch aria-hidden="true" />
            <span>Search inside</span>
          </button>
        ) : entry.canPreview ? (
          <button type="button" className="secondary-button button--small" onClick={onPreview} disabled={unavailable}>
            <Eye aria-hidden="true" />
            <span>Preview</span>
          </button>
        ) : null}
        {entry.canOpen ? (
          <button type="button" className="secondary-button button--small" onClick={onOpen} disabled={unavailable} title="Open with the default program">
            <ExternalLink aria-hidden="true" />
            <span>Open</span>
          </button>
        ) : (
          <span className="chip" title="Programs, scripts and shortcuts are never started from Document Vault">
            Not opened from here
          </span>
        )}
        <button type="button" className="icon-button" onClick={onReveal} disabled={entry.availability === 'missing' || entry.availability === 'offline'} aria-label={`Show ${entry.name} in File Explorer`} title="Show in folder">
          <FolderOpen aria-hidden="true" />
        </button>
        <button type="button" className="icon-button" onClick={onCopyPath} aria-label={`Copy the path of ${entry.name}`} title="Copy path">
          <Copy aria-hidden="true" />
        </button>
      </div>
    </li>
  )
}

interface UploadedResultRowProps {
  record: VaultDocument
  location: string
  snippet?: string
  foundInText?: boolean
  onOpen: () => void
}

function UploadedResultRow({ record, location, snippet, foundInText = false, onOpen }: UploadedResultRowProps) {
  const isFolder = record.fileType === 'folder'
  return (
    <li className="result-row">
      <DocumentIcon kind={record.fileType} />
      <div className="result-row__text">
        <button type="button" className="result-row__name" onClick={onOpen}>
          {record.name}
        </button>
        <span className="result-row__path">
          <span className="source-badge source-badge--vault">Uploaded</span>
          {location}
        </span>
        <span className="result-row__meta">
          {isFolder ? 'Folder' : formatFileSize(record.fileSize)}
          <span aria-hidden="true">·</span>
          {dateFormat.format(record.updatedAt.toDate())}
          {foundInText ? <span className="chip">Found in the text</span> : null}
          {record.driveMissing ? (
            <span className="chip chip--danger" title="Google Drive no longer has this file. The record is kept so you can see what was there.">
              Missing from Drive
            </span>
          ) : null}
        </span>
        {snippet ? (
          <p className="result-row__snippet">
            {snippetParts(snippet).map((part, index) => (part.hit ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>))}
          </p>
        ) : null}
      </div>
      <div className="result-row__actions">
        {!isFolder ? (
          <button type="button" className="secondary-button button--small" onClick={onOpen} disabled={record.driveMissing}>
            <Eye aria-hidden="true" />
            <span>View</span>
          </button>
        ) : null}
      </div>
    </li>
  )
}
