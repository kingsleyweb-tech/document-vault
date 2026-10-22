import { StrictMode, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Route, Routes, useMatch } from 'react-router-dom'
import '../../src/index.css'
import '../../src/styles/components.css'
import '../../src/styles/shell.css'
import '../../src/styles/library.css'
import '../../src/styles/pages.css'
import '../../src/styles/upload.css'
import '../../src/styles/viewer.css'
import '../../src/styles/desktop.css'
import { AppLayout } from '../../src/components/layout/AppLayout'
import { DashboardView } from '../../src/components/dashboard/DashboardView'
import type { ItemActions } from '../../src/components/documents/DocumentCard'
import type { BulkActions } from '../../src/components/documents/DocumentCollection'
import { UploadQueueProvider } from '../../src/hooks/useUploadQueue'
import { DeleteQueueProvider } from '../../src/hooks/useDeleteQueue'
import { AllFiles } from '../../src/pages/AllFiles'
import { AllFolders } from '../../src/pages/AllFolders'
import { Categories } from '../../src/pages/Categories'
import { DesktopFiles } from '../../src/pages/DesktopFiles'
import { Settings } from '../../src/pages/Settings'
import { VaultPage } from '../../src/pages/VaultPage'
import { partitionLibrary } from '../../src/utils/trash'
import type { DocumentCategory, DocumentKind, SortMode, ThemeMode, VaultDocument, ViewMode } from '../../src/types/document'
import type { VaultUser } from '../../src/types/user'

// Development-only page. Renders the signed-in shell and every library page
// against an in-memory library so layouts and the trash flow can be checked
// without Google sign-in. Trash and restore flip `isDeleted` locally; Drive
// and Firestore are never called.

const categories: DocumentCategory[] = ['Personal', 'School', 'Military', 'Work', 'Certificates', 'Reports', 'Other']
const user: VaultUser = { uid: 'harness', displayName: 'Kingsley Anaab', email: 'harness@example.com', photoURL: '' }

const stamp = (daysAgo: number) => {
  const ms = Date.now() - daysAgo * 86_400_000
  return { toDate: () => new Date(ms), toMillis: () => ms }
}

const mimeFor: Record<DocumentKind, string> = {
  pdf: 'application/pdf',
  image: 'image/png',
  word: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  spreadsheet: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  presentation: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  folder: 'application/vnd.google-apps.folder',
  html: 'text/html',
  text: 'text/plain',
  ebook: 'application/epub+zip',
  other: 'application/octet-stream',
}

let seq = 0
function record(name: string, fileType: DocumentKind, parentId: string | null, extra: Partial<VaultDocument> = {}): VaultDocument {
  seq += 1
  const age = seq * 1.7
  return {
    id: `doc-${seq}`,
    ownerId: 'harness',
    name,
    originalName: name,
    mimeType: mimeFor[fileType],
    fileType,
    fileSize: fileType === 'folder' ? 0 : 40_000 * seq * seq,
    category: categories[seq % categories.length],
    description: '',
    driveFileId: `drive-${seq}`,
    driveFolderId: '',
    isFavorite: seq % 4 === 0,
    isDeleted: false,
    createdAt: stamp(age),
    uploadedAt: stamp(age),
    updatedAt: stamp(age),
    lastViewedAt: seq % 3 === 0 ? stamp(age / 3) : undefined,
    parentId,
    isFolderRecord: fileType === 'folder',
    ...extra,
  }
}

function seedLibrary(): VaultDocument[] {
  const school = record('School', 'folder', null)
  const work = record('Work projects', 'folder', null)
  const reports = record('Quarterly reports', 'folder', work.id)
  const military = record('Military records', 'folder', null)
  return [
    school,
    work,
    reports,
    military,
    record('Transcript 2025.pdf', 'pdf', school.id),
    record('Thesis draft final version with a very long file name.docx', 'word', school.id),
    record('Lecture slides week 4.pptx', 'presentation', school.id),
    record('Budget 2026.xlsx', 'spreadsheet', work.id),
    record('Q1 summary.pdf', 'pdf', reports.id),
    record('Q2 summary.pdf', 'pdf', reports.id),
    record('Service certificate.pdf', 'pdf', military.id),
    record('Passport scan.png', 'image', null),
    record('Notes.txt', 'text', null),
    record('Reading list.epub', 'ebook', null),
    record('Old draft.docx', 'word', null, { isDeleted: true }),
  ]
}

