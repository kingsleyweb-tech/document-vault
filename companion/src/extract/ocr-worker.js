// Text recognition (OCR) worker thread. Receives a document's bytes (never a
// path: the main thread opens and checks every file), finds the pages that
// have no text layer, draws each one and reads its words with Tesseract.
// Results go back one page at a time, so the main thread can stop between
// pages when access to the library changes.
//
// Everything runs from files shipped with the app: the Tesseract engine, the
// English language data (langPath) and the drawing library. Nothing is
// fetched; a missing language file is an error, never a download.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { parentPort } from 'node:worker_threads'
import { MIN_PAGE_LETTERS, letters } from './formats.js'

const require = createRequire(import.meta.url)
// Pictures of pages are drawn at most this large, as in the web app's OCR.
const MAX_PIXELS = 25_000_000

let canvasModule = null
let pdfjs = null
let engine = null

async function loadPdfjs() {
  // The drawing library must be loaded before pdf.js, which uses its DOMMatrix and Path2D.
  canvasModule ??= require('@napi-rs/canvas')
  globalThis.DOMMatrix ??= canvasModule.DOMMatrix
  globalThis.Path2D ??= canvasModule.Path2D
  globalThis.ImageData ??= canvasModule.ImageData
  pdfjs ??= await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href)
  return pdfjs
}

async function getEngine(langPath) {
  if (engine) return engine
  if (!fs.existsSync(path.join(langPath, 'eng.traineddata.gz'))) {
    throw Object.assign(new Error('The English text recognition data is missing from this installation.'), { code: 'OCR_DATA_MISSING' })
  }
  const Tesseract = require('tesseract.js')
  // cacheMethod 'none': the language data is read from langPath and never written or downloaded.
  engine = await Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, { langPath, cacheMethod: 'none', gzip: true })
  return engine
}

async function recognize(langPath, image) {
  const worker = await getEngine(langPath)
  const { data } = await worker.recognize(image)
  const text = (data.text ?? '').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return { text, confidence: Math.round(data.confidence ?? 0) }
}

async function readPdf({ id, bytes, skip, maxPages, scale, langPath }) {
  // Missing language data fails the whole document, before any page is tried.
  await getEngine(langPath)
  const { getDocument } = await loadPdfjs()
  const task = getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    disableAutoFetch: true,
    disableStream: true,
    stopAtErrors: false,
    verbosity: 0,
  })
  const document = await task.promise
  try {
    // The pages without a usable text layer, in reading order.
    const scanned = []
    for (let number = 1; number <= document.numPages && scanned.length < maxPages; number += 1) {
      const page = await document.getPage(number)
      const content = await page.getTextContent()
      const text = content.items.map((item) => item.str ?? '').join(' ')
      if (letters(text) < MIN_PAGE_LETTERS) scanned.push(number)
      page.cleanup()
    }
    parentPort.postMessage({ id, type: 'plan', total: scanned.length, truncated: document.numPages > maxPages && scanned.length >= maxPages })
    for (const [index, number] of scanned.entries()) {
      if (index < skip) continue
      try {
        const page = await document.getPage(number)
        const base = page.getViewport({ scale: 1 })
        const fit = Math.sqrt(MAX_PIXELS / (base.width * base.height))
        const viewport = page.getViewport({ scale: Math.min(scale, fit) })
        const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
        const context = canvas.getContext('2d')
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({ canvas, canvasContext: context, viewport }).promise
        page.cleanup()
        const result = await recognize(langPath, canvas.toBuffer('image/png'))
        parentPort.postMessage({ id, type: 'page', index, page: number, ...result })
      } catch (error) {
        parentPort.postMessage({ id, type: 'page-error', index, page: number, error: describe(error) })
      }
    }
  } finally {
    await task.destroy()
  }
}

async function readImage({ id, bytes, langPath }) {
  await getEngine(langPath)
  canvasModule ??= require('@napi-rs/canvas')
  parentPort.postMessage({ id, type: 'plan', total: 1, truncated: false })
  try {
    const image = new canvasModule.Image()
    image.src = Buffer.from(bytes)
    let input = Buffer.from(bytes)
    const pixels = image.width * image.height
    if (!pixels) throw Object.assign(new Error('This picture could not be read.'), { code: 'MALFORMED' })
    if (pixels > MAX_PIXELS) {
      const fit = Math.sqrt(MAX_PIXELS / pixels)
      const canvas = canvasModule.createCanvas(Math.floor(image.width * fit), Math.floor(image.height * fit))
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
      input = canvas.toBuffer('image/png')
    }
    const result = await recognize(langPath, input)
    parentPort.postMessage({ id, type: 'page', index: 0, page: null, ...result })
  } catch (error) {
    parentPort.postMessage({ id, type: 'page-error', index: 0, page: null, error: describe(error) })
  }
}

function describe(error) {
  return { code: error?.code ?? error?.name ?? 'ERROR', message: String(error?.message ?? error).slice(0, 300) }
}

parentPort.on('message', async (message) => {
  if (message.type === 'shutdown') {
    await engine?.terminate().catch(() => {})
    engine = null
    parentPort.postMessage({ type: 'shutdown' })
    return
  }
  try {
    if (message.kind === 'image') await readImage(message)
    else await readPdf(message)
    parentPort.postMessage({ id: message.id, type: 'done' })
  } catch (error) {
    parentPort.postMessage({ id: message.id, type: 'error', error: describe(error) })
  }
})
