import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import { auth } from './firebase'
import type { VaultUser } from '../types/user'

const driveScope = 'https://www.googleapis.com/auth/drive.file'
const tokenStorageKey = 'documentVault.googleDriveAccessToken'

export async function signInWithGoogle() {
  const provider = createGoogleProvider()
  const result = await signInWithPopup(auth, provider)
  const credential = GoogleAuthProvider.credentialFromResult(result)
  const accessToken = credential?.accessToken

  if (!accessToken) {
    throw new Error('Google sign-in succeeded, but Drive authorization was not granted.')
  }

  sessionStorage.setItem(tokenStorageKey, accessToken)
  return toVaultUser(result.user)
}

export function observeAuth(callback: (user: VaultUser | null) => void) {
  return onAuthStateChanged(auth, (user) => callback(user ? toVaultUser(user) : null))
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
  await signOut(auth)
}

function createGoogleProvider() {
  const provider = new GoogleAuthProvider()
  provider.addScope(driveScope)
  provider.setCustomParameters({ prompt: 'consent select_account' })
  return provider
}

function toVaultUser(user: { uid: string; displayName: string | null; email: string | null; photoURL: string | null }): VaultUser {
  return {
    uid: user.uid,
    displayName: user.displayName ?? 'Vault user',
    email: user.email ?? '',
    photoURL: user.photoURL ?? '',
  }
}
