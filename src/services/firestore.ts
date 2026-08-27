import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from './firebase'
import type { NewDocumentMetadata, VaultDocument } from '../types/document'

const documentsRef = collection(db, 'documents')

export function listenToUserDocuments(
  ownerId: string,
  callback: (documents: VaultDocument[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const documentsQuery = query(documentsRef, where('ownerId', '==', ownerId))

  return onSnapshot(
    documentsQuery,
    (snapshot) => {
      const nextDocuments = snapshot.docs.map((documentSnapshot) => ({
        id: documentSnapshot.id,
        ...documentSnapshot.data(),
      })) as VaultDocument[]

      callback(
        nextDocuments.sort((first, second) => second.uploadedAt.toMillis() - first.uploadedAt.toMillis()),
      )
    },
    (error) => onError(error),
  )
}

export async function createDocumentRecord(metadata: NewDocumentMetadata) {
  return addDoc(documentsRef, {
    ...metadata,
    isFavorite: false,
    isDeleted: false,
    uploadedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export async function updateDocumentRecord(id: string, values: Partial<VaultDocument>) {
  await updateDoc(doc(db, 'documents', id), {
    ...values,
    updatedAt: serverTimestamp(),
  })
}

export async function markDocumentViewed(id: string) {
  await updateDoc(doc(db, 'documents', id), {
    lastViewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export async function deleteDocumentRecord(id: string) {
  await deleteDoc(doc(db, 'documents', id))
}
