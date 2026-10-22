import type { DocumentKind } from '../types/document'

const kindLabels: Record<DocumentKind, string> = {
  pdf: 'PDF',
  word: 'Word',
  spreadsheet: 'Spreadsheet',
  presentation: 'Slides',
  image: 'Image',
  folder: 'Folder',
  html: 'HTML',
  text: 'Text',
  ebook: 'eBook',
  other: 'File',
}

export function kindLabel(kind: DocumentKind) {
  return kindLabels[kind] ?? 'File'
}
