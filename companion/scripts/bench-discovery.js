// Measures how fast a newly added library appears, becomes browsable and
// searchable by name, and stays up to date: the "discovery" side of the
// companion (bench.js measures reading text). Runs the real companion on
// generated libraries and talks to it over HTTP like the app does.
//
//   node --disable-warning=ExperimentalWarning scripts/bench-discovery.js [--files 10000] [--keep] [--json out.json] [--discovery-only]
//
// The generated library is kept in .test-sandbox/discovery-<files> (with
// --keep) and reused by later runs, so repeated runs compare like with like.
// Generating it leaves its files in the system's file cache, so results are
// warm-cache unless the computer was restarted in between (see --label).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { startCompanion } from '../src/main.js'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : fallback
}
const FILES = Number(option('files', 10000))
const keep = args.includes('--keep')
const jsonOut = option('json', null)
const label = option('label', 'warm cache')
// Stops after adding the library (steps 1-5), for profiling discovery.
const discoveryOnly = args.includes('--discovery-only')

const sandbox = path.join(import.meta.dirname, '..', '.test-sandbox')
fs.mkdirSync(sandbox, { recursive: true })
const library = path.join(sandbox, `discovery-${FILES}`)
const work = fs.mkdtempSync(path.join(sandbox, 'discovery-run-'))
let dataDir = path.join(work, 'data')

// ── The library ────────────────────────────────────────────────────────────
// About 60 files per folder, nested up to 7 levels, mixed formats, names that
// repeat across folders, long names, shortcuts that lead nowhere, a few large
// files and (where the system allows) a folder that cannot be read.

const TOPICS = 'Contract Tort Evidence Criminal Constitutional Property Equity Trusts Company Family Labour Tax Land Banking Insurance'.split(' ')
const KINDS = [
  ['pdf', 30], ['docx', 20], ['doc', 4], ['pptx', 6], ['xlsx', 4], ['epub', 3], ['htm', 6], ['txt', 8], ['jpg', 10], ['png', 4], ['rtf', 2], ['url', 1], ['lnk', 1], ['zip', 1],
]
const kindTable = KINDS.flatMap(([ext, weight]) => Array(weight).fill(ext))
let seed = 7
const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
const pick = (list) => list[Math.floor(random() * list.length)]

function generate() {
  const marker = path.join(library, '.generated')
  if (fs.existsSync(marker)) return false
  fs.rmSync(library, { recursive: true, force: true })
  const folders = [library]
  const perFolder = 60
  const folderCount = Math.max(1, Math.ceil(FILES / perFolder))
  for (let index = 1; index < folderCount; index++) {
    // A parent among the folders made so far, preferring recent ones, so the tree is deep in places.
    const parent = folders[Math.max(0, folders.length - 1 - Math.floor(random() * Math.min(folders.length, 12)))]
    const depth = path.relative(library, parent).split(path.sep).filter(Boolean).length
    const base = depth >= 7 ? library : parent
    const folder = path.join(base, `${pick(TOPICS)} ${index}${index % 9 === 0 ? ' - cases, notes and materials for the second term' : ''}`)
    fs.mkdirSync(folder, { recursive: true })
    folders.push(folder)
  }
  for (let index = 0; index < FILES; index++) {
    const folder = folders[index % folders.length]
    const ext = pick(kindTable)
    // Every 25th file has a name used in many folders ("Notes.docx").
    const name = index % 25 === 0 ? `Notes.${ext}` : `${pick(TOPICS)} ${index % 3 === 0 ? 'judgment' : index % 3 === 1 ? 'report' : 'outline'} ${index}${index % 50 === 1 ? ' with a long descriptive title about the facts, the issues and the holding' : ''}.${ext}`
    const target = path.join(folder, name)
    if (ext === 'url') fs.writeFileSync(target, `[InternetShortcut]\r\nURL=file:///C:/Missing/Book ${index}.pdf\r\n`)
    else fs.writeFileSync(target, `${ext} ${index}`)
  }
  // Large files: their size is all discovery needs.
  for (let index = 0; index < 3; index++) {
    const handle = fs.openSync(path.join(library, `Large scanned volume ${index}.pdf`), 'w')
    fs.ftruncateSync(handle, 300 * 1024 * 1024)
    fs.closeSync(handle)
  }
  fs.writeFileSync(marker, String(Date.now()))
  return true
}

