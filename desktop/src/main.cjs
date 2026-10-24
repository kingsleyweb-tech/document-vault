'use strict'

const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, net, session, shell } = require('electron')
const { contentSecurityPolicy, createStaticServer } = require('./static-server.cjs')
const { createBrowserSignIn } = require('./browser-sign-in.cjs')
const { companionOrigins } = require('./origins.cjs')
const { findUpdate } = require('./updates.cjs')
const { createWebBrowser } = require('./web-browser.cjs')
const { createWebLibrary } = require('./web-library.cjs')
const { checkLinks } = require('./web-linkcheck.cjs')
const { isAllowedRequest, parseWebUrl } = require('./web-urls.cjs')

const SITE = 'https://documents-vault.vercel.app'
const RELEASES_URL = `${SITE}/releases/latest.json`
// A fixed port keeps the window's address, and with it the saved sign-in, the
// same between launches. The others are used only if it is taken.
const APP_PORTS = [47616, 47617, 47618, 47619, 47620]
const COMPANION_PORT = 47615
const WEB_ROOT = path.join(__dirname, '..', 'web')
// documentvault:// links only bring the app to the front; they carry no data.
// The browser sign-in page offers one, because Windows does not let an app
// raise its own window over the browser.
const PROTOCOL = 'documentvault'
const COMPANION_MAIN = path.join(__dirname, '..', 'companion', 'src', 'main.js').replace('app.asar', 'app.asar.unpacked')

// Pages that may open in a pop-up from the app: Google and Firebase sign-in.
const POPUP_HOSTS = [/^accounts\.google\.com$/, /\.firebaseapp\.com$/, /\.web\.app$/, /^accounts\.youtube\.com$/]

let mainWindow = null
let appOrigin = null
let companion = null
let staticServer = null
// The in-app web browser (web-browser.cjs) and its saved references.
let webBrowser = null
let webLibrary = null
let linkCheckSession = null

// Google sign-in happens in the user's browser; see browser-sign-in.cjs.
const browserSignIn = createBrowserSignIn({
  origin: () => appOrigin,
  openBrowser: (url) => shell.openExternal(url),
  onComplete: () => bringToFront(),
})

function bringToFront() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

// Development and tests only: a separate profile, so checks never touch a real one.
if (!app.isPackaged && process.env.DV_USER_DATA) app.setPath('userData', process.env.DV_USER_DATA)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Windows and Linux start a second copy for a documentvault:// link; macOS
  // sends open-url to this one.
  app.on('second-instance', () => bringToFront())
  app.on('open-url', (event) => {
    event.preventDefault()
    bringToFront()
  })
  // Only installed copies claim the link, so development runs never take it over.
  if (app.isPackaged) app.setAsDefaultProtocolClient(PROTOCOL)
  app.whenReady().then(start).catch((error) => {
    dialog.showErrorBox('Document Vault could not start', String(error?.message ?? error))
    app.quit()
  })
}

// Google may refuse sign-in from browsers it does not recognise; present the
// standard Chrome user agent without the Electron and app tokens.
app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|document-vault-desktop|Document ?Vault)\/\S+/gi, '')

