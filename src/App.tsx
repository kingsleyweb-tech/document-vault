import { useEffect, useMemo, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useMatch } from 'react-router-dom'
import { UploadDialog } from './components/documents/UploadDialog'
import { AppLayout } from './components/layout/AppLayout'
import { DocumentViewer } from './components/viewer/DocumentViewer'
import { useAuth } from './hooks/useAuth'
import { useDocuments } from './hooks/useDocuments'
import { Categories } from './pages/Categories'
import { Login } from './pages/Login'
import { Settings } from './pages/Settings'
import { VaultPage } from './pages/VaultPage'
import { ProtectedRoute } from './routes/ProtectedRoute'
import { logout, reconnectGoogleDrive } from './services/auth'
import { getDriveFileBlob } from './services/googleDrive'
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
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/*" element={<AuthenticatedVault />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

function AuthenticatedVault() {
  const { user, driveAccessToken } = useAuth()
  const [accessToken, setAccessToken] = useState<string | null>(driveAccessToken)
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

  const [uploadChoiceOpen, setUploadChoiceOpen] = useState(false)
  const [newFolderUploadOpen, setNewFolderUploadOpen] = useState(false)
  const [uploadNewFolderName, setUploadNewFolderName] = useState('')
  const [uploadDestinationFolderId, setUploadDestinationFolderId] = useState<string | null>(null)

  const uploadDestinationFolder = useMemo(() => {
    return documents.find((d) => d.id === uploadDestinationFolderId)
  }, [documents, uploadDestinationFolderId])

  const handleUploadClick = () => {
    setUploadDestinationFolderId(currentFolderId)
    setUploadChoiceOpen(true)
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
      setOperationError('The operation could not be completed. Check your Google Drive connection and try again.')
    } finally {
      if (label) setOperationLabel(null)
    }
  }

  async function ensureAccessToken() {
    if (accessToken) return accessToken
    const token = await reconnectGoogleDrive()
    setAccessToken(token)
    return token
  }

  async function downloadDocument(documentRecord: VaultDocument) {
    await withFriendlyErrors(async () => {
      const token = await ensureAccessToken()
      const blob = await getDriveFileBlob(token, documentRecord.driveFileId)
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      link.href = url
      link.download = documentRecord.originalName
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

  const commonPageProps = {
    loading,
    error: operationError ?? error,
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
  }

  return (
    <AppLayout
      user={user}
      search={search}
      onSearchChange={setSearch}
      onUploadClick={handleUploadClick}
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
        onClose={() => setUploadOpen(false)}
        onUpload={async (file, uploadCategory, description) => {
          await ensureAccessToken()
          await actions.upload(file, { category: uploadCategory, description }, uploadDestinationFolderId)
        }}
      />

      <DocumentViewer
        documentRecord={viewerDocument}
        accessToken={accessToken}
        onClose={() => setViewerDocument(null)}
        onDownload={(documentRecord) => void downloadDocument(documentRecord)}
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
    </AppLayout>
  )
}

export default App
