import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from './firebase'
import type { NewDocumentMetadata, VaultDocument, VaultTimestamp } from '../types/document'

type Unsubscribe = () => void

const documentsCollection = collection(db, 'documents')

export function listenToUserDocuments(
  ownerId: string,
  callback: (documents: VaultDocument[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const userDocumentsQuery = query(documentsCollection, where('ownerId', '==', ownerId))

  return onSnapshot(
    userDocumentsQuery,
    (snapshot) => {
      callback(
        snapshot.docs
          .map(toVaultDocument)
          .sort((first, second) => second.uploadedAt.toMillis() - first.uploadedAt.toMillis()),
      )
    },
    (error) => {
      onError(error)
    },
  )
}

export async function createDocumentRecord(metadata: NewDocumentMetadata) {
  return addDoc(documentsCollection, {
    ...metadata,
    searchText: createSearchText(metadata),
    isFavorite: false,
    isDeleted: false,
    uploadedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastViewedAt: null,
  })
}

export async function updateDocumentRecord(id: string, values: Partial<VaultDocument>) {
  const { uploadedAt, id: _id, updatedAt, lastViewedAt, ...safeValues } = values
  void uploadedAt
  void updatedAt
  void lastViewedAt
  void _id

  await updateDoc(doc(db, 'documents', id), {
    ...safeValues,
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

function toVaultDocument(snapshot: QueryDocumentSnapshot<DocumentData>): VaultDocument {
  const data = snapshot.data()

  return {
    id: snapshot.id,
    ownerId: data.ownerId,
    name: data.name,
    originalName: data.originalName,
    mimeType: data.mimeType,
    fileType: data.fileType,
    fileSize: data.fileSize,
    category: data.category,
    description: data.description ?? '',
    driveFileId: data.driveFileId,
    driveFolderId: data.driveFolderId,
    driveWebViewLink: data.driveWebViewLink,
    thumbnailUrl: data.thumbnailUrl,
    isFavorite: Boolean(data.isFavorite),
    isDeleted: Boolean(data.isDeleted),
    uploadedAt: toTimestamp(data.uploadedAt),
    updatedAt: toTimestamp(data.updatedAt),
    lastViewedAt: data.lastViewedAt ? toTimestamp(data.lastViewedAt) : undefined,
    parentId: data.parentId ?? null,
  }
}

function toTimestamp(value: unknown): VaultTimestamp {
  if (value instanceof Timestamp) {
    return value
  }

  if (value instanceof Date) {
    return createTimestamp(value.getTime())
  }

  if (typeof value === 'number') {
    return createTimestamp(value)
  }

  return createTimestamp(Date.now())
}

function createTimestamp(milliseconds: number): VaultTimestamp {
  return {
    toDate: () => new Date(milliseconds),
    toMillis: () => milliseconds,
  }
}

function createSearchText(values: Partial<NewDocumentMetadata | VaultDocument>) {
  return [
    values.name,
    values.originalName,
    values.category,
    values.description,
    values.fileType,
    values.mimeType,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}
