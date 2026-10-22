/**
 * Offline Store Service using IndexedDB
 * Provides persistent local caching for file Blobs and rendered document previews (sheets, text, HTML)
 * so documents can be viewed completely offline with 0ms loading time.
 *
 * Version 2 adds the background preparation state of each file and the page
 * pictures drawn for PDFs, so a document shows its first pages at once.
 */

const DB_NAME = 'DocumentVaultOfflineDB'
const DB_VERSION = 2
const BLOB_STORE = 'fileBlobs'
const PREVIEW_STORE = 'parsedPreviews'
const META_STORE = 'previewMeta'
const PAGE_STORE = 'pageImages'

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
  /** Entries without the current version are ignored by the viewer. */
  formatVersion?: number
  text?: string
  html?: string
  sheets?: Array<{ name: string; html: string }>
  updatedAt: number
}

let dbPromise: Promise<IDBDatabase> | null = null
/** An upgrade waiting for an older connection to close; later opens would queue behind it. */
let upgradeWaiting = false

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  if (upgradeWaiting) return Promise.reject(new Error('The offline store is busy in another tab.'))

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
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'fileId' })
      }
      if (!db.objectStoreNames.contains(PAGE_STORE)) {
        db.createObjectStore(PAGE_STORE, { keyPath: 'key' }).createIndex('fileId', 'fileId')
      }
    }

    // Another tab (or this tab before an update) still has the older version
    // open, so the upgrade waits until it closes. Nothing may wait for that:
    // callers treat the failure as "nothing stored" and use Google Drive. The
    // request stays open and the database is used once the upgrade completes.
    let blocked = false
    request.onblocked = () => {
      blocked = true
      upgradeWaiting = true
      dbPromise = null
      reject(new Error('The offline store is busy in another tab.'))
    }

    request.onsuccess = () => {
      const db = request.result
      // A newer build upgrading the database in another tab closes this
      // connection; the next call opens it again.
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      if (blocked) {
        upgradeWaiting = false
        if (!dbPromise) dbPromise = Promise.resolve(db)
        else db.close()
        return
      }
      resolve(db)
    }

    request.onerror = () => {
      if (blocked) upgradeWaiting = false
      else dbPromise = null
      reject(request.error)
    }
  })

  return dbPromise
}

function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'))
  })
}

function result<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// File ids with a stored original, readable without waiting: opening a
// document decides inside the click whether Google Drive is needed.
const storedOriginals = new Set<string>()
let storedOriginalsLoaded: Promise<void> | null = null

/** Loads the list of stored originals once; later calls return the same promise. */
export function loadStoredOriginals(): Promise<void> {
  storedOriginalsLoaded ??= (async () => {
    try {
      const db = await getDB()
      const keys = await result(db.transaction(BLOB_STORE, 'readonly').objectStore(BLOB_STORE).getAllKeys())
      keys.forEach((key) => storedOriginals.add(String(key)))
    } catch {
      // No storage: nothing is available offline.
    }
  })()
  return storedOriginalsLoaded
}

