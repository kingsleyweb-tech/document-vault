import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { OCR_IMAGES } from './extract/formats.js'
import { friendlyError } from './indexer.js'
import { extensionOf } from './kinds.js'

// Recognises the words on scanned pages (OCR) so they can be searched, in the
// background, on this computer.
//
// - Only libraries whose owner said yes (ocr_pref 'on') are processed. A new
//   library is 'ask': the app offers OCR once scanned pages are found.
// - It waits while text is being read from other documents, then works on one
//   document at a time, one page at a time, in a worker thread. A scanned
//   book can take minutes; progress is saved per page, so a restart resumes
//   where it stopped.
// - Before reading, the file is checked with the access rules and opened once,
//   as the text reader does. Before each page is saved the library's epoch is
//   checked again: after a revoke, an exclusion or a removal the worker is
//   stopped and nothing more from the file is kept.
// - Recognised text is stored as pages with source 'ocr' in the same text
//   index, so search, page numbers and passages work as for other text.

const DEFAULTS = {
  pageTimeoutMs: 120_000,
  maxPages: 2000,
  maxBytes: 200 * 1024 * 1024,
  memoryMb: 1536,
  scale: 2.5,
  minConfidence: 30,
  idleMs: 60_000,
  retryMs: 1000,
}
const WORKER_FILE = fileURLToPath(new URL('./extract/ocr-worker.js', import.meta.url))
const require = createRequire(import.meta.url)

/** The folder with the English language data shipped with the app. */
export function defaultLangPath() {
  return path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int')
}

export class OcrRunner extends EventEmitter {
  constructor(store, access, extractor, options = {}) {
    super()
    this.store = store
    this.access = access
    this.extractor = extractor
    this.options = { ...DEFAULTS, langPath: defaultLangPath(), ...options }
    this.current = null
    this.paused = false
    this.closed = false
    this.worker = null
    this.idleTimer = null
    this.retryTimer = null
    this.nextId = 1
    const db = store.db
    this.sql = {
      queueRoot: db.prepare(`update docs set ocr_state = 'pending', ocr_error = null
        where root_id = ? and state = 'completed' and needs_ocr > 0 and ocr_state in ('none', 'cancelled')`),
      // Scans read since the last look, in libraries whose owner said yes.
      queueNew: db.prepare(`update docs set ocr_state = 'pending' where ocr_state = 'none' and state = 'completed' and needs_ocr > 0
        and root_id in (select id from roots where state = 'active' and ocr_pref = 'on')`),
      doc: db.prepare('select state, sha256 from docs where entry_id = ?'),
      cancelRoot: db.prepare(`update docs set ocr_state = 'cancelled' where root_id = ? and ocr_state in ('pending', 'processing')`),
      interrupted: db.prepare(`update docs set ocr_state = 'pending' where ocr_state = 'processing'`),
      next: db.prepare(`select d.* from docs d join roots r on r.id = d.root_id
        where d.ocr_state = 'pending' and d.state = 'completed' and r.state = 'active' and r.ocr_pref = 'on'
          and r.status not in ('unavailable', 'denied')
        order by d.priority desc, d.entry_id limit 1`),
      setState: db.prepare('update docs set ocr_state = ?, ocr_error = ? where entry_id = ?'),
      plan: db.prepare('update docs set ocr_pages = ? where entry_id = ?'),
      finish: db.prepare(`update docs set ocr_state = ?, ocr_error = ?, ocr_at = ? where entry_id = ?`),
      insertPage: db.prepare(`insert into doc_pages (entry_id, seq, page, label, text, source, confidence) values (?, ?, ?, null, ?, 'ocr', ?)`),
      progress: db.prepare(`update docs set ocr_done = ocr_done + 1, ocr_failed = ocr_failed + ?,
        ocr_confidence = case when ? is null then ocr_confidence
          else round(((coalesce(ocr_confidence, 0) * (ocr_done - ocr_failed)) + ?) * 1.0 / (ocr_done - ocr_failed + 1)) end
        where entry_id = ?`),
      prioritize: db.prepare(`update docs set priority = 20,
        ocr_state = case when ocr_state in ('cancelled', 'failed') and needs_ocr > 0 then 'pending' else ocr_state end where entry_id = ?`),
      counts: db.prepare(`select d.ocr_state as state, count(*) as n, sum(d.ocr_pages) as pages, sum(d.ocr_done) as done
        from docs d join roots r on r.id = d.root_id where r.state <> 'revoked' and d.needs_ocr > 0 group by d.ocr_state`),
    }
    // Text reading comes first: try again whenever it changes.
    extractor.on('change', () => this.schedule())
  }

  start() {
    this.sql.interrupted.run()
    for (const root of this.store.listRootRows()) if (root.state === 'active' && root.ocr_pref === 'on') this.sql.queueRoot.run(root.id)
    this.schedule()
  }

