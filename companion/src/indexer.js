import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { extensionOf, kindOf } from './kinds.js'
import { childKey, isProtectedKey, isSkippedName, pathKey } from './paths.js'

// Walks the libraries in the background and keeps the index current.
//
// - Only libraries the user added are walked, and only while they are active
//   (not paused or revoked). Every path is checked with the access rules
//   (access.js) before it is recorded: excluded folders are never opened.
// - Scans run one library at a time. Each folder's listing is compared with
//   the index and only the differences are written, in small transactions
//   (BATCH_SIZE rows or FLUSH_MS, whichever comes first) with the event loop
//   free in between, so the folder tree and searches answer while a library
//   is being indexed and a rescan of an unchanged library writes nothing.
// - A scan stops as soon as the library's access changes (its epoch moves),
//   for example when a folder is excluded or the library is revoked.
// - Between scans, change notifications (fs.watch, recursive) update single
//   paths, and a periodic reconciliation catches anything they missed.
// - Links (symbolic links, junctions) are never followed; they are recorded as
//   skipped. Unreadable folders are recorded and skipped; a missing library
//   (for example on a disconnected drive) keeps its entries and is reported as
//   unavailable.

const BATCH_SIZE = 150
const FLUSH_MS = 120
const STAT_CONCURRENCY = 24
const WATCH_DEBOUNCE_MS = 400
const MAX_ERRORS = 50
const RECONCILE_MS = 6 * 60 * 60 * 1000
// Windows reports reading a file (its last-access time changing) as a change.
// Files the app itself reads are ignored for this long after they were opened.
const OWN_READ_MS = 10_000
// After lost notifications, wait this long for more before catching up. While the
// app is reading files itself, it catches up at most once per gap.
const OVERFLOW_SETTLE_MS = 1000
const OVERFLOW_QUIET_MS = 3000
const OVERFLOW_GAP_MS = 30_000

export class Indexer extends EventEmitter {
  constructor(store, { dataDir, access, reconcileMs = RECONCILE_MS }) {
    super()
    this.store = store
    this.dataDir = dataDir
    this.access = access
    this.reconcileMs = reconcileMs
    this.queue = []
    this.running = null
    this.paused = false
    this.resumeWaiters = []
    this.cancelled = new Set()
    this.watchers = new Map()
    this.pending = new Map()
    this.flushTimer = null
    this.reconcileTimer = null
    this.errors = []
    this.progress = null
    this.flushing = false
    this.closed = false
    this.ownReads = new Map()
    this.lastOwnRead = 0
    this.overflows = new Map()
    this.overflowScans = new Map()
    this.overflowGapMs = OVERFLOW_GAP_MS
  }

  /** Called before the app opens a file to read it, so the notification that follows is not taken for a change. */
  noteRead(...targets) {
    const now = Date.now()
    this.lastOwnRead = now
    if (this.ownReads.size > 5000) for (const [key, until] of this.ownReads) if (until <= now) this.ownReads.delete(key)
    for (const target of targets) if (target) this.ownReads.set(pathKey(target), now + OWN_READ_MS)
  }

  /**
   * Notifications were lost, so the library is scanned again. Reading files
   * (text, duplicates) can by itself produce more notifications than fit, and
   * each scan would then lead to the next; so while that reading goes on, a
   * library is caught up at most once per gap. Changes reported in the
   * meantime are still applied as they come.
   */
  overflowed(rootId) {
    if (this.overflows.has(rootId)) return
    const run = () => {
      if (this.closed) return
      const reading = Date.now() - this.lastOwnRead < OVERFLOW_QUIET_MS
      const since = Date.now() - (this.overflowScans.get(rootId) ?? 0)
      if (reading && since < this.overflowGapMs) {
        this.overflows.set(rootId, later(run, this.overflowGapMs - since))
        return
      }
      this.overflows.delete(rootId)
      this.overflowScans.set(rootId, Date.now())
      this.enqueue(rootId)
    }
    this.overflows.set(rootId, later(run, OVERFLOW_SETTLE_MS))
  }

  /** True while a library is being walked: deeper work (reading text, hashing) waits so discovery finishes first. */
  isDiscovering() {
    return Boolean(this.running) && !this.paused
  }

