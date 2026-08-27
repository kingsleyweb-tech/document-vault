import type { DocumentKind } from '../types/document'

const mimeKindMap: Record<string, DocumentKind> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'application/msword': 'word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
  'application/vnd.ms-excel': 'spreadsheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'spreadsheet',
  'application/vnd.ms-powerpoint': 'presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'presentation',
}

const extensionKindMap: Record<string, DocumentKind> = {
  pdf: 'pdf',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  webp: 'image',
  doc: 'word',
  docx: 'word',
  xls: 'spreadsheet',
  xlsx: 'spreadsheet',
  ppt: 'presentation',
  pptx: 'presentation',
}

export function getFileExtension(fileName: string) {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

export function getDocumentKind(file: File): DocumentKind {
  return mimeKindMap[file.type] ?? extensionKindMap[getFileExtension(file.name)] ?? 'other'
}

export function isSupportedFile(file: File) {
  void file
  return true
}

export function stripExtension(fileName: string) {
  return fileName.replace(/\.[^/.]+$/, '')
}
