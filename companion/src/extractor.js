import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { EXTRACTABLE, OCR_FORMATS } from './extract/formats.js'
import { friendlyError } from './indexer.js'
import { extensionOf } from './kinds.js'
import { pathKey } from './paths.js'

// Reads the text inside documents so it can be searched, in the background.
//
// - The queue lives in the index (table docs), so it survives restarts. A
//   document is queued when it is first indexed and again when its size or
//   modification time changes; unchanged files are never read twice, and a
//   file whose bytes match an already-read file (same SHA-256) reuses that text.
// - Before reading, each file is checked with the access rules, including its
//   real location on disk, and opened once; the opened file must be the one
//   that was checked. Only its bytes go to a worker thread, which parses them
//   with limits on memory and time. A file that hangs or crashes its worker
//   is recorded as failed and never stops the queue.
// - The library's epoch is recorded before reading and checked again before
//   saving: if access changed meanwhile (revoked, excluded, removed), the
//   result is discarded and nothing from the file is kept.
// - Links in web pages are classified against the libraries without touching
//   anything outside them (see resolveLinks).

const DEFAULTS = {
  concurrency: 1,
  maxBytes: 200 * 1024 * 1024,
  timeoutMs: 120_000,
  maxPages: 5000,
  maxAttempts: 2,
  recycleAfter: 200,
  memoryMb: 1024,
}
const DOCUMENT_LINK = new Set(['pdf', 'doc', 'docx', 'rtf', 'odt', 'epub', 'mobi', 'djvu', 'txt', 'ppt', 'pptx', 'xls', 'xlsx', 'htm', 'html'])
const WORKER_FILE = fileURLToPath(new URL('./extract/worker.js', import.meta.url))

