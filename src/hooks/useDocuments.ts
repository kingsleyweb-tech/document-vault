import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createDocumentRecord,
  createFolderRecord,
  deleteDocumentRecord,
  deleteFolderRecord,
  findFolderRecord,
  listenToUserLibrary,
  markDocumentViewed,
  updateDocumentRecord,
  updateFolderRecord,
} from '../services/firestore'
import {
  checkFileExists,
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
import { getDocumentKind, normalizeRelativePath, stripExtension } from '../utils/fileUtils'
import { getUserProfile, updateUserDriveConnection } from '../services/users'

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

    return listenToUserLibrary(
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
      if (record.fileType === 'folder' && record.isFolderRecord) {
        await deleteFolderRecord(record.id)
      } else {
        await deleteDocumentRecord(record.id)
      }
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
        const targetVaultFolderId = parentId
        let folderPath = ''
        if (parentId) {
          const parentFolder = documents.find((d) => d.id === parentId)
          if (!parentFolder) throw new Error('Parent folder not found.')
          targetFolderId = parentFolder.driveFileId
          folderPath = buildFolderPath(documents, parentId)
        } else {
          const rootFolder = await ensureUserVaultFolder(user, accessToken)
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
          parentId: targetVaultFolderId,
          folderId: targetVaultFolderId,
          folderPath,
        }

        if (driveFile.webViewLink) {
          metadata.driveWebViewLink = driveFile.webViewLink
        }
        if (driveFile.thumbnailLink) {
          metadata.thumbnailUrl = driveFile.thumbnailLink
        }

        await createDocumentRecord(metadata)
      },
      async uploadWithRelativePath(
        file: File,
        relativePath: string,
        options: UploadOptions,
        parentId: string | null = null,
      ) {
        if (!user || !accessToken) {
          throw new Error('Please reconnect Google Drive before uploading.')
        }

        const normalizedPath = normalizeRelativePath(relativePath || file.name)
        const pathParts = normalizedPath.split('/').filter(Boolean)
        const fileName = pathParts.pop() ?? file.name
        let currentParentId = parentId
        let currentDriveParentId: string
        let folderPath = ''

        if (currentParentId) {
          const parentFolder = documents.find((d) => d.id === currentParentId)
          if (!parentFolder) throw new Error('Parent folder not found.')
          currentDriveParentId = parentFolder.driveFileId
          folderPath = buildFolderPath(documents, currentParentId)
        } else {
          const rootFolder = await ensureUserVaultFolder(user, accessToken)
          currentDriveParentId = rootFolder.id
        }

        for (const folderName of pathParts) {
          const folderRecord = await ensureFirestoreFolder(
            user.uid,
            accessToken,
            documents,
            folderName,
            currentParentId,
            currentDriveParentId,
          )
          currentParentId = folderRecord.id
          currentDriveParentId = folderRecord.driveFileId
          folderPath = folderPath ? `${folderPath} / ${folderRecord.name}` : folderRecord.name
        }

        const namedFile = file.name === fileName ? file : new File([file], fileName, { type: file.type })
        const driveFile = await uploadFileToDrive(accessToken, namedFile, currentDriveParentId)
        const metadata: NewDocumentMetadata = {
          ownerId: user.uid,
          name: stripExtension(fileName),
          originalName: fileName,
          mimeType: file.type || driveFile.mimeType,
          fileType: getDocumentKind(namedFile),
          fileSize: file.size,
          category: options.category,
          description: options.description,
          driveFileId: driveFile.id,
          driveFolderId: currentDriveParentId,
          parentId: currentParentId,
          folderId: currentParentId,
          folderPath,
        }

        if (driveFile.webViewLink) metadata.driveWebViewLink = driveFile.webViewLink
        if (driveFile.thumbnailLink) metadata.thumbnailUrl = driveFile.thumbnailLink
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
          const rootFolder = await ensureUserVaultFolder(user, accessToken)
          targetFolderId = rootFolder.id
        }

        const existingFolder = documents.find(
          (d) => d.fileType === 'folder' && d.name === name && (d.parentId ?? null) === parentId,
        )
        if (existingFolder) return existingFolder.id

        const foundFolder = await findFolderRecord(user.uid, name, parentId)
        if (foundFolder) return foundFolder.id

        const driveFolder = await ensureDriveFolder(accessToken, name, targetFolderId)

        const metadata = {
          ownerId: user.uid,
          name: name,
          parentFolderId: parentId,
          driveFolderId: driveFolder.id,
        }

        const docRef = await createFolderRecord(metadata)
        return docRef.id
      },
      async rename(documentRecord: VaultDocument, nextName: string) {
        if (!accessToken) throw new Error('Please reconnect Google Drive before renaming.')
        await renameDriveFile(accessToken, documentRecord.driveFileId, nextName)
        if (documentRecord.fileType === 'folder' && documentRecord.isFolderRecord) {
          await updateFolderRecord(documentRecord.id, { name: nextName })
        } else {
          await updateDocumentRecord(documentRecord.id, { name: nextName })
        }
      },
      async toggleFavorite(documentRecord: VaultDocument) {
        if (documentRecord.fileType === 'folder' && documentRecord.isFolderRecord) {
          await updateFolderRecord(documentRecord.id, { isFavorite: !documentRecord.isFavorite })
        } else {
          await updateDocumentRecord(documentRecord.id, { isFavorite: !documentRecord.isFavorite })
        }
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
          if (record.fileType === 'folder' && record.isFolderRecord) {
            await updateFolderRecord(record.id, { isDeleted: true })
          } else {
            await updateDocumentRecord(record.id, { isDeleted: true })
          }
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
          if (record.fileType === 'folder' && record.isFolderRecord) {
            await updateFolderRecord(record.id, { isDeleted: false })
          } else {
            await updateDocumentRecord(record.id, { isDeleted: false })
          }
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
          if (record.fileType === 'folder' && record.isFolderRecord) {
            await deleteFolderRecord(record.id)
          } else {
            await deleteDocumentRecord(record.id)
          }
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

async function ensureUserVaultFolder(user: VaultUser, accessToken: string) {
  const profile = await getUserProfile(user.uid)

  if (profile?.driveFolderId) {
    return { id: profile.driveFolderId, name: 'Document Vault' }
  }

  const rootFolder = await ensureVaultFolder(accessToken)
  await updateUserDriveConnection(user.uid, rootFolder.id)
  return rootFolder
}

export function filterAndSortDocuments(
  documents: VaultDocument[],
  search: string,
  sortMode: SortMode,
  category: DocumentCategory | 'All',
  currentFolderId: string | null = null,
) {
  const normalizedSearch = search.trim().toLowerCase()
  const descendantIds = currentFolderId ? collectDescendantFolderIds(documents, currentFolderId) : new Set<string>()
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

    if (currentFolderId) {
      const parentId = documentRecord.parentId ?? null
      if (documentRecord.id !== currentFolderId && parentId !== currentFolderId && !descendantIds.has(parentId ?? '')) {
        return false
      }
    }

    return [
      documentRecord.name,
      documentRecord.originalName,
      documentRecord.category,
      documentRecord.description,
      documentRecord.fileType,
      documentRecord.mimeType,
      documentRecord.folderPath,
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

async function ensureFirestoreFolder(
  ownerId: string,
  accessToken: string,
  documents: VaultDocument[],
  folderName: string,
  parentFolderId: string | null,
  driveParentId: string,
) {
  const existingFolder = documents.find(
    (documentRecord) =>
      documentRecord.fileType === 'folder' &&
      documentRecord.name.toLowerCase() === folderName.toLowerCase() &&
      (documentRecord.parentId ?? null) === parentFolderId,
  )
  if (existingFolder) return existingFolder

  const storedFolder = await findFolderRecord(ownerId, folderName, parentFolderId)
  if (storedFolder) {
    return {
      id: storedFolder.id,
      ownerId: storedFolder.ownerId,
      name: storedFolder.name,
      originalName: storedFolder.name,
      mimeType: 'application/vnd.google-apps.folder',
      fileType: 'folder' as const,
      fileSize: 0,
      category: 'Other' as DocumentCategory,
      description: '',
      driveFileId: storedFolder.driveFolderId,
      driveFolderId: storedFolder.driveFolderId,
      isFavorite: storedFolder.isFavorite,
      isDeleted: storedFolder.isDeleted,
      createdAt: storedFolder.createdAt,
      uploadedAt: storedFolder.createdAt,
      updatedAt: storedFolder.updatedAt,
      parentId: storedFolder.parentFolderId,
      folderId: storedFolder.parentFolderId,
      isFolderRecord: true,
    }
  }

  const driveFolder = await ensureDriveFolder(accessToken, folderName, driveParentId)
  const folderRef = await createFolderRecord({
    ownerId,
    name: folderName,
    parentFolderId,
    driveFolderId: driveFolder.id,
  })

  const now = {
    toDate: () => new Date(),
    toMillis: () => Date.now(),
  }

  return {
    id: folderRef.id,
    ownerId,
    name: folderName,
    originalName: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    fileType: 'folder' as const,
    fileSize: 0,
    category: 'Other' as DocumentCategory,
    description: '',
    driveFileId: driveFolder.id,
    driveFolderId: driveFolder.id,
    isFavorite: false,
    isDeleted: false,
    createdAt: now,
    uploadedAt: now,
    updatedAt: now,
    parentId: parentFolderId,
    folderId: parentFolderId,
    isFolderRecord: true,
  }
}

function buildFolderPath(documents: VaultDocument[], folderId: string | null) {
  const names: string[] = []
  let current = folderId ? documents.find((documentRecord) => documentRecord.id === folderId) : undefined
  while (current) {
    names.unshift(current.name)
    current = current.parentId ? documents.find((documentRecord) => documentRecord.id === current?.parentId) : undefined
  }
  return names.join(' / ')
}

function collectDescendantFolderIds(documents: VaultDocument[], folderId: string) {
  const descendantIds = new Set<string>()
  const visit = (parentId: string) => {
    documents
      .filter((documentRecord) => documentRecord.fileType === 'folder' && (documentRecord.parentId ?? null) === parentId)
      .forEach((folder) => {
        descendantIds.add(folder.id)
        visit(folder.id)
      })
  }
  visit(folderId)
  return descendantIds
}
