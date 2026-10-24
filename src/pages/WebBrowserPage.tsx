import { Globe } from 'lucide-react'
import { WebBrowser } from '../components/browser/WebBrowser'
import { EmptyState } from '../components/ui/EmptyState'
import { hasWebBrowser } from '../services/webBrowser'

export function WebBrowserPage() {
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
      <WebBrowser variant="page" />
    </section>
  )
}