  status() {
    const counts = this.store.counts()
    return {
      state: this.paused ? 'paused' : this.running ? 'indexing' : this.pending.size > 0 || this.flushing ? 'updating' : 'idle',
      // `scanned` (entries found so far) is kept for older versions of the app.
      current: this.progress ? { ...this.progress, scanned: this.progress.folders + this.progress.files, elapsedMs: Date.now() - this.progress.startedAt } : null,
      queued: this.queue.map((job) => job.rootId),
      watching: [...this.watchers.keys()],
      totals: { files: counts.total - counts.folders, folders: counts.folders },
      errors: this.errors.slice(-MAX_ERRORS),
    }
  }

  /** Watches every active library and queues a catch-up scan for changes made while the app was closed. */
  start() {
    for (const root of this.store.listRootRows()) {
      if (root.state !== 'active') continue
      this.watch(root)
      this.enqueue(root.id)
    }
    if (this.reconcileMs > 0) {
      this.reconcileTimer = setInterval(() => this.reconcile(), this.reconcileMs)
      this.reconcileTimer.unref?.()
    }
  }

  /** Rescans every active library, because change notifications can be lost. */
  reconcile() {
    for (const root of this.store.listRootRows()) if (root.state === 'active') this.enqueue(root.id)
  }

  /** Queues a scan of a library, or of one folder inside it. */
  enqueue(rootId, folder = null) {
    const root = this.store.getRoot(rootId)
    if (!root || root.state !== 'active') return
    const key = folder ? pathKey(folder) : null
    // Merged with a scan still waiting to start. A scan already under way may have
    // passed the folders that changed, so the library is scanned again after it.
    const covered = (job) => job.rootId === rootId && (job.key === null || job.key === key)
    if (this.queue.some(covered)) return
    this.queue.push({ rootId, folder, key })
    void this.drain()
  }

  pause() {
    this.paused = true
    this.emit('change')
  }

  resume() {
    this.paused = false
    for (const resolve of this.resumeWaiters.splice(0)) resolve()
    void this.drain()
    this.emit('change')
  }

  /** Stops all work on a library: queued scans, the running scan and its watcher. */
  stopRoot(rootId) {
    this.queue = this.queue.filter((job) => job.rootId !== rootId)
    if (this.running?.rootId === rootId) this.cancelled.add(rootId)
    for (const [key, change] of this.pending) if (change.rootId === rootId) this.pending.delete(key)
    this.unwatch(rootId)
    this.emit('change')
  }

  /** Waits until no scan of the library is running. */
  async settled(rootId) {
    while (this.running?.rootId === rootId) await this.running.promise
  }

  /** Stops any scan of the library and forgets it. Files on disk are never touched. */
  removeRoot(rootId) {
    this.stopRoot(rootId)
    this.store.removeRoot(rootId)
    this.emit('change')
  }

  async close() {
    this.closed = true
    clearInterval(this.reconcileTimer)
    for (const id of [...this.watchers.keys()]) this.unwatch(id)
    clearTimeout(this.flushTimer)
    for (const timer of this.overflows.values()) clearTimeout(timer)
    if (this.running) this.cancelled.add(this.running.rootId)
    this.resume()
    await this.running?.promise
  }

  async drain() {
    if (this.running || this.paused || this.closed) return
    const job = this.queue.shift()
    if (!job) return
    const promise = this.scanRoot(job.rootId, job.folder).catch((error) => this.recordError(null, error))
    this.running = { rootId: job.rootId, folder: job.folder, promise }
    await promise
    this.cancelled.delete(job.rootId)
    this.running = null
    this.progress = null
    this.emit('change')
    void this.drain()
  }

  async gate() {
    if (!this.paused) return
    await new Promise((resolve) => this.resumeWaiters.push(resolve))
  }

  recordError(target, error) {
    this.errors.push({ path: target, code: error?.code ?? 'ERROR', message: friendlyError(error), at: Date.now() })
    if (this.errors.length > MAX_ERRORS * 2) this.errors.splice(0, this.errors.length - MAX_ERRORS)
  }