async function start() {
  lockDownSessions()

  staticServer = createStaticServer(WEB_ROOT, {
    routes: browserSignIn.routes,
    // Read per request: the companion starts after this server and may take another port.
    csp: () => contentSecurityPolicy({ companionPort: companion?.port ?? COMPANION_PORT }),
  })
  const port = await staticServer.listen(APP_PORTS)
  appOrigin = `http://localhost:${port}`

  companion = await startCompanion(appOrigin).catch((error) => {
    console.error('Desktop Files is unavailable:', error)
    return null
  })

  webLibrary = createWebLibrary(path.join(app.getPath('userData'), 'web-library.json'))
  webBrowser = createWebBrowser({
    getWindow: () => mainWindow,
    getAppZoom: () => mainWindow?.webContents.getZoomFactor() ?? 1,
    library: webLibrary,
    notify: (kind, payload) => mainWindow?.webContents.send(`dv:web:${kind}`, payload),
    openExternal: openWebExternally,
    userAgent: app.userAgentFallback,
  })
  linkCheckSession = session.fromPartition('document-vault-link-check')
  linkCheckSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !isAllowedRequest(details.url) }))
  linkCheckSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))

  registerIpc()
  Menu.setApplicationMenu(buildMenu())
  createWindow()

  if (app.isPackaged) setTimeout(() => void checkForUpdates({ quiet: true }), 10_000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

async function startCompanion(origin) {
  const { startCompanion: startService, DEVELOPMENT_ORIGINS } = await import(pathToFileURL(COMPANION_MAIN).href)
  const options = {
    dataDir: path.join(app.getPath('userData'), 'companion'),
    // Exactly these origins, so origins saved by earlier runs (other ports) are dropped.
    // Development servers are trusted only in development builds.
    origins: companionOrigins(origin, { site: SITE, packaged: app.isPackaged, development: DEVELOPMENT_ORIGINS }),
    // Cross-platform replacements for the Windows-only launcher.
    launcher: {
      open: async (target) => {
        const problem = await shell.openPath(target)
        if (problem) throw new Error(problem)
      },
      // Only http and https links reach here (see companion/src/shortcuts.js).
      openLink: async (url) => shell.openExternal(url),
      reveal: async (target) => shell.showItemInFolder(target),
      // defaultPath opens the picker at a library's folder when access is granted again.
      pickFolder: async ({ defaultPath } = {}) => {
        const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
          title: defaultPath ? 'Choose the same folder to grant access again' : 'Choose a folder for Document Vault to search',
          buttonLabel: defaultPath ? 'Grant access' : 'Use this folder',
          message: 'Document Vault will read the names and the text of documents in this folder only, on this computer.',
          ...(defaultPath ? { defaultPath } : {}),
          properties: ['openDirectory'],
        })
        return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
      },
    },
    log: (...parts) => console.log('[companion]', ...parts),
  }
  try {
    return await startService({ ...options, port: COMPANION_PORT })
  } catch (error) {
    // Another copy (the developer companion) holds the usual port; take any free one.
    if (error?.code !== 'EADDRINUSE') throw error
    return startService({ ...options, port: 0 })
  }
}

function isAppUrl(url) {
  try {
    return new URL(url).origin === appOrigin
  } catch {
    return false
  }
}

function isPopupUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && POPUP_HOSTS.some((pattern) => pattern.test(parsed.hostname))
  } catch {
    return false
  }
}

function openExternally(url) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' || parsed.protocol === 'mailto:') void shell.openExternal(parsed.href)
  } catch {
    // Not a valid address; ignore.
  }
}

/** "Open in default browser" from the in-app browser: web pages only, never this computer. */
function openWebExternally(url) {
  const parsed = parseWebUrl(url)
  if (parsed) void shell.openExternal(parsed.href)
}

function lockDownSessions() {
  const allowed = new Set(['fullscreen', 'clipboard-sanitized-write'])
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(allowed.has(permission) && isAppUrl(webContents.getURL()))
  })
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return allowed.has(permission) && Boolean(webContents) && isAppUrl(webContents.getURL())
  })
}

const secureWebPreferences = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  spellcheck: true,
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 380,
    minHeight: 500,
    title: 'Document Vault',
    backgroundColor: '#faf7f3',
    show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { ...secureWebPreferences, preload: path.join(__dirname, 'preload.cjs') },
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    webBrowser?.destroy()
    mainWindow = null
  })
  guardContents(mainWindow.webContents)
  // A reloaded app page no longer has a browser area; hide the web page until it reports one.
  mainWindow.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) webBrowser?.setHost(null, null, { force: true })
  })
  mainWindow.webContents.on('zoom-changed', () => setImmediate(() => webBrowser?.relayout()))
  void mainWindow.loadURL(`${appOrigin}/app`)
}

function guardContents(contents) {
  // The app window stays on the app; other links open in the user's browser.
  contents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return
    event.preventDefault()
    openExternally(url)
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.setWindowOpenHandler(({ url }) => {
    if (isPopupUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 680,
          autoHideMenuBar: true,
          webPreferences: { ...secureWebPreferences },
        },
      }
    }
    if (isAppUrl(url)) {
      // The app's own pages (for example /downloads) open in the browser, where they belong.
      openExternally(url.replace(appOrigin, SITE))
      return { action: 'deny' }
    }
    openExternally(url)
    return { action: 'deny' }
  })
}

