// Reads text and metadata from documents. Runs inside the extraction worker
// (worker.js), never in the main process, so a malformed or hostile file can
// at worst crash or time out that worker.
//
// Every reader returns
//   { sections: [{ page, label, text }], meta: [{ field, value, source }],
//     links: [{ href, label }], pages, textPages, truncated }
// where `page` is a real page (or slide) number only when the format has one.

import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import JSZip from 'jszip'
import { decodeHtml, decodeEntities, parseHtml } from './html.js'
import { decodeText, rtfToText, sections } from './text.js'

const require = createRequire(import.meta.url)

// Limits for compressed formats (Word, EPUB, PowerPoint), against zip bombs.
const MAX_UNPACKED_TOTAL = 400 * 1024 * 1024
const MAX_UNPACKED_PART = 64 * 1024 * 1024
const MAX_PARTS = 20000
// A page with fewer letters than this has no usable text layer (for example a scanned page).
export const MIN_PAGE_LETTERS = 20

// Pictures have no text to read; they are listed so text recognition (OCR) can pick them up.
export const OCR_IMAGES = new Set(['jpg', 'jpeg', 'png'])
export const EXTRACTABLE = new Set(['pdf', 'docx', 'epub', 'pptx', 'html', 'htm', 'xhtml', 'txt', 'md', 'markdown', 'rtf', ...OCR_IMAGES])
/** Formats whose pages can be recognised when they have no text layer. */
export const OCR_FORMATS = new Set(['pdf', ...OCR_IMAGES])

export async function extractDocument(extension, bytes, { maxPages = 5000 } = {}) {
  switch (extension) {
    case 'pdf':
      return extractPdf(bytes, maxPages)
    case 'docx':
      return extractDocx(bytes)
    case 'epub':
      return extractEpub(bytes, maxPages)
    case 'pptx':
      return extractPptx(bytes, maxPages)
    case 'html':
    case 'htm':
    case 'xhtml':
      return extractHtml(bytes)
    case 'rtf':
      return plain(rtfToText(decodeText(bytes, 'windows-1252')))
    case 'txt':
    case 'md':
    case 'markdown':
      return plain(decodeText(bytes))
    case 'jpg':
    case 'jpeg':
    case 'png':
      // A picture: one page, without text until it is recognised.
      return { sections: [], meta: [], links: [], pages: 1, textPages: 0, truncated: false }
    default:
      throw Object.assign(new Error('This file type has no readable text.'), { code: 'UNSUPPORTED' })
  }
}

function plain(text) {
  const parts = sections(text)
  return { sections: parts.map((part) => ({ page: null, label: null, text: part })), meta: [], links: [], pages: null, textPages: null, truncated: false }
}

export const letters = (text) => (text.match(/\p{L}/gu) ?? []).length

// ── PDF ────────────────────────────────────────────────────────────────────

let pdfjs = null

// pdf.js creates a DOMMatrix when it loads, for drawing pages. Only text is
// read here, so these stand-ins replace the native canvas package (which is
// not shipped): they can be created, and any attempt to draw with them fails
// loudly instead of producing wrong results.
class NoDrawing {
  constructor() {
    return new Proxy(this, {
      get(target, property) {
        if (property in target || typeof property === 'symbol') return target[property]
        return () => {
          throw new Error('Drawing is not available while reading text.')
        }
      },
    })
  }
}

