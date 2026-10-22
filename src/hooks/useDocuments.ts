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
  copyDriveFile,
  deleteDriveFile,
  deleteDriveRevision,
  downloadDriveRevision,
  type DriveRevision,
  ensureDriveFolder,
  ensureVaultFolder,
  GoogleDriveError,
  isDriveAuthorizationError,
  listAppFileStates,
  renameDriveFile,
  restoreDriveFile,
  trashDriveFile,
  uploadFileToDrive,
  moveDriveFile,
  listDriveRevisions,
  setRevisionKeepForever,
  updateDriveFileContent,
} from '../services/googleDrive'
import { ensureCacheMatchesVersion } from '../services/documentViewer'
import { copyIndexedContent, queueContentIndex } from '../services/contentIndex'
import { enqueuePreview } from '../services/previewQueue'
import { copyFileName, sha256Hex } from '../utils/fileHash'
import type { DocumentCategory, NewDocumentMetadata, SortMode, VaultDocument } from '../types/document'
import type { VaultUser } from '../types/user'
import { getDocumentKind, normalizeRelativePath, renamedFileName, stripExtension } from '../utils/fileUtils'
import { getUserProfile, updateUserDriveConnection } from '../services/users'
import { matchesSearch } from '../utils/sorting'

interface UploadOptions {
  category: DocumentCategory
  description: string
}

interface VersionUploadOptions {
  signal?: AbortSignal
  onProgress?: (loaded: number, total: number) => void
}

// Drive keeps at most 200 pinned versions of a file; pinning more fails.
const MAX_PINNED_REVISIONS = 200

// Session-level cache: prevents duplicate folder creation across sequential uploads in one batch.
// Key = `ownerId|parentVaultId|folderNameLower`, Value = the created/found folder record.
const folderSessionCache = new Map<string, { id: string; driveFileId: string; name: string }>()

export function clearFolderSessionCache() {
  folderSessionCache.clear()
}

