export interface DriveFile {
  id: string
  name: string
  mimeType: string
  webViewLink?: string
  thumbnailLink?: string
  size?: string
}

export interface DriveFolder {
  id: string
  name: string
}
