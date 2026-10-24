import { Bookmark, Clock, Globe, ShieldCheck } from 'lucide-react'
import { displayUrl, type WebLibrary } from '../../services/webBrowser'

// Well-known public sources of legal material. They are only starting points:
// the page itself says that what a website shows is not checked by Document Vault.
const STARTING_POINTS = [
  { title: 'Judicial Service of Ghana', url: 'https://judicial.gov.gh/' },
  { title: 'Ghana Legal Information Institute (GhaLII)', url: 'https://ghalii.org/' },
  { title: 'Parliament of Ghana', url: 'https://www.parliament.gh/' },
  { title: 'BAILII (British and Irish Legal Information Institute)', url: 'https://www.bailii.org/' },
  { title: 'legislation.gov.uk', url: 'https://www.legislation.gov.uk/' },
]

interface WebStartPageProps {
  library: WebLibrary | null
  compact?: boolean
  onOpen: (url: string) => void
  onShowSaved: () => void
}

export function WebStartPage({ library, compact = false, onOpen, onShowSaved }: WebStartPageProps) {
  const saved = library?.bookmarks.slice(0, compact ? 5 : 8) ?? []
  const recent = library?.history.slice(0, compact ? 5 : 8) ?? []
  return (
    <div className={`web-start${compact ? ' web-start--compact' : ''}`}>
      <div className="web-start__intro">
        <h2>Web browser</h2>
        <p>Type an address or words to search for in the bar above. Pages open here, next to your library, without leaving Document Vault.</p>
      </div>

      <div className="web-start__grid">
        <section className="web-start__section" aria-labelledby="web-start-saved">
          <h3 id="web-start-saved">
            <Bookmark aria-hidden="true" />
            Saved references
          </h3>
          {saved.length === 0 ? (
            <p className="web-start__empty">Pages you save with the bookmark button appear here.</p>
          ) : (
            <ul>
              {saved.map((item) => (
                <li key={item.id}>
                  <button type="button" className="web-start__link" onClick={() => onOpen(item.url)} title={item.url}>
                    <strong>{item.title}</strong>
                    <span>{displayUrl(item.url)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {library && library.bookmarks.length > saved.length ? (
            <button type="button" className="text-button" onClick={onShowSaved}>
              All {library.bookmarks.length} saved references
            </button>
          ) : null}
        </section>

        <section className="web-start__section" aria-labelledby="web-start-recent">
          <h3 id="web-start-recent">
            <Clock aria-hidden="true" />
            Recently visited
          </h3>
          {recent.length === 0 ? (
            <p className="web-start__empty">Pages you visit appear here, so you can reopen them.</p>
          ) : (
            <ul>
              {recent.map((item) => (
                <li key={item.id}>
                  <button type="button" className="web-start__link" onClick={() => onOpen(item.url)} title={item.url}>
                    <strong>{item.title}</strong>
                    <span>{displayUrl(item.url)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="web-start__section" aria-labelledby="web-start-sources">
          <h3 id="web-start-sources">
            <Globe aria-hidden="true" />
            Starting points
          </h3>
          <ul>
            {STARTING_POINTS.map((item) => (
              <li key={item.url}>
                <button type="button" className="web-start__link" onClick={() => onOpen(item.url)} title={item.url}>
                  <strong>{item.title}</strong>
                  <span>{displayUrl(item.url)}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="web-start__note">Public websites, listed for convenience. Check that a page is the official, current source before relying on it.</p>
        </section>
      </div>

      <p className="web-start__privacy">
        <ShieldCheck aria-hidden="true" />
        <span>
          Websites open in a separate, locked-down browser. They cannot see your library, your documents or your saved references. Downloads, pop-up
          windows, camera, microphone, location and clipboard access are blocked.
        </span>
      </p>
    </div>
  )
}
