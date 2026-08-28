import type { VaultDocument } from '../types/document'
import { downloadDriveFile, getDriveFileMetadata, GoogleDriveError } from './googleDrive'

export type PreviewKind = 'pdf' | 'image' | 'html' | 'text' | 'word' | 'spreadsheet' | 'presentation' | 'office' | 'fallback'

export interface SpreadsheetSheet {
  name: string
  html: string
}

export interface PresentationSlide {
  index: number
  title: string
  text: string[]
}

export interface DocumentPreview {
  kind: PreviewKind
  blob: Blob
  objectUrl: string
  text?: string
  html?: string
  sheets?: SpreadsheetSheet[]
  slides?: PresentationSlide[]
  downloadable: boolean
}

// ─── Parsed-content cache ─────────────────────────────────────────────────────
// Stores the expensive render results (Word HTML, spreadsheet sheets, slide
// data) keyed by driveFileId so re-opening a document is instantaneous.

interface ParsedCacheEntry {
  kind: PreviewKind
  blob: Blob
  objectUrl: string
  text?: string
  html?: string
  sheets?: SpreadsheetSheet[]
  slides?: PresentationSlide[]
  createdAt: number
}

const PARSED_CACHE_MAX = 6
const PARSED_CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

const parsedCache = new Map<string, ParsedCacheEntry>()

function getParsedFromCache(fileId: string): ParsedCacheEntry | null {
  const entry = parsedCache.get(fileId)
  if (!entry) return null
  if (Date.now() - entry.createdAt > PARSED_CACHE_TTL_MS) {
    parsedCache.delete(fileId)
    return null
  }
  return entry
}

function storeParsedInCache(fileId: string, entry: ParsedCacheEntry) {
  if (parsedCache.size >= PARSED_CACHE_MAX) {
    let oldestKey = ''
    let oldestTime = Infinity
    for (const [k, v] of parsedCache) {
      if (v.createdAt < oldestTime) {
        oldestTime = v.createdAt
        oldestKey = k
      }
    }
    if (oldestKey) parsedCache.delete(oldestKey)
  }
  parsedCache.set(fileId, entry)
}

/** Call this when a file is updated so stale rendered content is evicted. */
export function invalidateParsedCache(fileId: string) {
  parsedCache.delete(fileId)
}
// ─────────────────────────────────────────────────────────────────────────────

// ─── Eager library warm-up ────────────────────────────────────────────────────
// Start loading heavy renderer libraries as soon as this module is imported so
// they are ready by the time the user first clicks a document.
// These are fire-and-forget; errors are swallowed because the real import()
// call inside render functions will try again.

let mammothPromise: Promise<unknown> | null = null
let xlsxPromise:    Promise<unknown> | null = null
let jszipPromise:   Promise<unknown> | null = null

function warmUpRenderers() {
  // Only warm up once per page load
  if (!mammothPromise) mammothPromise = import('mammoth/mammoth.browser').catch(() => null)
  if (!xlsxPromise)    xlsxPromise    = import('xlsx').catch(() => null)
  if (!jszipPromise)   jszipPromise   = import('jszip').catch(() => null)
}

// Kick off immediately when the module is first loaded
warmUpRenderers()
// ─────────────────────────────────────────────────────────────────────────────

