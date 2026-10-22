/**
 * Keeps a copy of files waiting to upload, so a refresh or a closed tab does
 * not lose the queue. Each copy is removed as soon as its file is uploaded,
 * cancelled or cleared, and all of them at sign-out.
 */

const DB_NAME = 'DocumentVaultUploadQueue'
const DB_VERSION = 1
const FILE_STORE = 'files'

/** Batches above this total are only kept in memory (re-adding them resumes). */
export const UPLOAD_STORE_MAX_BYTES = 2 * 1024 * 1024 * 1024

interface StoredUploadFile {
  id: string
  ownerId: string
  file: File
}

let dbPromise: Promise<IDBDatabase> | null = null

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available.'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(FILE_STORE, { keyPath: 'id' })
      store.createIndex('ownerId', 'ownerId')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  dbPromise.catch(() => {
    dbPromise = null
  })
  return dbPromise
}

function finish(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/** Stores files for later; returns the ids that were saved. Never throws. */
export async function saveUploadFiles(ownerId: string, entries: Array<{ id: string; file: File }>): Promise<Set<string>> {
  const saved = new Set<string>()
  if (entries.length === 0) return saved
  try {
    const db = await getDB()
    // One transaction per file: a file the browser cannot copy (removed from
    // disk, quota reached) fails alone instead of taking the batch with it.
    for (const { id, file } of entries) {
      try {
        const tx = db.transaction(FILE_STORE, 'readwrite')
        tx.objectStore(FILE_STORE).put({ id, ownerId, file } satisfies StoredUploadFile)
        await finish(tx)
        saved.add(id)
      } catch (error) {
        console.warn('Could not keep a copy of a queued upload:', file.name, error)
        if (error instanceof DOMException && error.name === 'QuotaExceededError') break
      }
    }
  } catch (error) {
    console.warn('Upload queue file storage is unavailable:', error)
  }
  return saved
}

export async function loadUploadFiles(ownerId: string): Promise<Map<string, File>> {
  const files = new Map<string, File>()
  try {
    const db = await getDB()
    const tx = db.transaction(FILE_STORE, 'readonly')
    const request = tx.objectStore(FILE_STORE).index('ownerId').getAll(ownerId)
    const rows = await new Promise<StoredUploadFile[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as StoredUploadFile[])
      request.onerror = () => reject(request.error)
    })
    for (const row of rows) files.set(row.id, row.file)
  } catch (error) {
    console.warn('Could not read stored upload files:', error)
  }
  return files
}

export async function deleteUploadFiles(ids: string[]) {
  if (ids.length === 0) return
  try {
    const db = await getDB()
    const tx = db.transaction(FILE_STORE, 'readwrite')
    const store = tx.objectStore(FILE_STORE)
    for (const id of ids) store.delete(id)
    await finish(tx)
  } catch (error) {
    console.warn('Could not remove stored upload files:', error)
  }
}

/** Removes every stored file, for every account. Called at sign-out. */
export async function clearUploadFileStore() {
  if (typeof indexedDB === 'undefined') return
  if (dbPromise) {
    try {
      ;(await dbPromise).close()
    } catch {
      // Nothing was open.
    }
    dbPromise = null
  }
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}
