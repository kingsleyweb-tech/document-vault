import { BookOpen, File, FileCode2, FileImage, FileSpreadsheet, FileText, Folder, Presentation, type LucideIcon } from 'lucide-react'
import type { DocumentKind } from '../../types/document'

const kindIcons: Record<DocumentKind, LucideIcon> = {
  pdf: FileText,
  word: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  image: FileImage,
  folder: Folder,
  html: FileCode2,
  text: FileText,
  ebook: BookOpen,
  other: File,
}

// Tinted tile with the file-kind icon; colours come from the --kind-* tokens.
export function DocumentIcon({ kind, size = 20 }: { kind: DocumentKind; size?: number }) {
  const Icon = kindIcons[kind] ?? File
  return (
    <span className={`kind-icon kind-icon--${kindIcons[kind] ? kind : 'other'}`} aria-hidden="true">
      <Icon size={size} strokeWidth={1.75} />
    </span>
  )
}