  async scanRoot(rootId, folder = null) {
    const root = this.store.getRoot(rootId)
    if (!root || root.state !== 'active') return
    const started = Date.now()
    try {
      const info = await fs.promises.stat(root.path)
      if (!info.isDirectory()) throw Object.assign(new Error('Not a folder'), { code: 'ENOTDIR' })
      // A folder can exist yet refuse to list its contents (macOS privacy settings, changed permissions).
      await (await fs.promises.opendir(root.path)).close()
    } catch (error) {
      // Keep what was indexed: a drive that is unplugged now may come back.
      const denied = error?.code === 'EACCES' || error?.code === 'EPERM'
      this.store.finishRootScan(rootId, denied ? 'denied' : 'unavailable', friendlyError(error), Date.now() - started)
      this.unwatch(rootId)
      this.emit('change')
      return
    }
    const start = folder && this.access.problem(root, folder, 'index') === null ? folder : root.path
    if (start === root.path) this.store.setRootStatus(rootId, 'indexing')
    this.watch(root)
    const generation = Date.now()
    // Counts, not a percentage: how many entries a library holds is not known until it has been walked.
    this.progress = { rootId, root: root.path, phase: 'discovering', full: start === root.path, folders: 0, files: 0, written: 0, errors: 0, waiting: 0, folder: start, startedAt: started }
    const outcome = await this.walk(root, start, generation, this.progress)
    if (!outcome) {
      const current = this.store.getRoot(rootId)
      if (current && current.status === 'indexing') this.store.setRootStatus(rootId, 'pending')
      // Access changed during the scan (for example a folder was excluded): start again under the new rules.
      if (current && current.state === 'active' && current.epoch !== root.epoch && !this.closed) this.enqueue(rootId)
      return
    }
    if (start === root.path) {
      this.store.finishRootScan(rootId, 'ready', null, Date.now() - started)
      this.store.setTypeSkipped(rootId, outcome.typeSkipped)
    }
    this.store.setSynced(rootId)
    this.emit('scanned', { rootId, changed: outcome.changed, removed: outcome.removed, ms: Date.now() - started })
  }

  /** Depth of a folder below the library's top folder (the top folder is 0). */
  depthOf(root, target) {
    return path.relative(root.path, target).split(path.sep).filter(Boolean).length
  }

  /** Whether a folder at this depth is walked into, given the library's settings. A max_depth of 0 means no limit. */
  descends(root, depth) {
    if (!root.recursive) return depth === 0
    return !root.max_depth || depth < root.max_depth
  }

