// End-to-end tests of text recognition (OCR) of scanned pages: offered once
// per library, run only after the owner agrees, searchable with real page
// numbers, and stopped by revoking, excluding or turning it off. Real
// Tesseract with the bundled English data, real scanned PDFs and pictures
// (generated, see helpers/fixtures.js); only the launcher is replaced.
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { startCompanion } from '../src/main.js'
import { makeScanImage, makeScannedPdf } from './helpers/fixtures.js'

const ORIGIN = 'http://localhost:5173'
const sandboxBase = path.join(import.meta.dirname, '..', '.test-sandbox')
fs.mkdirSync(sandboxBase, { recursive: true })
const sandbox = fs.mkdtempSync(path.join(sandboxBase, 'ocr-'))
const scans = path.join(sandbox, 'Scans')
const dataDir = path.join(sandbox, 'data')
const launcher = { open: async () => {}, openLink: async () => {}, reveal: async () => {}, pickFolder: async () => null }

const BOOK = [
  ['Chapter One', 'The law of contract governs promises.'],
  ['The postal rule applies to acceptance', 'sent by letter, as in Adams v Lindsell.'],
]

function write(relative, content) {
  const target = path.join(scans, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
  return target
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

/** A running companion with a paired browser, and helpers to call it. */
async function open(folder, options = {}) {
  const companion = await startCompanion({ dataDir: folder, port: 0, launcher, log: () => {}, ...options })
  const base = `http://127.0.0.1:${companion.port}`
  let token = null
  const call = async (method, route, body) => {
    const response = await fetch(base + route, {
      method,
      headers: { Origin: ORIGIN, Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    return { status: response.status, body: await response.json() }
  }
  const code = companion.newPairingCode()
  token = (await (await fetch(base + '/v1/pair', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ code, label: 'test' }) })).json()).token
  const settle = async () => {
    await waitFor(() => companion.indexer.status().state === 'idle' && companion.indexer.queue.length === 0)
    await companion.extractor.idle(30000)
  }
  const fulltext = async (q) => (await call('GET', `/v1/search?q=${encodeURIComponent(q)}&mode=fulltext`)).body.items
  const entry = (name) => companion.store.db.prepare('select * from entries where name = ?').get(name)
  const doc = (name) => companion.store.db.prepare('select d.* from docs d join entries e on e.id = d.entry_id where e.name = ?').get(name)
  const ocrPages = (name) => companion.store.db.prepare("select p.* from doc_pages p join entries e on e.id = p.entry_id where e.name = ? and p.source = 'ocr' order by p.page").all(name)
  return { companion, call, settle, fulltext, entry, doc, ocrPages }
}

let app
let libraryId

before(async () => {
  write('Old Reports/Carlill.pdf', makeScannedPdf(BOOK))
  write('Mixed.pdf', makeScannedPdf(['Typed introduction about torts', ['Rylands v Fletcher concerns strict liability.']]))
  write('Memo.png', makeScanImage(['Memorandum of trust', 'The settlor transferred the property.']))
  write('Torn.png', Buffer.from('this is not really a picture'))
  app = await open(dataDir)
  libraryId = (await app.call('POST', '/v1/roots', { path: scans, name: 'Scans' })).body.root.id
  await app.settle()
})

after(async () => {
  await app?.companion.close()
  fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

describe('recognising the text of scanned pages', () => {
  it('finds the scans, offers recognition and does nothing until the owner agrees', async () => {
    const library = (await app.call('GET', `/v1/roots/${libraryId}/health`)).body.library
    assert.equal(library.ocr.pref, 'ask')
    assert.equal(library.settings.ocr, false)
    assert.equal(library.ocr.scannedDocs, 4)
    assert.equal(library.ocr.scannedPages, 5)
    assert.equal(app.doc('Carlill.pdf').ocr_state, 'none')
    // Give a misbehaving runner a moment: nothing may be recognised yet.
    await new Promise((resolve) => setTimeout(resolve, 500))
    assert.deepEqual(await app.fulltext('Lindsell'), [])
    assert.equal(app.ocrPages('Carlill.pdf').length, 0)
  })

  it('after the owner agrees, finds words on a scanned page with its page number', async () => {
    const answer = await app.call('POST', `/v1/roots/${libraryId}/ocr`, { decision: 'on' })
    assert.equal(answer.status, 200)
    assert.equal(answer.body.root.settings.ocr, true)
    await app.companion.ocr.idle(180000)

    const [hit, ...rest] = await app.fulltext('Lindsell')
    assert.equal(rest.length, 0)
    assert.equal(hit.name, 'Carlill.pdf')
    assert.equal(hit.excerpt.page, 2)
    assert.equal(hit.excerpt.source, 'ocr')
    assert.match(hit.excerpt.text, /<<Lindsell>>/)
    const matches = (await app.call('GET', `/v1/entries/${hit.id}/matches?q=contract`)).body.matches
    assert.deepEqual(matches.map((match) => match.page), [1])

    const doc = app.doc('Carlill.pdf')
    assert.equal(doc.ocr_state, 'completed')
    assert.equal(doc.ocr_pages, 2)
    assert.equal(doc.ocr_done, 2)
    assert.ok(doc.ocr_confidence >= 60, `confidence ${doc.ocr_confidence}`)
    const text = (await app.call('GET', `/v1/entries/${hit.id}`)).body.text
    assert.equal(text.ocr.state, 'completed')
  })

  it('recognises only the scanned pages of a PDF that also has typed pages', async () => {
    const [hit] = await app.fulltext('Rylands')
    assert.equal(hit.name, 'Mixed.pdf')
    assert.equal(hit.excerpt.page, 2)
    assert.equal(hit.excerpt.source, 'ocr')
    assert.equal(app.doc('Mixed.pdf').ocr_pages, 1)
    const [typed] = await app.fulltext('introduction')
    assert.equal(typed.excerpt.source, 'text')
    assert.equal(typed.excerpt.page, 1)
  })

  it('recognises a scanned picture', async () => {
    const [hit] = await app.fulltext('settlor')
    assert.equal(hit.name, 'Memo.png')
    assert.equal(hit.excerpt.page, null)
    assert.equal(hit.excerpt.source, 'ocr')
  })

  it('lists a picture that could not be recognised in Health, with the reason', async () => {
    const health = (await app.call('GET', `/v1/roots/${libraryId}/health`)).body.summary
    assert.equal(health.ocrFailed, 1)
    assert.equal(health.needsOcr, 0)
    const { items } = (await app.call('GET', `/v1/roots/${libraryId}/health?section=ocr-failed`)).body
    assert.deepEqual(items.map((item) => item.name), ['Torn.png'])
    assert.ok(items[0].detail)
  })

  it('reuses the recognised text of an identical copy instead of recognising it again', async () => {
    fs.copyFileSync(path.join(scans, 'Old Reports', 'Carlill.pdf'), path.join(scans, 'Carlill copy.pdf'))
    await app.call('POST', `/v1/roots/${libraryId}/rescan`)
    await waitFor(() => app.doc('Carlill copy.pdf')?.state === 'completed')
    await app.companion.ocr.idle(60000)
    const copy = app.doc('Carlill copy.pdf')
    assert.equal(copy.ocr_state, 'completed')
    assert.equal(copy.ocr_at, app.doc('Carlill.pdf').ocr_at)
    assert.deepEqual(app.ocrPages('Carlill copy.pdf').map((page) => page.page), [1, 2])
    fs.rmSync(path.join(scans, 'Carlill copy.pdf'))
    await app.call('POST', `/v1/roots/${libraryId}/rescan`)
    await waitFor(() => !app.entry('Carlill copy.pdf'))
  })

  it('turning recognition off keeps the text already recognised', async () => {
    const changed = await app.call('PATCH', `/v1/roots/${libraryId}`, { ocr: false })
    assert.equal(changed.body.root.settings.ocr, false)
    assert.equal(changed.body.root.ocr.pref, 'off')
    assert.equal((await app.fulltext('settlor'))[0]?.name, 'Memo.png')
  })

  it('excluding a folder removes the text recognised in it', async () => {
    const result = await app.call('POST', `/v1/roots/${libraryId}/exclusions`, { path: path.join(scans, 'Old Reports') })
    assert.equal(result.status, 200)
    assert.deepEqual(await app.fulltext('Lindsell'), [])
    const left = app.companion.store.db.prepare("select count(*) as n from doc_pages where source = 'ocr' and text like '%Lindsell%'").get().n
    assert.equal(Number(left), 0)
  })
})

describe('the owner decides', () => {
  it('"Not now" turns recognition off for that library, so it is not asked again', async () => {
    const folder = path.join(sandbox, 'Later')
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, 'Scan.pdf'), makeScannedPdf([['Unread page about bailment']]))
    const id = (await app.call('POST', '/v1/roots', { path: folder })).body.root.id
    await app.settle()
    const answer = await app.call('POST', `/v1/roots/${id}/ocr`, { decision: 'not-now' })
    assert.equal(answer.body.root.ocr.pref, 'off')
    assert.equal(answer.body.root.ocr.scannedDocs, 1)
    await app.companion.ocr.idle(30000)
    // Never queued: the scan stays found by name only.
    assert.equal(app.doc('Scan.pdf').ocr_state, 'none')
    assert.deepEqual(await app.fulltext('bailment'), [])
    assert.equal((await app.call('POST', `/v1/roots/${id}/ocr`, { decision: 'maybe' })).status, 400)
  })
})

describe('stopping and resuming', () => {
  const PAGES = [['First page of the long volume'], ['Second page mentions quasi contract'], ['Third page mentions laches'], ['Fourth page mentions estoppel by deed']]

  it('revoking a library stops recognition at once and keeps nothing more', async () => {
    const folder = path.join(sandbox, 'Volumes')
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, 'Long volume.pdf'), makeScannedPdf(PAGES))
    const id = (await app.call('POST', '/v1/roots', { path: folder })).body.root.id
    await app.settle()
    await app.call('POST', `/v1/roots/${id}/ocr`, { decision: 'on' })
    await waitFor(() => (app.doc('Long volume.pdf')?.ocr_done ?? 0) >= 1, 60000)
    await app.call('POST', `/v1/roots/${id}/revoke`)
    const kept = app.ocrPages('Long volume.pdf').length
    assert.equal(app.companion.ocr.status().current, null)
    await new Promise((resolve) => setTimeout(resolve, 4000))
    assert.equal(app.ocrPages('Long volume.pdf').length, kept)
    assert.equal(app.doc('Long volume.pdf').ocr_state, 'cancelled')
    assert.ok(kept < PAGES.length)
    assert.deepEqual(await app.fulltext('quasi'), [])
  })

  it('carries on from the page it reached after the companion restarts', async () => {
    const folder = path.join(sandbox, 'Restart')
    const data = path.join(sandbox, 'restart-data')
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, 'Volume two.pdf'), makeScannedPdf(PAGES.slice(0, 3)))
    let instance = await open(data)
    try {
      const id = (await instance.call('POST', '/v1/roots', { path: folder })).body.root.id
      await instance.settle()
      await instance.call('POST', `/v1/roots/${id}/ocr`, { decision: 'on' })
      await waitFor(() => (instance.doc('Volume two.pdf')?.ocr_done ?? 0) >= 1, 60000)
    } finally {
      await instance.companion.close()
    }
    instance = await open(data)
    try {
      const before = instance.doc('Volume two.pdf')
      assert.ok(before.ocr_done >= 1 && before.ocr_done < 3, `done ${before.ocr_done}`)
      assert.equal(before.ocr_state, 'pending')
      await instance.settle()
      await instance.companion.ocr.idle(120000)
      const doc = instance.doc('Volume two.pdf')
      assert.equal(doc.ocr_state, 'completed')
      assert.equal(doc.ocr_done, 3)
      // Each page once: the pages done before the restart were not recognised again.
      assert.deepEqual(instance.ocrPages('Volume two.pdf').map((page) => page.page), [1, 2, 3])
      assert.equal((await instance.fulltext('laches'))[0]?.excerpt.page, 3)
    } finally {
      await instance.companion.close()
    }
  })

  it('never downloads language data: missing data is reported, not fetched', async () => {
    const folder = path.join(sandbox, 'Nodata')
    const empty = path.join(sandbox, 'no-language-data')
    fs.mkdirSync(folder, { recursive: true })
    fs.mkdirSync(empty, { recursive: true })
    fs.writeFileSync(path.join(folder, 'Scan.png'), makeScanImage(['Words that cannot be read']))
    const instance = await open(path.join(sandbox, 'nodata-data'), { recognition: { langPath: empty } })
    try {
      const id = (await instance.call('POST', '/v1/roots', { path: folder })).body.root.id
      await instance.settle()
      await instance.call('POST', `/v1/roots/${id}/ocr`, { decision: 'on' })
      await instance.companion.ocr.idle(60000)
      const doc = instance.doc('Scan.png')
      assert.equal(doc.ocr_state, 'failed')
      assert.match(doc.ocr_error, /recognition data is missing/)
      assert.deepEqual(fs.readdirSync(empty), [])
    } finally {
      await instance.companion.close()
    }
  })
})
