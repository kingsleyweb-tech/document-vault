export type DocumentCategory =
  | 'Personal'
  | 'School'
  | 'Military'
  | 'Work'
  | 'Certificates'
  | 'Reports'
  | 'Other'

export type DocumentKind = 'pdf' | 'image' | 'word' | 'spreadsheet' | 'presentation' | 'folder' | 'other'

export interface VaultTimestamp {
  toDate: () => Date
  toMillis: () => number
}

export interface VaultDocument {
  id: string
  ownerId: string
  name: string
  originalName: string
  mimeType: string
  fileType: DocumentKind
  fileSize: number
  category: DocumentCategory
  description: string
  driveFileId: string
  driveFolderId: string
  driveWebViewLink?: string
  thumbnailUrl?: string
  isFavorite: boolean
  isDeleted: boolean
  uploadedAt: VaultTimestamp
  updatedAt: VaultTimestamp
  lastViewedAt?: VaultTimestamp
  parentId?: string | null
}

export interface NewDocumentMetadata {
  ownerId: string
  name: string
  originalName: string
  mimeType: string
  fileType: DocumentKind
  fileSize: number
  category: DocumentCategory
  description: string
  driveFileId: string
  driveFolderId: string
  driveWebViewLink?: string
  thumbnailUrl?: string
  parentId?: string | null
}

export type SortMode =
  | 'newest'
  | 'oldest'
  | 'name-asc'
  | 'name-desc'
  | 'largest'
  | 'smallest'
  | 'updated'

export type ViewMode = 'grid' | 'list'

export type ThemeMode = 'light' | 'dark'

export type UploadStatus = 'queued' | 'uploading' | 'success' | 'error'

export interface UploadItem {
  id: string
  file: File
  status: UploadStatus
  progress: number
  category: DocumentCategory
  description: string
  error?: string
}
