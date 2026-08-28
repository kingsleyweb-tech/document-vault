import type { DriveFile, DriveFolder } from '../types/googleDrive'

const driveApi = 'https://www.googleapis.com/drive/v3'
const driveUploadApi = 'https://www.googleapis.com/upload/drive/v3'
const folderMimeType = 'application/vnd.google-apps.folder'
const vaultFolderName = 'Document Vault'

interface GoogleApiErrorBody {
  error?: {
    code?: number
    message?: string
    status?: string
    errors?: Array<{ reason?: string; message?: string }>
  }
}

export class GoogleDriveError extends Error {
  status: number
  reason?: string

  constructor(status: number, message: string, reason?: string) {
    super(message)
    this.name = 'GoogleDriveError'
    this.status = status
    this.reason = reason
  }
}

async function parseDriveError(response: Response) {
  const details = await response.text()

  try {
    const parsed = JSON.parse(details) as GoogleApiErrorBody
    const reason = parsed.error?.errors?.[0]?.reason ?? parsed.error?.status
    return new GoogleDriveError(
      response.status,
      parsed.error?.message ?? `Google Drive request failed with status ${response.status}.`,
      reason,
    )
  } catch {
    return new GoogleDriveError(response.status, details || 'Google Drive request failed.')
  }
}

async function driveFetch<T>(accessToken: string, url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    },
  })

  if (!response.ok) {
    throw await parseDriveError(response)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

function escapeDriveQuery(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export async function ensureVaultFolder(accessToken: string): Promise<DriveFolder> {
  return ensureDriveFolder(accessToken, vaultFolderName)
}

export async function ensureDriveFolder(
  accessToken: string,
  folderName: string,
  parentFolderId?: string,
): Promise<DriveFolder> {
  const parentClause = parentFolderId ? ` and '${escapeDriveQuery(parentFolderId)}' in parents` : ''
  const query = encodeURIComponent(
    `name='${escapeDriveQuery(folderName)}' and mimeType='${folderMimeType}' and trashed=false${parentClause}`,
  )
  const result = await driveFetch<{ files: DriveFolder[] }>(
    accessToken,
    `${driveApi}/files?q=${query}&spaces=drive&fields=files(id,name)&pageSize=1`,
  )

  if (result.files[0]) {
    return result.files[0]
  }

  return driveFetch<DriveFolder>(accessToken, `${driveApi}/files?fields=id,name`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: folderName,
      mimeType: folderMimeType,
      ...(parentFolderId ? { parents: [parentFolderId] } : {}),
    }),
  })
}

export async function uploadFileToDrive(
  accessToken: string,
  file: File,
  folderId: string,
): Promise<DriveFile> {
  const boundary = `document_vault_${crypto.randomUUID()}`
  const metadata = {
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    parents: [folderId],
  }
  const delimiter = `\r\n--${boundary}\r\n`
  const closeDelimiter = `\r\n--${boundary}--`
  const body = new Blob(
    [
      delimiter,
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      JSON.stringify(metadata),
      delimiter,
      `Content-Type: ${metadata.mimeType}\r\n\r\n`,
      file,
      closeDelimiter,
    ],
    { type: `multipart/related; boundary=${boundary}` },
  )

  return driveFetch<DriveFile>(
    accessToken,
    `${driveUploadApi}/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,thumbnailLink,size`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    },
  )
}

export async function getDriveFileMetadata(accessToken: string, fileId: string) {
  return driveFetch<DriveFile>(
    accessToken,
    `${driveApi}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,webViewLink,thumbnailLink,size,trashed`,
  )
}

