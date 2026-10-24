import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { scopeSql } from './access.js'
import { EXTRACTABLE } from './extract/formats.js'
import { DUPLICATE_KINDS, dismissDuplicate, duplicateSummary, listDuplicates } from './duplicates.js'
import { refreshMeta } from './extractor.js'
import { friendlyError } from './indexer.js'
import { canLaunch, canOpenFolder, KINDS, previewType } from './kinds.js'
import { isInside, pathKey, rootProblem } from './paths.js'
import { matchesIn, metaOf, searchRanked } from './ranked.js'
import { parseSearch } from './search.js'
import { isShortcut, readShortcut } from './shortcuts.js'

// Local HTTP API used by the Document Vault web app.
//
// Security model:
// - Listens on 127.0.0.1 only, and rejects requests whose Host header is not
//   this loopback address (protects against DNS rebinding).
// - Browsers may call it only from the configured Document Vault origins (CORS).
// - Every call except /v1/hello and /v1/pair needs a bearer token. A browser
//   gets one by entering the pairing code shown in the companion's window;
//   only SHA-256 hashes of tokens are stored.
// - Requests name libraries and index entries by id. The companion never takes
//   a free-form path to open, and never runs commands from the request.
// - Every entry is checked with the access rules (access.js) when it is used:
//   a revoked library, an excluded folder or a path whose real location lies
//   outside its library is refused, and every list and search is limited to
//   what may be read (scopeSql).
// - Programs and scripts are never launched, only shown in Explorer or Finder.
//   A shortcut is never launched either: the companion reads where it points
//   and opens that instead, if it is a website, or a folder or document inside
//   a library.
// - Only folders the user added are indexed, and system folders are refused.
//   Removing a library, excluding a folder or clearing an index never changes
//   or deletes the files themselves.

export const VERSION = '1.3.0'
const MAX_BODY = 16 * 1024
const PAIRING_TTL_MS = 10 * 60 * 1000
const MAX_PAIRING_FAILURES = 5
const MAX_PREVIEW_BYTES = 60 * 1024 * 1024
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const META_FIELDS = ['title', 'author', 'subject', 'keywords', 'publisher']
// Recognised text with a lower average confidence is listed in Health.
const LOW_CONFIDENCE = 60
const LINK_STATUSES = ['verified', 'unindexed', 'broken', 'outside', 'external']
const EXTRACTABLE_SQL = [...EXTRACTABLE].map((extension) => `'${extension}'`).join(', ')

const hashToken = (token) => createHash('sha256').update(token).digest('hex')

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const PROBLEM_MESSAGES = {
  revoked: 'Access to this library was revoked. Grant access again to use it.',
  excluded: 'This item is in a folder excluded from the library.',
  outside: 'This item is outside your libraries.',
  protected: 'This item is in a system or application folder.',
  'not-in-library': 'This item is not in any of your libraries.',
  paused: 'This library is paused.',
}

/** Paging values from a query string, kept within limits. */
// A stored content hash still describes the file (it has not changed since).
const CURRENT_HASH = 'h.size = e.size and h.mtime = e.mtime and e.size > 0'

// How a folder's contents can be ordered: the order for its subfolders (1) and for its files (0).
const BY_NAME = 'e.name collate nocase, e.id'
const TREE_ORDER = {
  name: { 1: BY_NAME, 0: BY_NAME },
  type: { 1: BY_NAME, 0: `e.kind, e.ext, ${BY_NAME}` },
  modified: { 1: `e.mtime desc, ${BY_NAME}`, 0: `e.mtime desc, ${BY_NAME}` },
  size: { 1: BY_NAME, 0: `e.size desc, ${BY_NAME}` },
}

function paging(params, defaultLimit = 50) {
  const limit = Math.min(Math.max(Math.round(Number(params.get('limit')) || defaultLimit), 1), 200)
  const offset = Math.max(Math.round(Number(params.get('offset')) || 0), 0)
  return { limit, offset }
}

