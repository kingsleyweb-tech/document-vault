/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import type { VaultDocument } from '../types/document'
import { deleteDriveFile, GoogleDriveError } from '../services/googleDrive'
import { deleteDocumentRecord, deleteFolderRecord, updateDocumentRecord, updateFolderRecord } from '../services/firestore'

export interface DeleteQueueStats {
  total: number
  completed: number
  running: boolean
  currentItemName: string
  mode: 'trash' | 'permanent'
}

interface DeleteQueueContextValue {
  stats: DeleteQueueStats
  enqueueDelete: (
    items: VaultDocument[],
    mode: 'trash' | 'permanent',
    accessToken?: string | null,
    allDocuments?: VaultDocument[]
  ) => Promise<void>
}

const DeleteQueueContext = createContext<DeleteQueueContextValue | null>(null)

export function DeleteQueueProvider({ children }: { children: ReactNode }) {
  const [stats, setStats] = useState<DeleteQueueStats>({
    total: 0,
    completed: 0,
    running: false,
    currentItemName: '',
    mode: 'trash',
  })

  const enqueueDelete = useCallback(
    async (
      items: VaultDocument[],
      mode: 'trash' | 'permanent',
      accessToken?: string | null,
      allDocuments: VaultDocument[] = []
    ) => {
      if (!items || items.length === 0) return

      // Flatten/expand folders recursively if permanent deletion is requested
      const expandItems = (docList: VaultDocument[]): VaultDocument[] => {
        const result: VaultDocument[] = []
        const visited = new Set<string>()

        const visit = (doc: VaultDocument) => {
          if (visited.has(doc.id)) return
          visited.add(doc.id)
          result.push(doc)

          if (doc.fileType === 'folder') {
            const children = allDocuments.filter((d) => d.parentId === doc.id)
            children.forEach(visit)
          }
        }

        docList.forEach(visit)
        return result
      }

      const targetList = mode === 'permanent' ? expandItems(items) : items

      setStats({
        total: targetList.length,
        completed: 0,
        running: true,
        currentItemName: targetList[0]?.name || '',
        mode,
      })

      // Execute background deletion item by item
      for (let i = 0; i < targetList.length; i++) {
        const record = targetList[i]
        setStats((prev) => ({
          ...prev,
          completed: i,
          currentItemName: record.name,
        }))

        try {
          if (mode === 'trash') {
            // Move to trash (isDeleted: true) in Firestore
            if (record.fileType === 'folder' && record.isFolderRecord) {
              await updateFolderRecord(record.id, { isDeleted: true })
            } else {
              await updateDocumentRecord(record.id, { isDeleted: true })
            }
          } else {
            // Permanent delete: Google Drive API + Firestore
            if (accessToken && record.driveFileId) {
              try {
                await deleteDriveFile(accessToken, record.driveFileId)
              } catch (err) {
                if (!(err instanceof GoogleDriveError && err.status === 404)) {
                  console.error(`Google Drive delete error for ${record.name}:`, err)
                }
              }
            }

            if (record.fileType === 'folder' && record.isFolderRecord) {
              await deleteFolderRecord(record.id)
            } else {
              await deleteDocumentRecord(record.id)
            }
          }
        } catch (err) {
          console.error(`Failed to ${mode} record ${record.name}:`, err)
        }
      }

      setStats((prev) => ({
        ...prev,
        completed: targetList.length,
        running: false,
        currentItemName: '',
      }))

      // Auto-reset state after 3 seconds
      setTimeout(() => {
        setStats({ total: 0, completed: 0, running: false, currentItemName: '', mode: 'trash' })
      }, 3000)
    },
    []
  )

  return (
    <DeleteQueueContext.Provider value={{ stats, enqueueDelete }}>
      {children}
    </DeleteQueueContext.Provider>
  )
}

export function useDeleteQueue() {
  const context = useContext(DeleteQueueContext)
  if (!context) {
    throw new Error('useDeleteQueue must be used within a DeleteQueueProvider')
  }
  return context
}
