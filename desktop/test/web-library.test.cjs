'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createWebLibrary } = require('../src/web-library.cjs')

function fresh() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-web-library-'))
  const file = path.join(folder, 'web-library.json')
  return { file, library: createWebLibrary(file, { saveDelayMs: 0 }), cleanup: () => fs.rmSync(folder, { recursive: true, force: true }) }
}

test('saves references with notes and folders, and keeps them after a restart', (t) => {
  const { file, library, cleanup } = fresh()
  t.after(cleanup)
  const { bookmark } = library.saveBookmark({ url: 'https://ghalii.org/', title: 'GhaLII', note: 'Judgments', folder: 'Case law', source: { name: 'Understanding Court Judgments.docx', entryId: 12 } })
  assert.equal(bookmark.folder, 'Case law')
  assert.deepEqual(bookmark.source, { name: 'Understanding Court Judgments.docx', entryId: 12 })
  const again = createWebLibrary(file).snapshot()
  assert.equal(again.bookmarks.length, 1)
  assert.equal(again.bookmarks[0].note, 'Judgments')
  assert.deepEqual(again.folders, ['Case law'])
})

test('does not save the same page twice, and marks duplicates made by editing', (t) => {
  const { library, cleanup } = fresh()
  t.after(cleanup)
  const first = library.saveBookmark({ url: 'https://example.com/acts?id=1' })
  const second = library.saveBookmark({ url: 'http://www.example.com/acts/?id=1#s2' })
  assert.equal(second.existed, true)
  assert.equal(second.bookmark.id, first.bookmark.id)
  const other = library.saveBookmark({ url: 'https://example.com/other' }).bookmark
  library.updateBookmark(other.id, { url: 'https://example.com/acts?id=1&utm_source=mail' })
  const { bookmarks } = library.snapshot()
  assert.deepEqual(bookmarks.map((item) => item.duplicate), [true, true])
})

test('refuses anything but web pages', (t) => {
  const { library, cleanup } = fresh()
  t.after(cleanup)
  for (const url of ['javascript:alert(1)', 'file:///C:/secret.pdf', 'http://127.0.0.1:47615/', 'data:text/html,x']) {
    assert.throws(() => library.saveBookmark({ url }), /Only http and https/)
  }
  library.recordVisit({ url: 'file:///C:/secret.pdf', title: 'x' })
  assert.equal(library.snapshot().history.length, 0)
})

test('renaming and removing folders keeps the references', (t) => {
  const { library, cleanup } = fresh()
  t.after(cleanup)
  const { bookmark } = library.saveBookmark({ url: 'https://example.com/', folder: 'Statutes' })
  library.renameFolder('Statutes', 'Legislation')
  assert.equal(library.snapshot().bookmarks[0].folder, 'Legislation')
  library.removeFolder('Legislation')
  assert.equal(library.snapshot().bookmarks[0].folder, '')
  assert.equal(library.snapshot().bookmarks[0].id, bookmark.id)
  assert.deepEqual(library.snapshot().folders, [])
})

test('recent pages list each page once, newest first, and can be cleared', (t) => {
  let clock = 1
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-web-library-'))
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }))
  const library = createWebLibrary(path.join(folder, 'x.json'), { saveDelayMs: 0, now: () => clock++ })
  library.recordVisit({ url: 'https://a.example/', title: 'A' })
  library.recordVisit({ url: 'https://b.example/', title: 'B' })
  library.recordVisit({ url: 'https://a.example/#top', title: 'A again' })
  assert.deepEqual(library.snapshot().history.map((item) => item.title), ['A again', 'B'])
  for (let index = 0; index < 400; index += 1) library.recordVisit({ url: `https://c.example/${index}` })
  assert.equal(library.snapshot().history.length, 300)
  library.clearHistory()
  assert.equal(library.snapshot().history.length, 0)
})

test('a damaged file starts empty instead of failing', (t) => {
  const { file, cleanup } = fresh()
  t.after(cleanup)
  fs.writeFileSync(file, '{ not json')
  assert.deepEqual(createWebLibrary(file).snapshot(), { folders: [], bookmarks: [], history: [] })
})
