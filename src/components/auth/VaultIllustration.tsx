import { FileText, Folder, Home, Search, Star, Upload, Clock3 } from 'lucide-react'
import vaultLogo from '../../assets/dv.png'

// A drawn picture of the app for the sign-in page: the workspace on a laptop
// with a phone beside it. Purely decorative, so it is hidden from screen readers.

const files = [
  { name: 'Degree Certificate.pdf', kind: 'PDF', tone: 'pdf', meta: '1.7 MB · Certificates' },
  { name: 'Internship Report 2026.docx', kind: 'DOC', tone: 'doc', meta: '3.2 MB · Reports' },
  { name: 'Budget 2026.xlsx', kind: 'XLS', tone: 'xls', meta: '507 KB · Work' },
  { name: 'Passport photo.png', kind: 'IMG', tone: 'img', meta: '634 KB · Personal' },
]

const folders = ['Certificates', 'Reports', 'Housing']

export function VaultIllustration() {
  return (
    <div className="vi" aria-hidden="true">
      <div className="vi-laptop">
        <div className="vi-laptop__screen">
          <aside className="vi-side">
            <span className="vi-side__brand">
              <img src={vaultLogo} alt="" />
            </span>
            <span className="vi-side__link">
              <Home /> Dashboard
            </span>
            <span className="vi-side__link is-active">
              <FileText /> All files
            </span>
            <span className="vi-side__link">
              <Folder /> Folders
            </span>
            <span className="vi-side__link">
              <Star /> Favorites
            </span>
            <span className="vi-side__link">
              <Clock3 /> Recent
            </span>
            <span className="vi-side__drive">
              <strong>Google Drive</strong>
              <i>
                <b />
              </i>
            </span>
          </aside>
          <div className="vi-main">
            <div className="vi-top">
              <span className="vi-search">
                <Search /> Search names, #tags and text
              </span>
              <span className="vi-upload">
                <Upload /> Upload
              </span>
            </div>
            <div className="vi-folders">
              {folders.map((folder) => (
                <span key={folder} className="vi-folder">
                  <Folder /> {folder}
                </span>
              ))}
            </div>
            <div className="vi-rows">
              {files.map((file) => (
                <span key={file.name} className="vi-row">
                  <em className={`vi-badge vi-badge--${file.tone}`}>{file.kind}</em>
                  <span className="vi-row__name">{file.name}</span>
                  <span className="vi-row__meta">{file.meta}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="vi-laptop__base" />
      </div>

      <div className="vi-phone">
        <div className="vi-phone__screen">
          <strong className="vi-phone__title">Search</strong>
          <span className="vi-search vi-search--phone">
            <Search /> certificate
          </span>
          {files.slice(0, 3).map((file) => (
            <span key={file.name} className="vi-card">
              <em className={`vi-badge vi-badge--${file.tone}`}>{file.kind}</em>
              <span>
                <span className="vi-row__name">{file.name}</span>
                <span className="vi-row__meta">{file.meta}</span>
              </span>
            </span>
          ))}
          <span className="vi-tabs">
            <span className="is-active">Files</span>
            <span>Search</span>
            <span>Folders</span>
          </span>
        </div>
      </div>
    </div>
  )
}
