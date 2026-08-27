import {
  Apple,
  Eraser,
  Globe,
  Grid2X2,
  Laptop,
  LayoutDashboard,
  List,
  Moon,
  SlidersHorizontal,
  Smartphone,
  Sun,
  Upload,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { DocumentCategory, SortMode, ThemeMode, ViewMode } from '../types/document'

interface SettingsProps {
  themeMode: ThemeMode
  viewMode: ViewMode
  sortMode: SortMode
  category: DocumentCategory | 'All'
  categories: DocumentCategory[]
  onThemeModeChange: (themeMode: ThemeMode) => void
  onViewModeChange: (mode: ViewMode) => void
  onSortModeChange: (mode: SortMode) => void
  onCategoryChange: (category: DocumentCategory | 'All') => void
  onSearchClear: () => void
  onUploadClick: () => void
}

export function Settings({
  themeMode,
  viewMode,
  sortMode,
  category,
  categories,
  onThemeModeChange,
  onViewModeChange,
  onSortModeChange,
  onCategoryChange,
  onSearchClear,
  onUploadClick,
}: SettingsProps) {
  const navigate = useNavigate()

  return (
    <section className="page-section">
      <div className="settings-header">
        <span>Application controls</span>
        <h1>Settings</h1>
        <p>Personalize the vault, tune dashboard defaults, and run common actions from one place.</p>
      </div>

      <div className="settings-grid">
        <section className="settings-panel">
          <div className="settings-panel-heading">
            <SlidersHorizontal aria-hidden="true" />
            <div>
              <h2>Appearance</h2>
              <p>Choose a clean white workspace or a black dashboard theme.</p>
            </div>
          </div>
          <div className="settings-control-row">
            <button
              type="button"
              className={themeMode === 'light' ? 'settings-choice is-active' : 'settings-choice'}
              onClick={() => onThemeModeChange('light')}
            >
              <Sun aria-hidden="true" />
              <span>Light</span>
            </button>
            <button
              type="button"
              className={themeMode === 'dark' ? 'settings-choice is-active' : 'settings-choice'}
              onClick={() => onThemeModeChange('dark')}
            >
              <Moon aria-hidden="true" />
              <span>Dark</span>
            </button>
          </div>
        </section>

        <section className="settings-panel">
          <div className="settings-panel-heading">
            <LayoutDashboard aria-hidden="true" />
            <div>
              <h2>Dashboard View</h2>
              <p>Set how documents appear across the vault.</p>
            </div>
          </div>
          <div className="settings-control-row">
            <button
              type="button"
              className={viewMode === 'grid' ? 'settings-choice is-active' : 'settings-choice'}
              onClick={() => onViewModeChange('grid')}
            >
              <Grid2X2 aria-hidden="true" />
              <span>Grid</span>
            </button>
            <button
              type="button"
              className={viewMode === 'list' ? 'settings-choice is-active' : 'settings-choice'}
              onClick={() => onViewModeChange('list')}
            >
              <List aria-hidden="true" />
              <span>List</span>
            </button>
          </div>
          <label className="settings-field">
            <span>Default sort</span>
            <select value={sortMode} onChange={(event) => onSortModeChange(event.target.value as SortMode)}>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="name-asc">Name A-Z</option>
              <option value="name-desc">Name Z-A</option>
              <option value="largest">Largest</option>
              <option value="smallest">Smallest</option>
              <option value="updated">Recently updated</option>
            </select>
          </label>
          <label className="settings-field">
            <span>Category focus</span>
            <select
              value={category}
              onChange={(event) => onCategoryChange(event.target.value as DocumentCategory | 'All')}
            >
              <option>All</option>
              {categories.map((categoryName) => (
                <option key={categoryName}>{categoryName}</option>
              ))}
            </select>
          </label>
        </section>

        <section className="settings-panel settings-panel--wide">
          <div className="settings-panel-heading">
            <Eraser aria-hidden="true" />
            <div>
              <h2>Quick Actions</h2>
              <p>Jump back into the vault or reset working filters instantly.</p>
            </div>
          </div>
          <div className="settings-actions">
            <button type="button" className="secondary-button" onClick={() => navigate('/')}>
              <LayoutDashboard aria-hidden="true" />
              <span>Open Dashboard</span>
            </button>
            <button type="button" className="secondary-button" onClick={onSearchClear}>
              <Eraser aria-hidden="true" />
              <span>Clear Search</span>
            </button>
            <button type="button" className="primary-button" onClick={onUploadClick}>
              <Upload aria-hidden="true" />
              <span>Upload Files</span>
            </button>
          </div>
        </section>

        <section className="settings-panel settings-panel--wide">
          <div className="settings-panel-heading">
            <Smartphone aria-hidden="true" />
            <div>
              <h2>Install Document Vault as an App</h2>
              <p>Use these steps after the website has been opened in a supported browser.</p>
            </div>
          </div>

          <div className="install-guide-grid">
            <article className="install-guide-card">
              <Apple aria-hidden="true" />
              <div>
                <h3>iPhone and iPad</h3>
                <ol>
                  <li>Open Document Vault in Safari.</li>
                  <li>Tap the Share button.</li>
                  <li>Choose Add to Home Screen.</li>
                  <li>Tap Add to install it.</li>
                </ol>
              </div>
            </article>

            <article className="install-guide-card">
              <Globe aria-hidden="true" />
              <div>
                <h3>Android</h3>
                <ol>
                  <li>Open Document Vault in Chrome.</li>
                  <li>Tap the browser menu.</li>
                  <li>Choose Install app or Add to Home screen.</li>
                  <li>Confirm Install.</li>
                </ol>
              </div>
            </article>

            <article className="install-guide-card">
              <Laptop aria-hidden="true" />
              <div>
                <h3>Windows PC</h3>
                <ol>
                  <li>Open Document Vault in Chrome or Microsoft Edge.</li>
                  <li>Click the install icon in the address bar.</li>
                  <li>Choose Install.</li>
                  <li>Launch it from the Start menu or desktop.</li>
                </ol>
              </div>
            </article>

            <article className="install-guide-card">
              <Laptop aria-hidden="true" />
              <div>
                <h3>Mac and Computers</h3>
                <ol>
                  <li>Open Document Vault in Chrome, Edge, or Safari.</li>
                  <li>Use the browser install option when available.</li>
                  <li>On Safari, choose Add to Dock if shown.</li>
                  <li>Open the app from your applications or dock.</li>
                </ol>
              </div>
            </article>
          </div>

          <p className="install-guide-note">
            For installation to appear on phones and computers, Document Vault should be hosted with HTTPS.
          </p>
        </section>
      </div>
    </section>
  )
}
