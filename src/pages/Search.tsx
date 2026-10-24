import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BookOpen, Copy, ExternalLink, Eye, FileSearch, FolderOpen, FolderSearch, Library, Search as SearchIcon, X } from 'lucide-react'
import { CompanionSetup } from '../components/desktop/CompanionSetup'
import { LocalPreview } from '../components/desktop/LocalPreview'
import { DocumentIcon } from '../components/documents/DocumentIcon'
import { Highlighted } from '../components/library/Highlighted'
import { errorText, kindLabels, matchLabels, OCR_NOTE, whereLabel } from '../components/library/libraryText'
import { EmptyState } from '../components/ui/EmptyState'
import { PageHeader } from '../components/ui/PageHeader'
import { useCompanion } from '../hooks/useCompanion'
import { mergeUploadedMatches, SOURCE_LABELS } from '../services/combinedSearch'
import { searchDocumentContent, snippetParts, type ContentMatch } from '../services/contentIndex'
import {
  companion,
  CompanionError,
  type FileCopy,
  type LocalHit,
  type LocalKind,
  type LocalSearchParams,
  type LocalSearchResult,
  type SearchMode,
} from '../services/desktopCompanion'
import type { DocumentKind, VaultDocument } from '../types/document'
import { formatFileSize } from '../utils/formatters'
import { matchesSearch } from '../utils/sorting'
import { locationResolver } from '../utils/trash'

type Source = 'local' | 'uploaded' | 'all'

interface SearchPageProps {
  documents: VaultDocument[]
  allDocuments: VaultDocument[]
  search: string
  onOpenDocument: (document: VaultDocument) => void
}

const PAGE_SIZE = 50
const UPLOADED_LIMIT = 100
const CONTENT_PAGE = 30
const DEBOUNCE_MS = 200
const DAY = 24 * 60 * 60 * 1000

const sourceOptions: Array<{ value: Source; label: string }> = [
  { value: 'local', label: SOURCE_LABELS.local },
  { value: 'uploaded', label: SOURCE_LABELS.vault },
  { value: 'all', label: 'Both' },
]

const modeOptions: Array<{ value: SearchMode; label: string; hint: string }> = [
  { value: 'all', label: 'Everything', hint: 'Titles, names, authors and the text inside documents' },
  { value: 'documents', label: 'Titles and names', hint: 'Titles, file names, authors and subjects' },
  { value: 'fulltext', label: 'Full text', hint: 'Only the text inside documents' },
]

const typeOptions: Array<{ value: string; label: string }> = [
  { value: '', label: 'Files and folders' },
  { value: 'files', label: 'Files only' },
  { value: 'folder', label: 'Folders only' },
  { value: 'pdf', label: 'PDF' },
  { value: 'word', label: 'Word documents' },
  { value: 'ebook', label: 'eBooks' },
  { value: 'html', label: 'Web pages' },
  { value: 'presentation', label: 'Presentations' },
  { value: 'spreadsheet', label: 'Spreadsheets' },
  { value: 'text', label: 'Text and data' },
  { value: 'image', label: 'Images' },
  { value: 'shortcut', label: 'Shortcuts' },
  { value: 'other', label: 'Other files' },
]

const modifiedOptions = [
  { value: '', label: 'Any date' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '365', label: 'Last year' },
  { value: 'older', label: 'Older than a year' },
]

const sortOptions: Array<{ value: NonNullable<LocalSearchParams['sort']>; label: string }> = [
  { value: 'relevance', label: 'Best match' },
  { value: 'modified', label: 'Recently modified' },
  { value: 'name', label: 'Name' },
  { value: 'size', label: 'Largest first' },
]

// Local kinds that DocumentIcon has a tile for; the rest use the generic one.
const iconKinds = new Set<DocumentKind>(['pdf', 'image', 'word', 'spreadsheet', 'presentation', 'folder', 'html', 'text', 'ebook'])

const availabilityLabels = {
  missing: 'No longer at this location',
  offline: 'Drive not connected',
  denied: 'Access denied',
} as const

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

interface Filters {
  mode: SearchMode
  library: string
  type: string
  author: string
  within: string | null
  modified: string
  sort: NonNullable<LocalSearchParams['sort']>
}

