import { auth } from './firebase'
import { supabase } from './supabase'
import type { VaultDocument } from '../types/document'
import { isOcrEnabled, looksScanned, recognizeImage, recognizePdf } from './ocr'
import { whenNoDocumentOpen } from './foreground'
import { isMemoryConstrained } from '../utils/device'

// Full-text search over the words inside uploaded documents. Text is extracted
// in the browser whenever the file is already in hand (after an upload, or when
// the document is opened) and stored in Postgres `document_contents`, where
// row-level security keeps it private to its owner. Files are never sent
// anywhere new: only their plain text reaches the database. Failures are
// logged and ignored, so indexing can never break uploading or viewing.

/**
 * Bump when extraction improves, so documents are re-indexed when next opened.
 * Version 2 reads pictures and scanned PDFs with OCR.
 */
export const EXTRACTOR_VERSION = 2

const OCR_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'])

const MAX_CHARS = 2_000_000 // the document_contents check constraint
const MAX_PDF_PAGES = 1500
const RETRY_DELAYS_MS = [5_000, 20_000, 60_000]
/**
 * Reading a file's text opens a second copy of it, so phones and tablets leave
 * large files (and OCR) to a computer; the text is indexed when it is opened there.
 */
const MAX_BYTES_CONSTRAINED = 25 * 1024 * 1024
const FOREIGN_KEY_VIOLATION = '23503'
const UNKNOWN_FUNCTION = 'PGRST202'

type IndexTarget = Pick<VaultDocument, 'id' | 'name' | 'originalName' | 'mimeType' | 'fileType'>

const done = new Set<string>()
const inFlight = new Set<string>()

if (typeof window !== 'undefined') {
  window.addEventListener('documentVault.sessionEnded', () => done.clear())
}

const extension = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? ''
const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Plain text of a document, or null when its format has no text to extract. */
export async function extractDocumentText(blob: Blob, target: Pick<IndexTarget, 'name' | 'originalName' | 'mimeType' | 'fileType'>): Promise<string | null> {
  const ext = extension(target.originalName || target.name)
  const mime = target.mimeType || blob.type

  if (target.fileType === 'pdf' || ext === 'pdf' || mime === 'application/pdf') return extractPdf(blob)
  if (ext === 'docx' || mime.includes('wordprocessingml')) {
    const mammoth = await import('mammoth/mammoth.browser')
    return (await mammoth.extractRawText({ arrayBuffer: await blob.arrayBuffer() })).value
  }
  if (['xlsx', 'xls', 'xlsm', 'ods', 'csv', 'tsv'].includes(ext) || mime.includes('spreadsheetml')) {
    const XLSX = await import('xlsx')
    const workbook = XLSX.read(await blob.arrayBuffer(), { type: 'array', dense: true })
    return workbook.SheetNames.map((name) => `${name}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name], { blankrows: false })}`).join('\n\n')
  }
  if (ext === 'pptx' || mime.includes('presentationml')) {
    const { extractPptxText } = await import('./pptx')
    return (await extractPptxText(blob)).join('\n\n')
  }
  if (['html', 'htm', 'xhtml'].includes(ext) || mime === 'text/html') {
    const parsed = new DOMParser().parseFromString(await blob.text(), 'text/html')
    parsed.querySelectorAll('script, style, noscript, template').forEach((node) => node.remove())
    return parsed.body?.textContent ?? ''
  }
  if (
    target.fileType === 'text' ||
    mime.startsWith('text/') ||
    ['txt', 'md', 'markdown', 'json', 'xml', 'rtf', 'log', 'yaml', 'yml', 'ini'].includes(ext)
  ) {
    const text = await blob.slice(0, MAX_CHARS * 2).text()
    return ext === 'rtf' ? stripRtf(text) : text
  }
  return null
}

async function extractPdf(blob: Blob) {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  const task = pdfjs.getDocument({ data: await blob.arrayBuffer() })
  const pdf = await task.promise
  try {
    const pages: string[] = []
    let length = 0
    for (let number = 1; number <= Math.min(pdf.numPages, MAX_PDF_PAGES) && length < MAX_CHARS; number += 1) {
      const page = await pdf.getPage(number)
      const content = await page.getTextContent()
      const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ')
      pages.push(text)
      length += text.length
      page.cleanup()
      await yieldToBrowser()
    }
    return pages.join('\n')
  } finally {
    void task.destroy()
  }
}