async function extractPdf(bytes, maxPages) {
  globalThis.DOMMatrix ??= class DOMMatrix extends NoDrawing {}
  globalThis.Path2D ??= class Path2D extends NoDrawing {}
  pdfjs ??= await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href)
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    disableAutoFetch: true,
    disableStream: true,
    stopAtErrors: false,
    verbosity: 0,
  })
  const document = await task.promise
  try {
    const count = Math.min(document.numPages, maxPages)
    const labels = await document.getPageLabels().catch(() => null)
    const result = []
    let textPages = 0
    for (let number = 1; number <= count; number += 1) {
      const page = await document.getPage(number)
      const content = await page.getTextContent()
      let text = ''
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue
        text += item.str
        text += item.hasEOL ? '\n' : item.str.endsWith(' ') ? '' : ' '
      }
      page.cleanup()
      text = text.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim()
      if (letters(text) >= MIN_PAGE_LETTERS) textPages += 1
      // Pages without text are kept (empty) so page numbers stay right.
      const label = labels?.[number - 1] && labels[number - 1] !== String(number) ? labels[number - 1] : null
      result.push({ page: number, label, text })
    }
    const { info, metadata } = await document.getMetadata().catch(() => ({}))
    const meta = []
    const add = (field, value) => {
      const clean = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
      if (clean && !meta.some((entry) => entry.field === field)) meta.push({ field, value: clean.slice(0, 500), source: 'original' })
    }
    add('title', metadata?.get?.('dc:title') ?? info?.Title)
    add('author', metadata?.get?.('dc:creator')?.toString?.() ?? info?.Author)
    add('subject', info?.Subject)
    add('keywords', info?.Keywords)
    add('published', pdfDate(info?.CreationDate))
    return { sections: result, meta, links: [], pages: document.numPages, textPages, truncated: document.numPages > count }
  } finally {
    await task.destroy()
  }
}

function pdfDate(value) {
  const match = typeof value === 'string' ? /^D?:?(\d{4})(\d{2})?(\d{2})?/.exec(value) : null
  if (!match) return null
  return [match[1], match[2], match[3]].filter(Boolean).join('-')
}

// ── Zip-based formats ──────────────────────────────────────────────────────

async function openZip(bytes) {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: false })
  const files = Object.values(zip.files)
  if (files.length > MAX_PARTS) throw Object.assign(new Error('The document has too many parts to read safely.'), { code: 'TOO_COMPLEX' })
  let total = 0
  for (const file of files) {
    // The sizes recorded in the zip directory; checked before anything is unpacked.
    const size = Number(file._data?.uncompressedSize ?? 0)
    if (size > MAX_UNPACKED_PART) throw Object.assign(new Error('A part of the document is too large to read safely.'), { code: 'TOO_LARGE' })
    total += size
  }
  if (total > MAX_UNPACKED_TOTAL) throw Object.assign(new Error('The document unpacks to more data than can be read safely.'), { code: 'TOO_LARGE' })
  return zip
}

const readPart = async (zip, name) => {
  const file = zip.file(name)
  return file ? file.async('string') : null
}

/** Text of the first element with this tag name (any namespace prefix). */
function xmlValue(xml, tag) {
  const match = new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, 'i').exec(xml ?? '')
  const value = match ? decodeEntities(match[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() : ''
  return value || null
}

function coreMeta(xml) {
  const meta = []
  for (const [field, tag] of [['title', 'title'], ['author', 'creator'], ['subject', 'subject'], ['keywords', 'keywords'], ['published', 'created']]) {
    const value = xmlValue(xml, tag)
    if (value) meta.push({ field, value: field === 'published' ? value.slice(0, 10) : value.slice(0, 500), source: 'original' })
  }
  return meta
}

async function extractDocx(bytes) {
  const zip = await openZip(bytes)
  const mammoth = (await import('mammoth')).default
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
  const result = plain(value)
  result.meta = coreMeta(await readPart(zip, 'docProps/core.xml'))
  return result
}

async function extractEpub(bytes, maxSections) {
  const zip = await openZip(bytes)
  const container = await readPart(zip, 'META-INF/container.xml')
  const opfPath = /full-path\s*=\s*["']([^"']+)["']/i.exec(container ?? '')?.[1]
  if (!opfPath) throw Object.assign(new Error('This EPUB has no table of contents file.'), { code: 'MALFORMED' })
  const opf = (await readPart(zip, opfPath)) ?? ''
  const base = path.posix.dirname(opfPath)
  const manifest = new Map()
  for (const match of opf.matchAll(/<item\b([^>]*)>/gi)) {
    const id = /\bid\s*=\s*["']([^"']+)["']/i.exec(match[1])?.[1]
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(match[1])?.[1]
    if (id && href) manifest.set(id, path.posix.join(base === '.' ? '' : base, decodeURIComponent(href)))
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*\bidref\s*=\s*["']([^"']+)["']/gi)].map((match) => manifest.get(match[1])).filter(Boolean)
  const result = []
  for (const part of spine.slice(0, maxSections)) {
    const file = zip.file(part)
    if (!file) continue
    const page = parseHtml(decodeHtml(await file.async('uint8array')))
    if (!page.text) continue
    const label = (page.headings[0]?.text || page.title || null)?.slice(0, 120) ?? null
    for (const text of sections(page.text)) result.push({ page: null, label, text })
  }
  const meta = []
  for (const [field, tag] of [['title', 'title'], ['author', 'creator'], ['publisher', 'publisher'], ['published', 'date'], ['language', 'language'], ['subject', 'subject']]) {
    const value = xmlValue(opf, tag)
    if (value) meta.push({ field, value: value.slice(0, 500), source: 'original' })
  }
  for (const match of opf.matchAll(/<(?:[\w-]+:)?identifier\b[^>]*>([^<]+)</gi)) {
    const digits = match[1].replace(/[^0-9X]/gi, '')
    if (/isbn/i.test(match[0]) || digits.length === 13 || digits.length === 10) {
      if (digits.length === 10 || digits.length === 13) {
        meta.push({ field: 'isbn', value: digits, source: 'original' })
        break
      }
    }
  }
  return { sections: result, meta, links: [], pages: null, textPages: null, truncated: spine.length > maxSections }
}