const defaultFilters: Filters = { mode: 'all', library: '', type: '', author: '', within: null, modified: '', sort: 'relevance' }

function toParams(query: string, filters: Filters, offset: number): LocalSearchParams {
  const params: LocalSearchParams = { q: query, mode: filters.mode, sort: filters.sort, limit: PAGE_SIZE, offset }
  if (filters.type === 'files') params.type = 'file'
  else if (filters.type === 'folder') params.type = 'folder'
  else if (filters.type) params.kind = [filters.type as LocalKind]
  if (filters.library) params.roots = [Number(filters.library)]
  if (filters.author.trim()) params.author = filters.author.trim()
  if (filters.within) params.within = filters.within
  if (filters.modified === 'older') params.modifiedBefore = Date.now() - 365 * DAY
  else if (filters.modified) params.modifiedAfter = Date.now() - Number(filters.modified) * DAY
  return params
}

interface ContentResults {
  key: string
  items: ContentMatch[]
  total: number
  error: string | null
}

interface LocalResults extends Omit<LocalSearchResult, 'items'> {
  key: string
  items: LocalHit[]
  error: string | null
}

interface PreviewTarget {
  entry: LocalHit
  page: number | null
}

// Search across local libraries (titles, names, metadata and the text inside
// documents) and, optionally, documents uploaded to Document Vault. Every
// result says where it comes from and why it matched.
export function SearchPage({ documents, allDocuments, search, onOpenDocument }: SearchPageProps) {
  const { connection, status, refresh } = useCompanion()
  const [params] = useSearchParams()
  const [source, setSource] = useState<Source>('local')
  const [query, setQuery] = useState(() => params.get('q') ?? search)
  const [debouncedQuery, setDebouncedQuery] = useState(() => (params.get('q') ?? search).trim())
  const [filters, setFilters] = useState<Filters>(() => ({ ...defaultFilters, library: params.get('library') ?? '' }))
  const [results, setResults] = useState<LocalResults | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [preview, setPreview] = useState<PreviewTarget | null>(null)
  const [toast, setToast] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)
  const [contentResults, setContentResults] = useState<ContentResults | null>(null)
  const [loadingMoreContent, setLoadingMoreContent] = useState(false)
  const moreController = useRef<AbortController | null>(null)

  const wantsLocal = source !== 'uploaded'
  const ready = connection === 'ready'
  const searchKey = JSON.stringify([debouncedQuery, filters])
  const textRead = status?.text ? (status.text.counts.completed ?? 0) : 0
  const indexVersion = status ? `${status.index.totals.files}:${status.index.totals.folders}:${status.index.state}:${textRead}` : ''

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query])

  // Each new search cancels the one before it, so results never arrive out of order.
  useEffect(() => {
    if (!wantsLocal || !ready) return undefined
    const controller = new AbortController()
    companion.search(toParams(debouncedQuery, filters, 0), controller.signal).then(
      (result) => setResults({ key: searchKey, ...result, error: null }),
      (error: unknown) => {
        if (controller.signal.aborted) return
        setResults({ key: searchKey, items: [], total: 0, totalCapped: false, fuzzy: false, tookMs: 0, error: errorText(error, 'Search failed.') })
        if (error instanceof CompanionError && error.problem !== 'failed') void refresh()
      },
    )
    return () => {
      controller.abort()
      moreController.current?.abort()
    }
    // indexVersion re-runs the search when indexing adds, removes or reads documents.
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
          if (!controller.signal.aborted) setToast({ tone: 'error', text: errorText(error, 'Could not load more results.') })
        },
      )
      .finally(() => setLoadingMore(false))
  }

  const resolveLocation = useMemo(() => locationResolver(allDocuments), [allDocuments])
  const uploaded = useMemo(() => {
    if (source === 'local') return []
    return documents
      .filter((record) => matchesSearch(record, debouncedQuery) && (filters.type !== 'folder' || record.fileType === 'folder'))
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

  const { snippets, textOnly } = useMemo(() => mergeUploadedMatches(documents, uploaded, content?.items ?? []), [content, documents, uploaded])

  const act = async (entry: LocalHit, action: 'open' | 'reveal') => {
    setToast(null)
    try {
      await (action === 'open' ? companion.open(entry.id) : companion.reveal(entry.id))
      setToast({ tone: 'info', text: action === 'open' ? `Opening ${entry.name} on this computer.` : `Showing ${entry.name} in its folder.` })
    } catch (error) {
      setToast({ tone: 'error', text: errorText(error) })
      if (error instanceof CompanionError && error.problem === 'gone') {
        setResults((previous) => previous && { ...previous, items: previous.items.filter((item) => item.id !== entry.id), total: Math.max(0, previous.total - 1) })
      }
    }
  }

  const copyPath = async (entry: LocalHit) => {
    try {
      await navigator.clipboard.writeText(entry.path)
      setToast({ tone: 'info', text: 'Path copied.' })
    } catch {
      setToast({ tone: 'error', text: 'Copying is not allowed here. Select the path and copy it instead.' })
    }
  }

  const setFilter = <K extends keyof Filters>(name: K, value: Filters[K]) => setFilters((previous) => ({ ...previous, [name]: value }))
  const filtersActive = JSON.stringify({ ...filters, mode: 'all' }) !== JSON.stringify(defaultFilters)
  const libraries = (status?.roots ?? []).filter((root) => root.state !== 'revoked')
  const libraryNames = new Map(libraries.map((root) => [root.id, root.name]))
  const noLibraries = ready && libraries.length === 0

  const localSection = !wantsLocal ? null : connection !== 'ready' ? (
    <CompanionSetup connection={connection} onConnected={() => void refresh()} onRetry={() => void refresh()} />
  ) : noLibraries ? (
    <EmptyState
      icon={<Library aria-hidden="true" />}
      title="No libraries to search"
      message="Add the folder that holds your books as a library. Its names and the text inside its documents can then be searched here."
      action={
        <Link to="/libraries" className="primary-button">
          My Libraries
        </Link>
      }
    />
  ) : (
    <section className="local-results" aria-labelledby="local-results-title" aria-busy={searching}>
      <header className="results-heading">
        <h2 id="local-results-title">
          <BookOpen aria-hidden="true" />
          {debouncedQuery || filtersActive ? SOURCE_LABELS.local : 'Recently changed in your libraries'}
        </h2>
        <span className="results-heading__count" role="status">
          {searching ? (
            <>
              <span className="app-spinner app-spinner--small" aria-hidden="true" /> Searching...
            </>
          ) : local?.error ? null : local ? (
            `${local.totalCapped ? 'More than ' : ''}${local.total.toLocaleString()} ${local.total === 1 ? 'result' : 'results'}${local.fuzzy ? ' (similar names)' : ''} in ${local.tookMs} ms`
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
          title={debouncedQuery ? `Nothing in your libraries matches "${debouncedQuery}"` : 'Nothing indexed matches these filters'}
          message={
            filters.mode === 'fulltext'
              ? 'Only text already read is searched. Scanned PDFs are searched by their words only after their text is recognised (OCR), which you can turn on for each library; see Library Health.'
              : 'Check the spelling, try fewer words, or clear filters.'
          }
        />
      ) : null}
      {local && local.items.length > 0 ? (
        <ul className="result-list" aria-label="Results from your libraries">
          {local.items.map((entry) => (
            <LocalResultRow
              key={entry.id}
              entry={entry}
              libraryName={libraryNames.get(entry.rootId) ?? null}
              onOpen={() => void act(entry, 'open')}
              onReveal={() => void act(entry, 'reveal')}
              onRevealCopy={(copy) => void act({ ...entry, id: copy.entryId, name: copy.name }, 'reveal')}
              onPreview={(page) => setPreview({ entry, page })}
              onSearchInside={() => {
                setFilters((previous) => ({ ...previous, within: entry.path, library: '' }))
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
          <h2 id="uploaded-results-title">{SOURCE_LABELS.vault}</h2>
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
              <UploadedResultRow key={record.id} record={record} location={resolveLocation(record)} snippet={snippets.get(record.id)} onOpen={() => onOpenDocument(record)} />
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

  const showLocalFilters = wantsLocal && ready && !noLibraries

  return (
    <section className="page desktop-page search-page">
      <PageHeader
        title="Search"
        description="Search your libraries by title, author, file name or the words inside documents. Results show the page where the words were found."
        actions={
          <Link to="/libraries" className="secondary-button">
            <Library aria-hidden="true" />
            <span>My Libraries</span>
          </Link>
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

      <div className="desktop-search">
        <label className="search-box desktop-search__box">
          <SearchIcon aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={source === 'uploaded' ? 'Search uploaded documents' : 'Search titles, authors and text, e.g. "duty of care"'}
            aria-label="Search"
            autoFocus
          />
        </label>

        {showLocalFilters ? (
          <>
            <div className="search-modes" role="radiogroup" aria-label="What to search">
              {modeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={filters.mode === option.value}
                  className={filters.mode === option.value ? 'is-active' : ''}
                  onClick={() => setFilter('mode', option.value)}
                  title={option.hint}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="desktop-filters">
              <select value={filters.library} onChange={(event) => setFilters((previous) => ({ ...previous, library: event.target.value, within: null }))} aria-label="Library">
                <option value="">All libraries</option>
                {libraries.map((root) => (
                  <option key={root.id} value={root.id}>
                    {root.name}
                  </option>
                ))}
              </select>
              <select value={filters.type} onChange={(event) => setFilter('type', event.target.value)} aria-label="Type">
                {typeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                className="field-input search-author"
                value={filters.author}
                onChange={(event) => setFilter('author', event.target.value)}
                placeholder="Author"
                aria-label="Author"
              />
              <select value={filters.modified} onChange={(event) => setFilter('modified', event.target.value)} aria-label="Modified">
                {modifiedOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select value={filters.sort} onChange={(event) => setFilter('sort', event.target.value as Filters['sort'])} aria-label="Sort by">
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {filtersActive ? (
                <button type="button" className="text-button" onClick={() => setFilters((previous) => ({ ...defaultFilters, mode: previous.mode }))}>
                  Clear filters
                </button>
              ) : null}
            </div>
            <p className="search-syntax field-hint">
              Use quotes for an exact phrase ("reasonable person"), OR for either word, and a minus to leave a word out (-draft).
            </p>
          </>
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
          key={preview.entry.id}
          entry={preview.entry}
          query={filters.mode === 'documents' ? '' : debouncedQuery}
          initialPage={preview.page}
          onClose={() => setPreview(null)}
          onOpen={(entry) => void act(entry, 'open')}
          onReveal={(entry) => void act(entry, 'reveal')}
          onNavigate={(entry) => setPreview({ entry, page: null })}
        />
      ) : null}
    </section>
  )
}

interface LocalResultRowProps {
  entry: LocalHit
  libraryName: string | null
  onOpen: () => void
  onReveal: () => void
  onRevealCopy: (copy: FileCopy) => void
  onPreview: (page: number | null) => void
  onSearchInside: () => void
  onCopyPath: () => void
}

function LocalResultRow({ entry, libraryName, onOpen, onReveal, onRevealCopy, onPreview, onSearchInside, onCopyPath }: LocalResultRowProps) {
  const unavailable = entry.availability !== 'available'
  const iconKind: DocumentKind = iconKinds.has(entry.kind as DocumentKind) ? (entry.kind as DocumentKind) : 'other'
  const excerpt = entry.excerpt ?? null
  const page = excerpt?.page ?? null
  const primary = entry.isFolder ? onSearchInside : entry.canPreview ? () => onPreview(page) : entry.canOpen ? onOpen : onReveal
  const title = entry.meta?.title?.value
  const author = entry.meta?.author?.value
  const sections = entry.matchingSections ?? 0

  return (
    <li className={`result-row${unavailable ? ' is-unavailable' : ''}`}>
      <DocumentIcon kind={iconKind} />
      <div className="result-row__text">
        <button type="button" className="result-row__name" onClick={primary} disabled={unavailable} title={entry.name}>
          {title && title.toLowerCase() !== entry.name.toLowerCase().replace(/\.[^.]+$/, '') ? title : entry.name}
        </button>
        {title && title.toLowerCase() !== entry.name.toLowerCase().replace(/\.[^.]+$/, '') ? <span className="result-row__filename">{entry.name}</span> : null}
        <span className="result-row__path" title={entry.path}>
          <span className="source-badge source-badge--local">{SOURCE_LABELS.local}</span>
          {libraryName ? <span className="result-row__library">{libraryName}</span> : null}
          <span className="result-row__full-path">{entry.folder}</span>
        </span>
        <span className="result-row__meta">
          <span>{entry.isFolder ? 'Folder' : `${kindLabels[entry.kind]}${entry.extension ? ` (.${entry.extension})` : ''}`}</span>
          {author ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{author}</span>
            </>
          ) : null}
          {!entry.isFolder ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{formatFileSize(entry.size)}</span>
            </>
          ) : null}
          {entry.modifiedAt ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{dateFormat.format(entry.modifiedAt)}</span>
            </>
          ) : null}
          {entry.match ? <span className="chip chip--accent">{matchLabels[entry.match]}</span> : null}
          {excerpt?.source === 'ocr' ? <span className="chip">Recognised text (OCR)</span> : null}
          {unavailable ? <span className="chip chip--danger">{availabilityLabels[entry.availability as keyof typeof availabilityLabels]}</span> : null}
        </span>
        {excerpt ? (
          <p className="result-row__snippet">
            <span className="result-row__where">{whereLabel(excerpt)}</span>
            <Highlighted text={excerpt.text} />
            {sections > 1 ? <span className="result-row__more-matches"> Found in {sections.toLocaleString()} {page ? 'pages' : 'places'}.</span> : null}
            {excerpt.source === 'ocr' ? <span className="ocr-note"> {OCR_NOTE}</span> : null}
          </p>
        ) : null}
        {entry.referencedBy ? (
          <span className="result-row__reference">
            Referenced in {entry.referencedBy.example}
            {entry.referencedBy.count > 1 ? ` and ${entry.referencedBy.count - 1} more ${entry.referencedBy.count === 2 ? 'page' : 'pages'}` : ''}
          </span>
        ) : null}
        {entry.copies && entry.copies.length > 0 ? (
          <details className="result-row__copies">
            <summary>
              Identical copy also in {entry.copies.length === 1 ? '1 other place' : `${entry.copies.length} other places`}
            </summary>
            <ul>
              {entry.copies.map((copy) => (
                <li key={copy.entryId}>
                  <span className="break-anywhere">
                    {copy.libraryName} · {copy.folder}
                    {copy.name !== entry.name ? ` · ${copy.name}` : ''}
                  </span>
                  <button type="button" className="text-button" onClick={() => onRevealCopy(copy)}>
                    Show in folder
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      <div className="result-row__actions">
        {entry.isFolder ? (
          <button type="button" className="secondary-button button--small" onClick={onSearchInside} disabled={unavailable}>
            <FolderSearch aria-hidden="true" />
            <span>Search inside</span>
          </button>
        ) : entry.canPreview ? (
          <button type="button" className="secondary-button button--small" onClick={() => onPreview(page)} disabled={unavailable}>
            {page ? <FileSearch aria-hidden="true" /> : <Eye aria-hidden="true" />}
            <span>{page ? `Open at page ${page}` : 'Preview'}</span>
          </button>
        ) : null}
        {entry.canOpen ? (
          <button type="button" className="secondary-button button--small" onClick={onOpen} disabled={unavailable} title="Open with the default program">
            <ExternalLink aria-hidden="true" />
            <span>Open</span>
          </button>
        ) : (
          <span className="chip" title="Programs and scripts are never started from Document Vault">
            Not opened from here
          </span>
        )}
        <button
          type="button"
          className="icon-button"
          onClick={onReveal}
          disabled={entry.availability === 'missing' || entry.availability === 'offline'}
          aria-label={`Show ${entry.name} in its folder`}
          title="Show in folder"
        >
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
          <span className="source-badge source-badge--vault">{SOURCE_LABELS.vault}</span>
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
