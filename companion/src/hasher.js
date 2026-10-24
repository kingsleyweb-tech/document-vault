import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { scopeSql } from './access.js'
import { textFingerprint } from './fingerprint.js'

// Finds the content of files the text reader does not read (Word 97 files,
// e-books in other formats, libraries with text reading off, files too large
// to read), so identical copies can be listed. Nothing is ever changed.
//
// - Only a file that has the same size as another file is read: a file with a
//   size of its own cannot have an identical copy, so most files are never
//   opened.
// - It runs only while the text reader is idle, one file at a time, reading in
//   chunks rather than loading the whole file.
// - Each file is checked with the access rules and opened once, as the text
//   reader does; the library's epoch is checked again before the hash is
//   saved, so after a revoke or an exclusion nothing from the file is kept.
// - In the same idle time it fingerprints the text of documents read by an
//   earlier version (see fingerprint.js), from the index, without opening files.

const DEFAULTS = {
  chunkBytes: 1024 * 1024,
  batch: 20,
  retryMs: 1000,
  delayMs: 250,
}

export class Hasher extends EventEmitter {
  constructor(store, access, extractor, options = {}) {
    super()
    this.store = store
    this.access = access
    this.extractor = extractor
    this.options = { ...DEFAULTS, ...options }
    this.paused = false
    this.closed = false
    this.running = null
    this.timer = null
    this.cursor = 0
    this.current = null
    // Files read since the start; tests use it to confirm unique sizes are never opened.
    this.reads = 0
    const db = store.db
    const scope = scopeSql('e')
    const twinScope = scopeSql('o')
    const candidates = `from entries e join roots r on r.id = e.root_id
      where e.is_dir = 0 and e.accessible = 1 and e.size > 0 and r.state = 'active' and r.status not in ('unavailable', 'denied')
        and ${scope.sql}
        and not exists (select 1 from file_hashes h where h.entry_id = e.id and h.size = e.size and h.mtime = e.mtime)
        and not exists (select 1 from docs d where d.entry_id = e.id and r.extract_text = 1 and d.state in ('pending', 'processing'))
        and exists (select 1 from entries o where o.size = e.size and o.id <> e.id and o.is_dir = 0 and ${twinScope.sql})`
    const values = [...scope.values, ...twinScope.values]
    const next = db.prepare(`select e.* ${candidates} and e.id > ? order by e.id limit ?`)
    const pending = db.prepare(`select count(*) as n ${candidates}`)
    this.sql = {
      next: (cursor, limit) => next.all(...values, cursor, limit),
      pending: () => Number(pending.get(...values).n),
      save: db.prepare(`insert into file_hashes (entry_id, root_id, size, mtime, sha256, at) values (?, ?, ?, ?, ?, ?)
        on conflict (entry_id) do update set root_id = excluded.root_id, size = excluded.size, mtime = excluded.mtime,
          sha256 = excluded.sha256, at = excluded.at`),
      needText: db.prepare(`select d.entry_id from docs d join roots r on r.id = d.root_id
        where d.state = 'completed' and d.text_hash is null and r.state <> 'revoked' limit ?`),
      pagesOf: db.prepare("select text from doc_pages where entry_id = ? and source = 'text' order by seq"),
      setText: db.prepare("update docs set text_hash = ? where entry_id = ? and state = 'completed' and text_hash is null"),
    }
    extractor.on('change', () => this.schedule())
  }

  start() {
    this.schedule()
  }

  pause() {
    this.paused = true
    this.emit('change')
  }

  resume() {
    this.paused = false
    this.schedule()
    this.emit('change')
  }

  /** Abandons the file being read if it belongs to this library. */
  cancelRoot(rootId) {
    if (this.current?.rootId === rootId) this.current.cancelled = true
  }

  status() {
    return {
      state: this.paused ? 'paused' : this.current ? 'checking' : 'idle',
      pending: this.sql.pending(),
    }
  }

  async close() {
    this.closed = true
    clearTimeout(this.timer)
    this.timer = null
    if (this.current) this.current.cancelled = true
    await this.running
  }

  /** Resolves when nothing is left to check. Used by tests and the benchmark. */
  async idle(timeout = 60_000) {
    const started = Date.now()
    for (;;) {
      if (!this.running && this.extractor.isIdle() && this.sql.pending() === 0 && this.sql.needText.all(1).length === 0) return
      if (Date.now() - started > timeout) throw new Error('Checking for duplicates did not finish in time')
      this.schedule()
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  schedule(delay = this.options.delayMs) {
    if (this.closed || this.paused || this.running || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.running = this.drain().finally(() => {
        this.running = null
      })
    }, delay)
    this.timer.unref?.()
  }

  async drain() {
    for (;;) {
      if (this.closed || this.paused) return
      if (!this.extractor.isIdle()) {
        // Reading text comes first; look again shortly.
        setImmediate(() => this.schedule(this.options.retryMs))
        return
      }
      if (this.fingerprintText()) continue
      const rows = this.sql.next(this.cursor, this.options.batch)
      if (rows.length === 0) {
        // A full pass is done. Files that could not be read are tried again after the next scan.
        this.cursor = 0
        return
      }
      for (const row of rows) {
        if (this.closed || this.paused) return
        this.cursor = row.id
        await this.hash(row).catch(() => {})
      }
      this.emit('change')
    }
  }

  /** Fingerprints the text of a batch of documents read before fingerprints existed. Returns true if it did any. */
  fingerprintText() {
    const docs = this.sql.needText.all(50)
    if (docs.length === 0) return false
    this.store.transaction(() => {
      for (const doc of docs) this.sql.setText.run(textFingerprint(this.sql.pagesOf.all(doc.entry_id).map((page) => page.text)), doc.entry_id)
    })
    return true
  }

  async hash(entry) {
    const root = this.store.getRoot(entry.root_id)
    if (!root || this.access.problem(root, entry.path, 'index')) return
    const epoch = root.epoch
    const link = await fs.promises.lstat(entry.path)
    if (link.isSymbolicLink()) return
    const checked = await this.access.checkReal(root, entry.path, 'index')
    if (checked.problem) return

    const job = { rootId: root.id, cancelled: false }
    this.current = job
    const hash = createHash('sha256')
    const handle = await fs.promises.open(checked.real, 'r')
    let info
    try {
      // The opened file must be the one checked, unchanged since it was indexed.
      info = await handle.stat()
      const now = await fs.promises.stat(checked.real)
      if (now.ino !== info.ino || now.dev !== info.dev) return
      if (info.size !== entry.size || Math.round(info.mtimeMs) !== entry.mtime) return
      this.reads += 1
      const buffer = Buffer.allocUnsafe(this.options.chunkBytes)
      for (;;) {
        if (job.cancelled || this.closed) return
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
        if (bytesRead === 0) break
        hash.update(buffer.subarray(0, bytesRead))
      }
    } finally {
      this.current = null
      await handle.close()
    }
    if (job.cancelled || !this.access.stillValid(root.id, epoch, entry.path) || this.store.getEntry(entry.id)?.path !== entry.path) return
    this.sql.save.run(entry.id, root.id, info.size, entry.mtime, hash.digest('hex'), Date.now())
  }
}