// ── Measuring ──────────────────────────────────────────────────────────────

const launcher = { open: async () => {}, openLink: async () => {}, reveal: async () => {}, pickFolder: async () => null }
const percentile = (values, fraction) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]
}
const round = (value, digits = 0) => (value === null || value === undefined ? null : Number(value.toFixed(digits)))
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const results = { files: FILES, label, steps: {} }
const note = (name, value) => {
  results.steps[name] = value
  console.log(`${name.padEnd(36)} ${typeof value === 'object' ? JSON.stringify(value) : value}`)
}

let peakRss = 0
const sampler = setInterval(() => (peakRss = Math.max(peakRss, process.memoryUsage().rss)), 50)

async function client(companion) {
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
  const timed = async (method, route, body) => {
    const started = performance.now()
    const value = await call(method, route, body)
    return { value, ms: performance.now() - started }
  }
  return { call, timed }
}

const start = () => startCompanion({ dataDir, port: 0, launcher, log: () => {} })
const rootOf = async (call, id) => (await call('GET', '/v1/status')).roots.find((item) => item.id === id)
async function untilReady(call, id, since) {
  for (;;) {
    const status = await call('GET', '/v1/status')
    const root = status.roots.find((item) => item.id === id)
    if (root.status === 'ready' && status.index.state === 'idle' && (since === undefined || (root.lastScanAt ?? 0) >= since)) return root
    await wait(20)
  }
}

// Windows refuses to rename a folder while another program (an antivirus
// scanner, a folder watcher) briefly has it open; try again for a few seconds.
async function rename(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      return fs.renameSync(from, to)
    } catch (error) {
      if (error.code !== 'EPERM' || attempt >= 50) throw error
      await wait(100)
    }
  }
}

// Lists what the index has wrong compared with the disk, when a check fails.
function explain(companion, id) {
  const disk = new Set()
  ;(function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const target = path.join(folder, entry.name)
      disk.add(target.toLowerCase())
      if (entry.isDirectory()) walk(target)
    }
  })(library)
  const indexed = new Set(companion.store.db.prepare('select path_key from entries where root_id = ? and path_key <> ?').all(id, library.toLowerCase()).map((row) => row.path_key))
  const missing = [...disk].filter((key) => !indexed.has(key))
  const extra = [...indexed].filter((key) => !disk.has(key))
  console.log(`  on disk ${disk.size}, indexed ${indexed.size}: ${missing.length} missing, ${extra.length} not on disk`)
  for (const key of missing.slice(0, 5)) console.log('    missing', path.relative(library, key))
  for (const key of extra.slice(0, 5)) console.log('    not on disk', path.relative(library, key))
}

