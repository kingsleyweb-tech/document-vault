// Extraction worker thread. Receives a document's bytes (never a path: the
// main thread opens and checks every file) and returns its text. It has no
// access to the index, the API or the file system paths of the libraries.
import { parentPort } from 'node:worker_threads'
import { extractDocument } from './formats.js'

parentPort.on('message', async ({ id, extension, bytes, options }) => {
  try {
    const result = await extractDocument(extension, new Uint8Array(bytes), options)
    parentPort.postMessage({ id, ok: true, result })
  } catch (error) {
    parentPort.postMessage({ id, ok: false, error: { code: error?.code ?? error?.name ?? 'ERROR', message: String(error?.message ?? error).slice(0, 300) } })
  }
})
