import { ChevronRight, FolderOpen } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { VaultDocument } from '../../types/document'

interface BreadcrumbsProps {
  path: VaultDocument[]
}

export function Breadcrumbs({ path }: BreadcrumbsProps) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <Link to="/folders">
        <FolderOpen aria-hidden="true" />
        <span>Folders</span>
      </Link>
      {path.map((folder, index) => (
        <span key={folder.id} className="breadcrumbs__step">
          <ChevronRight aria-hidden="true" />
          <Link to={`/folders/${folder.id}`} aria-current={index === path.length - 1 ? 'page' : undefined}>
            {folder.name}
          </Link>
        </span>
      ))}
    </nav>
  )
}
