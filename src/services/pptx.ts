/**
 * On-demand PowerPoint (.pptx) reader.
 *
 * Slide order comes from ppt/presentation.xml (<p:sldIdLst>), never from the
 * slideN.xml file names. PowerPoint keeps the original file names when slides
 * are reordered or merged from other decks, so in large decks "slide1.xml" can
 * be the 600th slide. Sorting by file name was the cause of presentations
 * opening on the wrong slide.
 *
 * Only the archive directory and presentation.xml are read on open. Each slide
 * is parsed when it is first displayed, and media is turned into object URLs
 * lazily, so a 1,000-slide deck does not decode every image up front.
 */
import type JSZipType from 'jszip'
import { readAnimationSteps, readTransition, type AnimationStep, type SlideTransition } from './pptxAnimation'

const EMU_PER_PX = 9525
const DEFAULT_SLIDE_WIDTH = 12192000
const DEFAULT_SLIDE_HEIGHT = 6858000
const SLIDE_CACHE_MAX = 80
const MEDIA_URL_CACHE_MAX = 240

export interface PptxSlideRef {
  /** 1-based position in the presentation, as shown in PowerPoint. */
  number: number
  path: string
}

export interface TextRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  sizePt?: number
  color?: string
}

export interface TextParagraph {
  runs: TextRun[]
  align?: 'left' | 'center' | 'right' | 'justify'
  bullet: boolean
  level: number
}

interface Box {
  x: number
  y: number
  w: number
  h: number
  rotation: number
}

/** Shape ids used to match animation targets: the shape's own id and those of enclosing groups. */
interface Identity {
  id?: string
  groupIds?: string[]
}

/** Outline of a box: an oval, or a rectangle with rounded corners. Plain rectangles leave it unset. */
export type Corners = 'ellipse' | 'round'

export type SlideElement = Identity &
  ((Box & { type: 'text'; paragraphs: TextParagraph[]; fill?: string; border?: string; corners?: Corners; isTitle: boolean; anchor: 'top' | 'middle' | 'bottom' })
  | (Box & { type: 'image'; mediaPath: string })
  | (Box & { type: 'table'; rows: string[][] })
  | (Box & { type: 'shape'; fill?: string; border?: string; corners?: Corners })
  | (Box & { type: 'unsupported'; label: string }))

export interface SlideModel {
  number: number
  hidden: boolean
  title: string
  text: string[]
  background?: string
  backgroundImage?: string
  elements: SlideElement[]
  transition?: SlideTransition
  /** Click-by-click animation steps, in the order the slideshow plays them. */
  animationSteps: AnimationStep[]
}

export interface PptxDocument {
  slides: PptxSlideRef[]
  /** Slide size in CSS pixels at 96 dpi. */
  width: number
  height: number
  loadSlide(index: number): Promise<SlideModel>
  loadSlideText(index: number): Promise<string[]>
  getMediaUrl(mediaPath: string): Promise<string | null>
  dispose(): void
}

type Zip = JSZipType

const BROWSER_IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

export async function openPptx(data: ArrayBuffer | Blob): Promise<PptxDocument> {
  const jszipModule = await import('jszip')
  const JSZip = (jszipModule as unknown as { default?: typeof JSZipType }).default ?? (jszipModule as unknown as typeof JSZipType)
  const zip = await JSZip.loadAsync(data instanceof Blob ? await data.arrayBuffer() : data)
  return createPptxDocument(zip)
}

