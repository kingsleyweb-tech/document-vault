import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import type { VaultUser, VaultUserProfile } from '../types/user'

export async function upsertUserProfile(user: VaultUser, driveFolderId?: string) {
  await setDoc(
    doc(db, 'users', user.uid),
    {
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      ...(driveFolderId ? { driveFolderId, driveConnected: true, driveConnectedAt: serverTimestamp() } : {}),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export async function getUserProfile(uid: string): Promise<VaultUserProfile | null> {
  const snapshot = await getDoc(doc(db, 'users', uid))

  if (!snapshot.exists()) {
    return null
  }

  const data = snapshot.data()

  return {
    uid: snapshot.id,
    email: data.email ?? '',
    displayName: data.displayName ?? 'Vault user',
    photoURL: data.photoURL ?? '',
    driveFolderId: data.driveFolderId,
    driveConnected: Boolean(data.driveConnected),
  }
}

export async function updateUserDriveConnection(uid: string, driveFolderId: string) {
  await setDoc(
    doc(db, 'users', uid),
    {
      driveFolderId,
      driveConnected: true,
      driveConnectedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}
