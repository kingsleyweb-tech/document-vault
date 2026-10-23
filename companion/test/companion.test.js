// End-to-end tests of the companion: a real HTTP server, a real SQLite index
// and real folders in a temporary directory. Only the launcher (which would
// open windows on this computer) is replaced by a recorder.
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { startCompanion } from '../src/main.js'

const ORIGIN = 'http://localhost:5173'
// Not under %TEMP%: that is inside AppData, which the companion refuses to index.
const sandboxBase = path.join(import.meta.dirname, '..', '.test-sandbox')
fs.mkdirSync(sandboxBase, { recursive: true })
const sandbox = fs.mkdtempSync(path.join(sandboxBase, 'run-'))
const home = path.join(sandbox, 'home')
const documents = path.join(home, 'Documents')
const desktop = path.join(home, 'Desktop')
const dataDir = path.join(sandbox, 'data')

const FILES = {
  'Documents/Military Reports/Annual Report 2025.docx': 'docx',
  'Documents/Military Reports/Training Schedule.pdf': 'pdf',
  'Documents/Presentations/Quarterly presentation.pptx': 'pptx',
  'Documents/Finance/Budget 2026.xlsx': 'xlsx',
  'Documents/Finance/receipt-03.png': 'png',
  'Documents/notes/readme.txt': 'hello from a text file',
  'Documents/tools/setup.exe': 'MZ',
  'Documents/tools/run.bat': '@echo off',
  'Documents/Old link.lnk': 'L',
  'Documents/links/Example site.url': '[InternetShortcut]\r\nURL=https://example.com/page?a=1\r\n',
  'Documents/links/Script site.url': '[InternetShortcut]\r\nURL=javascript:alert(1)\r\n',
  'Documents/links/Mac site.webloc': '<?xml version="1.0"?><plist><dict><key>URL</key><string>https://example.org/?x=1&amp;y=2</string></dict></plist>',
  'Outside/Lettre à Zoé.docx': 'docx',
  'Documents/node_modules/pkg/index.js': 'skipped',
  'Documents/Locked/secret plans.docx': 'x',
  'Desktop/document.pdf': 'pdf',
}

// Windows shortcuts made the way Explorer makes them, through the Shell's COM object.
const SHORTCUTS = {
  'Documents/links/Schedule.lnk': 'Documents/Military Reports/Training Schedule.pdf',
  'Documents/links/Letter.lnk': 'Outside/Lettre à Zoé.docx',
  'Documents/links/Reports folder.lnk': 'Documents/Military Reports',
  'Documents/links/Setup.lnk': 'Documents/tools/setup.exe',
}

function createShortcuts() {
  const script = Object.entries(SHORTCUTS)
    .map(([link, target]) => `$s = $shell.CreateShortcut('${path.join(home, link).replace(/'/g, "''")}'); $s.TargetPath = '${path.join(home, target).replace(/'/g, "''")}'; $s.Save()`)
    .join('; ')
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$shell = New-Object -ComObject WScript.Shell; ${script}`], { stdio: 'ignore' })
}

const calls = []
const launcher = {
  open: async (target) => void calls.push(['open', target]),
  openLink: async (url) => void calls.push(['openLink', url]),
  reveal: async (target) => void calls.push(['reveal', target]),
  pickFolder: async () => documents,
}

let companion
let base
let token

function request(method, route, { body, headers = {}, auth = true } = {}) {
  return fetch(base + route, {
    method,
    headers: {
      Origin: ORIGIN,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(auth ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

async function json(method, route, options) {
  const response = await request(method, route, options)
  return { status: response.status, body: await response.json() }
}

const find = async (q, extra = '') => (await json('GET', `/v1/search?q=${encodeURIComponent(q)}${extra}`)).body

async function waitFor(check, timeout = 15000) {
  const started = Date.now()
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() - started > timeout) throw new Error('Timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

const idle = () => waitFor(async () => (await json('GET', '/v1/status')).body.index.state === 'idle' && companion.indexer.queue.length === 0)

let lockedDenied = false

before(async () => {
  for (const [relative, content] of Object.entries(FILES)) {
    const target = path.join(home, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  if (process.platform === 'win32') createShortcuts()
  // Make one folder unreadable with a Windows deny rule for the current user.
  if (process.platform === 'win32') {
    try {
      execFileSync('icacls', [path.join(documents, 'Locked'), '/deny', `${process.env.USERNAME}:(OI)(CI)(RD)`], { stdio: 'ignore' })
      lockedDenied = true
    } catch {
      lockedDenied = false
    }
  }
  const messages = []
  companion = await startCompanion({ dataDir, port: 0, launcher, log: (message) => messages.push(message) })
  base = `http://127.0.0.1:${companion.port}`
  const code = companion.newPairingCode()
  const paired = await json('POST', '/v1/pair', { body: { code, label: 'test' }, auth: false })
  assert.equal(paired.status, 200)
  token = paired.body.token
  assert.equal((await json('POST', '/v1/roots', { body: { path: documents } })).status, 200)
  assert.equal((await json('POST', '/v1/roots', { body: { path: desktop } })).status, 200)
  await idle()
})