/** Whether this device holds the file's original, as far as is known right now. */
export function hasStoredOriginal(fileId: string) {
  return storedOriginals.has(fileId)
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
    await done(tx)
    storedOriginals.add(fileId)
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

/** Removes the stored original and its parsed preview, keeping page pictures. Used to free space. */
export async function deleteOfflineBlob(fileId: string): Promise<void> {
  storedOriginals.delete(fileId)
  try {
    const db = await getDB()
    const tx = db.transaction([BLOB_STORE, PREVIEW_STORE], 'readwrite')
    tx.objectStore(BLOB_STORE).delete(fileId)
    // A parsed preview is only used together with its original.
    tx.objectStore(PREVIEW_STORE).delete(fileId)
    await done(tx)
  } catch {
    // Nothing stored.
  }
}

/** Saves a parsed document preview (sheets, text or HTML) for instant offline loading */
export async function saveOfflinePreview(
  fileId: string,
  kind: string,
  formatVersion: number,
  previewData: {
    text?: string
    html?: string
    sheets?: Array<{ name: string; html: string }>
  },
): Promise<void> {
  try {
    const db = await getDB()
    const tx = db.transaction(PREVIEW_STORE, 'readwrite')
    const store = tx.objectStore(PREVIEW_STORE)
    const entry: StoredOfflinePreview = {
      fileId,
      kind,
      formatVersion,
      ...previewData,
      updatedAt: Date.now(),
    }
    store.put(entry)
    await done(tx)
  } catch (error) {
    console.warn('Failed to save parsed preview to IndexedDB:', error)
  }
}

/**
 * Deletes every cached file and preview. Called at sign-out: entries are keyed
 * by Drive file ID, not by user, so they must not outlive the session on a
 * shared computer.
 */
export async function clearOfflineStore(): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  if (dbPromise) {
    try {
      ;(await dbPromise).close()
    } catch {
      // A failed open leaves nothing to close.
    }
    dbPromise = null
  }
  storedOriginals.clear()
  storedOriginalsLoaded = null
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

/**
 * Removes everything stored for one file: original, parsed preview, page
 * pictures and preparation state. Used when its contents were replaced, and
 * when it was deleted or is no longer in the signed-in user's library.
 */
export async function deleteOfflineEntries(fileId: string): Promise<void> {
  storedOriginals.delete(fileId)
  try {
    const db = await getDB()
    const tx = db.transaction([BLOB_STORE, PREVIEW_STORE, META_STORE, PAGE_STORE], 'readwrite')
    tx.objectStore(BLOB_STORE).delete(fileId)
    tx.objectStore(PREVIEW_STORE).delete(fileId)
    tx.objectStore(META_STORE).delete(fileId)
    deletePagesIn(tx.objectStore(PAGE_STORE), fileId)
    await done(tx).catch(() => undefined)
  } catch {
    // Nothing cached, or storage unavailable.
  }
}

function deletePagesIn(store: IDBObjectStore, fileId: string) {
  const cursorRequest = store.index('fileId').openKeyCursor(IDBKeyRange.only(fileId))
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result
    if (!cursor) return
    store.delete(cursor.primaryKey)
    cursor.continue()
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

// ─── Background preparation state ─────────────────────────────────────────────

export type PreparationStatus = 'queued' | 'processing' | 'ready' | 'partial' | 'failed' | 'unsupported'

/** What this device knows about one file's prepared preview. It never leaves the device. */
export interface PreviewMeta {
  fileId: string
  /** Firestore record id, for showing the status on cards. */
  documentId: string
  name: string
  /** The document version the stored previews were made from. */
  version: number
  /** Raised when the preparation steps change, so older results are redone. */
  pipelineVersion: number
  status: PreparationStatus
  /** Higher runs first: uploads, then opened files, then the backlog. */
  priority: number
  attempts: number
  error?: string
  /** Not tried again before this time (after a failure). */
  notBefore?: number
  /** Why a queued job is waiting. */
  waitingFor?: 'drive' | 'network'
  previewKind?: string
  /** PDF: page count and each page's size in points, as [width, height, width, height, ...]. */
  pageCount?: number
  pageSizes?: number[]
  /** Presentations: number of slides. */
  slideCount?: number
  originalBytes: number
  imageBytes: number
  queuedAt: number
  updatedAt: number
  lastAccess: number
}

export async function getPreviewMeta(fileId: string): Promise<PreviewMeta | null> {
  try {
    const db = await getDB()
    return (await result(db.transaction(META_STORE, 'readonly').objectStore(META_STORE).get(fileId))) ?? null
  } catch {
    return null
  }
}

export async function getAllPreviewMeta(): Promise<PreviewMeta[]> {
  try {
    const db = await getDB()
    return await result(db.transaction(META_STORE, 'readonly').objectStore(META_STORE).getAll())
  } catch {
    return []
  }
}

export async function savePreviewMeta(meta: PreviewMeta): Promise<void> {
  try {
    const db = await getDB()
    const tx = db.transaction(META_STORE, 'readwrite')
    tx.objectStore(META_STORE).put(meta)
    await done(tx)
  } catch (error) {
    console.warn('Could not save preview state:', error)
  }
}

export interface StoredPageImage {
  /** `${fileId}#${page}` */
  key: string
  fileId: string
  page: number
  /** Pixel width the page was drawn at. */
  width: number
  bytes: number
  blob: Blob
  /** Only on a slide snapshot: the pictures its slides use, by path in the deck. */
  media?: Record<string, Blob>
}

const pageKey = (fileId: string, page: number) => `${fileId}#${page}`

/** Page 0 holds a slide deck's first slides as data (JSON in `blob`) rather than a picture. */
export const SLIDE_SNAPSHOT_PAGE = 0

/** Stores or replaces a deck's slide snapshot. Returns the change in bytes. */
export async function saveSlideSnapshot(fileId: string, data: Blob, media: Record<string, Blob>): Promise<number> {
  try {
    const db = await getDB()
    const tx = db.transaction(PAGE_STORE, 'readwrite')
    const store = tx.objectStore(PAGE_STORE)
    const key = pageKey(fileId, SLIDE_SNAPSHOT_PAGE)
    const existing = (await result(store.get(key))) as StoredPageImage | undefined
    const bytes = data.size + Object.values(media).reduce((sum, blob) => sum + blob.size, 0)
    const entry: StoredPageImage = { key, fileId, page: SLIDE_SNAPSHOT_PAGE, width: 0, bytes, blob: data, media }
    store.put(entry)
    await done(tx)
    return bytes - (existing?.bytes ?? 0)
  } catch {
    return 0
  }
}

export async function getPageImage(fileId: string, page: number): Promise<StoredPageImage | null> {
  try {
    const db = await getDB()
    return (await result(db.transaction(PAGE_STORE, 'readonly').objectStore(PAGE_STORE).get(pageKey(fileId, page)))) ?? null
  } catch {
    return null
  }
}

/** Stores a page picture unless one at least as sharp is stored. Returns the change in bytes. */
export async function savePageImage(fileId: string, page: number, width: number, blob: Blob): Promise<number> {
  try {
    const db = await getDB()
    const tx = db.transaction(PAGE_STORE, 'readwrite')
    const store = tx.objectStore(PAGE_STORE)
    const existing = (await result(store.get(pageKey(fileId, page)))) as StoredPageImage | undefined
    if (existing && existing.width >= width) return 0
    const entry: StoredPageImage = { key: pageKey(fileId, page), fileId, page, width, bytes: blob.size, blob }
    store.put(entry)
    await done(tx)
    return blob.size - (existing?.bytes ?? 0)
  } catch {
    return 0
  }
}

/** Removes a file's page pictures only. */
export async function deletePageImages(fileId: string): Promise<void> {
  try {
    const db = await getDB()
    const tx = db.transaction(PAGE_STORE, 'readwrite')
    deletePagesIn(tx.objectStore(PAGE_STORE), fileId)
    await done(tx)
  } catch {
    // Nothing stored.
  }
}

/** Every file id with anything stored, so files gone from the library can be removed. */
export async function listStoredFileIds(): Promise<string[]> {
  try {
    const db = await getDB()
    const tx = db.transaction([BLOB_STORE, PREVIEW_STORE, META_STORE, PAGE_STORE], 'readonly')
    const [blobs, previews, metas, pages] = await Promise.all([
      result(tx.objectStore(BLOB_STORE).getAllKeys()),
      result(tx.objectStore(PREVIEW_STORE).getAllKeys()),
      result(tx.objectStore(META_STORE).getAllKeys()),
      result(tx.objectStore(PAGE_STORE).index('fileId').getAllKeys()),
    ])
    const ids = new Set<string>([...blobs, ...previews, ...metas].map(String))
    pages.forEach((key) => ids.add(String(key).replace(/#\d+$/, '')))
    return [...ids]
  } catch {
    return []
  }
}
