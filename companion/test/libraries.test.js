// End-to-end tests of libraries: reading the text inside documents, ranking,
// links between web pages and books, exclusions, revoking access, and the
// retrieval function a future assistant must use. A real HTTP server, a real
// SQLite index and real documents (generated, see helpers/fixtures.js) in a
// temporary folder; only the launcher is replaced by a recorder.
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { startCompanion } from '../src/main.js'
import { openStore } from '../src/store.js'
import { SCHEMA_VERSION } from '../src/migrations.js'
import { retrieveEvidence, revisitEvidence } from '../src/evidence.js'
import { makeDocx, makeEpub, makePdf, makePptx } from './helpers/fixtures.js'

const ORIGIN = 'http://localhost:5173'
const sandboxBase = path.join(import.meta.dirname, '..', '.test-sandbox')
fs.mkdirSync(sandboxBase, { recursive: true })
const sandbox = fs.mkdtempSync(path.join(sandboxBase, 'lib-'))
const home = path.join(sandbox, 'home')
const law = path.join(home, 'Law')
const other = path.join(home, 'Other')
const outside = path.join(home, 'Outside')
const dataDir = path.join(sandbox, 'data')

const CATALOG = `<!doctype html><html><head><title>Law catalogue</title>
<script>var hidden = "scriptword"; fetch("https://example.com/beacon")</script>
<style>.x { color: red }</style></head><body>
<h1>Catalogue of books</h1>
<a href="../Contracts/Contract%20Law%20Handbook.pdf">Contract Law Handbook</a>
<a href="../Torts/Negligence.docx">Negligence</a>
<a href="../Missing/Gone.pdf">A book that was deleted</a>
<a href="../../Outside/Secret.pdf">Somewhere else</a>
<a href="../Private/Client%20file.pdf">Client file</a>
<a href="https://example.com/statutes">Statutes online</a>
<a href="javascript:alert(1)">Run</a>
<img src="https://example.com/tracker.png" onerror="alert(2)">
</body></html>`

const calls = []
let nextPick = null
const launcher = {
  open: async (target) => void calls.push(['open', target]),
  openLink: async (url) => void calls.push(['openLink', url]),
  reveal: async (target) => void calls.push(['reveal', target]),
  pickFolder: async (options) => {
    calls.push(['pick', options?.defaultPath ?? null])
    return nextPick
  },
}

let companion
let base
let token
let lawId
let otherId

