// Client for the Document Vault Companion, the local service that indexes
// folders on this computer (see companion/). The browser cannot read the
// disk itself; everything here goes through the companion's loopback API.
//
// The pairing token is stored per browser in localStorage. It only works
// against the companion on this computer, which checks the requesting
// website's origin as well.

export type LocalKind =
  | 'folder' | 'pdf' | 'word' | 'spreadsheet' | 'presentation' | 'image' | 'text' | 'html'
  | 'ebook' | 'audio' | 'video' | 'archive' | 'shortcut' | 'program' | 'other'

export type LocalAvailability = 'available' | 'missing' | 'offline' | 'denied'

export interface LocalEntry {
  id: number
  rootId: number
  name: string
  path: string
  folder: string
  kind: LocalKind
  extension: string
  isFolder: boolean
  size: number
  modifiedAt: number | null
  readOnly: boolean
  hidden: boolean
  availability: LocalAvailability
  canOpen: boolean
  canPreview: boolean
}

export type LibraryState = 'active' | 'paused' | 'revoked'

export interface LibrarySettings {
  recursive: boolean
  /** Folder levels below the library folder that are indexed; null means all. */
  maxDepth: number | null
  /** File types indexed; null means every type. */
  fileTypes: LocalKind[] | null
  /** Whether the text inside documents is read for full-text search. */
  extractText: boolean
  /** Whether the words on scanned pages are recognised (OCR). Present from companion 1.2. */
  ocr?: boolean
}

export interface LibraryExclusion {
  id: number
  path: string
  addedAt: number
}

export type TextState =
  | 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  | 'waiting_permission' | 'waiting_drive' | 'unsupported'

/** 'ask': not decided yet (offered once scanned pages are found). */
export type OcrPref = 'ask' | 'on' | 'off'
export type OcrState = 'none' | 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'changed'

export interface OcrProgress {
  entryId: number
  rootId: number
  name: string | null
  page: number | null
  done: number
  total: number | null
}

/** Text recognition of a library's scanned pages. */
export interface LibraryOcr {
  pref: OcrPref
  /** Documents with pages that have no text layer (scans). */
  scannedDocs: number
  scannedPages: number
  recognisedPages: number
  pending: number
  completed: number
  failed: number
  states: Partial<Record<OcrState, number>>
  current: OcrProgress | null
}

export interface LocalRoot {
  id: number
  name: string
  path: string
  state: LibraryState
  status: 'pending' | 'indexing' | 'ready' | 'denied' | 'unavailable'
  error: string | null
  /** The system withdrew access to the folder; it must be granted again. */
  needsPermission: boolean
  addedAt: number
  lastScanAt: number | null
  lastScanMs: number | null
  lastSyncAt: number | null
  revokedAt: number | null
  files: number
  folders: number
  watching: boolean
  settings: LibrarySettings
  skippedByType: number
  exclusions: LibraryExclusion[]
  /** Documents per text-reading state. */
  extraction: Partial<Record<TextState, number>>
  /** Present from companion 1.2. */
  ocr?: LibraryOcr
  ai: 'off'
}

/** The library being walked. Counts only: how many entries a library holds is not known until it has been walked. */
export interface IndexProgress {
  rootId: number
  root: string
  /** Entries found so far. */
  scanned: number
  folder: string
  startedAt: number
  /** Present from companion 1.3. */
  phase?: 'discovering'
  /** The whole library is walked (not one changed folder). */
  full?: boolean
  folders?: number
  files?: number
  /** New or changed entries written to the index. */
  written?: number
  /** Folders found but not yet listed. */
  waiting?: number
  errors?: number
  elapsedMs?: number
}

export interface IndexStatus {
  state: 'idle' | 'indexing' | 'paused' | 'updating'
  current: IndexProgress | null
  queued: number[]
  watching: number[]
  totals: { files: number; folders: number }
  errors: Array<{ path: string | null; code: string; message: string; at: number }>
}

export interface TextStatus {
  /** 'waiting': held until the library being indexed has been walked (companion 1.3). */
  state: 'idle' | 'reading' | 'paused' | 'waiting'
  counts: Partial<Record<TextState, number>>
  current: Array<{ entryId: number; name: string }>
}

export interface OcrStatus {
  state: 'idle' | 'recognising' | 'paused'
  counts: Partial<Record<OcrState, number>>
  /** Scanned pages planned and recognised, across all libraries. */
  pages: number
  done: number
  current: OcrProgress | null
}