async function main() {
  const generateStarted = performance.now()
  const made = generate()
  const onDisk = { files: 0, folders: 0 }
  ;(function count(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.name === '.generated') continue
      if (entry.isDirectory()) {
        onDisk.folders++
        count(path.join(folder, entry.name))
      } else onDisk.files++
    }
  })(library)
  console.log(`${made ? 'Generated' : 'Reusing'} ${library}: ${onDisk.files} files in ${onDisk.folders} folders${made ? ` (${((performance.now() - generateStarted) / 1000).toFixed(1)} s)` : ''}`)
  results.dataset = onDisk

  // 1-5. Adding the library, with a user browsing and searching while it is scanned.
  let companion = await start()
  let { call, timed } = await client(companion)
  const loop = monitorEventLoopDelay({ resolution: 10 })
  loop.enable()
  const cpuBefore = process.cpuUsage()
  const addStarted = performance.now()
  const added = await timed('POST', '/v1/roots', { path: library, name: 'Benchmark', recursive: true, maxDepth: null })
  const id = added.value.root.id
  note('register library (ms)', round(added.ms))

  let firstVisible = null
  let searchable = null
  const during = { tree: [], search: [], status: [] }
  let done = false
  const browsing = (async () => {
    while (!done) {
      const tree = await timed('GET', `/v1/roots/${id}/tree`)
      during.tree.push(tree.ms)
      if (firstVisible === null && tree.value.folders.length + tree.value.files.length > 0) firstVisible = performance.now() - addStarted
      const search = await timed('GET', `/v1/search?q=${encodeURIComponent('judgment')}&limit=50`)
      during.search.push(search.ms)
      if (searchable === null && search.value.total > 0) searchable = performance.now() - addStarted
      await wait(25)
    }
  })()
  for (;;) {
    const status = await timed('GET', '/v1/status')
    during.status.push(status.ms)
    const root = status.value.roots.find((item) => item.id === id)
    if (root.status === 'ready' && status.value.index.state === 'idle') break
    await wait(50)
  }
  const discovered = performance.now() - addStarted
  done = true
  await browsing
  const cpu = process.cpuUsage(cpuBefore)
  loop.disable()
  const root = await rootOf(call, id)
  note('first entries visible (ms)', round(firstVisible))
  note('filename search usable (ms)', round(searchable))
  note('full inventory discovered (ms)', round(discovered))
  note('entries indexed', { files: root.files, folders: root.folders })
  note('discovery rate (entries/s)', round((root.files + root.folders) / (discovered / 1000)))
  note('while scanning: tree p50/p95/max', [percentile(during.tree, 0.5), percentile(during.tree, 0.95), Math.max(...during.tree)].map((v) => round(v)))
  note('while scanning: search p50/p95/max', [percentile(during.search, 0.5), percentile(during.search, 0.95), Math.max(...during.search)].map((v) => round(v)))
  note('while scanning: status p50/p95/max', [percentile(during.status, 0.5), percentile(during.status, 0.95), Math.max(...during.status)].map((v) => round(v)))
  note('event loop delay p99/max (ms)', [round(loop.percentile(99) / 1e6), round(loop.max / 1e6)])
  note('CPU during discovery (s user/system)', [round(cpu.user / 1e6, 1), round(cpu.system / 1e6, 1)])
  note('peak memory (MB RSS)', round(peakRss / 1024 / 1024))
  if (discoveryOnly) {
    await companion.close()
    if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 2))
    return
  }

  // 5. Search latency once discovery is done (text reading may still be running).
  const queries = [
    ['exact name', 'Notes.docx'],
    ['partial word', 'udgm'],
    ['two words', 'contract judgment'],
    ['short word', 'ta'],
    ['folder name', 'Equity 18'],
    ['number in name', '4242'],
    ['typo (fuzzy)', 'jugdment'],
    ['nothing matches', 'zzqqxx'],
  ]
  const latency = {}
  for (const [name, q] of queries) {
    const times = []
    let total = 0
    for (let index = 0; index < 15; index++) {
      const result = await timed('GET', `/v1/search?q=${encodeURIComponent(q)}&limit=50`)
      times.push(result.ms)
      total = result.value.total
    }
    latency[name] = { p50: round(percentile(times, 0.5), 1), p95: round(percentile(times, 0.95), 1), results: total }
  }
  const filtered = []
  for (let index = 0; index < 15; index++) filtered.push((await timed('GET', `/v1/search?q=report&kind=pdf&sort=modified&limit=50`)).ms)
  latency['word + type filter, by date'] = { p50: round(percentile(filtered, 0.5), 1), p95: round(percentile(filtered, 0.95), 1) }
  const browse = []
  const top = await call('GET', `/v1/roots/${id}/tree`)
  for (const folder of top.folders.slice(0, 15)) browse.push((await timed('GET', `/v1/roots/${id}/tree?parent=${folder.id}`)).ms)
  latency['open a folder'] = { p50: round(percentile(browse, 0.5), 1), p95: round(percentile(browse, 0.95), 1) }
  note('search latency (ms)', '')
  for (const [name, value] of Object.entries(latency)) console.log(`  ${name.padEnd(30)} ${JSON.stringify(value)}`)
  results.steps['search latency (ms)'] = latency

  // Let text reading of the (tiny, mostly unreadable) generated files finish, so the rescans below measure discovery only.
  const textStarted = performance.now()
  await companion.extractor.idle(60 * 60_000)
  note('background text reading finished (s)', round((performance.now() - textStarted) / 1000, 1))

  // 8. Rescans: nothing changed, then a few hundred changes.
  let rescanStarted = Date.now()
  let started = performance.now()
  await call('POST', '/v1/index/rescan', { rootId: id })
  await untilReady(call, id, rescanStarted)
  note('rescan, nothing changed (ms)', round(performance.now() - started))

  const folders = fs.readdirSync(library, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => path.join(library, entry.name))
  companion.indexer.reconcileMs = 0
  const changes = Math.min(100, Math.floor(FILES / 20))
  const changed = []
  for (let index = 0; index < changes; index++) {
    const target = path.join(folders[index % folders.length], `Added during benchmark ${index}.pdf`)
    fs.writeFileSync(target, 'new')
    changed.push(target)
  }
  // A new file is searchable as soon as the change notification is handled.
  started = performance.now()
  for (;;) {
    const found = await call('GET', `/v1/search?q=${encodeURIComponent(`Added during benchmark ${changes - 1}`)}&limit=5`)
    if (found.total > 0) break
    if (performance.now() - started > 30_000) break
    await wait(20)
  }
  note(`new file found via watcher (ms, ${changes} added)`, round(performance.now() - started))
  for (const target of changed.slice(0, changes / 2)) fs.rmSync(target)
  for (const target of changed.slice(changes / 2)) fs.appendFileSync(target, ' changed')
  const renamedFrom = folders[1] ?? folders[0]
  const renamedTo = `${renamedFrom} renamed`
  await rename(renamedFrom, renamedTo)
  rescanStarted = Date.now()
  started = performance.now()
  await call('POST', '/v1/index/rescan', { rootId: id })
  await untilReady(call, id, rescanStarted)
  note('rescan after changes (ms)', round(performance.now() - started))
  const afterChanges = await rootOf(call, id)
  const expectedFiles = root.files + changes / 2
  note('entries after changes', { files: afterChanges.files, expected: expectedFiles, correct: afterChanges.files === expectedFiles })
  if (afterChanges.files !== expectedFiles) explain(companion, id)
  await rename(renamedTo, renamedFrom)
  for (const target of changed.slice(changes / 2)) fs.rmSync(target)

  // 9. Restart: how fast the library is back, and how long the catch-up check takes.
  await companion.close()
  started = performance.now()
  rescanStarted = Date.now()
  companion = await start()
  ;({ call, timed } = await client(companion))
  const restored = await rootOf(call, id)
  const restoredMs = performance.now() - started
  const firstTree = await timed('GET', `/v1/roots/${id}/tree`)
  note('restart: library listed (ms)', { ms: round(restoredMs), files: restored.files })
  note('restart: folder tree shown (ms)', round(restoredMs + firstTree.ms))
  await untilReady(call, id, rescanStarted)
  note('restart: catch-up check done (ms)', round(performance.now() - started))

  // 10. An interrupted first scan: the app closes halfway, then starts again.
  await companion.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
  dataDir = path.join(work, 'data-interrupted')
  companion = await start()
  ;({ call, timed } = await client(companion))
  const second = (await call('POST', '/v1/roots', { path: library, name: 'Interrupted', recursive: true, maxDepth: null })).root.id
  const interruptAt = Math.floor((root.files + root.folders) / 2)
  for (;;) {
    const status = await call('GET', '/v1/status')
    const scanned = status.index.current?.scanned ?? 0
    const current = status.roots.find((item) => item.id === second)
    if (scanned >= interruptAt || current.status === 'ready') break
    await wait(5)
  }
  const partial = (await rootOf(call, second)).files
  await companion.close()
  started = performance.now()
  rescanStarted = Date.now()
  companion = await start()
  ;({ call, timed } = await client(companion))
  const recovered = await untilReady(call, second, rescanStarted)
  note('interrupted scan: resumed to complete (ms)', { ms: round(performance.now() - started), filesBefore: partial, filesAfter: recovered.files, correct: recovered.files === root.files })
  await companion.extractor.idle(60 * 60_000)

  const indexBytes = fs.statSync(path.join(dataDir, 'index.sqlite')).size + (fs.existsSync(path.join(dataDir, 'index.sqlite-wal')) ? fs.statSync(path.join(dataDir, 'index.sqlite-wal')).size : 0)
  note('index size on disk (MB)', round(indexBytes / 1024 / 1024, 1))
  await companion.close()

  results.machine = `${os.cpus()[0]?.model} x${os.cpus().length}, ${Math.round(os.totalmem() / 1024 ** 3)} GB RAM, ${process.platform} ${os.release()}, Node ${process.version}`
  console.log(`Machine: ${results.machine}`)
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    clearInterval(sampler)
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 5 })
    if (!keep) fs.rmSync(library, { recursive: true, force: true, maxRetries: 5 })
  })