export async function createPptxDocument(zip: Zip): Promise<PptxDocument> {
  const { slides, width, height } = await readPresentationStructure(zip)
  const slideCache = new Map<number, SlideModel>()
  const pending = new Map<number, Promise<SlideModel>>()
  const mediaUrls = new Map<string, string>()
  const themeCache = new Map<string, Promise<Record<string, string>>>()
  const placeholderCache = new Map<string, Promise<PartInfo>>()
  let disposed = false

  const context: ParseContext = {
    zip,
    async getPart(path) {
      let entry = placeholderCache.get(path)
      if (!entry) {
        entry = readPartInfo(zip, path, context)
        placeholderCache.set(path, entry)
      }
      return entry
    },
    async getTheme(path) {
      let entry = themeCache.get(path)
      if (!entry) {
        entry = readThemeColors(zip, path)
        themeCache.set(path, entry)
      }
      return entry
    },
  }

  async function loadSlide(index: number) {
    const ref = slides[index]
    if (!ref) throw new RangeError(`Slide ${index + 1} does not exist.`)
    const cached = slideCache.get(index)
    if (cached) {
      slideCache.delete(index)
      slideCache.set(index, cached)
      return cached
    }
    let task = pending.get(index)
    if (!task) {
      task = parseSlide(context, ref).finally(() => pending.delete(index))
      pending.set(index, task)
    }
    const model = await task
    slideCache.set(index, model)
    if (slideCache.size > SLIDE_CACHE_MAX) {
      const oldest = slideCache.keys().next().value
      if (oldest !== undefined) slideCache.delete(oldest)
    }
    return model
  }

  async function loadSlideText(index: number) {
    const cached = slideCache.get(index)
    if (cached) return cached.text
    const ref = slides[index]
    if (!ref) return []
    const xml = await zip.file(ref.path)?.async('text')
    return xml ? extractTextFromXml(xml) : []
  }

  async function getMediaUrl(mediaPath: string) {
    if (disposed) return null
    const existing = mediaUrls.get(mediaPath)
    if (existing) {
      mediaUrls.delete(mediaPath)
      mediaUrls.set(mediaPath, existing)
      return existing
    }
    const mime = BROWSER_IMAGE_TYPES[extensionOf(mediaPath)]
    const file = zip.file(mediaPath)
    if (!mime || !file) return null
    const bytes = await file.async('uint8array')
    if (disposed) return null
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
    mediaUrls.set(mediaPath, url)
    if (mediaUrls.size > MEDIA_URL_CACHE_MAX) {
      const [oldestPath, oldestUrl] = mediaUrls.entries().next().value as [string, string]
      mediaUrls.delete(oldestPath)
      URL.revokeObjectURL(oldestUrl)
    }
    return url
  }

  return {
    slides,
    width,
    height,
    loadSlide,
    loadSlideText,
    getMediaUrl,
    dispose() {
      disposed = true
      mediaUrls.forEach((url) => URL.revokeObjectURL(url))
      mediaUrls.clear()
      slideCache.clear()
    },
  }
}

/**
 * The first slides of a deck as plain data, kept on the device so they can be
 * shown before the presentation file itself is available.
 */
export interface PptxSnapshot {
  width: number
  height: number
  slides: PptxSlideRef[]
  models: SlideModel[]
}

export const SNAPSHOT_SLIDES = 3
const SNAPSHOT_MEDIA_BUDGET = 4 * 1024 * 1024

/** Reads the first slides and the pictures they use, up to a size budget. */
export async function snapshotPptx(doc: PptxDocument, count = SNAPSHOT_SLIDES): Promise<{ snapshot: PptxSnapshot; media: Record<string, Blob> }> {
  const models: SlideModel[] = []
  for (let index = 0; index < Math.min(count, doc.slides.length); index += 1) models.push(await doc.loadSlide(index))
  const media: Record<string, Blob> = {}
  let mediaBytes = 0
  for (const model of models) {
    const paths = model.elements.flatMap((element) => (element.type === 'image' ? [element.mediaPath] : []))
    if (model.backgroundImage) paths.unshift(model.backgroundImage)
    for (const path of paths) {
      if (media[path]) continue
      const url = await doc.getMediaUrl(path)
      if (!url) continue
      const blob = await (await fetch(url)).blob()
      // Pictures past the budget are left out; the slide shows without them until the file loads.
      if (mediaBytes + blob.size > SNAPSHOT_MEDIA_BUDGET) continue
      media[path] = blob
      mediaBytes += blob.size
    }
  }
  return { snapshot: { width: doc.width, height: doc.height, slides: doc.slides, models }, media }
}

