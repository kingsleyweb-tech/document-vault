// End-to-end tests of finding duplicate books: identical files across
// libraries (including formats whose text is not read, and libraries with
// text reading off), the same text saved as different files, dismissing a
// group, search showing copies once, and revoking, excluding and changing
// files. Files are only ever read: the test checks that none was changed.
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { startCompanion } from '../src/main.js'
import { makePdf } from './helpers/fixtures.js'

const ORIGIN = 'http://localhost:5173'
const sandboxBase = path.join(import.meta.dirname, '..', '.test-sandbox')
fs.mkdirSync(sandboxBase, { recursive: true })
const sandbox = fs.mkdtempSync(path.join(sandboxBase, 'dup-'))
const home = path.join(sandbox, 'home')
const dataDir = path.join(sandbox, 'data')
const launcher = { open: async () => {}, openLink: async () => {}, reveal: async () => {}, pickFolder: async () => null }

// Twelve pages of about a hundred characters: enough text to be compared.
const PAGES = Array.from({ length: 12 }, (_, index) =>
  `Page ${index + 1} of the treatise on the formation of contracts, offer and acceptance, consideration and intention.`)
const BOOK = makePdf(PAGES, { Title: 'Contract Law' })
// The same words, saved again with a different title: different bytes.
const RESAVED = makePdf(PAGES, { Title: 'Contract Law (second copy)', Author: 'Library' })
const bytes = (size, seed) => Buffer.from(Array.from({ length: size }, (_, index) => (index * 31 + seed) % 251))