  /**
   * Indexes `start` (a folder inside the library) and everything below it that
   * the library's settings and exclusions allow. Returns null when the scan
   * was cancelled or the library's access changed.
   *
   * Each folder's listing is compared with what the index holds for it, and
   * only differences are written: new and changed entries, and entries that
   * are gone (with everything below them). A rescan of an unchanged library
   * therefore reads the disk but writes nothing.
   */
  async walk(root, start, generation, progress = null) {
    const types = root.file_types ? new Set(JSON.parse(root.file_types)) : null
    const exclusions = this.store.listExclusions(root.id)
    const excluded = (key) => exclusions.some((exclusion) => key === exclusion.path_key || key.startsWith(exclusion.key_lo))
    const startKey = pathKey(start)
    if (excluded(startKey)) return { typeSkipped: 0, changed: 0, removed: 0 }
    this.store.clearSkipsBelow(root.id, start)
    let typeSkipped = 0
    let changed = 0
    let removed = 0

    let rows = []
    let removals = []
    let renamed = new Set()
    let flushedAt = Date.now()
    const flush = async () => {
      if (rows.length > 0 || removals.length > 0) {
        this.store.applyEntries(rows, removals, renamed)
        changed += rows.length
        if (progress) progress.written += rows.length
        this.emit('indexed', root.id)
        rows = []
        removals = []
        renamed = new Set()
      }
      flushedAt = Date.now()
      this.emit('change')
      // Let searches and API calls run between batches.
      await new Promise((resolve) => setImmediate(resolve))
    }
    // Records `row` if it is new or differs from what the index holds (`known`).
    const record = (row, known) => {
      if (progress) {
        if (row.is_dir) progress.folders += 1
        else progress.files += 1
      }
      if (known && sameEntry(row, known)) return
      if (known && known.path !== row.path) renamed.add(row.path_key)
      // A folder replaced by a file of the same name: what was inside it is gone.
      if (known && known.is_dir && !row.is_dir) removals.push({ key: row.path_key, below: true })
      rows.push(row)
    }
    const remove = (key, onlyBelow = false) => {
      removals.push({ key, below: onlyBelow })
      if (!onlyBelow) removed += 1
    }

    const startEntry = await this.describe(root, start, startKey, pathKey(path.dirname(start)), generation)
    if (startEntry) record(startEntry, this.store.entryByPath(start))
    const stack = [{ folder: start, key: startKey, depth: this.depthOf(root, start) }]

    while (stack.length > 0) {
      const { folder, key: folderKey, depth } = stack.pop()
      if (this.cancelled.has(root.id) || this.closed) return null
      if (this.store.getRoot(root.id)?.epoch !== root.epoch) return null
      await this.gate()
      if (progress) {
        progress.folder = folder
        progress.waiting = stack.length
      }
      let names
      try {
        names = await fs.promises.readdir(folder, { withFileTypes: true })
      } catch (error) {
        this.recordError(folder, error)
        if (progress) progress.errors += 1
        const pending = rows.find((row) => row.path_key === folderKey)
        if (pending) pending.accessible = 0
        else {
          const entry = this.store.entryByPath(folder)
          if (entry) this.store.setAccessible(entry.id, false)
        }
        // Its contents can no longer be listed, so what was indexed inside it is dropped.
        remove(folderKey, true)
        continue
      }
      const known = new Map(this.store.childrenOf(folderKey).map((row) => [row.path_key, row]))
      const children = []
      for (const dirent of names) {
        const key = childKey(folderKey, dirent.name)
        if (excluded(key)) continue
        const target = path.join(folder, dirent.name)
        if (dirent.isSymbolicLink()) {
          // Followed nowhere: a link could lead outside the library.
          this.store.recordSkip(root.id, target, 'link')
          continue
        }
        if (dirent.isDirectory() && isSkippedName(dirent.name)) {
          this.store.recordSkip(root.id, target, 'system-folder')
          continue
        }
        if (types && dirent.isFile() && !types.has(kindOf(dirent.name, false))) {
          typeSkipped += 1
          continue
        }
        children.push({ dirent, target, key })
      }
      for (let index = 0; index < children.length; index += STAT_CONCURRENCY) {
        const slice = children.slice(index, index + STAT_CONCURRENCY)
        const described = await Promise.all(slice.map(({ dirent, target, key }) => this.describe(root, target, key, folderKey, generation, dirent)))
        for (const row of described) {
          if (!row) continue
          const before = known.get(row.path_key)
          known.delete(row.path_key)
          record(row, before)
          if (!row.is_dir) continue
          if (this.descends(root, depth + 1)) stack.push({ folder: row.path, key: row.path_key, depth: depth + 1 })
          else {
            if (root.recursive) this.store.recordSkip(root.id, row.path, 'too-deep')
            // Not walked into (too deep, or the library does not include subfolders): nothing inside it stays indexed.
            if (before?.is_dir) remove(row.path_key, true)
          }
        }
        if (rows.length >= BATCH_SIZE || (rows.length + removals.length > 0 && Date.now() - flushedAt >= FLUSH_MS)) await flush()
      }
      // Indexed before but no longer listed (deleted, renamed, excluded, now a link or a skipped type).
      for (const gone of known.keys()) remove(gone)
      if (removals.length >= BATCH_SIZE) await flush()
    }
    await flush()
    return { typeSkipped, changed, removed }
  }

  /** Builds an index row for one path, or null for paths that must not be indexed. */
  async describe(root, target, key, parentKey, generation, dirent) {
    if (isProtectedKey(key, this.dataDir)) {
      if (target !== root.path) this.store.recordSkip(root.id, target, 'protected')
      return null
    }
    const name = path.basename(target) || target
    let info = null
    try {
      info = await fs.promises.stat(target)
    } catch (error) {
      // Listed but unreadable (locked or permission denied): keep a row so it can be found and explained.
      if (!dirent) return null
      this.recordError(target, error)
    }
    const isDir = info ? info.isDirectory() : Boolean(dirent?.isDirectory())
    if (!info && !dirent) return null
    if (info && !isDir && !info.isFile()) return null
    return {
      root_id: root.id,
      path: target,
      path_key: key,
      parent_key: parentKey,
      name,
      ext: isDir ? '' : extensionOf(name),
      kind: kindOf(name, isDir),
      is_dir: isDir ? 1 : 0,
      size: info && !isDir ? info.size : 0,
      mtime: info ? Math.round(info.mtimeMs) : 0,
      // Windows maps the read-only attribute onto the write permission bits.
      readonly: info && (info.mode & 0o200) === 0 ? 1 : 0,
      hidden: name.startsWith('.') ? 1 : 0,
      accessible: info ? 1 : 0,
      scan_gen: generation,
    }
  }

  // ── Change notifications ────────────────────────────────────────────────