export async function loadDocumentPreview(
  accessToken: string,
  documentRecord: VaultDocument,
): Promise<DocumentPreview> {
  // ── 1. Return cached result instantly ──────────────────────────────────────
  const cached = getParsedFromCache(documentRecord.driveFileId)
  if (cached) {
    // Regenerate objectUrl in case the old one was revoked
    const freshUrl = URL.createObjectURL(cached.blob)
    return {
      kind: cached.kind,
      blob: cached.blob,
      objectUrl: freshUrl,
      text: cached.text,
      html: cached.html,
      sheets: cached.sheets,
      slides: cached.slides,
      downloadable: true,
    }
  }

  // ── 2. Determine what kind of file this is ─────────────────────────────────
  // For non-Workspace files we already have the mime type from Firestore –
  // skip the metadata round-trip entirely.
  const localMimeType = documentRecord.mimeType
  const isGoogleWorkspace = localMimeType.startsWith('application/vnd.google-apps.')
  const fileName = (documentRecord.originalName ?? documentRecord.name).toLowerCase()

  let resolvedMimeType = localMimeType

  if (isGoogleWorkspace) {
    // We DO need metadata for Workspace files (to check trashed + get export type)
    const metadata = await getDriveFileMetadata(accessToken, documentRecord.driveFileId)
    if (metadata.trashed) {
      throw new GoogleDriveError(404, 'This file is in Google Drive trash.', 'trashed')
    }
    resolvedMimeType = metadata.mimeType || localMimeType
  }

  // ── 3. Download the blob (blob cache hits are instant) ─────────────────────
  // Pass resolvedMimeType as knownMimeType so downloadDriveFile skips its own
  // metadata fetch.
  const blob = await downloadDriveFile(
    accessToken,
    documentRecord.driveFileId,
    resolvedMimeType,
    resolvedMimeType, // knownMimeType – avoids the extra metadata call inside
  )

  const typedBlob = blob.type ? blob : new Blob([blob], { type: resolvedMimeType || localMimeType })
  const objectUrl = URL.createObjectURL(typedBlob)
  const kind = getPreviewKind({ ...documentRecord, mimeType: resolvedMimeType })

  // ── 4. Parse / render the content ─────────────────────────────────────────
  let result: DocumentPreview

  if (kind === 'text') {
    result = {
      kind,
      blob: typedBlob,
      objectUrl,
      text: await typedBlob.text(),
      downloadable: true,
    }
  } else if (kind === 'html') {
    result = {
      kind,
      blob: typedBlob,
      objectUrl,
      html: sanitizeHtml(await typedBlob.text()),
      downloadable: true,
    }
  } else if (kind === 'office' && /\.(docx?|rtf)$/i.test(fileName)) {
    try {
      result = {
        kind: 'word',
        blob: typedBlob,
        objectUrl,
        html: await renderDocx(typedBlob),
        downloadable: true,
      }
    } catch {
      result = { kind, blob: typedBlob, objectUrl, downloadable: true }
    }
  } else if (kind === 'office' && /\.(xlsx?|csv)$/i.test(fileName)) {
    try {
      result = {
        kind: 'spreadsheet',
        blob: typedBlob,
        objectUrl,
        sheets: await renderSpreadsheet(typedBlob),
        downloadable: true,
      }
    } catch {
      result = { kind, blob: typedBlob, objectUrl, downloadable: true }
    }
  } else if (kind === 'office' && /\.(pptx?)$/i.test(fileName)) {
    try {
      result = {
        kind: 'presentation',
        blob: typedBlob,
        objectUrl,
        slides: await renderPresentation(typedBlob),
        downloadable: true,
      }
    } catch {
      result = { kind, blob: typedBlob, objectUrl, downloadable: true }
    }
  } else {
    result = { kind, blob: typedBlob, objectUrl, downloadable: true }
  }

  // ── 5. Store in parsed cache ───────────────────────────────────────────────
  storeParsedInCache(documentRecord.driveFileId, {
    kind: result.kind,
    blob: typedBlob,
    objectUrl, // note: this url will be stale after revoke, but we regenerate it on hit
    text: result.text,
    html: result.html,
    sheets: result.sheets,
    slides: result.slides,
    createdAt: Date.now(),
  })

  return result
}

