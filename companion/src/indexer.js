import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { extensionOf, kindOf } from './kinds.js'
import { isProtected, isSkippedName, pathKey } from './paths.js'

// Walks the libraries in the background and keeps the index current.
//
// - Only libraries the user added are walked, and only while they are active
//   (not paused or revoked). Every path is checked with the access rules
//   (access.js) before it is recorded: excluded folders are never opened.
// - Scans run one library at a time, in batches of BATCH_SIZE rows, yielding
//   to the event loop between batches so searches stay fast while indexing.
// - Every scan stamps the rows it sees with a new generation; rows of that
//   library with an older generation afterwards no longer exist and are removed.
// - A scan stops as soon as the library's access changes (its epoch moves),
//   for example when a folder is excluded or the library is revoked.
// - Between scans, change notifications (fs.watch, recursive) update single
//   paths, and a periodic reconciliation catches anything they missed.
// - Links (symbolic links, junctions) are never followed; they are recorded as
//   skipped. Unreadable folders are recorded and skipped; a missing library
//   (for example on a disconnected drive) keeps its entries and is reported as
//   unavailable.

const BATCH_SIZE = 400
const STAT_CONCURRENCY = 24
const WATCH_DEBOUNCE_MS = 400
const MAX_ERRORS = 50
const RECONCILE_MS = 6 * 60 * 60 * 1000

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
    this.closed = false
  }

  status() {
    const counts = this.store.counts()
    return {
      state: this.paused ? 'paused' : this.running ? 'indexing' : this.pending.size > 0 ? 'updating' : 'idle',
      current: this.progress,
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
    const covered = (job) => job.rootId === rootId && (job.key === null || job.key === key)
    if ((this.running && !this.running.folder && this.running.rootId === rootId && key === null) || this.queue.some(covered)) return
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
    this.progress = { rootId, root: root.path, scanned: 0, folder: start, startedAt: started }
    const outcome = await this.walk(root, start, generation)
    if (!outcome) {
      const current = this.store.getRoot(rootId)
      if (current && current.status === 'indexing') this.store.setRootStatus(rootId, 'pending')
      // Access changed during the scan (for example a folder was excluded): start again under the new rules.
      if (current && current.state === 'active' && current.epoch !== root.epoch && !this.closed) this.enqueue(rootId)
      return
    }
    const removed = this.store.removeUnseen(rootId, generation, start === root.path ? null : pathKey(start))
    if (start === root.path) {
      this.store.finishRootScan(rootId, 'ready', null, Date.now() - started)
      this.store.setTypeSkipped(rootId, outcome.typeSkipped)
    }
    this.store.setSynced(rootId)
    this.emit('scanned', { rootId, removed, ms: Date.now() - started })
  }

  /** Depth of a folder below the library's top folder (the top folder is 0). */
  depthOf(root, target) {
    return path.relative(root.path, target).split(path.sep).filter(Boolean).length
  }

  /** Whether a folder at this depth is walked into, given the library's settings. */
  descends(root, depth) {
    if (!root.recursive) return depth === 0
    return depth < root.max_depth
  }

  /**
   * Indexes `start` (a folder inside the library) and everything below it that
   * the library's settings and exclusions allow. Returns null when the scan
   * was cancelled or the library's access changed.
   */
  async walk(root, start, generation) {
    const types = root.file_types ? new Set(JSON.parse(root.file_types)) : null
    const exclusions = this.store.listExclusions(root.id)
    const excluded = (target) => exclusions.some((exclusion) => target === exclusion.path || pathKey(target) === exclusion.path_key || pathKey(target).startsWith(exclusion.key_lo))
    if (excluded(start)) return { typeSkipped: 0 }
    this.store.clearSkipsBelow(root.id, start)
    let typeSkipped = 0

    const startEntry = await this.describe(root, start, generation)
    let batch = startEntry ? [startEntry] : []
    const stack = [{ folder: start, depth: this.depthOf(root, start) }]
    const flush = async () => {
      this.store.writeEntries(batch)
      if (this.progress) this.progress.scanned += batch.length
      if (batch.length > 0) this.emit('indexed', root.id)
      batch = []
      this.emit('change')
      // Let searches and API calls run between batches.
      await new Promise((resolve) => setImmediate(resolve))
    }

    while (stack.length > 0) {
      const { folder, depth } = stack.pop()
      if (this.cancelled.has(root.id) || this.closed) return null
      if (this.store.getRoot(root.id)?.epoch !== root.epoch) return null
      await this.gate()
      if (this.progress) this.progress.folder = folder
      let names
      try {
        names = await fs.promises.readdir(folder, { withFileTypes: true })
      } catch (error) {
        this.recordError(folder, error)
        const pending = batch.find((row) => row.path === folder)
        if (pending) pending.accessible = 0
        else {
          const entry = this.store.entryByPath(folder)
          if (entry) this.store.setAccessible(entry.id, false)
        }
        continue
      }
      const children = []
      for (const dirent of names) {
        const target = path.join(folder, dirent.name)
        if (excluded(target)) continue
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
        children.push(dirent)
      }
      for (let index = 0; index < children.length; index += STAT_CONCURRENCY) {
        const slice = children.slice(index, index + STAT_CONCURRENCY)
        const rows = await Promise.all(slice.map((dirent) => this.describe(root, path.join(folder, dirent.name), generation, dirent)))
        for (const row of rows) {
          if (!row) continue
          batch.push(row)
          if (!row.is_dir) continue
          if (this.descends(root, depth + 1)) stack.push({ folder: row.path, depth: depth + 1 })
          else if (root.recursive) this.store.recordSkip(root.id, row.path, 'too-deep')
        }
        if (batch.length >= BATCH_SIZE) await flush()
      }
    }
    await flush()
    return { typeSkipped }
  }

  /** Builds an index row for one path, or null for paths that must not be indexed. */
  async describe(root, target, generation, dirent) {
    if (isProtected(target, this.dataDir)) {
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
      path_key: pathKey(target),
      parent_key: pathKey(path.dirname(target)),
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
          this.enqueue(root.id)
          return
        }
        const target = path.join(root.path, filename.toString())
        this.pending.set(pathKey(target), { rootId: root.id, target })
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
        const generation = Date.now()
        if (await this.walk(root, target, generation)) this.store.removeUnseen(root.id, generation, pathKey(target))
      } else {
        const types = root.file_types ? new Set(JSON.parse(root.file_types)) : null
        if (types && !types.has(kindOf(path.basename(target), false))) continue
        const row = await this.describe(root, target, Date.now())
        if (row) this.store.writeEntries([row])
      }
      touched.add(root.id)
    }
    for (const rootId of touched) {
      this.store.setSynced(rootId)
      this.emit('indexed', rootId)
    }
    this.emit('change')
  }
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
