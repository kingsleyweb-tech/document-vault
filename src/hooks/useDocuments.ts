import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createDocumentRecord,
  deleteDocumentRecord,
  listenToUserDocuments,
  markDocumentViewed,
  updateDocumentRecord,
} from '../services/firestore'
import {
  checkFileExists,
  createDriveFolder,
  deleteDriveFile,
  ensureDriveFolder,
  ensureVaultFolder,
  renameDriveFile,
  restoreDriveFile,
  trashDriveFile,
  uploadFileToDrive,
} from '../services/googleDrive'
import type { DocumentCategory, NewDocumentMetadata, SortMode, VaultDocument } from '../types/document'
import type { VaultUser } from '../types/user'
import { getDocumentKind, stripExtension } from '../utils/fileUtils'

interface UploadOptions {
  category: DocumentCategory
  description: string
}

export function useDocuments(user: VaultUser | null, accessToken: string | null) {
  const [documents, setDocuments] = useState<VaultDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) {
      return undefined
    }

    return listenToUserDocuments(
      user.uid,
      (nextDocuments) => {
        setDocuments(nextDocuments)
        setError(null)
        setLoading(false)
      },
      (listenError) => {
        console.error(listenError)
        setError('Unable to load your documents. Please try again.')
        setLoading(false)
      },
    )
  }, [user])

  const validatedIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!accessToken || documents.length === 0) return

    // Find documents that haven't been validated yet in this session
    const toValidate = documents.filter((doc) => !validatedIdsRef.current.has(doc.id))
    if (toValidate.length === 0) return

    // Mark them as checked immediately so we don't trigger multiple checks in parallel
    toValidate.forEach((doc) => validatedIdsRef.current.add(doc.id))

    const deleteFromVault = async (record: VaultDocument) => {
      if (record.fileType === 'folder') {
        const children = documents.filter((d) => d.parentId === record.id)
        for (const child of children) {
          await deleteFromVault(child)
        }
      }
      await deleteDocumentRecord(record.id)
    }

    // Validate each document in the background
    toValidate.forEach(async (docRecord) => {
      const result = await checkFileExists(accessToken, docRecord.driveFileId)
      if (!result.exists) {
        console.warn(`File ${docRecord.name} not found on Google Drive. Cleaning up local metadata.`)
        await deleteFromVault(docRecord)
      } else if (result.trashed !== undefined) {
        // If Google Drive trash state doesn't match vault metadata, sync them.
        if (result.trashed && !docRecord.isDeleted) {
          console.info(`File ${docRecord.name} was trashed on Google Drive. Syncing trash state.`)
          await updateDocumentRecord(docRecord.id, { isDeleted: true })
        } else if (!result.trashed && docRecord.isDeleted) {
          console.info(`File ${docRecord.name} was restored on Google Drive. Syncing trash state.`)
          await updateDocumentRecord(docRecord.id, { isDeleted: false })
        }
      }
    })
  }, [accessToken, documents])

  const actions = useMemo(
    () => ({
      async upload(file: File, options: UploadOptions, parentId: string | null = null) {
        if (!user || !accessToken) {
          throw new Error('Please reconnect Google Drive before uploading.')
        }

        let targetFolderId: string
        if (parentId) {
          const parentFolder = documents.find((d) => d.id === parentId)
          if (!parentFolder) throw new Error('Parent folder not found.')
          targetFolderId = parentFolder.driveFileId
        } else {
          const rootFolder = await ensureVaultFolder(accessToken)
          const categoryFolder = await ensureDriveFolder(accessToken, options.category, rootFolder.id)
          targetFolderId = categoryFolder.id
        }

        const driveFile = await uploadFileToDrive(accessToken, file, targetFolderId)

        const metadata: NewDocumentMetadata = {
          ownerId: user.uid,
          name: stripExtension(file.name),
          originalName: file.name,
          mimeType: file.type || driveFile.mimeType,
          fileType: getDocumentKind(file),
          fileSize: file.size,
          category: options.category,
          description: options.description,
          driveFileId: driveFile.id,
          driveFolderId: targetFolderId,
          parentId: parentId,
        }

        if (driveFile.webViewLink) {
          metadata.driveWebViewLink = driveFile.webViewLink
        }
        if (driveFile.thumbnailLink) {
          metadata.thumbnailUrl = driveFile.thumbnailLink
        }

        await createDocumentRecord(metadata)
      },
      async createFolder(name: string, parentId: string | null = null): Promise<string> {
        if (!user || !accessToken) {
          throw new Error('Please reconnect Google Drive before creating a folder.')
        }

        let targetFolderId: string
        if (parentId) {
          const parentFolder = documents.find((d) => d.id === parentId)
          if (!parentFolder) throw new Error('Parent folder not found.')
          targetFolderId = parentFolder.driveFileId
        } else {
          const rootFolder = await ensureVaultFolder(accessToken)
          targetFolderId = rootFolder.id
        }

        const driveFolder = await createDriveFolder(accessToken, name, targetFolderId)

        const metadata: NewDocumentMetadata = {
          ownerId: user.uid,
          name: name,
          originalName: name,
          mimeType: 'application/vnd.google-apps.folder',
          fileType: 'folder',
          fileSize: 0,
          category: 'Other',
          description: '',
          driveFileId: driveFolder.id,
          driveFolderId: targetFolderId,
          parentId: parentId,
        }

        const docRef = await createDocumentRecord(metadata)
        return docRef.id
      },
      async rename(documentRecord: VaultDocument, nextName: string) {
        if (!accessToken) throw new Error('Please reconnect Google Drive before renaming.')
        await renameDriveFile(accessToken, documentRecord.driveFileId, nextName)
        await updateDocumentRecord(documentRecord.id, { name: nextName })
      },
      async toggleFavorite(documentRecord: VaultDocument) {
        await updateDocumentRecord(documentRecord.id, { isFavorite: !documentRecord.isFavorite })
      },
      async moveToTrash(documentRecord: VaultDocument) {
        if (!accessToken) throw new Error('Please reconnect Google Drive before deleting.')
        
        const recursiveTrash = async (record: VaultDocument) => {
          if (record.fileType === 'folder') {
            const children = documents.filter((d) => d.parentId === record.id)
            for (const child of children) {
              await recursiveTrash(child)
            }
          }
          await trashDriveFile(accessToken, record.driveFileId)
          await updateDocumentRecord(record.id, { isDeleted: true })
        }

        await recursiveTrash(documentRecord)
      },
      async restore(documentRecord: VaultDocument) {
        if (!accessToken) throw new Error('Please reconnect Google Drive before restoring.')
        
        const recursiveRestore = async (record: VaultDocument) => {
          if (record.fileType === 'folder') {
            const children = documents.filter((d) => d.parentId === record.id && d.isDeleted)
            for (const child of children) {
              await recursiveRestore(child)
            }
          }
          await restoreDriveFile(accessToken, record.driveFileId)
          await updateDocumentRecord(record.id, { isDeleted: false })
        }

        await recursiveRestore(documentRecord)
      },
      async permanentlyDelete(documentRecord: VaultDocument) {
        if (!accessToken) throw new Error('Please reconnect Google Drive before permanently deleting.')
        
        const recursiveDelete = async (record: VaultDocument) => {
          if (record.fileType === 'folder') {
            const children = documents.filter((d) => d.parentId === record.id)
            for (const child of children) {
              await recursiveDelete(child)
            }
          }
          await deleteDriveFile(accessToken, record.driveFileId)
          await deleteDocumentRecord(record.id)
        }

        await recursiveDelete(documentRecord)
      },
      async viewed(documentRecord: VaultDocument) {
        await markDocumentViewed(documentRecord.id)
      },
    }),
    [user, accessToken, documents],
  )

  return { documents, loading, error, actions }
}

