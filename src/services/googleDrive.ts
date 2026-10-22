import type { DriveFile, DriveFolder } from '../types/googleDrive'
import { saveOfflineBlob, getOfflineBlob } from './offlineStore'

const driveApi = 'https://www.googleapis.com/drive/v3'
const driveUploadApi = 'https://www.googleapis.com/upload/drive/v3'
const folderMimeType = 'application/vnd.google-apps.folder'
const vaultFolderName = 'Document Vault'

interface GoogleApiErrorBody {
  error?: {
    code?: number
    message?: string
    status?: string
    errors?: Array<{ reason?: string; message?: string }>
  }
}

interface DriveRequestOptions {
  signal?: AbortSignal
  /** Called as request bytes are sent. Only used by uploads. */
  onProgress?: (loaded: number, total: number) => void
}

export class GoogleDriveError extends Error {
  status: number
  reason?: string

  constructor(status: number, message: string, reason?: string) {
    super(message)
    this.name = 'GoogleDriveError'
    this.status = status
    this.reason = reason
  }
}

export function isDriveAuthorizationError(error: unknown) {
  if (!(error instanceof GoogleDriveError)) return false
  const reason = error.reason?.toLowerCase()
  return (
    error.status === 401 ||
    (error.status === 403 &&
      (reason === 'autherror' ||
        reason === 'insufficientpermissions' ||
        reason === 'insufficientpermission' ||
        reason === 'forbidden'))
  )
}

async function parseDriveError(response: Response) {
  const details = await response.text()

  try {
    const parsed = JSON.parse(details) as GoogleApiErrorBody
    const reason = parsed.error?.errors?.[0]?.reason ?? parsed.error?.status
    return new GoogleDriveError(
      response.status,
      parsed.error?.message ?? `Google Drive request failed with status ${response.status}.`,
      reason,
    )
  } catch {
    return new GoogleDriveError(response.status, details || 'Google Drive request failed.')
  }
}

async function fetchWithRetry(url: string, init: RequestInit = {}, maxRetries = 3): Promise<Response> {
  let attempt = 0
  let delay = 500

  while (attempt <= maxRetries) {
    try {
      const response = await fetch(url, init)
      const isTransientError = response.status === 429 || (response.status >= 500 && response.status <= 504)
      if (isTransientError && attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delay))
        delay *= 2
        attempt += 1
        continue
      }
      return response
    } catch (err) {
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delay))
        delay *= 2
        attempt += 1
        continue
      }
      throw err
    }
  }
  return fetch(url, init)
}

