import {
  GoogleAuthProvider,
  type User,
  type UserCredential,
  getRedirectResult,
  onAuthStateChanged,
  signInWithRedirect,
  signOut,
} from 'firebase/auth'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { auth, db } from './firebase'

const driveScope = 'https://www.googleapis.com/auth/drive.file'
const tokenStorageKey = 'documentVault.googleDriveAccessToken'
let pendingRedirectResult: Promise<User | null> | null = null

function googleProvider() {
  const provider = new GoogleAuthProvider()
  provider.addScope('profile')
  provider.addScope('email')
  provider.addScope(driveScope)
  provider.setCustomParameters({
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
  })
  return provider
}

export async function signInWithGoogle() {
  await signInWithRedirect(auth, googleProvider())
  return null
}

export async function completeRedirectSignIn() {
  pendingRedirectResult ??= getRedirectResult(auth).then(async (result) => {
    if (!result) {
      return null
    }

    await finishGoogleSignIn(result)
    return result.user
  })

  return pendingRedirectResult
}

async function finishGoogleSignIn(result: UserCredential) {
  const credential = GoogleAuthProvider.credentialFromResult(result)

  if (credential?.accessToken) {
    sessionStorage.setItem(tokenStorageKey, credential.accessToken)
  }

  void setDoc(
    doc(db, 'users', result.user.uid),
    {
      name: result.user.displayName ?? 'Vault user',
      email: result.user.email ?? '',
      photoURL: result.user.photoURL ?? '',
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  ).catch((error) => {
    console.error('Failed to save user profile metadata after Google sign-in.', error)
  })
}

export function observeAuth(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback)
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
