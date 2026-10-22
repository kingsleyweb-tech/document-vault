#!/usr/bin/env node
// Document Vault Companion: indexes folders you choose on this computer so the
// Document Vault web app can find and open local files without uploading them.
//
//   node companion/bin/companion.js                  start (shows a pairing code)
//   node companion/bin/companion.js --revoke-all     forget every paired browser, then start
//   node companion/bin/companion.js --allow-origin https://example.com
//   node companion/bin/companion.js --port 47615 --data-dir <folder>

import { DEFAULT_PORT, defaultDataDir, startCompanion } from '../src/main.js'

const args = process.argv.slice(2)
const option = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

const port = Number(option('--port') ?? DEFAULT_PORT)
const dataDir = option('--data-dir') ?? defaultDataDir()
const extraOrigins = args.flatMap((value, index) => (args[index - 1] === '--allow-origin' ? [value] : []))

const time = () => new Date().toLocaleTimeString()
let companion
try {
  companion = await startCompanion({ port, dataDir, extraOrigins, log: (message) => console.log(`[${time()}] ${message}`) })
} catch (error) {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. The companion may already be running.`)
  } else {
    console.error(error)
  }
  process.exit(1)
}

if (args.includes('--revoke-all')) {
  companion.revokeAll()
  console.log('All paired browsers were removed.')
}

console.log('')
console.log(`Document Vault Companion ${companion.version}`)
console.log(`Listening on http://127.0.0.1:${companion.port} (this computer only)`)
console.log(`Index and settings: ${dataDir}`)
console.log(`Allowed websites: ${companion.config.allowedOrigins.join(', ')}`)
console.log('')
console.log('To connect, open Document Vault > Desktop Files and enter the pairing code below.')
companion.newPairingCode()
console.log('Type "code" and press Enter for a new pairing code. Press Ctrl+C to stop.')
console.log('')

companion.indexer.on('scanned', ({ rootId, removed, ms }) => {
  const root = companion.store.getRoot(rootId)
  console.log(`[${time()}] Indexed ${root?.path ?? rootId} in ${(ms / 1000).toFixed(1)} s${removed ? `, ${removed} removed` : ''}`)
})

process.stdin.setEncoding('utf8')
process.stdin.on('data', (line) => {
  if (line.trim().toLowerCase() === 'code') companion.newPairingCode()
})

const stop = async () => {
  console.log('Stopping...')
  await companion.close()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
