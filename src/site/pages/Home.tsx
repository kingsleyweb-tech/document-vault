import { Link } from 'react-router-dom'
import {
  BookOpen,
  CheckCircle2,
  Download,
  FileText,
  Files,
  FolderOpen,
  Globe,
  History,
  LifeBuoy,
  Monitor,
  Search,
  Smartphone,
  Star,
} from 'lucide-react'
import { features, trustPoints } from '../content'
import { AppLink, ArrowLink, ClosingCta, SectionHead } from '../ui'
import { usePageMeta } from '../meta'

const highlights = features.slice(0, 6)

export function Home() {
  usePageMeta(
    'Document Vault',
    'A private workspace for certificates, reports and personal records. Organise, search and preview documents stored in your own Google Drive.',
  )

  return (
    <>
      <section className="site-hero">
        <div className="site-container site-hero__grid">
          <div>
            <span className="site-eyebrow">Private document workspace</span>
            <h1>Your important records, organised and easy to find.</h1>
            <p className="site-hero__lead">
              Document Vault keeps certificates, service documents, reports and personal files in one calm workspace. Every
              file is stored in your own Google Drive, and only you can see it.
            </p>
            <div className="site-hero__actions">
              <Link to="/register" className="site-button site-button--primary">
                Get started
              </Link>
              <Link to="/downloads" className="site-button site-button--secondary">
                <Download aria-hidden="true" />
                Downloads
              </Link>
            </div>
            <p className="site-hero__note">Sign in with your Google account. Works in the browser, as an installed app, or on the desktop.</p>
          </div>
          <WorkspacePreview />
        </div>
      </section>

      <section className="site-section" aria-labelledby="overview-title">
        <div className="site-container site-split">
          <div>
            <span className="site-eyebrow">Overview</span>
            <h2 id="overview-title" className="site-h2">
              One place for the documents you cannot afford to lose.
            </h2>
          </div>
          <div>
            <p className="site-lead">
              Important papers end up scattered across email attachments, phone photos, USB drives and downloads folders.
              Document Vault gives them a home: upload them once, sort them into folders and categories, and find any of them
              in seconds with search that also reads the text inside your documents.
            </p>
            <ul className="site-checks site-gap-top">
              <li>
                <CheckCircle2 aria-hidden="true" />
                <span>
                  <strong>Stored in your Google Drive</strong>
                  Your files stay in your own Drive account, not on a third-party server.
                </span>
              </li>
              <li>
                <CheckCircle2 aria-hidden="true" />
                <span>
                  <strong>Readable anywhere</strong>
                  Preview PDFs, Office files, images and more without downloading them.
                </span>
              </li>
              <li>
                <CheckCircle2 aria-hidden="true" />
                <span>
                  <strong>Built for a few trusted people</strong>
                  Each person signs in with their own Google account and sees only their own vault.
                </span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="site-section site-section--sand" aria-labelledby="features-title">
        <div className="site-container">
          <SectionHead eyebrow="Features" title="Everything you need to keep records in order" id="features-title">
            The essentials, done carefully: upload, organise, search and read your documents.
          </SectionHead>
          <div className="site-grid site-grid--3">
            {highlights.map((feature) => (
              <article key={feature.title} className="site-card">
                <span className="site-card__icon">
                  <feature.icon aria-hidden="true" />
                </span>
                <h3>{feature.title}</h3>
                <p>{feature.summary}</p>
              </article>
            ))}
          </div>
          <p className="site-gap-top">
            <ArrowLink to="/features">See all features</ArrowLink>
          </p>
        </div>
      </section>

      <section className="site-section" aria-labelledby="how-title">
        <div className="site-container">
          <SectionHead eyebrow="How it works" title="Up and running in a few minutes" id="how-title" />
          <ol className="site-steps">
            <li>
              <h3>Sign in with Google</h3>
              <p>Choose your Google account. Document Vault asks only for access to the files it creates or that you open with it.</p>
            </li>
            <li>
              <h3>Your vault is created</h3>
              <p>A Document Vault folder is made in your Google Drive. Everything you upload goes there.</p>
            </li>
            <li>
              <h3>Add your documents</h3>
              <p>Upload files or whole folders, then give them categories and tags so they are easy to find.</p>
            </li>
            <li>
              <h3>Find and open them anywhere</h3>
              <p>Search, preview and download from the browser, the installed app or the desktop app.</p>
            </li>
          </ol>
        </div>
      </section>

      <section className="site-section site-section--sand" aria-labelledby="experience-title">
        <div className="site-container">
          <SectionHead eyebrow="Choose your experience" title="Use it the way that suits you" id="experience-title">
            All three use the same account and the same vault, so you can switch between them freely.
          </SectionHead>
          <div className="site-grid site-grid--3">
            <article className="site-card">
              <span className="site-card__icon">
                <Globe aria-hidden="true" />
              </span>
              <h3>Web app</h3>
              <p>Open Document Vault in any modern browser. Nothing to install.</p>
              <div className="site-card__foot">
                <AppLink className="site-button site-button--primary">Open the web app</AppLink>
              </div>
            </article>
            <article className="site-card">
              <span className="site-card__icon">
                <Smartphone aria-hidden="true" />
              </span>
              <h3>Installed app</h3>
              <p>Add it to your phone’s home screen or your computer’s app list. It opens in its own window.</p>
              <div className="site-card__foot">
                <Link to="/downloads#install" className="site-button site-button--secondary">
                  How to install
                </Link>
              </div>
            </article>
            <article className="site-card">
              <span className="site-card__icon">
                <Monitor aria-hidden="true" />
              </span>
              <h3>Desktop app</h3>
              <p>For Windows, macOS and Linux. Adds search across folders on your own computer.</p>
              <div className="site-card__foot">
                <Link to="/downloads" className="site-button site-button--secondary">
                  Desktop downloads
                </Link>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="site-section" aria-labelledby="trust-title">
        <div className="site-container site-split">
          <div>
            <span className="site-eyebrow">Security and trust</span>
            <h2 id="trust-title" className="site-h2">
              Private by design
            </h2>
            <p className="site-lead site-gap-top">
              Document Vault is built so your documents stay yours. Read exactly how it works, including what is not done
              yet, on the security page.
            </p>
            <p className="site-gap-top">
              <ArrowLink to="/security">How your data is protected</ArrowLink>
            </p>
          </div>
          <ul className="site-checks">
            {trustPoints.map((point) => (
              <li key={point.title}>
                <point.icon aria-hidden="true" />
                <span>
                  <strong>{point.title}</strong>
                  {point.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="site-section site-section--sand" aria-labelledby="help-title">
        <div className="site-container">
          <SectionHead eyebrow="Documentation and support" title="Help when you need it" id="help-title" />
          <div className="site-grid site-grid--3">
            <article className="site-card">
              <span className="site-card__icon">
                <BookOpen aria-hidden="true" />
              </span>
              <h3>Getting started</h3>
              <p>Sign in, upload your first documents and set up folders.</p>
              <div className="site-card__foot">
                <ArrowLink to="/documentation/getting-started">Read the guide</ArrowLink>
              </div>
            </article>
            <article className="site-card">
              <span className="site-card__icon">
                <Search aria-hidden="true" />
              </span>
              <h3>Searching</h3>
              <p>Find documents by name, tag or the words inside them.</p>
              <div className="site-card__foot">
                <ArrowLink to="/documentation/search">Search tips</ArrowLink>
              </div>
            </article>
            <article className="site-card">
              <span className="site-card__icon">
                <LifeBuoy aria-hidden="true" />
              </span>
              <h3>Troubleshooting</h3>
              <p>Fixes for sign-in, Google Drive connection, uploads and previews.</p>
              <div className="site-card__foot">
                <ArrowLink to="/documentation/troubleshooting">Solve a problem</ArrowLink>
              </div>
            </article>
          </div>
        </div>
      </section>

      <ClosingCta />
    </>
  )
}

const previewRows = [
  { name: 'Degree certificate.pdf', meta: 'Certificates · 2 versions', kind: 'PDF', colour: '#b4432f', tag: 'education' },
  { name: 'Service record 2024.docx', meta: 'Military · Updated today', kind: 'DOC', colour: '#2f6394', tag: 'service' },
  { name: 'Annual budget.xlsx', meta: 'Work · 48 KB', kind: 'XLS', colour: '#2f7d4f', tag: 'finance' },
  { name: 'Course presentation.pptx', meta: 'School · 32 slides', kind: 'PPT', colour: '#c0662a', tag: 'school' },
]

// A simplified drawing of the workspace. It is decorative, so screen readers skip it.
function WorkspacePreview() {
  return (
    <div className="site-preview" aria-hidden="true">
      <div className="site-preview__bar">
        <span />
        <span />
        <span />
      </div>
      <div className="site-preview__body">
        <div className="site-preview__side">
          <div data-active="true">
            <Files /> All files
          </div>
          <div>
            <FolderOpen /> Folders
          </div>
          <div>
            <History /> Recent
          </div>
          <div>
            <Star /> Favorites
          </div>
          <div>
            <FileText /> Categories
          </div>
        </div>
        <div className="site-preview__main">
          <div className="site-preview__search">
            <Search /> Search documents
          </div>
          <div className="site-preview__rows">
            {previewRows.map((row) => (
              <div key={row.name} className="site-preview__row">
                <span className="site-preview__kind" style={{ background: row.colour }}>
                  {row.kind}
                </span>
                <span className="site-preview__name">
                  <strong>{row.name}</strong>
                  <small>{row.meta}</small>
                </span>
                <span className="site-preview__tag">#{row.tag}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