export interface CompanionStatus {
  version: string
  index: IndexStatus
  /** Present from companion 1.1. */
  text?: TextStatus
  /** Present from companion 1.2. */
  ocr?: OcrStatus
  roots: LocalRoot[]
  /** The index was damaged and rebuilt at the last start. */
  recovered?: boolean
  /** Space the index takes on this computer. Present from companion 1.3. */
  storage?: { indexBytes: number }
}

export type SearchMode = 'names' | 'documents' | 'fulltext' | 'all'
export type MatchType = 'title' | 'filename' | 'phrase' | 'text' | 'metadata' | 'name' | 'fuzzy'

export interface TextExcerpt {
  /** Page number, for formats that have pages (PDF). */
  page: number | null
  /** A chapter or slide title, where the format has one. */
  label: string | null
  /** Position of the passage in the document, counting from 1. */
  section: number
  /** The passage, with matching words between << and >>. */
  text: string
  /** 'ocr' when the words were recognised from a scan and may contain errors. Present from companion 1.2. */
  source?: 'text' | 'ocr'
  /** Average recognition confidence of the page (0-100), for recognised text. */
  confidence?: number
}

export type MetaField = 'title' | 'author' | 'subject' | 'keywords' | 'publisher'
export type DocumentMeta = Partial<Record<MetaField, { value: string; source: 'user' | 'original' | 'extracted' }>>

/**
 * Whether a result's text is searched: 'read', 'waiting' (not read yet, so only
 * its name is searched for now), 'failed', or 'names-only' (its type is not read).
 */
export type TextCoverage = 'read' | 'waiting' | 'failed' | 'names-only'

export interface LocalHit extends LocalEntry {
  /** Null for folders. Present from companion 1.3. */
  textCoverage?: TextCoverage | null
  match?: MatchType | null
  excerpt?: TextExcerpt | null
  matchingSections?: number
  meta?: DocumentMeta | null
  referencedBy?: { count: number; example: string } | null
  /** Identical copies of this file (same bytes) elsewhere in the libraries, shown once. Present from companion 1.2. */
  copies?: FileCopy[]
}

export interface FileCopy {
  entryId: number
  name: string
  folder: string
  libraryId: number
  libraryName: string
}

/** 'exact': identical files. 'text': the same words in files whose bytes differ. */
export type DuplicateKind = 'exact' | 'text'

export interface DuplicateSet {
  kind: DuplicateKind
  /** Identifies the group (a content hash); used to dismiss it. */
  key: string
  copies: Array<FileCopy & { size: number; mtime: number }>
  /** Space taken by every copy but the largest. */
  extraBytes: number
  sameName: boolean
  dismissedAt: number | null
}

export interface DuplicateSummary {
  exact: { groups: number; extraCopies: number; extraBytes: number }
  text: { groups: number; extraCopies: number; extraBytes: number }
  /** Files still being compared (those with the same size as another file). */
  checking: { state: 'idle' | 'checking' | 'paused'; pending: number }
}

export interface DocumentText {
  state: TextState
  error: string | null
  pages: number | null
  textPages: number | null
  needsOcr: boolean
  truncated: boolean
  role: 'catalog' | null
  extractedAt: number | null
  /** Text recognition of the scanned pages, when the document has any. Present from companion 1.2. */
  ocr?: {
    state: OcrState
    pages: number
    done: number
    failed: number
    confidence: number | null
    error: string | null
    at: number | null
  } | null
}

export interface LibraryEntryDetail extends LocalEntry {
  text: DocumentText | null
  meta: DocumentMeta | null
}

export type LinkStatus = 'verified' | 'unindexed' | 'broken' | 'outside' | 'external'

export interface LibraryLink {
  entryId: number
  name: string
  folder: string
  href: string
  label: string | null
  status: LinkStatus
  targetId: number | null
}

export interface PageLink {
  href: string
  label: string | null
  status: LinkStatus
  targetId: number | null
  targetName: string | null
  targetKind: LocalKind | null
}

export type TreeSort = 'name' | 'type' | 'modified' | 'size'

/** One level of a library's folder tree, a page at a time. */
export interface TreeLevel {
  parent: number | null
  folders: TreeFolder[]
  files: LocalEntry[]
  /** More subfolders or files follow this page. Present from companion 1.3. */
  moreFolders?: boolean
  moreFiles?: boolean
}

export interface TreeFolder extends LocalEntry {
  /** Documents anywhere inside this folder. */
  files: number
}

export interface HealthSummary {
  files: number
  folders: number
  inaccessible: number
  namesOnly: number
  needsOcr: number
  /** Present from companion 1.2. */
  ocrFailed?: number
  ocrLowConfidence?: number
  truncated: number
  duplicateGroups: number
  catalogs: number
  skippedByType: number
  text: Partial<Record<TextState, number>>
  links: Partial<Record<LinkStatus, number>>
  skipped: Record<string, number>
}