async function driveFetch<T>(accessToken: string, url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetchWithRetry(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    },
  })

  if (!response.ok) {
    throw await parseDriveError(response)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

export function getDriveEmbedPreviewUrl(fileId: string): string {
  return `${driveApi}/files/${encodeURIComponent(fileId)}/preview`
}

function escapeDriveQuery(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

// ─── In-memory blob cache ─────────────────────────────────────────────────────
// Keeps the last N blobs in memory so reopening a recently viewed document is
// instant (no network round trip at all).

const BLOB_CACHE_MAX = 8

interface BlobCacheEntry {
  blob: Blob
  mimeType: string
  accessedAt: number
}

const blobCache = new Map<string, BlobCacheEntry>()

function blobCacheKey(fileId: string, mimeType: string) {
  return `${fileId}::${mimeType}`
}

function getBlobFromCache(fileId: string, mimeType: string): Blob | null {
  const key = blobCacheKey(fileId, mimeType)
  const entry = blobCache.get(key)
  if (!entry) return null
  entry.accessedAt = Date.now()
  return entry.blob
}

function storeBlobInCache(fileId: string, mimeType: string, blob: Blob) {
  const key = blobCacheKey(fileId, mimeType)

  // Evict LRU entries when over limit
  if (blobCache.size >= BLOB_CACHE_MAX) {
    let oldestKey = ''
    let oldestTime = Infinity
    for (const [k, v] of blobCache) {
      if (v.accessedAt < oldestTime) {
        oldestTime = v.accessedAt
        oldestKey = k
      }
    }
    if (oldestKey) blobCache.delete(oldestKey)
  }

  blobCache.set(key, { blob, mimeType, accessedAt: Date.now() })
}

/** Drops every cached file, e.g. when the user signs out. */
export function clearBlobCache() {
  blobCache.clear()
}

/** Evicts all cache entries for a given file ID (e.g. after an update). */
export function invalidateBlobCache(fileId: string) {
  for (const key of blobCache.keys()) {
    if (key.startsWith(`${fileId}::`)) {
      blobCache.delete(key)
    }
  }
}
// ─────────────────────────────────────────────────────────────────────────────

export async function ensureVaultFolder(accessToken: string): Promise<DriveFolder> {
  return ensureDriveFolder(accessToken, vaultFolderName)
}

export async function ensureDriveFolder(
  accessToken: string,
  folderName: string,
  parentFolderId?: string,
): Promise<DriveFolder> {
  const parentClause = parentFolderId ? ` and '${escapeDriveQuery(parentFolderId)}' in parents` : ''
  const query = encodeURIComponent(
    `name='${escapeDriveQuery(folderName)}' and mimeType='${folderMimeType}' and trashed=false${parentClause}`,
  )
  const result = await driveFetch<{ files: DriveFolder[] }>(
    accessToken,
    `${driveApi}/files?q=${query}&spaces=drive&fields=files(id,name)&pageSize=1`,
  )

  if (result.files[0]) {
    return result.files[0]
  }

  return driveFetch<DriveFolder>(accessToken, `${driveApi}/files?fields=id,name`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: folderName,
      mimeType: folderMimeType,
      ...(parentFolderId ? { parents: [parentFolderId] } : {}),
    }),
  })
}

