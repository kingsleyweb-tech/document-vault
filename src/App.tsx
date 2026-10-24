import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Route, Routes, useMatch, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, FolderPlus, HardDrive, Info, Pencil, Tag, Trash2, Upload, X } from 'lucide-react'
import { UploadDialog } from './components/documents/UploadDialog'
import { AppLayout } from './components/layout/AppLayout'
import { DashboardView } from './components/dashboard/DashboardView'
import { DocumentViewer } from './components/viewer/DocumentViewer'
import { useAuth } from './hooks/useAuth'
import { useDocuments, collectDescendantFolderIds } from './hooks/useDocuments'
import { UploadQueueProvider, useUploadQueue } from './hooks/useUploadQueue'
import { DeleteQueueProvider, useDeleteQueue } from './hooks/useDeleteQueue'
import { Categories } from './pages/Categories'
import { Settings } from './pages/Settings'
import { VaultPage } from './pages/VaultPage'
import { AllFiles } from './pages/AllFiles'
import { AllFolders } from './pages/AllFolders'
import { Libraries } from './pages/Libraries'
import { LibraryAccess } from './pages/LibraryAccess'
import { Duplicates } from './pages/Duplicates'
import { LibraryDetail } from './pages/LibraryDetail'
import { SearchPage } from './pages/Search'
import { FolderTreePicker } from './components/documents/FolderTreePicker'
import { TagEditor } from './components/documents/TagEditor'
import { VersionHistoryDialog } from './components/documents/VersionHistoryDialog'
import type { ItemActions } from './components/documents/DocumentCard'
import type { BulkActions } from './components/documents/DocumentCollection'
import { Dialog } from './components/ui/Dialog'
import { partitionLibrary } from './utils/trash'
import { ProtectedRoute } from './routes/ProtectedRoute'
import { logout, reconnectGoogleDrive, clearDriveAccessToken, signsInThroughBrowser } from './services/auth'
import { downloadDriveFile, isDriveAuthorizationError } from './services/googleDrive'
import { buildDownloadName, ensureCacheMatchesVersion, getPreviewKind } from './services/documentViewer'
import { getOfflineBlob, hasStoredOriginal } from './services/offlineStore'
import { isAppleMobile } from './utils/device'
import { notifyDriveAccessChanged, startPreviewQueue, syncLibrary } from './services/previewQueue'
import type { DocumentCategory, SortMode, ThemeMode, VaultDocument, ViewMode } from './types/document'

const categories: DocumentCategory[] = [
  'Personal',
  'School',
  'Military',
  'Work',
  'Certificates',
  'Reports',
  'Other',
]

// Rendered inside the workspace router (basename /app); sign-in lives on the
// public site at /login.
function App() {
  return (
    <Routes>
      <Route element={<ProtectedRoute />}>
        <Route path="/*" element={<AuthenticatedVault />} />
      </Route>
    </Routes>
  )
}

function AuthenticatedVault() {
  return (
    <DeleteQueueProvider>
      <AuthenticatedVaultInner />
    </DeleteQueueProvider>
  )
}

