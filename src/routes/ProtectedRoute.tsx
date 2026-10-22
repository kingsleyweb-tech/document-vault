import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { canShowSignInPage, isDesktopApp, rememberDestination, signInPath } from '../routing'

export function ProtectedRoute() {
  const { isAuthenticated, loading } = useAuth()
  const signedOut = !loading && !isAuthenticated

  // Signed-out visitors never see the workspace. A typed or bookmarked address
  // goes to the home page, where they choose Sign in or Get started; after
  // clicking Open the web app (or in the desktop app) they go straight to
  // sign-in. Either way the page they asked for opens after signing in. The
  // site and the workspace are separate parts of the site, so this is a full
  // page change.
  useEffect(() => {
    if (!signedOut) return
    const { pathname, search, hash } = window.location
    const destination = `${pathname}${search}${hash}`
    rememberDestination(destination)
    window.location.replace(isDesktopApp() || canShowSignInPage() ? signInPath(destination) : '/')
  }, [signedOut])

  if (loading || signedOut) {
    return <div className="route-loader">{signedOut ? 'Redirecting...' : 'Loading your vault...'}</div>
  }

  return <Outlet />
}