after(async () => {
  await companion?.close()
  if (lockedDenied) execFileSync('icacls', [path.join(documents, 'Locked'), '/remove:d', process.env.USERNAME], { stdio: 'ignore' })
  fs.rmSync(sandbox, { recursive: true, force: true })
})

describe('finding local files that were never uploaded', () => {
  for (const [q, name] of [
    ['Annual Report 2025', 'Annual Report 2025.docx'],
    ['Training Schedule', 'Training Schedule.pdf'],
    ['Quarterly presentation', 'Quarterly presentation.pptx'],
    ['Budget 2026', 'Budget 2026.xlsx'],
  ]) {
    it(`finds ${name}`, async () => {
      const result = await find(q)
      assert.equal(result.items[0]?.name, name)
      assert.equal(result.items[0].availability, 'available')
    })
  }

  it('finds a folder by name and reports its full path', async () => {
    const result = await find('Military Reports', '&type=folder')
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].path, path.join(documents, 'Military Reports'))
    assert.equal(result.items[0].isFolder, true)
  })

  it('shows the real location of a file', async () => {
    const [hit] = (await find('Annual Report 2025')).items
    assert.equal(hit.path, path.join(documents, 'Military Reports', 'Annual Report 2025.docx'))
    assert.equal(hit.folder, path.join(documents, 'Military Reports'))
    assert.equal(hit.kind, 'word')
    assert.ok(hit.modifiedAt > 0)
    assert.equal(hit.size, 4)
  })

  for (const [q, expected] of [
    ['Annual', 'Annual Report 2025.docx'],
    ['Report', 'Annual Report 2025.docx'],
    ['nnual rep', 'Annual Report 2025.docx'],
    ['budget', 'Budget 2026.xlsx'],
    ['presentation', 'Quarterly presentation.pptx'],
    ['training', 'Training Schedule.pdf'],
    ['document.pdf', 'document.pdf'],
    ['03', 'receipt-03.png'],
  ]) {
    it(`partial search "${q}" finds ${expected}`, async () => {
      const names = (await find(q)).items.map((item) => item.name)
      assert.ok(names.includes(expected), `${q} -> ${names.join(', ')}`)
    })
  }

  it('tolerates typing mistakes', async () => {
    const result = await find('anual reprot')
    assert.equal(result.fuzzy, true)
    assert.equal(result.items[0]?.name, 'Annual Report 2025.docx')
  })

  it('does not index dependency folders', async () => {
    assert.equal((await find('index.js')).items.length, 0)
  })
})

