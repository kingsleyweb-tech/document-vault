import {
  browserLocalPersistence,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut,
} from 'firebase/auth'
import { auth } from './firebase'
import { ensureVaultFolder } from './googleDrive'
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

export async function logout() {
  localStorage.removeItem(tokenStorageKey)
  localStorage.removeItem(tokenExpiryKey)
  notifyDriveTokenChanged()
  await signOut(auth)
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
  provider.setCustomParameters(mode === 'login' ? { prompt: 'select_account' } : { prompt: 'consent' })
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
