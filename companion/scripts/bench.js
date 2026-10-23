// Measures the companion on a generated library: how fast it indexes names,
// reads text, and answers searches, and how much memory it uses. Everything
// runs on a folder this script creates (next to the test sandbox, since
// application-data folders such as the system temp folder are protected) and
// deletes afterwards; nothing else on the computer is read.
//
//   node --disable-warning=ExperimentalWarning scripts/bench.js [--text 3000] [--pdfs 300] [--pages 30]
//     [--scanned 0] [--scanned-pages 10] [--keep]
//
// --scanned N adds N scanned PDFs (pictures of pages, no text layer) and
// measures text recognition (OCR) after the library's owner agrees to it.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { startCompanion } from '../src/main.js'
import { makePdf, makeScannedPdf } from '../test/helpers/fixtures.js'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? Number(args[index + 1]) : fallback
}
const TEXT_FILES = option('text', 3000)
const PDFS = option('pdfs', 300)
const PAGES = option('pages', 30)
const SEARCHES = option('searches', 40)
const SCANNED = option('scanned', 0)
const SCANNED_PAGES = option('scanned-pages', 10)
const keep = args.includes('--keep')

// A small legal vocabulary, so searches have realistic, overlapping matches.
const WORDS = (
  'contract offer acceptance consideration estoppel tort negligence duty care breach damages remedy injunction ' +
  'evidence hearsay confession witness testimony statute section court appeal judgment plaintiff defendant ' +
  'liability causation remoteness misrepresentation mistake frustration agency partnership company director ' +
  'trust equity property lease mortgage easement covenant title constitution rights procedure jurisdiction'
).split(' ')
let seed = 42
const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
const sentence = (length) => Array.from({ length }, () => WORDS[Math.floor(random() * WORDS.length)]).join(' ')

const sandbox = path.join(import.meta.dirname, '..', '.test-sandbox')
fs.mkdirSync(sandbox, { recursive: true })
const root = fs.mkdtempSync(path.join(sandbox, 'bench-'))
const library = path.join(root, 'Library')
const dataDir = path.join(root, 'data')

function generate() {
  for (let index = 0; index < TEXT_FILES; index++) {
    const folder = path.join(library, `Volume ${index % 20}`, `Part ${index % 7}`)
    fs.mkdirSync(folder, { recursive: true })
    if (index % 10 === 0) {
      const links = Array.from({ length: 5 }, (_, link) => `<a href="../Part ${link}/Notes ${link}.txt">Notes ${link}</a>`).join('\n')
      fs.writeFileSync(path.join(folder, `Catalog ${index}.htm`), `<html><head><title>Catalog ${index}</title></head><body><h1>${sentence(4)}</h1>${links}<p>${sentence(80)}</p></body></html>`)
    } else {
      fs.writeFileSync(path.join(folder, `Notes ${index}.txt`), Array.from({ length: 20 }, () => sentence(15)).join('\n'))
    }
  }
  for (let index = 0; index < PDFS; index++) {
    const folder = path.join(library, 'Books', `Shelf ${index % 10}`)
    fs.mkdirSync(folder, { recursive: true })
    const pages = Array.from({ length: PAGES }, () => sentence(40))
    fs.writeFileSync(path.join(folder, `Book ${index}.pdf`), makePdf(pages, { Title: `Book ${index} on ${sentence(2)}`, Author: `Author ${index % 25}` }))
  }
  for (let index = 0; index < SCANNED; index++) {
    const folder = path.join(library, 'Scans')
    fs.mkdirSync(folder, { recursive: true })
    // A page of a law report: a heading and 18 lines of words, as a 150 dpi scan.
    const pages = Array.from({ length: SCANNED_PAGES }, (_, page) => [`Report ${index} page ${page + 1}`, ...Array.from({ length: 18 }, () => sentence(7))])
    fs.writeFileSync(path.join(folder, `Scanned report ${index}.pdf`), makeScannedPdf(pages))
  }
}

let peakRss = 0
const sampler = setInterval(() => (peakRss = Math.max(peakRss, process.memoryUsage().rss)), 100)

