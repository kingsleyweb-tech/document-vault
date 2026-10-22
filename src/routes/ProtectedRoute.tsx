import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { signInPath } from '../routing'

export function ProtectedRoute() {
  const { isAuthenticated, loading } = useAuth()
  const signedOut = !loading && !isAuthenticated

  // Sign-in is on the public site, outside the workspace router, so this is a
  // full page change. The page the visitor asked for comes back after sign-in.
  useEffect(() => {
    if (!signedOut) return
    const { pathname, search, hash } = window.location
    window.location.replace(signInPath(`${pathname}${search}${hash}`))
  }, [signedOut])

  if (loading || signedOut) {
    return <div className="route-loader">{signedOut ? 'Redirecting to sign in...' : 'Loading your vault...'}</div>
  }

  return <Outlet />
}