export function useDocuments(user: VaultUser | null, accessToken: string | null) {
  const [documents, setDocuments] = useState<VaultDocument[]>([])
  const [loading, setLoading] = useState(true)
  // True once the list came from the server, not a possibly partial local copy.
  const [libraryComplete, setLibraryComplete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) {
      return undefined
    }

    return listenToUserLibrary(
      user.uid,
      (nextDocuments, complete) => {
        setDocuments(nextDocuments)
        setLibraryComplete(complete)
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
  const driveListingRef = useRef<{ token: string; states: Promise<Map<string, { trashed: boolean }> | null> } | null>(null)

  // Checks once per session that each file still exists in Drive. A file Drive
  // no longer has is flagged `driveMissing`, never deleted: its metadata may be
  // the only record of what was lost, and a 404 can be temporary.
  useEffect(() => {
    if (!accessToken || documents.length === 0) return

    const validated = validatedIdsRef.current
    const toValidate = documents.filter((doc) => !validated.has(doc.id) && doc.fileType !== 'folder')
    if (toValidate.length === 0) return
    toValidate.forEach((doc) => validated.add(doc.id))

    // One listing per thousand files; null when it fails, so each file is then checked on its own.
    if (driveListingRef.current?.token !== accessToken) {
      driveListingRef.current = {
        token: accessToken,
        states: listAppFileStates(accessToken).catch((listingError: unknown) => {
          console.warn('Drive listing failed; checking files one by one.', listingError)
          return null
        }),
      }
    }
    const listing = driveListingRef.current.states

    let cancelled = false
    let nextIndex = 0
    const validationConcurrency = 2

    const stateOf = async (record: VaultDocument) => {
      const listed = (await listing)?.get(record.driveFileId)
      if (listed) return { exists: true, trashed: listed.trashed }
      // Not in the listing: confirm with a direct lookup before believing it is gone.
      return checkFileExists(accessToken, record.driveFileId)
    }

    const validateNext = async () => {
      while (!cancelled) {
        const record = toValidate[nextIndex++]
        if (!record) return
        try {
          const result = await stateOf(record)
          if (cancelled) return
          if (!result.exists) {
            // Uploads can take a moment to appear; recent records are left alone.
            const createdMillis = record.uploadedAt?.toMillis() ?? record.createdAt?.toMillis() ?? 0
            if (createdMillis > 0 && Date.now() - createdMillis < 5 * 60 * 1000) continue
            if (!record.driveMissing) {
              console.warn(`File ${record.name} is no longer in Google Drive. Marking it as missing.`)
              await updateDocumentRecord(record.id, { driveMissing: true })
            }
            continue
          }
          const changes: Partial<VaultDocument> = {}
          if (record.driveMissing) changes.driveMissing = false
          // Keep the vault's trash state in step with Drive's.
          if (result.trashed !== undefined && result.trashed !== record.isDeleted) changes.isDeleted = result.trashed
          if (Object.keys(changes).length > 0) await updateDocumentRecord(record.id, changes)
        } catch (validationError) {
          console.warn('Drive existence validation failed:', record.name, validationError)
        }
      }
    }

    void Promise.all(Array.from({ length: Math.min(validationConcurrency, toValidate.length) }, validateNext))
    return () => {
      cancelled = true
      // Each update re-renders with new documents and cancels this run; the
      // records it had not reached yet are checked by the next run.
      for (const record of toValidate.slice(nextIndex)) validated.delete(record.id)
    }
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
          // Check the session cache first to avoid duplicate Firestore/Drive calls
          const cacheKey = `${user.uid}|${currentParentId ?? 'root'}|${folderName.toLowerCase()}`
          const cached = folderSessionCache.get(cacheKey)

          let folderRecord: { id: string; driveFileId: string; name: string }
          if (cached) {
            folderRecord = cached
          } else {
            const created = await ensureFirestoreFolder(
              user.uid,
              accessToken,
              documents,
              folderName,
              currentParentId,
              currentDriveParentId,
            )
            folderRecord = { id: created.id, driveFileId: created.driveFileId, name: created.name }
            folderSessionCache.set(cacheKey, folderRecord)
          }

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
        if (documentRecord.fileType === 'folder' && documentRecord.isFolderRecord) {
          await renameDriveFile(accessToken, documentRecord.driveFileId, nextName)
          await updateFolderRecord(documentRecord.id, { name: nextName })
        } else {
          // Drive keeps the extension, so the file still opens with the right app there.
          const fileName = renamedFileName(nextName, documentRecord.originalName)
          await renameDriveFile(accessToken, documentRecord.driveFileId, fileName)
          await updateDocumentRecord(documentRecord.id, { name: stripExtension(fileName), originalName: fileName })
        }
      },
      async updateDetails(documentRecord: VaultDocument, details: Pick<VaultDocument, 'category' | 'description' | 'tags'>) {
        await updateDocumentRecord(documentRecord.id, details)
      },
      /** Copies a file into the same folder as "Name (copy).ext", with the same details. */
      async copy(documentRecord: VaultDocument) {
        if (!user || !accessToken) throw new Error('Please reconnect Google Drive before copying.')
        if (documentRecord.fileType === 'folder') throw new Error('Folders cannot be copied.')
        const siblings = documents.filter((d) => (d.parentId ?? null) === (documentRecord.parentId ?? null) && !d.isDeleted)
        const fileName = copyFileName(documentRecord.originalName || documentRecord.name, siblings.map((d) => d.originalName || d.name))
        const driveFile = await copyDriveFile(accessToken, documentRecord.driveFileId, fileName, documentRecord.driveFolderId || undefined)
        const metadata: NewDocumentMetadata = {
          ownerId: user.uid,
          name: stripExtension(fileName),
          originalName: fileName,
          mimeType: documentRecord.mimeType || driveFile.mimeType,
          fileType: documentRecord.fileType,
          fileSize: documentRecord.fileSize,
          category: documentRecord.category,
          description: documentRecord.description ?? '',
          driveFileId: driveFile.id,
          driveFolderId: documentRecord.driveFolderId,
          parentId: documentRecord.parentId ?? null,
          folderId: documentRecord.parentId ?? null,
          folderPath: documentRecord.folderPath ?? '',
          tags: documentRecord.tags,
          contentHash: documentRecord.contentHash,
          driveWebViewLink: driveFile.webViewLink,
          thumbnailUrl: driveFile.thumbnailLink,
        }
        const ref = await createDocumentRecord(metadata)
        void copyIndexedContent(documentRecord.id, ref.id)
        return fileName
      },
      /**
       * Replaces a file's contents with a new version. The version being
       * replaced is pinned first, so Drive keeps it instead of deleting it after
       * 30 days, and stays available in Version history.
       */
      async uploadNewVersion(documentRecord: VaultDocument, file: File, options: VersionUploadOptions = {}) {
        if (!accessToken) throw new Error('Please reconnect Google Drive before uploading a new version.')
        if (documentRecord.fileType === 'folder') throw new Error('Folders do not have versions.')
        const fileId = documentRecord.driveFileId

        try {
          const revisions = await listDriveRevisions(accessToken, fileId)
          const current = revisions[revisions.length - 1]
          if (current && !current.keepForever) {
            const pinned = revisions.filter((revision) => revision.keepForever)
            // At Drive's limit, the oldest pinned version is released (Drive deletes it after 30 days).
            if (pinned.length >= MAX_PINNED_REVISIONS - 1) await setRevisionKeepForever(accessToken, fileId, pinned[0].id, false)
            await setRevisionKeepForever(accessToken, fileId, current.id, true)
          }
        } catch (pinError) {
          // Unpinned, the old version is still kept for 30 days, so the upload goes ahead.
          if (isDriveAuthorizationError(pinError)) throw pinError
          console.warn('Could not pin the current version before replacing it:', pinError)
        }

        const contentHash = await sha256Hex(file)
        const fileName = renamedFileName(documentRecord.name, file.name)
        const driveFile = await updateDriveFileContent(accessToken, fileId, file, { name: fileName, ...options })
        const version = (documentRecord.version ?? 1) + 1
        await updateDocumentRecord(documentRecord.id, {
          originalName: fileName,
          mimeType: file.type || driveFile.mimeType,
          fileType: getDocumentKind(file),
          fileSize: file.size,
          contentHash: contentHash ?? undefined,
          version,
          thumbnailUrl: driveFile.thumbnailLink,
        })
        await ensureCacheMatchesVersion({ driveFileId: fileId, version })
        // The new version's preview is prepared from the file just sent.
        enqueuePreview(
          { ...documentRecord, originalName: fileName, mimeType: file.type || driveFile.mimeType, fileType: getDocumentKind(file), fileSize: file.size, version },
          'upload',
          file,
        )
        queueContentIndex(
          { id: documentRecord.id, name: documentRecord.name, originalName: fileName, mimeType: file.type || driveFile.mimeType, fileType: getDocumentKind(file) },
          file,
          { force: true },
        )
      },
      async listVersions(documentRecord: VaultDocument) {
        if (!accessToken) throw new Error('Please reconnect Google Drive to see versions.')
        return listDriveRevisions(accessToken, documentRecord.driveFileId)
      },
      async downloadVersion(documentRecord: VaultDocument, revision: DriveRevision) {
        if (!accessToken) throw new Error('Please reconnect Google Drive before downloading.')
        return downloadDriveRevision(accessToken, documentRecord.driveFileId, revision.id)
      },
      /** Makes an earlier version current again by saving it as the newest version; nothing is lost. */
      async restoreVersion(documentRecord: VaultDocument, revision: DriveRevision) {
        if (!accessToken) throw new Error('Please reconnect Google Drive before restoring a version.')
        const blob = await downloadDriveRevision(accessToken, documentRecord.driveFileId, revision.id)
        const name = revision.originalFilename || documentRecord.originalName
        const file = new File([blob], name, { type: revision.mimeType || blob.type || documentRecord.mimeType })
        await this.uploadNewVersion(documentRecord, file)
      },
      async deleteVersion(documentRecord: VaultDocument, revision: DriveRevision) {
        if (!accessToken) throw new Error('Please reconnect Google Drive before deleting a version.')
        await deleteDriveRevision(accessToken, documentRecord.driveFileId, revision.id)
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
          await safeDeleteDriveFile(accessToken, record.driveFileId)
          await deleteVaultRecordMetadata(record)
        }

        await recursiveDelete(documentRecord)
      },
      async viewed(documentRecord: VaultDocument) {
        await markDocumentViewed(documentRecord.id)
      },
      async moveItem(documentRecord: VaultDocument, destinationFolderId: string | null) {
        if (!user || !accessToken) {
          throw new Error('Please reconnect Google Drive before moving documents.')
        }

        // Validate circular reference
        if (documentRecord.fileType === 'folder') {
          if (documentRecord.id === destinationFolderId) {
            throw new Error('Cannot move a folder into itself.')
          }
          const descendants = collectDescendantFolderIds(documents, documentRecord.id)
          if (destinationFolderId && descendants.has(destinationFolderId)) {
            throw new Error('Cannot move a folder into one of its descendants.')
          }
        }

        // Get target Drive folder ID
        let destinationDriveFolderId: string
        let targetFolderPath = ''
        if (destinationFolderId) {
          const destFolder = documents.find((d) => d.id === destinationFolderId)
          if (!destFolder) throw new Error('Destination folder not found.')
          destinationDriveFolderId = destFolder.driveFileId
          targetFolderPath = buildFolderPath(documents, destinationFolderId)
        } else {
          const rootFolder = await ensureUserVaultFolder(user, accessToken)
          destinationDriveFolderId = rootFolder.id
        }

        // Move in Google Drive
        const oldDriveParentId = documentRecord.driveFolderId
        if (oldDriveParentId !== destinationDriveFolderId) {
          await moveDriveFile(accessToken, documentRecord.driveFileId, destinationDriveFolderId, oldDriveParentId)
        }

        // Update in Firestore
        if (documentRecord.fileType === 'folder' && documentRecord.isFolderRecord) {
          await updateFolderRecord(documentRecord.id, {
            parentFolderId: destinationFolderId,
          })
          
          // Helper to recursively update nested documents' paths
          const updateDescendantPaths = async (parentId: string, currentPath: string) => {
            const children = documents.filter((d) => d.parentId === parentId)
            for (const child of children) {
              if (child.fileType === 'folder') {
                const subPath = currentPath ? `${currentPath} / ${child.name}` : child.name
                await updateDescendantPaths(child.id, subPath)
              } else {
                await updateDocumentRecord(child.id, { folderPath: currentPath })
              }
            }
          }

          const folderNamePath = targetFolderPath ? `${targetFolderPath} / ${documentRecord.name}` : documentRecord.name
          await updateDescendantPaths(documentRecord.id, folderNamePath)
        } else {
          await updateDocumentRecord(documentRecord.id, {
            parentId: destinationFolderId,
            folderId: destinationFolderId,
            driveFolderId: destinationDriveFolderId,
            folderPath: targetFolderPath,
          })
        }
      },
      async moveItems(itemsToMove: VaultDocument[], destinationFolderId: string | null) {
        for (const item of itemsToMove) {
          await this.moveItem(item, destinationFolderId)
        }
      },
    }),
    [user, accessToken, documents],
  )

  return { documents, loading, libraryComplete, error, actions }
}

