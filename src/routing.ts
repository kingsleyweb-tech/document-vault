// The public site and the workspace share one page. The path decides which of
// them loads: everything under /app is the workspace, the rest is the site.

export const WORKSPACE_BASE = '/app'

export function isWorkspacePath(pathname: string) {
  return pathname === WORKSPACE_BASE || pathname.startsWith(`${WORKSPACE_BASE}/`)
}

// Links from before the move used hash routes (/#/files). They now live under
// /app, apart from the sign-in page, which moved to /login.
export function legacyHashTarget(hash: string): string | null {
  if (!hash.startsWith('#/')) return null
  const path = hash.slice(1)
  if (path === '/login' || path.startsWith('/login?')) return path
  return path === '/' ? WORKSPACE_BASE : `${WORKSPACE_BASE}${path}`
}

// Where to go after signing in. Only a page inside the workspace on this site
// is accepted, so a crafted link cannot send someone elsewhere.
export function safeNextPath(next: string | null | undefined, origin: string) {
  if (!next) return WORKSPACE_BASE
  try {
    const url = new URL(next, origin)
    if (url.origin === origin && isWorkspacePath(url.pathname)) return `${url.pathname}${url.search}${url.hash}`
  } catch {
    // Not a usable address; fall back to the workspace home.
  }
  return WORKSPACE_BASE
}

export function signInPath(next?: string) {
  return next ? `/login?next=${encodeURIComponent(next)}` : '/login'
}

// The sign-in page opens only from the site's own Sign in, Get started and
// Open the web app buttons, never from a typed or pasted address; those go to
// the home page instead. Clicking one of those buttons leaves a short-lived
// note in this tab, which also lets the sign-in page survive a refresh.
const SIGN_IN_ENTRY_KEY = 'documentVault.signInEntry'
const SIGN_IN_ENTRY_LIFETIME_MS = 30 * 60 * 1000
// The workspace page a signed-out visitor asked for, so they land there after signing in.
const DESTINATION_KEY = 'documentVault.afterSignIn'

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function tabStorage(): KeyValueStore | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function allowSignInPage(storage = tabStorage(), now = Date.now()) {
  try {
    storage?.setItem(SIGN_IN_ENTRY_KEY, String(now))
  } catch {
    // Storage blocked: the visitor is sent to the home page and can try again.
  }
}

export function canShowSignInPage(storage = tabStorage(), now = Date.now()) {
  try {
    const since = Number(storage?.getItem(SIGN_IN_ENTRY_KEY))
    return Number.isFinite(since) && since > 0 && now - since >= 0 && now - since < SIGN_IN_ENTRY_LIFETIME_MS
  } catch {
    return false
  }
}

export function rememberDestination(path: string, storage = tabStorage()) {
  try {
    storage?.setItem(DESTINATION_KEY, path)
  } catch {
    // Not remembered; the workspace home opens after sign-in instead.
  }
}

export function rememberedDestination(storage = tabStorage()) {
  try {
    return storage?.getItem(DESTINATION_KEY) ?? null
  } catch {
    return null
  }
}

/** Called once signed in: the notes have done their job. */
export function clearSignInNotes(storage = tabStorage()) {
  try {
    storage?.removeItem(SIGN_IN_ENTRY_KEY)
    storage?.removeItem(DESTINATION_KEY)
  } catch {
    // Nothing to clear.
  }
}

/** The desktop app has no home page of its own, so it always shows sign-in. */
export function isDesktopApp() {
  return typeof window !== 'undefined' && Boolean((window as { documentVaultDesktop?: { isDesktop?: boolean } }).documentVaultDesktop?.isDesktop)
}