function write(relative, content) {
  const target = path.join(home, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
  return target
}

function snapshot() {
  const files = {}
  for (const name of fs.readdirSync(home, { recursive: true })) {
    const target = path.join(home, name)
    const info = fs.statSync(target)
    if (info.isFile()) files[name] = `${info.size}:${info.mtimeMs}:${fs.readFileSync(target).toString('base64').length}`
  }
  return files
}

async function waitFor(check, timeout = 30000) {
  const started = Date.now()
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() - started > timeout) throw new Error('Timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

let companion
let token
let base
const ids = {}

async function call(method, route, body) {
  const response = await fetch(base + route, {
    method,
    headers: { Origin: ORIGIN, Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return { status: response.status, body: await response.json() }
}

async function settle() {
  await waitFor(() => companion.indexer.status().state === 'idle' && companion.indexer.queue.length === 0)
  await companion.extractor.idle(30000)
  await companion.hasher.idle(30000)
}

const groups = async (kind, extra = '') => (await call('GET', `/v1/duplicates?kind=${kind}${extra}`)).body.groups
const names = (group) => group.copies.map((copy) => `${copy.libraryName}/${copy.name}`).sort()
const find = (list, name) => list.find((group) => group.copies.some((copy) => copy.name === name))

async function rescan(id) {
  await call('POST', `/v1/roots/${id}/rescan`)
  await new Promise((resolve) => setTimeout(resolve, 300))
  await settle()
}

let before_

before(async () => {
  write('Law/Contracts/Contract Law.pdf', BOOK)
  write('Downloads/Contract Law (1).pdf', BOOK)
  write('Downloads/Contract Law resaved.pdf', RESAVED)
  // Word 97 files: their text is not read, so only their bytes can be compared.
  write('Law/Old/Statutes.doc', bytes(5003, 7))
  write('Downloads/Statutes copy.doc', bytes(5003, 7))
  write('Law/Unique.doc', bytes(7777, 3))
  // The same short note twice, typed differently: too little text to compare.
  write('Law/Note.txt', 'Short note about the case.')
  write('Downloads/Note.txt', 'short NOTE about the case!!')
  // A library whose text is not read.
  write('Archive/Box/Brief.pdf', bytes(6101, 5))
  write('Archive/Box/Brief copy.pdf', bytes(6101, 5))
  before_ = snapshot()

  companion = await startCompanion({ dataDir, port: 0, launcher, log: () => {} })
  base = `http://127.0.0.1:${companion.port}`
  const code = companion.newPairingCode()
  token = (await (await fetch(base + '/v1/pair', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ code, label: 'test' }) })).json()).token
  ids.law = (await call('POST', '/v1/roots', { path: path.join(home, 'Law'), name: 'Law' })).body.root.id
  ids.downloads = (await call('POST', '/v1/roots', { path: path.join(home, 'Downloads'), name: 'Downloads' })).body.root.id
  ids.archive = (await call('POST', '/v1/roots', { path: path.join(home, 'Archive'), name: 'Archive', extractText: false })).body.root.id
  await settle()
})

after(async () => {
  await companion?.close()
  fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

describe('duplicate books', () => {
  it('lists identical files across libraries, with the space the extra copies use', async () => {
    const exact = await groups('exact')
    const book = find(exact, 'Contract Law.pdf')
    assert.deepEqual(names(book), ['Downloads/Contract Law (1).pdf', 'Law/Contract Law.pdf'])
    assert.equal(book.extraBytes, BOOK.length)
    assert.equal(book.key.length, 64)
    assert.equal(book.copies.find((copy) => copy.libraryName === 'Law').folder, path.join(home, 'Law', 'Contracts'))
    // The resaved copy has different bytes, so it is not in this group.
    assert.equal(find(exact, 'Contract Law resaved.pdf'), undefined)
    // Largest waste first.
    assert.deepEqual(exact.map((group) => group.extraBytes), [...exact.map((group) => group.extraBytes)].sort((a, b) => b - a))
  })

  it('compares files whose text is not read, and only reads files that share a size with another', async () => {
    const statutes = find(await groups('exact'), 'Statutes.doc')
    assert.deepEqual(names(statutes), ['Downloads/Statutes copy.doc', 'Law/Statutes.doc'])
    const unique = companion.store.db.prepare(`select h.* from file_hashes h join entries e on e.id = h.entry_id where e.name = 'Unique.doc'`).get()
    assert.equal(unique, undefined)
    // Two .doc files and two PDFs in the library whose text is not read; nothing else.
    assert.equal(companion.hasher.reads, 4)
  })

  it('finds identical files in a library whose text is not read', async () => {
    const brief = find(await groups('exact'), 'Brief.pdf')
    assert.deepEqual(names(brief), ['Archive/Brief copy.pdf', 'Archive/Brief.pdf'])
  })

  it('lists the same text saved as different files separately from identical files', async () => {
    const text = await groups('text')
    assert.equal(text.length, 1)
    assert.deepEqual(names(text[0]), ['Downloads/Contract Law (1).pdf', 'Downloads/Contract Law resaved.pdf', 'Law/Contract Law.pdf'])
    assert.equal(text[0].kind, 'text')
    // Short notes are never compared by their text.
    assert.equal(find(text, 'Note.txt'), undefined)
  })

  it('filters by library without splitting groups', async () => {
    const archive = await groups('exact', `&library=${ids.archive}`)
    assert.deepEqual(archive.map((group) => names(group)), [['Archive/Brief copy.pdf', 'Archive/Brief.pdf']])
    const downloads = await groups('exact', `&library=${ids.downloads}`)
    assert.equal(downloads.length, 2)
    assert.ok(downloads.every((group) => group.copies.some((copy) => copy.libraryName === 'Law')))
    assert.equal((await call('GET', '/v1/duplicates?kind=nearby')).status, 400)
  })

  it('summarises the duplicates', async () => {
    const summary = (await call('GET', '/v1/duplicates/summary')).body
    assert.equal(summary.exact.groups, 3)
    assert.equal(summary.exact.extraCopies, 3)
    assert.equal(summary.exact.extraBytes, BOOK.length + 5003 + 6101)
    assert.equal(summary.text.groups, 1)
    assert.equal(summary.checking.pending, 0)
  })

  it('shows identical copies once in search, and all of them when asked', async () => {
    const once = (await call('GET', '/v1/search?q=consideration&mode=fulltext')).body
    assert.equal(once.total, 2)
    const book = once.items.find((item) => item.copies.length > 0)
    assert.equal(book.copies.length, 1)
    assert.match(book.copies[0].name, /^Contract Law( \(1\))?\.pdf$/)
    assert.ok(['Law', 'Downloads'].includes(book.copies[0].libraryName))
    const all = (await call('GET', '/v1/search?q=consideration&mode=fulltext&copies=all')).body
    assert.equal(all.total, 3)
    assert.ok(all.items.every((item) => item.copies.length === 0))
  })

  it('hides a dismissed group until its copies change', async () => {
    const statutes = find(await groups('exact'), 'Statutes.doc')
    assert.equal((await call('POST', '/v1/duplicates/dismiss', { kind: 'exact', key: statutes.key })).status, 200)
    assert.equal(find(await groups('exact'), 'Statutes.doc'), undefined)
    assert.ok(find(await groups('exact', '&dismissed=1'), 'Statutes.doc').dismissedAt)
    assert.equal((await call('GET', '/v1/duplicates/summary')).body.exact.groups, 2)

    // A third copy appears: the group is shown again.
    write('Law/Again/Statutes.doc', bytes(5003, 7))
    await rescan(ids.law)
    assert.equal(find(await groups('exact'), 'Statutes.doc').copies.length, 3)

    // Restoring forgets the dismissal.
    await call('POST', '/v1/duplicates/dismiss', { kind: 'exact', key: statutes.key })
    assert.equal(find(await groups('exact'), 'Statutes.doc'), undefined)
    await call('POST', '/v1/duplicates/dismiss', { kind: 'exact', key: statutes.key, dismissed: false })
    assert.ok(find(await groups('exact'), 'Statutes.doc'))
    assert.equal((await call('POST', '/v1/duplicates/dismiss', { kind: 'exact', key: 'f'.repeat(64) })).status, 404)
    assert.equal((await call('POST', '/v1/duplicates/dismiss', { kind: 'exact', key: '../etc' })).status, 400)
  })

  it('checks a changed file again', async () => {
    const target = path.join(home, 'Archive/Box/Brief copy.pdf')
    fs.writeFileSync(target, bytes(6101, 9))
    const later = new Date(Date.now() + 5000)
    fs.utimesSync(target, later, later)
    await rescan(ids.archive)
    assert.equal(find(await groups('exact'), 'Brief.pdf'), undefined)
    fs.writeFileSync(target, bytes(6101, 5))
    const latest = new Date(Date.now() + 10000)
    fs.utimesSync(target, latest, latest)
    await rescan(ids.archive)
    assert.ok(find(await groups('exact'), 'Brief.pdf'))
  })

  it('leaves out excluded folders and revoked libraries everywhere', async () => {
    await call('POST', `/v1/roots/${ids.archive}/exclusions`, { path: path.join(home, 'Archive', 'Box') })
    await settle()
    assert.equal(find(await groups('exact'), 'Brief.pdf'), undefined)

    await call('POST', `/v1/roots/${ids.downloads}/revoke`)
    const exact = await groups('exact')
    assert.equal(find(exact, 'Contract Law.pdf'), undefined)
    assert.ok(exact.every((group) => group.copies.every((copy) => copy.libraryName !== 'Downloads')))
    assert.deepEqual(await groups('text'), [])
    assert.equal((await call('GET', `/v1/duplicates?kind=exact&library=${ids.downloads}`)).status, 403)
    const search = (await call('GET', '/v1/search?q=consideration&mode=fulltext')).body
    assert.ok(search.items.every((item) => item.copies.every((copy) => copy.libraryName !== 'Downloads')))
  })

  it('never changes a file', () => {
    const now = snapshot()
    // Only the files this test itself wrote differ.
    delete now['Law\\Again\\Statutes.doc']
    delete now['Law/Again/Statutes.doc']
    const original = { ...before_ }
    for (const name of Object.keys(original)) if (name.includes('Brief copy')) delete original[name]
    for (const name of Object.keys(now)) if (name.includes('Brief copy')) delete now[name]
    assert.deepEqual(now, original)
  })
})