describe('filters', () => {
  it('filters by type', async () => {
    const result = await find('', '&kind=pdf')
    assert.deepEqual(result.items.map((item) => item.name).sort(), ['Training Schedule.pdf', 'document.pdf'])
  })

  it('limits a search to one folder', async () => {
    const result = await find('pdf', `&within=${encodeURIComponent(path.join(documents, 'Military Reports'))}`)
    assert.deepEqual(result.items.map((item) => item.name), ['Training Schedule.pdf'])
  })

  it('limits a search to one indexed root', async () => {
    const roots = (await json('GET', '/v1/status')).body.roots
    const desktopRoot = roots.find((root) => root.path === desktop)
    const result = await find('pdf', `&root=${desktopRoot.id}&type=file`)
    assert.deepEqual(result.items.map((item) => item.name), ['document.pdf'])
  })

  it('filters by size and modification date', async () => {
    const big = path.join(documents, 'Finance', 'Large export.csv')
    fs.writeFileSync(big, 'x'.repeat(50_000))
    const old = new Date('2020-01-15T12:00:00Z')
    fs.utimesSync(path.join(documents, 'notes', 'readme.txt'), old, old)
    await json('POST', '/v1/index/rescan', { body: {} })
    await idle()
    assert.deepEqual((await find('', '&minSize=10000')).items.map((item) => item.name), ['Large export.csv'])
    const before2021 = (await find('', `&type=file&modifiedBefore=${Date.parse('2021-01-01')}`)).items.map((item) => item.name)
    assert.deepEqual(before2021, ['readme.txt'])
  })

  it('pages through large result sets', async () => {
    const first = await find('', '&type=file&limit=3&sort=name')
    const second = await find('', '&type=file&limit=3&offset=3&sort=name')
    assert.equal(first.items.length, 3)
    assert.ok(first.total > 6)
    assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 6)
  })

  it('an empty search lists the most recently modified items', async () => {
    const result = await find('', '&limit=10')
    assert.ok(result.total > 10)
    const times = result.items.map((item) => item.modifiedAt)
    assert.deepEqual(times, [...times].sort((a, b) => b - a))
  })
})

describe('opening local files', () => {
  it('opens a document with its associated app', async () => {
    const [hit] = (await find('Annual Report 2025')).items
    calls.length = 0
    assert.equal((await json('POST', `/v1/entries/${hit.id}/open`, { body: {} })).status, 200)
    assert.deepEqual(calls, [['open', hit.path]])
  })

  it('opens a folder in File Explorer', async () => {
    const [hit] = (await find('Military Reports', '&type=folder')).items
    calls.length = 0
    assert.equal((await json('POST', `/v1/entries/${hit.id}/open`, { body: {} })).status, 200)
    assert.deepEqual(calls, [['open', hit.path]])
  })

  for (const name of ['setup.exe', 'run.bat']) {
    it(`never launches ${name}, but can show it in Explorer`, async () => {
      const [hit] = (await find(name)).items
      assert.equal(hit.canOpen, false)
      calls.length = 0
      const opened = await json('POST', `/v1/entries/${hit.id}/open`, { body: {} })
      assert.equal(opened.status, 403)
      assert.deepEqual(calls, [])
      assert.equal((await json('POST', `/v1/entries/${hit.id}/reveal`, { body: {} })).status, 200)
      assert.deepEqual(calls, [['reveal', hit.path]])
    })
  }

  it('opens the website an internet shortcut points to', async () => {
    for (const [name, url] of [['Example site.url', 'https://example.com/page?a=1'], ['Mac site.webloc', 'https://example.org/?x=1&y=2']]) {
      const [hit] = (await find(name)).items
      assert.equal(hit.canOpen, true)
      calls.length = 0
      assert.equal((await json('POST', `/v1/entries/${hit.id}/open`, { body: {} })).status, 200)
      assert.deepEqual(calls, [['openLink', url]])
    }
  })

  it('refuses shortcuts to anything but a web page', async () => {
    for (const name of ['Script site.url', 'Old link.lnk']) {
      const [hit] = (await find(name)).items
      calls.length = 0
      assert.equal((await json('POST', `/v1/entries/${hit.id}/open`, { body: {} })).status, 422)
      assert.deepEqual(calls, [])
    }
  })

  describe('Windows shortcuts', { skip: process.platform !== 'win32' && 'shortcuts are made with the Windows Shell' }, () => {
    for (const [name, target] of [
      ['Schedule.lnk', 'Documents/Military Reports/Training Schedule.pdf'],
      ['Letter.lnk', 'Outside/Lettre à Zoé.docx'],
      ['Reports folder.lnk', 'Documents/Military Reports'],
    ]) {
      it(`opens what ${name} points to`, async () => {
        const [hit] = (await find(name)).items
        assert.equal(hit.canOpen, true)
        calls.length = 0
        assert.equal((await json('POST', `/v1/entries/${hit.id}/open`, { body: {} })).status, 200)
        assert.deepEqual(calls, [['open', path.join(home, target)]])
      })
    }

    it('never runs a program through a shortcut', async () => {
      const [hit] = (await find('Setup.lnk')).items
      calls.length = 0
      const opened = await json('POST', `/v1/entries/${hit.id}/open`, { body: {} })
      assert.equal(opened.status, 403)
      assert.match(opened.body.error, /program/)
      assert.deepEqual(calls, [])
    })
  })

  it('serves web pages for preview as plain text', async () => {
    const page = path.join(documents, 'notes', 'page.htm')
    fs.writeFileSync(page, '<p>Hello</p>')
    await waitFor(async () => (await find('page.htm')).items[0])
    const [hit] = (await find('page.htm')).items
    assert.equal(hit.canPreview, true)
    const response = await request('GET', `/v1/entries/${hit.id}/content`)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /^text\/plain/)
    assert.equal(await response.text(), '<p>Hello</p>')
  })

  it('serves previewable files to the web app and refuses others', async () => {
    const [text] = (await find('readme.txt')).items
    const response = await request('GET', `/v1/entries/${text.id}/content`)
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'hello from a text file')
    const [exe] = (await find('setup.exe')).items
    assert.equal((await request('GET', `/v1/entries/${exe.id}/content`)).status, 415)
  })
})

