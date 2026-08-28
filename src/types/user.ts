export interface VaultUser {
  uid: string
  displayName: string
  email: string
  photoURL: string
  driveFolderId?: string
  driveConnected?: boolean
}

export interface VaultUserProfile extends VaultUser {
  driveFolderId?: string
  driveConnected: boolean
}