  /** Queues the scanned documents of a library (after it was read, or OCR was turned on). */
  queueRoot(rootId) {
    const root = this.store.getRoot(rootId)
    if (!root || root.ocr_pref !== 'on') return
    this.sql.queueRoot.run(rootId)
    this.schedule()
  }

  /** Stops OCR of a library now. What was already recognised is kept, unless the caller removes it. */
  cancelRoot(rootId) {
    this.sql.cancelRoot.run(rootId)
    if (this.current?.rootId === rootId) this.abort('cancelled')
    this.emit('change')
  }

  prioritize(entryId) {
    this.sql.prioritize.run(entryId)
    this.schedule()
  }

  pause() {
    this.paused = true
    if (this.current) this.abort('pending')
    this.emit('change')
  }

  resume() {
    this.paused = false
    this.schedule()
    this.emit('change')
  }

  status() {
    const counts = {}
    let pages = 0
    let done = 0
    for (const row of this.sql.counts.all()) {
      counts[row.state] = Number(row.n)
      pages += Number(row.pages ?? 0)
      done += Number(row.done ?? 0)
    }
    return {
      state: this.paused ? 'paused' : this.current ? 'recognising' : 'idle',
      counts,
      pages,
      done,
      current: this.current ? { entryId: this.current.entryId, rootId: this.current.rootId, name: this.current.name, page: this.current.page, done: this.current.done, total: this.current.total } : null,
    }
  }

  async close() {
    this.closed = true
    clearTimeout(this.retryTimer)
    clearTimeout(this.idleTimer)
    if (this.current) this.abort('pending')
    await this.current?.promise
    await this.stopWorker()
  }

