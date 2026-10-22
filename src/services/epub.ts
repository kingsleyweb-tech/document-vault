import type JSZip from 'jszip'
import { sanitizeHtml } from './documentViewer'

// Reads EPUB books (EPUB 2 and 3) in the browser. A book is a zip of XHTML
// chapters listed in a package file. Chapters are shown one at a time in a
// sandboxed frame: scripts and forms are removed, stylesheets are inlined and
// pictures are turned into data URLs, so nothing is fetched from anywhere.

export interface EpubChapter {
  /** Path inside the zip. */
  path: string
  title: string
}

export interface EpubTocEntry {
  title: string
  /** Index into `chapters`. */
  chapterIndex: number
  fragment?: string
  depth: number
}

export interface EpubBook {
  title: string
  author: string
  chapters: EpubChapter[]
  toc: EpubTocEntry[]
  /** Builds the sanitised HTML of one chapter. */
  renderChapter: (index: number) => Promise<string>
}

interface ManifestItem {
  id: string
  path: string
  mediaType: string
  properties: string
}

const RASTER_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
}

const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024

export class EpubError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EpubError'
  }
}

export async function openEpub(blob: Blob): Promise<EpubBook> {
  const { default: JSZipClass } = await import('jszip')
  const zip = await JSZipClass.loadAsync(blob)

  const container = await readXml(zip, 'META-INF/container.xml')
  const opfPath = container?.querySelector('rootfile')?.getAttribute('full-path')
  if (!opfPath) throw new EpubError('This book has no package file, so it cannot be opened here.')
  const opf = await readXml(zip, opfPath)
  if (!opf) throw new EpubError('This book’s package file is missing or damaged.')

  const manifest = new Map<string, ManifestItem>()
  for (const item of byLocalName(opf, 'item')) {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    if (!id || !href) continue
    manifest.set(id, {
      id,
      path: resolvePath(opfPath, href),
      mediaType: item.getAttribute('media-type') ?? '',
      properties: item.getAttribute('properties') ?? '',
    })
  }

  const spine = byLocalName(opf, 'spine')[0]
  const chapters: EpubChapter[] = []
  for (const itemref of byLocalName(opf, 'itemref')) {
    const item = manifest.get(itemref.getAttribute('idref') ?? '')
    if (!item || !/html|xml/.test(item.mediaType) || !zip.file(item.path)) continue
    chapters.push({ path: item.path, title: '' })
  }
  if (chapters.length === 0) throw new EpubError('This book has no readable chapters.')

  const title = textOf(byLocalName(opf, 'title')[0]) || 'Untitled book'
  const author = textOf(byLocalName(opf, 'creator')[0])

  const chapterIndex = new Map(chapters.map((chapter, index) => [chapter.path, index]))
  const navItem = Array.from(manifest.values()).find((item) => item.properties.split(/\s+/).includes('nav'))
  const ncxItem = manifest.get(spine?.getAttribute('toc') ?? '') ?? Array.from(manifest.values()).find((item) => item.mediaType === 'application/x-dtbncx+xml')
  let toc = navItem ? await readNavToc(zip, navItem.path, chapterIndex) : []
  if (toc.length === 0 && ncxItem) toc = await readNcxToc(zip, ncxItem.path, chapterIndex)

  for (const entry of toc) {
    if (!entry.fragment && !chapters[entry.chapterIndex].title) chapters[entry.chapterIndex].title = entry.title
  }
  chapters.forEach((chapter, index) => {
    if (!chapter.title) chapter.title = `Section ${index + 1}`
  })

  return {
    title,
    author,
    chapters,
    toc,
    renderChapter: (index) => renderChapter(zip, chapters[index].path),
  }
}

async function readXml(zip: JSZip, path: string) {
  const file = zip.file(path)
  if (!file) return null
  const text = await file.async('text')
  const parsed = new DOMParser().parseFromString(text, 'application/xml')
  if (parsed.getElementsByTagName('parsererror').length > 0) {
    // Some books ship XHTML that is not well-formed; the HTML parser copes.
    return new DOMParser().parseFromString(text, 'text/html')
  }
  return parsed
}

/** Elements by local name, whatever their namespace or prefix (dc:title, opf:item …). */
function byLocalName(root: Document | Element | null | undefined, name: string): Element[] {
  if (!root) return []
  return Array.from(root.getElementsByTagName('*')).filter((element) => element.localName === name || element.localName.endsWith(`:${name}`))
}