export type HealthSection =
  | 'inaccessible' | 'failed' | 'waiting' | 'needs-ocr' | 'ocr-failed' | 'ocr-low-confidence' | 'truncated' | 'names-only' | 'skipped'
  | 'broken-links' | 'outside-links' | 'unindexed-links' | 'duplicates'

export interface HealthItem {
  entryId: number | null
  name: string
  folder: string
  detail?: string | null
  reason?: string
  state?: TextState
  href?: string
  label?: string | null
  status?: LinkStatus
}

export interface DuplicateGroup {
  hash: string
  copies: Array<{ entryId: number; name: string; folder: string; size: number }>
}

export interface AccessEvent {
  at: number
  kind: string
  libraryId: number | null
  detail: string | null
}

export interface AccessOverview {
  libraries: LocalRoot[]
  ai: { enabled: false; provider: null; note: string }
  events: AccessEvent[]
  recovered: boolean
}

export interface PickedFolder {
  path: string
  suggestedName: string
  /** Why this folder cannot be a library, if it cannot. */
  problem: string | null
  existingId: number | null
}

export interface NewLibrary extends Partial<LibrarySettings> {
  path: string
  name?: string
}

export interface LocalSearchParams {
  q: string
  /** names (default) searches names only; the others need companion 1.1. */
  mode?: SearchMode
  roots?: number[]
  author?: string | null
  kind?: LocalKind[]
  type?: 'file' | 'folder' | null
  root?: number | null
  within?: string | null
  minSize?: number | null
  maxSize?: number | null
  modifiedAfter?: number | null
  modifiedBefore?: number | null
  sort?: 'relevance' | 'name' | 'modified' | 'size'
  limit?: number
  offset?: number
}

export interface LocalSearchResult {
  items: LocalHit[]
  total: number
  totalCapped: boolean
  fuzzy: boolean
  tookMs: number
}

export type CompanionProblem = 'offline' | 'unpaired' | 'forbidden' | 'gone' | 'failed'

export class CompanionError extends Error {
  readonly status: number
  readonly problem: CompanionProblem

  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.problem = status === 0 ? 'offline' : status === 401 ? 'unpaired' : status === 403 ? 'forbidden' : status === 404 || status === 410 ? 'gone' : 'failed'
  }
}

const URL_KEY = 'documentVault.companion.url'
const TOKEN_KEY = 'documentVault.companion.token'
export const DEFAULT_COMPANION_URL = 'http://127.0.0.1:47615'

function readSetting(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeSetting(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Storage can be unavailable (private windows); pairing then lasts for this page only.
  }
}

let memoryToken: string | null = null

/** What the desktop app's preload script exposes (see desktop/src/preload.cjs). */
export interface DesktopBridge {
  isDesktop: true
  version: string
  platform: string
  companionPort: number | null
  requestPairingCode: () => Promise<string | null>
  checkForUpdates: () => Promise<void>
  /** Google sign-in in the user's browser (added in 1.0.1). */
  signInWithGoogle?: (options: { mode: 'login' | 'reauthorize'; hint?: string }) => Promise<DesktopSignInResult>
  cancelGoogleSignIn?: () => Promise<void>
}

export type DesktopSignInResult =
  | { ok: true; idToken: string; accessToken: string }
  | { ok: false; cancelled: boolean; message: string }

export function desktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null
  const bridge = (window as Window & { documentVaultDesktop?: DesktopBridge }).documentVaultDesktop
  return bridge?.isDesktop ? bridge : null
}

export function companionUrl() {
  // Inside the desktop app the companion runs in the same program, on the port it reports.
  const port = desktopBridge()?.companionPort
  if (port) return `http://127.0.0.1:${port}`
  return readSetting(URL_KEY) || DEFAULT_COMPANION_URL
}

export function hasPairing() {
  return Boolean(memoryToken ?? readSetting(TOKEN_KEY))
}

export function forgetPairing() {
  memoryToken = null
  writeSetting(TOKEN_KEY, null)
}

