import type { VaultDocument } from '../types/document'
import { downloadDriveFile, getDriveFileMetadata, GoogleDriveError, invalidateBlobCache, isDriveAuthorizationError } from './googleDrive'
import { deleteOfflineEntries, saveOfflinePreview, getOfflinePreview, getOfflineBlob } from './offlineStore'
import { invalidateThumbnail } from './thumbnails'
import { stripRtf } from './contentIndex'

export type PreviewKind =
  | 'pdf'
  | 'image'
  | 'html'
  | 'text'
  | 'word'
  | 'spreadsheet'
  | 'presentation'
  | 'epub'
  | 'office'
  | 'embed'
  | 'media'
  | 'archive'
  | 'fallback'

export interface SpreadsheetSheet {
  name: string
  html: string
}

export interface DocumentPreview {
  kind: PreviewKind
  blob: Blob
  objectUrl: string
  embedUrl?: string
  text?: string
  html?: string
  sheets?: SpreadsheetSheet[]
  downloadable: boolean
}

/**
 * Bump when the shape of cached previews changes so stale entries saved in
 * IndexedDB by an older build are ignored. Version 2 drops cached slide lists,
 * which older builds stored in file-name order rather than presentation order.
 * Version 3 drops spreadsheet HTML cached before it was sanitised as a fragment.
 */
export const PREVIEW_FORMAT_VERSION = 3

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

// Dispatched by services/auth.ts at sign-out.
const SESSION_ENDED_EVENT = 'documentVault.sessionEnded'

// Rendered previews must not survive into another user's session.
if (typeof window !== 'undefined') {
  window.addEventListener(SESSION_ENDED_EVENT, () => parsedCache.clear())
}

/** Call this when a file is updated so stale rendered content is evicted. */
export function invalidateParsedCache(fileId: string) {
  parsedCache.delete(fileId)
}

// Caches are keyed by Drive file id, which stays the same when a new version
// replaces a file's contents. The version each cached file belongs to is
// remembered here, so a browser that cached an older version (this one or
// another device) drops it before opening the document.
const CACHED_VERSIONS_KEY = 'documentVault.cachedVersions'

