import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FolderInput, Home } from 'lucide-react'
import type { VaultDocument } from '../../types/document'
import { Dialog } from '../ui/Dialog'
import { DocumentIcon } from './DocumentIcon'

interface FolderTreePickerProps {
  open: boolean
  documents: VaultDocument[]
  disabledFolderIds: Set<string>
  onClose: () => void
  onMoveHere: (destinationFolderId: string | null) => void
  title: string
}

export function FolderTreePicker({ open, documents, disabledFolderIds, onClose, onMoveHere, title }: FolderTreePickerProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, VaultDocument[]>()
    for (const record of documents) {
      if (record.fileType !== 'folder' || record.isDeleted) continue
      const key = record.parentId ?? null
      map.set(key, [...(map.get(key) ?? []), record])
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    return map
  }, [documents])

  const toggleExpand = (folderId: string) =>
    setExpandedFolders((current) => {
      const next = new Set(current)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })

  const renderNode = (folder: VaultDocument, depth: number) => {
    const subfolders = childrenOf.get(folder.id) ?? []
    const isExpanded = expandedFolders.has(folder.id)
    const isDisabled = disabledFolderIds.has(folder.id)

    return (
      <div key={folder.id} role="treeitem" aria-expanded={subfolders.length ? isExpanded : undefined} aria-selected={selectedFolderId === folder.id}>
        <div
          className={`folder-tree-node${selectedFolderId === folder.id ? ' is-selected' : ''}${isDisabled ? ' is-disabled' : ''}`}
          style={{ paddingLeft: depth * 18 + 6 }}
        >
          {subfolders.length ? (
            <button
              type="button"
              className="folder-tree-arrow"
              onClick={() => toggleExpand(folder.id)}
              aria-label={isExpanded ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
            >
              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          ) : (
            <span className="folder-tree-spacer" />
          )}
          <button
            type="button"
            className="folder-tree-label"
            disabled={isDisabled}
            onClick={() => setSelectedFolderId(folder.id)}
            onDoubleClick={() => subfolders.length && toggleExpand(folder.id)}
          >
            <DocumentIcon kind="folder" size={15} />
            <span className="folder-tree-name">{folder.name}</span>
          </button>
        </div>
        {isExpanded ? subfolders.map((child) => renderNode(child, depth + 1)) : null}
      </div>
    )
  }

  const rootFolders = childrenOf.get(null) ?? []
  const destination = selectedFolderId ? documents.find((record) => record.id === selectedFolderId)?.name : 'My Vault'

  return (
    <Dialog
      open={open}
      title={title}
      description="Choose where to move it."
      icon={<FolderInput aria-hidden="true" />}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={() => onMoveHere(selectedFolderId)}>
            Move to {destination}
          </button>
        </>
      }
    >
      <div className="folder-tree" role="tree" aria-label="Folders">
        <div className={`folder-tree-node${selectedFolderId === null ? ' is-selected' : ''}`}>
          <button type="button" className="folder-tree-label" onClick={() => setSelectedFolderId(null)}>
            <span className="kind-icon kind-icon--folder" aria-hidden="true">
              <Home size={15} />
            </span>
            <strong className="folder-tree-name">My Vault</strong>
          </button>
        </div>
        <div className="folder-tree-scroll">
          {rootFolders.length > 0 ? (
            rootFolders.map((folder) => renderNode(folder, 1))
          ) : (
            <p className="folder-tree-empty">No folders yet.</p>
          )}
        </div>
      </div>
    </Dialog>
  )
}
