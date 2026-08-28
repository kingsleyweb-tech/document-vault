import type { VaultDocument } from '../types/document'
import { downloadDriveFile, getDriveFileMetadata, GoogleDriveError } from './googleDrive'

export type PreviewKind = 'pdf' | 'image' | 'html' | 'text' | 'office' | 'fallback'

export interface DocumentPreview {
  kind: PreviewKind
  blob: Blob
  objectUrl: string
  text?: string
  html?: string
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
