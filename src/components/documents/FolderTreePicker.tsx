import { useState } from 'react'
import { Folder, ChevronRight, ChevronDown, X, FolderTree } from 'lucide-react'
import type { VaultDocument } from '../../types/document'

interface FolderTreePickerProps {
  open: boolean
  documents: VaultDocument[]
  disabledFolderIds: Set<string>
  onClose: () => void
  onMoveHere: (destinationFolderId: string | null) => void
  title: string
}

export function FolderTreePicker({
  open,
  documents,
  disabledFolderIds,
  onClose,
  onMoveHere,
  title,
}: FolderTreePickerProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())

  if (!open) return null

  // Get active folders
  const allFolders = documents.filter((d) => d.fileType === 'folder' && !d.isDeleted)

  const toggleExpand = (folderId: string) => {
    setExpandedFolders((current) => {
      const next = new Set(current)
      if (next.has(folderId)) {
        next.delete(folderId)
      } else {
        next.add(folderId)
      }
      return next
    })
  }

  const renderFolderNode = (folder: VaultDocument, depth: number) => {
    const subfolders = allFolders.filter((f) => f.parentId === folder.id)
    const hasSubfolders = subfolders.length > 0
    const isExpanded = expandedFolders.has(folder.id)
    const isDisabled = disabledFolderIds.has(folder.id)
    const isSelected = selectedFolderId === folder.id

    return (
      <div key={folder.id} className="folder-tree-node-wrapper">
        <div
          className={`folder-tree-node ${isSelected ? 'is-selected' : ''} ${isDisabled ? 'is-disabled' : ''}`}
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
          onClick={() => {
            if (!isDisabled) {
              setSelectedFolderId(folder.id)
            }
          }}
        >
          <span
            className="folder-tree-arrow"
            onClick={(e) => {
              e.stopPropagation()
              if (hasSubfolders) toggleExpand(folder.id)
            }}
          >
            {hasSubfolders ? (
              isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />
            ) : (
              <span style={{ width: 16, display: 'inline-block' }} />
            )}
          </span>
          <Folder size={18} className="folder-tree-icon" />
          <span className="folder-tree-name">{folder.name}</span>
        </div>
        {hasSubfolders && isExpanded && (
          <div className="folder-tree-children">
            {subfolders.map((sub) => renderFolderNode(sub, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  // Root folders (parentId is null)
  const rootFolders = allFolders.filter((f) => f.parentId === null)

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="folder-tree-picker" role="dialog" aria-modal="true" aria-labelledby="picker-title">
        <header>
          <div>
            <h2 id="picker-title">{title}</h2>
            <p>Select a destination folder in your library.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="dialog-body folder-tree-body">
          {/* Root Selection */}
          <div
            className={`folder-tree-node root-node ${selectedFolderId === null ? 'is-selected' : ''}`}
            onClick={() => setSelectedFolderId(null)}
          >
            <FolderTree size={18} className="folder-tree-icon" />
            <strong>Document Vault (Root)</strong>
          </div>

          <div className="folder-tree-scroll">
            {rootFolders.length > 0 ? (
              rootFolders.map((rootFolder) => renderFolderNode(rootFolder, 0))
            ) : (
              <div className="notice" style={{ padding: '20px 0', textAlign: 'center', fontSize: '13px' }}>
                No subfolders created yet.
              </div>
            )}
          </div>
        </div>

        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => onMoveHere(selectedFolderId)}
          >
            Move Here
          </button>
        </footer>
      </section>
    </div>
  )
}
