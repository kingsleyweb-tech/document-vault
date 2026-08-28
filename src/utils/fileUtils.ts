import type { DocumentKind } from '../types/document'

const mimeKindMap: Record<string, DocumentKind> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'image/svg+xml': 'image',
  'text/plain': 'text',
  'text/html': 'html',
  'application/xhtml+xml': 'html',
  'application/rtf': 'word',
  'text/rtf': 'word',
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
  gif: 'image',
  svg: 'image',
  txt: 'text',
  text: 'text',
  rtf: 'word',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  doc: 'word',
  docx: 'word',
  xls: 'spreadsheet',
  xlsx: 'spreadsheet',
  csv: 'spreadsheet',
  ppt: 'presentation',
  pptx: 'presentation',
  epub: 'ebook',
  mobi: 'ebook',
  azw: 'ebook',
  azw3: 'ebook',
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

export function normalizeRelativePath(path: string) {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/')
}
