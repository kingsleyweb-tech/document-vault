/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createDocumentRecord, createFolderRecord } from '../services/firestore'
import {
  ensureDriveFolder,
  ensureVaultFolder,
  findFileInDrive,
  GoogleDriveError,
  isDriveAuthorizationError,
  uploadFileToDrive,
} from '../services/googleDrive'
import { getUserProfile, updateUserDriveConnection } from '../services/users'
import { clearDriveAccessToken } from '../services/auth'
import type { DocumentCategory, NewDocumentMetadata, UploadItem, VaultDocument } from '../types/document'
import type { VaultUser } from '../types/user'
import { compressFile } from '../utils/compressor'
import { getDocumentKind, normalizeRelativePath, stripExtension } from '../utils/fileUtils'
import { validateUploadFile } from '../utils/validators'
import type { UploadStatus } from '../types/document'

interface StoredQueueItem {
  id: string
  name: string
  size: number
  type: string
  status: UploadStatus
  progress: number
  category: DocumentCategory
  description: string
  relativePath?: string
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
}

function isFileHandleLost(file: File) {
  return file.size > 0 && file.slice().size === 0
}

const MAX_CONCURRENT_UPLOADS = 5
const MAX_ATTEMPTS = 4
const VISIBLE_ITEM_LIMIT = 220

interface UploadQueueStats {
  total: number
  pending: number
  uploading: number
  completed: number
  failed: number
  retrying: number
  retries: number
  progress: number
  currentFile?: string
  running: boolean
  pausedForAuth: boolean
  lastError?: string
}

interface UploadQueueContextValue {
  items: UploadItem[]
  stats: UploadQueueStats
  enqueueFiles: (files: FileList | File[], category: DocumentCategory, description: string, destinationFolderId: string | null) => void
  start: () => void
  retryFailed: () => void
  retryItem: (id: string) => void
  updateItem: (id: string, values: Pick<Partial<UploadItem>, 'category' | 'description'>) => void
  clearCompleted: () => void
}

const emptyStats: UploadQueueStats = {
  total: 0,
  pending: 0,
  uploading: 0,
  completed: 0,
  failed: 0,
  retrying: 0,
  retries: 0,
  progress: 0,
  running: false,
  pausedForAuth: false,
}

const UploadQueueContext = createContext<UploadQueueContextValue | null>(null)

interface QueueRecord extends UploadItem {
  destinationFolderId: string | null
  firestoreSaved?: boolean
}

interface ManagedFolder {
  id: string
  driveFileId: string
  name: string
  parentId: string | null
}

