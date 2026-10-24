import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, EyeOff, Folder } from 'lucide-react'
import { DocumentIcon } from '../documents/DocumentIcon'
import { companion, type LocalEntry, type TreeFolder, type TreeSort } from '../../services/desktopCompanion'
import type { DocumentKind } from '../../types/document'
import { formatFileSize } from '../../utils/formatters'
import { dateFormat, errorText, kindLabels, numberFormat } from './libraryText'

const iconKinds = new Set<DocumentKind>(['pdf', 'image', 'word', 'spreadsheet', 'presentation', 'folder', 'html', 'text', 'ebook'])
const PAGE = 200

const sorts: Array<{ value: TreeSort; label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'type', label: 'Type' },
  { value: 'modified', label: 'Date modified' },
  { value: 'size', label: 'Size' },
]

interface FolderTreeProps {
  libraryId: number
  /** Changes when the library's index changes, so open folders are listed again. */
  version: string
  onFile: (entry: LocalEntry) => void
  onExclude: (folder: TreeFolder) => void
}

// The library's folders, read from the index one level at a time as they are
// opened and a page at a time within a level, so even a library with
// thousands of folders, or a folder with thousands of files, lists quickly.
export function FolderTree({ libraryId, version, onFile, onExclude }: FolderTreeProps) {
  const [sort, setSort] = useState<TreeSort>('name')
  return (
    <div className="folder-tree-view">
      <div className="folder-tree__toolbar">
        <label>
          <span>Sort by</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as TreeSort)}>
            {sorts.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="folder-tree" role="tree" aria-label="Folders in this library">
        <FolderLevel libraryId={libraryId} parent={null} version={version} sort={sort} depth={0} onFile={onFile} onExclude={onExclude} />
      </div>
    </div>
  )
}

interface LevelProps extends FolderTreeProps {
  parent: number | null
  sort: TreeSort
  depth: number
}

interface LevelState {
  folders: TreeFolder[]
  files: LocalEntry[]
  more: boolean
  error: string | null
}

function FolderLevel({ libraryId, parent, version, sort, depth, onFile, onExclude }: LevelProps) {
  const [level, setLevel] = useState<LevelState | null>(null)
  // Pages shown, per order. When the index changes the same pages are read again, so the list does not shrink.
  const [shown, setShown] = useState({ sort, pages: 1 })
  const pages = shown.sort === sort ? shown.pages : 1
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const requests = Array.from({ length: pages }, (_, page) => companion.tree(libraryId, parent, { sort, offset: page * PAGE, signal: controller.signal }))
    Promise.all(requests).then(
      (results) => {
        const last = results[results.length - 1]
        setLevel({
          folders: results.flatMap((result) => result.folders),
          files: results.flatMap((result) => result.files),
          // Older companions do not say; a full page probably means more follow.
          more: last.moreFolders !== undefined ? Boolean(last.moreFolders || last.moreFiles) : last.folders.length === PAGE || last.files.length === PAGE,
          error: null,
        })
        setLoadingMore(false)
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setLevel({ folders: [], files: [], more: false, error: errorText(error, 'This folder could not be listed.') })
        setLoadingMore(false)
      },
    )
    return () => controller.abort()
  }, [libraryId, parent, sort, version, pages])

  if (!level) {
    return (
      <p className="folder-tree__loading" style={{ paddingInlineStart: depth * 20 + 12 }} role="status">
        <span className="app-spinner app-spinner--small" aria-hidden="true" /> Loading...
      </p>
    )
  }
  if (level.error) {
    return (
      <p className="notice notice--error" role="alert">
        {level.error}
      </p>
    )
  }
  if (level.folders.length === 0 && level.files.length === 0) {
    return (
      <p className="folder-tree__empty" style={{ paddingInlineStart: depth * 20 + 12 }}>
        {parent === null ? 'Nothing has been indexed in this library yet.' : 'No indexed documents in this folder.'}
      </p>
    )
  }
  return (
    <ul role="group" className="folder-tree__level">
      {level.folders.map((folder) => (
        <FolderNode key={folder.id} folder={folder} libraryId={libraryId} version={version} sort={sort} depth={depth} onFile={onFile} onExclude={onExclude} />
      ))}
      {level.files.map((file) => (
        <li key={file.id} role="treeitem" className="folder-tree__row folder-tree__file" style={{ paddingInlineStart: depth * 20 + 34 }}>
          <DocumentIcon kind={iconKinds.has(file.kind as DocumentKind) ? (file.kind as DocumentKind) : 'other'} />
          <button type="button" className="folder-tree__name" onClick={() => onFile(file)} title={file.name}>
            {file.name}
          </button>
          <span className="folder-tree__meta">
            {kindLabels[file.kind]} · {formatFileSize(file.size)}
            {sort === 'modified' && file.modifiedAt ? ` · ${dateFormat.format(file.modifiedAt)}` : ''}
          </span>
        </li>
      ))}
      {level.more ? (
        <li className="folder-tree__more" style={{ paddingInlineStart: depth * 20 + 34 }}>
          <span>
            Showing {numberFormat.format(level.folders.length)} {level.folders.length === 1 ? 'folder' : 'folders'} and {numberFormat.format(level.files.length)}{' '}
            {level.files.length === 1 ? 'file' : 'files'}.
          </span>
          <button
            type="button"
            className="text-button"
            disabled={loadingMore}
            onClick={() => {
              setLoadingMore(true)
              setShown({ sort, pages: pages + 1 })
            }}
          >
            {loadingMore ? 'Loading...' : 'Show more'}
          </button>
        </li>
      ) : null}
    </ul>
  )
}

interface NodeProps extends Omit<LevelProps, 'parent'> {
  folder: TreeFolder
}

function FolderNode({ folder, libraryId, version, sort, depth, onFile, onExclude }: NodeProps) {
  const [open, setOpen] = useState(false)
  return (
    <li role="treeitem" aria-expanded={open}>
      <div className="folder-tree__row" style={{ paddingInlineStart: depth * 20 + 8 }}>
        <button type="button" className="folder-tree__toggle" onClick={() => setOpen((value) => !value)} aria-label={open ? `Close ${folder.name}` : `Open ${folder.name}`}>
          {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        </button>
        <Folder aria-hidden="true" className="folder-tree__folder-icon" />
        <button type="button" className="folder-tree__name" onClick={() => setOpen((value) => !value)} title={folder.path}>
          {folder.name}
        </button>
        <span className="folder-tree__meta">{numberFormat.format(folder.files)} documents</span>
        <button type="button" className="icon-button folder-tree__exclude" onClick={() => onExclude(folder)} aria-label={`Exclude ${folder.name}`} title="Exclude this folder">
          <EyeOff aria-hidden="true" />
        </button>
      </div>
      {open ? <FolderLevel libraryId={libraryId} parent={folder.id} version={version} sort={sort} depth={depth + 1} onFile={onFile} onExclude={onExclude} /> : null}
    </li>
  )
}
