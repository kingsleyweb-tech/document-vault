import { getDriveFileContent, getDriveFileThumbnail } from './googleDrive'
import type { VaultDocument } from '../types/document'

// Authenticated thumbnail loading with a small LRU cache of object URLs.
// Falls back to the original file for images and to a first-page render for PDFs.

const THUMBNAIL_CACHE_MAX = 160
const thumbnailCache = new Map<string, { objectUrl: string; accessedAt: number }>()
const thumbnailRequests = new Map<string, Promise<string>>()

// Keyed by file and version: a new version keeps the Drive file id.
const cacheKey = (documentRecord: Pick<VaultDocument, 'driveFileId' | 'version'>) => `${documentRecord.driveFileId}@${documentRecord.version ?? 1}`

export async function loadThumbnailObjectUrl(
  accessToken: string,
  documentRecord: Pick<VaultDocument, 'driveFileId' | 'fileType' | 'thumbnailUrl' | 'version'>,
) {
  const key = cacheKey(documentRecord)
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
    .finally(() => {
      thumbnailRequests.delete(key)
    })

  thumbnailRequests.set(key, request)
  return request
}

async function loadThumbnailBlob(
  accessToken: string,
  documentRecord: Pick<VaultDocument, 'driveFileId' | 'fileType' | 'thumbnailUrl'>,
) {
  try {
    return await getDriveFileThumbnail(accessToken, documentRecord.driveFileId, documentRecord.thumbnailUrl)
  } catch (error) {
    if (documentRecord.fileType === 'image') {
      return getDriveFileContent(accessToken, documentRecord.driveFileId)
    }
    if (documentRecord.fileType === 'pdf') {
      const pdfBlob = await getDriveFileContent(accessToken, documentRecord.driveFileId)
      return renderPdfFirstPageThumbnail(pdfBlob)
    }
    throw error
  }
}

async function renderPdfFirstPageThumbnail(pdfBlob: Blob) {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

  const pdf = await pdfjs.getDocument({ data: await pdfBlob.arrayBuffer() }).promise
  try {
    const page = await pdf.getPage(1)
    const baseViewport = page.getViewport({ scale: 1 })
    const scale = Math.min(1, 420 / baseViewport.width)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    const canvasContext = canvas.getContext('2d')
    if (!canvasContext) throw new Error('Could not render PDF preview.')

    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvas, canvasContext, viewport }).promise

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('Could not create PDF preview image.'))
        }
      }, 'image/png')
    })
  } finally {
    await pdf.cleanup()
  }
}

/** Drops a cached thumbnail, e.g. after the file's contents were replaced. */
export function invalidateThumbnail(fileId: string) {
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
