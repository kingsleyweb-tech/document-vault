import type JSZip from 'jszip'
import { sanitizeHtml } from './documentViewer'

// Converters for the file types the browser cannot show by itself. Each is
// loaded only when such a file is opened, and every page they produce goes
// through sanitizeHtml and is shown in a sandboxed frame, like Word documents.

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (character) => `&#${character.charCodeAt(0)};`)

const PAGE_STYLE = `<style>
  body { font: 15px/1.6 Georgia, 'Times New Roman', serif; color: #2a2119; background: #fff; max-width: 820px; margin: 0 auto; padding: 32px 40px; }
  h1, h2, h3, h4, h5, h6 { font-family: 'Segoe UI', system-ui, sans-serif; line-height: 1.3; }
  table { border-collapse: collapse; margin: 12px 0; }
  td, th { border: 1px solid #d9d0c4; padding: 4px 8px; vertical-align: top; }
  img { max-width: 100%; height: auto; }
  .slide { border: 1px solid #e3dbcf; border-radius: 8px; padding: 16px 24px; margin: 0 0 20px; }
  .slide > h2 { margin-top: 0; font-size: 13px; color: #8a7a68; text-transform: uppercase; letter-spacing: 0.04em; }
  .note { font: 13px/1.5 'Segoe UI', system-ui, sans-serif; color: #6b5d4f; background: #faf6f0; border: 1px solid #eadfce; border-radius: 6px; padding: 8px 12px; }
</style>`

