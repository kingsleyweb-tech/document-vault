import type { NewDocumentMetadata, VaultDocument, VaultTimestamp } from '../types/document'

type Unsubscribe = () => void

type StoredVaultDocument = Omit<VaultDocument, 'createdAt' | 'uploadedAt' | 'updatedAt' | 'lastViewedAt'> & {
  createdAt: number
  uploadedAt: number
  updatedAt: number
  lastViewedAt?: number
}

const documentsStorageKey = 'documentVault.documents'
const documentsChangedEvent = 'documentVault.documentsChanged'

export function listenToUserDocuments(
  ownerId: string,
  callback: (documents: VaultDocument[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const emitDocuments = () => {
    try {
      callback(
        getStoredDocuments()
          .filter((documentRecord) => documentRecord.ownerId === ownerId)
          .sort((first, second) => second.uploadedAt.toMillis() - first.uploadedAt.toMillis()),
      )
    } catch (error) {
      onError(error instanceof Error ? error : new Error('Unable to load document metadata.'))
    }
  }

  const handleStorageChanged = (event: StorageEvent) => {
    if (event.key === documentsStorageKey) {
      emitDocuments()
    }
  }

  emitDocuments()
  window.addEventListener(documentsChangedEvent, emitDocuments)
  window.addEventListener('storage', handleStorageChanged)

  return () => {
    window.removeEventListener(documentsChangedEvent, emitDocuments)
    window.removeEventListener('storage', handleStorageChanged)
  }
}

export async function createDocumentRecord(metadata: NewDocumentMetadata) {
  const id = crypto.randomUUID()
  const now = Date.now()
  const storedDocument: StoredVaultDocument = {
    ...metadata,
    id,
    isFavorite: false,
    isDeleted: false,
    createdAt: now,
    uploadedAt: now,
    updatedAt: now,
  }

  saveStoredDocuments([...getStoredRawDocuments(), storedDocument])

  return { id }
}

export async function updateDocumentRecord(id: string, values: Partial<VaultDocument>) {
  const now = Date.now()
  const nextDocuments = getStoredRawDocuments().map((documentRecord) => {
    if (documentRecord.id !== id) {
      return documentRecord
    }

    return serializeDocument({
      ...toVaultDocument(documentRecord),
      ...values,
      updatedAt: createTimestamp(now),
    })
  })

  saveStoredDocuments(nextDocuments)
}

export async function markDocumentViewed(id: string) {
  const now = Date.now()
  const nextDocuments = getStoredRawDocuments().map((documentRecord) => {
    if (documentRecord.id !== id) {
      return documentRecord
    }

    return {
      ...documentRecord,
      lastViewedAt: now,
      updatedAt: now,
    }
  })

  saveStoredDocuments(nextDocuments)
}

export async function deleteDocumentRecord(id: string) {
  saveStoredDocuments(getStoredRawDocuments().filter((documentRecord) => documentRecord.id !== id))
}

function getStoredDocuments() {
  return getStoredRawDocuments().map(toVaultDocument)
}

function getStoredRawDocuments() {
  const storedDocuments = localStorage.getItem(documentsStorageKey)

  if (!storedDocuments) {
    return []
  }

  try {
    return JSON.parse(storedDocuments) as StoredVaultDocument[]
  } catch {
    localStorage.removeItem(documentsStorageKey)
    return []
  }
}

function saveStoredDocuments(documents: StoredVaultDocument[]) {
  localStorage.setItem(documentsStorageKey, JSON.stringify(documents))
  window.dispatchEvent(new Event(documentsChangedEvent))
}

function toVaultDocument(documentRecord: StoredVaultDocument): VaultDocument {
  return {
    ...documentRecord,
    createdAt: createTimestamp(documentRecord.createdAt ?? documentRecord.uploadedAt),
    uploadedAt: createTimestamp(documentRecord.uploadedAt),
    updatedAt: createTimestamp(documentRecord.updatedAt),
    lastViewedAt: documentRecord.lastViewedAt ? createTimestamp(documentRecord.lastViewedAt) : undefined,
  }
}

function serializeDocument(documentRecord: VaultDocument): StoredVaultDocument {
  const { createdAt, uploadedAt, updatedAt, lastViewedAt, ...serializableDocument } = documentRecord

  return {
    ...serializableDocument,
    createdAt: createdAt.toMillis(),
    uploadedAt: uploadedAt.toMillis(),
    updatedAt: updatedAt.toMillis(),
    lastViewedAt: lastViewedAt?.toMillis(),
  }
}

function createTimestamp(milliseconds: number): VaultTimestamp {
  return {
    toDate: () => new Date(milliseconds),
    toMillis: () => milliseconds,
  }
}