type ManagedFolderCacheEntry = ManagedFolder | Promise<ManagedFolder>

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
  const emitTimerRef = useRef<number | null>(null)
  const folderCacheRef = useRef(new Map<string, ManagedFolderCacheEntry>())

  const [visibleItems, setVisibleItems] = useState<UploadItem[]>([])
  const [stats, setStats] = useState<UploadQueueStats>(emptyStats)

  const emit = useCallback(() => {
    emitTimerRef.current = null
    let pending = 0
    let uploading = 0
    let completed = 0
    let failed = 0
    let retrying = 0
    let retries = 0
    let currentFile: string | undefined
    let lastError: string | undefined
    const prioritized: QueueRecord[] = []

    for (const id of orderRef.current) {
      const item = itemsRef.current.get(id)
      if (!item) continue
      retries += item.attempts ?? 0
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

      if (
        prioritized.length < VISIBLE_ITEM_LIMIT &&
        (item.status === 'FAILED' ||
          item.status === 'UPLOADING' ||
          item.status === 'COMPRESSING' ||
          item.status === 'RETRYING')
      ) {
        prioritized.push(item)
      }
    }

    for (const id of orderRef.current) {
      if (prioritized.length >= VISIBLE_ITEM_LIMIT) break
      const item = itemsRef.current.get(id)
      if (!item || prioritized.includes(item)) continue
      prioritized.push(item)
    }

    const total = orderRef.current.length
    setStats({
      total,
      pending,
      uploading,
      completed,
      failed,
      retrying,
      retries,
      progress: total === 0 ? 0 : Math.round(((completed + failed) / total) * 1000) / 10,
      currentFile,
      running: runningRef.current,
      pausedForAuth: pausedForAuthRef.current,
      lastError,
    })
    setVisibleItems(prioritized.map(toUploadItem))
  }, [])

  const scheduleEmit = useCallback(() => {
    if (emitTimerRef.current !== null) return
    emitTimerRef.current = window.setTimeout(emit, 100)
  }, [emit])

  const saveQueue = useCallback(() => {
    const activeUser = userRef.current
    if (!activeUser) return
    const list: StoredQueueItem[] = []
    for (const id of orderRef.current) {
      const item = itemsRef.current.get(id)
      if (!item) continue
      list.push({
        id: item.id,
        name: item.file.name,
        size: item.file?.size || item.originalSize || 0,
        type: item.file?.type || '',
        status: item.status === 'UPLOADING' || item.status === 'COMPRESSING' || item.status === 'RETRYING' ? 'PAUSED' : item.status,
        progress: item.progress,
        category: item.category,
        description: item.description,
        relativePath: item.relativePath,
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
      })
    }
    localStorage.setItem(`documentVault.uploadQueue.${activeUser.uid}`, JSON.stringify(list))
  }, [])

  const setItem = useCallback((id: string, values: Partial<QueueRecord>) => {
    const item = itemsRef.current.get(id)
    if (!item) return
    itemsRef.current.set(id, { ...item, ...values })
    saveQueue()
    scheduleEmit()
  }, [scheduleEmit, saveQueue])

  useEffect(() => {
    userRef.current = user
    if (!user) {
      itemsRef.current.clear()
      orderRef.current = []
      window.setTimeout(() => {
        setVisibleItems([])
        setStats(emptyStats)
      }, 0)
      return
    }

    const map = new Map<string, QueueRecord>()
    const order: string[] = []
    const raw = localStorage.getItem(`documentVault.uploadQueue.${user.uid}`)
    if (raw) {
      try {
        const list = JSON.parse(raw) as StoredQueueItem[]
        for (const item of list) {
          const dummyFile = new File([], item.name, { type: item.type })
          Object.defineProperty(dummyFile, 'size', { value: item.size })
          map.set(item.id, {
            id: item.id,
            file: dummyFile,
            status: item.status,
            progress: item.progress,
            category: item.category,
            description: item.description,
            relativePath: item.relativePath,
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
          })
          order.push(item.id)
        }
      } catch (e) {
        console.error('Failed to parse stored queue', e)
      }
    }

    itemsRef.current = map
    orderRef.current = order
    emit()
  }, [user, emit])

  useEffect(() => {
    accessTokenRef.current = accessToken
    scheduleEmit()
  }, [accessToken, scheduleEmit])

  useEffect(() => {
    documentsRef.current = documents
  }, [documents])

  const enqueueFiles = useCallback<UploadQueueContextValue['enqueueFiles']>((files, category, description, destinationFolderId) => {
    const nextItems = Array.from(files).map((file): QueueRecord | null => {
      const error = validateUploadFile(file)
      const relativePath = getRelativePath(file)

      // Look for a matching non-completed item in itemsRef
      let existingId: string | null = null
      for (const [id, item] of itemsRef.current) {
        if (item.status !== 'COMPLETED' && item.relativePath === relativePath && item.file.size === file.size) {
          existingId = id
          break
        }
      }

      if (existingId) {
        // Update existing item with the real File object (re-link handle)
        const existing = itemsRef.current.get(existingId)!
        itemsRef.current.set(existingId, {
          ...existing,
          file,
          status: error ? 'FAILED' : 'PENDING',
          error: error ?? undefined,
        })
        return null
      }

      return {
        id: crypto.randomUUID(),
        file,
        status: error ? 'FAILED' : 'PENDING',
        progress: error ? 0 : 0,
        category,
        description,
        relativePath,
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
    saveQueue()
    scheduleEmit()
  }, [scheduleEmit, saveQueue])

  const processItem = useCallback(async (id: string) => {
    const item = itemsRef.current.get(id)
    if (!item) return

    for (;;) {
      const current = itemsRef.current.get(id)
      if (!current) return
      const attempts = (current.attempts ?? 0) + 1
      setItem(id, {
        status: 'COMPRESSING',
        progress: Math.min(15, current.progress || 5),
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
          })
          return
        }

        await uploadOne(id)
        setItem(id, { status: 'COMPLETED', progress: 100, firestoreSaved: true })
        return
      } catch (error) {
        const message = getUploadErrorMessage(error)
        const status = error instanceof GoogleDriveError ? error.status : undefined
        console.error('Upload queue item failed', {
          file: current.relativePath ?? current.file.name,
          status,
          reason: error instanceof GoogleDriveError ? error.reason : undefined,
          attempt: attempts,
          error,
        })

        if (isDriveAuthorizationError(error)) {
          clearDriveAccessToken()
          pausedForAuthRef.current = true
          setItem(id, { status: 'PAUSED', progress: current.progress, error: message, errorStatus: status })
          return
        }

        if (attempts < MAX_ATTEMPTS && isTemporaryUploadError(error)) {
          setItem(id, { status: 'RETRYING', progress: 0, error: message, errorStatus: status })
          await delay(getBackoffMs(attempts, status))
          continue
        }

        setItem(id, { status: 'FAILED', progress: 0, error: message, errorStatus: status })
        return
      }
    }
    // uploadOne reads from refs so queued work always uses the latest token/document snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setItem])

  const startProcessing = useCallback(async () => {
    if (runningRef.current || pausedForAuthRef.current) return
    runningRef.current = true
    scheduleEmit()

    async function worker() {
      for (;;) {
        if (pausedForAuthRef.current) return
        const nextId = orderRef.current.find((id) => {
          const item = itemsRef.current.get(id)
          return item?.status === 'PENDING' || item?.status === 'RETRYING'
        })
        if (!nextId) return
        const item = itemsRef.current.get(nextId)
        if (!item) continue
        itemsRef.current.set(nextId, { ...item, status: 'UPLOADING', progress: Math.max(item.progress, 10) })
        scheduleEmit()
        await processItem(nextId)
      }
    }

    try {
      await Promise.all(Array.from({ length: MAX_CONCURRENT_UPLOADS }, worker))
    } finally {
      runningRef.current = false
      scheduleEmit()
    }
  }, [processItem, scheduleEmit])

  const start = useCallback(() => {
    pausedForAuthRef.current = false
    // Reset all PAUSED items back to PENDING so they are retried
    for (const [id, item] of itemsRef.current) {
      if (item.status === 'PAUSED') {
        itemsRef.current.set(id, { ...item, status: 'PENDING' })
      }
    }
    saveQueue()
    scheduleEmit()
    void startProcessing()
  }, [startProcessing, saveQueue, scheduleEmit])

  const retryFailed = useCallback(() => {
    for (const [id, item] of itemsRef.current) {
      if (item.status === 'FAILED' && !validateUploadFile(item.file)) {
        itemsRef.current.set(id, { ...item, status: 'RETRYING', progress: 0, error: undefined, errorStatus: undefined })
      }
    }
    start()
    scheduleEmit()
  }, [scheduleEmit, start])

  const retryItem = useCallback((id: string) => {
    const item = itemsRef.current.get(id)
    if (!item || item.status !== 'FAILED' || validateUploadFile(item.file)) return
    itemsRef.current.set(id, { ...item, status: 'RETRYING', progress: 0, error: undefined, errorStatus: undefined })
    start()
    scheduleEmit()
  }, [scheduleEmit, start])

  const updateItem = useCallback<UploadQueueContextValue['updateItem']>((id, values) => {
    const item = itemsRef.current.get(id)
    if (!item || item.status === 'COMPRESSING' || item.status === 'UPLOADING' || item.status === 'COMPLETED') return
    itemsRef.current.set(id, { ...item, ...values })
    saveQueue()
    scheduleEmit()
  }, [scheduleEmit, saveQueue])

  const clearCompleted = useCallback(() => {
    orderRef.current = orderRef.current.filter((id) => itemsRef.current.get(id)?.status !== 'COMPLETED')
    for (const [id, item] of itemsRef.current) {
      if (item.status === 'COMPLETED') itemsRef.current.delete(id)
    }
    saveQueue()
    scheduleEmit()
  }, [scheduleEmit, saveQueue])

  const uploadOne = async (id: string) => {
    const item = itemsRef.current.get(id)
    const user = userRef.current
    const accessToken = accessTokenRef.current
    if (!item || !user) return
    if (!accessToken) {
      throw new GoogleDriveError(401, 'Google Drive authorization is required.', 'tokenMissing')
    }

    if (isFileHandleLost(item.file)) {
      throw new Error('File content is unavailable. Please re-add this file or folder to resume.')
    }

    let uploadFile = item.file
    let originalSize = item.file.size
    let compressedSize = item.file.size
    let savedPercentage = 0

    if (!item.driveFileId) {
      try {
        const result = await compressFile(item.file, (progress) => setItem(id, { progress: Math.max(5, Math.min(progress, 45)) }))
        uploadFile = new File([result.blob], item.file.name, { type: result.blob.type || item.file.type })
        originalSize = result.originalSize
        compressedSize = result.compressedSize
        savedPercentage = result.savedPercentage
      } catch (error) {
        console.warn('Compression failed, uploading original:', item.relativePath ?? item.file.name, error)
      }
    }

    setItem(id, {
      status: 'UPLOADING',
      progress: item.driveFileId ? 85 : 50,
      originalSize,
      compressedSize,
      savedPercentage,
    })

    const destination = await resolveDestination(item, user, accessToken)
    let driveFileId = item.driveFileId
    let driveFileName = item.file.name
    let driveMimeType = item.file.type || 'application/octet-stream'
    let driveWebViewLink: string | undefined
    let thumbnailUrl: string | undefined

    if (!driveFileId) {
      const fileName = getUploadFileName(item)
      // Check if file already exists in Google Drive (reconcile)
      try {
        const existingDriveFile = await findFileInDrive(accessToken, fileName, destination.driveFolderId)
        if (existingDriveFile && Number(existingDriveFile.size) === uploadFile.size) {
          console.log(`Reconciled: File "${fileName}" already exists in Google Drive. Skipping upload.`, existingDriveFile)
          driveFileId = existingDriveFile.id
          driveFileName = existingDriveFile.name
          driveMimeType = existingDriveFile.mimeType
          driveWebViewLink = existingDriveFile.webViewLink
          thumbnailUrl = existingDriveFile.thumbnailLink
          setItem(id, {
            driveFileId,
            driveFolderId: destination.driveFolderId,
            progress: 85,
          })
        }
      } catch (err) {
        if (isDriveAuthorizationError(err)) throw err
        console.warn('Failed to check if file exists in Drive, proceeding with upload:', err)
      }
    }

    if (!driveFileId) {
      const fileName = getUploadFileName(item)
      const namedFile = uploadFile.name === fileName ? uploadFile : new File([uploadFile], fileName, { type: uploadFile.type })
      const driveFile = await uploadFileToDrive(accessToken, namedFile, destination.driveFolderId)
      driveFileId = driveFile.id
      driveFileName = driveFile.name
      driveMimeType = driveFile.mimeType
      driveWebViewLink = driveFile.webViewLink
      thumbnailUrl = driveFile.thumbnailLink
      setItem(id, {
        driveFileId,
        driveFolderId: destination.driveFolderId,
        progress: 85,
      })
    }

    if (!itemsRef.current.get(id)?.firestoreSaved) {
      const fileName = getUploadFileName(item)
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
      }
      if (driveWebViewLink) metadata.driveWebViewLink = driveWebViewLink
      if (thumbnailUrl) metadata.thumbnailUrl = thumbnailUrl

      const docRef = await createDocumentRecord(metadata)
      setItem(id, { firestoreDocumentId: docRef.id, firestoreSaved: true, progress: 95 })
    }
  }

  const findExistingCompletedRecord = (item: QueueRecord) => {
    const fileName = getUploadFileName(item).toLowerCase()
    const normalizedRelativePath = pathKey(item.relativePath ?? item.file.name)
    const isFlatUpload = normalizedRelativePath === pathKey(item.file.name)

    return documentsRef.current.find((documentRecord) => {
      if (documentRecord.fileType === 'folder') return false
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
    () => ({ items: visibleItems, stats, enqueueFiles, start, retryFailed, retryItem, updateItem, clearCompleted }),
    [clearCompleted, enqueueFiles, retryFailed, retryItem, start, stats, updateItem, visibleItems],
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
      currentDriveFolderId = (await ensureUserVaultFolder(activeUser, token)).id
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
  const { destinationFolderId, firestoreSaved, ...uploadItem } = item
  void destinationFolderId
  void firestoreSaved
  return uploadItem
}

function isTemporaryUploadError(error: unknown) {
  if (error instanceof GoogleDriveError) {
    return [429, 500, 502, 503, 504].includes(error.status)
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
  const base = status === 429 ? 2500 : 1000
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
      return `Google Drive authorization is required${reason}. Your upload has been paused safely.`
    }
    return `Google Drive request failed ${error.status}${reason}: ${error.message}`
  }
  if (error instanceof Error) return error.message || 'Upload failed.'
  return 'Upload failed.'
}
