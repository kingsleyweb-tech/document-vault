import { useEffect, useMemo, useState } from 'react'
import type { User } from 'firebase/auth'
import { getDriveAccessToken, observeAuth } from '../services/auth'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    return observeAuth((nextUser) => {
      setUser(nextUser)
      setLoading(false)
    })
  }, [])

  return useMemo(
    () => ({
      user,
      loading,
      driveAccessToken: getDriveAccessToken(),
      isAuthenticated: Boolean(user),
    }),
    [user, loading],
  )
}
