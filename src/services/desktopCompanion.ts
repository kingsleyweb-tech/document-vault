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

export interface LocalRoot {
  id: number
  path: string
  status: 'pending' | 'indexing' | 'ready' | 'unavailable'
  error: string | null
  addedAt: number
  lastScanAt: number | null
  lastScanMs: number | null
  files: number
  folders: number
  watching: boolean
}

export interface IndexStatus {
  state: 'idle' | 'indexing' | 'paused' | 'updating'
  current: { rootId: number; root: string; scanned: number; folder: string; startedAt: number } | null
  queued: number[]
  watching: number[]
  totals: { files: number; folders: number }
  errors: Array<{ path: string | null; code: string; message: string; at: number }>
}

export interface CompanionStatus {
  version: string
  index: IndexStatus
  roots: LocalRoot[]
}

export interface LocalSearchParams {
  q: string
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
  items: LocalEntry[]
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
  addRoot: (path: string) => call<{ root: LocalRoot; alreadyIndexed?: boolean }>('POST', '/v1/roots', { body: { path } }),
  pickRoot: () => call<{ root?: LocalRoot; cancelled?: boolean; alreadyIndexed?: boolean }>('POST', '/v1/roots/pick', { body: {} }),
  removeRoot: (id: number) => call<{ ok: true }>('DELETE', `/v1/roots/${id}`),
  rescan: (rootId?: number) => call<{ queued: number[] }>('POST', '/v1/index/rescan', { body: rootId ? { rootId } : {} }),
  pause: () => call<IndexStatus>('POST', '/v1/index/pause', { body: {} }),
  resume: () => call<IndexStatus>('POST', '/v1/index/resume', { body: {} }),

  search(params: LocalSearchParams, signal?: AbortSignal) {
    const query = new URLSearchParams({ q: params.q })
    if (params.kind?.length) query.set('kind', params.kind.join(','))
    const optional: Array<[string, string | number | null | undefined]> = [
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

  open: (id: number) => call<{ ok: true }>('POST', `/v1/entries/${id}/open`, { body: {} }),
  reveal: (id: number) => call<{ ok: true }>('POST', `/v1/entries/${id}/reveal`, { body: {} }),
  content: (id: number, signal?: AbortSignal) => call<Blob>('GET', `/v1/entries/${id}/content`, { signal, raw: true }),
}
