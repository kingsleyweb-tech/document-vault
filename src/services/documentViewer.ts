import type { VaultDocument } from '../types/document'
import { downloadDriveFile, getDriveFileMetadata, GoogleDriveError, isDriveAuthorizationError } from './googleDrive'
import { saveOfflinePreview, getOfflinePreview, getOfflineBlob } from './offlineStore'

export type PreviewKind =
  | 'pdf'
  | 'image'
  | 'html'
  | 'text'
  | 'word'
  | 'spreadsheet'
  | 'presentation'
  | 'office'
  | 'embed'
  | 'fallback'

export interface SpreadsheetSheet {
  name: string
  html: string
}

export interface PresentationSlide {
  index: number
  title: string
  text: string[]
  images?: string[]
}

export interface DocumentPreview {
  kind: PreviewKind
  blob: Blob
  objectUrl: string
  embedUrl?: string
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
  embedUrl?: string
  text?: string
  html?: string
  sheets?: SpreadsheetSheet[]
  slides?: PresentationSlide[]
  createdAt: number
}

const PARSED_CACHE_MAX = 20
const PARSED_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

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
let mammothPromise: Promise<unknown> | null = null
let xlsxPromise:    Promise<unknown> | null = null
let jszipPromise:   Promise<unknown> | null = null

function warmUpRenderers() {
  if (!mammothPromise) mammothPromise = import('mammoth/mammoth.browser').catch(() => null)
  if (!xlsxPromise)    xlsxPromise    = import('xlsx').catch(() => null)
  if (!jszipPromise)   jszipPromise   = import('jszip').catch(() => null)
}

warmUpRenderers()
// ─────────────────────────────────────────────────────────────────────────────