app.on('web-contents-created', (_event, contents) => {
  // Sign-in pop-ups may move between Google and Firebase pages, nowhere else.
  // Pages of the in-app browser have their own rules (web-browser.cjs).
  if (contents.getType() !== 'window' || webBrowser?.owns(contents)) return
  contents.on('will-navigate', (event, url) => {
    if (isAppUrl(url) || isPopupUrl(url)) return
    event.preventDefault()
    openExternally(url)
  })
  contents.setWindowOpenHandler(({ url }) => {
    openExternally(url)
    return { action: 'deny' }
  })
})

/** Only the app's own page may use the bridge; never a sign-in pop-up. */
function fromApp(event) {
  const url = event.senderFrame?.url ?? ''
  return event.sender === mainWindow?.webContents && isAppUrl(url)
}

function registerIpc() {
  ipcMain.on('dv:info', (event) => {
    event.returnValue = fromApp(event)
      ? { version: app.getVersion(), platform: process.platform, companionPort: companion?.port ?? null }
      : null
  })
  ipcMain.handle('dv:pairing-code', (event) => {
    if (!fromApp(event) || !companion) return null
    return companion.newPairingCode()
  })
  ipcMain.handle('dv:google-sign-in', async (event, options) => {
    if (!fromApp(event)) throw new Error('Not allowed')
    const mode = options?.mode === 'reauthorize' ? 'reauthorize' : 'login'
    const hint = typeof options?.hint === 'string' ? options.hint : ''
    // Errors lose their details on the way to the page, so report a plain result.
    try {
      const { idToken, accessToken } = await browserSignIn.start({ mode, hint })
      return { ok: true, idToken, accessToken }
    } catch (error) {
      return { ok: false, cancelled: error?.code === 'desktop/sign-in-cancelled', message: String(error?.message ?? error) }
    }
  })
  ipcMain.handle('dv:cancel-google-sign-in', (event) => {
    if (fromApp(event)) browserSignIn.cancel()
  })
  ipcMain.handle('dv:check-updates', (event) => {
    if (!fromApp(event)) return
    return checkForUpdates({ quiet: false })
  })
  // The in-app browser. Only the app's page may drive it; websites have no bridge at all.
  ipcMain.handle('dv:web', async (event, request) => {
    if (!fromApp(event) || !webBrowser) throw new Error('Not allowed')
    try {
      return { ok: true, value: await webAction(request ?? {}) }
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) }
    }
  })
}

const text = (value, max = 8192) => (typeof value === 'string' ? value.slice(0, max) : '')
const id = (value) => (Number.isSafeInteger(value) ? value : -1)

