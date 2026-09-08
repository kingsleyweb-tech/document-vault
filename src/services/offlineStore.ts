/**
 * Offline Store Service using IndexedDB
 * Provides persistent local caching for file Blobs and rendered document previews (slides, sheets, text)
 * so documents can be viewed completely offline with 0ms loading time.
 */

const DB_NAME = 'DocumentVaultOfflineDB'
const DB_VERSION = 1
const BLOB_STORE = 'fileBlobs'
const PREVIEW_STORE = 'parsedPreviews'

export interface StoredOfflineBlob {
  fileId: string
  name: string
  mimeType: string
  blob: Blob
  updatedAt: number
}

export interface StoredOfflinePreview {
  fileId: string
  kind: string
  text?: string
  html?: string
  sheets?: Array<{ name: string; html: string }>
  slides?: Array<{ index: number; title: string; text: string[]; images?: string[] }>
  updatedAt: number
}

let dbPromise: Promise<IDBDatabase> | null = null

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not supported in this browser environment.'))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE, { keyPath: 'fileId' })
      }
      if (!db.objectStoreNames.contains(PREVIEW_STORE)) {
        db.createObjectStore(PREVIEW_STORE, { keyPath: 'fileId' })
      }
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onerror = () => {
      reject(request.error)
    }
  })

  return dbPromise
}

/** Saves a document file Blob to IndexedDB for offline viewing */
export async function saveOfflineBlob(fileId: string, name: string, mimeType: string, blob: Blob): Promise<void> {
  try {
    const db = await getDB()
    const tx = db.transaction(BLOB_STORE, 'readwrite')
    const store = tx.objectStore(BLOB_STORE)
    const entry: StoredOfflineBlob = {
      fileId,
      name,
      mimeType,
      blob,
      updatedAt: Date.now(),
    }
    store.put(entry)
  } catch (error) {
    console.warn('Failed to save blob to offline IndexedDB store:', error)
  }
}

/** Retrieves a stored document Blob from IndexedDB */
export async function getOfflineBlob(fileId: string): Promise<StoredOfflineBlob | null> {
  try {
    const db = await getDB()
    const tx = db.transaction(BLOB_STORE, 'readonly')
    const store = tx.objectStore(BLOB_STORE)
    return await new Promise<StoredOfflineBlob | null>((resolve) => {
      const request = store.get(fileId)
      request.onsuccess = () => resolve((request.result as StoredOfflineBlob) || null)
      request.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

/** Saves a parsed document preview (all slides, sheets, or HTML) for instant offline loading */
export async function saveOfflinePreview(
  fileId: string,
  kind: string,
  previewData: {
    text?: string
    html?: string
    sheets?: Array<{ name: string; html: string }>
    slides?: Array<{ index: number; title: string; text: string[]; images?: string[] }>
  },
): Promise<void> {
  try {
    const db = await getDB()
    const tx = db.transaction(PREVIEW_STORE, 'readwrite')
    const store = tx.objectStore(PREVIEW_STORE)
    const entry: StoredOfflinePreview = {
      fileId,
      kind,
      ...previewData,
      updatedAt: Date.now(),
    }
    store.put(entry)
  } catch (error) {
    console.warn('Failed to save parsed preview to IndexedDB:', error)
  }
}

/** Retrieves a cached parsed document preview from IndexedDB */
export async function getOfflinePreview(fileId: string): Promise<StoredOfflinePreview | null> {
  try {
    const db = await getDB()
    const tx = db.transaction(PREVIEW_STORE, 'readonly')
    const store = tx.objectStore(PREVIEW_STORE)
    return await new Promise<StoredOfflinePreview | null>((resolve) => {
      const request = store.get(fileId)
      request.onsuccess = () => resolve((request.result as StoredOfflinePreview) || null)
      request.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}