export async function uploadFileToDrive(
  accessToken: string,
  file: File,
  folderId: string,
  options: DriveRequestOptions = {},
): Promise<DriveFile> {
  const boundary = `document_vault_${crypto.randomUUID()}`
  const metadata = {
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    parents: [folderId],
  }
  const delimiter = `\r\n--${boundary}\r\n`
  const closeDelimiter = `\r\n--${boundary}--`
  const body = new Blob(
    [
      delimiter,
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      JSON.stringify(metadata),
      delimiter,
      `Content-Type: ${metadata.mimeType}\r\n\r\n`,
      file,
      closeDelimiter,
    ],
    { type: `multipart/related; boundary=${boundary}` },
  )

  const url = `${driveUploadApi}/files?uploadType=multipart&fields=${uploadFields}`
  const { onProgress } = options
  if (!onProgress) {
    return driveFetch<DriveFile>(accessToken, url, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
      signal: options.signal,
    })
  }

  // fetch() cannot report upload progress, so progress-tracked uploads use XHR.
  // Failures surface as GoogleDriveError (HTTP) or TypeError (network) so the
  // upload queue's retry rules treat them the same way as fetch failures.
  return new Promise<DriveFile>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    xhr.open('POST', url)
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`)
    xhr.setRequestHeader('Content-Type', `multipart/related; boundary=${boundary}`)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total)
    }
    xhr.onload = () => {
      options.signal?.removeEventListener('abort', abort)
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as DriveFile)
        } catch {
          reject(new TypeError('Google Drive returned an unreadable upload response.'))
        }
        return
      }
      void parseDriveError(new Response(xhr.responseText, { status: xhr.status })).then(reject)
    }
    xhr.onerror = () => {
      options.signal?.removeEventListener('abort', abort)
      reject(new TypeError('Network error while uploading to Google Drive.'))
    }
    xhr.onabort = () => reject(new DOMException('Upload cancelled.', 'AbortError'))
    if (options.signal?.aborted) {
      reject(new DOMException('Upload cancelled.', 'AbortError'))
      return
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    xhr.send(body)
  })
}

// ─── Resumable uploads ────────────────────────────────────────────────────────
// Files above this size go through a resumable session: the file is sent in
// chunks and an interrupted upload continues from the last byte Drive stored
// instead of starting over. Smaller files use one multipart request, which is
// faster for them (one round trip instead of two).
export const RESUMABLE_UPLOAD_THRESHOLD = 5 * 1024 * 1024
// Drive requires chunk sizes in multiples of 256 KiB.
const RESUMABLE_CHUNK_SIZE = 32 * 256 * 1024

const uploadFields = 'id,name,mimeType,webViewLink,thumbnailLink,size'

interface XhrResult {
  status: number
  responseText: string
  header: (name: string) => string | null
}

function sendXhr(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: XMLHttpRequestBodyInit | null,
  options: DriveRequestOptions = {},
): Promise<XhrResult> {
  return new Promise<XhrResult>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException('Upload cancelled.', 'AbortError'))
      return
    }
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    xhr.open(method, url)
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value)
    if (options.onProgress) {
      const onProgress = options.onProgress
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded, event.total)
      }
    }
    xhr.onload = () => {
      options.signal?.removeEventListener('abort', abort)
      resolve({ status: xhr.status, responseText: xhr.responseText, header: (name) => xhr.getResponseHeader(name) })
    }
    xhr.onerror = () => {
      options.signal?.removeEventListener('abort', abort)
      reject(new TypeError('Network error while uploading to Google Drive.'))
    }
    xhr.ontimeout = xhr.onerror
    xhr.onabort = () => reject(new DOMException('Upload cancelled.', 'AbortError'))
    options.signal?.addEventListener('abort', abort, { once: true })
    xhr.send(body)
  })
}

function parseUploadedFile(result: XhrResult): DriveFile {
  try {
    return JSON.parse(result.responseText) as DriveFile
  } catch {
    throw new TypeError('Google Drive returned an unreadable upload response.')
  }
}

/** Next byte Drive expects, from a 308 response's Range header ("bytes=0-1234"). */
function nextOffsetFromRange(range: string | null) {
  const match = range?.match(/bytes=\d+-(\d+)/)
  return match ? Number(match[1]) + 1 : 0
}

/**
 * Starts a resumable upload session and returns its URI. The session stays
 * valid for about a week, so it can be stored and continued after a reload.
 */
export async function createResumableUpload(
  accessToken: string,
  file: { name: string; type: string; size: number },
  folderId: string,
  signal?: AbortSignal,
): Promise<string> {
  const mimeType = file.type || 'application/octet-stream'
  const result = await sendXhr(
    'POST',
    `${driveUploadApi}/files?uploadType=resumable&fields=${uploadFields}`,
    {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': String(file.size),
    },
    JSON.stringify({ name: file.name, mimeType, parents: [folderId] }),
    { signal },
  )
  if (result.status < 200 || result.status >= 300) {
    throw await parseDriveError(new Response(result.responseText, { status: result.status }))
  }
  const location = result.header('Location')
  if (!location) throw new TypeError('Google Drive did not return an upload session.')
  return location
}

export type ResumableStatus = { done: true; file: DriveFile } | { done: false; nextOffset: number }

/**
 * Asks Drive how much of a session it already has. A session Drive no longer
 * knows (expired or already cancelled) throws GoogleDriveError with reason
 * 'uploadSessionExpired' so the caller can start a new one.
 */
export async function queryResumableUpload(
  accessToken: string,
  sessionUri: string,
  size: number,
  signal?: AbortSignal,
): Promise<ResumableStatus> {
  const result = await sendXhr(
    'PUT',
    sessionUri,
    { Authorization: `Bearer ${accessToken}`, 'Content-Range': `bytes */${size}` },
    null,
    { signal },
  )
  return readResumableResponse(result)
}

async function readResumableResponse(result: XhrResult): Promise<ResumableStatus> {
  if (result.status === 200 || result.status === 201) return { done: true, file: parseUploadedFile(result) }
  if (result.status === 308) return { done: false, nextOffset: nextOffsetFromRange(result.header('Range')) }
  if (result.status === 404 || result.status === 410) {
    throw new GoogleDriveError(result.status, 'The upload session has expired.', 'uploadSessionExpired')
  }
  if (result.status === 0) throw new TypeError('Network error while uploading to Google Drive.')
  throw await parseDriveError(new Response(result.responseText, { status: result.status }))
}

/**
 * Sends the file from `startOffset` in chunks. After each chunk Drive has
 * stored, `onChunkStored` receives the next offset so the caller can persist
 * it; a later call with that offset continues from there.
 */
export async function continueResumableUpload(
  accessToken: string,
  sessionUri: string,
  file: Blob,
  startOffset: number,
  options: DriveRequestOptions & { onChunkStored?: (nextOffset: number) => void; chunkSize?: number } = {},
): Promise<DriveFile> {
  const total = file.size
  const chunkSize = options.chunkSize ?? RESUMABLE_CHUNK_SIZE
  let offset = startOffset

  for (;;) {
    const end = Math.min(offset + chunkSize, total)
    const chunk = file.slice(offset, end)
    const chunkStart = offset
    const result = await sendXhr(
      'PUT',
      sessionUri,
      {
        Authorization: `Bearer ${accessToken}`,
        'Content-Range': total === 0 ? 'bytes */0' : `bytes ${offset}-${end - 1}/${total}`,
      },
      chunk,
      {
        signal: options.signal,
        onProgress: options.onProgress ? (loaded) => options.onProgress?.(chunkStart + loaded, total) : undefined,
      },
    )
    const status = await readResumableResponse(result)
    if (status.done === true) {
      options.onProgress?.(total, total)
      return status.file
    }
    // Drive may keep less than was sent; continue from what it reports.
    offset = status.nextOffset
    options.onChunkStored?.(offset)
    options.onProgress?.(offset, total)
  }
}

// ─── Copies and versions ──────────────────────────────────────────────────────

/** Copies a file within Drive. The copy is created by this app, so drive.file covers it. */
export async function copyDriveFile(accessToken: string, fileId: string, name: string, parentFolderId?: string): Promise<DriveFile> {
  return driveFetch<DriveFile>(accessToken, `${driveApi}/files/${encodeURIComponent(fileId)}/copy?fields=${uploadFields}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, ...(parentFolderId ? { parents: [parentFolderId] } : {}) }),
  })
}

