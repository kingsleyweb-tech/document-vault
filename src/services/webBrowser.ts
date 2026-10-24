// Client for the desktop app's in-app web browser (desktop/src/web-browser.cjs).
// The browser itself runs in the main process; this page only draws its
// toolbar, tells it where to show web pages and asks it to act. Websites never
// see this page, the library or the saved references.

export interface WebTabSource {
  name: string
  entryId: number | null
}

export interface WebTabError {
  code: number | string
  url: string | null
  title: string
  detail: string
}

export interface WebTab {
  id: number
  url: string | null
  title: string
  /** Showing the start page instead of a website. */
  start: boolean
  loading: boolean
  /** Still loading after a long time. */
  slow: boolean
  canGoBack: boolean
  canGoForward: boolean
  error: WebTabError | null
  /** The book the page was opened from. */
  source: WebTabSource | null
  /** Closed to save memory; it reloads when chosen. */
  sleeping: boolean
  unresponsive: boolean
}

export interface WebState {
  tabs: WebTab[]
  activeId: number | null
  maxTabs: number
}

export type WebNoticeKind = 'download' | 'blocked' | 'popup' | 'permission' | 'tabs'

export interface WebNotice {
  tabId: number | null
  kind: WebNoticeKind
  message: string
  url: string | null
  at: number
}

export type LinkCheckStatus = 'ok' | 'redirected' | 'broken' | 'problem' | 'unreachable' | 'blocked'

export interface LinkCheck {
  status: LinkCheckStatus
  code: number | null
  finalUrl: string
  detail: string | null
  checkedAt: number
}

export interface WebBookmark {
  id: string
  url: string
  title: string
  note: string
  folder: string
  source: WebTabSource | null
  createdAt: number
  updatedAt: number
  check: LinkCheck | null
  /** Another saved reference has the same address. */
  duplicate: boolean
}

export interface WebVisit {
  id: string
  url: string
  title: string
  visitedAt: number
}

export interface WebLibrary {
  folders: string[]
  bookmarks: WebBookmark[]
  history: WebVisit[]
}

type Reply<T> = { ok: true; value: T } | { ok: false; error: string }

interface WebBridge {
  request: (request: Record<string, unknown>) => Promise<Reply<unknown>>
  onState: (listener: (state: WebState) => void) => () => void
  onNotice: (listener: (notice: WebNotice) => void) => () => void
  onCheck: (listener: (update: { bookmarkId: string; result: LinkCheck }) => void) => () => void
}

function bridge(): WebBridge | null {
  if (typeof window === 'undefined') return null
  const desktop = (window as Window & { documentVaultDesktop?: { web?: WebBridge } }).documentVaultDesktop
  return desktop?.web ?? null
}

/** Whether this copy of the app has the in-app browser (the desktop app from 1.2). */
export function hasWebBrowser() {
  return bridge() !== null
}

async function call<T>(request: Record<string, unknown>): Promise<T> {
  const web = bridge()
  if (!web) throw new Error('The web browser is part of the Document Vault desktop app.')
  const reply = (await web.request(request)) as Reply<T>
  if (!reply.ok) throw new Error(reply.error)
  return reply.value
}

/** Turns { error } results from the browser into thrown errors. */
async function act(request: Record<string, unknown>) {
  const result = await call<{ ok?: true; error?: string; tabId?: number } | undefined>(request)
  if (result && 'error' in result && result.error) throw new Error(result.error)
  return result
}

export const webBrowser = {
  state: () => call<WebState>({ action: 'state' }),
  open: (url: string, options: { source?: WebTabSource | null; newTab?: boolean } = {}) =>
    act({ action: 'open', url, newTab: Boolean(options.newTab), source: options.source ?? null }),
  navigate: (tabId: number, input: string) => act({ action: 'navigate', tabId, input }),
  command: (tabId: number, name: 'back' | 'forward' | 'reload' | 'stop' | 'home') => act({ action: 'command', tabId, name }),
  newTab: () => act({ action: 'new-tab' }),
  activate: (tabId: number) => act({ action: 'activate', tabId }),
  closeTab: (tabId: number) => act({ action: 'close-tab', tabId }),
  /** Where web pages are shown, in this page's CSS pixels; null hides them. */
  setHost: (hostId: string, bounds: { x: number; y: number; width: number; height: number } | null) => call<void>({ action: 'host', hostId, bounds }),
  openExternal: (url: string) => call<void>({ action: 'open-external', url }),
  copy: (url: string) => call<boolean>({ action: 'copy', url }),
  email: (url: string, title: string) => call<boolean>({ action: 'email', url, title }),

  library: () => call<WebLibrary>({ action: 'library' }),
  saveBookmark: (input: { url: string; title?: string; note?: string; folder?: string; source?: WebTabSource | null }) =>
    call<{ bookmark: WebBookmark; existed: boolean }>({ action: 'save-bookmark', ...input }),
  updateBookmark: (bookmarkId: string, changes: Partial<Pick<WebBookmark, 'url' | 'title' | 'note' | 'folder'>>) =>
    call<WebBookmark>({ action: 'update-bookmark', bookmarkId, ...changes }),
  removeBookmark: (bookmarkId: string) => call<void>({ action: 'remove-bookmark', bookmarkId }),
  addFolder: (name: string) => call<string>({ action: 'add-folder', name }),
  renameFolder: (from: string, to: string) => call<void>({ action: 'rename-folder', from, to }),
  removeFolder: (name: string) => call<void>({ action: 'remove-folder', name }),
  removeVisit: (visitId: string) => call<void>({ action: 'remove-visit', visitId }),
  clearHistory: () => call<void>({ action: 'clear-history' }),
  clearBrowsingData: () => call<void>({ action: 'clear-browsing-data' }),
  /** Checks saved references for broken links; null checks all of them. */
  checkLinks: (bookmarkIds: string[] | null) => call<{ checked: number }>({ action: 'check-links', bookmarkIds }),

  onState: (listener: (state: WebState) => void) => bridge()?.onState(listener) ?? (() => {}),
  onNotice: (listener: (notice: WebNotice) => void) => bridge()?.onNotice(listener) ?? (() => {}),
  onCheck: (listener: (update: { bookmarkId: string; result: LinkCheck }) => void) => bridge()?.onCheck(listener) ?? (() => {}),
}

/** A web address for display: host and path, without the scheme. */
export function displayUrl(url: string | null) {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}

export function hostOf(url: string | null) {
  if (!url) return ''
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/** Whether a link in a document is a web page the browser may be offered (the main process checks again). */
export function isWebLink(href: string) {
  try {
    const url = new URL(href)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
  } catch {
    return false
  }
}

export const LINK_CHECK_LABELS: Record<LinkCheckStatus, string> = {
  ok: 'Link works',
  redirected: 'Link works (moved)',
  broken: 'Broken link',
  problem: 'Site reported a problem',
  unreachable: 'Could not be reached',
  blocked: 'Redirects somewhere not allowed',
}