export class Extractor extends EventEmitter {
  constructor(store, access, options = {}) {
    super()
    this.store = store
    this.access = access
    this.options = { ...DEFAULTS, ...options }
    this.pool = new WorkerPool(this.options)
    this.active = new Map()
    this.paused = false
    this.closed = false
    this.queueTimer = null
    this.pendingRoots = new Set()
    const db = store.db
    const extensions = [...EXTRACTABLE].map((extension) => `'${extension}'`).join(', ')
    this.sql = {
      queueNew: db.prepare(`insert into docs (entry_id, root_id, state)
        select e.id, e.root_id, 'pending' from entries e join roots r on r.id = e.root_id
        where e.root_id = ? and e.is_dir = 0 and e.accessible = 1 and r.extract_text = 1 and e.ext in (${extensions})
          and not exists (select 1 from docs d where d.entry_id = e.id)`),
      queueChanged: db.prepare(`update docs set state = 'pending', attempts = 0, error = null
        where root_id = ? and state in ('completed', 'failed', 'skipped')
          and exists (select 1 from entries e where e.id = docs.entry_id and (e.size is not docs.size or e.mtime is not docs.mtime))`),
      requeue: db.prepare(`update docs set state = 'pending', error = null
        where root_id = ? and state in ('cancelled', 'waiting_permission', 'waiting_drive')`),
      interrupted: db.prepare(`update docs set state = 'pending', attempts = attempts + 1, error = 'interrupted' where state = 'processing'`),
      next: db.prepare(`select d.* from docs d join roots r on r.id = d.root_id
        where d.state = 'pending' and r.state = 'active' and r.extract_text = 1 and r.status not in ('unavailable', 'denied')
        order by d.priority desc, d.entry_id limit ?`),
      setState: db.prepare('update docs set state = ?, error = ?, attempts = attempts + ? where entry_id = ?'),
      cancelRoot: db.prepare(`update docs set state = 'cancelled' where root_id = ? and state in ('pending', 'processing')`),
      get: db.prepare('select * from docs where entry_id = ?'),
      prioritize: db.prepare(`update docs set priority = 20, state = case when state in ('failed', 'cancelled', 'skipped') then 'pending' else state end,
        attempts = case when state = 'failed' then 0 else attempts end where entry_id = ?`),
      sameContent: db.prepare(`select d.entry_id from docs d join entries e on e.id = d.entry_id
        where d.sha256 = ? and d.state = 'completed' and d.entry_id <> ? and e.ext = ? limit 1`),
      // A file whose text recognition waited because it changed may go ahead again.
      touch: db.prepare(`update docs set state = ?, size = ?, mtime = ?, error = null,
        ocr_state = case when ocr_state = 'changed' then 'none' else ocr_state end where entry_id = ?`),
      deletePages: db.prepare('delete from doc_pages where entry_id = ?'),
      // Re-reading the same bytes keeps the text recognised from its scanned pages.
      deleteTextPages: db.prepare("delete from doc_pages where entry_id = ? and source = 'text'"),
      insertPage: db.prepare('insert into doc_pages (entry_id, seq, page, label, text) values (?, ?, ?, ?, ?)'),
      copyPages: db.prepare(`insert into doc_pages (entry_id, seq, page, label, text, source, confidence)
        select ?, seq, page, label, text, source, confidence from doc_pages where entry_id = ? order by seq`),
      resetOcr: db.prepare(`update docs set ocr_state = 'none', ocr_pages = 0, ocr_done = 0, ocr_failed = 0, ocr_confidence = null,
        ocr_error = null, ocr_at = null where entry_id = ?`),
      copyOcr: db.prepare(`update docs set (ocr_state, ocr_pages, ocr_done, ocr_failed, ocr_confidence, ocr_error, ocr_at) =
        (select case when ocr_state in ('completed', 'failed') then ocr_state else 'none' end, ocr_pages, ocr_done, ocr_failed,
          ocr_confidence, ocr_error, ocr_at from docs where entry_id = ?) where entry_id = ?`),
      deleteMeta: db.prepare("delete from doc_meta where entry_id = ? and source in ('original', 'extracted')"),
      insertMeta: db.prepare('insert or replace into doc_meta (entry_id, field, value, source) values (?, ?, ?, ?)'),
      copyMeta: db.prepare("insert or replace into doc_meta (entry_id, field, value, source) select ?, field, value, source from doc_meta where entry_id = ? and source in ('original', 'extracted')"),
      deleteLinks: db.prepare('delete from doc_links where source_id = ?'),
      insertLink: db.prepare('insert into doc_links (source_id, root_id, href, label, target_key, target_id, status) values (?, ?, ?, ?, ?, ?, ?)'),
      finish: db.prepare(`update docs set state = 'completed', error = null, size = ?, mtime = ?, sha256 = ?, pages = ?, text_pages = ?,
        needs_ocr = ?, truncated = ?, role = ?, extracted_at = ?, ms = ? where entry_id = ?`),
      copyDoc: db.prepare(`update docs set state = 'completed', error = null, size = ?, mtime = ?, sha256 = ?, extracted_at = ?, ms = ?,
        pages = (select pages from docs where entry_id = ?), text_pages = (select text_pages from docs where entry_id = ?),
        needs_ocr = (select needs_ocr from docs where entry_id = ?), truncated = (select truncated from docs where entry_id = ?)
        where entry_id = ?`),
      counts: db.prepare(`select d.state, count(*) as n from docs d join roots r on r.id = d.root_id where r.state <> 'revoked' group by d.state`),
    }
  }

  start() {
    this.sql.interrupted.run()
    for (const root of this.store.listRootRows()) if (root.state === 'active') this.queueRoot(root.id)
  }

  /** Queues new and changed documents of a library. Called after the indexer writes entries. */
  queueRoot(rootId) {
    this.pendingRoots.add(rootId)
    clearTimeout(this.queueTimer)
    this.queueTimer = setTimeout(() => {
      for (const id of this.pendingRoots) {
        this.sql.queueNew.run(id)
        this.sql.queueChanged.run(id)
      }
      this.pendingRoots.clear()
      void this.drain()
    }, 250)
  }

  /** Puts work stopped by a revoke, a pause or a missing drive back in the queue. */
  requeueRoot(rootId) {
    this.sql.requeue.run(rootId)
    this.queueRoot(rootId)
  }

  /** Stops all work on a library now: queued documents are cancelled and a document being read is abandoned. */
  cancelRoot(rootId) {
    this.sql.cancelRoot.run(rootId)
    for (const job of this.active.values()) if (job.rootId === rootId) this.pool.cancel(job.ticket)
    this.emit('change')
  }

  /** Reads this document next (it was opened or searched for). */
  prioritize(entryId) {
    this.sql.prioritize.run(entryId)
    void this.drain()
  }

  pause() {
    this.paused = true
    this.emit('change')
  }

  resume() {
    this.paused = false
    void this.drain()
    this.emit('change')
  }

  status() {
    const counts = Object.fromEntries(this.sql.counts.all().map((row) => [row.state, Number(row.n)]))
    return {
      state: this.paused ? 'paused' : this.active.size > 0 ? 'reading' : 'idle',
      counts,
      current: [...this.active.values()].map((job) => ({ entryId: job.entryId, name: job.name })),
    }
  }

