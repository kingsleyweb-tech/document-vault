export type DocumentCategory =
  | 'Personal'
  | 'School'
  | 'Military'
  | 'Work'
  | 'Certificates'
  | 'Reports'
  | 'Other'

export type DocumentKind =
  | 'pdf'
  | 'image'
  | 'word'
  | 'spreadsheet'
  | 'presentation'
  | 'folder'
  | 'html'
  | 'text'
  | 'ebook'
  | 'other'

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
  createdAt: VaultTimestamp
  uploadedAt: VaultTimestamp
  updatedAt: VaultTimestamp
  lastViewedAt?: VaultTimestamp
  parentId?: string | null
  folderId?: string | null
  folderPath?: string
  isFolderRecord?: boolean
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
  folderId?: string | null
  folderPath?: string
}

export interface VaultFolder {
  id: string
  ownerId: string
  name: string
  parentFolderId: string | null
  driveFolderId: string
  isFavorite: boolean
  isDeleted: boolean
  createdAt: VaultTimestamp
  updatedAt: VaultTimestamp
}

export interface NewFolderMetadata {
  ownerId: string
  name: string
  parentFolderId: string | null
  driveFolderId: string
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

export type UploadStatus = 'PENDING' | 'COMPRESSING' | 'UPLOADING' | 'COMPLETED' | 'FAILED' | 'RETRYING' | 'PAUSED'

export interface UploadItem {
  id: string
  file: File
  status: UploadStatus
  progress: number
  category: DocumentCategory
  description: string
  relativePath?: string
  error?: string
  errorStatus?: number
  attempts?: number
  driveFileId?: string
  driveFolderId?: string
  firestoreDocumentId?: string
  lastAttemptAt?: number
  originalSize?: number
  compressedSize?: number
  savedPercentage?: number
}