function page(title: string, body: string) {
  return sanitizeHtml(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>${PAGE_STYLE}</head><body>${body}</body></html>`)
}

// ── Older Word and RTF documents (text read by the companion) ─────────────

export function textDocumentHtml(title: string, sections: { text: string }[], truncated: boolean) {
  const paragraphs = sections
    .map((section) => section.text)
    .join('\n')
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('')
  const note = `<p class="note">Shown as text: pictures and page layout appear when the file is opened in Word.${truncated ? ' Only the first part of this document is shown.' : ''}</p>`
  return page(title, note + (paragraphs || '<p><em>This document has no text.</em></p>'))
}

// ── OpenDocument text (.odt) and presentations (.odp) ──────────────────────

const PICTURE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }
const MAX_PICTURE_BYTES = 8 * 1024 * 1024

interface TextStyle {
  bold?: boolean
  italic?: boolean
  underline?: boolean
}

function readStyles(doc: Document, styles: Map<string, TextStyle>) {
  for (const style of Array.from(doc.getElementsByTagName('style:style'))) {
    const name = style.getAttribute('style:name')
    const properties = style.getElementsByTagName('style:text-properties')[0]
    if (!name || !properties) continue
    styles.set(name, {
      bold: properties.getAttribute('fo:font-weight') === 'bold',
      italic: properties.getAttribute('fo:font-style') === 'italic',
      underline: (properties.getAttribute('style:text-underline-style') ?? 'none') !== 'none',
    })
  }
}

function styled(html: string, style: TextStyle | undefined) {
  if (!style || !html) return html
  let result = html
  if (style.bold) result = `<strong>${result}</strong>`
  if (style.italic) result = `<em>${result}</em>`
  if (style.underline) result = `<u>${result}</u>`
  return result
}

export async function renderOpenDocument(blob: Blob, title: string) {
  const { default: JSZipClass } = await import('jszip')
  const zip: JSZip = await JSZipClass.loadAsync(blob)
  const parser = new DOMParser()
  const read = async (name: string) => {
    const text = await zip.file(name)?.async('text')
    return text ? parser.parseFromString(text, 'application/xml') : null
  }
  const content = await read('content.xml')
  if (!content || content.getElementsByTagName('parsererror').length > 0) throw new Error('This file has no readable content.')
  const styles = new Map<string, TextStyle>()
  const stylesDoc = await read('styles.xml')
  if (stylesDoc) readStyles(stylesDoc, styles)
  readStyles(content, styles)

  const pictures = new Map<string, string>()
  const picture = async (href: string) => {
    if (pictures.has(href)) return pictures.get(href) as string
    const type = PICTURE_TYPES[href.split('.').pop()?.toLowerCase() ?? '']
    const file = zip.file(href.replace(/^\.\//, ''))
    let url = ''
    if (type && file) {
      const bytes = await file.async('base64')
      if (bytes.length * 0.75 <= MAX_PICTURE_BYTES) url = `data:${type};base64,${bytes}`
    }
    pictures.set(href, url)
    return url
  }

  let slide = 0
  const walk = async (node: Node): Promise<string> => {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.nodeValue ?? '')
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const element = node as Element
    const inner = async () => {
      let html = ''
      for (const child of Array.from(element.childNodes)) html += await walk(child)
      return html
    }
    const style = styles.get(element.getAttribute('text:style-name') ?? '')
    switch (element.nodeName) {
      case 'text:h': {
        const level = Math.min(6, Math.max(1, Number(element.getAttribute('text:outline-level')) || 1))
        return `<h${level}>${await inner()}</h${level}>`
      }
      case 'text:p':
        return `<p>${styled(await inner(), style) || '&nbsp;'}</p>`
      case 'text:span':
        return styled(await inner(), style)
      case 'text:a': {
        const href = element.getAttribute('xlink:href') ?? ''
        return /^(https?:|mailto:)/i.test(href) ? `<a href="${escapeHtml(href)}">${await inner()}</a>` : await inner()
      }
      case 'text:list':
        return `<ul>${await inner()}</ul>`
      case 'text:list-item':
        return `<li>${await inner()}</li>`
      case 'text:tab':
        return '&emsp;'
      case 'text:s':
        return '&nbsp;'.repeat(Math.min(50, Number(element.getAttribute('text:c')) || 1))
      case 'text:line-break':
        return '<br>'
      case 'table:table':
        return `<table>${await inner()}</table>`
      case 'table:table-row':
        return `<tr>${await inner()}</tr>`
      case 'table:table-cell':
        return `<td>${await inner()}</td>`
      case 'draw:page':
        slide += 1
        return `<section class="slide"><h2>Slide ${slide}</h2>${await inner()}</section>`
      case 'draw:image': {
        const url = await picture(element.getAttribute('xlink:href') ?? '')
        return url ? `<img src="${url}" alt="">` : ''
      }
      // Notes, annotations, tracked deletions and the style and form sections are not part of the text shown.
      case 'presentation:notes':
      case 'office:annotation':
      case 'text:tracked-changes':
      case 'office:automatic-styles':
      case 'office:font-face-decls':
      case 'office:forms':
      case 'table:table-columns':
      case 'table:table-column':
        return ''
      default:
        return inner()
    }
  }

  const body = content.getElementsByTagName('office:body')[0]
  if (!body) throw new Error('This file has no readable content.')
  return page(title, await walk(body))
}

// ── Saved web pages (.mht, .mhtml) ─────────────────────────────────────────

interface MimePart {
  headers: Map<string, string>
  body: string
}

/** Bytes as a string with one character per byte, so binary parts survive splitting. */
async function binaryString(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let text = ''
  for (let start = 0; start < bytes.length; start += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  }
  return text
}

function parsePart(raw: string): MimePart {
  const split = raw.search(/\r?\n\r?\n/)
  const head = split === -1 ? raw : raw.slice(0, split)
  const body = split === -1 ? '' : raw.slice(split).replace(/^\r?\n\r?\n/, '')
  const headers = new Map<string, string>()
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
  }
  return { headers, body }
}

function parameter(header: string, name: string) {
  return new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, 'i').exec(header)?.slice(1).find(Boolean) ?? null
}

function decodeBody(part: MimePart) {
  const encoding = (part.headers.get('content-transfer-encoding') ?? '').toLowerCase()
  if (encoding === 'base64') {
    try {
      return atob(part.body.replace(/\s+/g, ''))
    } catch {
      return ''
    }
  }
  if (encoding === 'quoted-printable') {
    return part.body.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
  }
  return part.body
}

function textOf(binary: string, charset: string | null) {
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(bytes)
  } catch {
    return new TextDecoder().decode(bytes)
  }
}

export async function renderMht(blob: Blob) {
  const message = parsePart(await binaryString(blob))
  const type = message.headers.get('content-type') ?? 'text/html'
  const boundary = parameter(type, 'boundary')
  const parts = boundary
    ? message.body
        .split(`--${boundary}`)
        .slice(1)
        .filter((raw) => !raw.startsWith('--'))
        .map((raw) => parsePart(raw.replace(/^\r?\n/, '')))
    : [message]
  const root = parts.find((part) => (part.headers.get('content-type') ?? '').toLowerCase().startsWith('text/html'))
  if (!root) throw new Error('This saved page has no page in it.')
  const rootType = root.headers.get('content-type') ?? ''
  const html = textOf(decodeBody(root), parameter(rootType, 'charset'))
  const base = root.headers.get('content-location') ?? null

  // Pictures and style sheets saved with the page, by their address and content id.
  const resources = new Map<string, { type: string; data: string }>()
  for (const part of parts) {
    if (part === root) continue
    const partType = (part.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    const location = part.headers.get('content-location')
    const id = part.headers.get('content-id')?.replace(/^<|>$/g, '')
    const data = decodeBody(part)
    const resource = { type: partType, data }
    if (location) resources.set(location, resource)
    if (id) resources.set(`cid:${id}`, resource)
  }
  const resolve = (href: string, from: string | null) => {
    if (resources.has(href)) return resources.get(href)
    try {
      return resources.get(new URL(href, from ?? undefined).href)
    } catch {
      return undefined
    }
  }
  const asDataUrl = (resource: { type: string; data: string }) =>
    /^image\/(png|jpe?g|gif|webp|bmp)$/.test(resource.type) ? `data:${resource.type};base64,${btoa(resource.data)}` : null
  const inlineCss = (css: string, from: string | null) =>
    css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (_whole: string, _quote: string, href: string) => {
      const resource = resolve(href.trim(), from)
      const url = resource ? asDataUrl(resource) : null
      return url ? `url("${url}")` : 'none'
    })

  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const style of Array.from(doc.querySelectorAll('style'))) style.textContent = inlineCss(style.textContent ?? '', base)
  // Saved style sheets become inline styles; links to anything else are dropped by the sanitiser.
  for (const link of Array.from(doc.querySelectorAll('link[rel~="stylesheet" i][href]'))) {
    const href = link.getAttribute('href') ?? ''
    const resource = resolve(href, base)
    if (resource && resource.type === 'text/css') {
      const style = doc.createElement('style')
      let from: string | null = href
      try {
        from = new URL(href, base ?? undefined).href
      } catch {
        // Keep the address as written.
      }
      style.textContent = inlineCss(textOf(resource.data, 'utf-8'), from)
      link.replaceWith(style)
    }
  }
  for (const element of Array.from(doc.querySelectorAll('[src], [background]'))) {
    for (const name of ['src', 'background']) {
      const href = element.getAttribute(name)
      if (!href) continue
      const resource = resolve(href, base)
      const url = resource ? asDataUrl(resource) : null
      if (url) element.setAttribute(name, url)
      else element.removeAttribute(name)
    }
  }
  // Links within the saved page keep working; addresses are made absolute for "open online".
  for (const anchor of Array.from(doc.querySelectorAll('a[href]'))) {
    const href = anchor.getAttribute('href') ?? ''
    if (href.startsWith('#') || !base) continue
    try {
      anchor.setAttribute('href', new URL(href, base).href)
    } catch {
      // Leave it as it is.
    }
  }
  return sanitizeHtml(`<!doctype html>${doc.documentElement.outerHTML}`)
}

// ── TIFF pictures, often multi-page scans ──────────────────────────────────

/** Pages wider than this are drawn smaller, so a 600 dpi scan does not hold hundreds of megabytes. */
const MAX_TIFF_WIDTH = 2400

export interface TiffDocument {
  pages: number
  /** Draws one page as a picture; the caller revokes the URL. */
  render: (index: number) => Promise<string>
}

export async function openTiff(blob: Blob): Promise<TiffDocument> {
  const { default: UTIF } = await import('utif')
  const buffer = await blob.arrayBuffer()
  const pages = UTIF.decode(buffer).filter((ifd) => ifd.t256 && ifd.t257)
  if (pages.length === 0) throw new Error('This TIFF picture has no pages.')
  return {
    pages: pages.length,
    async render(index) {
      const ifd = pages[index]
      UTIF.decodeImage(buffer, ifd)
      const width = ifd.width as number
      const height = ifd.height as number
      const rgba = UTIF.toRGBA8(ifd)
      const pixels = new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.length)
      // The decoded pixels are kept on the page record by the decoder; release them.
      delete ifd.data
      const full = document.createElement('canvas')
      full.width = width
      full.height = height
      full.getContext('2d')?.putImageData(new ImageData(pixels, width, height), 0, 0)
      let canvas = full
      if (width > MAX_TIFF_WIDTH) {
        canvas = document.createElement('canvas')
        canvas.width = MAX_TIFF_WIDTH
        canvas.height = Math.round((height * MAX_TIFF_WIDTH) / width)
        canvas.getContext('2d')?.drawImage(full, 0, 0, canvas.width, canvas.height)
        full.width = 0
        full.height = 0
      }
      const picture = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      canvas.width = 0
      canvas.height = 0
      if (!picture) throw new Error('This page could not be drawn.')
      return URL.createObjectURL(picture)
    },
  }
}