async function webAction(request) {
  switch (request.action) {
    case 'state':
      return webBrowser.state()
    case 'open':
      return webBrowser.open({
        url: text(request.url),
        newTab: Boolean(request.newTab),
        source: request.source && typeof request.source === 'object' ? { name: text(request.source.name, 300), entryId: Number.isSafeInteger(request.source.entryId) ? request.source.entryId : null } : null,
      })
    case 'navigate':
      return webBrowser.navigate(id(request.tabId), text(request.input))
    case 'command':
      return webBrowser.command(id(request.tabId), text(request.name, 20))
    case 'new-tab':
      return webBrowser.newTab({})
    case 'activate':
      return webBrowser.activate(id(request.tabId))
    case 'close-tab':
      return webBrowser.closeTab(id(request.tabId))
    case 'host': {
      const bounds = request.bounds
      const valid = bounds && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(bounds[key]))
      return webBrowser.setHost(text(request.hostId, 64), valid ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null)
    }
    case 'open-external':
      return openWebExternally(text(request.url))
    case 'copy': {
      const url = parseWebUrl(text(request.url))
      if (url) clipboard.writeText(url.href)
      return Boolean(url)
    }
    case 'email': {
      const url = parseWebUrl(text(request.url))
      if (!url) return false
      const subject = text(request.title, 300) || url.hostname
      await shell.openExternal(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(url.href)}`)
      return true
    }
    case 'library':
      return webLibrary.snapshot()
    case 'save-bookmark':
      return webLibrary.saveBookmark({ url: text(request.url), title: text(request.title, 300), note: text(request.note, 4000), folder: text(request.folder, 80), source: request.source ?? null })
    case 'update-bookmark':
      return webLibrary.updateBookmark(text(request.bookmarkId, 64), {
        ...(request.url !== undefined ? { url: text(request.url) } : {}),
        ...(request.title !== undefined ? { title: text(request.title, 300) } : {}),
        ...(request.note !== undefined ? { note: text(request.note, 4000) } : {}),
        ...(request.folder !== undefined ? { folder: text(request.folder, 80) } : {}),
      })
    case 'remove-bookmark':
      return webLibrary.removeBookmark(text(request.bookmarkId, 64))
    case 'add-folder':
      return webLibrary.addFolder(text(request.name, 80))
    case 'rename-folder':
      return webLibrary.renameFolder(text(request.from, 80), text(request.to, 80))
    case 'remove-folder':
      return webLibrary.removeFolder(text(request.name, 80))
    case 'remove-visit':
      return webLibrary.removeVisit(text(request.visitId, 64))
    case 'clear-history':
      return webLibrary.clearHistory()
    case 'clear-browsing-data':
      return webBrowser.clearBrowsingData()
    case 'check-links': {
      const ids = Array.isArray(request.bookmarkIds) ? request.bookmarkIds.map((value) => text(value, 64)) : null
      const items = webLibrary.bookmarkUrls(ids)
      await checkLinks((url, init) => linkCheckSession.fetch(url, init), items, (bookmarkId, result) => {
        webLibrary.setCheck(bookmarkId, result)
        mainWindow?.webContents.send('dv:web:check', { bookmarkId, result })
      })
      return { checked: items.length }
    }
    default:
      throw new Error('Unknown action')
  }
}

async function checkForUpdates({ quiet }) {
  let manifest = null
  try {
    const response = await net.fetch(RELEASES_URL, { cache: 'no-store' })
    if (response.ok) manifest = await response.json()
  } catch {
    manifest = null
  }
  if (!manifest) {
    if (!quiet) await dialog.showMessageBox(mainWindow, { type: 'warning', message: 'Could not check for updates', detail: 'Check your internet connection and try again.' })
    return
  }
  const update = findUpdate(manifest, { version: app.getVersion(), platform: process.platform, arch: process.arch })
  if (!update) {
    if (!quiet) await dialog.showMessageBox(mainWindow, { type: 'info', message: 'Document Vault is up to date', detail: `You have version ${app.getVersion()}.` })
    return
  }
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    message: `Document Vault ${update.version} is available`,
    detail: `You have version ${app.getVersion()}. Download the new version from the Downloads page and install it over this one; your sign-in and indexed folders are kept.`,
    buttons: ['Open Downloads', 'Later'],
    defaultId: 0,
    cancelId: 1,
  })
  if (response === 0) void shell.openExternal(`${SITE}/downloads`)
}

async function showPairingCode() {
  if (!companion) {
    await dialog.showMessageBox(mainWindow, { type: 'warning', message: 'Desktop Files is not running', detail: 'Restart Document Vault and try again.' })
    return
  }
  const code = companion.newPairingCode()
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    message: `Pairing code: ${code}`,
    detail:
      'To use Desktop Files from a web browser on this computer, open Document Vault in the browser, choose Desktop Files and type this code. ' +
      'It works once and expires in 10 minutes. Keep this app open while you use it.',
    buttons: ['Copy code', 'Close'],
    defaultId: 0,
    cancelId: 1,
  })
  if (response === 0) clipboard.writeText(code)
}

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Documentation', click: () => void shell.openExternal(`${SITE}/documentation/desktop-app`) },
        { label: 'Connect a browser…', click: () => void showPairingCode() },
        { label: 'Check for updates…', click: () => void checkForUpdates({ quiet: false }) },
        { type: 'separator' },
        { label: `Version ${app.getVersion()}`, enabled: false },
      ],
    },
  ]
  return Menu.buildFromTemplate(template)
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  browserSignIn.cancel()
  webLibrary?.flush()
  void companion?.close()
  void staticServer?.close()
})