describe('keeping the index in sync', () => {
  it('drops a deleted file after synchronisation', async () => {
    const target = path.join(desktop, 'temporary note.txt')
    fs.writeFileSync(target, 'soon gone')
    await waitFor(async () => (await find('temporary note')).items.length === 1)
    fs.rmSync(target)
    await waitFor(async () => (await find('temporary note')).items.length === 0)
  })

  it('reflects a renamed file', async () => {
    const from = path.join(desktop, 'draft letter.docx')
    const to = path.join(desktop, 'final letter.docx')
    fs.writeFileSync(from, 'letter')
    await waitFor(async () => (await find('draft letter')).items.length === 1)
    fs.renameSync(from, to)
    await waitFor(async () => (await find('final letter')).items.length === 1 && (await find('draft letter')).items.length === 0)
  })

  it('reflects a renamed folder and its contents', async () => {
    fs.mkdirSync(path.join(desktop, 'Trip 2024'))
    fs.writeFileSync(path.join(desktop, 'Trip 2024', 'itinerary.pdf'), 'pdf')
    await waitFor(async () => (await find('itinerary')).items.length === 1)
    fs.renameSync(path.join(desktop, 'Trip 2024'), path.join(desktop, 'Holiday 2024'))
    const moved = await waitFor(async () => {
      const [hit] = (await find('itinerary')).items
      return hit?.path === path.join(desktop, 'Holiday 2024', 'itinerary.pdf') ? hit : null
    })
    assert.ok(moved)
    assert.equal((await find('Trip 2024')).items.length, 0)
  })

  it('a full rescan removes files deleted while not watching', async () => {
    companion.indexer.unwatch([...companion.indexer.watchers.keys()][0])
    companion.indexer.unwatch([...companion.indexer.watchers.keys()][0])
    fs.rmSync(path.join(documents, 'Finance', 'receipt-03.png'))
    assert.equal((await find('receipt-03')).items[0]?.availability, 'missing')
    await json('POST', '/v1/index/rescan', { body: {} })
    await idle()
    assert.equal((await find('receipt-03')).items.length, 0)
  })

  it('opening a file that disappeared explains what happened', async () => {
    const target = path.join(documents, 'notes', 'gone soon.txt')
    fs.writeFileSync(target, 'x')
    await json('POST', '/v1/index/rescan', { body: {} })
    await idle()
    const [hit] = (await find('gone soon')).items
    fs.rmSync(target)
    const response = await json('POST', `/v1/entries/${hit.id}/open`, { body: {} })
    assert.equal(response.status, 410)
    assert.match(response.body.error, /moved or deleted/)
  })

  it('reports folders Windows will not let it read', { skip: !lockedDenied && 'icacls is not available' }, async () => {
    const status = (await json('GET', '/v1/status')).body
    assert.ok(status.index.errors.some((error) => error.path === path.join(documents, 'Locked') && /Access denied/.test(error.message)))
    const [locked] = (await find('Locked', '&type=folder')).items
    assert.equal(locked.availability, 'denied')
    assert.equal((await find('secret plans')).items.length, 0)
  })

  it('a missing drive keeps its entries and is shown as unavailable', async () => {
    const usb = path.join(sandbox, 'usb')
    fs.mkdirSync(usb)
    fs.writeFileSync(path.join(usb, 'Thesis final.docx'), 'thesis')
    const added = await json('POST', '/v1/roots', { body: { path: usb } })
    await idle()
    companion.indexer.unwatch(added.body.root.id)
    fs.rmSync(usb, { recursive: true })
    await json('POST', '/v1/index/rescan', { body: { rootId: added.body.root.id } })
    await idle()
    const root = (await json('GET', '/v1/status')).body.roots.find((entry) => entry.id === added.body.root.id)
    assert.equal(root.status, 'unavailable')
    const [hit] = (await find('Thesis final')).items
    assert.equal(hit.availability, 'offline')
  })
})