export interface DriveRevision {
  id: string
  modifiedTime: string
  size?: string
  keepForever?: boolean
  originalFilename?: string
  mimeType?: string
}

/** A file's stored versions, oldest first. */
export async function listDriveRevisions(accessToken: string, fileId: string): Promise<DriveRevision[]> {
  const revisions: DriveRevision[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({
      pageSize: '200',
      fields: 'nextPageToken,revisions(id,modifiedTime,size,keepForever,originalFilename,mimeType)',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const page = await driveFetch<{ nextPageToken?: string; revisions?: DriveRevision[] }>(
      accessToken,
      `${driveApi}/files/${encodeURIComponent(fileId)}/revisions?${params}`,
    )
    revisions.push(...(page.revisions ?? []))
    pageToken = page.nextPageToken
  } while (pageToken)
  return revisions
}

/** Drive deletes unpinned versions after 30 days; pinned ones are kept until removed. */
export async function setRevisionKeepForever(accessToken: string, fileId: string, revisionId: string, keepForever: boolean) {
  return driveFetch<DriveRevision>(
    accessToken,
    `${driveApi}/files/${encodeURIComponent(fileId)}/revisions/${encodeURIComponent(revisionId)}?fields=id,keepForever`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keepForever }) },
  )
}

export async function downloadDriveRevision(accessToken: string, fileId: string, revisionId: string, options: DownloadOptions = {}) {
  const response = await fetchWithRetry(
    `${driveApi}/files/${encodeURIComponent(fileId)}/revisions/${encodeURIComponent(revisionId)}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` }, credentials: 'omit', signal: options.signal },
  )
  if (!response.ok) throw await parseDriveError(response)
  return readBody(response, options.onProgress)
}

