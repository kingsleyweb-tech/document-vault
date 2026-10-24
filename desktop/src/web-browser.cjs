'use strict'

const { Menu, WebContentsView, clipboard, session: electronSession } = require('electron')
const { addressFromInput, isAllowedFrameUrl, isAllowedRequest, parseWebUrl, refusalReason } = require('./web-urls.cjs')

// The in-app web browser. Each tab is a WebContentsView (Electron's supported
// way to embed web pages) placed over an area of the app's page.
//
// Websites are kept apart from the app and the library:
// - Pages run in their own session (cookies, storage and cache separate from
//   the app's sign-in), sandboxed, with no Node.js, no preload and no bridge.
// - Only http and https pages open. Every navigation, redirect, frame, pop-up
//   and request is checked; addresses on this computer (where the app and its
//   index service listen) are refused, and so are file:, javascript: and the rest.
// - Permissions (camera, microphone, location, notifications, clipboard and so
//   on) are all refused, downloads are cancelled, and pop-up windows become tabs.
// - Certificate errors are never overridden: the page simply fails to load.

const MAX_TABS = 8
const SLEEP_AFTER_MS = 15 * 60 * 1000
const SLOW_AFTER_MS = 20 * 1000
const PARTITION = 'persist:document-vault-web'

const CERTIFICATE_ERROR = (code) => code <= -200 && code > -300
const OFFLINE_CODES = new Set([-106, -21])
const NOT_FOUND_CODES = new Set([-105, -137])
const TIMEOUT_CODES = new Set([-7, -118])

function errorMessage(code, description) {
  if (CERTIFICATE_ERROR(code)) {
    return { title: 'This site’s security certificate is not trusted', detail: 'The connection may not be private. Document Vault does not open pages with certificate errors.' }
  }
  if (OFFLINE_CODES.has(code)) return { title: 'You are offline', detail: 'Check your internet connection, then try again.' }
  if (NOT_FOUND_CODES.has(code)) return { title: 'This site could not be found', detail: 'Check the address for typing mistakes, or try again later.' }
  if (TIMEOUT_CODES.has(code)) return { title: 'The site took too long to respond', detail: 'It may be busy or unavailable. Try again, or open it in your default browser.' }
  if (code === -102 || code === -101 || code === -100) return { title: 'The site refused the connection', detail: 'It may be down, or it may not accept connections from this network.' }
  if (code === -311) return { title: 'This page tried to open something on your computer', detail: 'Websites cannot open files or folders on this computer from Document Vault’s browser, so the page was stopped.' }
  if (code === -20 || code === -27) return { title: 'This page was blocked', detail: 'The page or something it needs is not allowed in Document Vault’s browser. You can open it in your default browser instead.' }
  return { title: 'This page could not be opened', detail: description ? `The browser reported: ${description}.` : 'Try again, or open it in your default browser.' }
}

