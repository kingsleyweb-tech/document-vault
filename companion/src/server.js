import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { canLaunch, previewType } from './kinds.js'
import { isInside, rootProblem } from './paths.js'
import { parseSearch, search } from './search.js'
import { isShortcut, readShortcut } from './shortcuts.js'
import { friendlyError } from './indexer.js'

// Local HTTP API used by the Document Vault web app.
//
// Security model:
// - Listens on 127.0.0.1 only, and rejects requests whose Host header is not
//   this loopback address (protects against DNS rebinding).
// - Browsers may call it only from the configured Document Vault origins (CORS).
// - Every call except /v1/hello and /v1/pair needs a bearer token. A browser
//   gets one by entering the pairing code shown in the companion's window;
//   only SHA-256 hashes of tokens are stored.
// - Requests name index entries by id. The companion never takes a free-form
//   path to open, and never runs commands from the request.
// - Programs and scripts are never launched, only shown in Explorer. A
//   shortcut is never launched either: the companion reads where it points and
//   opens that instead, if it is a website, a folder or a document.
// - Only folders the user added are indexed, and system folders are refused.

export const VERSION = '1.0.0'
const MAX_BODY = 16 * 1024
const PAIRING_TTL_MS = 10 * 60 * 1000
const MAX_PAIRING_FAILURES = 5
const MAX_PREVIEW_BYTES = 60 * 1024 * 1024
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const hashToken = (token) => createHash('sha256').update(token).digest('hex')

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function createCompanionServer({ store, indexer, config, saveConfig, launcher, dataDir, port, log = () => {} }) {
  let pairing = null
  let pairingFailures = 0
  const hostAllowed = (host) => {
    const actual = server.address()?.port ?? port
    return host === `127.0.0.1:${actual}` || host === `localhost:${actual}`
  }

  function newPairingCode() {
    const code = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')
    pairing = { code, expires: Date.now() + PAIRING_TTL_MS }
    pairingFailures = 0
    log(`Pairing code: ${code.slice(0, 4)}-${code.slice(4)} (valid for 10 minutes)`)
    return pairing.code
  }

  function authorised(request) {
    const header = request.headers.authorization ?? ''
    const match = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(header)
    if (!match) return null
    const digest = Buffer.from(hashToken(match[1]), 'hex')
    return config.tokens.find((entry) => {
      const stored = Buffer.from(entry.hash, 'hex')
      return stored.length === digest.length && timingSafeEqual(stored, digest)
    }) ?? null
  }

  async function readJson(request) {
    const type = request.headers['content-type'] ?? ''
    // Requiring JSON forces browsers to send a CORS preflight, which unknown origins fail.
    if (!type.startsWith('application/json')) throw new HttpError(415, 'Send JSON.')
    let size = 0
    const chunks = []
    for await (const chunk of request) {
      size += chunk.length
      if (size > MAX_BODY) throw new HttpError(413, 'Request too large.')
      chunks.push(chunk)
    }
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('not an object')
      return value
    } catch {
      throw new HttpError(400, 'Invalid JSON.')
    }
  }

  const describeRoot = (root) => ({
    id: root.id,
    path: root.path,
    status: root.status,
    error: root.error,
    addedAt: root.added_at,
    lastScanAt: root.last_scan_at,
    lastScanMs: root.last_scan_ms,
    files: Number(root.file_count ?? 0),
    folders: Number(root.folder_count ?? 0),
    watching: indexer.watchers.has(root.id),
  })

  const describeEntry = (row, availability = row.accessible ? 'available' : 'denied') => ({
    id: row.id,
    rootId: row.root_id,
    name: row.name,
    path: row.path,
    folder: path.dirname(row.path),
    kind: row.kind,
    extension: row.ext,
    isFolder: Boolean(row.is_dir),
    size: row.size,
    modifiedAt: row.mtime || null,
    readOnly: Boolean(row.readonly),
    hidden: Boolean(row.hidden),
    availability,
    canOpen: Boolean(row.is_dir) || canLaunch(row.name) || isShortcut(row.name),
    canPreview: !row.is_dir && previewType(row.name) !== null && row.size <= MAX_PREVIEW_BYTES,
  })

  /** Checks a result against the disk, so moved or deleted files are flagged straight away. */
  async function availabilityOf(row) {
    try {
      const info = await fs.promises.stat(row.path)
      if (Boolean(row.is_dir) !== info.isDirectory()) return 'missing'
      // A folder can exist yet refuse to list its contents.
      if (info.isDirectory()) await (await fs.promises.opendir(row.path)).close()
      if (!row.accessible) store.setAccessible(row.id, true)
      return 'available'
    } catch (error) {
      if (error.code === 'EACCES' || error.code === 'EPERM' || error.code === 'EBUSY') return 'denied'
      const root = store.getRoot(row.root_id)
      if (root && !fs.existsSync(root.path)) return 'offline'
      return 'missing'
    }
  }

  /** Finds an indexed entry and confirms it still lies inside an indexed folder. */
  async function resolveEntry(id) {
    const row = Number.isSafeInteger(id) ? store.getEntry(id) : null
    if (!row) throw new HttpError(404, 'This item is no longer in the index.')
    const root = store.getRoot(row.root_id)
    if (!root || !isInside(row.path, root.path)) throw new HttpError(403, 'This item is outside the indexed folders.')
    const availability = await availabilityOf(row)
    if (availability === 'missing') {
      store.removePath(row.path)
      throw new HttpError(410, 'This item was moved or deleted. The index has been updated.')
    }
    if (availability === 'offline') throw new HttpError(409, 'The drive or folder holding this item is not connected.')
    if (availability === 'denied') throw new HttpError(403, 'The system denied access to this item.')
    // A link inside an indexed folder could point anywhere; follow it and check again.
    const [real, realRoot] = await Promise.all([fs.promises.realpath(row.path), fs.promises.realpath(root.path)])
    if (!isInside(real, realRoot)) throw new HttpError(403, 'This item points outside the indexed folders.')
    return { row, real }
  }

  // The target comes from the shortcut file, never from the request. It may lie
  // outside the indexed folders, as most desktop shortcuts do; opening it is the
  // same as double-clicking the shortcut, except that programs are refused and
  // the shortcut's command-line arguments are dropped.
  async function openShortcut(row) {
    const target = await readShortcut(row.path).catch(() => null)
    if (!target) throw new HttpError(422, 'Document Vault could not tell where this shortcut points. Use "Show in folder" instead.')
    if (target.url) {
      await launcher.openLink(target.url)
      log(`Opened the link in shortcut #${row.id}`)
      return { ok: true }
    }
    let info
    let real
    try {
      info = await fs.promises.stat(target.path)
      real = await fs.promises.realpath(target.path)
    } catch {
      throw new HttpError(410, 'This shortcut points to an item that was moved, deleted or is on a drive that is not connected.')
    }
    if (!info.isDirectory() && (!canLaunch(target.path) || !canLaunch(real))) {
      throw new HttpError(403, 'This shortcut starts a program. Programs are not run from Document Vault; use "Show in folder" instead.')
    }
    await launcher.open(target.path)
    log(`Opened the ${info.isDirectory() ? 'folder' : 'file'} shortcut #${row.id} points to`)
    return { ok: true }
  }

  const routes = [
    ['GET', /^\/v1\/hello$/, false, () => ({ name: 'Document Vault Companion', version: VERSION, platform: process.platform })],

    ['POST', /^\/v1\/pair$/, false, async (request) => {
      const body = await readJson(request)
      const code = String(body.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
      if (!pairing || Date.now() > pairing.expires) {
        newPairingCode()
        throw new HttpError(403, 'The pairing code has expired. Use the new code shown in the companion window.')
      }
      const expected = Buffer.from(pairing.code)
      const given = Buffer.from(code.padEnd(expected.length, '#').slice(0, expected.length))
      if (!timingSafeEqual(expected, given) || code.length !== expected.length) {
        pairingFailures += 1
        if (pairingFailures >= MAX_PAIRING_FAILURES) {
          newPairingCode()
          throw new HttpError(429, 'Too many wrong codes. A new code is shown in the companion window.')
        }
        throw new HttpError(403, 'That pairing code is not correct.')
      }
      const token = randomBytes(32).toString('base64url')
      config.tokens.push({ hash: hashToken(token), label: String(body.label ?? 'Browser').slice(0, 80), origin: request.headers.origin ?? null, createdAt: Date.now() })
      saveConfig(config)
      pairing = null
      log('A browser was paired.')
      return { token }
    }],

    ['POST', /^\/v1\/unpair$/, true, (_request, _match, token) => {
      config.tokens = config.tokens.filter((entry) => entry !== token)
      saveConfig(config)
      return { ok: true }
    }],

    ['GET', /^\/v1\/status$/, true, () => ({
      version: VERSION,
      index: indexer.status(),
      roots: store.listRoots().map(describeRoot),
    })],

    ['POST', /^\/v1\/roots$/, true, async (request) => {
      const body = await readJson(request)
      return addRoot(String(body.path ?? '').trim())
    }],

    ['POST', /^\/v1\/roots\/pick$/, true, async () => {
      const chosen = await launcher.pickFolder()
      if (!chosen) return { cancelled: true }
      return addRoot(chosen)
    }],

    ['DELETE', /^\/v1\/roots\/(\d+)$/, true, (_request, match) => {
      const root = store.getRoot(Number(match[1]))
      if (!root) throw new HttpError(404, 'That folder is not indexed.')
      indexer.removeRoot(root.id)
      return { ok: true }
    }],

    ['POST', /^\/v1\/index\/rescan$/, true, async (request) => {
      const body = await readJson(request)
      const roots = body.rootId ? [store.getRoot(Number(body.rootId))].filter(Boolean) : store.listRoots()
      for (const root of roots) indexer.enqueue(root.id)
      return { queued: roots.map((root) => root.id) }
    }],
    ['POST', /^\/v1\/index\/pause$/, true, () => (indexer.pause(), indexer.status())],
    ['POST', /^\/v1\/index\/resume$/, true, () => (indexer.resume(), indexer.status())],

    ['GET', /^\/v1\/search$/, true, async (request) => {
      const url = new URL(request.url, 'http://127.0.0.1')
      const query = parseSearch(url.searchParams)
      const started = performance.now()
      const result = search(store.db, query)
      const items = await Promise.all(result.items.map(async (row) => describeEntry(row, await availabilityOf(row))))
      return { ...result, items, tookMs: Math.round(performance.now() - started), query: { ...query } }
    }],

    ['GET', /^\/v1\/entries\/(\d+)$/, true, async (_request, match) => {
      const row = store.getEntry(Number(match[1]))
      if (!row) throw new HttpError(404, 'This item is no longer in the index.')
      return describeEntry(row, await availabilityOf(row))
    }],

    ['POST', /^\/v1\/entries\/(\d+)\/open$/, true, async (_request, match) => {
      const { row, real } = await resolveEntry(Number(match[1]))
      if (!row.is_dir && isShortcut(row.name)) return openShortcut(row)
      if (!row.is_dir && (!canLaunch(row.name) || !canLaunch(real))) {
        throw new HttpError(403, 'Programs, scripts and shortcuts are not opened from Document Vault. Use "Show in folder" instead.')
      }
      await launcher.open(row.path)
      log(`Opened ${row.is_dir ? 'folder' : 'file'} #${row.id}`)
      return { ok: true }
    }],

    ['POST', /^\/v1\/entries\/(\d+)\/reveal$/, true, async (_request, match) => {
      const { row } = await resolveEntry(Number(match[1]))
      await launcher.reveal(row.path)
      return { ok: true }
    }],

    ['GET', /^\/v1\/entries\/(\d+)\/content$/, true, async (_request, match, _token, response) => {
      const { row } = await resolveEntry(Number(match[1]))
      const type = row.is_dir ? null : previewType(row.name)
      if (!type) throw new HttpError(415, 'This file type cannot be previewed. Open it on your computer instead.')
      const info = await fs.promises.stat(row.path)
      if (info.size > MAX_PREVIEW_BYTES) throw new HttpError(413, 'This file is too large to preview. Open it on your computer instead.')
      response.writeHead(200, {
        'Content-Type': type,
        'Content-Length': info.size,
        'Cache-Control': 'no-store',
        'Content-Disposition': 'attachment',
      })
      await new Promise((resolve, reject) => {
        fs.createReadStream(row.path).on('error', reject).on('end', resolve).pipe(response)
      })
      return undefined
    }],
  ]

  function addRoot(target) {
    const problem = rootProblem(target, dataDir)
    if (problem) throw new HttpError(400, problem)
    let resolved
    let info
    try {
      // The real path expands 8.3 short names (C:\Users\JOHNSM~1) and follows
      // junctions, so neither can be used to reach a protected location.
      resolved = fs.realpathSync.native(path.resolve(target))
      info = fs.statSync(resolved)
    } catch (error) {
      throw new HttpError(400, friendlyError(error))
    }
    const realProblem = rootProblem(resolved, dataDir)
    if (realProblem) throw new HttpError(400, realProblem)
    if (!info.isDirectory()) throw new HttpError(400, 'This path is not a folder.')
    const existing = store.rootByPath(resolved)
    if (existing) return { root: describeRoot(existing), alreadyIndexed: true }
    const covering = store.listRoots().find((root) => isInside(resolved, root.path))
    if (covering) throw new HttpError(409, `This folder is already covered by ${covering.path}.`)
    const root = store.addRoot(resolved)
    // Folders inside the new one are now covered by it; merge them.
    for (const other of store.listRoots()) {
      if (other.id !== root.id && isInside(other.path, resolved)) indexer.removeRoot(other.id)
    }
    indexer.enqueue(root.id)
    log(`Added folder ${resolved}`)
    return { root: describeRoot(store.listRoots().find((entry) => entry.id === root.id)) }
  }

  function corsHeaders(origin) {
    if (!origin || !config.allowedOrigins.includes(origin)) return {}
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Private-Network': 'true',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    }
  }

  const server = http.createServer(async (request, response) => {
    const origin = request.headers.origin
    const send = (status, body) => {
      if (response.headersSent) {
        response.end()
        return
      }
      response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...corsHeaders(origin),
      })
      response.end(JSON.stringify(body))
    }

    if (!hostAllowed(request.headers.host ?? '')) return send(421, { error: 'Unexpected host.' })
    if (origin && !config.allowedOrigins.includes(origin)) return send(403, { error: 'This website is not allowed to use the companion.' })
    for (const [name, value] of Object.entries(corsHeaders(origin))) response.setHeader(name, value)
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      return response.end()
    }

    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const route = routes.find(([method, pattern]) => method === request.method && pattern.test(pathname))
    if (!route) return send(404, { error: 'Not found.' })
    const [, pattern, needsToken, handler] = route
    try {
      const token = needsToken ? authorised(request) : null
      if (needsToken && !token) throw new HttpError(401, 'Pair this browser with the companion first.')
      const result = await handler(request, pathname.match(pattern), token, response)
      if (result !== undefined) send(200, result)
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      if (status === 500) log(`Error: ${error?.message}`)
      send(status, { error: status === 500 ? 'The companion could not complete this request.' : error.message })
    }
  })

  return { server, newPairingCode }
}
