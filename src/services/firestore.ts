import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
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
import type { NewDocumentMetadata, NewFolderMetadata, VaultDocument, VaultFolder, VaultTimestamp } from '../types/document'

type Unsubscribe = () => void

const documentsCollection = collection(db, 'documents')
const foldersCollection = collection(db, 'folders')

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

export function listenToUserLibrary(
  ownerId: string,
  callback: (documents: VaultDocument[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  let currentDocuments: VaultDocument[] = []
  let currentFolders: VaultFolder[] = []

  const emit = () => {
    callback(
      [
        ...currentFolders.map(folderToVaultDocument),
        ...currentDocuments,
      ].sort((first, second) => second.uploadedAt.toMillis() - first.uploadedAt.toMillis()),
    )
  }

  const unsubscribeDocuments = listenToUserDocuments(
    ownerId,
    (nextDocuments) => {
      currentDocuments = nextDocuments
      emit()
    },
    onError,
  )

  const unsubscribeFolders = onSnapshot(
    query(foldersCollection, where('ownerId', '==', ownerId)),
    (snapshot) => {
      currentFolders = snapshot.docs.map(toVaultFolder)
      emit()
    },
    onError,
  )

  return () => {
    unsubscribeDocuments()
    unsubscribeFolders()
  }
}

export async function createDocumentRecord(metadata: NewDocumentMetadata) {
  return addDoc(documentsCollection, {
    ...metadata,
    folderId: metadata.folderId ?? metadata.parentId ?? null,
    searchText: createSearchText(metadata),
    isFavorite: false,
    isDeleted: false,
    uploadedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastViewedAt: null,
  })
}

export async function createFolderRecord(metadata: NewFolderMetadata) {
  return addDoc(foldersCollection, {
    ...metadata,
    searchText: createSearchText({
      name: metadata.name,
      originalName: metadata.name,
      mimeType: 'application/vnd.google-apps.folder',
      fileType: 'folder',
    }),
    isFavorite: false,
    isDeleted: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export async function findFolderRecord(ownerId: string, name: string, parentFolderId: string | null) {
  const snapshot = await getDocs(
    query(
      foldersCollection,
      where('ownerId', '==', ownerId),
      where('name', '==', name),
      where('parentFolderId', '==', parentFolderId),
    ),
  )

  const first = snapshot.docs[0]
  return first ? toVaultFolder(first) : null
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

export async function updateFolderRecord(id: string, values: Partial<VaultDocument | VaultFolder>) {
  const {
    id: _id,
    ownerId: _ownerId,
    updatedAt,
    isFolderRecord: _isFolderRecord,
    uploadedAt: _uploadedAt,
    lastViewedAt: _lastViewedAt,
    createdAt: _createdAt,
    ...safeValues
  } = values as Partial<VaultDocument & VaultFolder> & { uploadedAt?: unknown; createdAt?: unknown }
  void _id
  void _ownerId
  void updatedAt
  void _isFolderRecord
  void _uploadedAt
  void _lastViewedAt
  void _createdAt

  const nextValues: Record<string, unknown> = { updatedAt: serverTimestamp() }
  if (typeof safeValues.name === 'string') nextValues.name = safeValues.name
  if (typeof safeValues.isFavorite === 'boolean') nextValues.isFavorite = safeValues.isFavorite
  if (typeof safeValues.isDeleted === 'boolean') nextValues.isDeleted = safeValues.isDeleted
  if (typeof safeValues.parentFolderId === 'string' || safeValues.parentFolderId === null) {
    nextValues.parentFolderId = safeValues.parentFolderId
  }

  await updateDoc(doc(db, 'folders', id), nextValues)
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

export async function deleteFolderRecord(id: string) {
  await deleteDoc(doc(db, 'folders', id))
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
    createdAt: toTimestamp(data.createdAt ?? data.uploadedAt),
    uploadedAt: toTimestamp(data.uploadedAt),
    updatedAt: toTimestamp(data.updatedAt),
    lastViewedAt: data.lastViewedAt ? toTimestamp(data.lastViewedAt) : undefined,
    parentId: data.folderId ?? data.parentId ?? null,
    folderId: data.folderId ?? data.parentId ?? null,
    folderPath: data.folderPath ?? '',
  }
}

function toVaultFolder(snapshot: QueryDocumentSnapshot<DocumentData>): VaultFolder {
  const data = snapshot.data()

  return {
    id: snapshot.id,
    ownerId: data.ownerId,
    name: data.name,
    parentFolderId: data.parentFolderId ?? null,
    driveFolderId: data.driveFolderId,
    isFavorite: Boolean(data.isFavorite),
    isDeleted: Boolean(data.isDeleted),
    createdAt: toTimestamp(data.createdAt),
    updatedAt: toTimestamp(data.updatedAt),
  }
}

function folderToVaultDocument(folder: VaultFolder): VaultDocument {
  return {
    id: folder.id,
    ownerId: folder.ownerId,
    name: folder.name,
    originalName: folder.name,
    mimeType: 'application/vnd.google-apps.folder',
    fileType: 'folder',
    fileSize: 0,
    category: 'Other',
    description: '',
    driveFileId: folder.driveFolderId,
    driveFolderId: folder.driveFolderId,
    isFavorite: folder.isFavorite,
    isDeleted: folder.isDeleted,
    createdAt: folder.createdAt,
    uploadedAt: folder.createdAt,
    updatedAt: folder.updatedAt,
    parentId: folder.parentFolderId,
    folderId: folder.parentFolderId,
    isFolderRecord: true,
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
