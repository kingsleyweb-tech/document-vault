import { useState } from 'react'
import {
  Award,
  BarChart3,
  Briefcase,
  Download,
  Eye,
  FolderOpen,
  GraduationCap,
  Heart,
  Home,
  Pencil,
  Shield,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import type { DocumentCategory, VaultDocument } from '../types/document'
import { DocumentIcon } from '../components/documents/DocumentIcon'

interface CategoriesProps {
  categories: DocumentCategory[]
  documents: VaultDocument[]
  onView: (documentRecord: VaultDocument) => void
  onDownload: (documentRecord: VaultDocument) => void
  onRename: (documentRecord: VaultDocument) => void
  onFavorite: (documentRecord: VaultDocument) => void
  onTrash: (documentRecord: VaultDocument) => void
}

const categoryIconMap: Record<DocumentCategory, LucideIcon> = {
  Personal: Home,
  School: GraduationCap,
  Military: Shield,
  Work: Briefcase,
  Certificates: Award,
  Reports: BarChart3,
  Other: FolderOpen,
}

const categoryColorMap: Record<DocumentCategory, string> = {
  Personal: '#2563eb',     // Blue
  School: '#8b5cf6',       // Purple
  Military: '#b91c1c',     // Red
  Work: '#0891b2',         // Cyan
  Certificates: '#ea580c', // Orange
  Reports: '#16a34a',      // Green
  Other: '#4b5563',        // Slate
}

export function Categories({
  categories,
  documents,
  onView,
  onDownload,
  onRename,
  onFavorite,
  onTrash,
}: CategoriesProps) {
  const [expandedCategory, setExpandedCategory] = useState<DocumentCategory | null>(null)

  return (
    <section className="page-section animate-fade-in">
      <div className="categories-container">
        <header className="categories-header">
          <h1>Categories</h1>
          <p>Organize and review your documents by department and file classification.</p>
        </header>

        <div className="categories-grid">
          {categories.map((category) => {
            const Icon = categoryIconMap[category] ?? FolderOpen
            const color = categoryColorMap[category] ?? '#2563eb'
            const categoryDocs = documents.filter((doc) => doc.category === category && !doc.isDeleted)
            const count = categoryDocs.length
            const isExpanded = expandedCategory === category

            return (
              <div
                key={category}
                className={`category-card ${isExpanded ? 'is-expanded' : ''}`}
                onClick={() => setExpandedCategory(isExpanded ? null : category)}
                style={{ cursor: 'pointer' }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setExpandedCategory(isExpanded ? null : category)
                  }
                }}
                aria-expanded={isExpanded}
                aria-label={`${category} documents, ${count} items`}
              >
                <div className="category-card-header">
                  <div
                    className="category-icon-wrapper"
                    style={{
                      backgroundColor: `${color}12`, // ~7% opacity soft tint background
                      color: color,
                    }}
                  >
                    <Icon aria-hidden="true" size={24} />
                  </div>
                </div>
                <div className="category-card-content">
                  <h3>{category}</h3>
                  <span>{count} {count === 1 ? 'document' : 'documents'}</span>
                </div>

                {isExpanded && (
                  <div className="category-docs-dropdown" onClick={(e) => e.stopPropagation()}>
                    {categoryDocs.length > 0 ? (
                      <div className="category-docs-list">
                        {categoryDocs.map((doc) => (
                          <div key={doc.id} className="category-doc-item">
                            <div className="category-doc-info" onClick={() => onView(doc)} style={{ cursor: 'pointer' }}>
                              <span className="category-doc-icon">
                                <DocumentIcon kind={doc.fileType} />
                              </span>
                              <span className="category-doc-name" title={doc.originalName}>
                                {doc.name}
                              </span>
                            </div>
                            <div className="category-doc-actions">
                              <button type="button" onClick={() => onView(doc)} aria-label="View document">
                                <Eye size={16} />
                              </button>
                              {doc.fileType !== 'folder' && (
                                <button type="button" onClick={() => onDownload(doc)} aria-label="Download document">
                                  <Download size={16} />
                                </button>
                              )}
                              <button type="button" onClick={() => onRename(doc)} aria-label="Rename document">
                                <Pencil size={16} />
                              </button>
                              <button
                                type="button"
                                className={doc.isFavorite ? 'is-active' : ''}
                                onClick={() => onFavorite(doc)}
                                aria-label={doc.isFavorite ? 'Remove favorite' : 'Add favorite'}
                              >
                                <Heart size={16} />
                              </button>
                              <button type="button" onClick={() => onTrash(doc)} aria-label="Delete document">
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="category-docs-empty">No files under this category.</div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