async function safeDeleteDriveFile(accessToken: string, driveFileId: string) {
  try {
    await deleteDriveFile(accessToken, driveFileId)
  } catch (error) {
    if (error instanceof GoogleDriveError && error.status === 404) {
      return
    }
    throw error
  }
}

async function deleteVaultRecordMetadata(record: VaultDocument) {
  await retryFirestoreDelete(async () => {
    if (record.fileType === 'folder' && record.isFolderRecord) {
      await deleteFolderRecord(record.id)
    } else {
      await deleteDocumentRecord(record.id)
    }
  })
}

async function retryFirestoreDelete(deleteMetadata: () => Promise<void>) {
  let lastError: unknown

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await deleteMetadata()
      return
    } catch (error) {
      lastError = error
      if (!isRetryableFirestoreDeleteError(error) || attempt === 3) break
      await delay(400 * 2 ** (attempt - 1))
    }
  }

  throw lastError
}

function isRetryableFirestoreDeleteError(error: unknown) {
  if (!(error instanceof Error)) return false
  const code = 'code' in error ? String(error.code) : ''
  return (
    code === 'unavailable' ||
    code === 'deadline-exceeded' ||
    code === 'aborted' ||
    /network|timeout|offline|unavailable|deadline/i.test(error.message)
  )
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
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
  const searching = search.trim().length > 0
  const descendantIds = currentFolderId ? collectDescendantFolderIds(documents, currentFolderId) : new Set<string>()
  const filtered = documents.filter((documentRecord) => {
    // 1. Filter by parentId hierarchy if not searching
    if (!searching) {
      const pId = documentRecord.parentId ?? null
      if (pId !== currentFolderId) {
        return false
      }
    }

    // 2. Filter by category (folders are exempt from category filter so they are always visible)
    if (category !== 'All' && documentRecord.category !== category && documentRecord.fileType !== 'folder') {
      return false
    }

    if (!searching) return true

    if (currentFolderId) {
      const parentId = documentRecord.parentId ?? null
      if (documentRecord.id !== currentFolderId && parentId !== currentFolderId && !descendantIds.has(parentId ?? '')) {
        return false
      }
    }

    return matchesSearch(documentRecord, search)
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
  // 1. Check the live React state snapshot first (already-synced folders from previous sessions)
  const existingFolder = documents.find(
    (documentRecord) =>
      documentRecord.fileType === 'folder' &&
      !documentRecord.isDeleted &&
      documentRecord.name.toLowerCase() === folderName.toLowerCase() &&
      (documentRecord.parentId ?? null) === parentFolderId,
  )
  if (existingFolder) return existingFolder

  // 2. Skip the Firestore multi-field query (requires a composite index that may not exist).
  //    The session cache in uploadWithRelativePath already deduplicates within a batch.
  //    Just create the Drive folder (ensureDriveFolder is idempotent — it checks before creating),
  //    then write the Firestore record.
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

export function collectDescendantFolderIds(documents: VaultDocument[], folderId: string) {
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
