import { FileImage, FileSpreadsheet, FileText, Folder } from 'lucide-react'
import pdfIcon from '../../assets/pdf.png'
import powerpointIcon from '../../assets/powerpoint.png'
import wordIcon from '../../assets/word.png'
import type { DocumentKind } from '../../types/document'

interface FallbackIconConfig {
  icon: typeof FileText
  bg: string
  color: string
}

const fallbackIcons: Partial<Record<DocumentKind, FallbackIconConfig>> = {
  spreadsheet: { icon: FileSpreadsheet, bg: '#f0fdf4', color: '#16a34a' },
  image: { icon: FileImage, bg: '#faf5ff', color: '#7c3aed' },
  folder: { icon: Folder, bg: '#fefce8', color: '#ca8a04' },
  other: { icon: FileText, bg: '#f9fafb', color: '#4b5563' },
}

const imageIcons: Partial<Record<DocumentKind, string>> = {
  pdf: pdfIcon,
  word: wordIcon,
  presentation: powerpointIcon,
}

export function DocumentIcon({ kind, size = 22 }: { kind: DocumentKind; size?: number }) {
  const imageSrc = imageIcons[kind]

  if (imageSrc) {
    return (
      <span
        className={`file-icon-badge file-icon-badge--${kind}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          borderRadius: '10px',
          backgroundColor: 'transparent',
        }}
        aria-hidden="true"
      >
        <img
          src={imageSrc}
          alt=""
          style={{
            width: `${size + 8}px`,
            height: `${size + 8}px`,
            objectFit: 'contain',
          }}
        />
      </span>
    )
  }

  const config = fallbackIcons[kind] ?? { icon: FileText, bg: '#f9fafb', color: '#4b5563' }
  const Icon = config.icon

  return (
    <span
      className={`file-icon-badge file-icon-badge--${kind}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        borderRadius: '10px',
        backgroundColor: config.bg,
        color: config.color,
      }}
      aria-hidden="true"
    >
      <Icon size={size} strokeWidth={1.8} />
    </span>
  )
}
