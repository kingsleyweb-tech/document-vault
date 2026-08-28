export interface DriveFile {
  id: string
  name: string
  mimeType: string
  webViewLink?: string
  thumbnailLink?: string
  size?: string
  trashed?: boolean
}

export interface DriveFolder {
  id: string
  name: string
}