function readCachedVersions(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(CACHED_VERSIONS_KEY) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

/** Removes every cached copy of a file: rendered preview, file contents and thumbnail. */
export async function forgetCachedFile(fileId: string) {
  invalidateParsedCache(fileId)
  invalidateBlobCache(fileId)
  invalidateThumbnail(fileId)
  await deleteOfflineEntries(fileId)
}

/** Drops cached copies made from an older version of this document. */
export async function ensureCacheMatchesVersion(documentRecord: Pick<VaultDocument, 'driveFileId' | 'version'>) {
  const fileId = documentRecord.driveFileId
  const version = documentRecord.version ?? 1
  const versions = readCachedVersions()
  if ((versions[fileId] ?? 1) === version) return
  await forgetCachedFile(fileId)
  try {
    localStorage.setItem(CACHED_VERSIONS_KEY, JSON.stringify({ ...versions, [fileId]: version }))
  } catch {
    // Without storage the check simply runs again next time.
  }
}
// ─────────────────────────────────────────────────────────────────────────────

// ─── Eager library warm-up ────────────────────────────────────────────────────
let mammothPromise: Promise<unknown> | null = null
let xlsxPromise:    Promise<unknown> | null = null

function warmUpRenderers() {
  if (!mammothPromise) mammothPromise = import('mammoth/mammoth.browser').catch(() => null)
  if (!xlsxPromise)    xlsxPromise    = import('xlsx').catch(() => null)
}

warmUpRenderers()
// ─────────────────────────────────────────────────────────────────────────────

export interface LoadPreviewOptions {
  signal?: AbortSignal
  /** Download progress: bytes received and the total (0 when Drive does not say). */
  onProgress?: (loaded: number, total: number) => void
}

/**
 * Loads a document for viewing: from memory, then this browser's offline copy,
 * then Google Drive. Without a Drive token only cached copies can open; other
 * documents throw a 'tokenMissing' authorization error.
 */
export async function loadDocumentPreview(
  accessToken: string | null,
  documentRecord: VaultDocument,
  options: LoadPreviewOptions = {},
): Promise<DocumentPreview> {
  const fileId = documentRecord.driveFileId || documentRecord.id
  if (documentRecord.driveFileId) await ensureCacheMatchesVersion(documentRecord)

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
      downloadable: true,
    }
  }

  // ── 2. Check IndexedDB offline preview store for instant 0ms offline load ─────────
  const [offlinePreview, offlineBlobItem] = await Promise.all([getOfflinePreview(fileId), getOfflineBlob(fileId)])

  if (offlinePreview && offlinePreview.formatVersion === PREVIEW_FORMAT_VERSION && offlineBlobItem?.blob) {
    const freshUrl = URL.createObjectURL(offlineBlobItem.blob)
    const result: DocumentPreview = {
      kind: offlinePreview.kind as PreviewKind,
      blob: offlineBlobItem.blob,
      objectUrl: freshUrl,
      text: offlinePreview.text,
      html: offlinePreview.html,
      sheets: offlinePreview.sheets,
      downloadable: true,
    }

    storeParsedInCache(fileId, {
      kind: result.kind,
      blob: offlineBlobItem.blob,
      objectUrl: freshUrl,
      text: result.text,
      html: result.html,
      sheets: result.sheets,
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

  // Legacy binary Office formats (.doc, .ppt) and others the browser cannot
  // render (OpenDocument text and slides, TIFF) use Google Drive's own
  // preview, which loads itself. Downloading the file first only delayed it;
  // the Download button fetches the original when asked.
  if (getPreviewKind(documentRecord) === 'embed') {
    return {
      kind: 'embed',
      blob: new Blob([], { type: localMimeType }),
      objectUrl: '',
      embedUrl: driveEmbedUrl,
      downloadable: true,
    }
  }

  if (!accessToken) {
    // An offline copy without a current parsed preview can still be rendered.
    if (!offlineBlobItem?.blob) {
      throw new GoogleDriveError(401, 'Google Drive authorization is required to open this document.', 'tokenMissing')
    }
  } else if (isGoogleWorkspace && navigator.onLine) {
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

  // ── 4. Use this device's copy, or download it ──────────────────────────────
  // A stored copy belongs to the record's current version: older ones were
  // dropped by ensureCacheMatchesVersion above.
  const blob = offlineBlobItem?.blob
    ?? await downloadDriveFile(accessToken!, documentRecord.driveFileId, resolvedMimeType, resolvedMimeType, options)

  const typedBlob = blob.type ? blob : new Blob([blob], { type: resolvedMimeType || localMimeType })
  const objectUrl = URL.createObjectURL(typedBlob)
  const kind = getPreviewKind({ ...documentRecord, mimeType: resolvedMimeType })
  const isDocx = /\.docx$/i.test(fileName) || resolvedMimeType.includes('wordprocessingml') || resolvedMimeType === 'application/vnd.google-apps.document'
  const isSheet = /\.(xlsx|xlsm|xls|ods|csv|tsv)$/i.test(fileName) || resolvedMimeType.includes('spreadsheetml') || resolvedMimeType === 'application/vnd.google-apps.spreadsheet'
  const isPptx = /\.pptx$/i.test(fileName) || resolvedMimeType.includes('presentationml') || resolvedMimeType === 'application/vnd.google-apps.presentation'

  // ── 5. Parse / render content ─────────────────────────────────────────────────────
  let result: DocumentPreview

  if (kind === 'text') {
    result = {
      kind,
      blob: typedBlob,
      objectUrl,
      text: /\.rtf$/i.test(fileName) ? stripRtf(await typedBlob.text()) : await typedBlob.text(),
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
  } else if (kind === 'office' && isDocx) {
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
  } else if (kind === 'office' && isSheet) {
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
  } else if (kind === 'office' && isPptx) {
    // Slides are parsed on demand by the presentation viewer, so only the
    // original file is kept here.
    result = { kind: 'presentation', blob: typedBlob, objectUrl, downloadable: true }
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
    createdAt: Date.now(),
  })

  void saveOfflinePreview(fileId, result.kind, PREVIEW_FORMAT_VERSION, {
    text: result.text,
    html: result.html,
    sheets: result.sheets,
  })

  return result
}

// Formats decided by extension before the stored kind, since older uploads
// recorded several of them as 'word', 'image' or 'other'.
const kindByExtension: Array<[RegExp, PreviewKind]> = [
  [/\.(doc|ppt|pps|odt|odp|tiff?|heic)$/, 'embed'],
  // Scripts are shown as escaped text; nothing in the vault is ever run.
  [/\.(rtf|json|xml|md|markdown|log|ya?ml|ini|cfg|url|tex|srt|vtt|bat|cmd|ps1|vbs|js|ts|py|sh|sql)$/, 'text'],
  [/\.(xlsx|xlsm|xls|ods|csv|tsv)$/, 'office'],
  [/\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|mp4|m4v|webm|ogv|mov)$/, 'media'],
  [/\.zip$/, 'archive'],
  [/\.epub$/, 'epub'],
  [/\.(lnk|exe|msi|dll|jar|scr|com)$/, 'fallback'],
]

export function getPreviewKind(documentRecord: Pick<VaultDocument, 'fileType' | 'mimeType' | 'originalName'>): PreviewKind {
  const lowerName = (documentRecord.originalName ?? '').toLowerCase()
  for (const [pattern, kind] of kindByExtension) if (pattern.test(lowerName)) return kind
  if (/^(audio|video)\//.test(documentRecord.mimeType)) return 'media'
  if (documentRecord.mimeType === 'application/epub+zip') return 'epub'
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

/**
 * Content Security Policy injected into every previewed HTML or Word document.
 * Previews are shown in sandboxed frames without script permission; the policy
 * additionally stops remote requests (tracking images, web fonts, stylesheets)
 * that would tell a third party a private document was opened.
 */
const PREVIEW_CSP =
  "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'"

/**
 * Strips active content from untrusted HTML. Full documents (shown in sandboxed
 * frames) get the preview CSP; `fragment` output is for inline use, where a
 * <meta> policy would be ignored, so it returns the styles and body only.
 */
export function sanitizeHtml(html: string, { fragment = false }: { fragment?: boolean } = {}) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  doc
    .querySelectorAll('script, object, embed, applet, base, form, input, button, textarea, select, iframe, frame, frameset, link, meta[http-equiv]')
    .forEach((node) => {
      node.remove()
    })

  doc.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim()
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name)
      }
      if (name === 'href' || name === 'src' || name === 'xlink:href' || name === 'action' || name === 'formaction') {
        if (/^\s*(javascript|vbscript):/i.test(value)) {
          element.removeAttribute(attribute.name)
        } else if (/^data:/i.test(value) && !/^data:image\/(png|jpe?g|gif|webp|bmp)/i.test(value)) {
          element.removeAttribute(attribute.name)
        }
      }
    }
  })

  if (fragment) {
    const styles = Array.from(doc.head.querySelectorAll('style'), (style) => style.outerHTML).join('')
    return styles + doc.body.innerHTML
  }

  const csp = doc.createElement('meta')
  csp.setAttribute('http-equiv', 'Content-Security-Policy')
  csp.setAttribute('content', PREVIEW_CSP)
  doc.head.prepend(csp)

  return `<!doctype html>${doc.documentElement.outerHTML}`
}

