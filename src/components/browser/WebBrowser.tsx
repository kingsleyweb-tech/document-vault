import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  BookOpen,
  Copy,
  ExternalLink,
  Globe,
  Home,
  Library,
  Lock,
  Mail,
  Moon,
  Plus,
  RotateCw,
  ShieldAlert,
  X,
} from 'lucide-react'
import { displayUrl, hostOf, webBrowser, type WebTab } from '../../services/webBrowser'
import { urlKey, useWebHost, useWebLibrary, useWebNotice, useWebState } from './useWebBrowser'
import { WebLibraryPanel, type WebPanelView } from './WebLibraryPanel'
import { WebStartPage } from './WebStartPage'

interface WebBrowserProps {
  variant: 'page' | 'docked'
  /** Extra buttons at the end of the toolbar (the split-view controls beside a book). */
  actions?: ReactNode
}

// The in-app browser's toolbar, tabs and side panel. The web page itself is
// drawn by the main process over the viewport element (useWebHost).
export function WebBrowser({ variant, actions }: WebBrowserProps) {
  const state = useWebState()
  const { library, reload } = useWebLibrary()
  const [notice, dismissNotice] = useWebNotice()
  const [panel, setPanel] = useState<WebPanelView | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; tone: 'info' | 'error' } | null>(null)
  const [address, setAddress] = useState<{ tabId: number | null; value: string } | null>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const addressInput = useRef<HTMLInputElement>(null)
  const hostId = useId()

  const tab = state?.tabs.find((item) => item.id === state.activeId) ?? null
  const showingPage = Boolean(tab && tab.url && !tab.start && !tab.error && !tab.sleeping)
  useWebHost(viewport, hostId, showingPage)

  // Start with one tab, on the start page.
  useEffect(() => {
    if (state && state.tabs.length === 0) void webBrowser.newTab().catch(() => {})
  }, [state])

  // Recent pages change as pages load; keep the lists current while they are on screen.
  const currentUrl = tab?.url ?? null
  const needsLibrary = Boolean(panel) || Boolean(tab?.start)
  useEffect(() => {
    if (!needsLibrary) return undefined
    const timer = window.setTimeout(reload, 400)
    return () => window.clearTimeout(timer)
  }, [needsLibrary, currentUrl, tab?.title, reload])

  useEffect(() => {
    if (!message) return undefined
    const timer = window.setTimeout(() => setMessage(null), 5000)
    return () => window.clearTimeout(timer)
  }, [message])

  const say = (text: string, tone: 'info' | 'error' = 'info') => setMessage({ text, tone })
  const attempt = async (work: () => Promise<unknown>) => {
    try {
      await work()
    } catch (error) {
      say(error instanceof Error ? error.message : 'That did not work.', 'error')
    }
  }

  const openUrl = (url: string, newTab = false) =>
    void attempt(async () => {
      if (!tab || newTab) await webBrowser.open(url, { newTab: true })
      else await webBrowser.navigate(tab.id, url)
    })

  const editingAddress = address && address.tabId === (tab?.id ?? null) ? address.value : null
  const shownAddress = editingAddress ?? (tab && !tab.start ? (tab.url ?? '') : '')
  const saved = tab?.url && !tab.start ? library?.bookmarks.find((item) => urlKey(item.url) === urlKey(tab.url as string)) ?? null : null
  const secure = tab?.url?.startsWith('https:') ?? false
  const tabNotice = notice && (notice.tabId === null || notice.tabId === tab?.id) ? notice : null

  const save = () =>
    void attempt(async () => {
      if (!tab?.url) return
      if (saved) {
        setPanel('saved')
        setEditingId(saved.id)
        return
      }
      const { bookmark } = await webBrowser.saveBookmark({ url: tab.url, title: tab.title, source: tab.source })
      reload()
      setPanel('saved')
      setEditingId(bookmark.id)
      say('Saved. Add a note or choose a folder if you like.')
    })

  if (!state) {
    return (
      <div className={`web-browser web-browser--${variant}`}>
        <div className="web-browser__loading" role="status">
          <span className="app-spinner" aria-hidden="true" /> Starting the browser...
        </div>
      </div>
    )
  }

  return (
    <div className={`web-browser web-browser--${variant}`}>
      <div className="web-browser__tabs" role="tablist" aria-label="Browser tabs">
        {state.tabs.map((item) => (
          <TabButton
            key={item.id}
            tab={item}
            active={item.id === state.activeId}
            onSelect={() => void attempt(() => webBrowser.activate(item.id))}
            onClose={() => void attempt(() => webBrowser.closeTab(item.id))}
          />
        ))}
        <button
          type="button"
          className="icon-button web-browser__new-tab"
          onClick={() =>
            void attempt(async () => {
              await webBrowser.newTab()
              window.setTimeout(() => addressInput.current?.focus(), 50)
            })
          }
          disabled={state.tabs.length >= state.maxTabs}
          aria-label="New tab"
          title={state.tabs.length >= state.maxTabs ? `Up to ${state.maxTabs} tabs can be open` : 'New tab'}
        >
          <Plus aria-hidden="true" />
        </button>
      </div>

      <div className="web-browser__toolbar">
        <div className="web-browser__nav">
          <button type="button" className="icon-button" onClick={() => tab && void attempt(() => webBrowser.command(tab.id, 'back'))} disabled={!tab?.canGoBack} aria-label="Back" title="Back (Alt+Left)">
            <ArrowLeft aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" onClick={() => tab && void attempt(() => webBrowser.command(tab.id, 'forward'))} disabled={!tab?.canGoForward} aria-label="Forward" title="Forward (Alt+Right)">
            <ArrowRight aria-hidden="true" />
          </button>
          {tab?.loading ? (
            <button type="button" className="icon-button" onClick={() => void attempt(() => webBrowser.command(tab.id, 'stop'))} aria-label="Stop loading" title="Stop loading">
              <X aria-hidden="true" />
            </button>
          ) : (
            <button type="button" className="icon-button" onClick={() => tab && void attempt(() => webBrowser.command(tab.id, 'reload'))} disabled={!tab?.url || tab.start} aria-label="Reload" title="Reload (F5)">
              <RotateCw aria-hidden="true" />
            </button>
          )}
          {variant === 'page' ? (
            <button type="button" className="icon-button" onClick={() => tab && void attempt(() => webBrowser.command(tab.id, 'home'))} disabled={!tab || tab.start} aria-label="Start page" title="Start page">
              <Home aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <form
          className="web-browser__address"
          role="search"
          onSubmit={(event) => {
            event.preventDefault()
            if (!tab) return
            const value = shownAddress
            void attempt(async () => {
              await webBrowser.navigate(tab.id, value)
              setAddress(null)
              addressInput.current?.blur()
            })
          }}
        >
          <span className={`web-browser__security${tab?.url && !tab.start && !secure ? ' is-insecure' : ''}`} title={tab?.url && !tab.start ? (secure ? 'Secure connection (https)' : 'Not secure: this page does not use https') : undefined}>
            {tab?.url && !tab.start ? secure ? <Lock aria-hidden="true" /> : <ShieldAlert aria-hidden="true" /> : <Globe aria-hidden="true" />}
          </span>
          <input
            ref={addressInput}
            value={shownAddress}
            onChange={(event) => setAddress({ tabId: tab?.id ?? null, value: event.target.value })}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={() => setAddress(null)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                // Escape leaves the address bar only; it does not close a preview the browser is in.
                event.preventDefault()
                setAddress(null)
                event.currentTarget.blur()
              }
            }}
            placeholder="Search or type a web address"
            aria-label="Address or search"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            enterKeyHint="go"
          />
        </form>

        <div className="web-browser__tools">
          <button type="button" className={`icon-button${saved ? ' is-on' : ''}`} onClick={save} disabled={!tab?.url || tab.start} aria-label={saved ? 'Edit saved reference' : 'Save this page'} title={saved ? 'Saved. Edit the reference' : 'Save this page as a reference'}>
            {saved ? <BookmarkCheck aria-hidden="true" /> : <Bookmark aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => tab?.url && void attempt(async () => (await webBrowser.copy(tab.url as string)) && say('Link copied.'))}
            disabled={!tab?.url || tab.start}
            aria-label="Copy link"
            title="Copy link"
          >
            <Copy aria-hidden="true" />
          </button>
          {variant === 'page' ? (
            <button type="button" className="icon-button" onClick={() => tab?.url && void attempt(() => webBrowser.email(tab.url as string, tab.title))} disabled={!tab?.url || tab.start} aria-label="Share link by email" title="Share link by email">
              <Mail aria-hidden="true" />
            </button>
          ) : null}
          <button type="button" className="icon-button" onClick={() => tab?.url && void webBrowser.openExternal(tab.url)} disabled={!tab?.url || tab.start} aria-label="Open in default browser" title="Open in your default browser">
            <ExternalLink aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`icon-button${panel ? ' is-on' : ''}`}
            onClick={() => setPanel((current) => (current ? null : 'saved'))}
            aria-pressed={Boolean(panel)}
            aria-label="Saved references and recent pages"
            title="Saved references and recent pages"
          >
            <Library aria-hidden="true" />
          </button>
          {actions}
        </div>
      </div>

      <div className={`web-browser__progress${tab?.loading ? ' is-loading' : ''}`} aria-hidden="true" />

      {tab?.url && !tab.start ? (
        <div className="web-browser__context">
          <span className="source-badge source-badge--web" title="A page from the internet. Document Vault has not checked it as a legal authority.">
            Online source
          </span>
          <span className="web-browser__context-text">{hostOf(tab.url)} · not checked as a legal authority</span>
          {tab.source ? (
            <span className="web-browser__from" title="The document this page was opened from">
              <BookOpen aria-hidden="true" />
              From {tab.source.name}
            </span>
          ) : null}
        </div>
      ) : null}

      {tabNotice ? (
        <div className="notice web-browser__notice" role="status">
          <AlertTriangle aria-hidden="true" />
          <span>{tabNotice.message}</span>
          {tabNotice.url && /^https?:/i.test(tabNotice.url) && tabNotice.kind !== 'tabs' ? (
            <button type="button" className="text-button" onClick={() => void webBrowser.openExternal(tabNotice.url as string)}>
              Open in default browser
            </button>
          ) : null}
          <button type="button" className="icon-button" onClick={dismissNotice} aria-label="Dismiss">
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {tab?.slow && tab.loading ? (
        <div className="notice web-browser__notice" role="status">
          <span>This page is taking a long time to load. The connection may be slow, or the site may be busy.</span>
          <button type="button" className="text-button" onClick={() => void attempt(() => webBrowser.command(tab.id, 'stop'))}>
            Stop
          </button>
          {tab.url ? (
            <button type="button" className="text-button" onClick={() => void webBrowser.openExternal(tab.url as string)}>
              Open in default browser
            </button>
          ) : null}
        </div>
      ) : null}
      {tab?.unresponsive ? (
        <div className="notice notice--error web-browser__notice" role="alert">
          <span>This page is not responding.</span>
          <button type="button" className="text-button" onClick={() => void attempt(() => webBrowser.command(tab.id, 'reload'))}>
            Reload
          </button>
        </div>
      ) : null}
      {message ? (
        <div className={`notice web-browser__notice${message.tone === 'error' ? ' notice--error' : ''}`} role={message.tone === 'error' ? 'alert' : 'status'}>
          <span>{message.text}</span>
          <button type="button" className="icon-button" onClick={() => setMessage(null)} aria-label="Dismiss">
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div className="web-browser__body">
        <div className="web-browser__viewport" ref={viewport}>
          {!tab || tab.start || !tab.url ? (
            <WebStartPage library={library} compact={variant === 'docked'} onOpen={(url) => openUrl(url)} onShowSaved={() => setPanel('saved')} />
          ) : tab.error ? (
            <div className="web-browser__error" role="alert">
              <AlertTriangle aria-hidden="true" />
              <h2>{tab.error.title}</h2>
              <p>{tab.error.detail}</p>
              {tab.error.url ? <p className="web-browser__error-url">{displayUrl(tab.error.url)}</p> : null}
              <div className="web-browser__error-actions">
                <button type="button" className="primary-button" onClick={() => void attempt(() => webBrowser.command(tab.id, 'reload'))}>
                  <RotateCw aria-hidden="true" />
                  <span>Try again</span>
                </button>
                {tab.error.url ? (
                  <button type="button" className="secondary-button" onClick={() => void webBrowser.openExternal(tab.error?.url as string)}>
                    <ExternalLink aria-hidden="true" />
                    <span>Open in default browser</span>
                  </button>
                ) : null}
                {tab.canGoBack ? (
                  <button type="button" className="ghost-button" onClick={() => void attempt(() => webBrowser.command(tab.id, 'back'))}>
                    <ArrowLeft aria-hidden="true" />
                    <span>Go back</span>
                  </button>
                ) : null}
              </div>
            </div>
          ) : tab.sleeping ? (
            <div className="web-browser__sleeping" role="status">
              <Moon aria-hidden="true" />
              <p>This tab was put to sleep to save memory.</p>
              <button type="button" className="secondary-button" onClick={() => void attempt(() => webBrowser.activate(tab.id))}>
                Wake it up
              </button>
            </div>
          ) : null}
        </div>
        {panel ? (
          <WebLibraryPanel
            library={library}
            reload={reload}
            view={panel}
            onViewChange={setPanel}
            editingId={editingId}
            onEditingChange={setEditingId}
            onOpen={openUrl}
            onMessage={say}
            onClose={() => setPanel(null)}
          />
        ) : null}
      </div>
    </div>
  )
}

function TabButton({ tab, active, onSelect, onClose }: { tab: WebTab; active: boolean; onSelect: () => void; onClose: () => void }) {
  const label = tab.start || !tab.url ? 'New tab' : tab.title || hostOf(tab.url) || 'Loading...'
  return (
    <div className={`web-tab${active ? ' is-active' : ''}${tab.sleeping ? ' is-sleeping' : ''}`}>
      <button type="button" role="tab" aria-selected={active} className="web-tab__select" onClick={onSelect} title={tab.url ?? label}>
        {tab.loading ? <span className="app-spinner app-spinner--small" aria-hidden="true" /> : tab.error ? <AlertTriangle aria-hidden="true" /> : <Globe aria-hidden="true" />}
        <span className="web-tab__title">{label}</span>
      </button>
      <button type="button" className="web-tab__close" onClick={onClose} aria-label={`Close ${label}`} title="Close tab">
        <X aria-hidden="true" />
      </button>
    </div>
  )
}