describe('performance', () => {
  it('keeps answering while a large folder is indexed, and never rescans the disk to search', async () => {
    const bulk = path.join(sandbox, 'bulk')
    for (let folder = 0; folder < 100; folder += 1) {
      const dir = path.join(bulk, `Folder ${folder}`)
      await fsp.mkdir(dir, { recursive: true })
      await Promise.all(Array.from({ length: 200 }, (_, file) => fsp.writeFile(path.join(dir, `Report ${folder}-${file}.docx`), '')))
    }
    const added = await json('POST', '/v1/roots', { body: { path: bulk } })
    assert.equal(added.status, 200)

    const latencies = []
    while ((await json('GET', '/v1/status')).body.index.state !== 'idle') {
      const started = performance.now()
      await json('GET', '/v1/search?q=Report%2042-1')
      latencies.push(performance.now() - started)
    }
    await idle()
    const total = (await json('GET', '/v1/status')).body.roots.find((root) => root.path === bulk)
    assert.equal(total.files, 20_000)
    assert.ok(latencies.length > 0)
    const worst = Math.max(...latencies)
    console.log(`  indexed 20,000 files in ${total.lastScanMs} ms; ${latencies.length} searches during indexing, slowest ${worst.toFixed(0)} ms`)
    assert.ok(worst < 1500, `slowest search during indexing took ${worst} ms`)

    // Searching reads only the index: no folder listings happen per keystroke.
    // Indexing is paused so that any listing could only come from a search.
    await json('POST', '/v1/index/pause', { body: {} })
    const readdir = fsp.readdir
    let listings = 0
    fsp.readdir = async (...args) => {
      listings += 1
      return readdir(...args)
    }
    try {
      const started = performance.now()
      for (const q of ['R', 'Re', 'Rep', 'Repo', 'Repor', 'Report', 'Report 9', 'Report 99', 'Report 99-1']) await find(q)
      const perSearch = (performance.now() - started) / 9
      console.log(`  average search over ${20_000 + 20} entries: ${perSearch.toFixed(1)} ms`)
      assert.ok(perSearch < 300)
    } finally {
      fsp.readdir = readdir
      await json('POST', '/v1/index/resume', { body: {} })
    }
    assert.equal(listings, 0)
  })

  it('pause stops indexing until resumed', async () => {
    await json('POST', '/v1/index/pause', { body: {} })
    await json('POST', '/v1/index/rescan', { body: {} })
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal((await json('GET', '/v1/status')).body.index.state, 'paused')
    await json('POST', '/v1/index/resume', { body: {} })
    await idle()
  })
})