export function getPreviewKind(documentRecord: Pick<VaultDocument, 'fileType' | 'mimeType' | 'originalName'>): PreviewKind {
  if (documentRecord.fileType === 'pdf') return 'pdf'
  if (documentRecord.fileType === 'image') return 'image'
  if (documentRecord.fileType === 'html') return 'html'
  if (documentRecord.fileType === 'text') return 'text'
  if (documentRecord.fileType === 'word' || documentRecord.fileType === 'spreadsheet' || documentRecord.fileType === 'presentation') {
    return 'office'
  }

  const name = (documentRecord.originalName ?? '').toLowerCase()
  if (/\.(docx?|rtf)$/.test(name)) return 'office'
  if (/\.(xlsx?|csv)$/.test(name)) return 'office'
  if (/\.(pptx?)$/.test(name)) return 'office'
  if (documentRecord.mimeType.includes('word') || documentRecord.mimeType.includes('officedocument.word')) return 'office'
  if (documentRecord.mimeType.includes('excel') || documentRecord.mimeType.includes('officedocument.sheet')) return 'office'
  if (documentRecord.mimeType.includes('powerpoint') || documentRecord.mimeType.includes('officedocument.presentation')) return 'office'
  if (documentRecord.mimeType.startsWith('text/')) return 'text'
  if (/\.(html?|xhtml)$/i.test(documentRecord.originalName ?? '')) return 'html'
  return 'fallback'
}

export function buildDownloadName(documentRecord: VaultDocument) {
  return documentRecord.originalName || documentRecord.name
}

function sanitizeHtml(html: string) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  doc.querySelectorAll('script, object, embed, applet, base, form, input, button, textarea, select').forEach((node) => {
    node.remove()
  })

  doc.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim()
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name)
      }
      if ((name === 'href' || name === 'src') && /^(javascript|data):/i.test(value)) {
        element.removeAttribute(attribute.name)
      }
    }
  })

  return `<!doctype html>${doc.documentElement.outerHTML}`
}

async function renderDocx(blob: Blob) {
  // Use warmed-up promise when available
  const mammoth = mammothPromise
    ? (await mammothPromise as typeof import('mammoth/mammoth.browser') | null) ?? await import('mammoth/mammoth.browser')
    : await import('mammoth/mammoth.browser')
  if (!mammoth) throw new Error('mammoth failed to load')
  const result = await (mammoth as typeof import('mammoth/mammoth.browser')).convertToHtml({ arrayBuffer: await blob.arrayBuffer() })
  return sanitizeHtml(result.value)
}

async function renderSpreadsheet(blob: Blob): Promise<SpreadsheetSheet[]> {
  const XLSX = xlsxPromise
    ? (await xlsxPromise as typeof import('xlsx') | null) ?? await import('xlsx')
    : await import('xlsx')
  if (!XLSX) throw new Error('xlsx failed to load')
  const workbook = (XLSX as typeof import('xlsx')).read(await blob.arrayBuffer(), { type: 'array', cellStyles: true })
  return workbook.SheetNames.map((name) => ({
    name,
    html: (XLSX as typeof import('xlsx')).utils.sheet_to_html(workbook.Sheets[name], { id: `sheet-${cssSafeId(name)}` }),
  }))
}

async function renderPresentation(blob: Blob): Promise<PresentationSlide[]> {
  const JSZipModule = jszipPromise
    ? (await jszipPromise as { default: typeof import('jszip') } | null) ?? await import('jszip')
    : await import('jszip')
  if (!JSZipModule) throw new Error('jszip failed to load')
  const JSZip = (JSZipModule as { default: typeof import('jszip') }).default ?? JSZipModule
  const zip = await (JSZip as unknown as { loadAsync(data: ArrayBuffer): Promise<import('jszip')> }).loadAsync(await blob.arrayBuffer())
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((first, second) => getSlideNumber(first) - getSlideNumber(second))

  const slides: PresentationSlide[] = []
  for (const slideName of slideNames) {
    const xml = await zip.file(slideName)?.async('text')
    const text = xml ? extractSlideText(xml) : []
    slides.push({
      index: getSlideNumber(slideName),
      title: text[0] ?? `Slide ${slides.length + 1}`,
      text,
    })
  }

  return slides
}

function extractSlideText(xml: string) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, 'application/xml')
  return Array.from(doc.getElementsByTagName('a:t'))
    .map((node) => node.textContent?.trim() ?? '')
    .filter(Boolean)
}

function getSlideNumber(path: string) {
  return Number(path.match(/slide(\d+)\.xml$/)?.[1] ?? 0)
}

function cssSafeId(value: string) {
  return value.replace(/[^a-z0-9_-]/gi, '-')
}
