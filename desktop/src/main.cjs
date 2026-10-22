'use strict'

const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, net, session, shell } = require('electron')
const { createStaticServer } = require('./static-server.cjs')
const { createBrowserSignIn } = require('./browser-sign-in.cjs')
const { findUpdate } = require('./updates.cjs')

const SITE = 'https://documents-vault.vercel.app'
const RELEASES_URL = `${SITE}/releases/latest.json`
// A fixed port keeps the window's address, and with it the saved sign-in, the
// same between launches. The others are used only if it is taken.
const APP_PORTS = [47616, 47617, 47618, 47619, 47620]
const COMPANION_PORT = 47615
const WEB_ROOT = path.join(__dirname, '..', 'web')
const COMPANION_MAIN = path.join(__dirname, '..', 'companion', 'src', 'main.js').replace('app.asar', 'app.asar.unpacked')

// Pages that may open in a pop-up from the app: Google and Firebase sign-in.
const POPUP_HOSTS = [/^accounts\.google\.com$/, /\.firebaseapp\.com$/, /\.web\.app$/, /^accounts\.youtube\.com$/]

let mainWindow = null
let appOrigin = null
let companion = null
let staticServer = null

// Google sign-in happens in the user's browser; see browser-sign-in.cjs.
const browserSignIn = createBrowserSignIn({
  origin: () => appOrigin,
  openBrowser: (url) => shell.openExternal(url),
  onComplete: () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  },
})

// Development and tests only: a separate profile, so checks never touch a real one.
if (!app.isPackaged && process.env.DV_USER_DATA) app.setPath('userData', process.env.DV_USER_DATA)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
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

  staticServer = createStaticServer(WEB_ROOT, { routes: browserSignIn.routes })
  const port = await staticServer.listen(APP_PORTS)
  appOrigin = `http://localhost:${port}`

  companion = await startCompanion(appOrigin).catch((error) => {
    console.error('Desktop Files is unavailable:', error)
    return null
  })

  registerIpc()
  Menu.setApplicationMenu(buildMenu())
  createWindow()

  if (app.isPackaged) setTimeout(() => void checkForUpdates({ quiet: true }), 10_000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

async function startCompanion(origin) {
  const { startCompanion: startService } = await import(pathToFileURL(COMPANION_MAIN).href)
  const options = {
    dataDir: path.join(app.getPath('userData'), 'companion'),
    extraOrigins: [origin],
    // Cross-platform replacements for the Windows-only launcher.
    launcher: {
      open: async (target) => {
        const problem = await shell.openPath(target)
        if (problem) throw new Error(problem)
      },
      reveal: async (target) => shell.showItemInFolder(target),
      pickFolder: async () => {
        const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
          title: 'Choose a folder for Document Vault to search',
          buttonLabel: 'Index this folder',
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
    mainWindow = null
  })
  guardContents(mainWindow.webContents)
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
  if (contents.getType() !== 'window') return
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
  void companion?.close()
  void staticServer?.close()
})
