import { useEffect, useMemo, useState } from 'react'
import type { VaultUser } from '../types/user'
import { getDriveAccessToken, observeAuth } from '../services/auth'

export function useAuth() {
  const [user, setUser] = useState<VaultUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [driveAccessToken, setDriveAccessToken] = useState(() => getDriveAccessToken())

  useEffect(() => {
    return observeAuth((nextUser) => {
      setUser(nextUser)
      setDriveAccessToken(getDriveAccessToken())
      setLoading(false)
    })
  }, [])

  return useMemo(
    () => ({
      user,
      loading,
      driveAccessToken,
      isAuthenticated: Boolean(user),
    }),
    [user, loading, driveAccessToken],
  )
}
