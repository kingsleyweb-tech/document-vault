import {
  browserLocalPersistence,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut,
} from 'firebase/auth'
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

export async function signInWithGoogle() {
  await ensureAuthPersistence()
  const provider = createGoogleProvider('login')
  const result = await signInWithPopup(auth, provider)
  const credential = GoogleAuthProvider.credentialFromResult(result)
  const accessToken = credential?.accessToken

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
  void ensureAuthPersistence()
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      callback(null)
      return
    }

    const vaultUser = toVaultUser(user)
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
  await ensureAuthPersistence()
  const provider = createGoogleProvider('reauthorize')
  const result = await signInWithPopup(auth, provider)
  const credential = GoogleAuthProvider.credentialFromResult(result)
  const accessToken = credential?.accessToken

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

export async function logout() {
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

let persistenceReady: Promise<void> | null = null

function ensureAuthPersistence() {
  persistenceReady ??= setPersistence(auth, browserLocalPersistence)
  return persistenceReady
}

function saveDriveAccessToken(accessToken: string) {
  localStorage.setItem(tokenStorageKey, accessToken)
  // Google OAuth access tokens are intentionally short lived. Keep only the
  // browser token and a conservative expiry; never store refresh tokens here.
  localStorage.setItem(tokenExpiryKey, (Date.now() + 55 * 60 * 1000).toString())
}

function createGoogleProvider(mode: 'login' | 'reauthorize') {
  const provider = new GoogleAuthProvider()
  provider.addScope(driveScope)
  if (mode === 'login') {
    provider.setCustomParameters({ prompt: 'select_account' })
  } else {
    // Renewing access for the signed-in account: Google skips the account
    // chooser, and the consent screen too when access was granted before, so
    // the window closes by itself. It asks again only if access was revoked.
    const email = auth.currentUser?.email
    if (email) provider.setCustomParameters({ login_hint: email })
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
