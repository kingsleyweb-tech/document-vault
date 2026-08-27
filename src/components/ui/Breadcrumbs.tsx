import { ChevronRight, Home } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { VaultDocument } from '../../types/document'

interface BreadcrumbsProps {
  path: VaultDocument[]
}

export function Breadcrumbs({ path }: BreadcrumbsProps) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <Link to="/" className="breadcrumb-item">
        <Home className="breadcrumb-home-icon" aria-hidden="true" />
        <span>All Documents</span>
      </Link>
      {path.map((folder) => (
        <div key={folder.id} className="breadcrumb-wrapper">
          <ChevronRight className="breadcrumb-separator" aria-hidden="true" />
          <Link to={`/folders/${folder.id}`} className="breadcrumb-item">
            {folder.name}
          </Link>
        </div>
      ))}
    </nav>
  )
}