export async function renderDocx(blob: Blob) {
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
            color: #2a2119;
            background-color: #ffffff;
            padding: 40px 48px;
            max-width: 850px;
            margin: 20px auto;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.05);
            border-radius: 8px;
            border: 1px solid #ebe1d4;
          }
          h1, h2, h3, h4, h5, h6 { color: #2a2119; margin-top: 1.5em; margin-bottom: 0.5em; line-height: 1.3; font-weight: 700; }
          h1 { font-size: 2em; border-bottom: 2px solid #ebe1d4; padding-bottom: 0.3em; }
          h2 { font-size: 1.5em; }
          h3 { font-size: 1.25em; }
          p { margin-bottom: 1em; }
          img { max-width: 100%; height: auto; display: block; margin: 16px auto; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
          table { border-collapse: collapse; width: 100%; margin: 20px 0; font-size: 0.95em; }
          th, td { border: 1px solid #ddd0bf; padding: 10px 14px; text-align: left; vertical-align: top; }
          th { background-color: #f4ebe1; font-weight: 600; color: #4a3c2e; }
          tr:nth-child(even) td { background-color: #fbf8f4; }
          blockquote { border-left: 4px solid #a67c52; padding-left: 16px; margin: 16px 0; color: #6b5a48; font-style: italic; }
          ul, ol { padding-left: 24px; margin-bottom: 1em; }
          li { margin-bottom: 0.3em; }
          a { color: #8a5a2b; text-decoration: underline; }
        </style>
      </head>
      <body>
        ${result.value}
      </body>
    </html>
  `
  return sanitizeHtml(styledHtml)
}

export async function renderSpreadsheet(blob: Blob): Promise<SpreadsheetSheet[]> {
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
          color: #2a2119;
          background-color: #ffffff;
        }
        #sheet-${cssSafeId(name)} td, #sheet-${cssSafeId(name)} th {
          border: 1px solid #ddd0bf;
          padding: 8px 12px;
          white-space: nowrap;
          min-width: 60px;
        }
        #sheet-${cssSafeId(name)} th {
          background-color: #f4ebe1;
          font-weight: 600;
          color: #6b5a48;
          text-align: center;
        }
        #sheet-${cssSafeId(name)} tr:nth-child(even) td {
          background-color: #fbf8f4;
        }
        #sheet-${cssSafeId(name)} tr:hover td {
          background-color: #ebe1d4;
        }
      </style>
      ${rawHtml}
    `
    return {
      name,
      html: sanitizeHtml(styledSheet, { fragment: true }),
    }
  })
}

function cssSafeId(value: string) {
  return value.replace(/[^a-z0-9_-]/gi, '-')
}
