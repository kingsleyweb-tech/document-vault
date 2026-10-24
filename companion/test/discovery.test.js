// Finding the files of a library: what is shown while a library is walked,
// rescans that write only what changed, the folder tree's order and pages,
// and deeper work (reading text) waiting until discovery has finished.
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { startCompanion } from '../src/main.js'
import { openStore } from '../src/store.js'

const ORIGIN = 'http://localhost:5173'
const sandboxBase = path.join(import.meta.dirname, '..', '.test-sandbox')
fs.mkdirSync(sandboxBase, { recursive: true })
const sandbox = fs.mkdtempSync(path.join(sandboxBase, 'discovery-test-'))
const library = path.join(sandbox, 'Books')
const dataDir = path.join(sandbox, 'data')
const launcher = { open: async () => {}, openLink: async () => {}, reveal: async () => {}, pickFolder: async () => null }

let companion
let base
let token
let libraryId

async function json(method, route, body) {
  const response = await fetch(base + route, {
    method,
    headers: { Origin: ORIGIN, Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return { status: response.status, body: await response.json() }
}

async function waitFor(check, timeout = 20000) {
  const started = Date.now()
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() - started > timeout) throw new Error('Timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/** Waits until scans and change notifications have been handled. */
const settle = () => waitFor(() => companion.indexer.status().state === 'idle' && companion.indexer.queue.length === 0 && companion.indexer.pending.size === 0)

/** Scans the library again and waits for the scan to finish. */
async function rescan() {
  const since = Date.now()
  await json('POST', `/v1/roots/${libraryId}/rescan`, {})
  await waitFor(() => (companion.store.getRoot(libraryId).last_scan_at ?? 0) >= since && !companion.indexer.running)
  await settle()
}

function write(relative, content = 'x') {
  const target = path.join(library, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
  return target
}

/** Paths below the library, relative to it: as on disk, and as indexed. */
function onDisk() {
  const found = []
  ;(function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const target = path.join(folder, entry.name)
      found.push(path.relative(library, target))
      if (entry.isDirectory()) walk(target)
    }
  })(library)
  return found.sort()
}
const indexed = () =>
  companion.store.db.prepare('select path from entries where root_id = ? and path <> ?').all(libraryId, library).map((row) => path.relative(library, row.path)).sort()

before(async () => {
  for (let index = 0; index < 5; index++) write(`Cases/Case ${index}.pdf`, 'x'.repeat(index + 1))
  write('Cases/Appeals/Appeal.docx', 'appeal')
  write('Notes/Week 1.txt', 'notes')
  write('Notes/Old.txt', 'old')
  write('Paper', 'a file for now')
  // Different dates, sizes and types, for the folder tree's orders.
  write('Mixed/b.pdf', 'bb')
  write('Mixed/a.txt', 'a')
  write('Mixed/c.docx', 'cccc')
  fs.utimesSync(path.join(library, 'Mixed/a.txt'), new Date('2024-01-01'), new Date('2024-01-01'))
  fs.utimesSync(path.join(library, 'Mixed/b.pdf'), new Date('2025-01-01'), new Date('2025-01-01'))
  fs.utimesSync(path.join(library, 'Mixed/c.docx'), new Date('2023-01-01'), new Date('2023-01-01'))

  companion = await startCompanion({ dataDir, port: 0, launcher, log: () => {} })
  base = `http://127.0.0.1:${companion.port}`
  const code = companion.newPairingCode()
  const pair = await fetch(`${base}/v1/pair`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
  token = (await pair.json()).token
})

after(async () => {
  await companion?.close()
  fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

describe('adding a library', () => {
  it('shows what has been found so far as counts, never as a percentage', async () => {
    // Held at its first folder, so its progress can be read.
    let release
    const held = new Promise((resolve) => (release = resolve))
    const gate = companion.indexer.gate
    companion.indexer.gate = () => held
    const added = await json('POST', '/v1/roots', { path: library, name: 'Books', recursive: true, maxDepth: null })
    assert.equal(added.status, 200)
    libraryId = added.body.root.id
    const current = await waitFor(async () => (await json('GET', '/v1/status')).body.index.current)
    assert.equal(current.rootId, libraryId)
    assert.equal(current.phase, 'discovering')
    assert.equal(current.full, true)
    for (const field of ['folders', 'files', 'written', 'waiting', 'errors', 'elapsedMs', 'scanned']) assert.equal(typeof current[field], 'number', field)
    assert.ok(!Object.keys(current).some((field) => /percent|total/i.test(field)))

    companion.indexer.gate = gate
    release()
    await settle()
    assert.deepEqual(indexed(), onDisk())
    const status = (await json('GET', '/v1/status')).body
    assert.equal(status.index.current, null)
    assert.equal(status.roots.find((root) => root.id === libraryId).files, onDisk().filter((item) => fs.statSync(path.join(library, item)).isFile()).length)
  })

  it('reads the text of documents only after every file has been found', async () => {
    // Found by the rescan alone, not by change notifications.
    companion.indexer.unwatch(libraryId)
    let startedWhileWalking = 0
    const reading = new Set()
    const check = () => {
      for (const id of companion.extractor.active.keys()) {
        if (!reading.has(id) && companion.indexer.running) startedWhileWalking += 1
        reading.add(id)
      }
    }
    companion.extractor.on('change', check)
    for (let index = 0; index < 30; index++) write(`Reading/Document ${index}.txt`, `words of document ${index}`)
    await rescan()
    await companion.extractor.idle(30000)
    companion.extractor.off('change', check)
    companion.indexer.watch(companion.store.getRoot(libraryId))
    assert.equal(startedWhileWalking, 0)
    assert.ok(reading.size >= 30)
    assert.equal(companion.store.db.prepare("select count(*) as n from docs d join entries e on e.id = d.entry_id where e.name like 'Document %' and d.state = 'completed'").get().n, 30)
  })

  it('does not try a document that could not be read again until the file changes', async () => {
    const target = write('Reading/Broken.pdf', 'not really a pdf')
    const changed = 'still not a pdf, but changed'
    const doc = () => companion.store.db.prepare('select d.state, d.attempts, d.size from docs d join entries e on e.id = d.entry_id where e.path = ?').get(target)
    await rescan()
    await waitFor(() => doc()?.state === 'failed', 30000)
    const id = companion.store.entryByPath(target).id
    let readAgain = 0
    const check = () => (readAgain += companion.extractor.active.has(id) ? 1 : 0)
    companion.extractor.on('change', check)
    companion.extractor.queueRoot(libraryId)
    await new Promise((resolve) => setTimeout(resolve, 400))
    await companion.extractor.idle(30000)
    companion.extractor.off('change', check)
    assert.equal(readAgain, 0)
    assert.equal(doc().state, 'failed')

    fs.writeFileSync(target, changed)
    await rescan()
    await waitFor(() => doc()?.state === 'failed' && doc().size === changed.length, 30000)
  })
})

describe('change notifications', () => {
  it('ignores files the app opens itself, and catches up after lost notifications at most once per gap while it reads', async () => {
    await settle()
    const target = path.join(library, 'Cases/Case 2.pdf')
    companion.indexer.noteRead(target)
    // Reading a file not opened for an hour changes its last-access time, which Windows reports.
    fs.utimesSync(target, new Date(Date.now() - 3 * 3600_000), fs.statSync(target).mtime)
    fs.readFileSync(target)
    await new Promise((resolve) => setTimeout(resolve, 600))
    assert.equal(companion.indexer.pending.has(companion.store.entryByPath(target).path_key), false)

    const enqueue = companion.indexer.enqueue
    let scans = 0
    companion.indexer.enqueue = (...args) => {
      scans += 1
      return enqueue.apply(companion.indexer, args)
    }
    const gap = companion.indexer.overflowGapMs
    companion.indexer.overflowGapMs = 4000
    try {
      // The first catch-up is not delayed by the app's own reading.
      companion.indexer.noteRead(target)
      companion.indexer.overflowed(libraryId)
      await waitFor(() => scans === 1, 5000)
      await settle()
      // Lost again while still reading: the next one waits for the gap.
      companion.indexer.noteRead(target)
      companion.indexer.overflowed(libraryId)
      for (let index = 0; index < 4; index++) {
        companion.indexer.noteRead(target)
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      assert.equal(scans, 1)
      await waitFor(() => scans === 2, 10000)
    } finally {
      companion.indexer.enqueue = enqueue
      companion.indexer.overflowGapMs = gap
    }
    await settle()
  })

  it('writes nothing when a file is only opened or read', async () => {
    await settle()
    const target = path.join(library, 'Cases/Case 1.pdf')
    const write = companion.store.writeEntries
    let written = 0
    companion.store.writeEntries = (rows) => {
      written += rows.length
      return write.call(companion.store, rows)
    }
    try {
      // Only the last-access time changes, as when a file is read.
      fs.utimesSync(target, new Date(), fs.statSync(target).mtime)
      companion.indexer.pending.set(companion.store.entryByPath(target).path_key, { rootId: libraryId, target })
      await companion.indexer.flushChanges()
      await settle()
    } finally {
      companion.store.writeEntries = write
    }
    assert.equal(written, 0)
  })
})

describe('rescanning', () => {
  it('writes nothing when nothing has changed', async () => {
    await settle()
    const apply = companion.store.applyEntries
    let written = 0
    companion.store.applyEntries = (rows, removals, renamed) => {
      written += rows.length + removals.length
      return apply.call(companion.store, rows, removals, renamed)
    }
    try {
      await rescan()
    } finally {
      companion.store.applyEntries = apply
    }
    assert.equal(written, 0)
    assert.deepEqual(indexed(), onDisk())
  })

  it('finds added, deleted, changed and renamed files and folders', async () => {
    // Change notifications are turned off so the rescan alone must find everything.
    companion.indexer.unwatch(libraryId)
    write('Cases/New case.pdf', 'new')
    fs.rmSync(path.join(library, 'Notes/Old.txt'))
    fs.writeFileSync(path.join(library, 'Cases/Case 0.pdf'), 'longer than before')
    fs.renameSync(path.join(library, 'Cases/Appeals'), path.join(library, 'Cases/Appeals heard'))
    fs.renameSync(path.join(library, 'Notes/Week 1.txt'), path.join(library, 'Notes/WEEK 1.txt'))
    await rescan()

    assert.deepEqual(indexed(), onDisk())
    const entry = (relative) => companion.store.entryByPath(path.join(library, relative))
    assert.equal(entry('Cases/Case 0.pdf').size, 'longer than before'.length)
    assert.equal(entry('Notes/WEEK 1.txt').name, 'WEEK 1.txt')
    assert.equal(entry('Cases/Appeals heard/Appeal.docx').parent_key, entry('Cases/Appeals heard').path_key)
    const found = (await json('GET', `/v1/search?q=${encodeURIComponent('Appeals heard')}`)).body.items.map((item) => item.name)
    assert.ok(found.includes('Appeal.docx'))
  })

  it('scans again when asked while a scan is already past the folder that changed', async () => {
    companion.indexer.unwatch(libraryId)
    // The first scan is held after it has listed the library's top folder.
    let release
    const held = new Promise((resolve) => (release = resolve))
    const gate = companion.indexer.gate
    let folders = 0
    companion.indexer.gate = () => (++folders === 2 ? held : Promise.resolve())
    await json('POST', `/v1/roots/${libraryId}/rescan`, {})
    await waitFor(() => folders >= 2)
    write('Late arrival.txt', 'added after the top folder was listed')
    const since = Date.now()
    await json('POST', `/v1/roots/${libraryId}/rescan`, {})
    companion.indexer.gate = gate
    release()
    await waitFor(() => (companion.store.getRoot(libraryId).last_scan_at ?? 0) >= since && !companion.indexer.running && companion.indexer.queue.length === 0)
    await settle()
    assert.ok(companion.store.entryByPath(path.join(library, 'Late arrival.txt')))
    assert.deepEqual(indexed(), onDisk())
  })

  it('drops what was inside a folder that became a file, and the other way round', async () => {
    fs.rmSync(path.join(library, 'Notes'), { recursive: true })
    write('Notes', 'now a file')
    fs.rmSync(path.join(library, 'Paper'))
    write('Paper/Inside.txt', 'now a folder')
    await rescan()
    assert.deepEqual(indexed(), onDisk())
    assert.equal(companion.store.entryByPath(path.join(library, 'Notes')).is_dir, 0)
    assert.equal(companion.store.entryByPath(path.join(library, 'Paper')).is_dir, 1)
    companion.indexer.watch(companion.store.getRoot(libraryId))
  })
})

describe('the folder tree', () => {
  const mixed = async (query = '') => {
    const top = (await json('GET', `/v1/roots/${libraryId}/tree`)).body
    const folder = top.folders.find((item) => item.name === 'Mixed')
    return (await json('GET', `/v1/roots/${libraryId}/tree?parent=${folder.id}${query}`)).body
  }

  it('orders a folder by name, type, date modified or size', async () => {
    assert.deepEqual((await mixed()).files.map((file) => file.name), ['a.txt', 'b.pdf', 'c.docx'])
    assert.deepEqual((await mixed('&sort=modified')).files.map((file) => file.name), ['b.pdf', 'a.txt', 'c.docx'])
    assert.deepEqual((await mixed('&sort=size')).files.map((file) => file.name), ['c.docx', 'b.pdf', 'a.txt'])
    // Grouped by kind: pdf, text, word.
    assert.deepEqual((await mixed('&sort=type')).files.map((file) => file.name), ['b.pdf', 'a.txt', 'c.docx'])
    assert.equal((await mixed('&sort=nonsense')).sort, 'name')
  })

  it('lists a folder a page at a time and says when more follow', async () => {
    const first = await mixed('&limit=2')
    assert.deepEqual(first.files.map((file) => file.name), ['a.txt', 'b.pdf'])
    assert.equal(first.moreFiles, true)
    const second = await mixed('&limit=2&offset=2')
    assert.deepEqual(second.files.map((file) => file.name), ['c.docx'])
    assert.equal(second.moreFiles, false)
  })

  it('counts the files below each folder', async () => {
    const cases = (await json('GET', `/v1/roots/${libraryId}/tree`)).body.folders.find((item) => item.name === 'Cases')
    assert.equal(cases.files, 7)
  })
})

describe('the index', () => {
  it('reports the space it takes and can be compacted, keeping everything indexed', async () => {
    await settle()
    await companion.extractor.idle(30000)
    await companion.hasher.idle(30000)
    const before = indexed()
    const { storage } = (await json('GET', '/v1/status')).body
    assert.ok(storage.indexBytes > 0)
    const compacted = await json('POST', '/v1/storage/compact', {})
    assert.equal(compacted.status, 200)
    assert.ok(compacted.body.after > 0)
    assert.deepEqual(indexed(), before)
  })

  it('counts from indexes rather than reading every row', () => {
    const store = openStore(':memory:')
    const names = store.db.prepare("select name from sqlite_master where type = 'index'").all().map((row) => row.name)
    store.close()
    assert.ok(names.includes('entries_root_dir'))
    assert.ok(names.includes('entries_key_dir'))
    assert.ok(names.includes('docs_scans'))
    assert.ok(!names.includes('entries_root_gen'))
  })
})