export async function loadDocumentPreview(
  accessToken: string,
  documentRecord: VaultDocument,
): Promise<DocumentPreview> {
  const fileId = documentRecord.driveFileId || documentRecord.id

  // ── 1. Return memory-cached result instantly ──────────────────────────────────────
  const cached = getParsedFromCache(fileId)
  if (cached) {
    const freshUrl = URL.createObjectURL(cached.blob)
    return {
      kind: cached.kind,
      blob: cached.blob,
      objectUrl: freshUrl,
      embedUrl: cached.embedUrl,
      text: cached.text,
      html: cached.html,
      sheets: cached.sheets,
      slides: cached.slides,
      downloadable: true,
    }
  }

  // ── 2. Check IndexedDB offline preview store for instant 0ms offline load ─────────
  const offlinePreview = await getOfflinePreview(fileId)
  const offlineBlobItem = await getOfflineBlob(fileId)

  if (offlinePreview && offlineBlobItem?.blob) {
    const freshUrl = URL.createObjectURL(offlineBlobItem.blob)
    const result: DocumentPreview = {
      kind: offlinePreview.kind as PreviewKind,
      blob: offlineBlobItem.blob,
      objectUrl: freshUrl,
      text: offlinePreview.text,
      html: offlinePreview.html,
      sheets: offlinePreview.sheets,
      slides: offlinePreview.slides,
      downloadable: true,
    }

    storeParsedInCache(fileId, {
      kind: result.kind,
      blob: offlineBlobItem.blob,
      objectUrl: freshUrl,
      text: result.text,
      html: result.html,
      sheets: result.sheets,
      slides: result.slides,
      createdAt: Date.now(),
    })

    return result
  }

  // ── 3. Determine file type and metadata ────────────────────────────────────
  const localMimeType = documentRecord.mimeType
  const isGoogleWorkspace = localMimeType.startsWith('application/vnd.google-apps.')
  const fileName = (documentRecord.originalName ?? documentRecord.name).toLowerCase()
  const driveEmbedUrl = `https://drive.google.com/file/d/${encodeURIComponent(documentRecord.driveFileId)}/preview`

  let resolvedMimeType = localMimeType

  if (isGoogleWorkspace && navigator.onLine) {
    try {
      const metadata = await getDriveFileMetadata(accessToken, documentRecord.driveFileId)
      if (metadata.trashed) {
        throw new GoogleDriveError(404, 'This file is in Google Drive trash.', 'trashed')
      }
      resolvedMimeType = metadata.mimeType || localMimeType
    } catch (e) {
      if (isDriveAuthorizationError(e)) throw e
    }
  }

  // Legacy binary Office formats (.doc, .xls, .ppt)
  if (/\.(doc|xls|ppt)$/i.test(fileName)) {
    try {
      const blob = await downloadDriveFile(accessToken, documentRecord.driveFileId, resolvedMimeType, resolvedMimeType)
      const typedBlob = blob.type ? blob : new Blob([blob], { type: resolvedMimeType })
      const objectUrl = URL.createObjectURL(typedBlob)
      const result: DocumentPreview = {
        kind: 'embed',
        blob: typedBlob,
        objectUrl,
        embedUrl: driveEmbedUrl,
        downloadable: true,
      }
      storeParsedInCache(documentRecord.driveFileId, {
        kind: result.kind,
        blob: typedBlob,
        objectUrl,
        embedUrl: driveEmbedUrl,
        createdAt: Date.now(),
      })
      return result
    } catch {
      const emptyBlob = new Blob([], { type: resolvedMimeType })
      return {
        kind: 'embed',
        blob: emptyBlob,
        objectUrl: '',
        embedUrl: driveEmbedUrl,
        downloadable: true,
      }
    }
  }

  // ── 4. Download blob for client-side rendering or fetch from IndexedDB ──────────────
  const blob = await downloadDriveFile(
    accessToken,
    documentRecord.driveFileId,
    resolvedMimeType,
    resolvedMimeType,
  )

  const typedBlob = blob.type ? blob : new Blob([blob], { type: resolvedMimeType || localMimeType })
  const objectUrl = URL.createObjectURL(typedBlob)
  const kind = getPreviewKind({ ...documentRecord, mimeType: resolvedMimeType })

  // ── 5. Parse / render content with concurrent slide processing ───────────────────
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
  } else if (kind === 'office' && /\.docx$/i.test(fileName)) {
    try {
      result = {
        kind: 'word',
        blob: typedBlob,
        objectUrl,
        html: await renderDocx(typedBlob),
        downloadable: true,
      }
    } catch {
      result = { kind: 'embed', blob: typedBlob, objectUrl, embedUrl: driveEmbedUrl, downloadable: true }
    }
  } else if (kind === 'office' && /\.(xlsx|csv)$/i.test(fileName)) {
    try {
      result = {
        kind: 'spreadsheet',
        blob: typedBlob,
        objectUrl,
        sheets: await renderSpreadsheet(typedBlob),
        downloadable: true,
      }
    } catch {
      result = { kind: 'embed', blob: typedBlob, objectUrl, embedUrl: driveEmbedUrl, downloadable: true }
    }
  } else if (kind === 'office' && /\.pptx$/i.test(fileName)) {
    try {
      result = {
        kind: 'presentation',
        blob: typedBlob,
        objectUrl,
        slides: await renderPresentation(typedBlob),
        downloadable: true,
      }
    } catch {
      result = { kind: 'embed', blob: typedBlob, objectUrl, embedUrl: driveEmbedUrl, downloadable: true }
    }
  } else if (kind === 'office') {
    result = { kind: 'embed', blob: typedBlob, objectUrl, embedUrl: driveEmbedUrl, downloadable: true }
  } else {
    result = { kind, blob: typedBlob, objectUrl, downloadable: true }
  }

  // ── 6. Store in parsed memory cache & IndexedDB offline store ───────────────────
  storeParsedInCache(fileId, {
    kind: result.kind,
    blob: typedBlob,
    objectUrl,
    embedUrl: result.embedUrl,
    text: result.text,
    html: result.html,
    sheets: result.sheets,
    slides: result.slides,
    createdAt: Date.now(),
  })

  void saveOfflinePreview(fileId, result.kind, {
    text: result.text,
    html: result.html,
    sheets: result.sheets,
    slides: result.slides,
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

export function sanitizeHtml(html: string) {
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
      if (name === 'href' || name === 'src') {
        if (/^javascript:/i.test(value)) {
          element.removeAttribute(attribute.name)
        } else if (/^data:/i.test(value) && !/^data:image\//i.test(value)) {
          element.removeAttribute(attribute.name)
        }
      }
    }
  })

  return `<!doctype html>${doc.documentElement.outerHTML}`
}