// Groups that hold settings, fonts, pictures or metadata rather than body text.
const RTF_HIDDEN_GROUPS = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'themedata', 'datastore', 'latentstyles'])
const RTF_BREAKS = new Set(['par', 'line', 'row', 'page', 'sect'])

/** The visible text of an RTF document: control words, tables of fonts and colours and pictures are dropped. */
export function stripRtf(rtf: string) {
  let out = ''
  let depth = 0
  let hiddenFrom = Infinity // depth of the hidden group being skipped
  let groupStart = false
  const token = /\\([a-z]+)(-?\d+)? ?|\\'([0-9a-f]{2})|\\([\\{}])|\\\*|\\.|([{}])|([^\\{}]+)/giy
  for (let match = token.exec(rtf); match; match = token.exec(rtf)) {
    const [, word, , hex, escaped, brace, text] = match
    const hidden = depth >= hiddenFrom
    if (brace === '{') {
      depth += 1
      groupStart = true
      continue
    }
    if (brace === '}') {
      if (depth === hiddenFrom) hiddenFrom = Infinity
      depth -= 1
      groupStart = false
      continue
    }
    const startsGroup = groupStart
    groupStart = false
    if (match[0] === '\\*') {
      if (startsGroup && !hidden) hiddenFrom = depth
      continue
    }
    if (hidden) continue
    if (word) {
      if (startsGroup && RTF_HIDDEN_GROUPS.has(word.toLowerCase())) hiddenFrom = depth
      else if (RTF_BREAKS.has(word)) out += '\n'
      else if (word === 'tab' || word === 'cell') out += ' '
    } else if (hex) out += String.fromCharCode(parseInt(hex, 16))
    else if (escaped) out += escaped
    else if (text) out += text.replace(/[\r\n]+/g, '')
  }
  return out.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim()
}

/** Collapses whitespace and caps the text at the database limit. */
export function normaliseContent(text: string) {
  return text.replaceAll('\u0000', '').replace(/[ \t\f\v\r]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_CHARS)
}

/**
 * Extracts and stores a document's text in the background. Documents already
 * indexed by this extractor version are skipped, unless `force` is set because
 * the file's contents were replaced. A new upload may reach this
 * before its metadata row is mirrored to Postgres, so that case is retried.
 */
export function queueContentIndex(target: IndexTarget, blob: Blob, options: { force?: boolean } = {}) {
  if (options.force) done.delete(target.id)
  if (!supabase || !auth.currentUser || done.has(target.id) || inFlight.has(target.id) || blob.size === 0) return
  if (isMemoryConstrained() && blob.size > MAX_BYTES_CONSTRAINED) return
  inFlight.add(target.id)
  // One document at a time, and only while none is open in the viewer.
  queue = queue.then(async () => {
    await whenNoDocumentOpen()
    await new Promise<void>((resolve) => {
      if ('requestIdleCallback' in window) window.requestIdleCallback(() => resolve(), { timeout: 4000 })
      else setTimeout(resolve, 500)
    })
    await indexNow(target, blob, options.force === true).finally(() => inFlight.delete(target.id))
  })
}

let queue: Promise<void> = Promise.resolve()

async function indexNow(target: IndexTarget, blob: Blob, force: boolean) {
  const client = supabase
  if (!client) return
  try {
    if (!force) {
      const existing = await client.from('document_contents').select('extractor_version').eq('document_id', target.id).maybeSingle()
      if (existing.data && existing.data.extractor_version >= EXTRACTOR_VERSION) {
        done.add(target.id)
        return
      }
    }

    let raw = await extractDocumentText(blob, target)
    let source: 'extracted' | 'ocr' = 'extracted'
    const ocrKind = ocrKindOf(target, blob)
    if (ocrKind && looksScanned(raw) && isOcrEnabled()) {
      // OCR needs far more memory than a phone page may use; a computer does it instead.
      if (isMemoryConstrained()) return
      const recognised = ocrKind === 'image' ? await recognizeImage(blob) : await recognizePdf(blob)
      if (recognised.trim()) {
        raw = recognised
        source = 'ocr'
      }
    }
    if (raw === null) {
      // A replaced file's old text must not keep matching searches.
      if (force) await client.from('document_contents').delete().eq('document_id', target.id)
      done.add(target.id)
      return
    }
    const content = normaliseContent(raw)
    const row = { document_id: target.id, content, source, extractor_version: EXTRACTOR_VERSION, indexed_at: new Date().toISOString() }

    for (let attempt = 0; ; attempt += 1) {
      const { error } = await client.from('document_contents').upsert(row, { onConflict: 'document_id' })
      if (!error) break
      if (error.code !== FOREIGN_KEY_VIOLATION || attempt >= RETRY_DELAYS_MS.length) throw error
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]))
    }
    done.add(target.id)
  } catch (error) {
    console.warn('Could not index the text of', target.name, error instanceof Error ? error.message : (error as { message?: string })?.message)
  }
}

