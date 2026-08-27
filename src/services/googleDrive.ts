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
  const query = encodeURIComponent(
    `name='${escapeDriveQuery(vaultFolderName)}' and mimeType='${folderMimeType}' and trashed=false`,
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
    body: JSON.stringify({ name: vaultFolderName, mimeType: folderMimeType }),
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

export async function getDriveFileBlob(accessToken: string, fileId: string) {
  const response = await fetch(`${driveApi}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw await parseDriveError(response)
  }

  return response.blob()
}

export async function renameDriveFile(accessToken: string, fileId: string, name: string) {
  return driveFetch<DriveFile>(accessToken, `${driveApi}/files/${fileId}?fields=id,name`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
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

export async function makeFilePubliclyReadable(accessToken: string, fileId: string) {
  return driveFetch<Record<string, unknown>>(accessToken, `${driveApi}/files/${fileId}/permissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role: 'reader',
      type: 'anyone',
    }),
  })
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
