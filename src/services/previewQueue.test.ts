// @vitest-environment happy-dom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultDocument } from '../types/document'

// The heavy parts (pdf.js, Drive, the deck parser, Word conversion) are
// replaced by recorders; the queue, its IndexedDB state and the stores are real.
const fakes = vi.hoisted(() => ({
  pdfPages: 1200,
  openPdfCalls: 0,
  openPdfError: null as Error | null,
  rendered: [] as number[],
  downloads: [] as string[],
  downloadBlob: null as Blob | null,
  downloadError: null as unknown,
  /** While set, downloads wait until released or aborted. */
  holdDownloads: false,
  aborted: [] as string[],
  converted: [] as string[],
  slides: 1500,
  /** Whether the device counts as a phone or tablet with little memory. */
  constrained: false,
}))

vi.mock('../utils/device', () => ({ isMemoryConstrained: () => fakes.constrained }))

vi.mock('./documentViewer', async () => {
  const store = await import('./offlineStore')
  return {
    ensureCacheMatchesVersion: async () => undefined,
    forgetCachedFile: (fileId: string) => store.deleteOfflineEntries(fileId),
    getPreviewKind: (record: { originalName?: string }) => {
      const name = (record.originalName ?? '').toLowerCase()
      if (name.endsWith('.pdf')) return 'pdf'
      if (name.endsWith('.doc')) return 'embed'
      if (name.endsWith('.exe')) return 'fallback'
      if (/\.(docx|pptx|xlsx)$/.test(name)) return 'office'
      return 'text'
    },
    loadDocumentPreview: async (_token: string | null, record: { originalName: string }) => {
      fakes.converted.push(record.originalName)
      return { kind: 'word', blob: new Blob(), objectUrl: '', downloadable: true }
    },
  }
})

