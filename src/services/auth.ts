import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut,
  type UserCredential,
} from 'firebase/auth'
import { FirebaseError } from 'firebase/app'
import { desktopBridge } from './desktopCompanion'
import { auth } from './firebase'
import { clearBlobCache, ensureVaultFolder } from './googleDrive'
import { clearOfflineStore } from './offlineStore'
import { clearUploadFileStore } from './uploadFileStore'
import { upsertUserProfile } from './users'
import type { VaultUser } from '../types/user'

const driveScope = 'https://www.googleapis.com/auth/drive.file'
const tokenStorageKey = 'documentVault.googleDriveAccessToken'
const tokenExpiryKey = 'documentVault.googleDriveAccessTokenExpiry'
const tokenChangedEvent = 'documentVault.googleDriveTokenChanged'
// Set while someone is signed in on this browser and removed by signing out.
// It holds no account details; it only lets the workspace tell a lost sign-in
// (storage briefly unreadable after the browser closed the page) from a real
// sign-out. See ProtectedRoute.
const signedInMarkerKey = 'documentVault.signedIn'
const signInRetryKey = 'documentVault.signInRetry'
const SIGN_IN_RETRY_WINDOW_MS = 60 * 1000

/**
 * Signs in with Google and returns the Firebase result with the Drive token.
 * Google refuses to sign in inside the desktop app's own window, so there the
 * app opens sign-in in the user's browser and signs in here with the tokens it
 * sends back. Everywhere else Google's pop-up is used.
 */
async function googleSignIn(mode: 'login' | 'reauthorize'): Promise<{ result: UserCredential; accessToken?: string }> {
  const bridge = desktopBridge()
  if (bridge?.signInWithGoogle) {
    const answer = await bridge.signInWithGoogle({ mode, hint: mode === 'reauthorize' ? (auth.currentUser?.email ?? '') : '' })
    if (!answer.ok) {
      // Same code as a closed pop-up, so callers show their usual "cancelled" message.
      if (answer.cancelled) throw new FirebaseError('auth/popup-closed-by-user', answer.message)
      throw new Error(answer.message)
    }
    const result = await signInWithCredential(auth, GoogleAuthProvider.credential(answer.idToken, answer.accessToken))
    return { result, accessToken: answer.accessToken }
  }
  const result = await signInWithPopup(auth, createGoogleProvider(mode))
  return { result, accessToken: GoogleAuthProvider.credentialFromResult(result)?.accessToken }
}

/** Inside the desktop app: stop waiting for a browser sign-in that was abandoned. */
export function cancelBrowserSignIn() {
  void desktopBridge()?.cancelGoogleSignIn?.()
}

/** True when Google sign-in opens in the user's browser rather than a pop-up. */
export function signsInThroughBrowser() {
  return Boolean(desktopBridge()?.signInWithGoogle)
}

export async function signInWithGoogle() {
  const { result, accessToken } = await googleSignIn('login')

  if (!accessToken) {
    throw new Error('Google sign-in succeeded, but Drive authorization was not granted.')
  }

  saveDriveAccessToken(accessToken)
  const user = toVaultUser(result.user)
  const vaultFolder = await ensureVaultFolder(accessToken)
  await upsertUserProfile(user, vaultFolder.id)
  notifyDriveTokenChanged()
  return { ...user, driveFolderId: vaultFolder.id, driveConnected: true }
}

export function observeAuth(callback: (user: VaultUser | null) => void) {
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      callback(null)
      return
    }

    const vaultUser = toVaultUser(user)
    try {
      localStorage.setItem(signedInMarkerKey, '1')
    } catch {
      // Without storage a lost sign-in simply shows the home page.
    }
    callback(vaultUser)
    void upsertUserProfile(vaultUser)
  })
}

export function getDriveAccessToken() {
  const token = localStorage.getItem(tokenStorageKey)
  const expiry = localStorage.getItem(tokenExpiryKey)
  if (!token) return null
  if (expiry && Date.now() >= Number(expiry)) {
    return null
  }
  return token
}

export function clearDriveAccessToken() {
  localStorage.removeItem(tokenStorageKey)
  localStorage.removeItem(tokenExpiryKey)
  notifyDriveTokenChanged()
}

