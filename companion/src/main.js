import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createAccess } from './access.js'
import { Extractor } from './extractor.js'
import { Hasher } from './hasher.js'
import { OcrRunner } from './ocr.js'
import { openStore } from './store.js'
import { Indexer } from './indexer.js'
import { createCompanionServer, VERSION } from './server.js'
import { openWithDefaultApp, pickFolder, revealInExplorer } from './launcher.js'

export const DEFAULT_PORT = 47615
export const PRODUCTION_ORIGINS = ['https://documents-vault.vercel.app']
// Local development servers. Trusted only when the caller asks for them.
export const DEVELOPMENT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173']
const DEFAULT_ORIGINS = [...PRODUCTION_ORIGINS, ...DEVELOPMENT_ORIGINS]

export function defaultDataDir() {
  return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'DocumentVault Companion')
}

function loadConfig(file, origins) {
  let stored = {}
  try {
    stored = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    stored = {}
  }
  return {
    // A caller that names its origins (the desktop app) replaces the saved list,
    // so origins from earlier runs (old ports, development servers) are dropped.
    allowedOrigins: origins ? [...origins] : Array.isArray(stored.allowedOrigins) ? stored.allowedOrigins : [...DEFAULT_ORIGINS],
    tokens: Array.isArray(stored.tokens) ? stored.tokens : [],
  }
}

function saveConfigTo(file) {
  return (config) => {
    const temporary = file + '.tmp'
    fs.writeFileSync(temporary, JSON.stringify(config, null, 2), { mode: 0o600 })
    fs.renameSync(temporary, file)
  }
}

/** Starts the companion. Returns handles used by the CLI and by tests. */
export async function startCompanion({
  dataDir: requestedDataDir = defaultDataDir(),
  port = DEFAULT_PORT,
  origins = null,
  extraOrigins = [],
  launcher,
  extraction = {},
  recognition = {},
  hashing = {},
  reconcileMs,
  log = console.log,
} = {}) {
  fs.mkdirSync(requestedDataDir, { recursive: true })
  // Long form (no 8.3 short names), so protected-location checks compare like with like.
  const dataDir = fs.realpathSync.native(requestedDataDir)
  const configFile = path.join(dataDir, 'config.json')
  const config = loadConfig(configFile, origins)
  for (const origin of extraOrigins) if (!config.allowedOrigins.includes(origin)) config.allowedOrigins.push(origin)
  const saveConfig = saveConfigTo(configFile)
  saveConfig(config)

  const store = openStore(path.join(dataDir, 'index.sqlite'))
  if (store.recovered) log(`The index was damaged and has been started again. The old file was kept as ${store.recovered.movedTo}.`)
  const access = createAccess(store, { dataDir })
  const indexer = new Indexer(store, { dataDir, access, reconcileMs })
  const extractor = new Extractor(store, access, extraction)
  // Newly indexed or changed documents are queued for reading.
  indexer.on('indexed', (rootId) => extractor.queueRoot(rootId))
  indexer.on('scanned', ({ rootId }) => extractor.queueRoot(rootId))
  // Scanned pages are recognised after text reading, in libraries whose owner agreed.
  const ocr = new OcrRunner(store, access, extractor, recognition)
  // Files with the same size as another are compared, to list duplicate books.
  const hasher = new Hasher(store, access, extractor, hashing)
  indexer.on('scanned', () => hasher.schedule())
  const { server, newPairingCode } = createCompanionServer({
    store,
    indexer,
    extractor,
    ocr,
    hasher,
    access,
    config,
    saveConfig,
    launcher: launcher ?? { open: openWithDefaultApp, openLink: openWithDefaultApp, reveal: revealInExplorer, pickFolder },
    dataDir,
    port,
    log,
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  indexer.start()
  extractor.start()
  ocr.start()
  hasher.start()

  return {
    port: server.address().port,
    store,
    indexer,
    extractor,
    ocr,
    hasher,
    access,
    config,
    newPairingCode,
    async close() {
      await new Promise((resolve) => server.close(resolve))
      server.closeAllConnections?.()
      await indexer.close()
      await ocr.close()
      await hasher.close()
      await extractor.close()
      store.close()
    },
    revokeAll() {
      config.tokens = []
      saveConfig(config)
    },
    version: VERSION,
  }
}
