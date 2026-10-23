import { CompanionError, type IndexStatus, type LinkStatus, type LocalKind, type LocalRoot, type MatchType, type OcrState, type TextExcerpt, type TextState } from '../../services/desktopCompanion'

export const numberFormat = new Intl.NumberFormat()
export const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export type Tone = '' | 'success' | 'danger' | 'accent'

/** One plain-language state for a library, from its access state and its scan status. */
export function libraryState(root: LocalRoot, index?: IndexStatus | null): { label: string; tone: Tone; detail?: string } {
  if (root.state === 'revoked') return { label: 'Access revoked', tone: 'danger', detail: 'Nothing in this library is searched, listed or read.' }
  if (root.needsPermission) {
    return { label: 'Permission needed', tone: 'danger', detail: 'Document Vault cannot currently access this folder. Grant access again by choosing the same folder.' }
  }
  if (root.status === 'unavailable') {
    return { label: 'Not available', tone: 'danger', detail: root.error ?? 'Reconnect the drive that holds this folder.' }
  }
  if (root.state === 'paused') return { label: 'Paused', tone: '', detail: 'Search uses what was already indexed. Changes are not picked up.' }
  if (index?.current?.rootId === root.id) return { label: 'Indexing', tone: 'accent' }
  if (root.status === 'pending' || root.status === 'indexing') return { label: 'Waiting to index', tone: '' }
  const reading = (root.extraction.pending ?? 0) + (root.extraction.processing ?? 0)
  if (root.settings.extractText && reading > 0) return { label: 'Reading text', tone: 'accent' }
  if (root.ocr?.pref === 'on' && root.ocr.pending > 0) return { label: 'Recognising scans', tone: 'accent' }
  return { label: root.watching ? 'Up to date' : 'Indexed', tone: 'success' }
}

/** How much of a library's text has been read, as a count and a fraction. */
export function textProgress(root: LocalRoot) {
  const counts = root.extraction
  const done = (counts.completed ?? 0) + (counts.failed ?? 0) + (counts.unsupported ?? 0)
  const total = done + (counts.pending ?? 0) + (counts.processing ?? 0) + (counts.cancelled ?? 0) + (counts.waiting_permission ?? 0) + (counts.waiting_drive ?? 0)
  return { done, total, readable: counts.completed ?? 0, failed: counts.failed ?? 0 }
}

/** Text recognition of a library's scanned pages: pages done of pages found, while there is work left. */
export function ocrProgress(root: LocalRoot) {
  const ocr = root.ocr
  if (!ocr || ocr.pref !== 'on' || ocr.pending === 0) return null
  return { done: Math.min(ocr.recognisedPages, ocr.scannedPages), total: ocr.scannedPages, current: ocr.current }
}

/** Whether to offer text recognition: scans were found and the owner has not decided yet. */
export function offersOcr(root: LocalRoot) {
  return root.state !== 'revoked' && root.ocr?.pref === 'ask' && root.ocr.scannedDocs > 0
}

export const ocrStateLabels: Record<OcrState, string> = {
  none: 'Scanned pages not recognised',
  pending: 'Waiting to recognise scanned pages',
  processing: 'Recognising scanned pages',
  completed: 'Scanned pages recognised',
  failed: 'Scanned pages could not be recognised',
  cancelled: 'Recognition stopped',
  changed: 'Recognised again after the file is read',
}

/** Shown with every passage recognised from a scan. */
export const OCR_NOTE = 'Text recognised from a scan; it may contain errors.'

export const kindLabels: Record<LocalKind, string> = {
  folder: 'Folder',
  pdf: 'PDF',
  word: 'Word',
  spreadsheet: 'Spreadsheet',
  presentation: 'Presentation',
  image: 'Image',
  text: 'Text',
  html: 'Web page',
  ebook: 'eBook',
  audio: 'Audio',
  video: 'Video',
  archive: 'Archive',
  shortcut: 'Shortcut',
  program: 'Program',
  other: 'File',
}

/** The file types a library can be limited to, with those whose text is read first. */
export const libraryFileTypes: Array<{ kind: LocalKind; label: string; text: boolean }> = [
  { kind: 'pdf', label: 'PDF', text: true },
  { kind: 'word', label: 'Word documents (text read from .docx)', text: true },
  { kind: 'ebook', label: 'eBooks (text read from .epub)', text: true },
  { kind: 'html', label: 'Web pages (.htm, .html)', text: true },
  { kind: 'text', label: 'Text and RTF', text: true },
  { kind: 'presentation', label: 'Presentations (text read from .pptx)', text: true },
  { kind: 'spreadsheet', label: 'Spreadsheets (names only)', text: false },
  { kind: 'image', label: 'Images (text recognised from .jpg and .png scans when OCR is on)', text: false },
  { kind: 'shortcut', label: 'Shortcuts', text: false },
  { kind: 'archive', label: 'Archives (names only)', text: false },
  { kind: 'audio', label: 'Audio (names only)', text: false },
  { kind: 'video', label: 'Video (names only)', text: false },
  { kind: 'other', label: 'Other files (names only)', text: false },
]

export const matchLabels: Record<MatchType, string> = {
  title: 'Title match',
  filename: 'File name match',
  phrase: 'Exact phrase in text',
  text: 'Found in text',
  metadata: 'Author or subject match',
  name: 'Name or folder match',
  fuzzy: 'Similar name',
}

export const textStateLabels: Record<TextState, string> = {
  pending: 'Waiting to be read',
  processing: 'Being read',
  completed: 'Text read',
  failed: 'Could not be read',
  cancelled: 'Stopped',
  waiting_permission: 'Waiting for permission',
  waiting_drive: 'Waiting for the drive',
  unsupported: 'Text not read for this type',
}

export const linkStatusLabels: Record<LinkStatus, { label: string; tone: Tone; help: string }> = {
  verified: { label: 'Found', tone: 'success', help: 'The linked book is in this library and can be opened.' },
  unindexed: { label: 'Not indexed', tone: '', help: 'The target is inside the library but excluded or not indexed by the current settings.' },
  broken: { label: 'Broken', tone: 'danger', help: 'Nothing exists at the linked location inside the library.' },
  outside: { label: 'Outside library', tone: 'danger', help: 'The link points outside your libraries. It is never followed.' },
  external: { label: 'Web link', tone: '', help: 'A link to a website. It is not opened or fetched automatically.' },
}

export function errorText(error: unknown, fallback = 'The companion could not do that.') {
  return error instanceof CompanionError ? error.message : fallback
}

/** Splits a companion excerpt into plain and matching parts (matches are wrapped in << and >>). */
export function excerptParts(text: string) {
  const parts: Array<{ text: string; hit: boolean }> = []
  const pattern = /<<(.*?)>>/gs
  let last = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), hit: false })
    if (match[1]) parts.push({ text: match[1], hit: true })
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false })
  return parts
}

/** Where a passage is: its page, or its chapter or section for formats without pages. */
export function whereLabel(match: TextExcerpt) {
  if (match.page) return `Page ${match.page}`
  if (match.source === 'ocr') return 'Scanned picture'
  if (match.label) return match.label
  return `Section ${match.section}`
}
