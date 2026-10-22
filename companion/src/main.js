import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { openStore } from './store.js'
import { Indexer } from './indexer.js'
import { createCompanionServer, VERSION } from './server.js'
import { openWithDefaultApp, pickFolder, revealInExplorer } from './launcher.js'

export const DEFAULT_PORT = 47615
const DEFAULT_ORIGINS = [
  'https://documents-vault.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
]

export function defaultDataDir() {
  return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'DocumentVault Companion')
}

function loadConfig(file) {
  let stored = {}
  try {
    stored = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    stored = {}
  }
  return {
    allowedOrigins: Array.isArray(stored.allowedOrigins) ? stored.allowedOrigins : [...DEFAULT_ORIGINS],
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
export async function startCompanion({ dataDir: requestedDataDir = defaultDataDir(), port = DEFAULT_PORT, extraOrigins = [], launcher, log = console.log } = {}) {
  fs.mkdirSync(requestedDataDir, { recursive: true })
  // Long form (no 8.3 short names), so protected-location checks compare like with like.
  const dataDir = fs.realpathSync.native(requestedDataDir)
  const configFile = path.join(dataDir, 'config.json')
  const config = loadConfig(configFile)
  for (const origin of extraOrigins) if (!config.allowedOrigins.includes(origin)) config.allowedOrigins.push(origin)
  const saveConfig = saveConfigTo(configFile)
  saveConfig(config)

  const store = openStore(path.join(dataDir, 'index.sqlite'))
  const indexer = new Indexer(store, { dataDir })
  const { server, newPairingCode } = createCompanionServer({
    store,
    indexer,
    config,
    saveConfig,
    launcher: launcher ?? { open: openWithDefaultApp, reveal: revealInExplorer, pickFolder },
    dataDir,
    port,
    log,
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  indexer.start()

  return {
    port: server.address().port,
    store,
    indexer,
    config,
    newPairingCode,
    async close() {
      await new Promise((resolve) => server.close(resolve))
      server.closeAllConnections?.()
      await indexer.close()
      store.close()
    },
    revokeAll() {
      config.tokens = []
      saveConfig(config)
    },
    version: VERSION,
  }
}
