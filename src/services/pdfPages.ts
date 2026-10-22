import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'

// Shared by the viewer and background preparation: opening a PDF, reading
// page sizes and drawing pages as pictures. pdf.js parses in its worker; only
// drawing a page uses the main thread, one page at a time.

export async function openPdf(blob: Blob): Promise<{ pdf: PDFDocumentProxy; task: PDFDocumentLoadingTask }> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  // Scripts inside a PDF are never run: pdf.js only draws the pages, and XFA forms stay off.
  const task = pdfjs.getDocument({ data: await blob.arrayBuffer(), enableXfa: false })
  return { pdf: await task.promise, task }
}

/**
 * Each page's size in points as [width, height, width, height, ...], read in
 * chunks so very long documents do not hold up the page. `onChunk` receives
 * the sizes known so far.
 */
export async function readPageSizes(
  pdf: PDFDocumentProxy,
  { chunk = 50, signal, onChunk }: { chunk?: number; signal?: AbortSignal; onChunk?: (sizes: number[], upTo: number) => void } = {},
): Promise<number[]> {
  const sizes: number[] = []
  for (let start = 1; start <= pdf.numPages; start += chunk) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const end = Math.min(pdf.numPages, start + chunk - 1)
    const pages = await Promise.all(Array.from({ length: end - start + 1 }, (_, i) => pdf.getPage(start + i)))
    for (const page of pages) {
      const viewport = page.getViewport({ scale: 1 })
      sizes.push(Math.round(viewport.width * 100) / 100, Math.round(viewport.height * 100) / 100)
      page.cleanup()
    }
    onChunk?.(sizes, end)
    await yieldToBrowser()
  }
  return sizes
}

/** Picture widths are rounded up to these steps so stored pictures can be reused across window sizes. */
const WIDTH_STEP = 200
export const MAX_PAGE_PICTURE_WIDTH = 1800

export function pictureWidthFor(displayWidth: number) {
  const ratio = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2)
  return Math.min(MAX_PAGE_PICTURE_WIDTH, Math.max(WIDTH_STEP, Math.ceil((displayWidth * ratio) / WIDTH_STEP) * WIDTH_STEP))
}

/** Draws one page onto a new canvas at the given pixel width. */
export async function drawPage(pdf: PDFDocumentProxy, pageNumber: number, width: number): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(pageNumber)
  try {
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: width / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const canvasContext = canvas.getContext('2d')
    if (!canvasContext) throw new Error('Canvas is not available.')
    canvasContext.fillStyle = '#ffffff'
    canvasContext.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext, viewport }).promise
    return canvas
  } finally {
    page.cleanup()
  }
}

/** WebP where the browser can encode it, otherwise PNG. */
export async function encodePicture(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await encode(canvas, 'image/webp', 0.86)
  // Browsers that cannot write WebP fall back to PNG silently.
  return blob.type === 'image/webp' ? blob : encode(canvas, 'image/png')
}

/** Draws one page at the given pixel width as a picture file. */
export async function renderPagePicture(pdf: PDFDocumentProxy, pageNumber: number, width: number): Promise<Blob> {
  const canvas = await drawPage(pdf, pageNumber, width)
  try {
    return await encodePicture(canvas)
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

function encode(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the page.'))), type, quality)
  })
}

/** Lets the browser paint and handle input between steps of long work. */
export function yieldToBrowser(timeout = 50) {
  return new Promise<void>((resolve) => {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(() => resolve(), { timeout })
    } else {
      setTimeout(resolve, 0)
    }
  })
}
