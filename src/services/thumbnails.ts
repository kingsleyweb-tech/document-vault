import { getDriveFileContent, getDriveFileThumbnail } from './googleDrive'
import { getPageImage } from './offlineStore'
import { openPdf, releaseCanvas, drawPage, encodePicture } from './pdfPages'
import type { VaultDocument } from '../types/document'
import { isMemoryConstrained } from '../utils/device'

// Authenticated thumbnail loading with a small LRU cache of object URLs.
// When Drive has no thumbnail, a PDF's first page prepared on this device is
// used; failing that, a small file is downloaded and its first page drawn,
// one file at a time. Large files (and every file on phones) keep their icon
// rather than being downloaded whole just for a picture: doing that for every
// card at once made iOS close the page.

/** Largest file downloaded only to draw its thumbnail. */
const MAX_FALLBACK_BYTES = 15 * 1024 * 1024
const MAX_FALLBACK_BYTES_CONSTRAINED = 0
const IMAGE_FALLBACK_BYTES_CONSTRAINED = 4 * 1024 * 1024

const THUMBNAIL_CACHE_MAX = 160
const thumbnailCache = new Map<string, { objectUrl: string; accessedAt: number }>()
const thumbnailRequests = new Map<string, Promise<string>>()
/** Files with no thumbnail this session, so cards do not try again on every visit. */
const failed = new Set<string>()
let fallbackQueue: Promise<unknown> = Promise.resolve()

// Keyed by file and version: a new version keeps the Drive file id.
const cacheKey = (documentRecord: Pick<VaultDocument, 'driveFileId' | 'version'>) => `${documentRecord.driveFileId}@${documentRecord.version ?? 1}`

export async function loadThumbnailObjectUrl(
  accessToken: string,
  documentRecord: Pick<VaultDocument, 'driveFileId' | 'fileType' | 'thumbnailUrl' | 'version' | 'fileSize'>,
) {
  const key = cacheKey(documentRecord)
  if (failed.has(key)) throw new Error('No thumbnail for this file')
  const cached = thumbnailCache.get(key)
  if (cached) {
    cached.accessedAt = Date.now()
    return cached.objectUrl
  }

  const pending = thumbnailRequests.get(key)
  if (pending) return pending

  const request = loadThumbnailBlob(accessToken, documentRecord)
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob)
      storeThumbnailObjectUrl(key, objectUrl)
      return objectUrl
    })
    .catch((error: unknown) => {
      failed.add(key)
      throw error
    })
    .finally(() => {
      thumbnailRequests.delete(key)
    })

  thumbnailRequests.set(key, request)
  return request
}

async function loadThumbnailBlob(
  accessToken: string,
  documentRecord: Pick<VaultDocument, 'driveFileId' | 'fileType' | 'thumbnailUrl' | 'fileSize'>,
) {
  try {
    return await getDriveFileThumbnail(accessToken, documentRecord.driveFileId, documentRecord.thumbnailUrl)
  } catch (error) {
    const size = documentRecord.fileSize ?? Infinity
    const constrained = isMemoryConstrained()
    if (documentRecord.fileType === 'pdf') {
      const prepared = await getPageImage(documentRecord.driveFileId, 1)
      if (prepared?.blob) return prepared.blob
      if (size > (constrained ? MAX_FALLBACK_BYTES_CONSTRAINED : MAX_FALLBACK_BYTES)) throw error
      return oneAtATime(async () => renderPdfFirstPageThumbnail(await getDriveFileContent(accessToken, documentRecord.driveFileId)))
    }
    if (documentRecord.fileType === 'image') {
      if (size > (constrained ? IMAGE_FALLBACK_BYTES_CONSTRAINED : MAX_FALLBACK_BYTES)) throw error
      return oneAtATime(() => getDriveFileContent(accessToken, documentRecord.driveFileId))
    }
    throw error
  }
}

function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const run = fallbackQueue.then(work, work)
  fallbackQueue = run.catch(() => undefined)
  return run
}

async function renderPdfFirstPageThumbnail(pdfBlob: Blob) {
  const { pdf, task } = await openPdf(pdfBlob)
  try {
    const canvas = await drawPage(pdf, 1, 420)
    try {
      return await encodePicture(canvas)
    } finally {
      releaseCanvas(canvas)
    }
  } finally {
    // Destroying the task also ends the PDF's worker and frees the file.
    void task.destroy()
  }
}

/** Drops a cached thumbnail, e.g. after the file's contents were replaced. */
export function invalidateThumbnail(fileId: string) {
  for (const key of Array.from(failed)) {
    if (key.startsWith(`${fileId}@`)) failed.delete(key)
  }
  for (const [key, cached] of Array.from(thumbnailCache)) {
    if (!key.startsWith(`${fileId}@`)) continue
    URL.revokeObjectURL(cached.objectUrl)
    thumbnailCache.delete(key)
  }
}

function storeThumbnailObjectUrl(key: string, objectUrl: string) {
  if (thumbnailCache.size >= THUMBNAIL_CACHE_MAX) {
    let oldestKey = ''
    let oldestTime = Infinity
    for (const [key, entry] of thumbnailCache) {
      if (entry.accessedAt < oldestTime) {
        oldestKey = key
        oldestTime = entry.accessedAt
      }
    }
    const oldest = thumbnailCache.get(oldestKey)
    if (oldest) {
      URL.revokeObjectURL(oldest.objectUrl)
      thumbnailCache.delete(oldestKey)
    }
  }

  thumbnailCache.set(key, { objectUrl, accessedAt: Date.now() })
}
