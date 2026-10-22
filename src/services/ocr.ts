import type { Worker as TesseractWorker } from 'tesseract.js'

// Reads the words in pictures and scanned PDFs (OCR) so they can be searched.
// Tesseract runs in a web worker inside the browser, loaded from this site's
// own /ocr/ files (see vite.config.ts): nothing is sent to an outside service.
// It is free, but slow and memory hungry, so it runs in the background, one
// document at a time, and can be switched off in Settings.

const OCR_SETTING_KEY = 'documentVault.ocrEnabled'
export const OCR_SETTING_EVENT = 'documentVault.ocrSettingChanged'

/** Scanned PDFs are read up to this many pages. */
export const MAX_OCR_PAGES = 30
const MAX_IMAGE_PIXELS = 25_000_000
const IDLE_SHUTDOWN_MS = 60_000

export function isOcrEnabled() {
  try {
    return localStorage.getItem(OCR_SETTING_KEY) !== 'false'
  } catch {
    return true
  }
}

export function setOcrEnabled(enabled: boolean) {
  try {
    localStorage.setItem(OCR_SETTING_KEY, String(enabled))
  } catch {
    // Without storage the default applies.
  }
  window.dispatchEvent(new Event(OCR_SETTING_EVENT))
  if (!enabled) void shutDown()
}

let workerPromise: Promise<TesseractWorker> | null = null
let idleTimer: number | undefined
// One recognition at a time: each holds the engine's full memory.
let queue: Promise<unknown> = Promise.resolve()

function assetUrl(path: string) {
  return new URL(`${import.meta.env.BASE_URL}ocr/${path}`, window.location.href).href
}

function getWorker() {
  workerPromise ??= import('tesseract.js').then(({ createWorker, OEM }) =>
    createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: assetUrl('worker.min.js'),
      corePath: assetUrl('core'),
      langPath: assetUrl('lang'),
      workerBlobURL: false,
    }),
  )
  workerPromise.catch(() => {
    workerPromise = null
  })
  return workerPromise
}

async function shutDown() {
  const pending = workerPromise
  workerPromise = null
  if (pending) await (await pending.catch(() => null))?.terminate()
}

function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  window.clearTimeout(idleTimer)
  void run.finally(() => {
    window.clearTimeout(idleTimer)
    idleTimer = window.setTimeout(() => void shutDown(), IDLE_SHUTDOWN_MS)
  })
  return run
}

async function recognize(image: Blob | HTMLCanvasElement) {
  const worker = await getWorker()
  const result = await worker.recognize(image)
  return result.data.text
}

/** Text in a picture, or '' when it has none. */
export function recognizeImage(blob: Blob): Promise<string> {
  return exclusive(async () => {
    // Very large photos are scaled down first; OCR gains nothing beyond this size.
    const bitmap = await createImageBitmap(blob).catch(() => null)
    if (!bitmap) return ''
    try {
      const scale = Math.min(1, Math.sqrt(MAX_IMAGE_PIXELS / (bitmap.width * bitmap.height)))
      if (scale === 1) return await recognize(blob)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bitmap.width * scale)
      canvas.height = Math.round(bitmap.height * scale)
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      return await recognize(canvas)
    } finally {
      bitmap.close()
    }
  })
}

/** Text of a scanned PDF, read page by page from rendered images. */
export function recognizePdf(blob: Blob): Promise<string> {
  return exclusive(async () => {
    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
    const task = pdfjs.getDocument({ data: await blob.arrayBuffer() })
    const pdf = await task.promise
    const pages: string[] = []
    try {
      for (let number = 1; number <= Math.min(pdf.numPages, MAX_OCR_PAGES); number += 1) {
        const page = await pdf.getPage(number)
        // About 200 dpi for a letter-sized page, which Tesseract reads well.
        const viewport = page.getViewport({ scale: Math.min(2.8, 1700 / page.getViewport({ scale: 1 }).width) })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const canvasContext = canvas.getContext('2d')
        if (!canvasContext) break
        await page.render({ canvas, canvasContext, viewport }).promise
        page.cleanup()
        pages.push(await recognize(canvas))
        canvas.width = 0
        canvas.height = 0
      }
    } finally {
      void task.destroy()
    }
    return pages.join('\n\n')
  })
}

/** True when extracted text is too thin to be the real content, e.g. a scan with only a page number. */
export function looksScanned(text: string | null, pages = 1) {
  const letters = (text ?? '').replace(/[^\p{L}\p{N}]/gu, '').length
  return letters < Math.max(40, pages * 20)
}
