import { useEffect, useMemo, useState } from 'react'
import type { User } from 'firebase/auth'
import { completeRedirectSignIn, getDriveAccessToken, observeAuth } from '../services/auth'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [driveAccessToken, setDriveAccessToken] = useState(() => getDriveAccessToken())

  useEffect(() => {
    void completeRedirectSignIn()
      .then(() => {
        setDriveAccessToken(getDriveAccessToken())
      })
      .catch((error) => {
        console.error('Failed to complete Google redirect sign-in.', error)
      })

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