export async function deleteDriveRevision(accessToken: string, fileId: string, revisionId: string) {
  await driveFetch<void>(accessToken, `${driveApi}/files/${encodeURIComponent(fileId)}/revisions/${encodeURIComponent(revisionId)}`, {
    method: 'DELETE',
  })
}

/**
 * Replaces a file's contents, keeping its id, so Drive stores the previous
 * contents as an earlier version. The new version is pinned (kept forever).
 * Large files go through a resumable session.
 */
export async function updateDriveFileContent(
  accessToken: string,
  fileId: string,
  file: File,
  options: DriveRequestOptions & { name?: string } = {},
): Promise<DriveFile> {
  const mimeType = file.type || 'application/octet-stream'
  const metadata = { mimeType, ...(options.name ? { name: options.name } : {}) }
  const query = `keepRevisionForever=true&fields=${uploadFields}`
  const target = `${driveUploadApi}/files/${encodeURIComponent(fileId)}`

  if (file.size > RESUMABLE_UPLOAD_THRESHOLD) {
    const session = await sendXhr(
      'PATCH',
      `${target}?uploadType=resumable&${query}`,
      {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(file.size),
      },
      JSON.stringify(metadata),
      { signal: options.signal },
    )
    if (session.status < 200 || session.status >= 300) {
      throw await parseDriveError(new Response(session.responseText, { status: session.status }))
    }
    const location = session.header('Location')
    if (!location) throw new TypeError('Google Drive did not return an upload session.')
    return continueResumableUpload(accessToken, location, file, 0, { signal: options.signal, onProgress: options.onProgress })
  }

  const boundary = `document_vault_${crypto.randomUUID()}`
  const body = new Blob(
    [
      `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      file,
      `\r\n--${boundary}--`,
    ],
    { type: `multipart/related; boundary=${boundary}` },
  )
  const result = await sendXhr(
    'PATCH',
    `${target}?uploadType=multipart&${query}`,
    { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
    options,
  )
  if (result.status < 200 || result.status >= 300) {
    throw await parseDriveError(new Response(result.responseText, { status: result.status }))
  }
  return parseUploadedFile(result)
}

/**
 * True when Google's servers answer at all. Uses an opaque request so no
 * token is needed and CORS does not matter; only a network failure rejects.
 */
export async function isDriveReachable(timeoutMs = 8000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    await fetch(`${driveApi}/about?fields=kind&_=${Date.now()}`, { mode: 'no-cors', cache: 'no-store', signal: controller.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** A failure to reach Drive at all, as opposed to an answer from it. */
export function isNetworkError(error: unknown) {
  if (error instanceof GoogleDriveError) return false
  if (error instanceof TypeError) return true
  return error instanceof Error && /network|failed to fetch|load failed|offline/i.test(error.message)
}
// ─────────────────────────────────────────────────────────────────────────────

export async function getDriveFileMetadata(accessToken: string, fileId: string) {
  return driveFetch<DriveFile>(
    accessToken,
    `${driveApi}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,webViewLink,thumbnailLink,size,trashed`,
  )
}

export async function getDriveFileThumbnail(
  accessToken: string,
  fileId: string,
  knownThumbnailUrl?: string,
) {
  let thumbnailUrl = knownThumbnailUrl

  if (!thumbnailUrl) {
    try {
      const metadata = await getDriveFileMetadata(accessToken, fileId)
      thumbnailUrl = metadata.thumbnailLink
    } catch {
      thumbnailUrl = `https://lh3.googleusercontent.com/d/${fileId}=s800`
    }
  }

  if (!thumbnailUrl) {
    thumbnailUrl = `https://lh3.googleusercontent.com/d/${fileId}=s800`
  } else if (thumbnailUrl.includes('=s')) {
    thumbnailUrl = thumbnailUrl.replace(/=s\d+/, '=s800')
  }

  // Try fetching without Auth header first because Google CDN (lh3.googleusercontent.com) blocks Auth headers
  try {
    const directRes = await fetch(thumbnailUrl, { referrerPolicy: 'no-referrer' })
    if (directRes.ok) {
      return await directRes.blob()
    }
  } catch {
    // Continue to authenticated retry
  }

  const response = await fetchWithRetry(thumbnailUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: 'omit',
  })

  if (!response.ok) {
    throw await parseDriveError(response)
  }

  return response.blob()
}

