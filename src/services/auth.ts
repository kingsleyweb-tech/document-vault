import type { VaultUser } from '../types/user'

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: GoogleTokenClientConfig) => GoogleTokenClient
        }
      }
    }
  }
}

interface GoogleTokenClientConfig {
  client_id: string
  scope: string
  prompt?: string
  callback: (response: GoogleTokenResponse) => void
  error_callback?: (error: unknown) => void
}

interface GoogleTokenClient {
  requestAccessToken: (options?: { prompt?: string }) => void
}

interface GoogleTokenResponse {
  access_token?: string
  error?: string
  error_description?: string
}

interface GoogleUserInfo {
  sub: string
  name?: string
  email?: string
  picture?: string
}

const driveScope = 'https://www.googleapis.com/auth/drive.file'
const profileScope = 'openid profile email'
const googleScriptUrl = 'https://accounts.google.com/gsi/client'
const tokenStorageKey = 'documentVault.googleDriveAccessToken'
const userStorageKey = 'documentVault.googleUser'
const authChangedEvent = 'documentVault.authChanged'

let googleScriptPromise: Promise<void> | null = null

export async function signInWithGoogle() {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID

  if (!clientId) {
    throw new Error('Missing VITE_GOOGLE_CLIENT_ID. Add a Google OAuth web client ID in Vercel and redeploy.')
  }

  await loadGoogleIdentityServices()

  const tokenResponse = await requestGoogleAccessToken(clientId)
  const accessToken = tokenResponse.access_token

  if (!accessToken) {
    throw new Error(tokenResponse.error_description ?? tokenResponse.error ?? 'Google did not return an access token.')
  }

  sessionStorage.setItem(tokenStorageKey, accessToken)

  const user = await fetchGoogleUser(accessToken)
  localStorage.setItem(userStorageKey, JSON.stringify(user))
  notifyAuthChanged()

  return user
}

export function observeAuth(callback: (user: VaultUser | null) => void) {
  const handleAuthChanged = () => callback(getStoredUser())
  const handleStorageChanged = (event: StorageEvent) => {
    if (event.key === userStorageKey) {
      handleAuthChanged()
    }
  }

  handleAuthChanged()
  window.addEventListener(authChangedEvent, handleAuthChanged)
  window.addEventListener('storage', handleStorageChanged)

  return () => {
    window.removeEventListener(authChangedEvent, handleAuthChanged)
    window.removeEventListener('storage', handleStorageChanged)
  }
}

export function getDriveAccessToken() {
  return sessionStorage.getItem(tokenStorageKey)
}

export async function reconnectGoogleDrive() {
  await signInWithGoogle()
  const token = getDriveAccessToken()
  if (!token) {
    throw new Error('Google Drive authorization was not granted.')
  }
  return token
}

export async function logout() {
  sessionStorage.removeItem(tokenStorageKey)
  localStorage.removeItem(userStorageKey)
  notifyAuthChanged()
}

function requestGoogleAccessToken(clientId: string) {
  return new Promise<GoogleTokenResponse>((resolve, reject) => {
    const client = window.google?.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: `${profileScope} ${driveScope}`,
      prompt: 'consent select_account',
      callback: resolve,
      error_callback: reject,
    })

    if (!client) {
      reject(new Error('Google login is not available. Refresh the page and try again.'))
      return
    }

    client.requestAccessToken()
  })
}

function loadGoogleIdentityServices() {
  if (window.google?.accounts.oauth2) {
    return Promise.resolve()
  }

  googleScriptPromise ??= new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${googleScriptUrl}"]`)

    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true })
      existingScript.addEventListener('error', () => reject(new Error('Unable to load Google login.')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = googleScriptUrl
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Unable to load Google login.'))
    document.head.appendChild(script)
  })

  return googleScriptPromise
}

async function fetchGoogleUser(accessToken: string): Promise<VaultUser> {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new Error('Google login succeeded, but the profile could not be loaded.')
  }

  const profile = (await response.json()) as GoogleUserInfo

  return {
    uid: profile.sub,
    displayName: profile.name ?? 'Vault user',
    email: profile.email ?? '',
    photoURL: profile.picture ?? '',
  }
}

function getStoredUser() {
  const storedUser = localStorage.getItem(userStorageKey)

  if (!storedUser) {
    return null
  }

  try {
    return JSON.parse(storedUser) as VaultUser
  } catch {
    localStorage.removeItem(userStorageKey)
    return null
  }
}

function notifyAuthChanged() {
  window.dispatchEvent(new Event(authChangedEvent))
}