/** Whether OCR could find words in this file: pictures the browser can decode, and PDFs. */
function ocrKindOf(target: Pick<IndexTarget, 'name' | 'originalName' | 'mimeType' | 'fileType'>, blob: Blob): 'image' | 'pdf' | null {
  const ext = extension(target.originalName || target.name)
  const mime = target.mimeType || blob.type
  if (target.fileType === 'pdf' || ext === 'pdf' || mime === 'application/pdf') return 'pdf'
  if (OCR_IMAGE_EXTENSIONS.has(ext) || /^image\/(png|jpeg|webp|bmp|gif)$/.test(mime)) return 'image'
  return null
}

/** Gives a copied document the indexed text of its original, so the copy is searchable at once. */
export async function copyIndexedContent(fromId: string, toId: string) {
  const client = supabase
  if (!client || !auth.currentUser) return
  try {
    const { data } = await client.from('document_contents').select('content, source, extractor_version').eq('document_id', fromId).maybeSingle()
    if (!data) return
    const row = { document_id: toId, content: data.content, source: data.source, extractor_version: data.extractor_version, indexed_at: new Date().toISOString() }
    for (let attempt = 0; ; attempt += 1) {
      const { error } = await client.from('document_contents').upsert(row, { onConflict: 'document_id' })
      if (!error) break
      if (error.code !== FOREIGN_KEY_VIOLATION || attempt >= RETRY_DELAYS_MS.length) throw error
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]))
    }
    done.add(toId)
  } catch (error) {
    console.warn('Could not copy indexed text:', error instanceof Error ? error.message : (error as { message?: string })?.message)
  }
}

export interface ContentMatch {
  id: string
  rank: number
  matchedContent: boolean
  snippet: string | null
  driveMissing: boolean
}

export interface ContentSearchPage {
  items: ContentMatch[]
  total: number
}

/**
 * Ranked search over names, metadata and document text. Uses the paged search
 * when the database has it, otherwise the original search, paged here.
 */
export async function searchDocumentContent(text: string, limit: number, offset: number, signal?: AbortSignal): Promise<ContentSearchPage | null> {
  const client = supabase
  const query = text.trim()
  if (!client || !auth.currentUser || query.length === 0) return null

  const paged = await client
    .rpc('search_documents_page', { search_query: query, max_results: limit, result_offset: offset })
    .abortSignal(signal ?? new AbortController().signal)
  if (!paged.error) {
    const rows = (paged.data ?? []) as Array<Record<string, unknown>>
    return { items: rows.map(toMatch), total: rows.length > 0 ? Number(rows[0].total_count) : offset }
  }
  if (paged.error.code !== UNKNOWN_FUNCTION) throw paged.error

  const fallback = await client
    .rpc('search_documents', { search_query: query, max_results: Math.min(offset + limit, 200) })
    .abortSignal(signal ?? new AbortController().signal)
  if (fallback.error) throw fallback.error
  const rows = (fallback.data ?? []) as Array<Record<string, unknown>>
  return { items: rows.slice(offset, offset + limit).map(toMatch), total: rows.length }
}

function toMatch(row: Record<string, unknown>): ContentMatch {
  return {
    id: String(row.id),
    rank: Number(row.rank) || 0,
    matchedContent: Boolean(row.matched_content),
    snippet: typeof row.snippet === 'string' ? row.snippet : null,
    driveMissing: Boolean(row.drive_missing),
  }
}

/** Splits a `<<highlighted>>` snippet into text parts, so it can be rendered without HTML. */
export function snippetParts(snippet: string) {
  const parts: Array<{ text: string; hit: boolean }> = []
  const pattern = /<<(.*?)>>/g
  let last = 0
  for (let match = pattern.exec(snippet); match; match = pattern.exec(snippet)) {
    if (match.index > last) parts.push({ text: snippet.slice(last, match.index), hit: false })
    parts.push({ text: match[1], hit: true })
    last = match.index + match[0].length
  }
  if (last < snippet.length) parts.push({ text: snippet.slice(last), hit: false })
  return parts
}