  async close() {
    this.closed = true
    clearTimeout(this.queueTimer)
    await this.pool.close()
    await Promise.allSettled([...this.active.values()].map((job) => job.promise))
  }

  /** Resolves when the queue is empty. Used by tests and the benchmark. */
  async idle(timeout = 60_000) {
    const started = Date.now()
    for (;;) {
      const pending = this.sql.next.all(1).length > 0 || this.pendingRoots.size > 0
      if (!pending && this.active.size === 0) return
      if (Date.now() - started > timeout) throw new Error('Extraction did not finish in time')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  async drain() {
    if (this.paused || this.closed) return
    while (this.active.size < this.options.concurrency) {
      const [doc] = this.sql.next.all(1)
      if (!doc) return
      this.sql.setState.run('processing', null, 0, doc.entry_id)
      const job = { entryId: doc.entry_id, rootId: doc.root_id, name: null, ticket: Symbol('job') }
      job.promise = this.process(doc, job)
        .catch((error) => this.sql.setState.run('failed', friendlyError(error), 1, doc.entry_id))
        .finally(() => {
          this.active.delete(doc.entry_id)
          this.emit('change')
          void this.drain()
        })
      this.active.set(doc.entry_id, job)
      this.emit('change')
    }
  }

  async process(doc, job) {
    const entry = this.store.getEntry(doc.entry_id)
    if (!entry) return
    job.name = entry.name
    const root = this.store.getRoot(entry.root_id)
    const epoch = root?.epoch
    const stop = (state, error = null, attempt = 0) => this.sql.setState.run(state, error, attempt, entry.id)
    if (!root || this.access.problem(root, entry.path, 'index')) return stop('cancelled')

    let checked
    try {
      const link = await fs.promises.lstat(entry.path)
      if (link.isSymbolicLink()) return stop('skipped', 'link')
      if (link.size > this.options.maxBytes) return stop('skipped', 'too-large')
      checked = await this.access.checkReal(root, entry.path, 'index')
    } catch (error) {
      return this.unreadable(entry, root, error)
    }
    if (checked.problem) return stop('cancelled')

    // Open once, then confirm the opened file is the one checked (not swapped meanwhile).
    let bytes
    let info
    const handle = await fs.promises.open(checked.real, 'r').catch((error) => error)
    if (handle instanceof Error) return this.unreadable(entry, root, handle)
    try {
      info = await handle.stat()
      const now = await fs.promises.stat(checked.real)
      const again = await this.access.checkReal(root, entry.path, 'index')
      if (again.problem || now.ino !== info.ino || now.dev !== info.dev) return stop('cancelled')
      if (info.size > this.options.maxBytes) return stop('skipped', 'too-large')
      bytes = await handle.readFile()
    } finally {
      await handle.close()
    }

    const started = Date.now()
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const mtime = Math.round(info.mtimeMs)
    const extension = extensionOf(entry.name)
    const valid = () => this.access.stillValid(root.id, epoch, entry.path) && this.store.getEntry(entry.id)?.path === entry.path
    // Discarded because access changed: read again later if this document may still be read, otherwise drop it.
    const stale = () => {
      const current = this.store.getRoot(root.id)
      return stop(current && !this.access.problem(current, entry.path, 'index') && this.store.getEntry(entry.id)?.path === entry.path ? 'pending' : 'cancelled')
    }

    // Same bytes as last time (only the date changed): keep what was read.
    if (doc.sha256 === sha256 && doc.extracted_at) {
      if (valid()) this.sql.touch.run('completed', info.size, mtime, entry.id)
      return
    }
    // Same bytes as another document already read (a copy, or a moved file): reuse its text.
    const twin = extension === 'html' || extension === 'htm' || extension === 'xhtml' ? null : this.sql.sameContent.get(sha256, entry.id, extension)
    if (twin) {
      if (!valid()) return stale()
      this.store.transaction(() => {
        this.sql.deletePages.run(entry.id)
        this.sql.copyPages.run(entry.id, twin.entry_id)
        this.sql.copyOcr.run(twin.entry_id, entry.id)
        this.sql.deleteMeta.run(entry.id)
        this.sql.copyMeta.run(entry.id, twin.entry_id)
        const t = twin.entry_id
        this.sql.copyDoc.run(info.size, mtime, sha256, Date.now(), Date.now() - started, t, t, t, t, entry.id)
        refreshMeta(this.store.db, entry.id)
      })
      return
    }

    let result
    try {
      result = await this.pool.run(job.ticket, extension, bytes, { maxPages: this.options.maxPages }, this.options.timeoutMs)
    } catch (error) {
      if (error.code === 'CANCELLED') return stop('cancelled')
      const attempts = doc.attempts + 1
      const retry = error.code === 'CRASHED' && attempts < this.options.maxAttempts
      return stop(retry ? 'pending' : 'failed', describeFailure(error), 1)
    }

    // Access may have changed while the worker was reading: check again before keeping anything.
    if (!valid()) return stale()
    const links = result.links.length > 0 ? this.resolveLinks(entry, result.links) : []
    const local = links.filter((link) => link.status !== 'external')
    const documentLinks = local.filter((link) => DOCUMENT_LINK.has(extensionOf(link.target ?? '')))
    const role = local.length >= 5 && documentLinks.length >= local.length / 2 ? 'catalog' : extension.startsWith('htm') || extension === 'xhtml' ? 'page' : null
    const pages = result.pages ?? null
    const missingText = pages !== null && result.textPages !== null ? pages - result.textPages : 0
    const sameBytes = doc.sha256 === sha256
    this.store.transaction(() => {
      if (sameBytes) {
        this.sql.deleteTextPages.run(entry.id)
      } else {
        this.sql.deletePages.run(entry.id)
        this.sql.resetOcr.run(entry.id)
      }
      let seq = 0
      for (const section of result.sections) {
        if (!section.text) continue
        this.sql.insertPage.run(entry.id, seq++, section.page ?? null, section.label ?? null, section.text)
      }
      this.sql.deleteMeta.run(entry.id)
      for (const item of result.meta) this.sql.insertMeta.run(entry.id, item.field, item.value, item.source)
      refreshMeta(this.store.db, entry.id)
      this.sql.deleteLinks.run(entry.id)
      for (const link of links) this.sql.insertLink.run(entry.id, root.id, link.href, link.label || null, link.targetKey, link.targetId, link.status)
      this.sql.finish.run(info.size, mtime, sha256, pages, result.textPages ?? null, OCR_FORMATS.has(extension) ? missingText : 0, result.truncated ? 1 : 0, role, Date.now(), Date.now() - started, entry.id)
    })
  }

  unreadable(entry, root, error) {
    const set = (state, message) => this.sql.setState.run(state, message, 0, entry.id)
    if (error?.code === 'EACCES' || error?.code === 'EPERM') return set('waiting_permission', friendlyError(error))
    if (error?.code === 'ENOENT') {
      // The whole library is gone (an unplugged drive), or just this file.
      return fs.existsSync(root.path) ? set('failed', 'The file was moved or deleted.') : set('waiting_drive', friendlyError(error))
    }
    if (error?.code === 'EBUSY') return set('failed', friendlyError(error))
    throw error
  }

  /**
   * Classifies the links of a web page:
   *   verified  - points to a document indexed in a library that may be read
   *   unindexed - points to an existing item inside a library that is not indexed (a filtered type, too deep)
   *   broken    - points inside a library, but nothing is there
   *   outside   - points outside every library, or into an excluded folder; never touched
   *   external  - a web address; never fetched
   * Other schemes (mailto:, javascript:, data:) are dropped.
   */
  resolveLinks(source, links) {
    const seen = new Set()
    const result = []
    for (const { href, label } of links) {
      if (!href || href.startsWith('#')) continue
      let scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase() ?? null
      if (scheme && scheme.length === 1) scheme = null // A drive letter (C:\...), not a scheme.
      let target = null
      if (scheme === 'http' || scheme === 'https') {
        if (seen.has(href)) continue
        seen.add(href)
        result.push({ href, label, target: null, targetKey: null, targetId: null, status: 'external' })
        continue
      }
      if (scheme === 'file') {
        try {
          target = fileURLToPath(href.split('#')[0])
        } catch {
          continue
        }
      } else if (scheme) {
        continue
      } else {
        const relative = safeDecode(href.split(/[?#]/)[0])
        if (!relative) continue
        target = path.resolve(path.dirname(source.path), relative.replace(/[\\/]+/g, path.sep))
      }
      const targetKey = pathKey(target)
      if (seen.has(targetKey)) continue
      seen.add(targetKey)
      const library = this.access.libraryFor(target)
      const base = { href: href.slice(0, 1000), label, target, targetKey, targetId: null }
      if (!library || this.access.problem(library, target)) {
        result.push({ ...base, status: 'outside' })
        continue
      }
      const hit = this.store.entryByPath(target)
      if (hit) result.push({ ...base, targetId: hit.id, status: 'verified' })
      else result.push({ ...base, status: fs.existsSync(target) ? 'unindexed' : 'broken' })
    }
    return result
  }
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Rewrites the searchable metadata of one document: a user correction wins over the file's own, which wins over extracted. */
export function refreshMeta(db, entryId) {
  const rows = db.prepare('select field, value, source from doc_meta where entry_id = ?').all(entryId)
  const rank = { user: 0, original: 1, extracted: 2 }
  const best = {}
  for (const row of rows) {
    if (!best[row.field] || rank[row.source] < rank[best[row.field].source]) best[row.field] = row
  }
  db.prepare('delete from meta_fts where rowid = ?').run(entryId)
  const value = (field) => best[field]?.value ?? ''
  if (Object.keys(best).length > 0) {
    db.prepare('insert into meta_fts (rowid, title, author, subject, keywords, publisher) values (?, ?, ?, ?, ?, ?)').run(
      entryId, value('title'), value('author'), value('subject'), value('keywords'), value('publisher'),
    )
  }
}

function describeFailure(error) {
  switch (error.code) {
    case 'TIMEOUT':
      return 'Reading this document took too long and was stopped.'
    case 'CRASHED':
      return 'This document could not be read (it may be damaged or too complex).'
    case 'InvalidPDFException':
      return 'This PDF is damaged or not a valid PDF.'
    case 'PasswordException':
      return 'This document is protected with a password.'
    case 'TOO_LARGE':
    case 'TOO_COMPLEX':
    case 'MALFORMED':
      return error.message
    default:
      return 'This document could not be read.'
  }
}

/** Worker threads that parse documents, each limited in memory, and replaced when they hang or crash. */
class WorkerPool {
  constructor({ concurrency, recycleAfter, memoryMb }) {
    this.size = concurrency
    this.recycleAfter = recycleAfter
    this.memoryMb = memoryMb
    this.idle = []
    this.busy = new Map()
    this.nextId = 1
  }

  spawn() {
    const worker = new Worker(WORKER_FILE, { resourceLimits: { maxOldGenerationSizeMb: this.memoryMb } })
    worker.unref()
    return { worker, jobs: 0 }
  }

  run(ticket, extension, bytes, options, timeoutMs) {
    const slot = this.idle.pop() ?? this.spawn()
    const id = this.nextId++
    // A private copy whose memory moves to the worker.
    const copy = new Uint8Array(bytes)
    return new Promise((resolve, reject) => {
      let done = false
      const finish = (callback, value, keep) => {
        if (done) return
        done = true
        clearTimeout(timer)
        slot.worker.off('message', onMessage)
        slot.worker.off('error', onError)
        slot.worker.off('exit', onExit)
        this.busy.delete(ticket)
        slot.jobs += 1
        if (keep && slot.jobs < this.recycleAfter && this.idle.length < this.size) this.idle.push(slot)
        else void slot.worker.terminate()
        callback(value)
      }
      const onMessage = (message) => {
        if (message.id !== id) return
        if (message.ok) finish(resolve, message.result, true)
        else finish(reject, Object.assign(new Error(message.error.message), { code: message.error.code }), true)
      }
      const onError = (error) => finish(reject, Object.assign(new Error(error.message), { code: 'CRASHED' }), false)
      const onExit = () => finish(reject, Object.assign(new Error('The reader stopped.'), { code: slot.cancelled ? 'CANCELLED' : 'CRASHED' }), false)
      const timer = setTimeout(() => {
        slot.worker.off('exit', onExit)
        finish(reject, Object.assign(new Error('Timed out'), { code: 'TIMEOUT' }), false)
      }, timeoutMs)
      slot.worker.on('message', onMessage)
      slot.worker.on('error', onError)
      slot.worker.on('exit', onExit)
      this.busy.set(ticket, slot)
      slot.worker.postMessage({ id, extension, bytes: copy.buffer, options }, [copy.buffer])
    })
  }

  /** Abandons the document a job is reading by stopping its worker. */
  cancel(ticket) {
    const slot = this.busy.get(ticket)
    if (!slot) return
    slot.cancelled = true
    void slot.worker.terminate()
  }

  async close() {
    for (const slot of [...this.idle, ...this.busy.values()]) {
      slot.cancelled = true
      await slot.worker.terminate()
    }
    this.idle = []
  }
}