function createWebBrowser({ getWindow, getAppZoom = () => 1, library, notify, openExternal, userAgent, allowLoopback = false, partition = PARTITION, maxTabs = MAX_TABS, sleepAfterMs = SLEEP_AFTER_MS }) {
  const rules = { allowLoopback }
  const tabs = []
  let activeId = null
  let nextId = 1
  let host = null // { id, bounds } of the part of the app page that shows the page
  let sleepTimer = null

  const webSession = electronSession.fromPartition(partition)
  hardenSession(webSession)

  function hardenSession(ses) {
    if (userAgent) ses.setUserAgent(userAgent)
    ses.setSpellCheckerEnabled?.(false)
    ses.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(false)
      // Fullscreen and pointer lock are asked for all the time by video players; refusing them silently is enough.
      if (permission === 'fullscreen' || permission === 'pointerLock') return
      const tab = tabs.find((item) => item.view?.webContents === contents)
      if (tab) notice(tab, 'permission', `This site asked to use ${permissionName(permission, details)}. Document Vault’s browser does not allow that.`)
    })
    ses.setPermissionCheckHandler(() => false)
    ses.setDevicePermissionHandler?.(() => false)
    ses.setDisplayMediaRequestHandler?.((_request, callback) => {
      try {
        callback(null)
      } catch {
        // Already refused.
      }
    })
    ses.on('will-download', (event, item, contents) => {
      event.preventDefault()
      const tab = tabs.find((entry) => entry.view?.webContents === contents)
      const name = item.getFilename() || 'a file'
      notice(tab ?? null, 'download', `Downloads are blocked in Document Vault’s browser, so “${name}” was not saved.`, item.getURL())
    })
    // Every request a page makes, including redirects, frames, scripts and connections.
    ses.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !isAllowedRequest(details.url, rules) })
    })
  }

  function permissionName(permission, details) {
    if (permission === 'media') {
      const types = details?.mediaTypes ?? []
      if (types.includes('video') && types.includes('audio')) return 'your camera and microphone'
      if (types.includes('video')) return 'your camera'
      return 'your microphone'
    }
    const names = {
      geolocation: 'your location',
      notifications: 'notifications',
      'clipboard-read': 'your clipboard',
      'clipboard-sanitized-write': 'your clipboard',
      midi: 'MIDI devices',
      midiSysex: 'MIDI devices',
      openExternal: 'other programs',
      'display-capture': 'your screen',
      'idle-detection': 'your activity',
      'storage-access': 'storage shared with other sites',
      'top-level-storage-access': 'storage shared with other sites',
      'window-management': 'your screens',
      hid: 'connected devices',
      serial: 'connected devices',
      usb: 'connected devices',
      speaker_selection: 'your speakers',
      keyboardLock: 'your keyboard',
    }
    return names[permission] ?? 'a protected feature'
  }

  // ── State sent to the page ─────────────────────────────────────────────────

  function describe(tab) {
    const contents = tab.view?.webContents
    const alive = contents && !contents.isDestroyed()
    return {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      start: tab.start,
      loading: tab.loading,
      slow: tab.slow,
      canGoBack: Boolean(alive && contents.navigationHistory.canGoBack()) || (tab.start && Boolean(tab.url)),
      canGoForward: Boolean(alive && contents.navigationHistory.canGoForward()),
      error: tab.error,
      source: tab.source,
      sleeping: !tab.view && Boolean(tab.url) && !tab.start,
      unresponsive: tab.unresponsive,
    }
  }

  function state() {
    return { tabs: tabs.map(describe), activeId, maxTabs }
  }

  let stateQueued = false
  function changed() {
    if (stateQueued) return
    stateQueued = true
    setImmediate(() => {
      stateQueued = false
      notify('state', state())
    })
  }

  function notice(tab, kind, message, url = null) {
    notify('notice', { tabId: tab?.id ?? null, kind, message, url, at: Date.now() })
  }

  // ── Tabs ───────────────────────────────────────────────────────────────────

  function find(id) {
    const tab = tabs.find((item) => item.id === id)
    if (!tab) throw new Error('This tab was closed.')
    return tab
  }

  function newTab({ url = null, source = null, activate = true } = {}) {
    if (tabs.length >= maxTabs) {
      notice(null, 'tabs', `You can have up to ${maxTabs} tabs open. Close one to open another.`)
      return null
    }
    const tab = { id: nextId++, url: null, title: '', start: true, loading: false, slow: false, error: null, source, view: null, lastActive: Date.now(), unresponsive: false, slowTimer: null }
    tabs.push(tab)
    if (activate) activeId = tab.id
    if (url) load(tab, url)
    layout()
    changed()
    return tab
  }

  function createView(tab) {
    const view = new WebContentsView({
      webPreferences: {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        nodeIntegrationInWorker: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        navigateOnDragDrop: false,
        safeDialogs: true,
        spellcheck: false,
        autoplayPolicy: 'document-user-activation-required',
        enableWebSQL: false,
      },
    })
    view.setBackgroundColor('#ffffff')
    view.setVisible(false)
    getWindow()?.contentView.addChildView(view)
    tab.view = view
    guard(tab, view.webContents)
    return view
  }

  function guard(tab, contents) {
    const refuse = (event, url) => {
      event.preventDefault()
      notice(tab, 'blocked', refusalReason(url, rules) ?? 'This link cannot be opened in Document Vault’s browser.', url)
    }
    // will-frame-navigate covers links and scripts in the page and in its frames;
    // will-redirect covers the server sending the page somewhere else.
    contents.on('will-redirect', (event, url) => {
      if (!parseWebUrl(url, rules)) refuse(event, url)
    })
    contents.on('will-frame-navigate', (details) => {
      const allowed = details.isMainFrame ? parseWebUrl(details.url, rules) !== null : isAllowedFrameUrl(details.url, rules)
      if (!allowed) refuse(details, details.url)
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
    // Chromium itself stops web pages from opening files on this computer (links,
    // pop-ups and scripts), before any of the checks above see it. It says so only
    // in the page's console, so that is where the refusal is noticed and explained.
    let lastLocal = 0
    contents.on('console-message', (details) => {
      const local = /^Not allowed to load local resource:/.test(details?.message ?? '')
      if (!local || Date.now() - lastLocal < 1000) return
      lastLocal = Date.now()
      notice(tab, 'blocked', 'This page tried to open a file on your computer. Websites cannot open your files from Document Vault’s browser.', null)
    })
    // Pop-ups and links meant for a new window open as tabs, never as windows.
    contents.setWindowOpenHandler(({ url, disposition }) => {
      if (!parseWebUrl(url, rules)) {
        if (url && url !== 'about:blank') notice(tab, 'blocked', refusalReason(url, rules) ?? 'This link cannot be opened.', url)
        else notice(tab, 'popup', 'This site tried to open a pop-up window. Pop-ups are blocked.')
        return { action: 'deny' }
      }
      newTab({ url, source: tab.source, activate: disposition !== 'background-tab' })
      return { action: 'deny' }
    })

    contents.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return
      tab.error = null
      changed()
    })
    contents.on('did-start-loading', () => {
      tab.loading = true
      tab.slow = false
      clearTimeout(tab.slowTimer)
      tab.slowTimer = setTimeout(() => {
        tab.slow = true
        changed()
      }, SLOW_AFTER_MS)
      changed()
    })
    contents.on('did-stop-loading', () => {
      tab.loading = false
      tab.slow = false
      clearTimeout(tab.slowTimer)
      changed()
    })
    contents.on('did-navigate', (_event, url) => {
      tab.url = url
      tab.title = contents.getTitle() || tab.title
      library.recordVisit({ url, title: tab.title })
      changed()
    })
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return
      tab.url = url
      changed()
    })
    contents.on('page-title-updated', (_event, title) => {
      tab.title = title
      library.titleVisit(tab.url, title)
      changed()
    })
    contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      // -3 is a navigation that was replaced or stopped: not a failure.
      if (!isMainFrame || code === -3) return
      tab.error = { code, url, ...errorMessage(code, description) }
      layout()
      changed()
    })
    contents.on('render-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit') return
      tab.error = { code: 'crashed', url: tab.url, title: 'This page stopped working', detail: 'It may have used too much memory. Reload to try again.' }
      tab.loading = false
      layout()
      changed()
    })
    contents.on('unresponsive', () => {
      tab.unresponsive = true
      changed()
    })
    contents.on('responsive', () => {
      tab.unresponsive = false
      changed()
    })
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const modifier = process.platform === 'darwin' ? input.meta : input.control
      if ((input.alt && input.key === 'ArrowLeft') || (modifier && input.key === '[')) {
        event.preventDefault()
        command(tab.id, 'back')
      } else if ((input.alt && input.key === 'ArrowRight') || (modifier && input.key === ']')) {
        event.preventDefault()
        command(tab.id, 'forward')
      } else if (input.key === 'F5' || (modifier && input.key.toLowerCase() === 'r')) {
        event.preventDefault()
        command(tab.id, 'reload')
      }
    })
    contents.on('context-menu', (_event, params) => contextMenu(tab, params))
  }

  function contextMenu(tab, params) {
    const contents = tab.view?.webContents
    if (!contents) return
    const link = params.linkURL && parseWebUrl(params.linkURL, rules) ? params.linkURL : null
    const items = []
    if (link) {
      items.push(
        { label: 'Open link in new tab', click: () => newTab({ url: link, source: tab.source }) },
        { label: 'Open link in default browser', click: () => openExternal(link) },
        { label: 'Copy link', click: () => clipboard.writeText(link) },
        { type: 'separator' },
      )
    }
    if (params.selectionText) items.push({ role: 'copy' })
    if (params.isEditable) items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' })
    if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' })
    items.push(
      { label: 'Back', enabled: contents.navigationHistory.canGoBack(), click: () => command(tab.id, 'back') },
      { label: 'Forward', enabled: contents.navigationHistory.canGoForward(), click: () => command(tab.id, 'forward') },
      { label: 'Reload', click: () => command(tab.id, 'reload') },
    )
    Menu.buildFromTemplate(items).popup({ window: getWindow() ?? undefined })
  }

  function load(tab, url) {
    tab.start = false
    tab.error = null
    tab.url = url
    if (!tab.view) createView(tab)
    tab.lastActive = Date.now()
    tab.view.webContents.loadURL(url).catch(() => {
      // Failures are reported through did-fail-load.
    })
    layout()
    changed()
  }

  /** Opens an address: in the active tab, or in a new one. Returns { ok } or { error }. */
  function open({ url, source = null, newTab: inNewTab = false }) {
    const parsed = parseWebUrl(url, rules)
    if (!parsed) return { error: refusalReason(url, rules) ?? 'This address cannot be opened.' }
    const active = tabs.find((item) => item.id === activeId)
    if (inNewTab || !active) {
      const tab = newTab({ url: parsed.href, source })
      return tab ? { ok: true, tabId: tab.id } : { error: `You can have up to ${maxTabs} tabs open. Close one to open another.` }
    }
    active.source = source ?? active.source
    load(active, parsed.href)
    return { ok: true, tabId: active.id }
  }

  function navigate(tabId, input) {
    const tab = find(tabId)
    const result = addressFromInput(input, rules)
    if (result.error) return { error: result.error }
    load(tab, result.url)
    return { ok: true }
  }

  function command(tabId, name) {
    const tab = find(tabId)
    const contents = tab.view?.webContents
    switch (name) {
      case 'back':
        if (contents?.navigationHistory.canGoBack() && !tab.start) contents.navigationHistory.goBack()
        else if (tab.start && tab.url) {
          // Back from the start page returns to the page that was showing.
          tab.start = false
          if (!tab.view) load(tab, tab.url)
        }
        break
      case 'forward':
        if (contents?.navigationHistory.canGoForward()) {
          tab.start = false
          contents.navigationHistory.goForward()
        }
        break
      case 'reload':
        tab.error = null
        if (contents && !contents.isDestroyed() && contents.getURL()) contents.reload()
        else if (tab.url) load(tab, tab.url)
        break
      case 'stop':
        contents?.stop()
        break
      case 'home':
        contents?.stop()
        tab.start = true
        tab.error = null
        break
      default:
        throw new Error('Unknown command')
    }
    layout()
    changed()
  }

  function activate(tabId) {
    const tab = find(tabId)
    activeId = tab.id
    tab.lastActive = Date.now()
    if (!tab.view && tab.url && !tab.start) load(tab, tab.url)
    layout()
    changed()
  }

  function closeTab(tabId) {
    const index = tabs.findIndex((item) => item.id === tabId)
    if (index < 0) return
    const [tab] = tabs.splice(index, 1)
    destroyView(tab)
    if (activeId === tabId) activeId = tabs[Math.min(index, tabs.length - 1)]?.id ?? null
    layout()
    changed()
  }

  function destroyView(tab) {
    clearTimeout(tab.slowTimer)
    const view = tab.view
    tab.view = null
    if (!view) return
    try {
      getWindow()?.contentView.removeChildView(view)
    } catch {
      // The window is closing.
    }
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }

  // ── Placement over the app's page ──────────────────────────────────────────

  /** The app's page reports where the browser area is (in its CSS pixels), or null to hide it. */
  function setHost(hostId, bounds, { force = false } = {}) {
    if (force) host = null
    else if (bounds) host = { id: hostId, bounds }
    // A host that has gone away hides the page only if no other host took over since.
    else if (host?.id === hostId) host = null
    layout()
  }

  function layout() {
    const window = getWindow()
    if (!window) return
    const active = tabs.find((item) => item.id === activeId)
    const zoom = getAppZoom()
    for (const tab of tabs) {
      if (!tab.view) continue
      const visible = Boolean(host) && tab === active && !tab.start && !tab.error
      if (visible) {
        const { x, y, width, height } = host.bounds
        tab.view.setBounds({ x: Math.round(x * zoom), y: Math.round(y * zoom), width: Math.max(0, Math.round(width * zoom)), height: Math.max(0, Math.round(height * zoom)) })
      }
      tab.view.setVisible(visible)
    }
  }

  // Tabs not looked at for a while are put to sleep: the page is closed and
  // reloaded when the tab is chosen again, so background tabs use no memory.
  function sleepIdleTabs() {
    const now = Date.now()
    for (const tab of tabs) {
      if (tab.id === activeId || !tab.view || tab.loading) continue
      if (now - tab.lastActive > sleepAfterMs) {
        destroyView(tab)
        changed()
      }
    }
  }
  sleepTimer = setInterval(sleepIdleTabs, Math.min(60_000, Math.max(1000, sleepAfterMs / 2)))
  sleepTimer.unref?.()

  return {
    session: webSession,
    state,
    open,
    navigate,
    command,
    newTab: (options) => {
      const tab = newTab(options)
      return tab ? { ok: true, tabId: tab.id } : { error: `You can have up to ${maxTabs} tabs open. Close one to open another.` }
    },
    activate,
    closeTab,
    setHost,
    relayout: layout,
    /** Clears cookies, storage and the cache of websites. Saved references are kept. */
    async clearBrowsingData() {
      await webSession.clearStorageData()
      await webSession.clearCache()
      await webSession.clearAuthCache()
    },
    owns: (contents) => contents?.session === webSession,
    contentsOf: (tabId) => tabs.find((item) => item.id === tabId)?.view?.webContents ?? null,
    destroy() {
      clearInterval(sleepTimer)
      for (const tab of tabs.splice(0)) destroyView(tab)
      host = null
      activeId = null
    },
  }
}

module.exports = { createWebBrowser, errorMessage, PARTITION }