async function extractPptx(bytes, maxSlides) {
  const zip = await openZip(bytes)
  // Slide order comes from presentation.xml (not from the part names).
  const presentation = (await readPart(zip, 'ppt/presentation.xml')) ?? ''
  const rels = (await readPart(zip, 'ppt/_rels/presentation.xml.rels')) ?? ''
  const targets = new Map()
  for (const match of rels.matchAll(/<Relationship\b([^>]*)>/gi)) {
    const id = /\bId\s*=\s*["']([^"']+)["']/.exec(match[1])?.[1]
    const target = /\bTarget\s*=\s*["']([^"']+)["']/.exec(match[1])?.[1]
    if (id && target) targets.set(id, path.posix.join('ppt', target.replace(/^\/ppt\//, '')))
  }
  const order = [...presentation.matchAll(/<p:sldId\b[^>]*\br:id\s*=\s*["']([^"']+)["']/gi)].map((match) => targets.get(match[1])).filter(Boolean)
  const result = []
  let textPages = 0
  for (const [index, part] of order.slice(0, maxSlides).entries()) {
    const xml = (await readPart(zip, part)) ?? ''
    const paragraphs = xml.split(/<\/a:p>/).map((paragraph) => [...paragraph.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((match) => decodeEntities(match[1])).join('')).filter((text) => text.trim())
    const text = paragraphs.join('\n')
    if (letters(text) > 0) textPages += 1
    result.push({ page: index + 1, label: null, text })
  }
  return { sections: result, meta: coreMeta(await readPart(zip, 'docProps/core.xml')), links: [], pages: order.length, textPages, truncated: order.length > maxSlides }
}

// ── Web pages ──────────────────────────────────────────────────────────────

function extractHtml(bytes) {
  const page = parseHtml(decodeHtml(bytes))
  const result = plain(page.text)
  const meta = []
  const title = page.title || page.meta['dc.title'] || page.headings.find((heading) => heading.level === 1)?.text
  if (title) meta.push({ field: 'title', value: title.slice(0, 300), source: page.title || page.meta['dc.title'] ? 'original' : 'extracted' })
  const author = page.meta.author || page.meta['dc.creator']
  if (author) meta.push({ field: 'author', value: author, source: 'original' })
  if (page.meta.keywords) meta.push({ field: 'keywords', value: page.meta.keywords, source: 'original' })
  if (page.meta.subject || page.meta.description) meta.push({ field: 'subject', value: page.meta.subject || page.meta.description, source: 'original' })
  result.meta = meta
  result.links = page.links
  return result
}
