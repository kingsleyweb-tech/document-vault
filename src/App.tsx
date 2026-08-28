import { useEffect, useMemo, useState } from 'react'
import { HashRouter, Navigate, Route, Routes, useMatch } from 'react-router-dom'
import { UploadDialog } from './components/documents/UploadDialog'
import { AppLayout } from './components/layout/AppLayout'
import { DocumentViewer } from './components/viewer/DocumentViewer'
import { useAuth } from './hooks/useAuth'
import { useDocuments, collectDescendantFolderIds } from './hooks/useDocuments'
import { UploadQueueProvider, useUploadQueue } from './hooks/useUploadQueue'
import { Categories } from './pages/Categories'
import { Login } from './pages/Login'
import { Settings } from './pages/Settings'
import { VaultPage } from './pages/VaultPage'
import { AllFiles } from './pages/AllFiles'
import { AllFolders } from './pages/AllFolders'
import { FolderTreePicker } from './components/documents/FolderTreePicker'
import { ProtectedRoute } from './routes/ProtectedRoute'
import { logout, reconnectGoogleDrive, clearDriveAccessToken } from './services/auth'
import { downloadDriveFile, isDriveAuthorizationError } from './services/googleDrive'
import { buildDownloadName } from './services/documentViewer'
import type { DocumentCategory, SortMode, ThemeMode, VaultDocument, ViewMode } from './types/document'
import './App.css'