export function observeDriveAccessToken(callback: (accessToken: string | null) => void) {
  const handleTokenChanged = () => callback(getDriveAccessToken())

  window.addEventListener(tokenChangedEvent, handleTokenChanged)
  window.addEventListener('storage', handleTokenChanged)

  return () => {
    window.removeEventListener(tokenChangedEvent, handleTokenChanged)
    window.removeEventListener('storage', handleTokenChanged)
  }
}

export async function reconnectGoogleDrive() {
  const { result, accessToken } = await googleSignIn('reauthorize')

  if (!accessToken) {
    throw new Error('Google Drive authorization was not granted.')
  }

  saveDriveAccessToken(accessToken)
  const user = toVaultUser(result.user)
  const vaultFolder = await ensureVaultFolder(accessToken)
  await upsertUserProfile(user, vaultFolder.id)
  notifyDriveTokenChanged()

  const token = getDriveAccessToken()
  if (!token) {
    throw new Error('Google Drive authorization was not granted.')
  }
  return token
}

// Per-document reading positions reveal which documents were opened, and the
// companion pairing token gives access to this computer's file index, so both
// are removed with the rest of the session.
const sessionStoragePrefixes = ['vault_last_read_page_', 'documentVault.presentationPosition.', 'documentVault.epubPosition.', 'documentVault.companion.token', 'documentVault.cachedVersions']

/**
 * Called when the workspace finds nobody signed in. Returns true when it should
 * reload once and look again: this browser was signed in, nobody signed out,
 * and it has not just tried. The sign-in itself is still checked by Firebase.
 */
export function shouldRetryLostSignIn(now = Date.now()) {
  try {
    if (localStorage.getItem(signedInMarkerKey) !== '1') return false
    const last = Number(sessionStorage.getItem(signInRetryKey))
    if (Number.isFinite(last) && last > 0 && now - last < SIGN_IN_RETRY_WINDOW_MS) {
      localStorage.removeItem(signedInMarkerKey)
      return false
    }
    sessionStorage.setItem(signInRetryKey, String(now))
    return true
  } catch {
    return false
  }
}

export async function logout() {
  try {
    localStorage.removeItem(signedInMarkerKey)
  } catch {
    // Nothing stored.
  }
  localStorage.removeItem(tokenStorageKey)
  localStorage.removeItem(tokenExpiryKey)
  notifyDriveTokenChanged()
  await clearLocalSessionData()
  await signOut(auth)
}

/** Removes cached document contents and viewing history from this browser. */
async function clearLocalSessionData() {
  clearBlobCache()
  // documentViewer.ts listens for this and drops its rendered previews.
  window.dispatchEvent(new Event('documentVault.sessionEnded'))
  try {
    Object.keys(localStorage)
      .filter((key) => sessionStoragePrefixes.some((prefix) => key.startsWith(prefix)))
      .forEach((key) => localStorage.removeItem(key))
  } catch {
    // Storage may be unavailable; nothing to remove then.
  }
  try {
    await clearOfflineStore()
  } catch (error) {
    console.warn('Could not clear the offline document cache:', error)
  }
  // Copies of files waiting to upload are private too. The queue itself stays;
  // its files can be re-added after signing in again.
  await clearUploadFileStore()
}

function saveDriveAccessToken(accessToken: string) {
  localStorage.setItem(tokenStorageKey, accessToken)
  // Google OAuth access tokens are intentionally short lived. Keep only the
  // browser token and a conservative expiry; never store refresh tokens here.
  localStorage.setItem(tokenExpiryKey, (Date.now() + 55 * 60 * 1000).toString())
}

function createGoogleProvider(mode: 'login' | 'reauthorize', loginHint = auth.currentUser?.email) {
  const provider = new GoogleAuthProvider()
  provider.addScope(driveScope)
  if (mode === 'login') {
    provider.setCustomParameters({ prompt: 'select_account' })
  } else {
    // Renewing access for the signed-in account: Google skips the account
    // chooser, and the consent screen too when access was granted before, so
    // the window closes by itself. It asks again only if access was revoked.
    if (loginHint) provider.setCustomParameters({ login_hint: loginHint })
  }
  return provider
}

function notifyDriveTokenChanged() {
  window.dispatchEvent(new Event(tokenChangedEvent))
}

function toVaultUser(user: { uid: string; displayName: string | null; email: string | null; photoURL: string | null }): VaultUser {
  return {
    uid: user.uid,
    displayName: user.displayName ?? 'Vault user',
    email: user.email ?? '',
    photoURL: user.photoURL ?? '',
  }
}
