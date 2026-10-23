import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, EyeOff, Folder } from 'lucide-react'
import { DocumentIcon } from '../documents/DocumentIcon'
import { companion, type LocalEntry, type TreeFolder } from '../../services/desktopCompanion'
import type { DocumentKind } from '../../types/document'
import { formatFileSize } from '../../utils/formatters'
import { errorText, kindLabels, numberFormat } from './libraryText'

const iconKinds = new Set<DocumentKind>(['pdf', 'image', 'word', 'spreadsheet', 'presentation', 'folder', 'html', 'text', 'ebook'])
const PAGE = 200

interface FolderTreeProps {
  libraryId: number
  /** Changes when the library's index changes, so open folders are listed again. */
  version: string
  onFile: (entry: LocalEntry) => void
  onExclude: (folder: TreeFolder) => void
}

// The library's folders, read from the index one level at a time as they are
// opened, so even a library with thousands of folders lists quickly.
export function FolderTree({ libraryId, version, onFile, onExclude }: FolderTreeProps) {
  return (
    <div className="folder-tree" role="tree" aria-label="Folders in this library">
      <FolderLevel libraryId={libraryId} parent={null} version={version} depth={0} onFile={onFile} onExclude={onExclude} />
    </div>
  )
}

interface LevelProps extends FolderTreeProps {
  parent: number | null
  depth: number
}

function FolderLevel({ libraryId, parent, version, depth, onFile, onExclude }: LevelProps) {
  const [level, setLevel] = useState<{ key: string; folders: TreeFolder[]; files: LocalEntry[]; error: string | null } | null>(null)
  const key = `${libraryId}:${parent}:${version}`

  useEffect(() => {
    const controller = new AbortController()
    companion.tree(libraryId, parent, controller.signal).then(
      (result) => setLevel({ key, folders: result.folders, files: result.files, error: null }),
      (error: unknown) => {
        if (!controller.signal.aborted) setLevel({ key, folders: [], files: [], error: errorText(error, 'This folder could not be listed.') })
      },
    )
    return () => controller.abort()
  }, [libraryId, parent, key])

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
        <FolderNode key={folder.id} folder={folder} libraryId={libraryId} version={version} depth={depth} onFile={onFile} onExclude={onExclude} />
      ))}
      {level.files.map((file) => (
        <li key={file.id} role="treeitem" className="folder-tree__row folder-tree__file" style={{ paddingInlineStart: depth * 20 + 34 }}>
          <DocumentIcon kind={iconKinds.has(file.kind as DocumentKind) ? (file.kind as DocumentKind) : 'other'} />
          <button type="button" className="folder-tree__name" onClick={() => onFile(file)} title={file.name}>
            {file.name}
          </button>
          <span className="folder-tree__meta">
            {kindLabels[file.kind]} · {formatFileSize(file.size)}
          </span>
        </li>
      ))}
      {level.folders.length === PAGE || level.files.length === PAGE ? (
        <li className="folder-tree__more" style={{ paddingInlineStart: depth * 20 + 34 }}>
          Showing the first {PAGE} items. Use Search to find the rest.
        </li>
      ) : null}
    </ul>
  )
}

interface NodeProps extends Omit<LevelProps, 'parent'> {
  folder: TreeFolder
}

function FolderNode({ folder, libraryId, version, depth, onFile, onExclude }: NodeProps) {
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
      {open ? <FolderLevel libraryId={libraryId} parent={folder.id} version={version} depth={depth + 1} onFile={onFile} onExclude={onExclude} /> : null}
    </li>
  )
}
