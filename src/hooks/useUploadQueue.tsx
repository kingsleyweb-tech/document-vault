/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createDocumentRecord, createFolderRecord } from '../services/firestore'
import { queueContentIndex } from '../services/contentIndex'
import { enqueuePreview } from '../services/previewQueue'
import {
  continueResumableUpload,
  createResumableUpload,
  ensureDriveFolder,
  ensureVaultFolder,
  findFileInDrive,
  GoogleDriveError,
  isDriveAuthorizationError,
  isDriveReachable,
  isNetworkError,
  queryResumableUpload,
  RESUMABLE_UPLOAD_THRESHOLD,
  uploadFileToDrive,
} from '../services/googleDrive'
import { deleteUploadFiles, loadUploadFiles, saveUploadFiles, UPLOAD_STORE_MAX_BYTES } from '../services/uploadFileStore'
import { getUserProfile, updateUserDriveConnection } from '../services/users'
import { clearDriveAccessToken } from '../services/auth'
import type { DriveFile } from '../types/googleDrive'
import type {
  DocumentCategory,
  DuplicateMatch,
  FolderUploadStats,
  NewDocumentMetadata,
  UploadItem,
  UploadPauseReason,
  VaultDocument,
} from '../types/document'
import type { VaultUser } from '../types/user'
import { compressFile } from '../utils/compressor'
import { sha256Hex } from '../utils/fileHash'
import { getDocumentKind, normalizeRelativePath, stripExtension } from '../utils/fileUtils'
import { validateUploadFile } from '../utils/validators'
import type { UploadStatus } from '../types/document'

interface StoredQueueItem {
  id: string
  name: string
  size: number
  type: string
  status: UploadStatus
  pauseReason?: UploadPauseReason
  progress: number
  category: DocumentCategory
  description: string
  relativePath?: string
  rootFolderName?: string
  error?: string
  errorStatus?: number
  attempts?: number
  driveFileId?: string
  driveFolderId?: string
  firestoreDocumentId?: string
  lastAttemptAt?: number
  originalSize?: number
  compressedSize?: number
  savedPercentage?: number
  destinationFolderId: string | null
  firestoreSaved?: boolean
  uploadSessionUri?: string
  uploadSessionSize?: number
  uploadedBytes?: number
  contentHash?: string
  duplicateOf?: DuplicateMatch
  allowDuplicate?: boolean
}

// Stand-ins for files whose contents were not available after a reload.
const placeholderFiles = new WeakSet<File>()

function isFileHandleLost(file: File) {
  return placeholderFiles.has(file) || (file.size > 0 && file.slice().size === 0)
}

// Up to three files upload at once, started in the order they were added.
// Small files are dominated by request latency, so overlapping them is much
// faster; large files are sent in resumable chunks either way.
const MAX_CONCURRENT_UPLOADS = 3
const MAX_ATTEMPTS = 4
// Connection drops do not use up attempts, but a file that keeps failing with
// a network error while Drive is otherwise reachable is eventually marked failed.
const MAX_NETWORK_PAUSES = 8
const VISIBLE_ITEM_LIMIT = 220
const SAVE_DELAY_MS = 400

interface UploadQueueStats {
  total: number
  pending: number
  uploading: number
  completed: number
  failed: number
  retrying: number
  /** Waiting for Drive, the connection or a re-added file. */
  paused: number
  /** Paused because their contents were lost; adding them again resumes them. */
  needsFile: number
  /** Paused because the vault already has a file with the same contents. */
  duplicates: number
  retries: number
  progress: number
  currentFile?: string
  running: boolean
  pausedForAuth: boolean
  pausedForNetwork: boolean
  lastError?: string
  folders: Record<string, FolderUploadStats>
}

interface UploadQueueContextValue {
  items: UploadItem[]
  stats: UploadQueueStats
  enqueueFiles: (
    files: FileList | File[],
    category: DocumentCategory,
    description: string,
    destinationFolderId: string | null,
    rootFolderName?: string,
  ) => void
  start: () => void
  retryFailed: () => void
  retryItem: (id: string) => void
  /** Uploads a suspected duplicate anyway, or drops it from the queue. Pass 'all' for every waiting duplicate. */
  resolveDuplicate: (id: string | 'all', choice: 'upload' | 'skip') => void
  updateItem: (id: string, values: Pick<Partial<UploadItem>, 'category' | 'description'>) => void
  cancelUploads: () => void
  clearCompleted: () => void
}

const emptyStats: UploadQueueStats = {
  total: 0,
  pending: 0,
  uploading: 0,
  completed: 0,
  failed: 0,
  retrying: 0,
  paused: 0,
  needsFile: 0,
  duplicates: 0,
  retries: 0,
  progress: 0,
  running: false,
  pausedForAuth: false,
  pausedForNetwork: false,
  folders: {},
}

const UploadQueueContext = createContext<UploadQueueContextValue | null>(null)

interface QueueRecord extends UploadItem {
  destinationFolderId: string | null
  firestoreSaved?: boolean
  /** Drive resumable session for this file, kept so a retry or reload continues it. */
  uploadSessionUri?: string
  uploadSessionSize?: number
  uploadedBytes?: number
  networkFailures?: number
  /** The owner chose to upload this file although the vault has the same contents. */
  allowDuplicate?: boolean
}

interface ManagedFolder {
  id: string
  driveFileId: string
  name: string
  parentId: string | null
}

type ManagedFolderCacheEntry = ManagedFolder | Promise<ManagedFolder>

const NEEDS_FILE_MESSAGE = 'Add this file or its folder again to continue. Finished files are skipped.'
const OFFLINE_MESSAGE = 'Connection lost. The upload continues by itself when the connection returns.'