/**
 * A stand-in presentation built from a snapshot. Slides it does not hold stay
 * loading until the real file replaces it.
 */
export function pptxFromSnapshot(snapshot: PptxSnapshot, media: Record<string, Blob>): PptxDocument {
  const urls = new Map<string, string>()
  const waiting = new Promise<never>(() => undefined)
  return {
    slides: snapshot.slides,
    width: snapshot.width,
    height: snapshot.height,
    loadSlide: (index) => (snapshot.models[index] ? Promise.resolve(snapshot.models[index]) : waiting),
    loadSlideText: async (index) => snapshot.models[index]?.text ?? [],
    async getMediaUrl(path) {
      const blob = media[path]
      // Left out of the snapshot for size: it appears once the file has loaded.
      if (!blob) return waiting
      let url = urls.get(path)
      if (!url) {
        url = URL.createObjectURL(blob)
        urls.set(path, url)
      }
      return url
    },
    dispose() {
      urls.forEach((url) => URL.revokeObjectURL(url))
      urls.clear()
    },
  }
}

/** Plain text of every slide, in presentation order. Used for search indexing. */
export async function extractPptxText(data: ArrayBuffer | Blob): Promise<string[]> {
  const doc = await openPptx(data)
  try {
    const result: string[] = []
    for (let index = 0; index < doc.slides.length; index += 1) {
      result.push((await doc.loadSlideText(index)).join(' '))
    }
    return result
  } finally {
    doc.dispose()
  }
}

// ─── Presentation structure ──────────────────────────────────────────────────

export async function readPresentationStructure(zip: Zip) {
  const presentationXml = await zip.file('ppt/presentation.xml')?.async('text')
  const relsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('text')
  let width = DEFAULT_SLIDE_WIDTH
  let height = DEFAULT_SLIDE_HEIGHT
  const ordered: string[] = []

  if (presentationXml) {
    const doc = parseXml(presentationXml)
    const size = firstByLocalName(doc, 'sldSz')
    if (size) {
      width = Number(size.getAttribute('cx')) || DEFAULT_SLIDE_WIDTH
      height = Number(size.getAttribute('cy')) || DEFAULT_SLIDE_HEIGHT
    }

    const rels = relsXml ? parseRelationships(relsXml, 'ppt/presentation.xml') : new Map<string, Relationship>()
    for (const relId of readSlideRelationshipIds(presentationXml)) {
      const target = rels.get(relId)?.target
      if (target && zip.file(target)) ordered.push(target)
    }
  }

  // Archives without a usable slide list (rare, usually hand-built files) fall
  // back to file-name order so they still open.
  if (ordered.length === 0) {
    Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((first, second) => slideFileNumber(first) - slideFileNumber(second))
      .forEach((name) => ordered.push(name))
  }

  return {
    slides: ordered.map((path, index) => ({ number: index + 1, path })),
    width: Math.round(width / EMU_PER_PX),
    height: Math.round(height / EMU_PER_PX),
  }
}

/**
 * Relationship ids from <p:sldIdLst>, in presentation order. Each <p:sldId>
 * carries both a plain `id` and a namespaced `r:id`; read with a pattern
 * because some DOM implementations collapse attributes that share a local name.
 */
function readSlideRelationshipIds(presentationXml: string) {
  const list = presentationXml.match(/<(?:\w+:)?sldIdLst\b[^>]*>([\s\S]*?)<\/(?:\w+:)?sldIdLst>/)
  if (!list) return []
  const ids: string[] = []
  for (const match of list[1].matchAll(/<(?:\w+:)?sldId\b([^>]*)>/g)) {
    const relId = match[1].match(/\b\w+:id\s*=\s*["']([^"']+)["']/)
    if (relId) ids.push(relId[1])
  }
  return ids
}