export async function getDriveFileContent(accessToken: string, fileId: string) {
  const response = await fetch(`${driveApi}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: 'omit',
  })

  if (!response.ok) {
    throw await parseDriveError(response)
  }

  return response.blob()
}

export async function getDriveFileBlob(accessToken: string, fileId: string) {
  return getDriveFileContent(accessToken, fileId)
}

function isPotentiallyConvertible(mimeType: string) {
  const t = mimeType.toLowerCase()
  return (
    t.includes('word') ||
    t.includes('excel') ||
    t.includes('spreadsheet') ||
    t.includes('powerpoint') ||
    t.includes('presentation') ||
    t.includes('officedocument') ||
    t.includes('ms-') ||
    t.includes('text/') ||
    t.includes('html')
  )
}

export async function downloadDriveFile(accessToken: string, fileId: string, mimeType?: string) {
  let activeMimeType = mimeType

  if (!activeMimeType || (!activeMimeType.startsWith('application/vnd.google-apps.') && isPotentiallyConvertible(activeMimeType))) {
    try {
      const metadata = await getDriveFileMetadata(accessToken, fileId)
      activeMimeType = metadata.mimeType
    } catch {
      // Fallback to whatever was provided
    }
  }

  if (activeMimeType && activeMimeType.startsWith('application/vnd.google-apps.')) {
    if (activeMimeType === 'application/vnd.google-apps.folder') {
      throw new Error('Cannot download a folder.')
    }
    return exportGoogleWorkspaceFile(accessToken, fileId, activeMimeType)
  }

  return getDriveFileContent(accessToken, fileId)
}

export async function exportGoogleWorkspaceFile(accessToken: string, fileId: string, mimeType: string) {
  const exportMimeType = getWorkspaceExportMimeType(mimeType)
  const response = await fetch(
    `${driveApi}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMimeType)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: 'omit',
    },
  )

  if (!response.ok) {
    throw await parseDriveError(response)
  }

  return response.blob()
}

export async function getDriveFolderChildren(accessToken: string, folderId: string) {
  const query = encodeURIComponent(`'${escapeDriveQuery(folderId)}' in parents and trashed=false`)
  return driveFetch<{ files: DriveFile[] }>(
    accessToken,
    `${driveApi}/files?q=${query}&spaces=drive&fields=files(id,name,mimeType,webViewLink,thumbnailLink,size)&pageSize=1000`,
  )
}

export async function renameDriveFile(accessToken: string, fileId: string, name: string) {
  return driveFetch<DriveFile>(accessToken, `${driveApi}/files/${fileId}?fields=id,name`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export async function moveDriveFile(
  accessToken: string,
  fileId: string,
  addParents: string,
  removeParents: string,
): Promise<DriveFile> {
  return driveFetch<DriveFile>(
    accessToken,
    `${driveApi}/files/${fileId}?addParents=${encodeURIComponent(addParents)}&removeParents=${encodeURIComponent(removeParents)}&fields=id,parents`,
    {
      method: 'PATCH',
    },
  )
}

export async function trashDriveFile(accessToken: string, fileId: string) {
  return driveFetch<DriveFile>(accessToken, `${driveApi}/files/${fileId}?fields=id,name`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  })
}

export async function restoreDriveFile(accessToken: string, fileId: string) {
  return driveFetch<DriveFile>(accessToken, `${driveApi}/files/${fileId}?fields=id,name`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: false }),
  })
}

export async function deleteDriveFile(accessToken: string, fileId: string) {
  await driveFetch<void>(accessToken, `${driveApi}/files/${fileId}`, { method: 'DELETE' })
}

export async function createDriveFolder(
  accessToken: string,
  name: string,
  parentFolderId: string,
): Promise<DriveFolder> {
  return driveFetch<DriveFolder>(accessToken, `${driveApi}/files?fields=id,name`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: folderMimeType,
      parents: [parentFolderId],
    }),
  })
}

export async function checkFileExists(
  accessToken: string,
  fileId: string,
): Promise<{ exists: boolean; trashed?: boolean }> {
  try {
    const file = await driveFetch<{ id: string; trashed: boolean }>(
      accessToken,
      `${driveApi}/files/${fileId}?fields=id,trashed`,
    )
    return { exists: true, trashed: file.trashed }
  } catch (error) {
    if (error instanceof GoogleDriveError && error.status === 404) {
      return { exists: false }
    }
    // For other errors (network/auth), assume it exists and matches current state
    return { exists: true }
  }
}

function getWorkspaceExportMimeType(mimeType: string) {
  if (mimeType === 'application/vnd.google-apps.document') {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  }
  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }
  if (mimeType === 'application/vnd.google-apps.presentation') {
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  }
  return 'application/pdf'
}