async function call<T>(method: string, route: string, { body, signal, raw = false }: { body?: unknown; signal?: AbortSignal; raw?: boolean } = {}): Promise<T> {
  const token = memoryToken ?? readSetting(TOKEN_KEY)
  let response: Response
  try {
    response = await fetch(companionUrl() + route, {
      method,
      signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    throw new CompanionError(0, 'The Document Vault Companion is not running on this computer.')
  }
  if (!response.ok) {
    let message = `The companion answered with an error (${response.status}).`
    try {
      message = ((await response.json()) as { error?: string }).error ?? message
    } catch {
      // Keep the generic message.
    }
    if (response.status === 401) forgetPairing()
    throw new CompanionError(response.status, message)
  }
  return (raw ? response.blob() : response.json()) as Promise<T>
}

export const companion = {
  hello: (signal?: AbortSignal) => call<{ name: string; version: string }>('GET', '/v1/hello', { signal }),

  async pair(code: string) {
    const { token } = await call<{ token: string }>('POST', '/v1/pair', { body: { code, label: navigator.userAgent.slice(0, 80) } })
    memoryToken = token
    writeSetting(TOKEN_KEY, token)
  },

  /** In the desktop app, pairs without asking the user for a code. Returns false elsewhere. */
  async autoPair() {
    const code = await desktopBridge()?.requestPairingCode()
    if (!code) return false
    await this.pair(code)
    return true
  },

  async unpair() {
    try {
      await call('POST', '/v1/unpair', { body: {} })
    } finally {
      forgetPairing()
    }
  },

  status: (signal?: AbortSignal) => call<CompanionStatus>('GET', '/v1/status', { signal }),
  access: (signal?: AbortSignal) => call<AccessOverview>('GET', '/v1/access', { signal }),
  addRoot: (path: string) => call<{ root: LocalRoot; alreadyIndexed?: boolean }>('POST', '/v1/roots', { body: { path } }),
  addLibrary: (library: NewLibrary) => call<{ root: LocalRoot; alreadyIndexed?: boolean; merged?: string[] }>('POST', '/v1/roots', { body: library }),
  pickRoot: () => call<{ root?: LocalRoot; cancelled?: boolean; alreadyIndexed?: boolean }>('POST', '/v1/roots/pick', { body: {} }),
  /** Shows the system folder picker and describes the choice without adding it. */
  pickFolder: () => call<PickedFolder | { cancelled: true }>('POST', '/v1/roots/pick', { body: { add: false } }),
  removeRoot: (id: number) => call<{ ok: true }>('DELETE', `/v1/roots/${id}`),
  updateLibrary: (id: number, changes: Partial<LibrarySettings> & { name?: string }) =>
    call<{ root: LocalRoot; rescanning: boolean }>('PATCH', `/v1/roots/${id}`, { body: changes }),
  pauseLibrary: (id: number) => call<{ root: LocalRoot }>('POST', `/v1/roots/${id}/pause`, { body: {} }),
  resumeLibrary: (id: number) => call<{ root: LocalRoot }>('POST', `/v1/roots/${id}/resume`, { body: {} }),
  revokeLibrary: (id: number) => call<{ root: LocalRoot }>('POST', `/v1/roots/${id}/revoke`, { body: {} }),
  /** Shows the system folder picker at the library's folder; only that folder is accepted. */
  reauthorizeLibrary: (id: number) => call<{ root?: LocalRoot; cancelled?: true }>('POST', `/v1/roots/${id}/reauthorize`, { body: {} }),
  /** The answer to "Recognise the text of the scanned books?": 'not-now' turns it off for the library. */
  decideOcr: (id: number, decision: 'on' | 'not-now') => call<{ root: LocalRoot }>('POST', `/v1/roots/${id}/ocr`, { body: { decision } }),
  purgeLibrary: (id: number) => call<{ root: LocalRoot }>('POST', `/v1/roots/${id}/purge`, { body: {} }),
  rescanLibrary: (id: number) => call<{ queued: true }>('POST', `/v1/roots/${id}/rescan`, { body: {} }),
  excludeFolder: (id: number, folder: { entryId: number } | { path: string }) =>
    call<{ root: LocalRoot }>('POST', `/v1/roots/${id}/exclusions`, { body: folder }),
  removeExclusion: (id: number, exclusionId: number) => call<{ root: LocalRoot }>('DELETE', `/v1/roots/${id}/exclusions/${exclusionId}`),
  tree: (id: number, parent: number | null, options: { sort?: TreeSort; offset?: number; signal?: AbortSignal } = {}) => {
    const params = new URLSearchParams()
    if (parent) params.set('parent', String(parent))
    if (options.sort && options.sort !== 'name') params.set('sort', options.sort)
    if (options.offset) params.set('offset', String(options.offset))
    const query = params.toString()
    return call<TreeLevel>('GET', `/v1/roots/${id}/tree${query ? `?${query}` : ''}`, { signal: options.signal })
  },
  health: (id: number, signal?: AbortSignal) => call<{ library: LocalRoot; summary: HealthSummary }>('GET', `/v1/roots/${id}/health`, { signal }),
  healthSection: <T extends HealthItem | DuplicateGroup = HealthItem>(id: number, section: HealthSection, signal?: AbortSignal) =>
    call<{ section: HealthSection; items: T[] }>('GET', `/v1/roots/${id}/health?section=${section}&limit=200`, { signal }),
  libraryLinks: (id: number, status: LinkStatus, signal?: AbortSignal) =>
    call<{ status: LinkStatus; items: LibraryLink[] }>('GET', `/v1/roots/${id}/references?status=${status}&limit=200`, { signal }),
  duplicates(params: { kind: DuplicateKind; library?: number | null; dismissed?: boolean }, signal?: AbortSignal) {
    const query = new URLSearchParams({ kind: params.kind, limit: '200' })
    if (params.library) query.set('library', String(params.library))
    if (params.dismissed) query.set('dismissed', '1')
    return call<{ kind: DuplicateKind; groups: DuplicateSet[] }>('GET', `/v1/duplicates?${query}`, { signal })
  },
  duplicateSummary: (signal?: AbortSignal) => call<DuplicateSummary>('GET', '/v1/duplicates/summary', { signal }),
  /** Marks a group as "not duplicates" (or shows it again). Only the index is changed, never a file. */
  dismissDuplicate: (kind: DuplicateKind, key: string, dismissed = true) =>
    call<{ ok: true }>('POST', '/v1/duplicates/dismiss', { body: { kind, key, dismissed } }),
  rescan: (rootId?: number) => call<{ queued: number[] }>('POST', '/v1/index/rescan', { body: rootId ? { rootId } : {} }),
  pause: () => call<IndexStatus>('POST', '/v1/index/pause', { body: {} }),
  /** Gives back space left by removed entries. Refused (409) while indexing or reading. */
  compactIndex: () => call<{ before: number; after: number; ms: number }>('POST', '/v1/storage/compact', { body: {} }),
  resume: () => call<IndexStatus>('POST', '/v1/index/resume', { body: {} }),

  search(params: LocalSearchParams, signal?: AbortSignal) {
    const query = new URLSearchParams({ q: params.q })
    if (params.kind?.length) query.set('kind', params.kind.join(','))
    if (params.roots?.length) query.set('roots', params.roots.join(','))
    const optional: Array<[string, string | number | null | undefined]> = [
      ['mode', params.mode],
      ['author', params.author],
      ['type', params.type],
      ['root', params.root],
      ['within', params.within],
      ['minSize', params.minSize],
      ['maxSize', params.maxSize],
      ['modifiedAfter', params.modifiedAfter],
      ['modifiedBefore', params.modifiedBefore],
      ['sort', params.sort],
      ['limit', params.limit],
      ['offset', params.offset],
    ]
    for (const [name, value] of optional) if (value !== null && value !== undefined && value !== '') query.set(name, String(value))
    return call<LocalSearchResult>('GET', `/v1/search?${query}`, { signal })
  },

  entry: (id: number, signal?: AbortSignal) => call<LibraryEntryDetail>('GET', `/v1/entries/${id}`, { signal }),
  matches: (id: number, q: string, signal?: AbortSignal) =>
    call<{ entryId: number; matches: TextExcerpt[] }>('GET', `/v1/entries/${id}/matches?q=${encodeURIComponent(q)}`, { signal }),
  references: (id: number, signal?: AbortSignal) => call<{ entryId: number; items: LibraryLink[] }>('GET', `/v1/entries/${id}/references`, { signal }),
  links: (id: number, signal?: AbortSignal) =>
    call<{ entryId: number; role: 'catalog' | null; items: PageLink[] }>('GET', `/v1/entries/${id}/links`, { signal }),
  /** Corrects metadata; null removes a correction. The file itself is not changed. */
  updateMetadata: (id: number, changes: Partial<Record<MetaField, string | null>>) =>
    call<{ meta: DocumentMeta | null }>('PATCH', `/v1/entries/${id}/metadata`, { body: changes }),
  readText: (id: number) => call<{ text: DocumentText | null }>('POST', `/v1/entries/${id}/extract`, { body: {} }),
  open: (id: number) => call<{ ok: true }>('POST', `/v1/entries/${id}/open`, { body: {} }),
  /** Where a shortcut points: a web address, or the indexed file or folder (null if not indexed). */
  shortcutTarget: (id: number) => call<{ url: string | null; entry: LocalEntry | null }>('GET', `/v1/entries/${id}/target`),
  reveal: (id: number) => call<{ ok: true }>('POST', `/v1/entries/${id}/reveal`, { body: {} }),
  content: (id: number, signal?: AbortSignal) => call<Blob>('GET', `/v1/entries/${id}/content`, { signal, raw: true }),
}