export function createCompanionServer({ store, indexer, extractor, ocr, hasher, access, config, saveConfig, launcher, dataDir, port, log = () => {} }) {
  let pairing = null
  let pairingFailures = 0
  const db = store.db
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

  async function readJson(request, { optional = false } = {}) {
    const type = request.headers['content-type'] ?? ''
    if (optional && !type && !Number(request.headers['content-length'] ?? 0)) return {}
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

  // ── Descriptions sent to the web app ──────────────────────────────────────

  const docCounts = db.prepare('select state, count(*) as n from docs where root_id = ? group by state')
  const docOf = db.prepare('select * from docs where entry_id = ?')
  const ocrCounts = db.prepare(`select ocr_state as state, count(*) as n, sum(ocr_done) as done,
      sum(case when ocr_pages > 0 then ocr_pages else needs_ocr end) as pages
    from docs where root_id = ? and needs_ocr > 0 group by ocr_state`)

  /** Text recognition of a library's scanned pages: what was found, done and left. */
  function describeOcr(root) {
    const states = {}
    let scannedDocs = 0
    let scannedPages = 0
    let recognisedPages = 0
    for (const row of ocrCounts.all(root.id)) {
      states[row.state] = Number(row.n)
      scannedDocs += Number(row.n)
      scannedPages += Number(row.pages ?? 0)
      recognisedPages += Number(row.done ?? 0)
    }
    const current = ocr.currentJob()
    return {
      pref: root.ocr_pref,
      scannedDocs,
      scannedPages,
      recognisedPages,
      pending: (states.pending ?? 0) + (states.processing ?? 0),
      completed: states.completed ?? 0,
      failed: states.failed ?? 0,
      states,
      current: current?.rootId === root.id ? current : null,
    }
  }

  function describeRoot(root) {
    const extraction = Object.fromEntries(docCounts.all(root.id).map((row) => [row.state, Number(row.n)]))
    return {
      id: root.id,
      name: root.name || path.basename(root.path) || root.path,
      path: root.path,
      state: root.state,
      status: root.status,
      error: root.error,
      needsPermission: root.status === 'denied',
      addedAt: root.added_at,
      lastScanAt: root.last_scan_at,
      lastScanMs: root.last_scan_ms,
      lastSyncAt: root.last_sync_at,
      revokedAt: root.revoked_at,
      files: Number(root.file_count ?? 0),
      folders: Number(root.folder_count ?? 0),
      watching: indexer.watchers.has(root.id),
      settings: {
        recursive: Boolean(root.recursive),
        // 0 is stored for "no limit".
        maxDepth: root.max_depth || null,
        fileTypes: root.file_types ? JSON.parse(root.file_types) : null,
        extractText: Boolean(root.extract_text),
        ocr: root.ocr_pref === 'on',
      },
      skippedByType: root.type_skipped,
      exclusions: store.listExclusions(root.id).map((exclusion) => ({ id: exclusion.id, path: exclusion.path, addedAt: exclusion.added_at })),
      extraction,
      ocr: describeOcr(root),
      // No assistant can read any library in this version.
      ai: 'off',
    }
  }

  const rootView = (id) => store.listRoots().find((root) => root.id === id)

  /**
   * Whether a result's text is searchable: 'read' (its text is searched),
   * 'waiting' (not read yet, so only its name is searched for now), 'failed',
   * 'names-only' (a type whose text is not read, or reading is off) or null for folders.
   */
  function textCoverage(row) {
    if (row.is_dir) return null
    const doc = docOf.get(row.id)
    if (doc) {
      if (doc.state === 'completed') return 'read'
      if (doc.state === 'failed') return 'failed'
      if (doc.state === 'skipped') return 'names-only'
      return 'waiting'
    }
    return EXTRACTABLE.has(row.ext) && store.getRoot(row.root_id)?.extract_text ? 'waiting' : 'names-only'
  }

  function describeText(entryId) {
    const doc = docOf.get(entryId)
    if (!doc) return null
    return {
      state: doc.state,
      error: doc.error,
      pages: doc.pages,
      textPages: doc.text_pages,
      needsOcr: doc.needs_ocr > 0,
      truncated: Boolean(doc.truncated),
      role: doc.role,
      extractedAt: doc.extracted_at,
      ocr: doc.needs_ocr > 0
        ? { state: doc.ocr_state, pages: doc.ocr_pages, done: doc.ocr_done, failed: doc.ocr_failed, confidence: doc.ocr_confidence, error: doc.ocr_error, at: doc.ocr_at }
        : null,
    }
  }

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
    canOpen: row.is_dir ? canOpenFolder(row.name) : canLaunch(row.name) || isShortcut(row.name),
    canPreview: !row.is_dir && previewType(row.name) !== null && row.size <= MAX_PREVIEW_BYTES,
  })

  /** Another place an identical copy of a search result is kept. */
  const describeCopy = (row) => {
    const root = store.getRoot(row.root_id)
    return { entryId: row.id, name: row.name, folder: path.dirname(row.path), libraryId: row.root_id, libraryName: root?.name || path.basename(root?.path ?? '') }
  }

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

  /** Space the index takes on this computer (the database and its write-ahead log). */
  function storage() {
    const file = path.join(dataDir, 'index.sqlite')
    const size = (suffix) => {
      try {
        return fs.statSync(file + suffix).size
      } catch {
        return 0
      }
    }
    return { indexBytes: size('') + size('-wal') }
  }

  /** An indexed entry that may be read now, or an error saying why not. */
  function readable(id) {
    const row = Number.isSafeInteger(id) ? store.getEntry(id) : null
    if (!row) throw new HttpError(404, 'This item is no longer in the index.')
    const root = store.getRoot(row.root_id)
    const problem = access.problem(root, row.path)
    if (problem) throw new HttpError(403, PROBLEM_MESSAGES[problem] ?? PROBLEM_MESSAGES.outside)
    return { row, root }
  }

  /** Finds an indexed entry and confirms it, and its real location on disk, may be used. */
  async function resolveEntry(id) {
    const { row, root } = readable(id)
    const availability = await availabilityOf(row)
    if (availability === 'missing') {
      store.removePath(row.path)
      throw new HttpError(410, 'This item was moved or deleted. The index has been updated.')
    }
    if (availability === 'offline') throw new HttpError(409, 'The drive or folder holding this item is not connected.')
    if (availability === 'denied') throw new HttpError(403, 'The system denied access to this item.')
    // A link inside a library could point anywhere; follow it and check again.
    const checked = await access.checkReal(root, row.path).catch(() => ({ problem: 'outside' }))
    if (checked.problem) throw new HttpError(403, 'This item points outside your libraries.')
    return { row, root, real: checked.real }
  }

  // The target comes from the shortcut file, never from the request. Opening
  // it is the same as double-clicking the shortcut, except that programs are
  // refused, the shortcut's command-line arguments are dropped, and a file or
  // folder must itself lie inside a library (a shortcut cannot widen access).
  async function openShortcut(row) {
    const target = await shortcutTarget(row)
    if (target.url) {
      await launcher.openLink(target.url)
      log(`Opened the link in shortcut #${row.id}`)
      return { ok: true }
    }
    await launcher.open(target.real)
    log(`Opened the ${target.isDirectory ? 'folder' : 'file'} shortcut #${row.id} points to`)
    return { ok: true }
  }

  /** Where a shortcut points, as { url } or { path, real, isDirectory }, after every check opening it would make. */
  async function shortcutTarget(row) {
    const target = await readShortcut(row.path).catch(() => null)
    if (!target) throw new HttpError(422, 'Document Vault could not tell where this shortcut points. Use "Show in folder" instead.')
    if (target.url) return { url: target.url }
    // Network locations are never contacted: opening one can send the Windows sign-in to that computer.
    if (/^(\\\\|\/\/)/.test(target.path)) throw new HttpError(403, 'This shortcut points to a network location. Document Vault only opens items inside your libraries.')
    const library = access.libraryFor(target.path)
    if (!library || access.problem(library, target.path)) {
      throw new HttpError(403, 'This shortcut points outside your libraries. Add that folder as a library to open it from Document Vault, or use "Show in folder".')
    }
    let info
    let checked
    try {
      info = await fs.promises.stat(target.path)
      checked = await access.checkReal(library, target.path)
    } catch {
      throw new HttpError(410, 'This shortcut points to an item that was moved, deleted or is on a drive that is not connected.')
    }
    if (checked.problem) throw new HttpError(403, 'This shortcut points outside your libraries.')
    if (info.isDirectory() ? !canOpenFolder(target.path) || !canOpenFolder(checked.real) : !canLaunch(target.path) || !canLaunch(checked.real)) {
      throw new HttpError(403, 'This shortcut starts a program. Programs are not run from Document Vault; use "Show in folder" instead.')
    }
    return { path: target.path, real: checked.real, isDirectory: info.isDirectory() }
  }

  function libraryOr404(match) {
    const root = store.getRoot(Number(match[1]))
    if (!root) throw new HttpError(404, 'That library does not exist.')
    return root
  }

  /** A library whose index may be shown (not revoked). */
  function readableLibrary(match) {
    const root = libraryOr404(match)
    if (root.state === 'revoked') throw new HttpError(403, PROBLEM_MESSAGES.revoked)
    return root
  }

  /** Stops every scan and text extraction of a library, now. */
  function stopLibrary(root) {
    store.bumpEpoch(root.id)
    indexer.stopRoot(root.id)
    extractor.cancelRoot(root.id)
    ocr.cancelRoot(root.id)
    hasher.cancelRoot(root.id)
  }

  function startLibrary(root) {
    indexer.enqueue(root.id)
    extractor.requeueRoot(root.id)
    ocr.queueRoot(root.id)
    hasher.schedule()
  }

  // ── Folder tree, health and references ────────────────────────────────────

  function folderTree(root, params) {
    const parentId = params.get('parent') ? Number(params.get('parent')) : null
    let parent = root.path
    if (parentId !== null) {
      const { row } = readable(parentId)
      if (row.root_id !== root.id || !row.is_dir) throw new HttpError(400, 'Choose a folder of this library.')
      parent = row.path
    }
    const scope = scopeSql('e', [root.id])
    const { limit, offset } = paging(params, 200)
    const sort = TREE_ORDER[params.get('sort')] ? params.get('sort') : 'name'
    // One more than asked for, to tell whether there are more.
    const list = (isDir) => db.prepare(`select e.* from entries e where e.parent_key = ? and e.is_dir = ${isDir} and ${scope.sql}
        order by ${TREE_ORDER[sort][isDir]} limit ? offset ?`).all(pathKey(parent), ...scope.values, limit + 1, offset)
    const folders = list(1)
    const files = list(0)
    // Read from the index alone (migration 5), not from every row below the folder.
    const inside = db.prepare(`select count(*) as n from entries e indexed by entries_key_dir
        where e.path_key >= ? and e.path_key < ? and e.is_dir = 0 and ${scope.sql}`)
    return {
      parent: parentId,
      sort,
      offset,
      folders: folders.slice(0, limit).map((row) => ({ ...describeEntry(row), files: Number(inside.get(...store.belowRange(row.path_key), ...scope.values).n) })),
      files: files.slice(0, limit).map((row) => describeEntry(row)),
      moreFolders: folders.length > limit,
      moreFiles: files.length > limit,
    }
  }

  const linkItem = (row) => ({
    entryId: row.source_id,
    name: row.source_name,
    folder: path.dirname(row.source_path),
    href: row.href,
    label: row.label,
    status: row.status,
    targetId: row.target_id,
  })

  function linkRows(root, status, { limit, offset }) {
    const scope = scopeSql('s', [root.id])
    return db.prepare(`select l.*, s.name as source_name, s.path as source_path from doc_links l join entries s on s.id = l.source_id
        where l.status = ? and ${scope.sql} order by s.name collate nocase, l.id limit ? offset ?`).all(status, ...scope.values, limit, offset).map(linkItem)
  }

  const HEALTH_SECTIONS = {
    inaccessible: (root, scope, page) => db.prepare(`select e.* from entries e where e.accessible = 0 and ${scope.sql} order by e.path limit ? offset ?`)
      .all(...scope.values, page.limit, page.offset).map((row) => ({ entryId: row.id, name: row.name, folder: path.dirname(row.path), detail: 'The system denied access.' })),
    failed: (root, scope, page) => docRows(scope, "d.state = 'failed'", page),
    waiting: (root, scope, page) => docRows(scope, "d.state in ('waiting_permission', 'waiting_drive', 'cancelled')", page),
    'needs-ocr': (root, scope, page) => docRows(scope, "d.needs_ocr > 0 and d.ocr_state not in ('completed', 'failed')", page, (row) => ocrDetail(root, row)),
    'ocr-failed': (root, scope, page) => docRows(scope, "d.needs_ocr > 0 and (d.ocr_state = 'failed' or d.ocr_failed > 0)", page,
      (row) => row.ocr_error ?? `${row.ocr_failed} of ${row.ocr_pages} scanned pages could not be recognised.`),
    'ocr-low-confidence': (root, scope, page) => docRows(scope, `d.ocr_state = 'completed' and d.ocr_confidence < ${LOW_CONFIDENCE}`, page,
      (row) => `Recognised with ${row.ocr_confidence}% confidence: the scan may be faint or skewed, so searches can miss words.`),
    truncated: (root, scope, page) => docRows(scope, 'd.truncated = 1', page, () => 'Only the first part of this document was read (it is very large).'),
    'names-only': (root, scope, page) => db.prepare(`select e.* from entries e where e.is_dir = 0 and e.ext not in (${EXTRACTABLE_SQL}) and ${scope.sql}
        order by e.name collate nocase limit ? offset ?`).all(...scope.values, page.limit, page.offset)
      .map((row) => ({ entryId: row.id, name: row.name, folder: path.dirname(row.path), detail: 'Found by name only: Document Vault does not read the text of this file type yet.' })),
    skipped: (root, scope, page) => db.prepare('select * from skips where root_id = ? order by reason, path limit ? offset ?').all(root.id, page.limit, page.offset)
      .map((row) => ({ entryId: null, name: path.basename(row.path), folder: path.dirname(row.path), reason: row.reason, detail: SKIP_REASONS[row.reason] ?? row.reason })),
    'broken-links': (root, scope, page) => linkRows(root, 'broken', page),
    'outside-links': (root, scope, page) => linkRows(root, 'outside', page),
    'unindexed-links': (root, scope, page) => linkRows(root, 'unindexed', page),
    // Identical copies inside this library; the Duplicates page compares across libraries.
    duplicates: (root, scope, page) => {
      const groups = db.prepare(`select h.sha256, count(*) as n from file_hashes h join entries e on e.id = h.entry_id
          where ${CURRENT_HASH} and ${scope.sql} group by h.sha256 having n > 1 order by n desc, h.sha256 limit ? offset ?`).all(...scope.values, page.limit, page.offset)
      const members = db.prepare(`select e.* from file_hashes h join entries e on e.id = h.entry_id where h.sha256 = ? and ${CURRENT_HASH} and ${scope.sql} order by e.path`)
      return groups.map((group) => ({
        hash: group.sha256.slice(0, 16),
        copies: members.all(group.sha256, ...scope.values).map((row) => ({ entryId: row.id, name: row.name, folder: path.dirname(row.path), size: row.size })),
      }))
    },
  }

  function ocrDetail(root, row) {
    const scanned = `${row.needs_ocr} of ${row.pages ?? row.needs_ocr} pages have no text layer (scanned).`
    if (row.ocr_state === 'pending' || row.ocr_state === 'processing') return `${scanned} Recognising text: ${row.ocr_done} of ${row.ocr_pages || row.needs_ocr} pages done.`
    if (row.ocr_state === 'changed') return `${scanned} The file changed; its text is recognised again after it is read.`
    if (root.ocr_pref === 'on') return `${scanned} Waiting to recognise its text.`
    return `${scanned} Found by name only until text recognition is turned on for this library.`
  }

  function docRows(scope, condition, page, detail = (row) => row.error) {
    return db.prepare(`select e.*, d.state, d.error, d.pages, d.needs_ocr, d.ocr_state, d.ocr_pages, d.ocr_done, d.ocr_failed,
        d.ocr_confidence, d.ocr_error from docs d join entries e on e.id = d.entry_id
        where ${condition} and ${scope.sql} order by e.name collate nocase limit ? offset ?`).all(...scope.values, page.limit, page.offset)
      .map((row) => ({ entryId: row.id, name: row.name, folder: path.dirname(row.path), state: row.state, detail: detail(row) }))
  }

  function health(root, params) {
    const scope = scopeSql('e', [root.id])
    const section = params.get('section')
    if (section) {
      if (!Object.hasOwn(HEALTH_SECTIONS, section)) throw new HttpError(400, 'Unknown section.')
      return { section, items: HEALTH_SECTIONS[section](root, scope, paging(params)) }
    }
    const one = (sql) => Number(db.prepare(sql).get(...scope.values).n)
    const grouped = (sql, ...values) => Object.fromEntries(db.prepare(sql).all(...values).map((row) => [row.k, Number(row.n)]))
    const text = grouped(`select d.state as k, count(*) as n from docs d join entries e on e.id = d.entry_id where ${scope.sql} group by d.state`, ...scope.values)
    const links = grouped(`select l.status as k, count(*) as n from doc_links l join entries e on e.id = l.source_id where ${scope.sql} group by l.status`, ...scope.values)
    const skipped = grouped('select reason as k, count(*) as n from skips where root_id = ? group by reason', root.id)
    const summary = {
      files: one(`select count(*) as n from entries e where e.is_dir = 0 and ${scope.sql}`),
      folders: one(`select count(*) as n from entries e where e.is_dir = 1 and ${scope.sql}`),
      inaccessible: one(`select count(*) as n from entries e where e.accessible = 0 and ${scope.sql}`),
      namesOnly: one(`select count(*) as n from entries e where e.is_dir = 0 and e.ext not in (${EXTRACTABLE_SQL}) and ${scope.sql}`),
      needsOcr: one(`select count(*) as n from docs d join entries e on e.id = d.entry_id where d.needs_ocr > 0
          and d.ocr_state not in ('completed', 'failed') and ${scope.sql}`),
      ocrFailed: one(`select count(*) as n from docs d join entries e on e.id = d.entry_id where d.needs_ocr > 0
          and (d.ocr_state = 'failed' or d.ocr_failed > 0) and ${scope.sql}`),
      ocrLowConfidence: one(`select count(*) as n from docs d join entries e on e.id = d.entry_id where d.ocr_state = 'completed'
          and d.ocr_confidence < ${LOW_CONFIDENCE} and ${scope.sql}`),
      truncated: one(`select count(*) as n from docs d join entries e on e.id = d.entry_id where d.truncated = 1 and ${scope.sql}`),
      duplicateGroups: one(`select count(*) as n from (select h.sha256 from file_hashes h join entries e on e.id = h.entry_id
          where ${CURRENT_HASH} and ${scope.sql} group by h.sha256 having count(*) > 1)`),
      catalogs: one(`select count(*) as n from docs d join entries e on e.id = d.entry_id where d.role = 'catalog' and ${scope.sql}`),
      skippedByType: root.type_skipped,
      text,
      links,
      skipped,
    }
    return { library: describeRoot(rootView(root.id)), summary }
  }

  // ── Routes ────────────────────────────────────────────────────────────────

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
      text: extractor.status(),
      ocr: ocr.status(),
      roots: store.listRoots().map(describeRoot),
      recovered: store.recovered,
      storage: storage(),
    })],

    // Gives back space left by removed entries and text. Only while nothing is being indexed or read:
    // it rewrites the index file, and nothing else can use the index meanwhile.
    ['POST', /^\/v1\/storage\/compact$/, true, () => {
      if (indexer.running || indexer.flushing || extractor.active.size > 0 || ocr.current || hasher.current) {
        throw new HttpError(409, 'The index is in use. Try again when indexing and text reading have finished.')
      }
      const before = storage().indexBytes
      const started = Date.now()
      db.exec('pragma wal_checkpoint(truncate)')
      db.exec('vacuum')
      db.exec('pragma optimize')
      db.exec('pragma wal_checkpoint(truncate)')
      store.event('index-compacted', null, JSON.stringify({ before, after: storage().indexBytes }))
      return { before, after: storage().indexBytes, ms: Date.now() - started }
    }],

    // What Document Vault may read, for the Library Access page.
    ['GET', /^\/v1\/access$/, true, () => ({
      libraries: store.listRoots().map(describeRoot),
      ai: { enabled: false, provider: null, note: 'No assistant is connected. Library content never leaves this computer.' },
      events: store.recentEvents(100).map((event) => ({ at: event.at, kind: event.kind, libraryId: event.root_id, detail: event.detail })),
      recovered: store.recovered,
    })],

    // ── Libraries ──

    ['POST', /^\/v1\/roots$/, true, async (request) => {
      const body = await readJson(request)
      return addRoot(String(body.path ?? '').trim(), settingsFrom(body))
    }],

    // Shows the system folder picker. With add: false the choice is only
    // described, so the web app can ask for a name and settings first.
    ['POST', /^\/v1\/roots\/pick$/, true, async (request) => {
      const body = await readJson(request, { optional: true })
      const chosen = await launcher.pickFolder()
      if (!chosen) return { cancelled: true }
      if (body.add === false) {
        const problem = rootProblem(chosen, dataDir)
        const existing = store.rootByPath(chosen)
        return { path: chosen, suggestedName: path.basename(chosen) || chosen, problem, existingId: existing?.id ?? null }
      }
      return addRoot(chosen, settingsFrom(body))
    }],

    ['PATCH', /^\/v1\/roots\/(\d+)$/, true, async (request, match) => {
      const root = libraryOr404(match)
      const settings = settingsFrom(await readJson(request))
      store.updateRoot(root.id, settings)
      const after = store.getRoot(root.id)
      const rescan = ['recursive', 'max_depth', 'file_types'].some((key) => after[key] !== root[key])
      if (rescan) {
        // A narrower setting removes what no longer belongs; a wider one finds more.
        store.bumpEpoch(root.id)
        indexer.enqueue(root.id)
      }
      if (after.extract_text !== root.extract_text) {
        if (after.extract_text) extractor.queueRoot(root.id)
        else extractor.cancelRoot(root.id)
      }
      // Turning recognition off stops it; the text already recognised stays searchable.
      if (after.ocr_pref !== root.ocr_pref) {
        if (after.ocr_pref === 'on') ocr.queueRoot(root.id)
        else ocr.cancelRoot(root.id)
      }
      store.event('settings-changed', root.id, Object.keys(settings).join(', '))
      return { root: describeRoot(rootView(root.id)), rescanning: rescan }
    }],

    // The answer to "Recognise the text of the scanned books?", asked once per library.
    ['POST', /^\/v1\/roots\/(\d+)\/ocr$/, true, async (request, match) => {
      const root = readableLibrary(match)
      const { decision } = await readJson(request)
      if (decision !== 'on' && decision !== 'not-now') throw new HttpError(400, 'Choose "on" or "not-now".')
      store.updateRoot(root.id, { ocr_pref: decision === 'on' ? 'on' : 'off' })
      if (decision === 'on') ocr.queueRoot(root.id)
      else ocr.cancelRoot(root.id)
      store.event(decision === 'on' ? 'ocr-on' : 'ocr-declined', root.id)
      return { root: describeRoot(rootView(root.id)) }
    }],

    ['POST', /^\/v1\/roots\/(\d+)\/pause$/, true, (_request, match) => {
      const root = libraryOr404(match)
      if (root.state === 'revoked') throw new HttpError(409, PROBLEM_MESSAGES.revoked)
      store.setState(root.id, 'paused')
      stopLibrary(root)
      store.event('library-paused', root.id)
      return { root: describeRoot(rootView(root.id)) }
    }],

    ['POST', /^\/v1\/roots\/(\d+)\/resume$/, true, (_request, match) => {
      const root = libraryOr404(match)
      if (root.state === 'revoked') throw new HttpError(409, 'Access to this library was revoked. Use "Grant access again" and choose the same folder.')
      store.setState(root.id, 'active')
      startLibrary(root)
      store.event('library-resumed', root.id)
      return { root: describeRoot(rootView(root.id)) }
    }],

    // Revoking stops all work at once and hides the library from every search,
    // list and future assistant. The index is kept (so access can be granted
    // again quickly) until it is cleared or the library is removed.
    ['POST', /^\/v1\/roots\/(\d+)\/revoke$/, true, (_request, match) => {
      const root = libraryOr404(match)
      store.setState(root.id, 'revoked')
      stopLibrary(root)
      store.event('library-revoked', root.id)
      log(`Revoked access to library #${root.id}`)
      return { root: describeRoot(rootView(root.id)) }
    }],

    // Grants access again, or repairs it after the system withdrew it. The user
    // must choose the same folder in the system picker; any other is refused.
    ['POST', /^\/v1\/roots\/(\d+)\/reauthorize$/, true, async (_request, match) => {
      const root = libraryOr404(match)
      const chosen = await launcher.pickFolder({ defaultPath: root.path })
      if (!chosen) return { cancelled: true }
      let real
      try {
        real = fs.realpathSync.native(path.resolve(chosen))
        await (await fs.promises.opendir(real)).close()
      } catch (error) {
        throw new HttpError(400, friendlyError(error))
      }
      if (pathKey(real) !== pathKey(root.path)) {
        throw new HttpError(409, `Choose the library's own folder (${root.path}). To add a different folder, add it as a new library.`)
      }
      store.setState(root.id, 'active')
      store.setRootStatus(root.id, 'pending')
      store.bumpEpoch(root.id)
      startLibrary(store.getRoot(root.id))
      store.event('library-reauthorized', root.id)
      return { root: describeRoot(rootView(root.id)) }
    }],

    // Deletes what was indexed (names, text, metadata, links). Files are untouched.
    ['POST', /^\/v1\/roots\/(\d+)\/purge$/, true, async (_request, match) => {
      const root = libraryOr404(match)
      stopLibrary(root)
      await indexer.settled(root.id)
      store.purgeRoot(root.id)
      // Paused, so it is not indexed again straight away; revoked stays revoked.
      if (root.state === 'active') store.setState(root.id, 'paused')
      store.setRootStatus(root.id, 'pending')
      store.event('library-purged', root.id)
      return { root: describeRoot(rootView(root.id)) }
    }],

    ['POST', /^\/v1\/roots\/(\d+)\/rescan$/, true, (_request, match) => {
      const root = readableLibrary(match)
      if (root.state !== 'active') throw new HttpError(409, PROBLEM_MESSAGES.paused)
      startLibrary(root)
      return { queued: true }
    }],

    ['DELETE', /^\/v1\/roots\/(\d+)$/, true, async (_request, match) => {
      const root = libraryOr404(match)
      stopLibrary(root)
      await indexer.settled(root.id)
      indexer.removeRoot(root.id)
      store.event('library-removed', null, root.name || root.path)
      log(`Removed library #${root.id}`)
      return { ok: true }
    }],

    ['POST', /^\/v1\/roots\/(\d+)\/exclusions$/, true, async (request, match) => {
      const root = libraryOr404(match)
      const body = await readJson(request)
      let folder
      if (body.entryId !== undefined) {
        const row = store.getEntry(Number(body.entryId))
        if (!row || row.root_id !== root.id || !row.is_dir) throw new HttpError(400, 'Choose a folder of this library.')
        folder = row.path
      } else {
        folder = String(body.path ?? '').trim()
        if (!path.isAbsolute(folder)) throw new HttpError(400, 'Choose a folder of this library.')
        folder = path.resolve(folder)
        // The library is stored by its real path, so a drive letter, alias or
        // link to the same folder is compared as that real path too.
        try {
          folder = fs.realpathSync.native(folder)
        } catch {
          // A folder that no longer exists is compared as given.
        }
      }
      if (!isInside(folder, root.path) || pathKey(folder) === pathKey(root.path)) {
        throw new HttpError(400, 'Only a folder inside this library can be excluded. To stop indexing the whole library, pause or revoke it.')
      }
      store.bumpEpoch(root.id)
      store.addExclusion(root.id, folder)
      // Work in progress elsewhere in the library is picked up again under the new rules.
      extractor.requeueRoot(root.id)
      ocr.queueRoot(root.id)
      if (root.state === 'active') indexer.enqueue(root.id)
      store.event('exclusion-added', root.id, folder)
      return { root: describeRoot(rootView(root.id)) }
    }],

    ['DELETE', /^\/v1\/roots\/(\d+)\/exclusions\/(\d+)$/, true, (_request, match) => {
      const root = libraryOr404(match)
      const exclusion = store.getExclusion(Number(match[2]))
      if (!exclusion || exclusion.root_id !== root.id) throw new HttpError(404, 'That exclusion does not exist.')
      store.bumpEpoch(root.id)
      store.removeExclusion(exclusion)
      if (root.state === 'active') indexer.enqueue(root.id, exclusion.path)
      store.event('exclusion-removed', root.id, exclusion.path)
      return { root: describeRoot(rootView(root.id)) }
    }],

    ['GET', /^\/v1\/roots\/(\d+)\/tree$/, true, (request, match) => {
      const root = readableLibrary(match)
      return folderTree(root, new URL(request.url, 'http://127.0.0.1').searchParams)
    }],

    ['GET', /^\/v1\/roots\/(\d+)\/health$/, true, (request, match) => {
      const root = readableLibrary(match)
      return health(root, new URL(request.url, 'http://127.0.0.1').searchParams)
    }],

    ['GET', /^\/v1\/roots\/(\d+)\/references$/, true, (request, match) => {
      const root = readableLibrary(match)
      const params = new URL(request.url, 'http://127.0.0.1').searchParams
      const status = params.get('status') ?? 'verified'
      if (!LINK_STATUSES.includes(status)) throw new HttpError(400, 'Unknown link status.')
      return { status, items: linkRows(root, status, paging(params)) }
    }],

    // Older clients rescan through these.
    ['POST', /^\/v1\/index\/rescan$/, true, async (request) => {
      const body = await readJson(request)
      const roots = body.rootId ? [store.getRoot(Number(body.rootId))].filter(Boolean) : store.listRootRows()
      const active = roots.filter((root) => root.state === 'active')
      for (const root of active) startLibrary(root)
      return { queued: active.map((root) => root.id) }
    }],
    ['POST', /^\/v1\/index\/pause$/, true, () => (indexer.pause(), extractor.pause(), ocr.pause(), hasher.pause(), indexer.status())],
    ['POST', /^\/v1\/index\/resume$/, true, () => (indexer.resume(), extractor.resume(), ocr.resume(), hasher.resume(), indexer.status())],

    // ── Duplicates ── (listed only; files are never changed)

    ['GET', /^\/v1\/duplicates$/, true, (request) => {
      const params = new URL(request.url, 'http://127.0.0.1').searchParams
      const kind = params.get('kind') ?? 'exact'
      if (!DUPLICATE_KINDS.includes(kind)) throw new HttpError(400, 'Choose "exact" or "text".')
      let rootId = null
      if (params.get('library')) rootId = readableLibrary([null, params.get('library')]).id
      const groups = listDuplicates(db, { kind, rootId, dismissed: params.get('dismissed') === '1', ...paging(params, 50) })
      return { kind, groups }
    }],

    ['GET', /^\/v1\/duplicates\/summary$/, true, () => ({ ...duplicateSummary(db), checking: hasher.status() })],

    ['POST', /^\/v1\/duplicates\/dismiss$/, true, async (request) => {
      const body = await readJson(request)
      const kind = String(body.kind ?? '')
      const key = String(body.key ?? '')
      if (!DUPLICATE_KINDS.includes(kind) || !/^[0-9a-f]{64}$/.test(key)) throw new HttpError(400, 'Choose a group of duplicates.')
      if (!dismissDuplicate(db, { kind, key, dismissed: body.dismissed !== false })) throw new HttpError(404, 'That group of duplicates no longer exists.')
      return { ok: true }
    }],

    // ── Search ──

    ['GET', /^\/v1\/search$/, true, async (request) => {
      const url = new URL(request.url, 'http://127.0.0.1')
      const query = parseSearch(url.searchParams)
      const started = performance.now()
      const result = searchRanked(db, query)
      const items = await Promise.all(result.items.map(async (item) => {
        const hit = item.row ? item : { row: item }
        return {
          ...describeEntry(hit.row, await availabilityOf(hit.row)),
          textCoverage: textCoverage(hit.row),
          match: hit.match ?? null,
          excerpt: hit.excerpt ?? null,
          matchingSections: hit.matchingSections ?? 0,
          meta: hit.meta ?? null,
          referencedBy: hit.referencedBy ?? null,
          copies: (hit.copies ?? []).map(describeCopy),
        }
      }))
      return { ...result, items, tookMs: Math.round(performance.now() - started), query: { ...query } }
    }],

    // ── Entries ──

    ['GET', /^\/v1\/entries\/(\d+)$/, true, async (_request, match) => {
      const { row } = readable(Number(match[1]))
      return { ...describeEntry(row, await availabilityOf(row)), text: describeText(row.id), meta: metaOf(db, row.id) }
    }],

    // Where a shortcut points, so the app can show the item itself instead of
    // handing it to another program: { url } for a web link, or { entry } for an
    // indexed file or folder (null when it is allowed but not indexed yet).
    ['GET', /^\/v1\/entries\/(\d+)\/target$/, true, async (_request, match) => {
      const { row } = await resolveEntry(Number(match[1]))
      if (row.is_dir || !isShortcut(row.name)) throw new HttpError(400, 'This item is not a shortcut.')
      const target = await shortcutTarget(row)
      if (target.url) return { url: target.url, entry: null }
      const indexed = store.entryByPath(target.path) ?? store.entryByPath(target.real)
      return { url: null, entry: indexed ? describeEntry(indexed) : null }
    }],

    // Every passage of a document matching the words, in reading order, with page numbers.
    ['GET', /^\/v1\/entries\/(\d+)\/matches$/, true, (request, match) => {
      const { row } = readable(Number(match[1]))
      const q = String(new URL(request.url, 'http://127.0.0.1').searchParams.get('q') ?? '').slice(0, 200)
      return { entryId: row.id, matches: matchesIn(db, row.id, q) }
    }],

    // Web pages in the libraries that link to this document.
    ['GET', /^\/v1\/entries\/(\d+)\/references$/, true, (_request, match) => {
      const { row } = readable(Number(match[1]))
      const scope = scopeSql('s')
      const items = db.prepare(`select l.*, s.name as source_name, s.path as source_path from doc_links l join entries s on s.id = l.source_id
          where l.target_id = ? and l.status = 'verified' and ${scope.sql} order by s.name collate nocase limit 200`).all(row.id, ...scope.values).map(linkItem)
      return { entryId: row.id, items }
    }],

    // The links in a web page, each with what was found at its target.
    ['GET', /^\/v1\/entries\/(\d+)\/links$/, true, (request, match) => {
      const { row } = readable(Number(match[1]))
      const params = new URL(request.url, 'http://127.0.0.1').searchParams
      const { limit, offset } = paging(params, 200)
      const scope = scopeSql('t')
      const rows = db.prepare(`select l.*, t.name as target_name, t.kind as target_kind from doc_links l
          left join entries t on t.id = l.target_id and ${scope.sql}
          where l.source_id = ? order by l.id limit ? offset ?`).all(...scope.values, row.id, limit, offset)
      return {
        entryId: row.id,
        role: docOf.get(row.id)?.role ?? null,
        items: rows.map((link) => ({
          href: link.href,
          label: link.label,
          // A target that may no longer be read is reported as outside the libraries.
          status: link.status === 'verified' && !link.target_name ? 'outside' : link.status,
          targetId: link.target_name ? link.target_id : null,
          targetName: link.target_name ?? null,
          targetKind: link.target_kind ?? null,
        })),
      }
    }],

    // Corrects a document's title, author and similar details. Corrections are
    // kept separately and win over what the file says; null removes one.
    ['PATCH', /^\/v1\/entries\/(\d+)\/metadata$/, true, async (request, match) => {
      const { row } = readable(Number(match[1]))
      const body = await readJson(request)
      store.transaction(() => {
        for (const field of META_FIELDS) {
          if (body[field] === undefined) continue
          const value = body[field] === null ? '' : String(body[field]).trim().slice(0, 500)
          if (value) db.prepare("insert or replace into doc_meta (entry_id, field, value, source) values (?, ?, ?, 'user')").run(row.id, field, value)
          else db.prepare("delete from doc_meta where entry_id = ? and field = ? and source = 'user'").run(row.id, field)
        }
        refreshMeta(db, row.id)
      })
      return { meta: metaOf(db, row.id) }
    }],

    // Reads this document's text next.
    ['POST', /^\/v1\/entries\/(\d+)\/extract$/, true, (_request, match) => {
      const { row, root } = readable(Number(match[1]))
      if (row.is_dir || !EXTRACTABLE.has(row.ext)) throw new HttpError(415, 'Document Vault does not read the text of this file type yet.')
      if (!root.extract_text) throw new HttpError(409, 'Reading text is turned off for this library.')
      db.prepare("insert or ignore into docs (entry_id, root_id, state) values (?, ?, 'pending')").run(row.id, row.root_id)
      extractor.prioritize(row.id)
      return { text: describeText(row.id) }
    }],

    ['POST', /^\/v1\/entries\/(\d+)\/open$/, true, async (_request, match) => {
      const { row, real } = await resolveEntry(Number(match[1]))
      if (!row.is_dir && isShortcut(row.name)) return openShortcut(row)
      if (row.is_dir ? !canOpenFolder(row.name) || !canOpenFolder(real) : !canLaunch(row.name) || !canLaunch(real)) {
        throw new HttpError(403, 'Programs, scripts and shortcuts are not opened from Document Vault. Use "Show in folder" instead.')
      }
      await launcher.open(real)
      if (!row.is_dir) {
        extractor.prioritize(row.id)
        ocr.prioritize(row.id)
      }
      log(`Opened ${row.is_dir ? 'folder' : 'file'} #${row.id}`)
      return { ok: true }
    }],

    ['POST', /^\/v1\/entries\/(\d+)\/reveal$/, true, async (_request, match) => {
      const { real } = await resolveEntry(Number(match[1]))
      await launcher.reveal(real)
      return { ok: true }
    }],

    ['GET', /^\/v1\/entries\/(\d+)\/content$/, true, async (_request, match, _token, response) => {
      const { row, real } = await resolveEntry(Number(match[1]))
      const type = row.is_dir ? null : previewType(row.name)
      if (!type) throw new HttpError(415, 'This file type cannot be previewed. Open it on your computer instead.')
      const info = await fs.promises.stat(real)
      if (info.size > MAX_PREVIEW_BYTES) throw new HttpError(413, 'This file is too large to preview. Open it on your computer instead.')
      extractor.prioritize(row.id)
      response.writeHead(200, {
        'Content-Type': type,
        'Content-Length': info.size,
        'Cache-Control': 'no-store',
        'Content-Disposition': 'attachment',
        'X-Content-Type-Options': 'nosniff',
      })
      await new Promise((resolve, reject) => {
        fs.createReadStream(real).on('error', reject).on('end', resolve).pipe(response)
      })
      return undefined
    }],
  ]

  /** Library settings from a request body, in the store's column names. */
  function settingsFrom(body) {
    const settings = {}
    if (body.name !== undefined) settings.name = body.name
    if (body.recursive !== undefined) settings.recursive = Boolean(body.recursive)
    if (body.maxDepth !== undefined) settings.max_depth = body.maxDepth
    if (body.fileTypes !== undefined) {
      if (body.fileTypes !== null && (!Array.isArray(body.fileTypes) || body.fileTypes.some((kind) => !KINDS.includes(kind)))) {
        throw new HttpError(400, 'Unknown file type.')
      }
      settings.file_types = body.fileTypes
    }
    if (body.extractText !== undefined) settings.extract_text = Boolean(body.extractText)
    if (body.ocr !== undefined) settings.ocr_pref = body.ocr ? 'on' : 'off'
    return settings
  }

  function addRoot(target, settings = {}) {
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
    if (existing) {
      // Adding a revoked library's folder again is a new grant of access.
      if (existing.state === 'revoked') {
        store.setState(existing.id, 'active')
        store.bumpEpoch(existing.id)
        store.updateRoot(existing.id, settings)
        startLibrary(store.getRoot(existing.id))
        store.event('library-reauthorized', existing.id)
      }
      return { root: describeRoot(rootView(existing.id)), alreadyIndexed: true }
    }
    const covering = store.listRootRows().find((root) => isInside(resolved, root.path))
    if (covering) throw new HttpError(409, `This folder is already part of the library "${covering.name || covering.path}". Exclude or include folders in that library instead.`)
    const root = store.addRoot(resolved, settings)
    // Libraries inside the new one are now covered by it; merge them.
    const merged = []
    for (const other of store.listRootRows()) {
      if (other.id !== root.id && isInside(other.path, resolved)) {
        stopLibrary(other)
        indexer.removeRoot(other.id)
        merged.push(other.name || other.path)
      }
    }
    indexer.enqueue(root.id)
    store.event('library-added', root.id, resolved)
    log(`Added library ${resolved}`)
    return { root: describeRoot(rootView(root.id)), merged }
  }

  function corsHeaders(origin) {
    if (!origin || !config.allowedOrigins.includes(origin)) return {}
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
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

const SKIP_REASONS = {
  link: 'A symbolic link or junction. Links are not followed, so they cannot lead outside the library.',
  'system-folder': 'A system or dependency folder (such as a recycle bin or .git).',
  'too-deep': 'Deeper than the folder depth set for this library.',
  protected: 'A protected system or application location.',
}