const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]
}
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(0)} MB`

async function main() {
  const generateStarted = performance.now()
  generate()
  console.log(`Generated ${TEXT_FILES} text and web files, ${PDFS} PDFs of ${PAGES} pages and ${SCANNED} scanned PDFs of ${SCANNED_PAGES} pages in ${((performance.now() - generateStarted) / 1000).toFixed(1)} s`)
  const baselineRss = process.memoryUsage().rss

  const companion = await startCompanion({ dataDir, port: 0, launcher: { open: async () => {}, openLink: async () => {}, reveal: async () => {}, pickFolder: async () => null }, log: () => {} })
  try {
    await measure(companion, baselineRss)
  } finally {
    await companion.close()
  }
}

async function measure(companion, baselineRss) {
  const base = `http://127.0.0.1:${companion.port}`
  const origin = 'http://localhost:5173'
  const pair = await fetch(`${base}/v1/pair`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: companion.newPairingCode() }) })
  const { token } = await pair.json()
  const call = async (method, route, body) => {
    const response = await fetch(base + route, {
      method,
      headers: { Origin: origin, Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) throw new Error(`${route}: ${response.status} ${await response.text()}`)
    return response.json()
  }

  const indexStarted = performance.now()
  const { root: added } = await call('POST', '/v1/roots', { path: library, name: 'Benchmark' })
  // Names are indexed first; text is read in the background as files are found.
  for (;;) {
    const status = await call('GET', '/v1/status')
    const libraryStatus = status.roots.find((item) => item.id === added.id)
    if (libraryStatus.status === 'ready' && status.index.state === 'idle') break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const indexSeconds = (performance.now() - indexStarted) / 1000
  const files = (await call('GET', '/v1/status')).roots[0].files
  console.log(`Indexed ${files} file names in ${indexSeconds.toFixed(1)} s (${Math.round(files / indexSeconds)} files/s)`)

  const textStarted = performance.now()
  await companion.extractor.idle(30 * 60_000)
  const textSeconds = (performance.now() - textStarted) / 1000 + indexSeconds
  const counts = companion.store.db.prepare("select count(*) as docs, sum(pages) as pages from docs where state = 'completed'").get()
  const failed = companion.store.db.prepare("select count(*) as n from docs where state = 'failed'").get().n
  console.log(`Read the text of ${counts.docs} documents (${counts.pages} pages) within ${textSeconds.toFixed(1)} s of adding the library; ${failed} failed`)
  const pdfStats = companion.store.db.prepare("select count(*) as n, sum(d.pages) as pages from docs d join entries e on e.id = d.entry_id where e.ext = 'pdf' and d.state = 'completed'").get()
  console.log(`  of which ${pdfStats.n} PDFs with ${pdfStats.pages} pages`)

  const queries = [
    ['all', 'negligence'],
    ['all', 'duty care'],
    ['fulltext', '"breach damages"'],
    ['fulltext', 'estoppel OR frustration'],
    ['fulltext', 'hearsay -confession'],
    ['documents', 'Book 12'],
    ['names', 'catalog'],
    ['all', 'negligance'],
  ]
  const timings = {}
  for (let round = 0; round < SEARCHES; round++) {
    for (const [mode, q] of queries) {
      const started = performance.now()
      const result = await call('GET', `/v1/search?mode=${mode}&q=${encodeURIComponent(q)}&limit=50`)
      const took = performance.now() - started
      ;(timings[mode] ??= []).push(took)
      if (round === 0) console.log(`  ${mode.padEnd(9)} ${JSON.stringify(q).padEnd(28)} ${String(result.total).padStart(6)} results, first: ${result.items[0]?.name ?? '-'}${result.items[0]?.excerpt?.page ? ` (page ${result.items[0].excerpt.page})` : ''}`)
    }
  }
  console.log('Search latency over HTTP, including the result details:')
  for (const [mode, values] of Object.entries(timings)) {
    console.log(`  ${mode.padEnd(9)} p50 ${percentile(values, 0.5).toFixed(0)} ms, p95 ${percentile(values, 0.95).toFixed(0)} ms (${values.length} searches)`)
  }
  if (SCANNED > 0) {
    const ocrStarted = performance.now()
    const rssBefore = peakRss
    await call('POST', `/v1/roots/${added.id}/ocr`, { decision: 'on' })
    await companion.ocr.idle(6 * 60 * 60_000)
    const seconds = (performance.now() - ocrStarted) / 1000
    const ocr = companion.store.db.prepare(`select count(*) as docs, sum(ocr_done) as pages, sum(ocr_failed) as failed, avg(ocr_confidence) as confidence
      from docs where ocr_state = 'completed'`).get()
    console.log(`Recognised ${ocr.pages} scanned pages in ${ocr.docs} documents in ${seconds.toFixed(1)} s (${(seconds / ocr.pages).toFixed(2)} s per page); ${ocr.failed} pages failed; average confidence ${Math.round(ocr.confidence)}%`)
    console.log(`  peak memory during recognition: ${mb(Math.max(peakRss, rssBefore))} (main thread and recognition worker)`)
    const started = performance.now()
    const result = await call('GET', `/v1/search?mode=fulltext&q=${encodeURIComponent('"Report 3 page 7"')}&limit=5`)
    console.log(`  phrase search in recognised text: ${result.total} result(s), first ${result.items[0]?.name ?? '-'} page ${result.items[0]?.excerpt?.page ?? '-'} (${result.items[0]?.excerpt?.source ?? '-'}), ${(performance.now() - started).toFixed(0)} ms`)
  }
  const indexSize = fs.statSync(path.join(dataDir, 'index.sqlite')).size
  console.log(`Index size on disk: ${mb(indexSize)}`)
  console.log(`Memory: ${mb(baselineRss)} before adding the library, peak ${mb(peakRss)} (process RSS, including text-reading workers)`)
  console.log(`Machine: ${os.cpus()[0]?.model} x${os.cpus().length}, ${mb(os.totalmem())} RAM, ${process.platform} ${os.release()}, Node ${process.version}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    clearInterval(sampler)
    if (keep) console.log(`Kept ${root}`)
    else fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 })
  })