// ─── Slide parsing ───────────────────────────────────────────────────────────

interface Relationship {
  type: string
  target: string
  external: boolean
}

interface PlaceholderInfo {
  box?: Box
  sizePt?: number
}

interface PartInfo {
  rels: Map<string, Relationship>
  placeholders: Map<string, PlaceholderInfo>
  background?: string
  backgroundImage?: string
  themeColors: Record<string, string>
  parent?: PartInfo
}

interface ParseContext {
  zip: Zip
  getPart(path: string): Promise<PartInfo>
  getTheme(path: string): Promise<Record<string, string>>
}

async function readPartInfo(zip: Zip, path: string, context: ParseContext): Promise<PartInfo> {
  const xml = await zip.file(path)?.async('text')
  const rels = await readRels(zip, path)
  let parent: PartInfo | undefined
  let themeColors: Record<string, string> = {}
  // Inheritance only runs slide -> layout -> master. Masters also list their
  // layouts as relationships; following those would create a cycle.
  const parentType = path.includes('/slideMasters/') ? null : path.includes('/slideLayouts/') ? '/slideMaster' : '/slideLayout'

  for (const rel of rels.values()) {
    if (parentType && rel.type.endsWith(parentType)) {
      parent = await context.getPart(rel.target)
    } else if (rel.type.endsWith('/theme')) {
      themeColors = await context.getTheme(rel.target)
    }
  }
  if (parent && Object.keys(themeColors).length === 0) themeColors = parent.themeColors

  const info: PartInfo = { rels, placeholders: new Map(), themeColors, parent }
  if (!xml) return info

  const doc = parseXml(xml)
  const background = readBackground(doc, rels, themeColors)
  info.background = background.color ?? parent?.background
  info.backgroundImage = background.image ?? parent?.backgroundImage

  for (const shape of descendantsByLocalName(doc, 'sp')) {
    const key = placeholderKey(shape)
    if (!key) continue
    const box = readTransform(shape)
    const sizePt = readFirstRunSize(shape)
    for (const k of key) {
      if (!info.placeholders.has(k)) info.placeholders.set(k, { box, sizePt })
    }
  }
  return info
}

async function parseSlide(context: ParseContext, ref: PptxSlideRef): Promise<SlideModel> {
  const xml = await context.zip.file(ref.path)?.async('text')
  if (!xml) throw new Error(`Slide ${ref.number} is missing from the presentation file.`)
  const part = await context.getPart(ref.path)
  const doc = parseXml(xml)
  const root = doc.documentElement
  const elements: SlideElement[] = []
  const tree = firstByLocalName(doc, 'spTree')

  if (tree) {
    walkShapeTree(tree, identityTransform, part, elements, [])
  }

  const text = extractTextFromXml(xml)
  const titleElement = elements.find((element) => element.type === 'text' && element.isTitle)
  const title =
    titleElement && titleElement.type === 'text'
      ? titleElement.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join(' ').trim()
      : ''

  return {
    number: ref.number,
    hidden: root.getAttribute('show') === '0',
    title: title || text[0] || `Slide ${ref.number}`,
    text,
    background: part.background,
    backgroundImage: part.backgroundImage,
    elements,
    transition: readTransition(doc),
    animationSteps: readAnimationSteps(doc),
  }
}

type Transform = (box: Box) => Box
const identityTransform: Transform = (box) => box