export function filterAndSortDocuments(
  documents: VaultDocument[],
  search: string,
  sortMode: SortMode,
  category: DocumentCategory | 'All',
  currentFolderId: string | null = null,
) {
  const normalizedSearch = search.trim().toLowerCase()
  const filtered = documents.filter((documentRecord) => {
    // 1. Filter by parentId hierarchy if not searching
    if (!normalizedSearch) {
      const pId = documentRecord.parentId ?? null
      if (pId !== currentFolderId) {
        return false
      }
    }

    // 2. Filter by category (folders are exempt from category filter so they are always visible)
    if (category !== 'All' && documentRecord.category !== category && documentRecord.fileType !== 'folder') {
      return false
    }

    if (!normalizedSearch) return true

    return [
      documentRecord.name,
      documentRecord.originalName,
      documentRecord.category,
      documentRecord.description,
      documentRecord.fileType,
      documentRecord.mimeType,
    ]
      .join(' ')
      .toLowerCase()
      .includes(normalizedSearch)
  })

  // Folders are sorted to the top, then sorted by standard parameters
  return filtered.sort((first, second) => {
    if (first.fileType === 'folder' && second.fileType !== 'folder') return -1
    if (first.fileType !== 'folder' && second.fileType === 'folder') return 1

    switch (sortMode) {
      case 'oldest':
        return first.uploadedAt.toMillis() - second.uploadedAt.toMillis()
      case 'name-asc':
        return first.name.localeCompare(second.name)
      case 'name-desc':
        return second.name.localeCompare(first.name)
      case 'largest':
        return second.fileSize - first.fileSize
      case 'smallest':
        return first.fileSize - second.fileSize
      case 'updated':
        return second.updatedAt.toMillis() - first.updatedAt.toMillis()
      case 'newest':
      default:
        return second.uploadedAt.toMillis() - first.uploadedAt.toMillis()
    }
  })
}
