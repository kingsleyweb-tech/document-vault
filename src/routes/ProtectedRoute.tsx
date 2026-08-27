import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export function ProtectedRoute() {
  const { isAuthenticated, loading } = useAuth()

  if (loading) {
    return <div className="route-loader">Loading your vault...</div>
  }

  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />
}