function walkShapeTree(container: Element, transform: Transform, part: PartInfo, out: SlideElement[], groupIds: string[]) {
  for (const node of Array.from(container.children)) {
    const before = out.length
    const id = shapeId(node)
    switch (node.localName) {
      case 'sp':
        pushShape(node, transform, part, out)
        break
      case 'pic':
        pushPicture(node, transform, part, out)
        break
      case 'graphicFrame':
        pushGraphicFrame(node, transform, out)
        break
      case 'grpSp':
        walkShapeTree(node, groupTransform(node, transform), part, out, id ? [...groupIds, id] : groupIds)
        break
      case 'cxnSp': {
        const box = readTransform(node)
        if (box) out.push({ type: 'shape', ...transform(box), border: readLineColor(node, part.themeColors) ?? '#7a7a7a' })
        break
      }
      case 'AlternateContent': {
        const fallback = firstChildByLocalName(node, 'Fallback') ?? firstChildByLocalName(node, 'Choice')
        if (fallback) walkShapeTree(fallback, transform, part, out, groupIds)
        break
      }
      default:
        break
    }
    if (node.localName === 'grpSp' || node.localName === 'AlternateContent') continue
    for (let i = before; i < out.length; i += 1) {
      if (id) out[i].id = id
      if (groupIds.length) out[i].groupIds = groupIds
    }
  }
}

/** The cNvPr id inside a shape's non-visual properties (nvSpPr, nvPicPr, nvGrpSpPr, ...). */
function shapeId(node: Element) {
  const nonVisual = Array.from(node.children).find((element) => element.localName.startsWith('nv'))
  const props = nonVisual ? firstChildByLocalName(nonVisual, 'cNvPr') : null
  return props?.getAttribute('id') ?? undefined
}

function groupTransform(group: Element, parent: Transform): Transform {
  const spPr = firstChildByLocalName(group, 'grpSpPr')
  const xfrm = spPr ? firstChildByLocalName(spPr, 'xfrm') : null
  if (!xfrm) return parent
  const off = firstChildByLocalName(xfrm, 'off')
  const ext = firstChildByLocalName(xfrm, 'ext')
  const chOff = firstChildByLocalName(xfrm, 'chOff')
  const chExt = firstChildByLocalName(xfrm, 'chExt')
  if (!off || !ext || !chOff || !chExt) return parent
  const ox = num(off, 'x')
  const oy = num(off, 'y')
  const cx = num(chOff, 'x')
  const cy = num(chOff, 'y')
  const sx = num(chExt, 'cx') ? num(ext, 'cx') / num(chExt, 'cx') : 1
  const sy = num(chExt, 'cy') ? num(ext, 'cy') / num(chExt, 'cy') : 1
  return (box) =>
    parent({
      x: ox + (box.x - cx) * sx,
      y: oy + (box.y - cy) * sy,
      w: box.w * sx,
      h: box.h * sy,
      rotation: box.rotation,
    })
}

function pushShape(shape: Element, transform: Transform, part: PartInfo, out: SlideElement[]) {
  const keys = placeholderKey(shape)
  const inherited = keys ? findPlaceholder(part, keys) : undefined
  const ownBox = readTransform(shape)
  const box = ownBox ?? inherited?.box
  const phType = placeholderType(shape)
  const isTitle = phType === 'title' || phType === 'ctrTitle'
  const spPr = firstChildByLocalName(shape, 'spPr')
  const fill = spPr ? readSolidFill(spPr, part.themeColors) : undefined
  const border = readLineColor(shape, part.themeColors)
  const txBody = firstChildByLocalName(shape, 'txBody')
  const paragraphs = txBody ? readParagraphs(txBody, part.themeColors, inherited?.sizePt ?? (isTitle ? 36 : 18)) : []
  const hasText = paragraphs.some((p) => p.runs.some((r) => r.text.trim()))

  // Layout placeholders with no text of their own ("Click to add title") are
  // not drawn on the slide in PowerPoint either.
  if (!hasText && keys && !fill) return

  if (!box) {
    if (hasText) {
      out.push({ type: 'text', x: 0, y: 0, w: 0, h: 0, rotation: 0, paragraphs, isTitle, anchor: 'top' })
    }
    return
  }

  const placed = transform(box)
  const geometry = spPr ? firstChildByLocalName(spPr, 'prstGeom')?.getAttribute('prst') : null
  const corners: Corners | undefined = geometry === 'ellipse' ? 'ellipse' : geometry === 'roundRect' ? 'round' : undefined
  if (hasText) {
    const bodyPr = txBody ? firstChildByLocalName(txBody, 'bodyPr') : null
    const anchorAttr = bodyPr?.getAttribute('anchor')
    const anchor = anchorAttr === 'ctr' ? 'middle' : anchorAttr === 'b' ? 'bottom' : isTitle ? 'middle' : 'top'
    out.push({ type: 'text', ...placed, paragraphs, fill, border, corners, isTitle, anchor })
  } else if (fill || border) {
    out.push({ type: 'shape', ...placed, fill, border, corners })
  }
}