describe('security', () => {
  it('needs a paired token for every private call', async () => {
    for (const route of ['/v1/status', '/v1/search?q=report', '/v1/entries/1']) {
      assert.equal((await request('GET', route, { auth: false })).status, 401)
      assert.equal((await request('GET', route, { headers: { Authorization: 'Bearer ' + 'x'.repeat(43) } })).status, 401)
    }
    assert.equal((await request('POST', '/v1/entries/1/open', { body: {}, auth: false })).status, 401)
  })

  it('answers only the Document Vault websites', async () => {
    const response = await request('GET', '/v1/status', { headers: { Origin: 'https://evil.example' } })
    assert.equal(response.status, 403)
    assert.equal(response.headers.get('access-control-allow-origin'), null)
    const preflight = await fetch(base + '/v1/status', { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET' } })
    assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN)
  })

  it('rejects requests addressed to another host name (DNS rebinding)', async () => {
    const status = await new Promise((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port: companion.port, path: '/v1/hello', headers: { Host: 'attacker.example:' + companion.port } }, (response) => {
          response.resume()
          resolve(response.statusCode)
        })
        .on('error', reject)
    })
    assert.equal(status, 421)
  })

  it('only accepts JSON bodies, so other sites cannot send simple form posts', async () => {
    const response = await fetch(base + '/v1/roots', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' }, body: '{"path":"C:\\\\"}' })
    assert.equal(response.status, 415)
  })

  it('locks pairing after repeated wrong codes', async () => {
    companion.newPairingCode()
    const statuses = []
    for (let attempt = 0; attempt < 5; attempt += 1) {
      statuses.push((await json('POST', '/v1/pair', { body: { code: 'WRONG123' }, auth: false })).status)
    }
    assert.deepEqual(statuses, [403, 403, 403, 403, 429])
  })

  it('refuses system folders and relative or network paths', async () => {
    for (const target of [process.env.SystemRoot || 'C:\\Windows', path.join(os.homedir(), 'AppData'), 'Documents', '\\\\server\\share', dataDir]) {
      const response = await json('POST', '/v1/roots', { body: { path: target } })
      assert.equal(response.status, 400, target)
    }
  })

  it('refuses protected folders reached through 8.3 short names or junctions', async () => {
    const appDataLocal = path.join(os.homedir(), 'AppData', 'Local')
    const shortPath = execFileSync('powershell.exe', ['-NoProfile', '-Command', '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:DV_T).ShortPath'], {
      encoding: 'utf8',
      env: { ...process.env, DV_T: appDataLocal },
    }).trim()
    // The junction targets the companion's own (protected) data folder, so a
    // failed run never leaves a link to real user data inside the sandbox.
    const junction = path.join(sandbox, 'innocent-looking')
    fs.symlinkSync(dataDir, junction, 'junction')
    try {
      for (const target of [shortPath, junction]) {
        const response = await json('POST', '/v1/roots', { body: { path: target } })
        assert.equal(response.status, 400, target)
        assert.match(response.body.error, /cannot be indexed/)
      }
    } finally {
      fs.rmdirSync(junction) // removes the link only, never the target
    }
  })

  it('a revoked token stops working', async () => {
    const code = companion.newPairingCode()
    const extra = (await json('POST', '/v1/pair', { body: { code }, auth: false })).body.token
    const asExtra = { headers: { Authorization: `Bearer ${extra}` } }
    assert.equal((await request('GET', '/v1/status', asExtra)).status, 200)
    assert.equal((await request('POST', '/v1/unpair', { ...asExtra, body: {} })).status, 200)
    assert.equal((await request('GET', '/v1/status', asExtra)).status, 401)
  })

  it('stores only hashes of tokens', () => {
    const saved = fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')
    assert.ok(!saved.includes(token))
  })

  it('removing a folder from the index leaves the files on disk', async () => {
    const roots = (await json('GET', '/v1/status')).body.roots
    const desktopRoot = roots.find((root) => root.path === desktop)
    assert.equal((await json('DELETE', `/v1/roots/${desktopRoot.id}`)).status, 200)
    assert.equal((await find('document.pdf')).items.length, 0)
    assert.ok(fs.existsSync(path.join(desktop, 'document.pdf')))
  })
})
