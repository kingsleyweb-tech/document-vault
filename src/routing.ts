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