function pushPicture(picture: Element, transform: Transform, part: PartInfo, out: SlideElement[]) {
  const box = readTransform(picture)
  if (!box) return
  const blip = firstByLocalName(picture, 'blip')
  const relId = blip ? getRelationshipId(blip, 'embed') : null
  const target = relId ? part.rels.get(relId) : undefined
  if (!target || target.external) {
    out.push({ type: 'unsupported', ...transform(box), label: 'Linked picture' })
    return
  }
  if (!BROWSER_IMAGE_TYPES[extensionOf(target.target)]) {
    out.push({ type: 'unsupported', ...transform(box), label: `${extensionOf(target.target).toUpperCase() || 'Image'} picture` })
    return
  }
  out.push({ type: 'image', ...transform(box), mediaPath: target.target })
}

function pushGraphicFrame(frame: Element, transform: Transform, out: SlideElement[]) {
  const box = readTransform(frame, 'xfrm')
  if (!box) return
  const placed = transform(box)
  const table = firstByLocalName(frame, 'tbl')
  if (table) {
    const rows = childrenByLocalName(table, 'tr').map((row) =>
      childrenByLocalName(row, 'tc').map((cell) => extractTextFromElement(cell).join(' ')),
    )
    out.push({ type: 'table', ...placed, rows })
    return
  }
  const graphicData = firstByLocalName(frame, 'graphicData')
  const uri = graphicData?.getAttribute('uri') ?? ''
  const label = uri.includes('chart') ? 'Chart' : uri.includes('diagram') ? 'SmartArt diagram' : 'Embedded object'
  out.push({ type: 'unsupported', ...placed, label })
}

function readParagraphs(txBody: Element, theme: Record<string, string>, defaultSizePt: number): TextParagraph[] {
  return childrenByLocalName(txBody, 'p').map((paragraph) => {
    const pPr = firstChildByLocalName(paragraph, 'pPr')
    const algn = pPr?.getAttribute('algn')
    const level = Number(pPr?.getAttribute('lvl') ?? 0)
    const bullet = Boolean(pPr && (firstChildByLocalName(pPr, 'buChar') || firstChildByLocalName(pPr, 'buAutoNum')))
    const runs: TextRun[] = []
    for (const child of Array.from(paragraph.children)) {
      if (child.localName === 'br') {
        runs.push({ text: '\n' })
        continue
      }
      if (child.localName !== 'r' && child.localName !== 'fld') continue
      const text = firstChildByLocalName(child, 't')?.textContent ?? ''
      const rPr = firstChildByLocalName(child, 'rPr')
      const size = rPr?.getAttribute('sz')
      runs.push({
        text,
        bold: rPr?.getAttribute('b') === '1',
        italic: rPr?.getAttribute('i') === '1',
        underline: Boolean(rPr?.getAttribute('u') && rPr.getAttribute('u') !== 'none'),
        sizePt: size ? Number(size) / 100 : defaultSizePt,
        color: rPr ? readSolidFill(rPr, theme) : undefined,
      })
    }
    return {
      runs,
      align: algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : algn === 'l' ? 'left' : undefined,
      bullet,
      level: Number.isFinite(level) ? level : 0,
    }
  })
}