const categories: DocumentCategory[] = [
  'Personal',
  'School',
  'Military',
  'Work',
  'Certificates',
  'Reports',
  'Other',
]

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/*" element={<AuthenticatedVault />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

function AuthenticatedVault() {
  const { user, driveAccessToken } = useAuth()
  const accessToken = driveAccessToken
  const { documents, loading, error, actions } = useDocuments(user, accessToken)

  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return (localStorage.getItem('documentVault.viewMode') as ViewMode | null) ?? 'grid'
  })
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    return (localStorage.getItem('documentVault.sortMode') as SortMode | null) ?? 'newest'
  })
  const [category, setCategory] = useState<DocumentCategory | 'All'>(() => {
    return (localStorage.getItem('documentVault.category') as DocumentCategory | 'All' | null) ?? 'All'
  })
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    return (localStorage.getItem('documentVault.theme') as ThemeMode | null) ?? 'light'
  })
  const [uploadOpen, setUploadOpen] = useState(false)
  const [viewerDocument, setViewerDocument] = useState<VaultDocument | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [showDriveAuthModal, setShowDriveAuthModal] = useState(false)
  const [dismissedPausedAuthModal, setDismissedPausedAuthModal] = useState(false)
  const [operationLabel, setOperationLabel] = useState<string | null>(null)

  const [renameOpen, setRenameOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<VaultDocument | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const [folderModalOpen, setFolderModalOpen] = useState(false)
  const [folderNameValue, setFolderNameValue] = useState('')

  const [confirmTrashOpen, setConfirmTrashOpen] = useState(false)
  const [confirmTrashTarget, setConfirmTrashTarget] = useState<VaultDocument | null>(null)

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<VaultDocument | null>(null)
  const [bulkPermanentDeleteOpen, setBulkPermanentDeleteOpen] = useState(false)
  const [bulkPermanentDeleteItems, setBulkPermanentDeleteItems] = useState<VaultDocument[]>([])

  const [uploadChoiceOpen, setUploadChoiceOpen] = useState(false)
  const [newFolderUploadOpen, setNewFolderUploadOpen] = useState(false)
  const [uploadNewFolderName, setUploadNewFolderName] = useState('')
  const [uploadDestinationFolderId, setUploadDestinationFolderId] = useState<string | null>(null)

  const [bulkMoveOpen, setBulkMoveOpen] = useState(false)
  const [bulkMoveItems, setBulkMoveItems] = useState<VaultDocument[]>([])

  const [bulkTrashOpen, setBulkTrashOpen] = useState(false)
  const [bulkTrashItems, setBulkTrashItems] = useState<VaultDocument[]>([])

  const [individualMoveOpen, setIndividualMoveOpen] = useState(false)
  const [individualMoveTarget, setIndividualMoveTarget] = useState<VaultDocument | null>(null)

  const [toasts, setToasts] = useState<Array<{ id: string; message: string; type: 'success' | 'error' | 'info' }>>([])

  const addToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = crypto.randomUUID()
    setToasts((current) => [...current, { id, message, type }])
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id))
    }, 4000)
  }

  const uploadDestinationFolder = useMemo(() => {
    return documents.find((d) => d.id === uploadDestinationFolderId)
  }, [documents, uploadDestinationFolderId])

  const handleUploadClick = () => {
    setUploadDestinationFolderId(currentFolderId)
    setUploadChoiceOpen(true)
  }

  const handleUploadProgressClick = () => {
    setDismissedPausedAuthModal(false)
    setUploadChoiceOpen(false)
    setNewFolderUploadOpen(false)
    setUploadDestinationFolderId((currentDestination) => currentDestination ?? currentFolderId)
    setUploadOpen(true)
  }



  const folderMatch = useMatch('/folders/:folderId')
  const currentFolderId = folderMatch?.params.folderId ?? null

  const currentFolder = useMemo(() => {
    return documents.find((d) => d.id === currentFolderId)
  }, [documents, currentFolderId])

  const folderPath = useMemo(() => {
    const path: VaultDocument[] = []
    let current = documents.find((d) => d.id === currentFolderId)
    while (current) {
      path.unshift(current)
      const parentId = current.parentId
      current = parentId ? documents.find((d) => d.id === parentId) : undefined
    }
    return path
  }, [documents, currentFolderId])

  useEffect(() => {
    localStorage.setItem('documentVault.viewMode', viewMode)
  }, [viewMode])

  useEffect(() => {
    localStorage.setItem('documentVault.sortMode', sortMode)
  }, [sortMode])

  useEffect(() => {
    localStorage.setItem('documentVault.category', category)
  }, [category])

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
    localStorage.setItem('documentVault.theme', themeMode)
  }, [themeMode])

  const activeDocuments = useMemo(
    () => documents.filter((documentRecord) => !documentRecord.isDeleted),
    [documents],
  )
  const trashDocuments = useMemo(
    () => documents.filter((documentRecord) => documentRecord.isDeleted),
    [documents],
  )
  const favoriteDocuments = useMemo(
    () => activeDocuments.filter((documentRecord) => documentRecord.isFavorite),
    [activeDocuments],
  )
  const recentDocuments = useMemo(
    () =>
      [...activeDocuments].sort((first, second) => {
        const firstDate = first.lastViewedAt ?? first.updatedAt ?? first.uploadedAt
        const secondDate = second.lastViewedAt ?? second.updatedAt ?? second.uploadedAt
        return secondDate.toMillis() - firstDate.toMillis()
      }),
    [activeDocuments],
  )

  if (!user) {
    return null
  }

  async function withFriendlyErrors(task: () => Promise<void>, label?: string) {
    try {
      setOperationError(null)
      if (label) setOperationLabel(label)
      await task()
    } catch (caughtError) {
      console.error(caughtError)
      if (isDriveAuthorizationError(caughtError)) {
        clearDriveAccessToken()
        setShowDriveAuthModal(true)
      } else if (caughtError instanceof Error && (caughtError.message.includes('authorization') || caughtError.message.includes('permission') || caughtError.message.includes('reconnect'))) {
        clearDriveAccessToken()
        setShowDriveAuthModal(true)
      }
      setOperationError(getOperationErrorMessage(caughtError))
    } finally {
      if (label) setOperationLabel(null)
    }
  }

  async function ensureAccessToken() {
    if (accessToken) return accessToken
    setShowDriveAuthModal(true)
    throw new Error('Google Drive authorization is required.')
  }

  async function reconnectDrive() {
    await withFriendlyErrors(async () => {
      await reconnectGoogleDrive()
      setShowDriveAuthModal(true)
    }, 'Reconnecting Google Drive...')
  }

  async function downloadDocument(documentRecord: VaultDocument) {
    await withFriendlyErrors(async () => {
      const token = await ensureAccessToken()
      const blob = await downloadDriveFile(token, documentRecord.driveFileId, documentRecord.mimeType)
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      link.href = url
      link.download = buildDownloadName(documentRecord)
      document.body.append(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    })
  }

  function renameDocument(documentRecord: VaultDocument) {
    setRenameTarget(documentRecord)
    setRenameValue(documentRecord.name)
    setRenameOpen(true)
  }

  function createNewFolder() {
    setFolderNameValue('')
    setFolderModalOpen(true)
  }

  const handleBulkTrash = (items: VaultDocument[]) => {
    setBulkTrashItems(items)
    setBulkTrashOpen(true)
  }

  const handleBulkMove = (items: VaultDocument[]) => {
    setBulkMoveItems(items)
    setBulkMoveOpen(true)
  }

  const handleBulkFavorite = async (items: VaultDocument[]) => {
    await withFriendlyErrors(async () => {
      for (const item of items) {
        await actions.toggleFavorite(item)
      }
      addToast(`Updated favorites for ${items.length} items.`, 'success')
    }, 'Updating favorites...')
  }

  const handleBulkDownload = async (items: VaultDocument[]) => {
    const filesToDownload = items.filter((i) => i.fileType !== 'folder')
    if (filesToDownload.length === 0) {
      addToast('No files to download (folders cannot be downloaded directly).', 'info')
      return
    }

    addToast(`Starting download for ${filesToDownload.length} files...`, 'info')
    let successCount = 0
    let failCount = 0

    for (const file of filesToDownload) {
      try {
        const token = await ensureAccessToken()
        const blob = await downloadDriveFile(token, file.driveFileId, file.mimeType)
        const link = document.createElement('a')
        const url = URL.createObjectURL(blob)
        link.href = url
        link.download = buildDownloadName(file)
        document.body.append(link)
        link.click()
        link.remove()
        URL.revokeObjectURL(url)
        successCount++
      } catch (err) {
        console.error('Failed downloading bulk item:', file.name, err)
        failCount++
      }
    }

    if (successCount > 0) {
      addToast(`Downloaded ${successCount} files successfully.`, 'success')
    }
    if (failCount > 0) {
      addToast(`Failed to download ${failCount} files.`, 'error')
    }
  }

  const handleBulkPermanentDelete = (items: VaultDocument[]) => {
    const uniqueItems = getTopLevelSelection(items, documents)
    setBulkPermanentDeleteItems(uniqueItems)
    setBulkPermanentDeleteOpen(true)
  }

  const permanentlyDeleteSelectedTrash = async () => {
    const items = bulkPermanentDeleteItems
    const deleteConcurrency = 5
    let nextIndex = 0
    let successCount = 0
    let failCount = 0

    await withFriendlyErrors(async () => {
      await ensureAccessToken()

      async function worker() {
        for (;;) {
          const item = items[nextIndex++]
          if (!item) return
          try {
            await actions.permanentlyDelete(item)
            successCount += 1
          } catch (deleteError) {
            console.error('Failed permanently deleting trash item:', item.name, deleteError)
            failCount += 1
          }
        }
      }

      await Promise.all(Array.from({ length: Math.min(deleteConcurrency, items.length) }, worker))

      if (successCount > 0) {
        addToast(`Permanently deleted ${successCount} ${successCount === 1 ? 'item' : 'items'}.`, 'success')
      }
      if (failCount > 0) {
        addToast(`Could not delete ${failCount} ${failCount === 1 ? 'item' : 'items'}.`, 'error')
      }
    }, `Deleting ${items.length} ${items.length === 1 ? 'item' : 'items'} permanently...`)

    setBulkPermanentDeleteOpen(false)
    setBulkPermanentDeleteItems([])
  }

  const commonPageProps = {
    loading,
    error: operationError ?? error,
    accessToken,
    search,
    viewMode,
    sortMode,
    category,
    categories,
    currentUser: user,
    onViewModeChange: setViewMode,
    onSortModeChange: setSortMode,
    onCategoryChange: setCategory,
    onUploadClick: handleUploadClick,
    onView: (documentRecord: VaultDocument) => {
      void withFriendlyErrors(async () => {
        await ensureAccessToken()
        await actions.viewed(documentRecord)
        setViewerDocument(documentRecord)
      })
    },
    onDownload: (documentRecord: VaultDocument) => void downloadDocument(documentRecord),
    onRename: renameDocument,
    onCreateFolder: createNewFolder,
    currentFolderId,
    folderPath,
    onFavorite: (documentRecord: VaultDocument) =>
      void withFriendlyErrors(() => actions.toggleFavorite(documentRecord)),
    onTrash: (documentRecord: VaultDocument) => {
      setConfirmTrashTarget(documentRecord)
      setConfirmTrashOpen(true)
    },
    onRestore: (documentRecord: VaultDocument) =>
      void withFriendlyErrors(async () => {
        await ensureAccessToken()
        await actions.restore(documentRecord)
      }),
    onPermanentDelete: (documentRecord: VaultDocument) => {
      setConfirmDeleteTarget(documentRecord)
      setConfirmDeleteOpen(true)
    },
    onMove: (documentRecord: VaultDocument) => {
      setIndividualMoveTarget(documentRecord)
      setIndividualMoveOpen(true)
    },
    onBulkTrash: handleBulkTrash,
    onBulkMove: handleBulkMove,
    onBulkFavorite: handleBulkFavorite,
    onBulkDownload: handleBulkDownload,
    onBulkPermanentDelete: handleBulkPermanentDelete,
  }

  return (
    <UploadQueueProvider user={user} accessToken={accessToken} documents={documents}>
      <DriveAuthManager
        driveConnected={Boolean(accessToken)}
        onReconnectDrive={() => void reconnectDrive()}
        showDriveAuthModal={showDriveAuthModal}
        setShowDriveAuthModal={setShowDriveAuthModal}
        dismissedPausedAuthModal={dismissedPausedAuthModal}
        setDismissedPausedAuthModal={setDismissedPausedAuthModal}
      />
      <AppLayout
        user={user}
        search={search}
        searchPlaceholder={currentFolderId ? 'Search this folder' : 'Search all documents'}
        onSearchChange={setSearch}
        onUploadClick={handleUploadClick}
        onUploadProgressClick={handleUploadProgressClick}
        driveConnected={Boolean(accessToken)}
        onReconnectDrive={() => void reconnectDrive()}
        onLogout={() => void logout()}
        themeMode={themeMode}
        onThemeModeChange={setThemeMode}
      >
      <Routes>
        <Route
          index
          element={
            <VaultPage
              {...commonPageProps}
              title="All documents"
              description="Search, sort, preview, and manage your private document library."
              documents={activeDocuments}
              emptyTitle="Your document vault is empty."
              emptyMessage="Upload your first document to get started."
            />
          }
        />
        <Route
          path="files"
          element={
            <AllFiles
              {...commonPageProps}
              documents={activeDocuments}
              onBulkTrash={handleBulkTrash}
              onBulkMove={handleBulkMove}
              onBulkFavorite={handleBulkFavorite}
              onBulkDownload={handleBulkDownload}
            />
          }
        />
        <Route
          path="folders"
          element={
            <AllFolders
              {...commonPageProps}
              documents={activeDocuments}
            />
          }
        />
        <Route
          path="folders/:folderId"
          element={
            <VaultPage
              {...commonPageProps}
              title={currentFolder?.name ?? 'Folder'}
              description="Review and manage files stored inside this folder."
              documents={activeDocuments}
              emptyTitle="This folder is empty."
              emptyMessage="Upload documents or create subfolders to organize your files."
            />
          }
        />
        <Route
          path="recent"
          element={
            <VaultPage
              {...commonPageProps}
              title="Recent"
              description="Documents you uploaded, viewed, or changed most recently."
              documents={recentDocuments}
              emptyTitle="No recent documents yet."
              emptyMessage="Viewed and updated documents will appear here."
              documentOnly
            />
          }
        />
        <Route
          path="favorites"
          element={
            <VaultPage
              {...commonPageProps}
              title="Favorites"
              description="Keep your most-used documents within easy reach."
              documents={favoriteDocuments}
              emptyTitle="No favorite documents yet."
              emptyMessage="Mark important documents as favorites to find them quickly."
              documentOnly
            />
          }
        />
        <Route
          path="categories"
          element={
            <Categories
              categories={categories}
              documents={activeDocuments}
              onView={(doc) => {
                void withFriendlyErrors(async () => {
                  await ensureAccessToken()
                  await actions.viewed(doc)
                  setViewerDocument(doc)
                })
              }}
              onDownload={(doc) => void downloadDocument(doc)}
              onRename={renameDocument}
              onFavorite={(doc) => void withFriendlyErrors(() => actions.toggleFavorite(doc))}
              onTrash={(doc) => {
                setConfirmTrashTarget(doc)
                setConfirmTrashOpen(true)
              }}
            />
          }
        />
        <Route
          path="trash"
          element={
            <VaultPage
              {...commonPageProps}
              title="Trash"
              description="Restore documents or permanently remove them from Drive and your vault."
              documents={trashDocuments}
              emptyTitle="Your trash is empty."
              emptyMessage="Deleted documents will appear here before permanent removal."
              inTrash
            />
          }
        />
        <Route
          path="settings"
          element={
            <Settings
              themeMode={themeMode}
              viewMode={viewMode}
              sortMode={sortMode}
              category={category}
              categories={categories}
              onThemeModeChange={setThemeMode}
              onViewModeChange={setViewMode}
              onSortModeChange={setSortMode}
              onCategoryChange={setCategory}
              onSearchClear={() => setSearch('')}
              onUploadClick={handleUploadClick}
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <UploadDialog
        open={uploadOpen}
        categories={categories}
        folderName={uploadDestinationFolder?.name || currentFolder?.name}
        destinationFolderId={uploadDestinationFolderId}
        onClose={() => setUploadOpen(false)}
      />

      <DocumentViewer
        documentRecord={viewerDocument}
        documents={activeDocuments}
        accessToken={accessToken}
        onClose={() => setViewerDocument(null)}
        onDownload={(documentRecord) => void downloadDocument(documentRecord)}
        onOpenDocument={(documentRecord) => {
          void withFriendlyErrors(async () => {
            await ensureAccessToken()
            await actions.viewed(documentRecord)
            setViewerDocument(documentRecord)
          })
        }}
        onFavorite={(documentRecord) => void withFriendlyErrors(() => actions.toggleFavorite(documentRecord))}
        onReauthRequired={() => {
          clearDriveAccessToken()
          setShowDriveAuthModal(true)
        }}
      />

      {renameOpen && renameTarget && (
        <div className="dialog-backdrop" role="presentation">
          <section className="prompt-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-title">
            <header>
              <h2 id="rename-title">Rename {renameTarget.fileType === 'folder' ? 'Folder' : 'Document'}</h2>
            </header>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const nextName = renameValue.trim()
                if (nextName && nextName !== renameTarget.name) {
                  void withFriendlyErrors(async () => {
                    await ensureAccessToken()
                    await actions.rename(renameTarget, nextName)
                  })
                }
                setRenameOpen(false)
              }}
            >
              <div className="dialog-body">
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  placeholder="Enter new name"
                  className="dialog-input"
                  aria-label="New name"
                  autoFocus
                />
              </div>
              <footer>
                <button type="button" className="secondary-button" onClick={() => setRenameOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary-button" disabled={!renameValue.trim()}>
                  Save
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {folderModalOpen && (
        <div className="dialog-backdrop" role="presentation">
          <section className="prompt-dialog" role="dialog" aria-modal="true" aria-labelledby="folder-title">
            <header>
              <h2 id="folder-title">New Folder</h2>
            </header>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const name = folderNameValue.trim()
                if (name) {
                  void withFriendlyErrors(async () => {
                    await ensureAccessToken()
                    await actions.createFolder(name, currentFolderId)
                  })
                }
                setFolderModalOpen(false)
              }}
            >
              <div className="dialog-body">
                <input
                  type="text"
                  value={folderNameValue}
                  onChange={(e) => setFolderNameValue(e.target.value)}
                  placeholder="Folder name"
                  className="dialog-input"
                  aria-label="Folder name"
                  autoFocus
                />
              </div>
              <footer>
                <button type="button" className="secondary-button" onClick={() => setFolderModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary-button" disabled={!folderNameValue.trim()}>
                  Create
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
      {confirmTrashOpen && confirmTrashTarget && (
        <div className="dialog-backdrop" role="presentation">
          <section className="prompt-dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-trash-title">
            <header>
              <h2 id="confirm-trash-title">Move to Trash?</h2>
            </header>
            <div className="dialog-body">
              <p style={{ margin: '0 0 8px 0', color: '#475467', fontSize: '14px', lineHeight: '1.5' }}>
                Are you sure you want to move <strong>{confirmTrashTarget.name}</strong> to the trash?
                {confirmTrashTarget.fileType === 'folder' && ' All files and subfolders inside this folder will also be moved to the trash.'}
              </p>
            </div>
            <footer>
              <button type="button" className="secondary-button" onClick={() => setConfirmTrashOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-button danger-button"
                onClick={() => {
                  void withFriendlyErrors(async () => {
                    await ensureAccessToken()
                    await actions.moveToTrash(confirmTrashTarget)
                  }, 'Moving document to trash...')
                  setConfirmTrashOpen(false)
                }}
              >
                Move to Trash
              </button>
            </footer>
          </section>
        </div>
      )}

      {confirmDeleteOpen && confirmDeleteTarget && (
        <div className="dialog-backdrop" role="presentation">
          <section className="prompt-dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-delete-title">
            <header>
              <h2 id="confirm-delete-title" style={{ color: '#d92d20' }}>Delete Permanently?</h2>
            </header>
            <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <p style={{ margin: 0, color: '#b42318', fontSize: '14px', fontWeight: 600 }}>
                Warning: This action is irreversible and cannot be undone.
              </p>
              <p style={{ margin: 0, color: '#475467', fontSize: '14px', lineHeight: '1.5' }}>
                Are you sure you want to permanently delete <strong>{confirmDeleteTarget.name}</strong> from Google Drive and your vault?
                {confirmDeleteTarget.fileType === 'folder' && ' All nested files and subfolders inside this folder will be permanently deleted.'}
              </p>
            </div>
            <footer>
              <button type="button" className="secondary-button" onClick={() => setConfirmDeleteOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-button danger-button"
                onClick={() => {
                  void withFriendlyErrors(async () => {
                    await ensureAccessToken()
                    await actions.permanentlyDelete(confirmDeleteTarget)
                  }, 'Permanently deleting document...')
                  setConfirmDeleteOpen(false)
                }}
              >
                Delete Permanently
              </button>
            </footer>
          </section>
        </div>
      )}
      {bulkPermanentDeleteOpen && bulkPermanentDeleteItems.length > 0 && (
        <div className="dialog-backdrop" role="presentation">
          <section className="prompt-dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="bulk-permanent-delete-title">
            <header>
              <h2 id="bulk-permanent-delete-title" style={{ color: '#d92d20' }}>Delete Permanently?</h2>
            </header>
            <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <p style={{ margin: 0, color: '#b42318', fontSize: '14px', fontWeight: 600 }}>
                Warning: This action is irreversible and cannot be undone.
              </p>
              <p style={{ margin: 0, color: '#475467', fontSize: '14px', lineHeight: '1.5' }}>
                Permanently delete <strong>{bulkPermanentDeleteItems.length} selected {bulkPermanentDeleteItems.length === 1 ? 'item' : 'items'}</strong> from Google Drive and your vault?
                Selected folders include their nested files and subfolders.
              </p>
            </div>
            <footer>
              <button type="button" className="secondary-button" onClick={() => setBulkPermanentDeleteOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-button danger-button"
                onClick={() => {
                  void permanentlyDeleteSelectedTrash()
                }}
              >
                Delete Permanently
              </button>
            </footer>
          </section>
        </div>
      )}
      {uploadChoiceOpen && (
        <div className="dialog-backdrop" role="presentation">
          <section className="prompt-dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="upload-choice-title">
            <header>
              <h2 id="upload-choice-title">Upload Documents</h2>
            </header>
            <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <p style={{ margin: '0 0 4px 0', color: '#475467', fontSize: '14px', lineHeight: '1.4' }}>
                Where would you like to save these files?
              </p>
              <button
                type="button"
                className="choice-card-button"
                onClick={() => {
                  setUploadDestinationFolderId(currentFolderId)
                  setUploadChoiceOpen(false)
                  setUploadOpen(true)
                }}
              >
                <strong>Upload to current location</strong>
                <span>Files will be stored directly in the active folder view.</span>
              </button>
              <button
                type="button"
                className="choice-card-button"
                onClick={() => {
                  setUploadChoiceOpen(false)
                  setNewFolderUploadOpen(true)
                }}
              >
                <strong>Create new folder and upload</strong>
                <span>Creates a new directory first, then places all files inside it.</span>
              </button>
            </div>
            <footer>
              <button type="button" className="secondary-button" onClick={() => setUploadChoiceOpen(false)}>
                Cancel
              </button>
            </footer>
          </section>
        </div>
      )}

      {newFolderUploadOpen && (
        <div className="dialog-backdrop" role="presentation">
          <section className="prompt-dialog" role="dialog" aria-modal="true" aria-labelledby="new-folder-upload-title">
            <header>
              <h2 id="new-folder-upload-title">Create Folder & Upload</h2>
            </header>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const name = uploadNewFolderName.trim()
                if (name) {
                  void withFriendlyErrors(async () => {
                    await ensureAccessToken()
                    const newFolderId = await actions.createFolder(name, currentFolderId)
                    setUploadDestinationFolderId(newFolderId)
                    setUploadNewFolderName('')
                    setNewFolderUploadOpen(false)
                    setUploadOpen(true)
                  })
                }
              }}
            >
              <div className="dialog-body">
                <p style={{ margin: '0 0 12px 0', color: '#475467', fontSize: '13px', lineHeight: '1.4' }}>
                  Provide a name for the new folder. All uploaded files will be placed inside this directory.
                </p>
                <input
                  type="text"
                  value={uploadNewFolderName}
                  onChange={(e) => setUploadNewFolderName(e.target.value)}
                  placeholder="Folder name"
                  className="dialog-input"
                  aria-label="Folder name"
                  autoFocus
                />
              </div>
              <footer>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setNewFolderUploadOpen(false)
                    setUploadChoiceOpen(true)
                  }}
                >
                  Back
                </button>
                <button type="submit" className="primary-button" disabled={!uploadNewFolderName.trim()}>
                  Create & Upload
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
      {operationLabel ? (
        <div className="operation-overlay" role="status" aria-live="polite">
          <div>
            <span className="app-spinner" aria-hidden="true" />
            <strong>{operationLabel}</strong>
          </div>
        </div>
      ) : null}

      {/* Reusable dialogs for individual/bulk moving and bulk trashing */}
      {individualMoveOpen && individualMoveTarget && (
        <FolderTreePicker
          open={individualMoveOpen}
          documents={documents}
          title={`Move "${individualMoveTarget.name}"`}
          disabledFolderIds={(() => {
            const set = new Set<string>()
            if (individualMoveTarget.fileType === 'folder') {
              set.add(individualMoveTarget.id)
              const descendants = collectDescendantFolderIds(documents, individualMoveTarget.id)
              descendants.forEach(id => set.add(id))
            }
            return set
          })()}
          onClose={() => setIndividualMoveOpen(false)}
          onMoveHere={(destId) => {
            void withFriendlyErrors(async () => {
              await ensureAccessToken()
              await actions.moveItem(individualMoveTarget, destId)
              addToast(`Moved "${individualMoveTarget.name}" successfully.`, 'success')
            }, 'Moving item...')
            setIndividualMoveOpen(false)
          }}
        />
      )}

      {bulkMoveOpen && bulkMoveItems.length > 0 && (
        <FolderTreePicker
          open={bulkMoveOpen}
          documents={documents}
          title={`Move ${bulkMoveItems.length} items`}
          disabledFolderIds={(() => {
            const set = new Set<string>()
            bulkMoveItems.forEach(item => {
              if (item.fileType === 'folder') {
                set.add(item.id)
                const descendants = collectDescendantFolderIds(documents, item.id)
                descendants.forEach(id => set.add(id))
              }
            })
            return set
          })()}
          onClose={() => setBulkMoveOpen(false)}
          onMoveHere={(destId) => {
            void withFriendlyErrors(async () => {
              await ensureAccessToken()
              await actions.moveItems(bulkMoveItems, destId)
              addToast(`Moved ${bulkMoveItems.length} items successfully.`, 'success')
            }, 'Moving items...')
            setBulkMoveOpen(false)
          }}
        />
      )}

      {bulkTrashOpen && bulkTrashItems.length > 0 && (
        <div className="dialog-backdrop" role="presentation">
          <section className="prompt-dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="bulk-trash-title">
            <header>
              <h2 id="bulk-trash-title">Move {bulkTrashItems.length} items to Trash?</h2>
            </header>
            <div className="dialog-body">
              <p style={{ margin: '0 0 8px 0', color: '#475467', fontSize: '14px', lineHeight: '1.5' }}>
                Are you sure you want to move <strong>{bulkTrashItems.length} selected items</strong> to the trash?
                All nested files and subfolders inside selected folders will also be moved to the trash.
              </p>
            </div>
            <footer>
              <button type="button" className="secondary-button" onClick={() => setBulkTrashOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-button danger-button"
                onClick={() => {
                  void withFriendlyErrors(async () => {
                    await ensureAccessToken()
                    for (const item of bulkTrashItems) {
                      await actions.moveToTrash(item)
                    }
                    addToast(`Moved ${bulkTrashItems.length} items to trash.`, 'success')
                  }, 'Moving items to trash...')
                  setBulkTrashOpen(false)
                }}
              >
                Move to Trash
              </button>
            </footer>
          </section>
        </div>
      )}

      {/* Floating toast notifications */}
      <div className="toast-container" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-card is-${t.type}`}>
            {t.message}
          </div>
        ))}
      </div>
      </AppLayout>
    </UploadQueueProvider>
  )
}

export default App

function getOperationErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.message.includes('reconnect Google Drive')) {
      return error.message
    }

    if (error.message.includes('permission') || error.message.includes('authorization')) {
      return 'Google Drive permission is required to complete this action. Sign in again and approve Drive access.'
    }
  }

  return 'The operation could not be completed. Check your connection and try again.'
}

function getTopLevelSelection(items: VaultDocument[], allDocuments: VaultDocument[]) {
  const selectedIds = new Set(items.map((item) => item.id))
  return items.filter((item) => !hasSelectedAncestor(item, selectedIds, allDocuments))
}

function hasSelectedAncestor(item: VaultDocument, selectedIds: Set<string>, allDocuments: VaultDocument[]) {
  let parentId = item.parentId ?? null
  while (parentId) {
    if (selectedIds.has(parentId)) return true
    parentId = allDocuments.find((documentRecord) => documentRecord.id === parentId)?.parentId ?? null
  }
  return false
}

interface DriveAuthManagerProps {
  driveConnected: boolean
  onReconnectDrive: () => Promise<void> | void
  showDriveAuthModal: boolean
  setShowDriveAuthModal: (show: boolean) => void
  dismissedPausedAuthModal: boolean
  setDismissedPausedAuthModal: (dismissed: boolean) => void
}

function DriveAuthManager({
  driveConnected,
  onReconnectDrive,
  showDriveAuthModal,
  setShowDriveAuthModal,
  dismissedPausedAuthModal,
  setDismissedPausedAuthModal,
}: DriveAuthManagerProps) {
  const { stats, start } = useUploadQueue()

  // Reset dismissal state when pausedForAuth transitions back to false
  useEffect(() => {
    if (!stats.pausedForAuth) {
      setDismissedPausedAuthModal(false)
    }
  }, [stats.pausedForAuth, setDismissedPausedAuthModal])

  const isOpen = (stats.pausedForAuth && !dismissedPausedAuthModal) || showDriveAuthModal

  if (!isOpen) return null

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="prompt-dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="drive-auth-title">
        <header>
          <h2 id="drive-auth-title">Google Drive Authorization Required</h2>
        </header>
        <div className="dialog-body" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <p style={{ margin: 0, color: '#475467', fontSize: '14px', lineHeight: '1.5' }}>
            {stats.pausedForAuth ? (
              driveConnected ? (
                <strong style={{ color: '#039855' }}>Google Drive connected successfully.</strong>
              ) : (
                'Your upload has been safely paused. Reconnect Google Drive to continue.'
              )
            ) : driveConnected ? (
              <strong style={{ color: '#039855' }}>Google Drive connected successfully.</strong>
            ) : (
              'Google Drive authorization is required to perform this action.'
            )}
          </p>
        </div>
        <footer>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              if (stats.pausedForAuth) {
                setDismissedPausedAuthModal(true)
              } else {
                setShowDriveAuthModal(false)
              }
            }}
          >
            Close
          </button>
          {!driveConnected ? (
            <button
              type="button"
              className="primary-button"
              onClick={async () => {
                await onReconnectDrive()
              }}
            >
              Reconnect Google Drive
            </button>
          ) : (
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                if (stats.pausedForAuth) {
                  start()
                }
                setShowDriveAuthModal(false)
              }}
            >
              {stats.pausedForAuth ? 'Continue Upload' : 'Continue'}
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}
