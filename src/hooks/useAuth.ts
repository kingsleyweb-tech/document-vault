import { useEffect, useMemo, useState } from 'react'
import type { VaultUser } from '../types/user'
import { getDriveAccessToken, observeAuth, observeDriveAccessToken } from '../services/auth'

export function useAuth() {
  const [user, setUser] = useState<VaultUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [driveAccessToken, setDriveAccessToken] = useState(() => getDriveAccessToken())

  useEffect(() => {
    const unsubscribeAuth = observeAuth((nextUser) => {
      setUser(nextUser)
      setDriveAccessToken(getDriveAccessToken())
      setLoading(false)
    })

    const unsubscribeDriveToken = observeDriveAccessToken((nextAccessToken) => {
      setDriveAccessToken(nextAccessToken)
    })

    return () => {
      unsubscribeAuth()
      unsubscribeDriveToken()
    }
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
