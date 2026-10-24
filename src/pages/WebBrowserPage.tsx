import { ArrowLeft, Globe } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { WebBrowser } from '../components/browser/WebBrowser'
import { EmptyState } from '../components/ui/EmptyState'
import type { BackTo } from '../services/placeMemory'
import { hasWebBrowser } from '../services/webBrowser'

export function WebBrowserPage() {
  // Set when a file in a library or a search result sent us here.
  const back = (useLocation().state as { back?: BackTo } | null)?.back ?? null
  if (!hasWebBrowser()) {
    return (
      <section className="page">
        <EmptyState
          icon={<Globe aria-hidden="true" />}
          title="The web browser is part of the desktop app"
          message="In Document Vault for Windows and macOS, web pages open here beside your library. In a web browser, links open in a new browser tab instead."
        />
      </section>
    )
  }
  return (
    <section className="page web-browser-page" aria-label="Web browser">
      {back ? (
        <Link to={back.to} className="text-button web-browser-page__back">
          <ArrowLeft aria-hidden="true" />
          <span className="break-anywhere">Back to {back.label}</span>
        </Link>
      ) : null}
      <WebBrowser variant="page" />
    </section>
  )
}