function textOf(node: Element | undefined | null) {
  return (node?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** Resolves `href` relative to the file at `fromPath`, both inside the zip. */
export function resolvePath(fromPath: string, href: string) {
  const [target] = href.split('#')
  let decoded = target
  try {
    decoded = decodeURIComponent(target)
  } catch {
    // Keep the raw path.
  }
  if (decoded.startsWith('/')) decoded = decoded.slice(1)
  const parts = fromPath.split('/').slice(0, -1)
  for (const part of decoded.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return parts.join('/')
}

function fragmentOf(href: string) {
  const index = href.indexOf('#')
  return index >= 0 ? href.slice(index + 1) || undefined : undefined
}

async function readNavToc(zip: JSZip, navPath: string, chapterIndex: Map<string, number>) {
  const nav = await readXml(zip, navPath)
  if (!nav) return []
  const navs = byLocalName(nav, 'nav')
  const tocNav = navs.find((element) => /\btoc\b/.test(element.getAttribute('epub:type') ?? element.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ?? '')) ?? navs[0]
  if (!tocNav) return []
  const entries: EpubTocEntry[] = []
  for (const anchor of byLocalName(tocNav, 'a')) {
    const href = anchor.getAttribute('href')
    if (!href) continue
    const index = chapterIndex.get(resolvePath(navPath, href))
    if (index === undefined) continue
    let depth = 0
    for (let parent = anchor.parentElement; parent && parent !== tocNav; parent = parent.parentElement) {
      if (parent.localName === 'ol' || parent.localName === 'ul') depth += 1
    }
    entries.push({ title: textOf(anchor) || `Section ${index + 1}`, chapterIndex: index, fragment: fragmentOf(href), depth: Math.max(0, depth - 1) })
  }
  return entries
}

async function readNcxToc(zip: JSZip, ncxPath: string, chapterIndex: Map<string, number>) {
  const ncx = await readXml(zip, ncxPath)
  if (!ncx) return []
  const entries: EpubTocEntry[] = []
  const visit = (parent: Element, depth: number) => {
    for (const point of Array.from(parent.children).filter((child) => child.localName === 'navPoint')) {
      const label = textOf(byLocalName(point, 'text')[0])
      const src = byLocalName(point, 'content')[0]?.getAttribute('src')
      const index = src ? chapterIndex.get(resolvePath(ncxPath, src)) : undefined
      if (src && index !== undefined) entries.push({ title: label || `Section ${index + 1}`, chapterIndex: index, fragment: fragmentOf(src), depth })
      visit(point, depth + 1)
    }
  }
  const navMap = byLocalName(ncx, 'navMap')[0]
  if (navMap) visit(navMap, 0)
  return entries
}

async function renderChapter(zip: JSZip, chapterPath: string) {
  const file = zip.file(chapterPath)
  if (!file) throw new EpubError('This chapter is missing from the book.')
  const source = await file.async('text')
  let doc = new DOMParser().parseFromString(source, 'application/xhtml+xml')
  if (doc.getElementsByTagName('parsererror').length > 0) doc = new DOMParser().parseFromString(source, 'text/html')

  // Linked stylesheets become inline styles, without imports or outside URLs.
  const styles: string[] = []
  for (const link of byLocalName(doc, 'link')) {
    const rel = (link.getAttribute('rel') ?? '').toLowerCase()
    const href = link.getAttribute('href')
    if (!rel.includes('stylesheet') || !href) continue
    const css = await zip.file(resolvePath(chapterPath, href))?.async('text')
    if (css) styles.push(cleanCss(css))
  }
  byLocalName(doc, 'link').forEach((link) => link.remove())
  for (const style of byLocalName(doc, 'style')) {
    style.textContent = cleanCss(style.textContent ?? '')
  }

  // Pictures are embedded, since the frame may not load anything itself.
  const imageAttributes: Array<[Element, string]> = []
  for (const image of byLocalName(doc, 'img')) imageAttributes.push([image, 'src'])
  for (const image of byLocalName(doc, 'image')) {
    imageAttributes.push([image, image.hasAttribute('href') ? 'href' : 'xlink:href'])
  }
  for (const [element, attribute] of imageAttributes) {
    const value = element.getAttribute(attribute) ?? (attribute === 'xlink:href' ? element.getAttributeNS('http://www.w3.org/1999/xlink', 'href') : null)
    if (!value || /^data:/i.test(value)) continue
    const dataUrl = await imageDataUrl(zip, resolvePath(chapterPath, value))
    if (dataUrl) {
      element.removeAttribute('xlink:href')
      element.removeAttributeNS('http://www.w3.org/1999/xlink', 'href')
      element.setAttribute(attribute === 'src' ? 'src' : 'href', dataUrl)
    } else {
      element.removeAttribute(attribute)
    }
  }

  const head = doc.getElementsByTagName('head')[0]?.innerHTML ?? ''
  const body = doc.getElementsByTagName('body')[0]?.innerHTML ?? doc.documentElement.innerHTML
  const styleTags = [BOOK_STYLE, ...styles].map((css) => `<style>${css.replace(/<\/style/gi, '')}</style>`).join('')
  return sanitizeHtml(`<!doctype html><html><head>${styleTags}${head}</head><body>${body}</body></html>`)
}

async function imageDataUrl(zip: JSZip, path: string) {
  const file = zip.file(path)
  const type = RASTER_TYPES[path.split('.').pop()?.toLowerCase() ?? '']
  if (!file || !type) return null
  const data = await file.async('base64')
  if (data.length * 0.75 > MAX_INLINE_IMAGE_BYTES) return null
  return `data:${type};base64,${data}`
}

/** Drops @import rules and url() references, which the frame could not load anyway. */
export function cleanCss(css: string) {
  return css.replace(/@import[^;]*;/gi, '').replace(/url\(\s*(['"]?)(?!data:image\/(?:png|jpe?g|gif|webp))[^)]*\1\s*\)/gi, 'none')
}

const BOOK_STYLE = `
  html { color-scheme: light; }
  body { max-width: 42em; margin: 0 auto; padding: 2em 1.5em 4em; font-family: Georgia, 'Times New Roman', serif; font-size: 1.1em; line-height: 1.65; color: #2a2119; background: #fffdf9; overflow-wrap: break-word; }
  img, svg, image { max-width: 100%; height: auto; }
  pre { white-space: pre-wrap; }
  a { color: #7a5537; }
`