async function renderDocx(blob: Blob) {
  const mammoth = mammothPromise
    ? (await mammothPromise as typeof import('mammoth/mammoth.browser') | null) ?? await import('mammoth/mammoth.browser')
    : await import('mammoth/mammoth.browser')
  if (!mammoth) throw new Error('mammoth failed to load')

  const styleMap = [
    "p[style-name='Heading 1'] => h1:fresh",
    "p[style-name='Heading 2'] => h2:fresh",
    "p[style-name='Heading 3'] => h3:fresh",
    "p[style-name='Heading 4'] => h4:fresh",
    "p[style-name='Title'] => h1.title:fresh",
    "p[style-name='Subtitle'] => p.subtitle:fresh",
    "r[style-name='Strong'] => strong",
  ]

  const result = await (mammoth as typeof import('mammoth/mammoth.browser')).convertToHtml(
    { arrayBuffer: await blob.arrayBuffer(), styleMap },
  )

  const styledHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8"/>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
            line-height: 1.65;
            color: #1e293b;
            background-color: #ffffff;
            padding: 40px 48px;
            max-width: 850px;
            margin: 20px auto;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.05);
            border-radius: 8px;
            border: 1px solid #e2e8f0;
          }
          h1, h2, h3, h4, h5, h6 { color: #0f172a; margin-top: 1.5em; margin-bottom: 0.5em; line-height: 1.3; font-weight: 700; }
          h1 { font-size: 2em; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.3em; }
          h2 { font-size: 1.5em; }
          h3 { font-size: 1.25em; }
          p { margin-bottom: 1em; }
          img { max-width: 100%; height: auto; display: block; margin: 16px auto; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
          table { border-collapse: collapse; width: 100%; margin: 20px 0; font-size: 0.95em; }
          th, td { border: 1px solid #cbd5e1; padding: 10px 14px; text-align: left; vertical-align: top; }
          th { background-color: #f1f5f9; font-weight: 600; color: #334155; }
          tr:nth-child(even) td { background-color: #f8fafc; }
          blockquote { border-left: 4px solid #3b82f6; padding-left: 16px; margin: 16px 0; color: #475569; font-style: italic; }
          ul, ol { padding-left: 24px; margin-bottom: 1em; }
          li { margin-bottom: 0.3em; }
          a { color: #2563eb; text-decoration: underline; }
        </style>
      </head>
      <body>
        ${result.value}
      </body>
    </html>
  `
  return sanitizeHtml(styledHtml)
}

async function renderSpreadsheet(blob: Blob): Promise<SpreadsheetSheet[]> {
  const XLSX = xlsxPromise
    ? (await xlsxPromise as typeof import('xlsx') | null) ?? await import('xlsx')
    : await import('xlsx')
  if (!XLSX) throw new Error('xlsx failed to load')

  const workbook = (XLSX as typeof import('xlsx')).read(await blob.arrayBuffer(), {
    type: 'array',
    cellStyles: true,
    cellFormula: true,
    cellDates: true,
  })

  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name]
    const rawHtml = (XLSX as typeof import('xlsx')).utils.sheet_to_html(sheet, { id: `sheet-${cssSafeId(name)}` })

    const styledSheet = `
      <style>
        #sheet-${cssSafeId(name)} {
          border-collapse: collapse;
          width: 100%;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
          font-size: 13px;
          color: #1e293b;
          background-color: #ffffff;
        }
        #sheet-${cssSafeId(name)} td, #sheet-${cssSafeId(name)} th {
          border: 1px solid #cbd5e1;
          padding: 8px 12px;
          white-space: nowrap;
          min-width: 60px;
        }
        #sheet-${cssSafeId(name)} th {
          background-color: #f1f5f9;
          font-weight: 600;
          color: #475569;
          text-align: center;
        }
        #sheet-${cssSafeId(name)} tr:nth-child(even) td {
          background-color: #f8fafc;
        }
        #sheet-${cssSafeId(name)} tr:hover td {
          background-color: #e2e8f0;
        }
      </style>
      ${rawHtml}
    `
    return {
      name,
      html: sanitizeHtml(styledSheet),
    }
  })
}

async function renderPresentation(blob: Blob): Promise<PresentationSlide[]> {
  const JSZipModule = jszipPromise
    ? (await jszipPromise as { default: typeof import('jszip') } | null) ?? await import('jszip')
    : await import('jszip')
  if (!JSZipModule) throw new Error('jszip failed to load')
  const JSZip = (JSZipModule as { default: typeof import('jszip') }).default ?? JSZipModule
  const zip = await (JSZip as unknown as { loadAsync(data: ArrayBuffer): Promise<import('jszip')> }).loadAsync(await blob.arrayBuffer())

  // Extract images map (path -> dataUrl) in parallel
  const mediaFiles = Object.keys(zip.files).filter((name) => /^ppt\/media\//i.test(name))
  const mediaMap = new Map<string, string>()

  await Promise.all(
    mediaFiles.map(async (mediaPath) => {
      const file = zip.file(mediaPath)
      if (file) {
        const base64 = await file.async('base64')
        const ext = mediaPath.split('.').pop()?.toLowerCase() ?? 'png'
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : 'image/png'
        mediaMap.set(mediaPath, `data:${mime};base64,${base64}`)
      }
    }),
  )

  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((first, second) => getSlideNumber(first) - getSlideNumber(second))

  // Parse all slide XMLs & relationship files concurrently in parallel
  const slides = await Promise.all(
    slideNames.map(async (slideName, idx) => {
      const slideNum = getSlideNumber(slideName)
      const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`

      const [xml, relsXml] = await Promise.all([
        zip.file(slideName)?.async('text'),
        zip.file(relsPath)?.async('text'),
      ])

      const text = xml ? extractSlideText(xml) : []
      const slideImages: string[] = []

      if (relsXml) {
        const parser = new DOMParser()
        const doc = parser.parseFromString(relsXml, 'application/xml')
        Array.from(doc.getElementsByTagName('Relationship')).forEach((rel) => {
          const target = rel.getAttribute('Target') ?? ''
          const fullPath = target.startsWith('../') ? target.replace('../', 'ppt/') : `ppt/slides/${target}`
          if (mediaMap.has(fullPath)) {
            slideImages.push(mediaMap.get(fullPath)!)
          }
        })
      }

      return {
        index: slideNum,
        title: text[0] ?? `Slide ${idx + 1}`,
        text,
        images: slideImages.length > 0 ? slideImages : Array.from(mediaMap.values()).slice(0, 2),
      }
    }),
  )

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