function readBackground(doc: Document, rels: Map<string, Relationship>, theme: Record<string, string>) {
  const bgPr = firstByLocalName(doc, 'bgPr')
  if (!bgPr) return {}
  const color = readSolidFill(bgPr, theme)
  const blip = firstByLocalName(bgPr, 'blip')
  const relId = blip ? getRelationshipId(blip, 'embed') : null
  const target = relId ? rels.get(relId) : undefined
  const image = target && !target.external && BROWSER_IMAGE_TYPES[extensionOf(target.target)] ? target.target : undefined
  return { color, image }
}

function readSolidFill(container: Element, theme: Record<string, string>) {
  const solid = firstChildByLocalName(container, 'solidFill')
  if (!solid) return undefined
  return readColor(solid, theme)
}

function readLineColor(shape: Element, theme: Record<string, string>) {
  const spPr = firstChildByLocalName(shape, 'spPr')
  const ln = spPr ? firstChildByLocalName(spPr, 'ln') : null
  if (!ln || firstChildByLocalName(ln, 'noFill')) return undefined
  return readSolidFill(ln, theme)
}

function readColor(fill: Element, theme: Record<string, string>) {
  const srgb = firstChildByLocalName(fill, 'srgbClr')
  if (srgb?.getAttribute('val')) return `#${srgb.getAttribute('val')}`
  const scheme = firstChildByLocalName(fill, 'schemeClr')?.getAttribute('val')
  if (scheme) {
    const alias: Record<string, string> = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' }
    return theme[alias[scheme] ?? scheme]
  }
  const sys = firstChildByLocalName(fill, 'sysClr')?.getAttribute('lastClr')
  return sys ? `#${sys}` : undefined
}

async function readThemeColors(zip: Zip, path: string) {
  const xml = await zip.file(path)?.async('text')
  const colors: Record<string, string> = {}
  if (!xml) return colors
  const scheme = firstByLocalName(parseXml(xml), 'clrScheme')
  if (!scheme) return colors
  for (const child of Array.from(scheme.children)) {
    const value = readColor(child, {})
    if (value) colors[child.localName] = value
  }
  return colors
}

function readTransform(node: Element, xfrmName = 'xfrm'): Box | undefined {
  const holder = node.localName === 'graphicFrame' ? node : firstChildByLocalName(node, 'spPr')
  const xfrm = holder ? firstChildByLocalName(holder, xfrmName) : null
  if (!xfrm) return undefined
  const off = firstChildByLocalName(xfrm, 'off')
  const ext = firstChildByLocalName(xfrm, 'ext')
  if (!off || !ext) return undefined
  return {
    x: num(off, 'x'),
    y: num(off, 'y'),
    w: num(ext, 'cx'),
    h: num(ext, 'cy'),
    rotation: Number(xfrm.getAttribute('rot') ?? 0) / 60000,
  }
}

function readFirstRunSize(shape: Element) {
  const rPr = firstByLocalName(shape, 'defRPr') ?? firstByLocalName(shape, 'rPr')
  const size = rPr?.getAttribute('sz')
  return size ? Number(size) / 100 : undefined
}

function placeholderType(shape: Element) {
  const ph = firstByLocalName(shape, 'ph')
  return ph ? ph.getAttribute('type') ?? 'body' : null
}

function placeholderKey(shape: Element): string[] | null {
  const nvSpPr = firstChildByLocalName(shape, 'nvSpPr')
  const nvPr = nvSpPr ? firstChildByLocalName(nvSpPr, 'nvPr') : null
  const ph = nvPr ? firstChildByLocalName(nvPr, 'ph') : null
  if (!ph) return null
  const type = ph.getAttribute('type') ?? 'body'
  const idx = ph.getAttribute('idx')
  const keys: string[] = []
  if (idx) keys.push(`idx:${idx}`)
  keys.push(`type:${type === 'ctrTitle' ? 'title' : type === 'subTitle' ? 'body' : type}`)
  return keys
}