function AuthenticatedVaultInner() {
  const { user, driveAccessToken } = useAuth()
  const accessToken = driveAccessToken
  const { documents, loading, libraryComplete, error, actions } = useDocuments(user, accessToken)
  const { enqueueDelete } = useDeleteQueue()

  // Background preparation of previews on this device (services/previewQueue.ts).
  const accessTokenRef = useRef(accessToken)
  useEffect(() => {
    accessTokenRef.current = accessToken
    notifyDriveAccessChanged()
  }, [accessToken])
  useEffect(() => {
    if (user) void startPreviewQueue({ getAccessToken: () => accessTokenRef.current })
  }, [user])
  useEffect(() => {
    if (user && !loading) syncLibrary(documents, { complete: libraryComplete })
  }, [user, documents, loading, libraryComplete])

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
  // The open document is in the address (?open=<id>), so a reload (or the
  // browser restoring a page it closed) shows it again, and Back closes it.
  const [searchParams, setSearchParams] = useSearchParams()
  const openParam = searchParams.get('open')
  /** True when opening added a history entry that Back can remove. */
  const viewerPushedRef = useRef(false)
  // After a reload only the id is known; the record comes from the library.
  if (openParam && viewerDocument?.id !== openParam && !loading) {
    const restored = documents.find((item) => item.id === openParam && item.fileType !== 'folder' && !item.isDeleted)
    if (restored) setViewerDocument(restored)
  }
  // Back removes ?open, which closes the viewer.
  // The library's current copy, so changes made while it is open (favorite, rename) show at once.
  const shownDocument =
    openParam && viewerDocument?.id === openParam
      ? (documents.find((item) => item.id === openParam) ?? viewerDocument)
      : null
  const [operationError, setOperationError] = useState<string | null>(null)
  const [showDriveAuthModal, setShowDriveAuthModal] = useState(false)
  const [dismissedPausedAuthModal, setDismissedPausedAuthModal] = useState(false)
  const [operationLabel, setOperationLabel] = useState<string | null>(null)

  const [renameOpen, setRenameOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<VaultDocument | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [detailsTarget, setDetailsTarget] = useState<{ record: VaultDocument; category: DocumentCategory; description: string; tags: string[] } | null>(null)
  const [versionsTargetId, setVersionsTargetId] = useState<string | null>(null)

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
  const onDashboard = Boolean(useMatch('/'))
  const navigate = useNavigate()

  // The dashboard has no results list of its own, so a search started there
  // continues on All files, with the cursor kept in the top bar's search box.
  function handleSearchChange(value: string) {
    setSearch(value)
    if (onDashboard && value.trim()) {
      navigate('/files')
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.topbar__search input')?.focus())
    }
  }
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

  const { active: activeDocuments, trash: trashDocuments } = useMemo(() => partitionLibrary(documents), [documents])
  const allTags = useMemo(() => [...new Set(documents.flatMap((record) => record.tags ?? []))].sort(), [documents])
  // Looked up live, so the dialog always sees the record's current version number.
  const versionsTarget = useMemo(() => documents.find((record) => record.id === versionsTargetId) ?? null, [documents, versionsTargetId])

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
      await ensureCacheMatchesVersion(documentRecord)
      // A copy already on this device (opened before) is saved without downloading it again.
      const isWorkspaceFile = documentRecord.mimeType.startsWith('application/vnd.google-apps.')
      const stored = isWorkspaceFile ? null : await getOfflineBlob(documentRecord.driveFileId)
      const blob = stored?.blob ?? (await downloadDriveFile(await ensureAccessToken(), documentRecord.driveFileId, documentRecord.mimeType))
      const name = buildDownloadName(documentRecord)
      // iPhone and iPad save files through the share sheet ("Save to Files"); a
      // download link does nothing in an installed web app there.
      if (isAppleMobile()) {
        const file = new File([blob], name, { type: blob.type || documentRecord.mimeType || 'application/octet-stream' })
        if (navigator.canShare?.({ files: [file] })) {
          try {
            await navigator.share({ files: [file] })
            return
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return
            // Not allowed (too long after the tap): fall back to the link below.
          }
        }
      }
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      link.href = url
      link.download = name
      document.body.append(link)
      link.click()
      link.remove()
      // Safari reads the file after the click returns, so it stays available for a while.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
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
        await ensureCacheMatchesVersion(file)
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

  const permanentlyDeleteSelectedTrash = () => {
    const items = bulkPermanentDeleteItems
    if (items.length > 0) {
      void enqueueDelete(items, 'permanent', accessToken, documents)
      addToast(`Deleting ${items.length} ${items.length === 1 ? 'item' : 'items'} permanently...`, 'info')
    }
    setBulkPermanentDeleteOpen(false)
    setBulkPermanentDeleteItems([])
  }

  const showInAddress = (documentId: string | null) => {
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params)
        if (documentId) next.set('open', documentId)
        else next.delete('open')
        return next
      },
      { replace: !documentId || Boolean(openParam) },
    )
  }

  const closeViewer = () => {
    setViewerDocument(null)
    if (!openParam) return
    if (viewerPushedRef.current) {
      viewerPushedRef.current = false
      navigate(-1)
    } else {
      showInAddress(null)
    }
  }

  const openDocument = (documentRecord: VaultDocument) => {
    // The viewer opens at once. It shows cached copies without Drive and asks
    // to reconnect otherwise. Recording the view is a Firestore write that
    // waits for the network, so it must not hold the document back.
    setViewerDocument(documentRecord)
    if (openParam !== documentRecord.id) {
      if (!openParam) viewerPushedRef.current = true
      showInAddress(documentRecord.id)
    }
    void actions.viewed(documentRecord).catch((error: unknown) => console.warn('Could not record the view:', error))
    // Without a Drive token, a document not stored on this device cannot open.
    // Renewing here, inside the click, lets the browser allow Google's window;
    // with access already granted it closes by itself without questions. The
    // viewer reloads when the token arrives.
    // In the desktop app renewing means switching to the browser, so it waits
    // for the viewer's Reconnect button instead of happening on its own.
    if (
      !accessToken &&
      !signsInThroughBrowser() &&
      navigator.onLine &&
      documentRecord.driveFileId &&
      !hasStoredOriginal(documentRecord.driveFileId) &&
      getPreviewKind(documentRecord) !== 'embed'
    ) {
      void reconnectGoogleDrive().catch((error: unknown) => {
        // Closed or blocked: the viewer offers "Reconnect Google Drive".
        console.warn('Google Drive was not reconnected:', error)
      })
    }
  }

  const restoreDocuments = (items: VaultDocument[]) => {
    if (items.length === 0) return
    void withFriendlyErrors(
      async () => {
        await ensureAccessToken()
        for (const item of items) {
          await actions.restore(item)
        }
        addToast(items.length === 1 ? `Restored "${items[0].name}".` : `Restored ${items.length} items.`, 'success')
      },
      items.length === 1 ? 'Restoring...' : `Restoring ${items.length} items...`,
    )
  }

  const itemActions: ItemActions = {
    onView: openDocument,
    onDownload: (documentRecord) => void downloadDocument(documentRecord),
    onRename: renameDocument,
    onFavorite: (documentRecord) => void withFriendlyErrors(() => actions.toggleFavorite(documentRecord)),
    onTrash: (documentRecord) => {
      setConfirmTrashTarget(documentRecord)
      setConfirmTrashOpen(true)
    },
    onMove: (documentRecord) => {
      setIndividualMoveTarget(documentRecord)
      setIndividualMoveOpen(true)
    },
    onEditDetails: (documentRecord) =>
      setDetailsTarget({
        record: documentRecord,
        category: documentRecord.category,
        description: documentRecord.description ?? '',
        tags: documentRecord.tags ?? [],
      }),
    onCopy: (documentRecord) =>
      void withFriendlyErrors(async () => {
        await ensureAccessToken()
        const copyName = await actions.copy(documentRecord)
        addToast(`Made a copy: "${copyName}".`, 'success')
      }, 'Copying...'),
    onVersions: (documentRecord) => setVersionsTargetId(documentRecord.id),
    onRestore: (documentRecord) => restoreDocuments([documentRecord]),
    onPermanentDelete: (documentRecord) => {
      setConfirmDeleteTarget(documentRecord)
      setConfirmDeleteOpen(true)
    },
  }

  const bulkActions: BulkActions = {
    onBulkTrash: handleBulkTrash,
    onBulkMove: handleBulkMove,
    onBulkFavorite: (items) => void handleBulkFavorite(items),
    onBulkDownload: (items) => void handleBulkDownload(items),
    onBulkRestore: restoreDocuments,
    onBulkPermanentDelete: handleBulkPermanentDelete,
  }

  const libraryProps = {
    documents: activeDocuments,
    allDocuments: documents,
    accessToken,
    loading,
    error: operationError ?? error,
    search,
    viewMode,
    sortMode,
    category,
    categories,
    onViewModeChange: setViewMode,
    onSortModeChange: setSortMode,
    onCategoryChange: setCategory,
    actions: itemActions,
    bulk: bulkActions,
    onUploadClick: handleUploadClick,
    onCreateFolder: createNewFolder,
  }

  const moveBlockedIds = (items: VaultDocument[]) => {
    const blocked = new Set<string>()
    for (const item of items) {
      if (item.fileType !== 'folder') continue
      blocked.add(item.id)
      collectDescendantFolderIds(documents, item.id).forEach((id) => blocked.add(id))
    }
    return blocked
  }

  const closeRename = () => setRenameOpen(false)
  const submitRename = () => {
    const nextName = renameValue.trim()
    if (renameTarget && nextName && nextName !== renameTarget.name) {
      const target = renameTarget
      void withFriendlyErrors(async () => {
        await ensureAccessToken()
        await actions.rename(target, nextName)
      })
    }
    setRenameOpen(false)
  }

  const submitDetails = () => {
    const target = detailsTarget
    setDetailsTarget(null)
    if (!target) return
    const description = target.description.trim().slice(0, 4000)
    const tagsChanged = target.tags.join() !== (target.record.tags ?? []).join()
    if (target.category === target.record.category && description === (target.record.description ?? '') && !tagsChanged) return
    void withFriendlyErrors(async () => {
      await actions.updateDetails(target.record, { category: target.category, description, tags: target.tags })
      addToast(`Saved details for "${target.record.name}".`, 'success')
    })
  }

  const submitNewFolder = () => {
    const name = folderNameValue.trim()
    if (name) {
      void withFriendlyErrors(async () => {
        await ensureAccessToken()
        await actions.createFolder(name, currentFolderId)
        addToast(`Created folder "${name}".`, 'success')
      })
    }
    setFolderModalOpen(false)
  }

  const submitNewFolderUpload = () => {
    const name = uploadNewFolderName.trim()
    if (!name) return
    void withFriendlyErrors(async () => {
      await ensureAccessToken()
      const newFolderId = await actions.createFolder(name, currentFolderId)
      setUploadDestinationFolderId(newFolderId)
      setUploadNewFolderName('')
      setNewFolderUploadOpen(false)
      setUploadOpen(true)
    })
  }

  const confirmTrash = () => {
    if (confirmTrashTarget) {
      void enqueueDelete([confirmTrashTarget], 'trash', accessToken, documents)
      addToast(`Moving "${confirmTrashTarget.name}" to Trash...`, 'info')
    }
    setConfirmTrashOpen(false)
    setConfirmTrashTarget(null)
  }

  const confirmPermanentDelete = () => {
    if (confirmDeleteTarget) {
      void enqueueDelete([confirmDeleteTarget], 'permanent', accessToken, documents)
      addToast(`Deleting "${confirmDeleteTarget.name}" permanently...`, 'info')
    }
    setConfirmDeleteOpen(false)
    setConfirmDeleteTarget(null)
  }

  const confirmBulkTrash = () => {
    if (bulkTrashItems.length > 0) {
      void enqueueDelete(bulkTrashItems, 'trash', accessToken, documents)
      addToast(`Moving ${bulkTrashItems.length} items to Trash...`, 'info')
    }
    setBulkTrashOpen(false)
    setBulkTrashItems([])
  }

  const isEmptyingTrash = bulkPermanentDeleteItems.length > 0 && bulkPermanentDeleteItems.length === trashDocuments.length

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
        trashCount={trashDocuments.length}
        search={search}
        searchPlaceholder={currentFolderId ? 'Search this folder' : 'Search your vault'}
        onSearchChange={handleSearchChange}
        onUploadClick={handleUploadClick}
        onUploadProgressClick={handleUploadProgressClick}
        driveConnected={Boolean(accessToken)}
        accessToken={accessToken}
        onReconnectDrive={() => void reconnectDrive()}
        onLogout={() => void logout()}
        themeMode={themeMode}
        onThemeModeChange={setThemeMode}
      >
        <Routes>
          <Route
            index
            element={
              <DashboardView
                user={user}
                documents={activeDocuments}
                allDocuments={documents}
                trashCount={trashDocuments.length}
                loading={loading}
                error={operationError ?? error}
                accessToken={accessToken}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                actions={itemActions}
                bulk={bulkActions}
                onUploadClick={handleUploadClick}
                onUploadProgressClick={handleUploadProgressClick}
                onCreateFolder={createNewFolder}
                search={search}
                onSearchChange={handleSearchChange}
              />
            }
          />
          <Route path="files" element={<AllFiles {...libraryProps} />} />
          <Route path="folders" element={<AllFolders {...libraryProps} />} />
          <Route
            path="folders/:folderId"
            element={<VaultPage {...libraryProps} variant="folder" currentFolderId={currentFolderId} folderPath={folderPath} />}
          />
          <Route path="recent" element={<VaultPage {...libraryProps} variant="recent" />} />
          <Route path="favorites" element={<VaultPage {...libraryProps} variant="favorites" />} />
          <Route path="categories" element={<Categories {...libraryProps} />} />
          <Route path="libraries" element={<Libraries />} />
          <Route path="libraries/duplicates" element={<Duplicates />} />
          <Route path="libraries/:libraryId" element={<LibraryDetail />} />
          <Route path="access" element={<LibraryAccess />} />
          <Route
            path="search"
            element={<SearchPage documents={activeDocuments} allDocuments={documents} search={search} onOpenDocument={openDocument} />}
          />
          {/* Desktop Files became My Libraries and Search; old links keep working. */}
          <Route path="desktop" element={<Navigate to="/libraries" replace />} />
          <Route
            path="trash"
            element={
              <VaultPage
                {...libraryProps}
                variant="trash"
                documents={trashDocuments}
                onEmptyTrash={() => handleBulkPermanentDelete(trashDocuments)}
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
          documentRecord={shownDocument}
          documents={activeDocuments}
          accessToken={accessToken}
          onClose={closeViewer}
          onDownload={(documentRecord) => void downloadDocument(documentRecord)}
          onOpenDocument={openDocument}
          onFavorite={(documentRecord) => void withFriendlyErrors(() => actions.toggleFavorite(documentRecord))}
          onReauthRequired={() => {
            clearDriveAccessToken()
            setShowDriveAuthModal(true)
          }}
        />

        <Dialog
          open={renameOpen && Boolean(renameTarget)}
          title={`Rename ${renameTarget?.fileType === 'folder' ? 'folder' : 'file'}`}
          icon={<Pencil aria-hidden="true" />}
          onClose={closeRename}
          onSubmit={submitRename}
          footer={
            <>
              <button type="button" className="secondary-button" onClick={closeRename}>
                Cancel
              </button>
              <button type="submit" className="primary-button" disabled={!renameValue.trim()}>
                Save
              </button>
            </>
          }
        >
          <input
            type="text"
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            placeholder="New name"
            className="dialog-input"
            aria-label="New name"
          />
        </Dialog>

        <Dialog
          open={Boolean(detailsTarget)}
          title="Edit details"
          description={detailsTarget?.record.name}
          icon={<Tag aria-hidden="true" />}
          onClose={() => setDetailsTarget(null)}
          onSubmit={submitDetails}
          footer={
            <>
              <button type="button" className="secondary-button" onClick={() => setDetailsTarget(null)}>
                Cancel
              </button>
              <button type="submit" className="primary-button">
                Save
              </button>
            </>
          }
        >
          <label className="field">
            <span>Category</span>
            <select
              value={detailsTarget?.category ?? 'Other'}
              onChange={(event) => setDetailsTarget((current) => current && { ...current, category: event.target.value as DocumentCategory })}
            >
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Description</span>
            <textarea
              className="dialog-input dialog-textarea"
              rows={4}
              maxLength={4000}
              value={detailsTarget?.description ?? ''}
              onChange={(event) => setDetailsTarget((current) => current && { ...current, description: event.target.value })}
              placeholder="Notes that help you find this document later"
            />
          </label>
          <div className="field">
            <span>Tags</span>
            <TagEditor
              tags={detailsTarget?.tags ?? []}
              suggestions={allTags}
              onChange={(tags) => setDetailsTarget((current) => current && { ...current, tags })}
            />
            <small className="field-hint">Search for a tag by typing it with #, for example #tax.</small>
          </div>
        </Dialog>

        <VersionHistoryDialog
          documentRecord={versionsTarget}
          actions={actions}
          onClose={() => setVersionsTargetId(null)}
          onNotify={addToast}
          runTask={(task) => withFriendlyErrors(task)}
        />

        <Dialog
          open={folderModalOpen}
          title="New folder"
          description={currentFolder ? `Inside ${currentFolder.name}` : 'At the top level of My Vault'}
          icon={<FolderPlus aria-hidden="true" />}
          onClose={() => setFolderModalOpen(false)}
          onSubmit={submitNewFolder}
          footer={
            <>
              <button type="button" className="secondary-button" onClick={() => setFolderModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="primary-button" disabled={!folderNameValue.trim()}>
                Create
              </button>
            </>
          }
        >
          <input
            type="text"
            value={folderNameValue}
            onChange={(event) => setFolderNameValue(event.target.value)}
            placeholder="Folder name"
            className="dialog-input"
            aria-label="Folder name"
          />
        </Dialog>

        <Dialog
          open={confirmTrashOpen && Boolean(confirmTrashTarget)}
          title="Move to Trash?"
          tone="danger"
          icon={<Trash2 aria-hidden="true" />}
          onClose={() => setConfirmTrashOpen(false)}
          footer={
            <>
              <button type="button" className="secondary-button" onClick={() => setConfirmTrashOpen(false)}>
                Cancel
              </button>
              <button type="button" className="danger-button" onClick={confirmTrash}>
                Move to Trash
              </button>
            </>
          }
        >
          <p>
            <strong>{confirmTrashTarget?.name}</strong> will move to Trash
            {confirmTrashTarget?.fileType === 'folder' ? ' together with everything inside it' : ''}. You can restore it
            from Trash at any time.
          </p>
        </Dialog>

        <Dialog
          open={confirmDeleteOpen && Boolean(confirmDeleteTarget)}
          title="Delete permanently?"
          tone="danger"
          icon={<AlertTriangle aria-hidden="true" />}
          onClose={() => setConfirmDeleteOpen(false)}
          footer={
            <>
              <button type="button" className="secondary-button" onClick={() => setConfirmDeleteOpen(false)}>
                Cancel
              </button>
              <button type="button" className="danger-button" onClick={confirmPermanentDelete}>
                Delete permanently
              </button>
            </>
          }
        >
          <p>
            <strong>{confirmDeleteTarget?.name}</strong>
            {confirmDeleteTarget?.fileType === 'folder' ? ' and everything inside it' : ''} will be removed from your vault
            and from Google Drive.
          </p>
          <p className="dialog-warning">This cannot be undone.</p>
        </Dialog>

        <Dialog
          open={bulkPermanentDeleteOpen}
          title={isEmptyingTrash ? 'Empty Trash?' : `Delete ${bulkPermanentDeleteItems.length} items permanently?`}
          tone="danger"
          icon={<AlertTriangle aria-hidden="true" />}
          onClose={() => setBulkPermanentDeleteOpen(false)}
          footer={
            <>
              <button type="button" className="secondary-button" onClick={() => setBulkPermanentDeleteOpen(false)}>
                Cancel
              </button>
              <button type="button" className="danger-button" onClick={permanentlyDeleteSelectedTrash}>
                {isEmptyingTrash ? 'Empty Trash' : 'Delete permanently'}
              </button>
            </>
          }
        >
          <p>
            {bulkPermanentDeleteItems.length} {bulkPermanentDeleteItems.length === 1 ? 'item' : 'items'}, including the
            contents of any folders, will be removed from your vault and from Google Drive.
          </p>
          <p className="dialog-warning">This cannot be undone.</p>
        </Dialog>

        <Dialog
          open={uploadChoiceOpen}
          title="Upload"
          description="Where should the new files go?"
          icon={<Upload aria-hidden="true" />}
          onClose={() => setUploadChoiceOpen(false)}
          footer={
            <button type="button" className="secondary-button" onClick={() => setUploadChoiceOpen(false)}>
              Cancel
            </button>
          }
        >
          <div className="choice-list">
            <button
              type="button"
              className="choice-card"
              onClick={() => {
                setUploadDestinationFolderId(currentFolderId)
                setUploadChoiceOpen(false)
                setUploadOpen(true)
              }}
            >
              <Upload aria-hidden="true" />
              <span>
                <strong>Upload to {currentFolder ? currentFolder.name : 'My Vault'}</strong>
                <span>Files and folders are added to the location you are viewing.</span>
              </span>
            </button>
            <button
              type="button"
              className="choice-card"
              onClick={() => {
                setUploadChoiceOpen(false)
                setNewFolderUploadOpen(true)
              }}
            >
              <FolderPlus aria-hidden="true" />
              <span>
                <strong>Create a folder, then upload</strong>
                <span>Name a new folder first and everything you upload goes inside it.</span>
              </span>
            </button>
          </div>
        </Dialog>

        <Dialog
          open={newFolderUploadOpen}
          title="New folder for upload"
          description="Everything you upload next goes into this folder."
          icon={<FolderPlus aria-hidden="true" />}
          onClose={() => setNewFolderUploadOpen(false)}
          onSubmit={submitNewFolderUpload}
          footer={
            <>
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
                Create and upload
              </button>
            </>
          }
        >
          <input
            type="text"
            value={uploadNewFolderName}
            onChange={(event) => setUploadNewFolderName(event.target.value)}
            placeholder="Folder name"
            className="dialog-input"
            aria-label="Folder name"
          />
        </Dialog>

        {operationLabel ? (
          <div className="operation-overlay" role="status" aria-live="polite">
            <div>
              <span className="app-spinner" aria-hidden="true" />
              <strong>{operationLabel}</strong>
            </div>
          </div>
        ) : null}

        {individualMoveOpen && individualMoveTarget ? (
          <FolderTreePicker
            open
            documents={activeDocuments}
            title={`Move "${individualMoveTarget.name}"`}
            disabledFolderIds={moveBlockedIds([individualMoveTarget])}
            onClose={() => setIndividualMoveOpen(false)}
            onMoveHere={(destinationId) => {
              const target = individualMoveTarget
              void withFriendlyErrors(async () => {
                await ensureAccessToken()
                await actions.moveItem(target, destinationId)
                addToast(`Moved "${target.name}".`, 'success')
              }, 'Moving...')
              setIndividualMoveOpen(false)
            }}
          />
        ) : null}

        {bulkMoveOpen && bulkMoveItems.length > 0 ? (
          <FolderTreePicker
            open
            documents={activeDocuments}
            title={`Move ${bulkMoveItems.length} items`}
            disabledFolderIds={moveBlockedIds(bulkMoveItems)}
            onClose={() => setBulkMoveOpen(false)}
            onMoveHere={(destinationId) => {
              const items = bulkMoveItems
              void withFriendlyErrors(async () => {
                await ensureAccessToken()
                await actions.moveItems(items, destinationId)
                addToast(`Moved ${items.length} items.`, 'success')
              }, 'Moving items...')
              setBulkMoveOpen(false)
            }}
          />
        ) : null}

        <Dialog
          open={bulkTrashOpen && bulkTrashItems.length > 0}
          title={`Move ${bulkTrashItems.length} items to Trash?`}
          tone="danger"
          icon={<Trash2 aria-hidden="true" />}
          onClose={() => setBulkTrashOpen(false)}
          footer={
            <>
              <button type="button" className="secondary-button" onClick={() => setBulkTrashOpen(false)}>
                Cancel
              </button>
              <button type="button" className="danger-button" onClick={confirmBulkTrash}>
                Move to Trash
              </button>
            </>
          }
        >
          <p>The selected items, and everything inside selected folders, will move to Trash. You can restore them later.</p>
        </Dialog>

        <div className="toast-container" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast is-${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}>
              {toast.type === 'success' ? (
                <CheckCircle2 aria-hidden="true" />
              ) : toast.type === 'error' ? (
                <AlertTriangle aria-hidden="true" />
              ) : (
                <Info aria-hidden="true" />
              )}
              <span>{toast.message}</span>
              <button
                type="button"
                className="toast__close"
                onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
                aria-label="Dismiss"
              >
                <X aria-hidden="true" />
              </button>
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

  const close = () => {
    if (stats.pausedForAuth) setDismissedPausedAuthModal(true)
    else setShowDriveAuthModal(false)
  }

  return (
    <Dialog
      open
      title={driveConnected ? 'Google Drive connected' : 'Reconnect Google Drive'}
      icon={<HardDrive aria-hidden="true" />}
      onClose={close}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={close}>
            Close
          </button>
          {!driveConnected ? (
            <button type="button" className="primary-button" onClick={() => void onReconnectDrive()}>
              Reconnect Google Drive
            </button>
          ) : (
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                if (stats.pausedForAuth) start()
                setShowDriveAuthModal(false)
              }}
            >
              {stats.pausedForAuth ? 'Continue upload' : 'Continue'}
            </button>
          )}
        </>
      }
    >
      {driveConnected ? (
        <p className="dialog-success">
          <CheckCircle2 aria-hidden="true" />
          Google Drive is connected. You can carry on.
        </p>
      ) : (
        <p>
          {stats.pausedForAuth
            ? 'Your upload is paused safely. Reconnect Google Drive to continue where it stopped.'
            : 'Your Google Drive session has expired. Reconnect to keep working with your files.'}
        </p>
      )}
    </Dialog>
  )
}
