'use strict'

// Checks the in-app browser in real Electron, against web pages served from
// this computer. Run with: npx electron test/web-browser.electron.cjs
// (Pages on this computer are refused in the app; the test turns that off for
// one browser and checks the refusal with another.)

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const https = require('node:https')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')
const { createWebBrowser } = require('../src/web-browser.cjs')

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-web-test-'))
app.setPath('userData', path.join(temp, 'profile'))
app.commandLine.appendSwitch('disable-gpu')

const page = (title, body = '') => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

function fakeLibrary() {
  const visits = []
  return { visits, recordVisit: (visit) => visits.push(visit), titleVisit: () => {} }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(check, what, ms = 8000) {
  const end = Date.now() + ms
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`)
    await wait(50)
  }
}

const results = []
const SKIPPED = Symbol('skipped')
async function test(name, run) {
  try {
    if ((await run()) === SKIPPED) {
      results.push({ name, ok: true, skipped: true })
      console.log(`skip - ${name}`)
      return
    }
    results.push({ name, ok: true })
    console.log(`ok - ${name}`)
  } catch (error) {
    results.push({ name, ok: false })
    console.log(`not ok - ${name}\n  ${error.stack ?? error}`)
  }
}

async function main() {
  await app.whenReady()
  const window = new BrowserWindow({ show: false, width: 1200, height: 800 })
  await window.loadURL('data:text/html,<title>host</title>')

  const server = await serve((request, response) => {
    const url = new URL(request.url, 'http://x')
    if (url.pathname === '/a') return response.end(page('Page A', `<a id="next" href="/b">B</a> <a id="file" href="file:///C:/Windows/win.ini">file</a>`))
    if (url.pathname === '/b') return response.end(page('Page B'))
    if (url.pathname === '/to-file') {
      response.writeHead(302, { Location: 'file:///C:/Windows/win.ini' })
      return response.end()
    }
    if (url.pathname === '/to-b') {
      response.writeHead(302, { Location: '/b' })
      return response.end()
    }
    if (url.pathname === '/download') {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="contract.docx"' })
      return response.end('not really a document')
    }
    if (url.pathname === '/frame') return response.end(page('Frame', '<iframe id="f" src="file:///C:/Windows/win.ini"></iframe>'))
    response.statusCode = 404
    response.end(page('Not found'))
  })
  const base = `http://127.0.0.1:${server.address().port}`

  const notices = []
  const states = []
  const library = fakeLibrary()
  const browser = createWebBrowser({
    getWindow: () => window,
    library,
    notify: (kind, payload) => (kind === 'notice' ? notices : states).push(payload),
    openExternal: () => {},
    allowLoopback: true,
    partition: 'web-test-loopback',
    maxTabs: 4,
    sleepAfterMs: 1500,
  })
  browser.setHost('host', { x: 10, y: 20, width: 600, height: 400 })

  const tabState = (id) => browser.state().tabs.find((tab) => tab.id === id)
  const loaded = (id, url) => until(() => !tabState(id).loading && tabState(id).url === url && browser.contentsOf(id)?.getURL() === url, `${url} to load`)
  const noticeOf = (kind, after) => until(() => notices.slice(after).find((item) => item.kind === kind), `a ${kind} notice`)

  const { tabId } = browser.open({ url: `${base}/a`, newTab: true })
  const contents = () => browser.contentsOf(tabId)

  await test('opens a web page in a tab, shown over the host area', async () => {
    await loaded(tabId, `${base}/a`)
    await until(() => tabState(tabId).title === 'Page A', 'the title')
    assert.ok(library.visits.some((visit) => visit.url === `${base}/a`))
    const view = window.contentView.children.find((child) => child.webContents === contents())
    assert.deepEqual(view.getBounds(), { x: 10, y: 20, width: 600, height: 400 })
    assert.equal(view.getVisible(), true)
  })

  await test('the page has no Node.js and no app bridge', async () => {
    const seen = await contents().executeJavaScript('[typeof require, typeof process, typeof window.documentVaultDesktop, typeof module].join(",")')
    assert.equal(seen, 'undefined,undefined,undefined,undefined')
  })

  await test('links, back and forward work', async () => {
    await contents().executeJavaScript('document.getElementById("next").click()', true)
    await loaded(tabId, `${base}/b`)
    assert.equal(tabState(tabId).canGoBack, true)
    browser.command(tabId, 'back')
    await loaded(tabId, `${base}/a`)
    assert.equal(tabState(tabId).canGoForward, true)
    browser.command(tabId, 'forward')
    await loaded(tabId, `${base}/b`)
  })

  await test('ordinary redirects are followed', async () => {
    browser.navigate(tabId, `${base}/to-b`)
    await loaded(tabId, `${base}/b`)
  })

  await test('a redirect to a file on this computer is refused', async () => {
    browser.navigate(tabId, `${base}/to-file`)
    const error = await until(() => tabState(tabId).error, 'the error')
    assert.equal(error.title, 'This page tried to open something on your computer')
    assert.ok(!contents().getURL().startsWith('file:'))
  })

  await test('a link to a file on this computer is refused', async () => {
    browser.navigate(tabId, `${base}/a`)
    await loaded(tabId, `${base}/a`)
    const before = notices.length
    await contents().executeJavaScript('document.getElementById("file").click()', true)
    await noticeOf('blocked', before)
    await wait(300)
    assert.equal(contents().getURL(), `${base}/a`)
  })

  await test('frames and requests cannot reach files on this computer', async () => {
    browser.navigate(tabId, `${base}/frame`)
    await loaded(tabId, `${base}/frame`)
    await wait(300)
    const frameUrl = await contents().executeJavaScript('(() => { try { return document.getElementById("f").contentWindow.location.href } catch { return "blocked" } })()')
    assert.ok(!String(frameUrl).startsWith('file:'), `frame is at ${frameUrl}`)
    const fetched = await contents().executeJavaScript('fetch("file:///C:/Windows/win.ini").then(() => "read", () => "refused")')
    assert.equal(fetched, 'refused')
  })

  await test('javascript:, file: and data: addresses are refused', async () => {
    for (const address of ['javascript:alert(1)', 'file:///C:/Windows/win.ini', 'data:text/html,<b>x</b>', 'chrome://settings', 'view-source:https://example.com']) {
      assert.ok(browser.navigate(tabId, address).error, address)
      assert.ok(browser.open({ url: address }).error, address)
    }
    assert.ok(!contents().getURL().startsWith('javascript:'))
  })

  await test('downloads are cancelled and reported', async () => {
    const before = notices.length
    const saved = fs.readdirSync(app.getPath('downloads')).length
    browser.navigate(tabId, `${base}/download`)
    const notice = await noticeOf('download', before)
    assert.match(notice.message, /contract\.docx/)
    await wait(500)
    assert.equal(fs.readdirSync(app.getPath('downloads')).length, saved)
  })

  await test('location, notifications, camera, microphone and clipboard are refused', async () => {
    browser.navigate(tabId, `${base}/b`)
    await loaded(tabId, `${base}/b`)
    const seen = await contents().executeJavaScript(
      `Promise.all([
        new Promise((resolve) => navigator.geolocation.getCurrentPosition(() => resolve('allowed'), () => resolve('refused'), { timeout: 3000 })),
        Notification.requestPermission(),
        navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(() => 'allowed', () => 'refused'),
        navigator.clipboard.readText().then(() => 'allowed', () => 'refused'),
      ]).then((values) => values.join(','))`,
      true,
    )
    assert.equal(seen, 'refused,denied,refused,refused')
  })

  await test('pop-up windows open as tabs, not windows', async () => {
    const windows = BrowserWindow.getAllWindows().length
    const tabs = browser.state().tabs.length
    await contents().executeJavaScript(`window.open(${JSON.stringify(`${base}/a`)}); 1`, true)
    await until(() => browser.state().tabs.length === tabs + 1, 'a new tab')
    assert.equal(BrowserWindow.getAllWindows().length, windows)
    const before = notices.length
    await contents().executeJavaScript('window.open("file:///C:/Windows/win.ini"); 1', true)
    await noticeOf('blocked', before)
    assert.equal(browser.state().tabs.length, tabs + 1)
  })

  await test('a site that cannot be reached shows an error, not a blank page', async () => {
    const closed = await serve(() => {})
    const port = closed.address().port
    await new Promise((resolve) => closed.close(resolve))
    browser.navigate(tabId, `http://127.0.0.1:${port}/`)
    const error = await until(() => tabState(tabId).error, 'the error')
    assert.equal(error.title, 'The site refused the connection')
    const view = window.contentView.children.find((child) => child.webContents === contents())
    assert.equal(view.getVisible(), false)
  })

  await test('certificate errors are never bypassed', async () => {
    let key
    let cert
    try {
      // DV_TEST_CERT_DIR may hold a key.pem and cert.pem made beforehand.
      const dir = process.env.DV_TEST_CERT_DIR || temp
      const keyFile = path.join(dir, 'key.pem')
      const certFile = path.join(dir, 'cert.pem')
      if (!fs.existsSync(certFile)) execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '1', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' })
      key = fs.readFileSync(keyFile)
      cert = fs.readFileSync(certFile)
    } catch {
      console.log('  (openssl is not available to make a test certificate; set DV_TEST_CERT_DIR)')
      return SKIPPED
    }
    const secure = https.createServer({ key, cert }, (_request, response) => response.end(page('Untrusted')))
    await new Promise((resolve) => secure.listen(0, '127.0.0.1', resolve))
    browser.navigate(tabId, `https://127.0.0.1:${secure.address().port}/`)
    const error = await until(() => tabState(tabId).error, 'the certificate error')
    assert.equal(error.title, 'This site’s security certificate is not trusted')
    assert.notEqual(tabState(tabId).title, 'Untrusted')
    secure.close()
  })

  await test('no more than the tab limit can be open', async () => {
    while (browser.state().tabs.length < 4) browser.newTab()
    assert.match(browser.newTab().error, /up to 4 tabs/)
    assert.equal(browser.state().tabs.length, 4)
  })

  await test('tabs left alone are put to sleep and wake when chosen', async () => {
    const [first, second] = browser.state().tabs
    browser.activate(second.id)
    await until(() => tabState(first.id).sleeping, 'the tab to sleep', 6000)
    assert.equal(browser.contentsOf(first.id), null)
    browser.activate(first.id)
    await until(() => browser.contentsOf(first.id) && !tabState(first.id).sleeping, 'the tab to wake')
  })

  await test('the start page hides the web page; hiding the host hides it too', async () => {
    const id = browser.state().activeId
    browser.navigate(id, `${base}/b`)
    await loaded(id, `${base}/b`)
    const view = () => window.contentView.children.find((child) => child.webContents === browser.contentsOf(id))
    assert.equal(view().getVisible(), true)
    browser.command(id, 'home')
    assert.equal(view().getVisible(), false)
    browser.command(id, 'back')
    assert.equal(view().getVisible(), true)
    browser.setHost('host', null)
    assert.equal(view().getVisible(), false)
  })

  browser.destroy()

  // The browser the app uses: pages on this computer, where the app and its
  // index service listen, are refused.
  const strict = createWebBrowser({ getWindow: () => window, library: fakeLibrary(), notify: () => {}, openExternal: () => {}, partition: 'web-test-strict' })
  await test('addresses on this computer are refused', async () => {
    for (const address of [`${base}/a`, 'http://127.0.0.1:47615/v1/status', 'http://localhost:47616/app', 'http://[::1]:47615/', 'http://0.0.0.0:47615/', 'http://app.localhost/']) {
      assert.ok(strict.open({ url: address }).error, address)
    }
    assert.equal(strict.state().tabs.length, 0)
  })
  strict.destroy()

  server.close()
  window.destroy()
  const failed = results.filter((result) => !result.ok).length
  const skipped = results.filter((result) => result.skipped).length
  console.log(`\n${results.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped`)
  try {
    fs.rmSync(temp, { recursive: true, force: true })
  } catch {
    // Electron may still hold the profile open; it is in the temporary folder.
  }
  app.exit(failed ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  app.exit(1)
})