function findPlaceholder(part: PartInfo, keys: string[]): PlaceholderInfo | undefined {
  let current = part.parent
  while (current) {
    for (const key of keys) {
      const found = current.placeholders.get(key)
      if (found?.box) return found
    }
    current = current.parent
  }
  return undefined
}

// ─── XML helpers ─────────────────────────────────────────────────────────────

async function readRels(zip: Zip, partPath: string) {
  const slash = partPath.lastIndexOf('/')
  const relsPath = `${partPath.slice(0, slash)}/_rels/${partPath.slice(slash + 1)}.rels`
  const xml = await zip.file(relsPath)?.async('text')
  return xml ? parseRelationships(xml, partPath) : new Map<string, Relationship>()
}

function parseRelationships(xml: string, partPath: string) {
  const map = new Map<string, Relationship>()
  const baseDir = partPath.slice(0, partPath.lastIndexOf('/'))
  for (const rel of descendantsByLocalName(parseXml(xml), 'Relationship')) {
    const id = rel.getAttribute('Id')
    const target = rel.getAttribute('Target')
    if (!id || !target) continue
    const external = rel.getAttribute('TargetMode') === 'External'
    map.set(id, {
      type: rel.getAttribute('Type') ?? '',
      target: external ? target : resolvePartPath(baseDir, target),
      external,
    })
  }
  return map
}

export function resolvePartPath(baseDir: string, target: string) {
  const parts = target.startsWith('/') ? [] : baseDir.split('/').filter(Boolean)
  for (const segment of target.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') parts.pop()
    else parts.push(segment)
  }
  return parts.join('/')
}

function getRelationshipId(element: Element, localName: string) {
  for (const attribute of Array.from(element.attributes)) {
    const [prefix, name] = attribute.name.includes(':') ? attribute.name.split(':') : ['', attribute.name]
    if (name === localName && (attribute.namespaceURI?.includes('relationships') || prefix === 'r')) {
      return attribute.value
    }
  }
  return null
}

function extractTextFromXml(xml: string) {
  return extractTextFromElement(parseXml(xml).documentElement)
}

function extractTextFromElement(element: Element) {
  const lines: string[] = []
  for (const paragraph of descendantsByLocalName(element, 'p')) {
    if (paragraph.namespaceURI && !paragraph.namespaceURI.includes('drawingml')) continue
    const text = descendantsByLocalName(paragraph, 't')
      .map((node) => node.textContent ?? '')
      .join('')
      .trim()
    if (text) lines.push(text)
  }
  return lines
}

function parseXml(xml: string) {
  return new DOMParser().parseFromString(xml, 'application/xml')
}

// Matching on localName keeps transitional and strict OOXML namespaces working
// alike, without depending on namespace wildcard support in the DOM.
function descendantsByLocalName(root: Document | Element, localName: string) {
  return Array.from(root.getElementsByTagName('*')).filter((element) => element.localName === localName)
}

function firstByLocalName(root: Document | Element, localName: string) {
  for (const element of Array.from(root.getElementsByTagName('*'))) {
    if (element.localName === localName) return element
  }
  return null
}

function childrenByLocalName(parent: Element, localName: string) {
  return Array.from(parent.children).filter((child) => child.localName === localName)
}

function firstChildByLocalName(parent: Element, localName: string) {
  for (const child of Array.from(parent.children)) {
    if (child.localName === localName) return child
  }
  return null
}

function num(element: Element, attribute: string) {
  return Number(element.getAttribute(attribute) ?? 0) || 0
}

function extensionOf(path: string) {
  return path.split('.').pop()?.toLowerCase() ?? ''
}

function slideFileNumber(path: string) {
  return Number(path.match(/slide(\d+)\.xml$/i)?.[1] ?? 0)
}

export const PPTX_EMU_PER_PX = EMU_PER_PX
