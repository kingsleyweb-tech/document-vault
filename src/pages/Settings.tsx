import { useState, type ReactNode } from 'react'
import { Grid2X2, ScanText, Ban, Laptop, List, Monitor, Moon, Smartphone, Sun, Tablet, Upload, Zap } from 'lucide-react'
import { sortOptions } from '../utils/sorting'
import { formatFileSize } from '../utils/formatters'
import { PageHeader } from '../components/ui/PageHeader'
import { useAllPreviewStatus } from '../hooks/usePreviewStatus'
import { isOcrEnabled, MAX_OCR_PAGES, setOcrEnabled } from '../services/ocr'
import { clearPreparedPreviews, isBackfillEnabled, retryPreview, setBackfillEnabled } from '../services/previewQueue'
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

const installGuides = [
  {
    icon: Smartphone,
    title: 'iPhone and iPad',
    steps: ['Open Document Vault in Safari.', 'Tap the Share button.', 'Choose Add to Home Screen.', 'Tap Add.'],
  },
  {
    icon: Tablet,
    title: 'Android',
    steps: ['Open Document Vault in Chrome.', 'Open the browser menu.', 'Choose Install app or Add to Home screen.', 'Confirm Install.'],
  },
  {
    icon: Monitor,
    title: 'Windows',
    steps: ['Open Document Vault in Chrome or Edge.', 'Click the install icon in the address bar.', 'Choose Install.', 'Launch it from the Start menu.'],
  },
  {
    icon: Laptop,
    title: 'Mac',
    steps: ['Open Document Vault in Chrome, Edge or Safari.', 'Use the browser install option.', 'In Safari, choose Add to Dock.', 'Open it from the Dock.'],
  },
]

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
  const [ocrEnabled, setOcrEnabledState] = useState(isOcrEnabled)
  const changeOcr = (enabled: boolean) => {
    setOcrEnabled(enabled)
    setOcrEnabledState(enabled)
  }

  return (
    <section className="page settings">
      <PageHeader title="Settings" description="Preferences are saved on this device." />

      <div className="settings-list">
        <section className="settings-section">
          <div className="settings-section__intro">
            <h2>Appearance</h2>
            <p>Light uses white and warm sand tones. Dark is easier on the eyes at night.</p>
          </div>
          <div className="settings-section__body">
            <div className="option-cards" role="radiogroup" aria-label="Theme">
              <OptionCard active={themeMode === 'light'} onClick={() => onThemeModeChange('light')} icon={<Sun aria-hidden="true" />} label="Light" />
              <OptionCard active={themeMode === 'dark'} onClick={() => onThemeModeChange('dark')} icon={<Moon aria-hidden="true" />} label="Dark" />
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section__intro">
            <h2>Library defaults</h2>
            <p>How files are shown when you open a page.</p>
          </div>
          <div className="settings-section__body">
            <div className="option-cards" role="radiogroup" aria-label="Layout">
              <OptionCard active={viewMode === 'grid'} onClick={() => onViewModeChange('grid')} icon={<Grid2X2 aria-hidden="true" />} label="Grid" />
              <OptionCard active={viewMode === 'list'} onClick={() => onViewModeChange('list')} icon={<List aria-hidden="true" />} label="List" />
            </div>
            <label className="field">
              <span>Sort order</span>
              <select value={sortMode} onChange={(event) => onSortModeChange(event.target.value as SortMode)}>
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Category filter in folders</span>
              <select value={category} onChange={(event) => onCategoryChange(event.target.value as DocumentCategory | 'All')}>
                <option value="All">All categories</option>
                {categories.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section__intro">
            <h2>Text in pictures and scans</h2>
            <p>
              Reads the words in photos and scanned PDFs (up to {MAX_OCR_PAGES} pages) so search can find them. It runs in this browser, so nothing is sent
              anywhere, but it is slow on large scans and uses more battery. New uploads are read straight away; older files are read the next time you open them.
            </p>
          </div>
          <div className="settings-section__body">
            <div className="option-cards" role="radiogroup" aria-label="Text recognition">
              <OptionCard active={ocrEnabled} onClick={() => changeOcr(true)} icon={<ScanText aria-hidden="true" />} label="On" />
              <OptionCard active={!ocrEnabled} onClick={() => changeOcr(false)} icon={<Ban aria-hidden="true" />} label="Off" />
            </div>
          </div>
        </section>

        <PreparedPreviewsSection />

        <section className="settings-section">
          <div className="settings-section__intro">
            <h2>Shortcuts</h2>
            <p>Press Ctrl and K anywhere to jump to search.</p>
          </div>
          <div className="settings-section__body settings-section__buttons">
            <button type="button" className="secondary-button" onClick={onSearchClear}>
              Clear search
            </button>
            <button type="button" className="primary-button" onClick={onUploadClick}>
              <Upload aria-hidden="true" />
              <span>Upload files</span>
            </button>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section__intro">
            <h2>Install as an app</h2>
            <p>Document Vault can be added to your home screen or desktop. Installing needs the site to be served over HTTPS.</p>
          </div>
          <div className="settings-section__body install-grid">
            {installGuides.map((guide) => (
              <article key={guide.title} className="install-card">
                <h3>
                  <guide.icon aria-hidden="true" />
                  {guide.title}
                </h3>
                <ol>
                  {guide.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  )
}

/** Background preparation on this device: progress, failures, space used, and the switch for older files. */
function PreparedPreviewsSection() {
  const all = useAllPreviewStatus()
  const [backfill, setBackfillState] = useState(isBackfillEnabled)
  const [confirmClear, setConfirmClear] = useState(false)
  const count = (status: string) => all.filter((meta) => meta.status === status).length
  const bytes = all.reduce((total, meta) => total + meta.originalBytes + meta.imageBytes, 0)
  const failed = all.filter((meta) => meta.status === 'failed' && meta.error !== 'Cancelled')
  const waiting = all.filter((meta) => meta.status === 'queued' && meta.waitingFor).length
  const changeBackfill = (enabled: boolean) => {
    setBackfillEnabled(enabled)
    setBackfillState(enabled)
  }

  return (
    <section className="settings-section" aria-labelledby="prepared-previews-heading">
      <div className="settings-section__intro">
        <h2 id="prepared-previews-heading">Fast opening on this device</h2>
        <p>
          New uploads, documents you open, and a few of your favourite and recent documents each visit are prepared in the background and kept in this
          browser, so they open at once, also offline. They stay private to this device and are removed when you sign out or delete the document.
        </p>
      </div>
      <div className="settings-section__body">
        <dl className="preparation-stats">
          <div><dt>Ready</dt><dd>{count('ready') + count('partial')}</dd></div>
          <div><dt>Waiting</dt><dd>{count('queued')}</dd></div>
          <div><dt>Preparing</dt><dd>{count('processing')}</dd></div>
          <div><dt>Failed</dt><dd>{failed.length}</dd></div>
          <div><dt>Space used</dt><dd>{formatFileSize(bytes)}</dd></div>
        </dl>
        {waiting ? <p className="settings-note">{waiting} waiting for Google Drive or the internet.</p> : null}
        {failed.length ? (
          <ul className="preparation-failures">
            {failed.slice(0, 10).map((meta) => (
              <li key={meta.fileId}>
                <span>
                  <strong>{meta.name}</strong>
                  <small>{meta.error}</small>
                </span>
                <button type="button" className="secondary-button" onClick={() => retryPreview(meta.fileId)}>
                  Try again
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="option-cards" role="radiogroup" aria-label="Prepare older documents in the background">
          <OptionCard active={backfill} onClick={() => changeBackfill(true)} icon={<Zap aria-hidden="true" />} label="Prepare recent files" />
          <OptionCard active={!backfill} onClick={() => changeBackfill(false)} icon={<Ban aria-hidden="true" />} label="Only uploads and opened" />
        </div>
        <div className="settings-section__buttons">
          {confirmClear ? (
            <>
              <button type="button" className="secondary-button" onClick={() => setConfirmClear(false)}>
                Keep them
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() => {
                  setConfirmClear(false)
                  void clearPreparedPreviews()
                }}
              >
                Remove from this device
              </button>
            </>
          ) : (
            <button type="button" className="secondary-button" onClick={() => setConfirmClear(true)} disabled={!all.length && !bytes}>
              Remove prepared copies…
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

function OptionCard({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button type="button" role="radio" aria-checked={active} className={active ? 'option-card is-active' : 'option-card'} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  )
}