  watch(root) {
    if (this.watchers.has(root.id) || this.closed || root.state !== 'active') return
    let watcher
    try {
      watcher = fs.watch(root.path, { recursive: true, persistent: false }, (_event, filename) => {
        if (!filename) {
          // The notification buffer overflowed: changes were lost, so catch up with a scan.
          this.overflowed(root.id)
          return
        }
        const target = path.join(root.path, filename.toString())
        const key = pathKey(target)
        if ((this.ownReads.get(key) ?? 0) > Date.now()) return
        this.pending.set(key, { rootId: root.id, target })
        clearTimeout(this.flushTimer)
        this.flushTimer = setTimeout(() => void this.flushChanges(), WATCH_DEBOUNCE_MS)
      })
    } catch (error) {
      this.recordError(root.path, error)
      return
    }
    watcher.on('error', (error) => {
      this.recordError(root.path, error)
      this.unwatch(root.id)
      const denied = error?.code === 'EACCES' || error?.code === 'EPERM'
      this.store.setRootStatus(root.id, denied ? 'denied' : 'unavailable', friendlyError(error))
      this.emit('change')
    })
    this.watchers.set(root.id, watcher)
  }

  unwatch(rootId) {
    this.watchers.get(rootId)?.close()
    this.watchers.delete(rootId)
  }

  /** Applies queued change notifications. Exposed for tests. */
  async flushChanges() {
    if (this.flushing) {
      // Applied after the current round; status stays 'updating' meanwhile.
      clearTimeout(this.flushTimer)
      this.flushTimer = setTimeout(() => void this.flushChanges(), WATCH_DEBOUNCE_MS)
      return
    }
    this.flushing = true
    try {
      await this.applyChanges()
    } finally {
      this.flushing = false
      this.emit('change')
    }
  }

  async applyChanges() {
    const changes = [...this.pending.values()]
    this.pending.clear()
    const touched = new Set()
    for (const { rootId, target } of changes) {
      // Read the library again: it may have been paused, revoked or narrowed since the notification.
      const root = this.store.getRoot(rootId)
      if (!root || this.access.problem(root, target, 'index')) continue
      if (relativeParts(root.path, target).some(isSkippedName)) continue
      const depth = this.depthOf(root, path.dirname(target))
      if (depth > 0 && !this.descends(root, depth)) continue
      let info = null
      try {
        info = await fs.promises.lstat(target)
      } catch {
        info = null
      }
      if (!info) {
        // Deleted, or the old name of a rename.
        this.store.removePath(target)
      } else if (info.isSymbolicLink()) {
        this.store.recordSkip(root.id, target, 'link')
      } else if (info.isDirectory()) {
        // A new or renamed folder may already contain files; index all of it.
        await this.walk(root, target, Date.now())
      } else {
        const types = root.file_types ? new Set(JSON.parse(root.file_types)) : null
        if (types && !types.has(kindOf(path.basename(target), false))) continue
        const row = await this.describe(root, target, pathKey(target), pathKey(path.dirname(target)), Date.now())
        // Reading a file can be reported as a change (its last-access time); write only real changes.
        const known = row && this.store.entryByPath(target)
        if (!row || (known && sameEntry(row, known))) continue
        this.store.writeEntries([row])
      }
      touched.add(root.id)
    }
    for (const rootId of touched) {
      this.store.setSynced(rootId)
      this.emit('indexed', rootId)
    }
  }
}

// Columns a scan compares to decide whether an indexed row needs writing.
/** An unref'd timeout: waiting for it never keeps the process running. */
function later(callback, ms) {
  const timer = setTimeout(callback, ms)
  timer.unref?.()
  return timer
}

const COMPARED = ['root_id', 'path', 'name', 'ext', 'kind', 'is_dir', 'size', 'mtime', 'readonly', 'hidden', 'accessible']

function sameEntry(row, known) {
  return COMPARED.every((column) => row[column] === known[column])
}

function relativeParts(rootPath, target) {
  return path.relative(rootPath, target).split(path.sep).filter(Boolean)
}

export function friendlyError(error) {
  switch (error?.code) {
    case 'EACCES':
    case 'EPERM':
      return 'Document Vault does not have permission to read this folder. Grant access again or check the folder’s permissions.'
    case 'ENOENT':
      return 'The folder or drive is not available. Reconnect the drive or check that the folder still exists.'
    case 'ENOTDIR':
      return 'This path is not a folder.'
    case 'EBUSY':
      return 'The file is locked by another program.'
    default:
      return error?.message ?? 'Unknown error'
  }
}