vi.mock('./googleDrive', () => ({
  downloadDriveFile: async (_token: string, fileId: string, _mime: string, _type: string, options?: { signal?: AbortSignal }) => {
    fakes.downloads.push(fileId)
    while (fakes.holdDownloads) {
      if (options?.signal?.aborted) {
        fakes.aborted.push(fileId)
        throw new DOMException('Aborted', 'AbortError')
      }
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    if (fakes.downloadError) throw fakes.downloadError
    return fakes.downloadBlob ?? new Blob(['%PDF-from-drive'], { type: 'application/pdf' })
  },
  isDriveAuthorizationError: (error: unknown) => (error as { status?: number })?.status === 401,
}))

vi.mock('./pdfPages', () => ({
  openPdf: async () => {
    fakes.openPdfCalls += 1
    if (fakes.openPdfError) throw fakes.openPdfError
    return { pdf: { numPages: fakes.pdfPages }, task: { destroy: async () => undefined } }
  },
  readPageSizes: async (pdf: { numPages: number }) => Array.from({ length: pdf.numPages }, () => [612, 792]).flat(),
  renderPagePicture: async (_pdf: unknown, page: number) => {
    fakes.rendered.push(page)
    return new Blob([new Uint8Array(1000)], { type: 'image/webp' })
  },
  pictureWidthFor: () => 1000,
  yieldToBrowser: async () => undefined,
}))

vi.mock('./pptx', () => ({
  openPptx: async () => ({
    slides: Array.from({ length: fakes.slides }, (_, index) => ({ index })),
    loadSlide: async () => ({}),
    dispose: () => undefined,
  }),
  snapshotPptx: async (deck: { slides: unknown[] }) => ({
    snapshot: { width: 960, height: 540, slides: deck.slides, models: [{ number: 1, text: ['Welcome'] }] },
    media: { 'ppt/media/image1.png': new Blob(['picture']) },
  }),
}))

const store = await import('./offlineStore')
const queue = await import('./previewQueue')

let token: string | null = 'token'

function record(id: string, originalName: string, extra: Partial<VaultDocument> = {}): VaultDocument {
  const at = { toDate: () => new Date(0), toMillis: () => 0 }
  return {
    id,
    ownerId: 'alice',
    name: originalName.replace(/\.\w+$/, ''),
    originalName,
    mimeType: originalName.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
    fileType: originalName.endsWith('.pdf') ? 'pdf' : 'other',
    fileSize: 1000,
    category: 'Other',
    description: '',
    driveFileId: `drive-${id}`,
    driveFolderId: 'folder',
    isFavorite: false,
    isDeleted: false,
    createdAt: at,
    uploadedAt: at,
    updatedAt: at,
    version: 1,
    ...extra,
  }
}

const pdfBytes = () => new Blob(['%PDF-1.7 uploaded'], { type: 'application/pdf' })

async function start(documents: VaultDocument[] = []) {
  await queue.startPreviewQueue({ getAccessToken: () => token })
  queue.syncLibrary(documents, { complete: false })
}

beforeEach(async () => {
  queue.resetPreviewQueueForTests()
  await store.clearOfflineStore()
  token = 'token'
  Object.assign(fakes, { pdfPages: 1200, openPdfCalls: 0, openPdfError: null, rendered: [], downloads: [], downloadBlob: null, downloadError: null, converted: [], slides: 1500, holdDownloads: false, aborted: [] })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('background preview preparation', () => {
  it('prepares an uploaded PDF from the uploaded bytes: page sizes, first pages, original kept', async () => {
    const doc = record('a', 'Report.pdf')
    await start([doc])
    queue.enqueuePreview(doc, 'upload', pdfBytes())
    await queue.waitForPreviewQueueIdle()

    const meta = queue.getPreviewStatus('drive-a')
    expect(meta).toMatchObject({ status: 'ready', pageCount: 1200, previewKind: 'pdf' })
    expect(meta?.pageSizes).toHaveLength(2400)
    expect(fakes.downloads).toEqual([])
    expect(fakes.rendered).toEqual([1, 2, 3])
    expect((await store.getPageImage('drive-a', 1))?.width).toBe(1000)
    expect(await store.getPageImage('drive-a', 4)).toBeNull()
    expect(store.hasStoredOriginal('drive-a')).toBe(true)
    // Saved, so a reload knows it is prepared.
    expect((await store.getPreviewMeta('drive-a'))?.status).toBe('ready')
  })

  it('does not prepare the same version twice', async () => {
    const doc = record('a', 'Report.pdf')
    await start([doc])
    queue.enqueuePreview(doc, 'upload', pdfBytes())
    await queue.waitForPreviewQueueIdle()
    queue.enqueuePreview(doc, 'open')
    queue.enqueuePreview(doc, 'backfill')
    await queue.waitForPreviewQueueIdle()
    expect(fakes.openPdfCalls).toBe(1)
  })

  it('prepares a new version again', async () => {
    const doc = record('a', 'Report.pdf')
    await start([doc])
    queue.enqueuePreview(doc, 'upload', pdfBytes())
    await queue.waitForPreviewQueueIdle()
    fakes.pdfPages = 7
    queue.enqueuePreview({ ...doc, version: 2 }, 'upload', pdfBytes())
    await queue.waitForPreviewQueueIdle()
    expect(fakes.openPdfCalls).toBe(2)
    expect(queue.getPreviewStatus('drive-a')).toMatchObject({ status: 'ready', version: 2, pageCount: 7 })
  })

  it('waits for Google Drive when the file is not on this device, then downloads it', async () => {
    token = null
    const doc = record('b', 'Scan.pdf')
    await start([doc])
    queue.enqueuePreview(doc, 'open')
    await queue.waitForPreviewQueueIdle()
    expect(queue.getPreviewStatus('drive-b')?.status).toBe('queued')
    expect(fakes.downloads).toEqual([])

    token = 'token'
    queue.notifyDriveAccessChanged()
    await queue.waitForPreviewQueueIdle()
    expect(fakes.downloads).toEqual(['drive-b'])
    expect(queue.getPreviewStatus('drive-b')?.status).toBe('ready')
  })

  it('treats a rejected Drive token as waiting, not failing', async () => {
    fakes.downloadError = Object.assign(new Error('Unauthorized'), { status: 401 })
    const doc = record('b', 'Scan.pdf')
    await start([doc])
    queue.enqueuePreview(doc, 'open')
    await queue.waitForPreviewQueueIdle()
    expect(queue.getPreviewStatus('drive-b')).toMatchObject({ status: 'queued', waitingFor: 'drive', attempts: 0 })
  })

  it('retries a failing file with growing delays, then marks it failed; "Try again" starts over', async () => {
    fakes.openPdfError = new Error('Invalid PDF structure')
    const doc = record('c', 'Broken.pdf')
    await start([doc])
    queue.enqueuePreview(doc, 'upload', pdfBytes())
    await queue.waitForPreviewQueueIdle()
    const first = queue.getPreviewStatus('drive-c')
    expect(first).toMatchObject({ status: 'queued', attempts: 1 })
    expect(first?.notBefore).toBeGreaterThan(Date.now())

    const realNow = Date.now
    let shift = 0
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + shift)
    for (const attempt of [2, 3]) {
      shift += 10 * 60 * 1000
      queue.notifyDriveAccessChanged()
      await queue.waitForPreviewQueueIdle()
      expect(queue.getPreviewStatus('drive-c')?.attempts).toBe(attempt)
    }
    expect(queue.getPreviewStatus('drive-c')).toMatchObject({ status: 'failed', error: 'The file looks damaged or is not in the format its name says' })
    expect(fakes.openPdfCalls).toBe(3)

    fakes.openPdfError = null
    queue.retryPreview('drive-c')
    await queue.waitForPreviewQueueIdle()
    expect(queue.getPreviewStatus('drive-c')?.status).toBe('ready')
  })

  it('continues jobs cut off by a reload or crash', async () => {
    const doc = record('d', 'Long.pdf')
    await store.saveOfflineBlob('drive-d', 'Long.pdf', 'application/pdf', pdfBytes())
    await store.savePreviewMeta({
      fileId: 'drive-d', documentId: 'd', name: 'Long', version: 1, pipelineVersion: queue.PIPELINE_VERSION, status: 'processing',
      priority: queue.PRIORITY.upload, attempts: 0, originalBytes: 0, imageBytes: 0, queuedAt: 1, updatedAt: 1, lastAccess: 1,
    })
    await start([doc])
    await queue.waitForPreviewQueueIdle()
    expect(queue.getPreviewStatus('drive-d')?.status).toBe('ready')
    expect(fakes.downloads).toEqual([])
  })

  it('gives up on a job that keeps closing the page, instead of crashing on every load', async () => {
    const doc = record('d2', 'Crashes.pdf')
    await store.saveOfflineBlob('drive-d2', 'Crashes.pdf', 'application/pdf', pdfBytes())
    await store.savePreviewMeta({
      fileId: 'drive-d2', documentId: 'd2', name: 'Crashes', version: 1, pipelineVersion: queue.PIPELINE_VERSION, status: 'processing',
      interruptions: 1, priority: queue.PRIORITY.upload, attempts: 0, originalBytes: 0, imageBytes: 0, queuedAt: 1, updatedAt: 1, lastAccess: 1,
    })
    await start([doc])
    await queue.waitForPreviewQueueIdle()
    expect(queue.getPreviewStatus('drive-d2')).toMatchObject({ status: 'failed', interruptions: 2 })
    expect(fakes.openPdfCalls).toBe(0)
  })

  it('on a phone, leaves a job that was cut off to a computer at once', async () => {
    fakes.constrained = true
    try {
      const doc = record('d3', 'Book.pdf')
      await store.saveOfflineBlob('drive-d3', 'Book.pdf', 'application/pdf', pdfBytes())
      await store.savePreviewMeta({
        fileId: 'drive-d3', documentId: 'd3', name: 'Book', version: 1, pipelineVersion: queue.PIPELINE_VERSION, status: 'processing',
        priority: queue.PRIORITY.upload, attempts: 0, originalBytes: 0, imageBytes: 0, queuedAt: 1, updatedAt: 1, lastAccess: 1,
      })
      await start([doc])
      await queue.waitForPreviewQueueIdle()
      expect(queue.getPreviewStatus('drive-d3')?.status).toBe('unsupported')
      // Opening it on the phone does not start it again.
      queue.enqueuePreview(doc, 'open')
      await queue.waitForPreviewQueueIdle()
      expect(queue.getPreviewStatus('drive-d3')?.status).toBe('unsupported')
      expect(fakes.openPdfCalls).toBe(0)
    } finally {
      fakes.constrained = false
    }
  })

  it('on a phone, leaves long PDFs to a computer', async () => {
    fakes.constrained = true
    try {
      const doc = record('d4', 'Book.pdf')
      await start([doc])
      queue.enqueuePreview(doc, 'upload', pdfBytes())
      await queue.waitForPreviewQueueIdle()
      expect(queue.getPreviewStatus('drive-d4')).toMatchObject({ status: 'unsupported', pageCount: 1200 })
      expect(fakes.rendered).toEqual([])
    } finally {
      fakes.constrained = false
    }
  })

  it('records slide counts for decks without running anything in them', async () => {
    const doc = record('e', 'Deck.pptx', { mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', fileType: 'presentation' })
    await start([doc])
    queue.enqueuePreview(doc, 'upload', new Blob(['PK']))
    await queue.waitForPreviewQueueIdle()
    expect(queue.getPreviewStatus('drive-e')).toMatchObject({ status: 'ready', slideCount: 1500, previewKind: 'presentation' })
  })

  it('keeps the first slides of a deck so they show before the file loads', async () => {
    const doc = record('e2', 'Deck.pptx', { mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', fileType: 'presentation' })
    await start([doc])
    queue.enqueuePreview(doc, 'open', new Blob(['PK']))
    await queue.waitForPreviewQueueIdle()
    const stored = await store.getPageImage('drive-e2', store.SLIDE_SNAPSHOT_PAGE)
    // Blob contents do not survive the test IndexedDB; the browser run checks them.
    expect(stored!.bytes).toBeGreaterThan(0)
    expect(Object.keys(stored!.media!)).toEqual(['ppt/media/image1.png'])
    expect(queue.getPreviewStatus('drive-e2')!.imageBytes).toBe(stored!.bytes)

    // Deleting the file removes the snapshot with everything else.
    queue.syncLibrary([], { complete: true })
    await vi.waitFor(async () => expect(await store.getPageImage('drive-e2', store.SLIDE_SNAPSHOT_PAGE)).toBeNull())
  })

  it('converts Word files ahead of time', async () => {
    const doc = record('f', 'Letter.docx')
    await start([doc])
    queue.enqueuePreview(doc, 'upload', new Blob(['PK']))
    await queue.waitForPreviewQueueIdle()
    expect(fakes.converted).toEqual(['Letter.docx'])
    expect(queue.getPreviewStatus('drive-f')?.status).toBe('ready')
  })

  it('stops a download in progress when a document is opened, and resumes after', async () => {
    const doc = record('p1', 'Background.pdf')
    await start([doc])
    fakes.holdDownloads = true
    queue.enqueuePreview(doc, 'open')
    await vi.waitFor(() => expect(fakes.downloads).toEqual(['drive-p1']))
    expect(queue.getPreviewStatus('drive-p1')?.status).toBe('processing')

    queue.setForegroundDocument('drive-other')
    await vi.waitFor(() => expect(queue.getPreviewStatus('drive-p1')?.status).toBe('queued'))
    expect(fakes.aborted).toEqual(['drive-p1'])
    expect(queue.getPreviewStatus('drive-p1')?.attempts).toBe(0)

    fakes.holdDownloads = false
    queue.setForegroundDocument(null)
    await vi.waitFor(() => expect(queue.getPreviewStatus('drive-p1')?.status).toBe('ready'))
  })

  it('marks files it cannot prepare as unsupported instead of failing', async () => {
    const docs = [
      record('g', 'Old.doc'),
      record('h', 'Setup.exe'),
      record('i', 'Huge.pdf', { fileSize: 400 * 1024 * 1024 }),
    ]
    await start(docs)
    docs.forEach((doc) => queue.enqueuePreview(doc, 'upload'))
    await queue.waitForPreviewQueueIdle()
    for (const doc of docs) expect(queue.getPreviewStatus(doc.driveFileId)?.status).toBe('unsupported')
    expect(fakes.downloads).toEqual([])
  })

  it('removes everything stored for files that left the library', async () => {
    const kept = record('j', 'Kept.pdf')
    const removed = record('k', 'Removed.pdf')
    await start([kept, removed])
    queue.enqueuePreview(kept, 'open', pdfBytes())
    queue.enqueuePreview(removed, 'open', pdfBytes())
    await queue.waitForPreviewQueueIdle()
    expect(store.hasStoredOriginal('drive-k')).toBe(true)

    // Deleted, or another account: not in the server's list any more.
    queue.syncLibrary([kept], { complete: true })
    await vi.waitFor(async () => expect(await store.getPreviewMeta('drive-k')).toBeNull())
    expect(await store.getOfflineBlob('drive-k')).toBeNull()
    expect(await store.getPageImage('drive-k', 1)).toBeNull()
    expect(queue.getPreviewStatus('drive-k')).toBeUndefined()
    expect(await store.getOfflineBlob('drive-j')).not.toBeNull()
  })

  it('never prunes from a list that may be partial', async () => {
    const doc = record('l', 'Kept.pdf')
    await start([doc])
    queue.enqueuePreview(doc, 'open', pdfBytes())
    await queue.waitForPreviewQueueIdle()
    queue.syncLibrary([], { complete: false })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await store.getOfflineBlob('drive-l')).not.toBeNull()
  })

  it('keeps a fresh upload that the library list does not show yet', async () => {
    const doc = record('m', 'New.pdf')
    await start([])
    queue.enqueuePreview(doc, 'upload', pdfBytes())
    await queue.waitForPreviewQueueIdle()
    queue.syncLibrary([], { complete: true })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await store.getOfflineBlob('drive-m')).not.toBeNull()
  })

  it('stays within the storage budget by dropping the least recently used originals first', async () => {
    const docs = ['n', 'o', 'p'].map((id) => record(id, `${id}.pdf`))
    await start(docs)
    for (const doc of docs) {
      queue.enqueuePreview(doc, 'open', new Blob([new Uint8Array(10_000)], { type: 'application/pdf' }))
      await queue.waitForPreviewQueueIdle()
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    // Each has 10 000 bytes of original and 3 000 of pictures.
    await queue.enforceStorageBudget(30_000)
    expect(queue.getPreviewStatus('drive-n')?.originalBytes).toBe(0)
    expect(await store.getOfflineBlob('drive-n')).toBeNull()
    expect(await store.getPageImage('drive-n', 1)).not.toBeNull()
    expect(await store.getOfflineBlob('drive-p')).not.toBeNull()
  })

  it('lets uploads through but holds back other work while a document is open', async () => {
    const open = record('q', 'Open.pdf')
    const later = record('r', 'Later.pdf')
    const uploaded = record('s', 'Uploaded.pdf')
    await start([open, later, uploaded])
    queue.setForegroundDocument('drive-q')
    queue.enqueuePreview(open, 'open', pdfBytes())
    queue.enqueuePreview(later, 'backfill', pdfBytes())
    queue.enqueuePreview(uploaded, 'upload', pdfBytes())
    await queue.waitForPreviewQueueIdle()
    expect(queue.getPreviewStatus('drive-s')?.status).toBe('ready')
    expect(queue.getPreviewStatus('drive-q')?.status).toBe('queued')
    expect(queue.getPreviewStatus('drive-r')?.status).toBe('queued')

    queue.setForegroundDocument(null)
    await queue.waitForPreviewQueueIdle()
    expect(queue.getPreviewStatus('drive-q')?.status).toBe('ready')
    expect(queue.getPreviewStatus('drive-r')?.status).toBe('ready')
  })

  it('backfills favourites and recently opened documents first, a limited number per visit', async () => {
    const at = (ms: number) => ({ toDate: () => new Date(ms), toMillis: () => ms })
    const docs = Array.from({ length: 40 }, (_, i) => record(`bf${i}`, `File ${i}.pdf`, { lastViewedAt: at(i * 1000) }))
    docs[0] = { ...docs[0], isFavorite: true }
    await start(docs)
    queue.syncLibrary(docs, { complete: true })
    await vi.waitFor(() => expect(queue.getAllPreviewStatus().length).toBe(25))
    const picked = new Set(queue.getAllPreviewStatus().map((meta) => meta.fileId))
    expect(picked.has('drive-bf0')).toBe(true)
    expect(picked.has('drive-bf39')).toBe(true)
    expect(picked.has('drive-bf1')).toBe(false)
    // Not planned twice in one visit.
    queue.syncLibrary(docs, { complete: true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(queue.getAllPreviewStatus().length).toBe(25)
  })

  it('does not backfill when turned off', async () => {
    queue.setBackfillEnabled(false)
    const docs = [record('t', 'One.pdf')]
    await start(docs)
    queue.syncLibrary(docs, { complete: true })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(queue.getAllPreviewStatus()).toEqual([])
    queue.setBackfillEnabled(true)
  })

  it('forgets everything at sign-out', async () => {
    const doc = record('u', 'Private.pdf')
    await start([doc])
    queue.enqueuePreview(doc, 'upload', pdfBytes())
    await queue.waitForPreviewQueueIdle()
    window.dispatchEvent(new Event('documentVault.sessionEnded'))
    await store.clearOfflineStore()
    expect(queue.getAllPreviewStatus()).toEqual([])
    expect(store.hasStoredOriginal('drive-u')).toBe(false)
    expect(await store.listStoredFileIds()).toEqual([])
  })
})

describe('page picture store', () => {
  it('keeps the sharper picture of a page', async () => {
    expect(await store.savePageImage('x', 1, 1000, new Blob([new Uint8Array(500)]))).toBe(500)
    expect(await store.savePageImage('x', 1, 600, new Blob([new Uint8Array(100)]))).toBe(0)
    expect((await store.getPageImage('x', 1))?.width).toBe(1000)
    expect(await store.savePageImage('x', 1, 1400, new Blob([new Uint8Array(800)]))).toBe(300)
  })

  it('removes all of a file and nothing of another', async () => {
    await store.savePageImage('x', 1, 1000, new Blob(['a']))
    await store.savePageImage('x', 2, 1000, new Blob(['b']))
    await store.savePageImage('y', 1, 1000, new Blob(['c']))
    await store.saveOfflineBlob('x', 'x.pdf', 'application/pdf', new Blob(['x']))
    expect((await store.listStoredFileIds()).sort()).toEqual(['x', 'y'])
    await store.deleteOfflineEntries('x')
    expect(await store.getPageImage('x', 2)).toBeNull()
    expect(await store.getOfflineBlob('x')).toBeNull()
    expect(await store.getPageImage('y', 1)).not.toBeNull()
    expect(await store.listStoredFileIds()).toEqual(['y'])
  })
})