/** Files larger than this are not copied into the browser's offline cache. */
const OFFLINE_CACHE_MAX_BYTES = 100 * 1024 * 1024

function cacheOffline(fileId: string, mimeType: string, blob: Blob) {
  if (blob.size > OFFLINE_CACHE_MAX_BYTES) return
  void saveOfflineBlob(fileId, fileId, mimeType || 'application/octet-stream', blob)
}

export interface DownloadOptions {
  signal?: AbortSignal
  /** Bytes received so far and the total, when Drive reports it (0 otherwise). */
  onProgress?: (loaded: number, total: number) => void
}

/** Reads a response body, reporting progress as it arrives. */
async function readBody(response: Response, onProgress?: DownloadOptions['onProgress']) {
  if (!onProgress || !response.body) return response.blob()
  const total = Number(response.headers.get('Content-Length')) || 0
  const type = response.headers.get('Content-Type') ?? ''
  const reader = response.body.getReader()
  const parts: BlobPart[] = []
  let loaded = 0
  onProgress(0, total)
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    loaded += value.byteLength
    onProgress(loaded, total)
  }
  return new Blob(parts, { type })
}

export async function getDriveFileContent(accessToken: string, fileId: string, options: DownloadOptions & { cache?: boolean } = {}) {
  try {
    const response = await fetchWithRetry(`${driveApi}/files/${encodeURIComponent(fileId)}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: 'omit',
      signal: options.signal,
    })

    if (!response.ok) {
      throw await parseDriveError(response)
    }

    const blob = await readBody(response, options.onProgress)
    if (options.cache !== false) cacheOffline(fileId, blob.type, blob)
    return blob
  } catch (error) {
    // Offline or network error fallback from IndexedDB
    const offlineItem = await getOfflineBlob(fileId)
    if (offlineItem?.blob) {
      return offlineItem.blob
    }
    throw error
  }
}

export async function getDriveFileBlob(accessToken: string, fileId: string) {
  return getDriveFileContent(accessToken, fileId)
}

function isPotentiallyConvertible(mimeType: string) {
  const t = mimeType.toLowerCase()
  return (
    t.includes('word') ||
    t.includes('excel') ||
    t.includes('spreadsheet') ||
    t.includes('powerpoint') ||
    t.includes('presentation') ||
    t.includes('officedocument') ||
    t.includes('ms-') ||
    t.includes('text/') ||
    t.includes('html')
  )
}

/**
 * Downloads a file from Drive, with an optional pre-fetched mimeType to skip
 * an extra metadata round trip. Results are cached in memory & IndexedDB for offline opening.
 */
export async function downloadDriveFile(
  accessToken: string,
  fileId: string,
  mimeType?: string,
  /** Pass pre-fetched metadata to avoid an extra getDriveFileMetadata call */
  knownMimeType?: string,
  options: DownloadOptions = {},
) {
  // 1. Resolve the actual MIME type we'll use for the download
  let activeMimeType = knownMimeType ?? mimeType

  // Check in-memory cache
  const cacheKey = activeMimeType ?? 'unknown'
  const cached = getBlobFromCache(fileId, cacheKey)
  if (cached) {
    return cached
  }

  // Check offline IndexedDB store if offline or attempting fast load
  if (!navigator.onLine) {
    const offlineItem = await getOfflineBlob(fileId)
    if (offlineItem?.blob) {
      storeBlobInCache(fileId, cacheKey, offlineItem.blob)
      return offlineItem.blob
    }
  }

  // A caller that already resolved the type (the viewer does) saves a round trip.
  if (
    !knownMimeType &&
    (!activeMimeType ||
      (activeMimeType.startsWith('application/vnd.google-apps.') === false &&
        isPotentiallyConvertible(activeMimeType)))
  ) {
    try {
      const metadata = await getDriveFileMetadata(accessToken, fileId)
      activeMimeType = metadata.mimeType
    } catch {
      // Fallback to whatever was provided
    }
  }

  // 3. Download the file
  let blob: Blob

  try {
    if (activeMimeType && activeMimeType.startsWith('application/vnd.google-apps.')) {
      if (activeMimeType === 'application/vnd.google-apps.folder') {
        throw new Error('Cannot download a folder.')
      }
      blob = await exportGoogleWorkspaceFile(accessToken, fileId, activeMimeType, options)
    } else {
      blob = await getDriveFileContent(accessToken, fileId, { ...options, cache: false })
    }

    // Store in memory cache & IndexedDB for offline access
    storeBlobInCache(fileId, cacheKey, blob)
    cacheOffline(fileId, activeMimeType || blob.type, blob)

    return blob
  } catch (downloadError) {
    // If download fails due to offline state or network failure, load from IndexedDB
    const offlineItem = await getOfflineBlob(fileId)
    if (offlineItem?.blob) {
      storeBlobInCache(fileId, cacheKey, offlineItem.blob)
      return offlineItem.blob
    }
    throw downloadError
  }
}

export async function exportGoogleWorkspaceFile(accessToken: string, fileId: string, mimeType: string, options: DownloadOptions = {}) {
  const exportMimeType = getWorkspaceExportMimeType(mimeType)
  const response = await fetchWithRetry(
    `${driveApi}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMimeType)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: 'omit',
      signal: options.signal,
    },
  )

  if (!response.ok) {
    throw await parseDriveError(response)
  }

  return readBody(response, options.onProgress)
}