function request(method, route, { body, auth = true } = {}) {
  return fetch(base + route, {
    method,
    headers: {
      Origin: ORIGIN,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(auth ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

async function json(method, route, options) {
  const response = await request(method, route, options)
  return { status: response.status, body: await response.json() }
}

const search = async (q, extra = '') => (await json('GET', `/v1/search?q=${encodeURIComponent(q)}${extra}`)).body
const fulltext = (q, extra = '') => search(q, `&mode=fulltext${extra}`)
const names = async (q, extra = '') => (await search(q, extra)).items.map((item) => item.name)

async function waitFor(check, timeout = 20000) {
  const started = Date.now()
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() - started > timeout) throw new Error('Timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

/** Waits until indexing and text reading have both finished. */
async function settle() {
  await waitFor(async () => (await json('GET', '/v1/status')).body.index.state === 'idle' && companion.indexer.queue.length === 0)
  await companion.extractor.idle(30000)
}

const entryNamed = (name) => companion.store.db.prepare('select * from entries where name = ?').get(name)

function write(relative, content) {
  const target = path.join(home, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
  return target
}

before(async () => {
  write('Law/Contracts/Contract Law Handbook.pdf', makePdf(
    ['Introduction to contracts', 'Offer and acceptance are required for a binding agreement', '', 'Consideration and the estoppel doctrine'],
    { Title: 'Handbook of Contract Law', Author: 'Jane Ade' },
  ))
  write('Law/Contracts/Offer and acceptance.txt', 'Short notes.')
  write('Law/Torts/Negligence.docx', await makeDocx(['The duty of care in negligence', 'Donoghue v Stevenson'], { title: 'Law of Torts', creator: 'A. Mensah' }))
  write('Law/Evidence/Evidence Act.epub', await makeEpub([{ title: 'Part 1', text: 'Hearsay is generally inadmissible' }, { title: 'Part 2', text: 'Confessions' }], { title: 'Evidence Act' }))
  write('Law/Catalog/index.htm', CATALOG)
  write('Law/Lectures/Remedies.pptx', await makePptx(['Remedies overview', 'Specific performance and restitution']))
  write('Law/Lectures/Old notes.rtf', String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}}\f0\fs24 Quantum meruit claims\par}`)
  write('Law/Private/Client file.pdf', makePdf(['Privileged client matter zebracode']))
  write('Law/Copies/Copy A.txt', 'duplicate text sample')
  write('Law/Copies/Copy B.txt', 'duplicate text sample')
  write('Law/Broken/Damaged.pdf', '%PDF-1.4 this is not really a PDF')
  write('Law/Shortcuts/Network.url', '[InternetShortcut]\r\nURL=file://fileserver/share/doc.pdf\r\n')
  write('Law/Shortcuts/Elsewhere.url', `[InternetShortcut]\r\nURL=file:///${path.join(outside, 'Secret.pdf').replace(/\\/g, '/')}\r\n`)
  write('Outside/Secret.pdf', makePdf(['outside secret moonstone']))
  write('Other/Unrelated.txt', 'harmless words')
  write('Other/Deep/Deeper/Nested note.txt', 'nested words')
  // A junction (a folder link) inside the library that leads outside it.
  fs.symlinkSync(outside, path.join(law, 'Escape'), 'junction')

  companion = await startCompanion({ dataDir, port: 0, launcher, log: () => {} })
  base = `http://127.0.0.1:${companion.port}`
  const code = companion.newPairingCode()
  token = (await json('POST', '/v1/pair', { body: { code, label: 'test' }, auth: false })).body.token
  const added = await json('POST', '/v1/roots', { body: { path: law, name: 'Law Books' } })
  assert.equal(added.status, 200)
  lawId = added.body.root.id
  otherId = (await json('POST', '/v1/roots', { body: { path: other } })).body.root.id
  await settle()
})

after(async () => {
  await companion?.close()
  // Windows can hold a closed folder watcher's handle for a moment.
  fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

describe('reading the text inside documents', () => {
  it('finds words inside a PDF with the page they are on', async () => {
    const result = await fulltext('estoppel')
    assert.deepEqual(result.items.map((item) => item.name), ['Contract Law Handbook.pdf'])
    const [hit] = result.items
    assert.equal(hit.excerpt.page, 4)
    assert.match(hit.excerpt.text, /<<estoppel>>/)
  })

  it('matches other forms of a word', async () => {
    assert.ok((await names('contract', '&mode=fulltext')).includes('Contract Law Handbook.pdf'))
  })

  it('records pages without text, as in a scan', async () => {
    const entry = (await json('GET', `/v1/entries/${entryNamed('Contract Law Handbook.pdf').id}`)).body
    assert.equal(entry.text.state, 'completed')
    assert.equal(entry.text.pages, 4)
    assert.equal(entry.text.textPages, 3)
    assert.equal(entry.text.needsOcr, true)
    assert.equal(entry.meta.author.value, 'Jane Ade')
    assert.equal(entry.meta.author.source, 'original')
  })

  it('reads Word documents, EPUB books and web pages', async () => {
    assert.deepEqual(await names('Donoghue', '&mode=fulltext'), ['Negligence.docx'])
    const [book] = (await fulltext('hearsay')).items
    assert.equal(book.name, 'Evidence Act.epub')
    assert.equal(book.excerpt.page, null)
    assert.equal(book.excerpt.section, 1)
    assert.deepEqual(await names('catalogue', '&mode=fulltext'), ['index.htm'])
  })

  it('reads PowerPoint slides in deck order, and RTF text without its formatting codes', async () => {
    const [deck] = (await fulltext('restitution')).items
    assert.equal(deck.name, 'Remedies.pptx')
    assert.equal(deck.excerpt.page, 2)
    assert.deepEqual(await names('meruit', '&mode=fulltext'), ['Old notes.rtf'])
    assert.equal((await fulltext('fonttbl')).items.length, 0)
  })

  it('never indexes the scripts or styles of a web page', async () => {
    assert.equal((await fulltext('scriptword')).items.length, 0)
    assert.equal((await fulltext('beacon')).items.length, 0)
    assert.equal((await fulltext('color')).items.length, 0)
  })

  it('lists every matching passage of a document in reading order', async () => {
    const id = entryNamed('Contract Law Handbook.pdf').id
    const { matches } = (await json('GET', `/v1/entries/${id}/matches?q=${encodeURIComponent('agreement OR estoppel')}`)).body
    assert.deepEqual(matches.map((match) => match.page), [2, 4])
  })

  it('records a damaged PDF as failed, with a reason', async () => {
    const { items } = (await json('GET', `/v1/roots/${lawId}/health?section=failed`)).body
    const damaged = items.find((item) => item.name === 'Damaged.pdf')
    assert.ok(damaged)
    assert.match(damaged.detail, /damaged|could not be read/)
  })

  it('does not read unchanged files again, and reads changed ones', async () => {
    const id = entryNamed('Offer and acceptance.txt').id
    const before = companion.store.db.prepare('select extracted_at from docs where entry_id = ?').get(id).extracted_at
    await json('POST', `/v1/roots/${lawId}/rescan`, { body: {} })
    await settle()
    assert.equal(companion.store.db.prepare('select extracted_at from docs where entry_id = ?').get(id).extracted_at, before)

    const file = path.join(law, 'Contracts', 'Offer and acceptance.txt')
    fs.writeFileSync(file, 'Revised wording about rescission')
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000))
    await json('POST', `/v1/roots/${lawId}/rescan`, { body: {} })
    await settle()
    assert.deepEqual(await names('rescission', '&mode=fulltext'), ['Offer and acceptance.txt'])
  })
})

describe('ranking', () => {
  it('an exact title ranks first', async () => {
    const [first] = (await search('Handbook of Contract Law', '&mode=documents')).items
    assert.equal(first.name, 'Contract Law Handbook.pdf')
    assert.equal(first.match, 'title')
  })

  it('an exact file name ranks above the same words inside a book', async () => {
    const items = (await search('offer and acceptance', '&mode=all')).items
    assert.equal(items[0].name, 'Offer and acceptance.txt')
    assert.equal(items[0].match, 'filename')
    const book = items.find((item) => item.name === 'Contract Law Handbook.pdf')
    assert.equal(book.match, 'phrase')
    assert.equal(book.excerpt.page, 2)
  })

  it('filters by author', async () => {
    assert.deepEqual(await names('negligence', '&mode=all&author=Mensah'), ['Negligence.docx'])
    assert.deepEqual(await names('negligence', '&mode=all&author=Nobody'), [])
  })

  it('a corrected title is searchable and is never overwritten by the file', async () => {
    const id = entryNamed('Negligence.docx').id
    const changed = await json('PATCH', `/v1/entries/${id}/metadata`, { body: { title: 'Torts Casebook' } })
    assert.equal(changed.status, 200)
    assert.deepEqual(changed.body.meta.title, { value: 'Torts Casebook', source: 'user' })
    const [first] = (await search('Torts Casebook', '&mode=documents')).items
    assert.equal(first.name, 'Negligence.docx')
    assert.equal(first.match, 'title')
    await json('POST', `/v1/entries/${id}/extract`, { body: {} })
    await settle()
    assert.equal((await json('GET', `/v1/entries/${id}`)).body.meta.title.value, 'Torts Casebook')
  })
})

describe('links from web pages to books', () => {
  it('classifies each link of a catalogue page', async () => {
    const id = entryNamed('index.htm').id
    const { role, items } = (await json('GET', `/v1/entries/${id}/links`)).body
    assert.equal(role, 'catalog')
    const status = Object.fromEntries(items.map((link) => [link.label, link.status]))
    assert.deepEqual(status, {
      'Contract Law Handbook': 'verified',
      Negligence: 'verified',
      'A book that was deleted': 'broken',
      'Somewhere else': 'outside',
      'Client file': 'verified',
      'Statutes online': 'external',
    })
    // javascript: links are dropped; images are not links and nothing is fetched.
    assert.ok(!items.some((link) => /javascript|tracker/.test(link.href)))
  })

  it('shows which pages refer to a book', async () => {
    const id = entryNamed('Contract Law Handbook.pdf').id
    const { items } = (await json('GET', `/v1/entries/${id}/references`)).body
    assert.deepEqual(items.map((item) => item.name), ['index.htm'])
    const [hit] = (await fulltext('estoppel')).items
    assert.deepEqual(hit.referencedBy, { count: 1, example: 'index.htm' })
  })
})

describe('library health', () => {
  it('reports what needs attention, without changing anything', async () => {
    const { summary } = (await json('GET', `/v1/roots/${lawId}/health`)).body
    assert.ok(summary.needsOcr >= 1)
    assert.equal(summary.duplicateGroups, 1)
    assert.equal(summary.links.broken, 1)
    assert.equal(summary.links.outside, 1)
    assert.equal(summary.catalogs, 1)
    assert.ok(summary.text.failed >= 1)
    assert.equal(summary.skipped.link, 1)
    const { items } = (await json('GET', `/v1/roots/${lawId}/health?section=duplicates`)).body
    assert.deepEqual(items[0].copies.map((copy) => copy.name), ['Copy A.txt', 'Copy B.txt'])
    assert.ok(fs.existsSync(path.join(law, 'Copies', 'Copy B.txt')))
  })
})

describe('links and shortcuts cannot leave a library', () => {
  it('does not follow a junction that leads outside the library', async () => {
    assert.deepEqual(await names('Secret'), [])
    assert.equal((await fulltext('moonstone')).items.length, 0)
    const { items } = (await json('GET', `/v1/roots/${lawId}/health?section=skipped`)).body
    assert.ok(items.some((item) => item.name === 'Escape' && item.reason === 'link'))
  })

  it('never opens a network location from a shortcut', async () => {
    calls.length = 0
    const opened = await json('POST', `/v1/entries/${entryNamed('Network.url').id}/open`, { body: {} })
    assert.notEqual(opened.status, 200)
    assert.deepEqual(calls, [])
  })

  it('never opens a file outside the libraries from a shortcut', async () => {
    calls.length = 0
    const opened = await json('POST', `/v1/entries/${entryNamed('Elsewhere.url').id}/open`, { body: {} })
    assert.equal(opened.status, 403)
    assert.deepEqual(calls, [])
  })

  it('accepts only numeric ids, never paths', async () => {
    assert.equal((await json('GET', '/v1/entries/abc')).status, 404)
    assert.equal((await json('GET', `/v1/entries/${encodeURIComponent('../../Outside/Secret.pdf')}`)).status, 404)
    const folder = entryNamed('Deep')
    assert.equal((await json('GET', `/v1/roots/${lawId}/tree?parent=${folder.id}`)).status, 400)
  })
})

describe('excluding folders', () => {
  it('removes an excluded folder from search at once, and restores it when included again', async () => {
    assert.deepEqual(await names('zebracode', '&mode=fulltext'), ['Client file.pdf'])
    const folder = entryNamed('Private')
    const fileId = entryNamed('Client file.pdf').id
    const excluded = await json('POST', `/v1/roots/${lawId}/exclusions`, { body: { entryId: folder.id } })
    assert.equal(excluded.status, 200)
    assert.equal(excluded.body.root.exclusions.length, 1)

    assert.deepEqual(await names('Client file'), [])
    assert.deepEqual(await names('zebracode', '&mode=fulltext'), [])
    assert.equal((await json('GET', `/v1/entries/${fileId}`)).status, 404)
    assert.deepEqual(retrieveEvidence(companion.store.db, companion.access, { query: 'zebracode' }), [])
    const catalog = (await json('GET', `/v1/entries/${entryNamed('index.htm').id}/links`)).body.items
    assert.equal(catalog.find((link) => link.label === 'Client file').status, 'outside')

    // A full rescan does not bring it back.
    await json('POST', `/v1/roots/${lawId}/rescan`, { body: {} })
    await settle()
    assert.deepEqual(await names('zebracode', '&mode=fulltext'), [])
    assert.ok(fs.existsSync(path.join(law, 'Private', 'Client file.pdf')))

    const removed = await json('DELETE', `/v1/roots/${lawId}/exclusions/${excluded.body.root.exclusions[0].id}`)
    assert.equal(removed.status, 200)
    await settle()
    assert.deepEqual(await names('zebracode', '&mode=fulltext'), ['Client file.pdf'])
    const again = (await json('GET', `/v1/entries/${entryNamed('index.htm').id}/links`)).body.items
    assert.equal(again.find((link) => link.label === 'Client file').status, 'verified')
  })

  it('only excludes folders inside the library', async () => {
    for (const target of [other, path.join(law, '..', 'Outside'), law]) {
      assert.equal((await json('POST', `/v1/roots/${lawId}/exclusions`, { body: { path: target } })).status, 400)
    }
    assert.equal((await json('POST', `/v1/roots/${lawId}/exclusions`, { body: { entryId: entryNamed('Unrelated.txt').id } })).status, 400)
  })

  it('excludes a folder named through another path to it, such as a mapped drive', async () => {
    const alias = path.join(sandbox, 'Law alias')
    fs.symlinkSync(law, alias, 'junction')
    const added = await json('POST', `/v1/roots/${lawId}/exclusions`, { body: { path: path.join(alias, 'Copies') } })
    assert.equal(added.status, 200)
    const exclusion = added.body.root.exclusions.find((item) => item.path === path.join(law, 'Copies'))
    assert.ok(exclusion)
    await json('DELETE', `/v1/roots/${lawId}/exclusions/${exclusion.id}`)
    fs.unlinkSync(alias)
    await settle()
  })
})

describe('evidence for a future assistant', () => {
  it('returns short passages located relative to their library, never full paths', () => {
    const passages = retrieveEvidence(companion.store.db, companion.access, { query: 'estoppel' })
    assert.equal(passages.length, 1)
    const [passage] = passages
    assert.equal(passage.library, 'Law Books')
    assert.equal(passage.folder, 'Contracts')
    assert.equal(passage.page, 4)
    assert.ok(passage.excerpt.length <= 700)
    assert.ok(!JSON.stringify(passages).includes(sandbox))
  })

  it('stays within the chosen libraries', () => {
    const db = companion.store.db
    assert.deepEqual(retrieveEvidence(db, companion.access, { query: 'estoppel', libraries: [otherId] }), [])
    assert.deepEqual(retrieveEvidence(db, companion.access, { query: 'estoppel', libraries: [9999] }), [])
  })
})

describe('revoking and granting access again', () => {
  it('a revoked library disappears from search, lists and evidence', async () => {
    const handbook = entryNamed('Contract Law Handbook.pdf').id
    const revoked = await json('POST', `/v1/roots/${lawId}/revoke`, { body: {} })
    assert.equal(revoked.body.root.state, 'revoked')

    assert.equal((await fulltext('estoppel')).items.length, 0)
    assert.deepEqual(await names('Negligence', '&mode=all'), [])
    assert.equal((await json('GET', `/v1/entries/${handbook}`)).status, 403)
    assert.equal((await json('POST', `/v1/entries/${handbook}/open`, { body: {} })).status, 403)
    assert.equal((await json('GET', `/v1/entries/${handbook}/content`)).status, 403)
    assert.equal((await json('GET', `/v1/roots/${lawId}/tree`)).status, 403)
    assert.equal((await json('GET', `/v1/roots/${lawId}/health`)).status, 403)
    assert.deepEqual(retrieveEvidence(companion.store.db, companion.access, { query: 'estoppel' }), [])
    assert.equal(revisitEvidence(companion.store.db, companion.access, { entryId: handbook, query: 'estoppel' }), null)

    const accessPage = (await json('GET', '/v1/access')).body
    assert.equal(accessPage.ai.enabled, false)
    assert.equal(accessPage.libraries.find((library) => library.id === lawId).state, 'revoked')
    assert.ok(accessPage.events.some((event) => event.kind === 'library-revoked' && event.libraryId === lawId))
    // The files themselves are untouched.
    assert.ok(fs.existsSync(path.join(law, 'Contracts', 'Contract Law Handbook.pdf')))
  })

  it('granting access again needs the same folder', async () => {
    nextPick = other
    const wrong = await json('POST', `/v1/roots/${lawId}/reauthorize`, { body: {} })
    assert.equal(wrong.status, 409)
    assert.equal(companion.store.getRoot(lawId).state, 'revoked')
    assert.deepEqual(calls.at(-1), ['pick', law])

    nextPick = law
    const right = await json('POST', `/v1/roots/${lawId}/reauthorize`, { body: {} })
    assert.equal(right.status, 200)
    await settle()
    assert.deepEqual(await names('estoppel', '&mode=fulltext'), ['Contract Law Handbook.pdf'])
  })

  it('discards text read from a document while its library was being revoked', async () => {
    const pool = companion.extractor.pool
    const run = pool.run
    let release
    const gate = new Promise((resolve) => (release = resolve))
    let started
    const reading = new Promise((resolve) => (started = resolve))
    pool.run = async (...args) => {
      started()
      await gate
      return run.apply(pool, args)
    }
    try {
      write('Law/Late/Late arrival.txt', 'quokkaword')
      await json('POST', `/v1/roots/${lawId}/rescan`, { body: {} })
      await reading
      await json('POST', `/v1/roots/${lawId}/revoke`, { body: {} })
      release()
      await waitFor(() => companion.extractor.active.size === 0)
    } finally {
      pool.run = run
    }
    const id = entryNamed('Late arrival.txt').id
    const db = companion.store.db
    assert.equal(db.prepare('select state from docs where entry_id = ?').get(id).state, 'cancelled')
    assert.equal(Number(db.prepare('select count(*) as n from doc_pages where entry_id = ?').get(id).n), 0)

    nextPick = law
    assert.equal((await json('POST', `/v1/roots/${lawId}/reauthorize`, { body: {} })).status, 200)
    await settle()
    assert.deepEqual(await names('quokkaword', '&mode=fulltext'), ['Late arrival.txt'])
  })
})

describe('library settings, pausing, clearing and removing', () => {
  it('a folder depth limit removes deeper files and records why', async () => {
    const changed = await json('PATCH', `/v1/roots/${otherId}`, { body: { maxDepth: 1, name: 'Misc' } })
    assert.equal(changed.status, 200)
    assert.equal(changed.body.root.name, 'Misc')
    assert.equal(changed.body.rescanning, true)
    await settle()
    assert.deepEqual(await names('Nested note'), [])
    const { items } = (await json('GET', `/v1/roots/${otherId}/health?section=skipped`)).body
    assert.ok(items.some((item) => item.reason === 'too-deep'))
    await json('PATCH', `/v1/roots/${otherId}`, { body: { maxDepth: 64 } })
    await settle()
    assert.deepEqual(await names('Nested note'), ['Nested note.txt'])
  })

  it('a file type filter indexes only the chosen types', async () => {
    await json('PATCH', `/v1/roots/${otherId}`, { body: { fileTypes: ['pdf'] } })
    await settle()
    assert.deepEqual(await names('Unrelated'), [])
    assert.ok((await json('GET', '/v1/status')).body.roots.find((root) => root.id === otherId).skippedByType >= 1)
    await json('PATCH', `/v1/roots/${otherId}`, { body: { fileTypes: null } })
    await settle()
    assert.deepEqual(await names('Unrelated'), ['Unrelated.txt'])
    assert.equal((await json('PATCH', `/v1/roots/${otherId}`, { body: { fileTypes: ['exe'] } })).status, 400)
  })

  it('a paused library stays searchable but is not updated', async () => {
    const paused = await json('POST', `/v1/roots/${otherId}/pause`, { body: {} })
    assert.equal(paused.body.root.state, 'paused')
    write('Other/While paused.txt', 'later')
    await json('POST', `/v1/index/rescan`, { body: { rootId: otherId } })
    await settle()
    assert.deepEqual(await names('While paused'), [])
    assert.deepEqual(await names('Unrelated'), ['Unrelated.txt'])
    await json('POST', `/v1/roots/${otherId}/resume`, { body: {} })
    await settle()
    assert.deepEqual(await names('While paused'), ['While paused.txt'])
  })

  it('clearing the index forgets everything indexed and keeps the files', async () => {
    const purged = await json('POST', `/v1/roots/${otherId}/purge`, { body: {} })
    assert.equal(purged.status, 200)
    assert.equal(purged.body.root.state, 'paused')
    assert.equal(purged.body.root.files, 0)
    assert.deepEqual(await names('Unrelated'), [])
    assert.ok(fs.existsSync(path.join(other, 'Unrelated.txt')))
    await json('POST', `/v1/roots/${otherId}/resume`, { body: {} })
    await settle()
    assert.deepEqual(await names('Unrelated'), ['Unrelated.txt'])
  })

  it('removing a library keeps the files', async () => {
    assert.equal((await json('DELETE', `/v1/roots/${otherId}`)).status, 200)
    assert.deepEqual(await names('Unrelated'), [])
    assert.equal((await json('GET', `/v1/roots/${otherId}/tree`)).status, 404)
    assert.ok(fs.existsSync(path.join(other, 'Unrelated.txt')))
    assert.ok(fs.existsSync(path.join(other, 'Deep', 'Deeper', 'Nested note.txt')))
  })
})

describe('choosing folders', () => {
  it('describes a picked folder without adding it', async () => {
    nextPick = law
    const picked = await json('POST', '/v1/roots/pick', { body: { add: false } })
    assert.equal(picked.status, 200)
    assert.equal(picked.body.suggestedName, 'Law')
    assert.equal(picked.body.existingId, lawId)
  })

  it('refuses a folder inside an existing library', async () => {
    const nested = await json('POST', '/v1/roots', { body: { path: path.join(law, 'Contracts') } })
    assert.equal(nested.status, 409)
  })

  it('lists folders of a library with the number of files below each', async () => {
    const { folders } = (await json('GET', `/v1/roots/${lawId}/tree`)).body
    const contracts = folders.find((folder) => folder.name === 'Contracts')
    assert.equal(contracts.files, 2)
    assert.ok(!folders.some((folder) => folder.name === 'Escape'))
  })
})

describe('upgrading the index', () => {
  const folder = path.join(sandbox, 'upgrade')

  it('upgrades an index from the first version and keeps a copy of the old file', () => {
    fs.mkdirSync(folder, { recursive: true })
    const file = path.join(folder, 'index.sqlite')
    const old = new DatabaseSync(file)
    old.exec(`
      create table roots (id integer primary key, path text not null, path_key text not null unique, added_at integer not null,
        last_scan_at integer, last_scan_ms integer, status text not null default 'pending', error text);
      create table entries (id integer primary key, root_id integer not null references roots(id) on delete cascade, path text not null,
        path_key text not null unique, parent_key text not null, name text not null, ext text not null, kind text not null,
        is_dir integer not null, size integer not null default 0, mtime integer not null default 0, readonly integer not null default 0,
        hidden integer not null default 0, accessible integer not null default 1, scan_gen integer not null default 0);
      insert into roots (path, path_key, added_at, status) values ('C:\\Books', 'c:\\books', 1, 'ready');
      insert into entries (root_id, path, path_key, parent_key, name, ext, kind, is_dir) values (1, 'C:\\Books\\a.pdf', 'c:\\books\\a.pdf', 'c:\\books', 'a.pdf', 'pdf', 'pdf', 0);
    `)
    old.close()
    const store = openStore(file)
    try {
      assert.equal(Number(store.db.prepare('pragma user_version').get().user_version), SCHEMA_VERSION)
      const root = store.getRoot(1)
      assert.equal(root.state, 'active')
      assert.equal(root.recursive, 1)
      assert.equal(root.ocr_pref, 'ask')
      assert.equal(store.getEntry(1).name, 'a.pdf')
      assert.ok(fs.existsSync(`${file}.bak-v1`))
    } finally {
      store.close()
    }
  })

  it('upgrades an index from version 3 and keeps the content hashes already known', () => {
    fs.mkdirSync(folder, { recursive: true })
    const file = path.join(folder, 'v3.sqlite')
    // A current index taken back to version 3: without the duplicate tables and the text fingerprint.
    const made = openStore(file)
    made.db.exec(`
      insert into roots (path, path_key, added_at, status) values ('C:\\Books', 'c:\\books', 1, 'ready');
      insert into entries (root_id, path, path_key, parent_key, name, ext, kind, is_dir, size, mtime)
        values (1, 'C:\\Books\\a.pdf', 'c:\\books\\a.pdf', 'c:\\books', 'a.pdf', 'pdf', 'pdf', 0, 10, 5);
      insert into docs (entry_id, root_id, state, size, mtime, sha256, extracted_at) values (1, 1, 'completed', 10, 5, '${'a'.repeat(64)}', 9);
      drop table file_hashes;
      drop table dup_dismissed;
      drop index docs_text_hash;
      alter table docs drop column text_hash;
      pragma user_version = 3;
    `)
    made.close()
    const store = openStore(file)
    try {
      assert.equal(Number(store.db.prepare('pragma user_version').get().user_version), SCHEMA_VERSION)
      assert.deepEqual({ ...store.db.prepare('select entry_id, size, mtime, sha256 from file_hashes').get() }, { entry_id: 1, size: 10, mtime: 5, sha256: 'a'.repeat(64) })
      assert.equal(store.db.prepare('select text_hash from docs').get().text_hash, null)
      assert.ok(fs.existsSync(`${file}.bak-v3`))
    } finally {
      store.close()
    }
  })

  it('refuses an index made by a newer version', () => {
    const file = path.join(folder, 'newer.sqlite')
    const db = new DatabaseSync(file)
    db.exec('pragma user_version = 99')
    db.close()
    assert.throws(() => openStore(file), { code: 'INDEX_TOO_NEW' })
  })

  it('moves a damaged index aside and starts a new one', () => {
    const file = path.join(folder, 'damaged.sqlite')
    fs.writeFileSync(file, Buffer.alloc(8192, 7))
    const store = openStore(file)
    try {
      assert.ok(store.recovered)
      assert.ok(fs.existsSync(store.recovered.movedTo))
      assert.equal(store.listRoots().length, 0)
    } finally {
      store.close()
    }
  })
})

describe('documents that take too long to read', () => {
  it('stops reading after the time limit and records why', async () => {
    const folder = path.join(sandbox, 'slow')
    fs.mkdirSync(path.join(folder, 'books'), { recursive: true })
    fs.writeFileSync(path.join(folder, 'books', 'Long.pdf'), makePdf(Array.from({ length: 50 }, (_, index) => `Page ${index + 1}`)))
    const slow = await startCompanion({ dataDir: path.join(folder, 'data'), port: 0, launcher, log: () => {}, extraction: { timeoutMs: 1 } })
    try {
      const root = slow.store.addRoot(path.join(folder, 'books'))
      slow.indexer.enqueue(root.id)
      await waitFor(() => !slow.indexer.running && slow.indexer.queue.length === 0)
      await slow.extractor.idle(30000)
      const doc = slow.store.db.prepare('select * from docs').get()
      assert.equal(doc.state, 'failed')
      assert.match(doc.error, /too long/)
    } finally {
      await slow.close()
    }
  })
})

describe('allowed websites', () => {
  it('a caller that names its origins replaces those saved by earlier runs', async () => {
    const folder = path.join(sandbox, 'origins')
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, 'config.json'), JSON.stringify({ allowedOrigins: ['http://localhost:47617', 'http://localhost:5173'], tokens: [] }))
    const instance = await startCompanion({ dataDir: folder, port: 0, launcher, log: () => {}, origins: ['http://localhost:47616'] })
    try {
      assert.deepEqual(instance.config.allowedOrigins, ['http://localhost:47616'])
      const response = await fetch(`http://127.0.0.1:${instance.port}/v1/hello`, { headers: { Origin: 'http://localhost:5173' } })
      assert.equal(response.status, 403)
    } finally {
      await instance.close()
    }
  })
})
