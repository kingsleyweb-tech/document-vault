import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { extensionOf, kindOf } from './kinds.js'
import { isProtected, isSkippedName, pathKey } from './paths.js'

// Walks indexed folders in the background and keeps the index current.
//
// - Scans run one root at a time, in batches of BATCH_SIZE rows, yielding to
//   the event loop between batches so searches stay fast while indexing.
// - Every scan stamps the rows it sees with a new generation; rows of that root
//   with an older generation afterwards no longer exist and are removed.
// - Between scans, Windows change notifications (fs.watch, recursive) update
//   single paths: added, changed, renamed and deleted files and folders.
// - Unreadable folders are recorded and skipped; a missing root (for example a
//   disconnected drive) keeps its entries and is reported as unavailable.

const BATCH_SIZE = 400
const STAT_CONCURRENCY = 24
const WATCH_DEBOUNCE_MS = 400
const MAX_ERRORS = 50

export class Indexer extends EventEmitter {
  constructor(store, { dataDir }) {
    super()
    this.store = store
    this.dataDir = dataDir
    this.queue = []
    this.running = null
    this.paused = false
    this.resumeWaiters = []
    this.cancelled = new Set()
    this.watchers = new Map()
    this.pending = new Map()
    this.flushTimer = null
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

  /** Watches every root and queues a catch-up scan for changes made while the companion was off. */
  start() {
    for (const root of this.store.listRoots()) {
      this.watch(root)
      this.enqueue(root.id)
    }
  }

  enqueue(rootId) {
    if (this.running?.rootId === rootId || this.queue.some((job) => job.rootId === rootId)) return
    this.queue.push({ rootId })
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

  /** Stops any scan of the root and forgets it. Files on disk are never touched. */
  removeRoot(rootId) {
    this.queue = this.queue.filter((job) => job.rootId !== rootId)
    if (this.running?.rootId === rootId) this.cancelled.add(rootId)
    this.unwatch(rootId)
    this.store.removeRoot(rootId)
    this.emit('change')
  }

  async close() {
    this.closed = true
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
    const promise = this.scanRoot(job.rootId).catch((error) => this.recordError(null, error))
    this.running = { rootId: job.rootId, promise }
    await promise
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

  async scanRoot(rootId) {
    const root = this.store.getRoot(rootId)
    if (!root) return
    const started = Date.now()
    try {
      const info = await fs.promises.stat(root.path)
      if (!info.isDirectory()) throw Object.assign(new Error('Not a folder'), { code: 'ENOTDIR' })
    } catch (error) {
      // Keep what was indexed: a drive that is unplugged now may come back.
      this.store.finishRootScan(rootId, 'unavailable', friendlyError(error), Date.now() - started)
      this.unwatch(rootId)
      return
    }
    this.store.setRootStatus(rootId, 'indexing')
    this.watch(root)
    const generation = Date.now()
    this.progress = { rootId, root: root.path, scanned: 0, folder: root.path, startedAt: started }
    const completed = await this.walk(root, root.path, generation)
    if (!completed) {
      this.cancelled.delete(rootId)
      if (this.store.getRoot(rootId)) this.store.setRootStatus(rootId, 'pending')
      return
    }
    const removed = this.store.removeUnseen(rootId, generation)
    this.store.finishRootScan(rootId, 'ready', null, Date.now() - started)
    this.emit('scanned', { rootId, removed, ms: Date.now() - started })
  }

  /**
   * Indexes `start` (a folder inside the root) and everything below it.
   * Returns false when the scan was cancelled.
   */
  async walk(root, start, generation) {
    const startEntry = await this.describe(root, start, generation)
    let batch = startEntry ? [startEntry] : []
    const stack = [start]
    while (stack.length > 0) {
      const folder = stack.pop()
      if (this.cancelled.has(root.id) || this.closed) return false
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
      const children = names.filter((dirent) => !dirent.isSymbolicLink() && !(dirent.isDirectory() && isSkippedName(dirent.name)))
      for (let index = 0; index < children.length; index += STAT_CONCURRENCY) {
        const slice = children.slice(index, index + STAT_CONCURRENCY)
        const rows = await Promise.all(slice.map((dirent) => this.describe(root, path.join(folder, dirent.name), generation, dirent)))
        for (const row of rows) {
          if (!row) continue
          batch.push(row)
          if (row.is_dir) stack.push(row.path)
        }
        if (batch.length >= BATCH_SIZE) {
          this.store.writeEntries(batch)
          if (this.progress) this.progress.scanned += batch.length
          batch = []
          this.emit('change')
          // Let searches and API calls run between batches.
          await new Promise((resolve) => setImmediate(resolve))
        }
      }
    }
    this.store.writeEntries(batch)
    if (this.progress) this.progress.scanned += batch.length
    return true
  }

  /** Builds an index row for one path, or null for paths that must not be indexed. */
  async describe(root, target, generation, dirent) {
    if (isProtected(target, this.dataDir)) return null
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
    if (this.watchers.has(root.id) || this.closed) return
    let watcher
    try {
      watcher = fs.watch(root.path, { recursive: true, persistent: false }, (_event, filename) => {
        if (!filename) {
          // The notification buffer overflowed: changes were lost, so catch up with a scan.
          this.enqueue(root.id)
          return
        }
        this.pending.set(pathKey(path.join(root.path, filename.toString())), { rootId: root.id, target: path.join(root.path, filename.toString()) })
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
      this.store.setRootStatus(root.id, 'unavailable', friendlyError(error))
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
    for (const { rootId, target } of changes) {
      const root = this.store.getRoot(rootId)
      if (!root || isProtected(target, this.dataDir)) continue
      if (relativeParts(root.path, target).some(isSkippedName)) continue
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
        continue
      } else if (info.isDirectory()) {
        // A new or renamed folder may already contain files; index all of it.
        const generation = Date.now()
        if (await this.walk(root, target, generation)) this.store.removeUnseen(root.id, generation, pathKey(target))
      } else {
        const row = await this.describe(root, target, Date.now())
        if (row) this.store.writeEntries([row])
      }
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
      return 'Access denied by the system permissions.'
    case 'ENOENT':
      return 'The folder or drive is not available.'
    case 'ENOTDIR':
      return 'This path is not a folder.'
    case 'EBUSY':
      return 'The file is locked by another program.'
    default:
      return error?.message ?? 'Unknown error'
  }
}
