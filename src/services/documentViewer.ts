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

export async function loadDocumentPreview(accessToken: string, documentRecord: VaultDocument): Promise<DocumentPreview> {
  const metadata = await getDriveFileMetadata(accessToken, documentRecord.driveFileId)

  if (metadata.trashed) {
    throw new GoogleDriveError(404, 'This file is in Google Drive trash.', 'trashed')
  }

  const mimeType = metadata.mimeType || documentRecord.mimeType
  const blob = await downloadDriveFile(accessToken, documentRecord.driveFileId, mimeType)
  const typedBlob = blob.type ? blob : new Blob([blob], { type: mimeType || documentRecord.mimeType })
  const objectUrl = URL.createObjectURL(typedBlob)
  const kind = getPreviewKind({ ...documentRecord, mimeType })

  const fileName = documentRecord.originalName.toLowerCase()

  if (kind === 'text') {
    return {
      kind,
      blob: typedBlob,
      objectUrl,
      text: await typedBlob.text(),
      downloadable: true,
    }
  }

  if (kind === 'html') {
    return {
      kind,
      blob: typedBlob,
      objectUrl,
      html: sanitizeHtml(await typedBlob.text()),
      downloadable: true,
    }
  }

  if (kind === 'office' && /\.(docx?|rtf)$/i.test(fileName)) {
    try {
      return {
        kind: 'word',
        blob: typedBlob,
        objectUrl,
        html: await renderDocx(typedBlob),
        downloadable: true,
      }
    } catch {
      // Fall through to office fallback if rendering fails
    }
  }

  if (kind === 'office' && /\.(xlsx?|csv)$/i.test(fileName)) {
    try {
      return {
        kind: 'spreadsheet',
        blob: typedBlob,
        objectUrl,
        sheets: await renderSpreadsheet(typedBlob),
        downloadable: true,
      }
    } catch {
      // Fall through to office fallback if rendering fails
    }
  }

  if (kind === 'office' && /\.(pptx?)$/i.test(fileName)) {
    try {
      return {
        kind: 'presentation',
        blob: typedBlob,
        objectUrl,
        slides: await renderPresentation(typedBlob),
        downloadable: true,
      }
    } catch {
      // Fall through to office fallback if rendering fails
    }
  }

  return {
    kind,
    blob: typedBlob,
    objectUrl,
    downloadable: true,
  }
}

export function getPreviewKind(documentRecord: Pick<VaultDocument, 'fileType' | 'mimeType' | 'originalName'>): PreviewKind {
  if (documentRecord.fileType === 'pdf') return 'pdf'
  if (documentRecord.fileType === 'image') return 'image'
  if (documentRecord.fileType === 'html') return 'html'
  if (documentRecord.fileType === 'text') return 'text'
  if (documentRecord.fileType === 'word' || documentRecord.fileType === 'spreadsheet' || documentRecord.fileType === 'presentation') {
    return 'office'
  }

  const name = documentRecord.originalName.toLowerCase()
  if (/\.(docx?|rtf)$/.test(name)) return 'office'
  if (/\.(xlsx?|csv)$/.test(name)) return 'office'
  if (/\.(pptx?)$/.test(name)) return 'office'
  if (documentRecord.mimeType.includes('word') || documentRecord.mimeType.includes('officedocument.word')) return 'office'
  if (documentRecord.mimeType.includes('excel') || documentRecord.mimeType.includes('officedocument.sheet')) return 'office'
  if (documentRecord.mimeType.includes('powerpoint') || documentRecord.mimeType.includes('officedocument.presentation')) return 'office'
  if (documentRecord.mimeType.startsWith('text/')) return 'text'
  if (/\.(html?|xhtml)$/i.test(documentRecord.originalName)) return 'html'
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
  const mammoth = await import('mammoth/mammoth.browser')
  const result = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() })
  return sanitizeHtml(result.value)
}

async function renderSpreadsheet(blob: Blob): Promise<SpreadsheetSheet[]> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(await blob.arrayBuffer(), { type: 'array', cellStyles: true })
  return workbook.SheetNames.map((name) => ({
    name,
    html: XLSX.utils.sheet_to_html(workbook.Sheets[name], { id: `sheet-${cssSafeId(name)}` }),
  }))
}

async function renderPresentation(blob: Blob): Promise<PresentationSlide[]> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
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