export function UploadQueueProvider({
  user,
  accessToken,
  documents,
  children,
}: {
  user: VaultUser | null
  accessToken: string | null
  documents: VaultDocument[]
  children: ReactNode
}) {
  const userRef = useRef(user)
  const accessTokenRef = useRef(accessToken)
  const documentsRef = useRef(documents)
  const itemsRef = useRef(new Map<string, QueueRecord>())
  const orderRef = useRef<string[]>([])
  const runningRef = useRef(false)
  const pausedForAuthRef = useRef(false)
  const pausedForNetworkRef = useRef(false)
  const emitTimerRef = useRef<number | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const folderCacheRef = useRef(new Map<string, ManagedFolderCacheEntry>())
  const vaultFolderRef = useRef<{ uid: string; folder: Promise<{ id: string; name: string }> } | null>(null)
  const abortControllersRef = useRef(new Map<string, AbortController>())

  const lastSpeedRef = useRef<{ bytes: number; time: number; speedBps: number }>({
    bytes: 0,
    time: Date.now(),
    speedBps: 0,
  })

  const [visibleItems, setVisibleItems] = useState<UploadItem[]>([])
  const [stats, setStats] = useState<UploadQueueStats>(emptyStats)

  const emit = useCallback(() => {
    emitTimerRef.current = null
    let pending = 0
    let uploading = 0
    let completed = 0
    let failed = 0
    let retrying = 0
    let paused = 0
    let needsFile = 0
    let duplicates = 0
    let retries = 0
    let currentFile: string | undefined
    let lastError: string | undefined
    const prioritized: QueueRecord[] = []
    const prioritizedIds = new Set<string>()

    // 1. Calculate overall metrics & speed
    const now = Date.now()
    const dt = (now - lastSpeedRef.current.time) / 1000
    let currentSpeedBps = lastSpeedRef.current.speedBps

    let grandTotalBytesUploaded = 0
    for (const id of orderRef.current) {
      const item = itemsRef.current.get(id)
      if (!item) continue
      const size = item.file?.size || item.originalSize || 0
      if (item.status === 'COMPLETED') {
        grandTotalBytesUploaded += size
      } else if (item.status === 'UPLOADING' || item.status === 'COMPRESSING') {
        grandTotalBytesUploaded += (size * (item.progress || 0)) / 100
      }
    }

    if (dt >= 0.8) {
      const deltaBytes = Math.max(0, grandTotalBytesUploaded - lastSpeedRef.current.bytes)
      currentSpeedBps = Math.round(deltaBytes / dt)
      lastSpeedRef.current = { bytes: grandTotalBytesUploaded, time: now, speedBps: currentSpeedBps }
    }

    for (const id of orderRef.current) {
      const item = itemsRef.current.get(id)
      if (!item) continue
      retries += Math.max(0, (item.attempts ?? 0) - 1)
      if (item.status === 'PENDING') pending += 1
      if (item.status === 'COMPRESSING' || item.status === 'UPLOADING') {
        uploading += 1
        currentFile ??= item.relativePath ?? item.file.name
      }
      if (item.status === 'COMPLETED') completed += 1
      if (item.status === 'FAILED') {
        failed += 1
        lastError ??= `${item.relativePath ?? item.file.name}: ${item.error ?? 'Unknown error'}`
      }
      if (item.status === 'RETRYING') retrying += 1
      if (item.status === 'PAUSED') {
        paused += 1
        if (item.pauseReason === 'needsFile') needsFile += 1
        if (item.pauseReason === 'duplicate') duplicates += 1
      }

      if (
        prioritized.length < VISIBLE_ITEM_LIMIT &&
        (item.status === 'FAILED' ||
          item.status === 'UPLOADING' ||
          item.status === 'COMPRESSING' ||
          item.status === 'RETRYING' ||
          item.status === 'PAUSED')
      ) {
        prioritized.push(item)
        prioritizedIds.add(id)
      }
    }

    for (const id of orderRef.current) {
      if (prioritized.length >= VISIBLE_ITEM_LIMIT) break
      const item = itemsRef.current.get(id)
      if (!item || prioritizedIds.has(id)) continue
      prioritized.push(item)
    }

    // 2. Calculate per-folder upload stats
    const folderStatsMap: Record<string, FolderUploadStats> = {}
    const folderItemGroups = new Map<string, QueueRecord[]>()

    for (const id of orderRef.current) {
      const item = itemsRef.current.get(id)
      if (!item) continue
      const relPath = item.relativePath ? normalizeRelativePath(item.relativePath) : ''
      const rootName = item.rootFolderName || (relPath.includes('/') ? relPath.split('/')[0] : null)
      if (rootName) {
        const list = folderItemGroups.get(rootName) ?? []
        list.push(item)
        folderItemGroups.set(rootName, list)
      }
    }

    const queuePaused = pausedForAuthRef.current || pausedForNetworkRef.current
    folderItemGroups.forEach((folderItems, folderName) => {
      let fCompleted = 0
      let fFailed = 0
      let fUploading = 0
      let fPending = 0
      let fPaused = 0
      let fBytesUploaded = 0
      let fTotalBytes = 0
      let activeFileName: string | undefined

      for (const item of folderItems) {
        const itemSize = item.file?.size || item.originalSize || 0
        fTotalBytes += itemSize

        if (item.status === 'COMPLETED') {
          fCompleted += 1
          fBytesUploaded += itemSize
        } else if (item.status === 'FAILED') {
          fFailed += 1
        } else if (item.status === 'UPLOADING' || item.status === 'COMPRESSING' || item.status === 'RETRYING') {
          fUploading += 1
          fBytesUploaded += (itemSize * (item.progress || 0)) / 100
          activeFileName ??= item.file.name
        } else if (item.status === 'PAUSED') {
          fPaused += 1
          fBytesUploaded += (itemSize * (item.progress || 0)) / 100
        } else {
          fPending += 1
        }
      }

      const totalFiles = folderItems.length
      const remainingFiles = totalFiles - fCompleted
      const progress = totalFiles > 0 ? Math.round(((fCompleted + (fFailed > 0 ? fFailed * 0.5 : 0)) / totalFiles) * 100) : 0

      let folderStatus: FolderUploadStats['status'] = 'PENDING'
      if (fCompleted === totalFiles && totalFiles > 0) {
        folderStatus = 'COMPLETED'
      } else if (queuePaused || (fPaused > 0 && fUploading === 0)) {
        folderStatus = 'PAUSED'
      } else if (fUploading > 0) {
        folderStatus = 'UPLOADING'
      } else if (fFailed > 0 && fPending === 0) {
        folderStatus = 'FAILED'
      }

      folderStatsMap[folderName] = {
        folderName,
        completedFiles: fCompleted,
        totalFiles,
        failedFiles: fFailed,
        remainingFiles,
        progress: Math.min(100, progress),
        bytesUploaded: fBytesUploaded,
        totalBytes: fTotalBytes,
        speedBps: fUploading > 0 ? currentSpeedBps : 0,
        currentFileName: activeFileName,
        status: folderStatus,
      }
    })

    const total = orderRef.current.length
    setStats({
      total,
      pending,
      uploading,
      completed,
      failed,
      retrying,
      paused,
      needsFile,
      duplicates,
      retries,
      progress: total === 0 ? 0 : Math.round(((completed + failed) / total) * 1000) / 10,
      currentFile,
      running: runningRef.current,
      pausedForAuth: pausedForAuthRef.current,
      pausedForNetwork: pausedForNetworkRef.current,
      lastError,
      folders: folderStatsMap,
    })
    setVisibleItems(prioritized.map(toUploadItem))
  }, [])

  const scheduleEmit = useCallback(() => {
    if (emitTimerRef.current !== null) return
    emitTimerRef.current = window.setTimeout(emit, 100)
  }, [emit])

  const writeQueue = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const activeUser = userRef.current
    if (!activeUser) return
    const list: StoredQueueItem[] = []
    for (const id of orderRef.current) {
      const item = itemsRef.current.get(id)
      if (!item) continue
      const active = item.status === 'UPLOADING' || item.status === 'COMPRESSING' || item.status === 'RETRYING'
      list.push({
        id: item.id,
        name: item.file.name,
        size: item.file?.size || item.originalSize || 0,
        type: item.file?.type || '',
        status: active ? 'PAUSED' : item.status,
        pauseReason: active ? undefined : item.pauseReason,
        progress: item.progress,
        category: item.category,
        description: item.description,
        relativePath: item.relativePath,
        rootFolderName: item.rootFolderName,
        error: item.error,
        errorStatus: item.errorStatus,
        attempts: item.attempts,
        driveFileId: item.driveFileId,
        driveFolderId: item.driveFolderId,
        firestoreDocumentId: item.firestoreDocumentId,
        lastAttemptAt: item.lastAttemptAt,
        originalSize: item.originalSize,
        compressedSize: item.compressedSize,
        savedPercentage: item.savedPercentage,
        destinationFolderId: item.destinationFolderId,
        firestoreSaved: item.firestoreSaved,
        uploadSessionUri: item.uploadSessionUri,
        uploadSessionSize: item.uploadSessionSize,
        uploadedBytes: item.uploadedBytes,
        contentHash: item.contentHash,
        duplicateOf: item.duplicateOf,
        allowDuplicate: item.allowDuplicate,
      })
    }
    try {
      localStorage.setItem(queueStorageKey(activeUser.uid), JSON.stringify(list))
    } catch (error) {
      // A full or blocked storage must never stop the uploads themselves.
      console.warn('Could not save the upload queue:', error)
    }
  }, [])

  // State changes arrive many times per file; the queue is written at most
  // every SAVE_DELAY_MS, and immediately when the page is hidden or closed.
  const saveQueue = useCallback(() => {
    if (saveTimerRef.current !== null) return
    saveTimerRef.current = window.setTimeout(writeQueue, SAVE_DELAY_MS)
  }, [writeQueue])

  useEffect(() => {
    const flush = () => {
      if (saveTimerRef.current !== null) writeQueue()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      flush()
    }
  }, [writeQueue])

  const setItem = useCallback((id: string, values: Partial<QueueRecord>) => {
    const item = itemsRef.current.get(id)
    if (!item) return
    itemsRef.current.set(id, { ...item, ...values })
    saveQueue()
    scheduleEmit()
  }, [scheduleEmit, saveQueue])

  const forgetStoredFiles = useCallback((ids: string[]) => {
    void deleteUploadFiles(ids)
  }, [])

  const enqueueFiles = useCallback<UploadQueueContextValue['enqueueFiles']>((files, category, description, destinationFolderId, rootFolderName) => {
    const toStore: Array<{ id: string; file: File }> = []
    const nextItems = Array.from(files).map((file): QueueRecord | null => {
      const error = validateUploadFile(file)
      const relativePath = getRelativePath(file)
      const derivedRoot =
        rootFolderName ||
        (relativePath && relativePath.includes('/') ? relativePath.split('/')[0] : undefined)

      // The same file already waiting (for example after a reload lost its
      // contents) is re-linked instead of queued twice.
      let existingId: string | null = null
      for (const [id, item] of itemsRef.current) {
        if (item.status !== 'COMPLETED' && item.relativePath === relativePath && item.file.size === file.size) {
          existingId = id
          break
        }
      }

      if (existingId) {
        const existing = itemsRef.current.get(existingId)!
        const active = existing.status === 'UPLOADING' || existing.status === 'COMPRESSING' || existing.status === 'RETRYING'
        itemsRef.current.set(existingId, {
          ...existing,
          file,
          status: error ? 'FAILED' : active ? existing.status : 'PENDING',
          pauseReason: undefined,
          rootFolderName: derivedRoot || existing.rootFolderName,
          error: error ?? undefined,
        })
        if (!error) toStore.push({ id: existingId, file })
        return null
      }

      const id = crypto.randomUUID()
      if (!error) toStore.push({ id, file })
      return {
        id,
        file,
        status: error ? 'FAILED' : 'PENDING',
        progress: 0,
        category,
        description,
        relativePath,
        rootFolderName: derivedRoot,
        destinationFolderId,
        attempts: 0,
        error: error ?? undefined,
        lastAttemptAt: error ? Date.now() : undefined,
      }
    })

    for (const item of nextItems) {
      if (!item) continue
      itemsRef.current.set(item.id, item)
      orderRef.current.push(item.id)
    }

    // Keep copies so a reload can continue. Very large batches stay in memory
    // only; after a reload those files are asked for again.
    const activeUser = userRef.current
    if (activeUser) {
      let budget = UPLOAD_STORE_MAX_BYTES
      const storable = toStore.filter(({ file }) => {
        if (file.size > budget) return false
        budget -= file.size
        return true
      })
      void saveUploadFiles(activeUser.uid, storable)
    }
    saveQueue()
    scheduleEmit()
  }, [scheduleEmit, saveQueue])

  const processItem = useCallback(async (id: string) => {
    for (;;) {
      const current = itemsRef.current.get(id)
      if (!current) return
      const attempts = (current.attempts ?? 0) + 1
      setItem(id, {
        status: current.driveFileId ? 'UPLOADING' : 'COMPRESSING',
        pauseReason: undefined,
        progress: Math.max(current.progress || 0, 5),
        attempts,
        lastAttemptAt: Date.now(),
        error: undefined,
        errorStatus: undefined,
      })

      try {
        const completedRecord = findExistingCompletedRecord(current)
        if (completedRecord) {
          setItem(id, {
            status: 'COMPLETED',
            progress: 100,
            driveFileId: completedRecord.driveFileId,
            driveFolderId: completedRecord.driveFolderId,
            firestoreDocumentId: completedRecord.id,
            firestoreSaved: true,
            uploadSessionUri: undefined,
          })
          forgetStoredFiles([id])
          return
        }

        await uploadOne(id)
        setItem(id, { status: 'COMPLETED', progress: 100, firestoreSaved: true, networkFailures: 0, uploadSessionUri: undefined })
        forgetStoredFiles([id])
        return
      } catch (error) {
        // Cancelled and removed from the queue: nothing left to update.
        if (!itemsRef.current.has(id)) return
        const latest = itemsRef.current.get(id)!
        const message = getUploadErrorMessage(error)
        const status = error instanceof GoogleDriveError ? error.status : undefined
        const aborted = error instanceof DOMException && error.name === 'AbortError'

        if (isDriveAuthorizationError(error)) {
          clearDriveAccessToken()
          pausedForAuthRef.current = true
          // An authorization stop is not the file's fault; it keeps its attempts.
          setItem(id, { status: 'PAUSED', pauseReason: 'auth', attempts: attempts - 1, error: message, errorStatus: status })
          return
        }

        if (aborted || isNetworkError(error) || !navigator.onLine) {
          const networkFailures = (latest.networkFailures ?? 0) + 1
          if (networkFailures <= MAX_NETWORK_PAUSES || pausedForNetworkRef.current) {
            pausedForNetworkRef.current = true
            setItem(id, {
              status: 'PAUSED',
              pauseReason: 'offline',
              attempts: attempts - 1,
              networkFailures,
              error: OFFLINE_MESSAGE,
            })
            return
          }
        }

        if (error instanceof FileUnavailableError) {
          setItem(id, { status: 'PAUSED', pauseReason: 'needsFile', attempts: attempts - 1, error: NEEDS_FILE_MESSAGE })
          return
        }

        if (error instanceof DuplicateFileError) {
          setItem(id, { status: 'PAUSED', pauseReason: 'duplicate', attempts: attempts - 1, duplicateOf: error.match, error: error.message })
          return
        }

        console.error('Upload queue item failed', {
          file: current.relativePath ?? current.file.name,
          status,
          reason: error instanceof GoogleDriveError ? error.reason : undefined,
          attempt: attempts,
          error,
        })

        if (attempts < MAX_ATTEMPTS && isTemporaryUploadError(error)) {
          // Progress is kept: a resumable upload continues where Drive stopped.
          setItem(id, { status: 'RETRYING', error: message, errorStatus: status })
          await delay(getBackoffMs(attempts, status))
          if (pausedForAuthRef.current || pausedForNetworkRef.current) {
            setItem(id, { status: 'PENDING' })
            return
          }
          continue
        }

        setItem(id, { status: 'FAILED', error: message, errorStatus: status })
        return
      }
    }
    // uploadOne reads from refs so queued work always uses the latest token/document snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setItem, forgetStoredFiles])

  const startProcessing = useCallback(async () => {
    if (runningRef.current || pausedForAuthRef.current || pausedForNetworkRef.current) return
    runningRef.current = true
    scheduleEmit()

    async function worker() {
      for (;;) {
        if (pausedForAuthRef.current || pausedForNetworkRef.current) return
        // RETRYING items are still owned by the worker waiting out their backoff.
        const nextId = orderRef.current.find((id) => itemsRef.current.get(id)?.status === 'PENDING')
        if (!nextId) return
        const item = itemsRef.current.get(nextId)
        if (!item) continue
        // Claimed synchronously so another worker never picks the same file.
        itemsRef.current.set(nextId, { ...item, status: 'UPLOADING', progress: Math.max(item.progress, 5) })
        scheduleEmit()
        await processItem(nextId)
      }
    }

    try {
      await Promise.all(Array.from({ length: MAX_CONCURRENT_UPLOADS }, worker))
    } finally {
      runningRef.current = false
      saveQueue()
      scheduleEmit()
    }
  }, [processItem, saveQueue, scheduleEmit])

  /** Puts paused items back in line (except those waiting for their file) and runs the queue. */
  const resume = useCallback((reasons: UploadPauseReason[]) => {
    for (const [id, item] of itemsRef.current) {
      if (item.status === 'PAUSED' && (!item.pauseReason || reasons.includes(item.pauseReason))) {
        itemsRef.current.set(id, { ...item, status: 'PENDING', pauseReason: undefined, error: undefined })
      }
    }
    saveQueue()
    scheduleEmit()
    void startProcessing()
  }, [saveQueue, scheduleEmit, startProcessing])

  const start = useCallback(() => {
    pausedForAuthRef.current = false
    pausedForNetworkRef.current = false
    resume(['auth', 'offline'])
  }, [resume])

  useEffect(() => {
    userRef.current = user
  }, [user])

  // Restore the saved queue for this account, with any stored file copies.
  // Keyed on the account id: a refreshed user object must not reset running uploads.
  const uid = user?.uid ?? null
  useEffect(() => {
    vaultFolderRef.current = null
    if (!uid) {
      itemsRef.current.clear()
      orderRef.current = []
      window.setTimeout(() => {
        setVisibleItems([])
        setStats(emptyStats)
      }, 0)
      return
    }

    let cancelled = false
    const list = readStoredQueue(uid)
    const map = new Map<string, QueueRecord>()
    const order: string[] = []
    for (const item of list) {
      map.set(item.id, restoreItem(item))
      order.push(item.id)
    }
    itemsRef.current = map
    orderRef.current = order
    emit()

    const unfinished = list.filter((item) => item.status !== 'COMPLETED' && item.status !== 'FAILED')
    if (unfinished.length === 0) return

    void loadUploadFiles(uid).then((files) => {
      if (cancelled || userRef.current?.uid !== uid) return
      for (const stored of unfinished) {
        const item = itemsRef.current.get(stored.id)
        if (!item || item.status === 'COMPLETED' || item.status === 'FAILED') continue
        // Already re-added by hand while the copies were loading.
        if (!isFileHandleLost(item.file)) continue
        const file = files.get(stored.id)
        if (file && file.size === stored.size && stored.pauseReason === 'duplicate') {
          // Still waiting for the owner to decide.
          itemsRef.current.set(stored.id, { ...item, file })
        } else if (file && file.size === stored.size) {
          itemsRef.current.set(stored.id, { ...item, file, status: 'PENDING', pauseReason: undefined, error: undefined })
        } else if (!item.driveFileId) {
          itemsRef.current.set(stored.id, { ...item, status: 'PAUSED', pauseReason: 'needsFile', error: NEEDS_FILE_MESSAGE })
        } else {
          // Already in Drive; only the vault record is left, which needs no file contents.
          itemsRef.current.set(stored.id, { ...item, status: 'PENDING', pauseReason: undefined, error: undefined })
        }
      }
      saveQueue()
      scheduleEmit()
      // Carry on where the last visit stopped. Without a Drive token the queue
      // waits and asks for Drive to be reconnected.
      if (accessTokenRef.current) void startProcessing()
      else if (hasWork(itemsRef.current)) {
        pausedForAuthRef.current = true
        scheduleEmit()
      }
    })

    return () => {
      cancelled = true
    }
  }, [uid, emit, saveQueue, scheduleEmit, startProcessing])

  // A new Drive token (after reconnecting) continues uploads paused for it.
  useEffect(() => {
    accessTokenRef.current = accessToken
    if (accessToken && pausedForAuthRef.current) {
      pausedForAuthRef.current = false
      resume(['auth'])
    } else {
      scheduleEmit()
    }
  }, [accessToken, resume, scheduleEmit])

  useEffect(() => {
    documentsRef.current = documents
  }, [documents])

  // Losing the connection pauses the whole queue at once: running uploads are
  // stopped (a resumable one keeps what Drive already stored) instead of each
  // file burning its retries.
  useEffect(() => {
    const handleOffline = () => {
      if (!runningRef.current) return
      pausedForNetworkRef.current = true
      for (const controller of abortControllersRef.current.values()) controller.abort()
      scheduleEmit()
    }
    window.addEventListener('offline', handleOffline)
    return () => window.removeEventListener('offline', handleOffline)
  }, [scheduleEmit])

  // While paused for the connection, check for it to come back and resume.
  useEffect(() => {
    if (!stats.pausedForNetwork) return
    let stopped = false
    let timer: number | undefined
    let wait = 2000

    const check = async () => {
      if (stopped) return
      window.clearTimeout(timer)
      const reachable = navigator.onLine && (await isDriveReachable())
      if (stopped) return
      if (reachable) {
        pausedForNetworkRef.current = false
        resume(['offline'])
        return
      }
      wait = Math.min(wait * 2, 30000)
      timer = window.setTimeout(() => void check(), wait)
    }

    const onOnline = () => void check()
    window.addEventListener('online', onOnline)
    timer = window.setTimeout(() => void check(), wait)
    return () => {
      stopped = true
      window.clearTimeout(timer)
      window.removeEventListener('online', onOnline)
    }
  }, [stats.pausedForNetwork, resume])

  const retryFailed = useCallback(() => {
    for (const [id, item] of itemsRef.current) {
      if (item.status === 'FAILED' && !validateUploadFile(item.file)) {
        itemsRef.current.set(id, { ...item, status: 'PENDING', attempts: 0, networkFailures: 0, error: undefined, errorStatus: undefined })
      }
    }
    start()
  }, [start])

  const retryItem = useCallback((id: string) => {
    const item = itemsRef.current.get(id)
    if (!item || item.status !== 'FAILED' || validateUploadFile(item.file)) return
    itemsRef.current.set(id, { ...item, status: 'PENDING', attempts: 0, networkFailures: 0, error: undefined, errorStatus: undefined })
    start()
  }, [start])

  const resolveDuplicate = useCallback<UploadQueueContextValue['resolveDuplicate']>((target, choice) => {
    const ids = target === 'all' ? [...orderRef.current] : [target]
    const skipped: string[] = []
    for (const id of ids) {
      const item = itemsRef.current.get(id)
      if (!item || item.status !== 'PAUSED' || item.pauseReason !== 'duplicate') continue
      if (choice === 'skip') {
        itemsRef.current.delete(id)
        skipped.push(id)
      } else {
        itemsRef.current.set(id, { ...item, status: 'PENDING', pauseReason: undefined, error: undefined, duplicateOf: undefined, allowDuplicate: true })
      }
    }
    if (skipped.length > 0) {
      const removed = new Set(skipped)
      orderRef.current = orderRef.current.filter((id) => !removed.has(id))
      forgetStoredFiles(skipped)
    }
    saveQueue()
    scheduleEmit()
    if (choice === 'upload') void startProcessing()
  }, [forgetStoredFiles, saveQueue, scheduleEmit, startProcessing])

  const updateItem = useCallback<UploadQueueContextValue['updateItem']>((id, values) => {
    const item = itemsRef.current.get(id)
    if (!item || item.status === 'COMPRESSING' || item.status === 'UPLOADING' || item.status === 'COMPLETED') return
    itemsRef.current.set(id, { ...item, ...values })
    saveQueue()
    scheduleEmit()
  }, [scheduleEmit, saveQueue])

  const cancelUploads = useCallback(() => {
    pausedForAuthRef.current = false
    pausedForNetworkRef.current = false
    const removed: string[] = []
    orderRef.current = orderRef.current.filter((id) => {
      const item = itemsRef.current.get(id)
      if (!item) return false
      if (item.status === 'COMPLETED') return true
      itemsRef.current.delete(id)
      removed.push(id)
      return false
    })
    // Removed first, so the aborted uploads see they were cancelled rather than disconnected.
    for (const controller of abortControllersRef.current.values()) {
      controller.abort()
    }
    abortControllersRef.current.clear()
    forgetStoredFiles(removed)
    writeQueue()
    scheduleEmit()
  }, [forgetStoredFiles, scheduleEmit, writeQueue])

  const clearCompleted = useCallback(() => {
    orderRef.current = orderRef.current.filter((id) => itemsRef.current.get(id)?.status !== 'COMPLETED')
    const removed: string[] = []
    for (const [id, item] of itemsRef.current) {
      if (item.status === 'COMPLETED') {
        itemsRef.current.delete(id)
        removed.push(id)
      }
    }
    forgetStoredFiles(removed)
    saveQueue()
    scheduleEmit()
  }, [forgetStoredFiles, scheduleEmit, saveQueue])

  const uploadOne = async (id: string) => {
    const item = itemsRef.current.get(id)
    const user = userRef.current
    const accessToken = accessTokenRef.current
    if (!item || !user) throw new DOMException('Upload cancelled.', 'AbortError')
    if (!accessToken) {
      throw new GoogleDriveError(401, 'Google Drive authorization is required.', 'tokenMissing')
    }

    const abortController = new AbortController()
    abortControllersRef.current.set(id, abortController)
    const signal = abortController.signal
    const checkStillWanted = () => {
      if (signal.aborted || !itemsRef.current.has(id)) throw new DOMException('Upload cancelled.', 'AbortError')
    }

    try {
      // Only the vault record is missing; the file is already in Drive.
      const needsUpload = !item.driveFileId
      if (needsUpload && isFileHandleLost(item.file)) throw new FileUnavailableError()

      // The same contents already in the vault: ask before storing them twice.
      // Checked once per file, before anything is sent to Drive.
      let contentHash = item.contentHash
      if (needsUpload && !contentHash && !item.uploadSessionUri) {
        setItem(id, { status: 'COMPRESSING' })
        contentHash = (await sha256Hex(item.file)) ?? undefined
        checkStillWanted()
        if (contentHash) setItem(id, { contentHash })
      }
      if (needsUpload && contentHash && !item.allowDuplicate && !item.uploadSessionUri) {
        const match = documentsRef.current.find(
          (documentRecord) =>
            documentRecord.contentHash === contentHash && documentRecord.id !== id && !documentRecord.isDeleted && documentRecord.fileType !== 'folder',
        )
        if (match) throw new DuplicateFileError({ id: match.id, name: match.originalName || match.name, folderPath: match.folderPath ?? '' })
      }

      let uploadFile = item.file
      let originalSize = item.file.size
      let compressedSize = item.file.size
      let savedPercentage = 0

      if (needsUpload) {
        try {
          const result = await compressFile(item.file, (progress) => setItem(id, { progress: Math.max(item.progress, Math.min(5 + Math.round(progress / 20), 10)) }))
          checkStillWanted()
          if (result.blob !== item.file) {
            uploadFile = new File([result.blob], item.file.name, { type: result.blob.type || item.file.type })
          }
          originalSize = result.originalSize
          compressedSize = result.compressedSize
          savedPercentage = result.savedPercentage
        } catch (error) {
          checkStillWanted()
          console.warn('Compression failed, uploading original:', item.relativePath ?? item.file.name, error)
        }
      }

      checkStillWanted()

      setItem(id, {
        status: 'UPLOADING',
        progress: Math.max(itemsRef.current.get(id)?.progress ?? 0, item.driveFileId ? 90 : 12),
        originalSize,
        compressedSize,
        savedPercentage,
      })

      const destination = await resolveDestination(item, user, accessToken)
      checkStillWanted()

      let driveFileId = item.driveFileId
      let driveFileName = item.file.name
      let driveMimeType = item.file.type || 'application/octet-stream'
      let driveWebViewLink: string | undefined
      let thumbnailUrl: string | undefined
      const fileName = getUploadFileName(item)

      // A stored session already tells whether Drive has the file, so the
      // name lookup is only needed for a fresh start.
      if (!driveFileId && !item.uploadSessionUri) {
        try {
          const existingDriveFile = await findFileInDrive(accessToken, fileName, destination.driveFolderId)
          if (existingDriveFile && Number(existingDriveFile.size) === uploadFile.size) {
            driveFileId = existingDriveFile.id
            driveFileName = existingDriveFile.name
            driveMimeType = existingDriveFile.mimeType
            driveWebViewLink = existingDriveFile.webViewLink
            thumbnailUrl = existingDriveFile.thumbnailLink
            setItem(id, { driveFileId, driveFolderId: destination.driveFolderId, progress: 90 })
          }
        } catch (err) {
          if (isDriveAuthorizationError(err) || isNetworkError(err)) throw err
          checkStillWanted()
          console.warn('Failed to check if file exists in Drive, proceeding with upload:', err)
        }
      }

      if (!driveFileId) {
        const namedFile = uploadFile.name === fileName ? uploadFile : new File([uploadFile], fileName, { type: uploadFile.type })
        // Bytes sent map onto 15-90% of the bar. Progress ticks only refresh the
        // view; they skip saveQueue so large uploads don't rewrite storage constantly.
        let lastPercent = -1
        const onProgress = (loaded: number, total: number) => {
          const percent = 15 + Math.floor((loaded / Math.max(total, 1)) * 75)
          const current = itemsRef.current.get(id)
          if (!current || percent === lastPercent) return
          lastPercent = percent
          itemsRef.current.set(id, { ...current, progress: percent })
          scheduleEmit()
        }
        const driveFile =
          namedFile.size > RESUMABLE_UPLOAD_THRESHOLD
            ? await uploadResumable(id, accessToken, namedFile, destination.driveFolderId, {
                signal,
                onProgress,
                // A compressed copy is rebuilt on each attempt and may differ by a
                // byte, so only the original file can continue an earlier session.
                canContinue: uploadFile === item.file,
              })
            : await uploadFileToDrive(accessToken, namedFile, destination.driveFolderId, { signal, onProgress })
        checkStillWanted()
        driveFileId = driveFile.id
        driveFileName = driveFile.name
        driveMimeType = driveFile.mimeType
        driveWebViewLink = driveFile.webViewLink
        thumbnailUrl = driveFile.thumbnailLink
        setItem(id, {
          driveFileId,
          driveFolderId: destination.driveFolderId,
          progress: 90,
          uploadSessionUri: undefined,
          uploadSessionSize: undefined,
        })
        // Written now: closing the tab from here on must not upload the file twice.
        writeQueue()
      }

      if (!itemsRef.current.get(id)?.firestoreSaved) {
        const metadata: NewDocumentMetadata = {
          ownerId: user.uid,
          name: stripExtension(fileName),
          originalName: fileName || driveFileName,
          mimeType: item.file.type || driveMimeType,
          fileType: getDocumentKind(item.file),
          fileSize: item.file.size,
          category: item.category,
          description: item.description,
          driveFileId,
          driveFolderId: destination.driveFolderId,
          parentId: destination.vaultFolderId,
          folderId: destination.vaultFolderId,
          folderPath: destination.folderPath,
          contentHash: itemsRef.current.get(id)?.contentHash,
        }
        if (driveWebViewLink) metadata.driveWebViewLink = driveWebViewLink
        if (thumbnailUrl) metadata.thumbnailUrl = thumbnailUrl

        // The queue item id names the record, so a retry rewrites the same record.
        const docRef = await createDocumentRecord(metadata, id)
        setItem(id, { firestoreDocumentId: docRef.id, firestoreSaved: true, progress: 95 })
        if (!isFileHandleLost(item.file)) {
          // The file is still in memory, so its text is indexed for content search now.
          queueContentIndex({ id: docRef.id, name: metadata.name, originalName: metadata.originalName, mimeType: metadata.mimeType, fileType: metadata.fileType }, item.file)
        }
        // Prepares the preview in the background, so the file opens at once.
        // The bytes sent to Drive (compressed or not) are reused when this run
        // uploaded them; a resumed upload's file is fetched from Drive instead.
        const uploaded = needsUpload && !isFileHandleLost(uploadFile) ? uploadFile : undefined
        enqueuePreview({ ...metadata, id: docRef.id, isFavorite: false, isDeleted: false, version: 1 } as VaultDocument, 'upload', uploaded)
      }
    } finally {
      abortControllersRef.current.delete(id)
    }
  }

  /** Sends a large file through a resumable session, continuing a stored one when possible. */
  const uploadResumable = async (
    id: string,
    accessToken: string,
    file: File,
    folderId: string,
    options: { signal: AbortSignal; onProgress: (loaded: number, total: number) => void; canContinue: boolean },
  ): Promise<DriveFile> => {
    const current = itemsRef.current.get(id)
    let sessionUri = options.canContinue && current?.uploadSessionSize === file.size ? current.uploadSessionUri : undefined
    let offset = 0

    if (sessionUri) {
      try {
        const status = await queryResumableUpload(accessToken, sessionUri, file.size, options.signal)
        if (status.done === true) return status.file
        offset = status.nextOffset
      } catch (error) {
        if (!(error instanceof GoogleDriveError && error.reason === 'uploadSessionExpired')) throw error
        sessionUri = undefined
      }
    }

    if (!sessionUri) {
      sessionUri = await createResumableUpload(accessToken, file, folderId, options.signal)
      offset = 0
      setItem(id, { uploadSessionUri: sessionUri, uploadSessionSize: file.size, uploadedBytes: 0 })
      writeQueue()
    }

    options.onProgress(offset, file.size)
    return continueResumableUpload(accessToken, sessionUri, file, offset, {
      signal: options.signal,
      onProgress: options.onProgress,
      onChunkStored: (nextOffset) => setItem(id, { uploadedBytes: nextOffset }),
    })
  }

  const findExistingCompletedRecord = (item: QueueRecord) => {
    const fileName = getUploadFileName(item).toLowerCase()
    const normalizedRelativePath = pathKey(item.relativePath ?? item.file.name)
    const isFlatUpload = normalizedRelativePath === pathKey(item.file.name)

    return documentsRef.current.find((documentRecord) => {
      if (documentRecord.fileType === 'folder') return false
      // The record this item wrote itself, before its reply was lost.
      if (documentRecord.id === item.id) return true
      if (documentRecord.fileSize !== item.file.size) return false
      if (documentRecord.originalName.toLowerCase() !== fileName) return false
      if (isFlatUpload) {
        return (documentRecord.parentId ?? null) === item.destinationFolderId
      }

      const recordPath = pathKey(
        [documentRecord.folderPath, documentRecord.originalName].filter(Boolean).join('/'),
      )
      return recordPath === normalizedRelativePath
    })
  }

  const value = useMemo(
    () => ({ items: visibleItems, stats, enqueueFiles, start, retryFailed, retryItem, resolveDuplicate, updateItem, cancelUploads, clearCompleted }),
    [cancelUploads, clearCompleted, enqueueFiles, retryFailed, retryItem, resolveDuplicate, start, stats, updateItem, visibleItems],
  )

  return <UploadQueueContext.Provider value={value}>{children}</UploadQueueContext.Provider>

  async function resolveDestination(item: QueueRecord, activeUser: VaultUser, token: string) {
    const normalizedPath = normalizeRelativePath(item.relativePath || item.file.name)
    const pathParts = normalizedPath.split('/').filter(Boolean)
    pathParts.pop()

    let currentVaultFolderId = item.destinationFolderId
    let currentDriveFolderId: string
    let folderPath = currentVaultFolderId ? buildFolderPath(documentsRef.current, currentVaultFolderId) : ''

    if (currentVaultFolderId) {
      const parentFolder = documentsRef.current.find((documentRecord) => documentRecord.id === currentVaultFolderId)
      if (!parentFolder) throw new Error('Upload destination folder was not found.')
      currentDriveFolderId = parentFolder.driveFileId
    } else {
      currentDriveFolderId = (await getUserVaultFolder(activeUser, token)).id
      if (pathParts.length === 0) {
        const categoryFolder = await getOrCreateManagedFolder(activeUser.uid, token, item.category, null, currentDriveFolderId)
        currentVaultFolderId = categoryFolder.id
        currentDriveFolderId = categoryFolder.driveFileId
        folderPath = categoryFolder.name
      }
    }

    for (const folderName of pathParts) {
      const folder = await getOrCreateManagedFolder(activeUser.uid, token, folderName, currentVaultFolderId, currentDriveFolderId)
      currentVaultFolderId = folder.id
      currentDriveFolderId = folder.driveFileId
      folderPath = folderPath ? `${folderPath} / ${folder.name}` : folder.name
    }

    return { vaultFolderId: currentVaultFolderId, driveFolderId: currentDriveFolderId, folderPath }
  }

  /** One lookup per account, shared by concurrent uploads so the root folder is never created twice. */
  function getUserVaultFolder(activeUser: VaultUser, token: string) {
    if (vaultFolderRef.current?.uid === activeUser.uid) return vaultFolderRef.current.folder
    const folder = ensureUserVaultFolder(activeUser, token)
    vaultFolderRef.current = { uid: activeUser.uid, folder }
    folder.catch(() => {
      if (vaultFolderRef.current?.folder === folder) vaultFolderRef.current = null
    })
    return folder
  }

  async function ensureManagedFolder(
    ownerId: string,
    token: string,
    folderName: string,
    parentFolderId: string | null,
    driveParentId: string,
  ): Promise<ManagedFolder> {
    const existingFolder = documentsRef.current.find(
      (documentRecord) =>
        documentRecord.fileType === 'folder' &&
        documentRecord.name.toLowerCase() === folderName.toLowerCase() &&
        (documentRecord.parentId ?? null) === parentFolderId,
    )
    if (existingFolder) {
      return {
        id: existingFolder.id,
        driveFileId: existingFolder.driveFileId,
        name: existingFolder.name,
        parentId: existingFolder.parentId ?? null,
      }
    }

    const driveFolder = await ensureDriveFolder(token, folderName, driveParentId)
    const folderRef = await createFolderRecord({ ownerId, name: folderName, parentFolderId, driveFolderId: driveFolder.id })
    return { id: folderRef.id, driveFileId: driveFolder.id, name: folderName, parentId: parentFolderId }
  }

  async function getOrCreateManagedFolder(
    ownerId: string,
    token: string,
    folderName: string,
    parentFolderId: string | null,
    driveParentId: string,
  ) {
    const key = `${ownerId}|${parentFolderId ?? 'root'}|${folderName.toLowerCase()}`
    const cached = folderCacheRef.current.get(key)
    if (cached) return cached

    const pending = ensureManagedFolder(ownerId, token, folderName, parentFolderId, driveParentId)
    folderCacheRef.current.set(key, pending)

    try {
      const folder = await pending
      folderCacheRef.current.set(key, folder)
      return folder
    } catch (error) {
      folderCacheRef.current.delete(key)
      throw error
    }
  }
}

export function useUploadQueue() {
  const value = useContext(UploadQueueContext)
  if (!value) throw new Error('useUploadQueue must be used inside UploadQueueProvider.')
  return value
}

/** The file's contents are no longer readable (lost on reload, or removed from disk). */
class DuplicateFileError extends Error {
  readonly match: DuplicateMatch

  constructor(match: DuplicateMatch) {
    super(`Already in your vault as "${match.name}"${match.folderPath ? ` in ${match.folderPath}` : ''}.`)
    this.name = 'DuplicateFileError'
    this.match = match
  }
}

class FileUnavailableError extends Error {
  constructor() {
    super(NEEDS_FILE_MESSAGE)
    this.name = 'FileUnavailableError'
  }
}

function queueStorageKey(uid: string) {
  return `documentVault.uploadQueue.${uid}`
}

function readStoredQueue(uid: string): StoredQueueItem[] {
  try {
    const raw = localStorage.getItem(queueStorageKey(uid))
    return raw ? (JSON.parse(raw) as StoredQueueItem[]) : []
  } catch (error) {
    console.error('Failed to parse stored queue', error)
    return []
  }
}

/** A saved item, with an empty stand-in file until its stored copy is found. */
function restoreItem(item: StoredQueueItem): QueueRecord {
  const placeholder = new File([], item.name, { type: item.type })
  Object.defineProperty(placeholder, 'size', { value: item.size })
  placeholderFiles.add(placeholder)
  const unfinished = item.status !== 'COMPLETED' && item.status !== 'FAILED'
  return {
    id: item.id,
    file: placeholder,
    // Unfinished items wait while their stored copies load.
    status: unfinished ? 'PAUSED' : item.status,
    pauseReason: unfinished ? item.pauseReason : undefined,
    progress: item.progress,
    category: item.category,
    description: item.description,
    relativePath: item.relativePath,
    rootFolderName: item.rootFolderName,
    destinationFolderId: item.destinationFolderId,
    error: item.error,
    errorStatus: item.errorStatus,
    attempts: item.attempts,
    driveFileId: item.driveFileId,
    driveFolderId: item.driveFolderId,
    firestoreDocumentId: item.firestoreDocumentId,
    lastAttemptAt: item.lastAttemptAt,
    originalSize: item.originalSize,
    compressedSize: item.compressedSize,
    savedPercentage: item.savedPercentage,
    firestoreSaved: item.firestoreSaved,
    uploadSessionUri: item.uploadSessionUri,
    uploadSessionSize: item.uploadSessionSize,
    uploadedBytes: item.uploadedBytes,
    contentHash: item.contentHash,
    duplicateOf: item.duplicateOf,
    allowDuplicate: item.allowDuplicate,
  }
}

function hasWork(items: Map<string, QueueRecord>) {
  for (const item of items.values()) {
    if (item.status === 'PENDING' || item.status === 'RETRYING') return true
  }
  return false
}

async function ensureUserVaultFolder(user: VaultUser, accessToken: string) {
  const profile = await getUserProfile(user.uid)
  if (profile?.driveFolderId) return { id: profile.driveFolderId, name: 'Document Vault' }

  const rootFolder = await ensureVaultFolder(accessToken)
  await updateUserDriveConnection(user.uid, rootFolder.id)
  return rootFolder
}

function getRelativePath(file: File) {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
}

function getUploadFileName(item: QueueRecord) {
  const normalizedPath = normalizeRelativePath(item.relativePath || item.file.name)
  return normalizedPath.split('/').filter(Boolean).pop() ?? item.file.name
}

function buildFolderPath(documents: VaultDocument[], folderId: string | null) {
  const names: string[] = []
  let current = folderId ? documents.find((documentRecord) => documentRecord.id === folderId) : undefined
  while (current) {
    names.unshift(current.name)
    current = current.parentId ? documents.find((documentRecord) => documentRecord.id === current?.parentId) : undefined
  }
  return names.join(' / ')
}

function pathKey(path: string) {
  return normalizeRelativePath(path).replace(/\s*\/\s*/g, '/').toLowerCase()
}

function toUploadItem(item: QueueRecord): UploadItem {
  const { destinationFolderId, firestoreSaved, uploadSessionUri, uploadSessionSize, uploadedBytes, networkFailures, ...uploadItem } = item
  void destinationFolderId
  void firestoreSaved
  void uploadSessionUri
  void uploadSessionSize
  void uploadedBytes
  void networkFailures
  return uploadItem
}

const rateLimitReasons = new Set(['ratelimitexceeded', 'userratelimitexceeded', 'backenderror'])

function isTemporaryUploadError(error: unknown) {
  if (error instanceof GoogleDriveError) {
    if (error.status === 403 && rateLimitReasons.has(error.reason?.toLowerCase() ?? '')) return true
    return [408, 429, 500, 502, 503, 504].includes(error.status)
  }
  if (error instanceof TypeError) return true
  if (error instanceof Error) {
    const isFirebaseError = error.name === 'FirebaseError' || hasErrorCode(error)
    const isNetworkOrTimeout = /network|timeout|failed to fetch|unavailable|offline/i.test(error.message)
    return isFirebaseError || isNetworkOrTimeout
  }
  return false
}

function hasErrorCode(error: Error): error is Error & { code: unknown } {
  return 'code' in error
}

function getBackoffMs(attempt: number, status?: number) {
  const base = status === 429 || status === 403 ? 2500 : 1000
  const jitter = Math.floor(Math.random() * 500)
  return Math.min(30000, base * 2 ** (attempt - 1) + jitter)
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function getUploadErrorMessage(error: unknown) {
  if (error instanceof GoogleDriveError) {
    const reason = error.reason ? ` (${error.reason})` : ''
    if (isDriveAuthorizationError(error)) {
      return 'Google Drive needs reconnecting. This upload is paused and continues after you reconnect.'
    }
    if (error.status === 403 && /storageQuotaExceeded|quotaExceeded/i.test(error.reason ?? '')) {
      return 'Your Google Drive is full. Free up space in Drive, then retry.'
    }
    return `Google Drive request failed ${error.status}${reason}: ${error.message}`
  }
  if (error instanceof Error) return error.message || 'Upload failed.'
  return 'Upload failed.'
}