// Entry script, not a module consumed by Fast Refresh.
// eslint-disable-next-line react-refresh/only-export-components
function Harness() {
  const [documents, setDocuments] = useState(seedLibrary)
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [sortMode, setSortMode] = useState<SortMode>('newest')
  const [category, setCategory] = useState<DocumentCategory | 'All'>('All')
  const [themeMode, setThemeMode] = useState<ThemeMode>('light')
  const [log, setLog] = useState<string[]>([])
  const { active: activeDocuments, trash: trashDocuments } = useMemo(() => partitionLibrary(documents), [documents])
  const folderMatch = useMatch('/folders/:folderId')
  const currentFolderId = folderMatch?.params.folderId ?? null

  const setTheme = (mode: ThemeMode) => {
    document.documentElement.dataset.theme = mode
    setThemeMode(mode)
  }
  const note = (message: string) => setLog((entries) => [message, ...entries].slice(0, 5))
  const patch = (ids: Set<string>, change: Partial<VaultDocument>) =>
    setDocuments((items) => items.map((item) => (ids.has(item.id) ? { ...item, ...change, updatedAt: stamp(0) } : item)))
  const remove = (ids: Set<string>) => setDocuments((items) => items.filter((item) => !ids.has(item.id)))

  const trash = (items: VaultDocument[]) => {
    patch(new Set(items.map((item) => item.id)), { isDeleted: true })
    note(`Trashed ${items.map((item) => item.name).join(', ')}`)
  }
  const restore = (items: VaultDocument[]) => {
    patch(new Set(items.map((item) => item.id)), { isDeleted: false })
    note(`Restored ${items.map((item) => item.name).join(', ')}`)
  }
  const destroy = (items: VaultDocument[]) => {
    remove(new Set(items.map((item) => item.id)))
    note(`Deleted ${items.map((item) => item.name).join(', ')}`)
  }

  const actions: ItemActions = {
    onView: (item) => note(`Open ${item.name}`),
    onDownload: (item) => note(`Download ${item.name}`),
    onRename: (item) => note(`Rename ${item.name}`),
    onFavorite: (item) => patch(new Set([item.id]), { isFavorite: !item.isFavorite }),
    onTrash: (item) => trash([item]),
    onMove: (item) => note(`Move ${item.name}`),
    onRestore: (item) => restore([item]),
    onPermanentDelete: (item) => destroy([item]),
  }
  const bulk: BulkActions = {
    onBulkTrash: trash,
    onBulkMove: (items) => note(`Move ${items.length} items`),
    onBulkFavorite: (items) => patch(new Set(items.map((item) => item.id)), { isFavorite: true }),
    onBulkDownload: (items) => note(`Download ${items.length} items`),
    onBulkRestore: restore,
    onBulkPermanentDelete: destroy,
  }

  const folderPath: VaultDocument[] = []
  for (let id = currentFolderId; id; ) {
    const folder = documents.find((item) => item.id === id)
    if (!folder) break
    folderPath.unshift(folder)
    id = folder.parentId ?? null
  }

  const libraryProps = {
    documents: activeDocuments,
    allDocuments: documents,
    accessToken: null,
    loading: false,
    error: null,
    search,
    viewMode,
    sortMode,
    category,
    categories,
    onViewModeChange: setViewMode,
    onSortModeChange: setSortMode,
    onCategoryChange: setCategory,
    actions,
    bulk,
    onUploadClick: () => note('Upload'),
    onCreateFolder: () => note('New folder'),
  }

  return (
    <UploadQueueProvider user={user} accessToken={null} documents={documents}>
      <AppLayout
        user={user}
        trashCount={trashDocuments.length}
        search={search}
        onSearchChange={setSearch}
        onUploadClick={() => note('Upload')}
        onUploadProgressClick={() => note('Upload progress')}
        driveConnected
        accessToken={null}
        onReconnectDrive={() => note('Reconnect')}
        onLogout={() => note('Logout')}
        themeMode={themeMode}
        onThemeModeChange={setTheme}
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
                loading={false}
                error={null}
                accessToken={null}
                driveConnected
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                actions={actions}
                bulk={bulk}
                onUploadClick={() => note('Upload')}
                onUploadProgressClick={() => note('Upload progress')}
                onCreateFolder={() => note('New folder')}
                onSearchFocus={() => undefined}
                onReconnectDrive={() => note('Reconnect')}
              />
            }
          />
          <Route path="files" element={<AllFiles {...libraryProps} />} />
          <Route path="folders" element={<AllFolders {...libraryProps} />} />
          <Route path="folders/:folderId" element={<VaultPage {...libraryProps} variant="folder" currentFolderId={currentFolderId} folderPath={folderPath} />} />
          <Route path="recent" element={<VaultPage {...libraryProps} variant="recent" />} />
          <Route path="favorites" element={<VaultPage {...libraryProps} variant="favorites" />} />
          <Route path="categories" element={<Categories {...libraryProps} />} />
          <Route
            path="desktop"
            element={<DesktopFiles documents={activeDocuments} allDocuments={documents} search={search} onOpenDocument={(item) => note(`Open ${item.name}`)} />}
          />
          <Route path="trash" element={<VaultPage {...libraryProps} variant="trash" documents={trashDocuments} onEmptyTrash={() => destroy(trashDocuments)} />} />
          <Route
            path="settings"
            element={
              <Settings
                themeMode={themeMode}
                viewMode={viewMode}
                sortMode={sortMode}
                category={category}
                categories={categories}
                onThemeModeChange={setTheme}
                onViewModeChange={setViewMode}
                onSortModeChange={setSortMode}
                onCategoryChange={setCategory}
                onSearchClear={() => setSearch('')}
                onUploadClick={() => note('Upload')}
              />
            }
          />
        </Routes>
      </AppLayout>
      <output id="harness-log" hidden>{log.join('\n')}</output>
    </UploadQueueProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <DeleteQueueProvider>
        <Harness />
      </DeleteQueueProvider>
    </HashRouter>
  </StrictMode>,
)