export async function getDriveFolderChildren(accessToken: string, folderId: string) {
  const query = encodeURIComponent(`'${escapeDriveQuery(folderId)}' in parents and trashed=false`)
  return driveFetch<{ files: DriveFile[] }>(
    accessToken,
    `${driveApi}/files?q=${query}&spaces=drive&fields=files(id,name,mimeType,webViewLink,thumbnailLink,size)&pageSize=1000`,
  )
}

export async function renameDriveFile(accessToken: string, fileId: string, name: string) {
  return driveFetch<DriveFile>(accessToken, `${driveApi}/files/${fileId}?fields=id,name`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export async function moveDriveFile(
  accessToken: string,
  fileId: string,
  addParents: string,
  removeParents: string,
): Promise<DriveFile> {
  return driveFetch<DriveFile>(
    accessToken,
    `${driveApi}/files/${fileId}?addParents=${encodeURIComponent(addParents)}&removeParents=${encodeURIComponent(removeParents)}&fields=id,parents`,
    {
      method: 'PATCH',
    },
  )
}

export async function trashDriveFile(accessToken: string, fileId: string) {
  invalidateBlobCache(fileId)
  return driveFetch<DriveFile>(accessToken, `${driveApi}/files/${fileId}?fields=id,name`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  })
}

export async function restoreDriveFile(accessToken: string, fileId: string) {
  return driveFetch<DriveFile>(accessToken, `${driveApi}/files/${fileId}?fields=id,name`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: false }),
  })
}