  /** Resolves when no OCR work is left. Used by tests and the benchmark. */
  async idle(timeout = 300_000) {
    const started = Date.now()
    for (;;) {
      if (!this.current && !this.hasWork() && this.extractorIdle()) return
      if (Date.now() - started > timeout) throw new Error('Text recognition did not finish in time')
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  extractorIdle() {
    return this.extractor.active.size === 0 && this.extractor.sql.next.all(1).length === 0 && this.extractor.pendingRoots.size === 0
  }

  hasWork() {
    this.sql.queueNew.run()
    return Boolean(this.sql.next.get())
  }

  schedule() {
    if (this.closed || this.paused || this.current) return
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => this.drain(), 0)
  }

  drain() {
    if (this.closed || this.paused || this.current) return
    const doc = this.hasWork() ? this.sql.next.get() : null
    if (!doc) {
      this.idleSoon()
      return
    }
    if (!this.extractorIdle()) {
      // Text reading is under way; look again shortly.
      this.retryTimer = setTimeout(() => this.drain(), this.options.retryMs)
      return
    }
    clearTimeout(this.idleTimer)
    this.sql.setState.run('processing', null, doc.entry_id)
    const job = { entryId: doc.entry_id, rootId: doc.root_id, name: null, page: null, done: doc.ocr_done, total: doc.ocr_pages || null }
    this.current = job
    this.emit('change')
    job.promise = this.process(doc, job)
      .catch((error) => this.sql.finish.run('failed', friendlyError(error), Date.now(), doc.entry_id))
      .finally(() => {
        this.current = null
        this.emit('change')
        this.schedule()
      })
  }

  idleSoon() {
    clearTimeout(this.idleTimer)
    if (!this.worker) return
    this.idleTimer = setTimeout(() => void this.stopWorker(), this.options.idleMs)
    this.idleTimer.unref?.()
  }

  async stopWorker() {
    const worker = this.worker
    this.worker = null
    if (!worker) return
    await worker.terminate().catch(() => {})
  }

  /** Stops the document being recognised; `state` is what it is left as. */
  abort(state) {
    const job = this.current
    if (!job || job.aborted) return
    job.aborted = state
    // The worker may be in the middle of a page; it is replaced on the next document.
    void this.stopWorker()
    job.settle?.()
  }

  async process(doc, job) {
    const entry = this.store.getEntry(doc.entry_id)
    if (!entry) return
    job.name = entry.name
    const root = this.store.getRoot(entry.root_id)
    const epoch = root?.epoch
    const stop = (state, error = null) => this.sql.setState.run(state, error, entry.id)
    if (!root || this.access.problem(root, entry.path, 'index')) return stop('cancelled')

    let checked
    try {
      checked = await this.access.checkReal(root, entry.path, 'index')
    } catch (error) {
      return stop(error?.code === 'EACCES' || error?.code === 'EPERM' || error?.code === 'ENOENT' ? 'pending' : 'failed', friendlyError(error))
    }
    if (checked.problem) return stop('cancelled')

    // Open once, then confirm the opened file is the one that was checked and read.
    let bytes
    const handle = await fs.promises.open(checked.real, 'r').catch((error) => error)
    if (handle instanceof Error) return stop('pending', friendlyError(handle))
    try {
      const info = await handle.stat()
      const now = await fs.promises.stat(checked.real)
      if (now.ino !== info.ino || now.dev !== info.dev) return stop('cancelled')
      // A file changed since its text was read waits for the text reader, which starts OCR afresh.
      if (info.size !== doc.size || Math.round(info.mtimeMs) !== doc.mtime) return stop('changed')
      if (info.size > this.options.maxBytes) return this.sql.finish.run('failed', 'This file is too large to recognise.', Date.now(), entry.id)
      bytes = await handle.readFile()
    } finally {
      await handle.close()
    }

    // The text reader may start on this file again (it changed); its result replaces this one.
    const sameDocument = () => {
      const now = this.sql.doc.get(entry.id)
      return Boolean(now) && now.state === 'completed' && now.sha256 === doc.sha256
    }
    const valid = () => !job.aborted && this.access.stillValid(root.id, epoch, entry.path) && this.store.getEntry(entry.id)?.path === entry.path && sameDocument()
    // Discarded: recognised again later when the file may still be read (the epoch only moved on), otherwise dropped.
    const discarded = () => {
      if (job.aborted) return stop(job.aborted)
      if (!sameDocument()) return stop('none')
      const current = this.store.getRoot(root.id)
      const allowed = current && !this.access.problem(current, entry.path, 'index') && this.store.getEntry(entry.id)?.path === entry.path
      return stop(allowed ? 'pending' : 'cancelled')
    }
    if (!valid()) return discarded()

    const kind = OCR_IMAGES.has(extensionOf(entry.name)) ? 'image' : 'pdf'
    const outcome = await this.recognise(job, { kind, bytes, skip: doc.ocr_done }, (message) => {
      if (!valid()) return false
      if (message.type === 'plan') {
        job.total = message.total
        this.sql.plan.run(message.total, entry.id)
        this.emit('change')
        return true
      }
      const failed = message.type === 'page-error' ? 1 : 0
      const keep = !failed && message.text && message.confidence >= this.options.minConfidence && /\p{L}{2}/u.test(message.text)
      this.store.transaction(() => {
        if (keep) this.sql.insertPage.run(entry.id, message.page === null ? 0 : message.page - 1, message.page, message.text, message.confidence)
        this.sql.progress.run(failed, failed ? null : message.confidence, failed ? null : message.confidence, entry.id)
      })
      job.page = message.page
      job.done += 1
      this.emit('change')
      return true
    })

    if (outcome.state === 'stale') return discarded()
    if (outcome.state === 'timeout') {
      // One page took too long: count it as failed and carry on after it.
      this.sql.progress.run(1, null, null, entry.id)
      return stop('pending')
    }
    if (outcome.state === 'error') return this.sql.finish.run('failed', describeFailure(outcome.error), Date.now(), entry.id)
    this.sql.finish.run('completed', null, Date.now(), entry.id)
  }

  /** Sends one document to the worker and handles its messages until it is done, fails, times out or is stopped. */
  recognise(job, request, onMessage) {
    return new Promise((resolve) => {
      if (!this.worker) {
        this.worker = new Worker(WORKER_FILE, { resourceLimits: { maxOldGenerationSizeMb: this.options.memoryMb } })
        this.worker.unref()
      }
      const worker = this.worker
      const id = this.nextId++
      let timer = null
      const finish = (outcome) => {
        clearTimeout(timer)
        worker.off('message', listener)
        worker.off('error', crashed)
        worker.off('exit', crashed)
        job.settle = null
        resolve(outcome)
      }
      const arm = () => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          void this.stopWorker()
          finish({ state: 'timeout' })
        }, this.options.pageTimeoutMs)
      }
      const listener = (message) => {
        if (message.id !== id) return
        if (message.type === 'done') return finish({ state: 'done' })
        if (message.type === 'error') return finish({ state: 'error', error: message.error })
        if (onMessage(message) === false) {
          void this.stopWorker()
          return finish({ state: 'stale' })
        }
        arm()
      }
      const crashed = (error) => {
        if (this.worker === worker) this.worker = null
        finish(job.aborted ? { state: 'stale' } : { state: 'error', error: { code: 'CRASHED', message: String(error?.message ?? error) } })
      }
      job.settle = () => finish({ state: 'stale' })
      worker.on('message', listener)
      worker.once('error', crashed)
      worker.once('exit', crashed)
      arm()
      const copy = new Uint8Array(request.bytes)
      worker.postMessage({ id, ...request, bytes: copy, maxPages: this.options.maxPages, scale: this.options.scale, langPath: this.options.langPath }, [copy.buffer])
    })
  }
}

function describeFailure(error) {
  switch (error?.code) {
    case 'InvalidPDFException':
      return 'This PDF is damaged or not a valid PDF.'
    case 'PasswordException':
      return 'This document is protected with a password.'
    case 'OCR_DATA_MISSING':
    case 'MALFORMED':
      return error.message
    case 'CRASHED':
      return 'Text recognition stopped unexpectedly on this document.'
    default:
      return 'The text of this document could not be recognised.'
  }
}