export async function deleteDriveFile(accessToken: string, fileId: string) {
  invalidateBlobCache(fileId)
  await driveFetch<void>(accessToken, `${driveApi}/files/${fileId}`, { method: 'DELETE' })
}

export async function createDriveFolder(
  accessToken: string,
  name: string,
  parentFolderId: string,
): Promise<DriveFolder> {
  return driveFetch<DriveFolder>(accessToken, `${driveApi}/files?fields=id,name`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: folderMimeType,
      parents: [parentFolderId],
    }),
  })
}

export async function checkFileExists(
  accessToken: string,
  fileId: string,
): Promise<{ exists: boolean; trashed?: boolean }> {
  try {
    const file = await driveFetch<{ id: string; trashed: boolean }>(
      accessToken,
      `${driveApi}/files/${fileId}?fields=id,trashed`,
    )
    return { exists: true, trashed: file.trashed }
  } catch (error) {
    if (error instanceof GoogleDriveError && error.status === 404) {
      return { exists: false }
    }
    // For other errors (network/auth), assume it exists and matches current state
    return { exists: true }
  }
}

/**
 * Every file this app can see in Drive (the drive.file scope covers files the
 * vault created or was given), with its trash state, in pages of 1000. One
 * request per thousand files instead of one per file. Throws if any page
 * fails, so callers never act on a partial listing.
 */
export async function listAppFileStates(accessToken: string): Promise<Map<string, { trashed: boolean }>> {
  const states = new Map<string, { trashed: boolean }>()
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({ pageSize: '1000', fields: 'nextPageToken,files(id,trashed)', spaces: 'drive' })
    if (pageToken) params.set('pageToken', pageToken)
    const page = await driveFetch<{ nextPageToken?: string; files?: Array<{ id: string; trashed?: boolean }> }>(
      accessToken,
      `${driveApi}/files?${params}`,
    )
    for (const file of page.files ?? []) states.set(file.id, { trashed: Boolean(file.trashed) })
    pageToken = page.nextPageToken
  } while (pageToken)
  return states
}

function getWorkspaceExportMimeType(mimeType: string) {
  if (mimeType === 'application/vnd.google-apps.document') {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  }
  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }
  if (mimeType === 'application/vnd.google-apps.presentation') {
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  }
  return 'application/pdf'
}

export async function findFileInDrive(
  accessToken: string,
  name: string,
  parentFolderId: string,
): Promise<DriveFile | null> {
  const query = encodeURIComponent(
    `name='${escapeDriveQuery(name)}' and '${escapeDriveQuery(parentFolderId)}' in parents and trashed=false`,
  )
  const result = await driveFetch<{ files: DriveFile[] }>(
    accessToken,
    `${driveApi}/files?q=${query}&spaces=drive&fields=files(id,name,mimeType,webViewLink,thumbnailLink,size)&pageSize=1`,
  )
  return result.files[0] ?? null
}

export interface DriveStorageQuota {
  /** Bytes currently used across all of Drive (including Docs, Sheets, Slides, etc.) */
  usageBytes: number
  /** Total quota limit in bytes (e.g. 15 GB for free tier) */
  limitBytes: number
}

/**
 * Fetches the real storage quota from the Google Drive v3 About API.
 * Returns null if the token is missing or the request fails.
 */
export async function getDriveStorageQuota(
  accessToken: string,
): Promise<DriveStorageQuota | null> {
  try {
    const data = await driveFetch<{
      storageQuota: { usage: string; limit: string }
    }>(
      accessToken,
      'https://www.googleapis.com/drive/v3/about?fields=storageQuota',
    )
    return {
      usageBytes: parseInt(data.storageQuota.usage, 10),
      limitBytes: parseInt(data.storageQuota.limit, 10),
    }
  } catch {
    return null
  }
}


