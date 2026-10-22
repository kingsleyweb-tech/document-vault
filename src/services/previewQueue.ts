import type { VaultDocument } from '../types/document'
import { ensureCacheMatchesVersion, forgetCachedFile, getPreviewKind, loadDocumentPreview } from './documentViewer'
import { downloadDriveFile, isDriveAuthorizationError } from './googleDrive'
import {
  deleteOfflineBlob,
  deletePageImages,
  getAllPreviewMeta,
  getOfflineBlob,
  hasStoredOriginal,
  listStoredFileIds,
  loadStoredOriginals,
  saveOfflineBlob,
  savePageImage,
  saveSlideSnapshot,
  savePreviewMeta,
  type PreviewMeta,
} from './offlineStore'
import { openPdf, pictureWidthFor, readPageSizes, renderPagePicture, yieldToBrowser } from './pdfPages'
import { setOpenDocument } from './foreground'
import { isMemoryConstrained } from '../utils/device'

/**
 * Background preparation of previews on this device.
 *
 * After an upload, after a document is opened, and for a few recently used
 * documents each session, the original is kept on this device and the work
 * that makes opening slow is done ahead of time: a PDF's page sizes and first
 * pages are drawn and stored, a deck is checked and counted, Word and
 * spreadsheet files are converted. The viewer then shows the document at once.
 *
 * Jobs live in IndexedDB (`previewMeta`), so they survive reloads; a job cut
 * off mid-way is simply run again. One job runs at a time, between frames, so
 * the app stays responsive. Nothing here runs code from a document: PDFs are
 * drawn by pdf.js with scripting off, decks are read as XML, macros are never
 * touched.
 *
 * Previews never leave this device. Another device prepares its own from the
 * original in Google Drive (see docs/AUDIT.md, section L).
 */

/** Raise when the preparation steps change; older results are then redone. */
export const PIPELINE_VERSION = 1

export const PRIORITY = { upload: 30, open: 20, backfill: 10 } as const
export type PreparationReason = keyof typeof PRIORITY

const MAX_ATTEMPTS = 3
/** Times a job may be cut off by the page closing before it is given up on. */
const MAX_INTERRUPTIONS = 2
/** Phones prepare PDFs up to this many pages; longer ones are left to a computer. */
const MAX_PDF_PAGES_CONSTRAINED = 300
const RETRY_DELAY_MS = 30_000
/** PDFs are prepared up to this size; other files are kept up to the offline copy limit. */
const MAX_PDF_BYTES = 300 * 1024 * 1024
const MAX_OTHER_BYTES = 100 * 1024 * 1024
/** Background backfill downloads nothing larger, to spare data and storage. */
const MAX_BACKFILL_BYTES = 40 * 1024 * 1024
/** Documents picked for backfill per session. */
const BACKFILL_PER_SESSION = 25
const MAX_BACKFILL_BYTES_CONSTRAINED = 15 * 1024 * 1024
const BACKFILL_PER_SESSION_CONSTRAINED = 6
/** First pages drawn ahead of time; the rest are drawn as they are viewed. */
export const PREPARED_PAGES = 3
const DEFAULT_BUDGET_BYTES = 500 * 1024 * 1024
const MAX_BUDGET_BYTES = 2 * 1024 * 1024 * 1024
const BACKFILL_SETTING_KEY = 'documentVault.previewBackfill'

type Listener = () => void

const metas = new Map<string, PreviewMeta>()
const library = new Map<string, VaultDocument>()
const originals = new Map<string, Blob>()
/** Uploads not yet in the library list, which may arrive a moment later. */
const recentUploads = new Map<string, VaultDocument & { addedAt?: number }>()
const RECENT_UPLOAD_MS = 10 * 60 * 1000
const listeners = new Set<Listener>()
let getToken: () => string | null = () => null
let started: Promise<void> | null = null
let running = false
let wakeTimer: number | undefined
let foregroundFileId: string | null = null
let backfillDoneForSession = false
let current: { fileId: string; priority: number; controller: AbortController; paused?: boolean } | null = null
let sessionEpoch = 0
/** A token Google refused; jobs waiting for Drive wait for a different one. */
let rejectedToken: string | null = null

function emit() {
  listeners.forEach((listener) => listener())
}

/** Called when anything about preparation changes. Returns an unsubscribe function. */
export function subscribePreviewStatus(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getPreviewStatus(fileId: string): PreviewMeta | undefined {
  return metas.get(fileId)
}

export function getAllPreviewStatus(): PreviewMeta[] {
  return [...metas.values()]
}

export function isBackfillEnabled() {
  try {
    return localStorage.getItem(BACKFILL_SETTING_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setBackfillEnabled(enabled: boolean) {
  try {
    localStorage.setItem(BACKFILL_SETTING_KEY, enabled ? 'on' : 'off')
  } catch {
    // Without storage the default (on) applies.
  }
  if (enabled) {
    backfillDoneForSession = false
    void planBackfill()
  }
  emit()
}

/** Loads saved jobs. Jobs cut off by a reload or crash go back in the queue. */
export function startPreviewQueue(options: { getAccessToken: () => string | null }) {
  getToken = options.getAccessToken
  started ??= (async () => {
    const epoch = sessionEpoch
    await loadStoredOriginals()
    const saved = await getAllPreviewMeta()
    if (epoch !== sessionEpoch) return
    for (const meta of saved) {
      // A job still marked as running was cut off. If the job itself made the
      // browser end the page (iOS does when memory runs out), starting it again
      // would end the page again on every load, so a phone leaves it to a
      // computer and a computer tries it once more.
      if (meta.status === 'processing') {
        const interruptions = (meta.interruptions ?? 0) + 1
        Object.assign(meta, { interruptions, status: 'queued' })
        if (isMemoryConstrained()) {
          Object.assign(meta, { status: 'unsupported', error: 'The page closed while preparing this on this device; it still opens normally' })
        } else if (interruptions >= MAX_INTERRUPTIONS) {
          Object.assign(meta, { status: 'failed', error: 'The page closed while preparing this' })
        }
        void savePreviewMeta(meta)
      }
      // Jobs added while loading are newer than what was saved.
      if (!metas.has(meta.fileId)) metas.set(meta.fileId, meta)
    }
    emit()
    if (typeof window !== 'undefined') {
      window.addEventListener('online', wake)
    }
    wake()
  })()
  return started
}

/** Tells the queue that Drive access may have changed (a new token, or none). */
export function notifyDriveAccessChanged() {
  wake()
}

/**
 * The full list of the user's documents. Files that are gone from it (deleted,
 * trashed, missing in Drive, or belonging to someone else) lose everything
 * stored for them; `complete` must only be true for a list confirmed by the
 * server, never a partial one from cache.
 */
export function syncLibrary(documents: VaultDocument[], { complete }: { complete: boolean }) {
  library.clear()
  for (const record of documents) {
    if (record.fileType === 'folder' || record.isDeleted || record.driveMissing || !record.driveFileId) continue
    library.set(record.driveFileId, record)
  }
  const now = Date.now()
  for (const [fileId, record] of recentUploads) {
    const listed = documents.some((item) => item.driveFileId === fileId)
    if (listed || now - (record.addedAt ?? 0) > RECENT_UPLOAD_MS) recentUploads.delete(fileId)
    else library.set(fileId, record)
  }
  if (complete) void pruneRemovedFiles()
  if (complete) void planBackfill()
  wake()
}

async function pruneRemovedFiles() {
  await started
  const epoch = sessionEpoch
  const stored = await listStoredFileIds()
  if (epoch !== sessionEpoch) return
  const gone = stored.filter((fileId) => !library.has(fileId))
  for (const fileId of gone) {
    if (current?.fileId === fileId) current.controller.abort()
    metas.delete(fileId)
    originals.delete(fileId)
    await forgetCachedFile(fileId)
  }
  if (gone.length) emit()
}

/**
 * Queues a document for preparation. Safe to call repeatedly: a document whose
 * current version is already prepared is left alone, and a queued one only
 * moves up if the new reason is more urgent. `original` is the file just
 * uploaded, which saves downloading it again.
 */
export function enqueuePreview(record: VaultDocument, reason: PreparationReason, original?: Blob) {
  const fileId = record.driveFileId
  if (!fileId || record.fileType === 'folder') return
  library.set(fileId, record)
  if (reason === 'upload') recentUploads.set(fileId, { ...record, addedAt: Date.now() })
  if (original) originals.set(fileId, original)
  const now = Date.now()
  const version = record.version ?? 1
  const existing = metas.get(fileId)
  const upToDate = existing && existing.version === version && existing.pipelineVersion === PIPELINE_VERSION

  // Failed or partly drawn: tried again when the document is opened, not by the background sweep.
  const retry = existing?.status === 'failed' || existing?.status === 'partial'
  if (upToDate && !retry) {
    const raised = PRIORITY[reason] > existing.priority
    const next = { ...existing, lastAccess: reason === 'backfill' ? existing.lastAccess : now, priority: Math.max(existing.priority, PRIORITY[reason]) }
    metas.set(fileId, next)
    void savePreviewMeta(next)
    if (raised) wake()
    return
  }
  if (upToDate && retry && reason === 'backfill') return

  const meta: PreviewMeta = {
    fileId,
    documentId: record.id,
    name: record.name,
    version,
    pipelineVersion: PIPELINE_VERSION,
    status: 'queued',
    priority: PRIORITY[reason],
    attempts: 0,
    // A new version starts empty: the old version's files were removed with it.
    originalBytes: existing?.version === version ? existing.originalBytes : 0,
    imageBytes: existing?.version === version ? existing.imageBytes : 0,
    queuedAt: now,
    updatedAt: now,
    lastAccess: reason === 'backfill' ? (existing?.lastAccess ?? 0) : now,
  }
  metas.set(fileId, meta)
  void savePreviewMeta(meta)
  emit()
  wake()
}

/** Tries a failed document again. */
export function retryPreview(fileId: string) {
  const meta = metas.get(fileId)
  const record = library.get(fileId)
  if (!meta || !record) return
  update(meta, { status: 'queued', attempts: 0, error: undefined, notBefore: undefined, waitingFor: undefined })
  wake()
}

/** Removes a document's job; anything already stored stays until the file changes or is removed. */
export function cancelPreview(fileId: string) {
  if (current?.fileId === fileId) current.controller.abort()
  const meta = metas.get(fileId)
  if (meta && (meta.status === 'queued' || meta.status === 'processing')) {
    update(meta, { status: 'failed', error: 'Cancelled', priority: 0 })
  }
}

/**
 * While a document is open, backlog work waits so it does not compete with
 * drawing the pages the user is looking at; uploads still proceed.
 */
export function setForegroundDocument(fileId: string | null) {
  foregroundFileId = fileId
  setOpenDocument(fileId)
  // A job that downloads from Drive would compete with the document being
  // opened (or download the same file twice), so it stops and waits its turn.
  // Uploads work from bytes already in the browser and carry on.
  if (fileId && current && (current.priority < PRIORITY.upload || isMemoryConstrained()) && !current.paused) {
    current.paused = true
    current.controller.abort()
  }
  if (!fileId) wake()
}

/** Deletes every prepared preview and stored original on this device. Documents in Drive are untouched. */
export async function clearPreparedPreviews() {
  current?.controller.abort()
  const ids = await listStoredFileIds()
  for (const fileId of ids) await forgetCachedFile(fileId)
  metas.clear()
  originals.clear()
  backfillDoneForSession = true
  emit()
}

// Sign-out deletes the database; the queue's memory goes with it.
if (typeof window !== 'undefined') {
  window.addEventListener('documentVault.sessionEnded', () => {
    sessionEpoch += 1
    current?.controller.abort()
    metas.clear()
    library.clear()
    originals.clear()
    recentUploads.clear()
    started = null
    backfillDoneForSession = false
    emit()
  })
}

function update(meta: PreviewMeta, changes: Partial<PreviewMeta>) {
  const latest = metas.get(meta.fileId)
  // A job removed while it ran (file deleted, session ended) is not brought back.
  if (!latest) return meta
  const next: PreviewMeta = { ...latest, ...changes, updatedAt: Date.now() }
  metas.set(meta.fileId, next)
  void savePreviewMeta(next)
  emit()
  return next
}

async function planBackfill() {
  if (backfillDoneForSession || !isBackfillEnabled() || !started) return
  // Saved jobs must be known first, or prepared documents would be queued again.
  await started
  if (backfillDoneForSession) return
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  if (connection?.saveData) return
  backfillDoneForSession = true
  // Phones and tablets prepare only a few small documents.
  const constrained = isMemoryConstrained()
  const maxBytes = constrained ? MAX_BACKFILL_BYTES_CONSTRAINED : MAX_BACKFILL_BYTES
  const candidates = [...library.values()]
    .filter((record) => !metas.has(record.driveFileId) && (record.fileSize ?? 0) <= maxBytes)
    .filter((record) => {
      const kind = getPreviewKind(record)
      return kind !== 'embed' && kind !== 'fallback' && kind !== 'media'
    })
    .sort((first, second) => backfillScore(second) - backfillScore(first))
    .slice(0, constrained ? BACKFILL_PER_SESSION_CONSTRAINED : BACKFILL_PER_SESSION)
  candidates.forEach((record) => enqueuePreview(record, 'backfill'))
}

/** Favourites and recently opened documents first, then recently uploaded ones. */
function backfillScore(record: VaultDocument) {
  const viewed = record.lastViewedAt?.toMillis() ?? 0
  const uploaded = record.uploadedAt?.toMillis?.() ?? 0
  return (record.isFavorite ? 4e12 : 0) + Math.max(viewed, uploaded / 2)
}

function wake() {
  if (typeof window === 'undefined' || !started) return
  window.clearTimeout(wakeTimer)
  wakeTimer = window.setTimeout(() => void pump(), 0)
}

function pickNext(): PreviewMeta | null {
  const now = Date.now()
  const online = typeof navigator === 'undefined' || navigator.onLine
  let best: PreviewMeta | null = null
  let soonest = Infinity
  for (const meta of metas.values()) {
    if (meta.status !== 'queued' || !library.has(meta.fileId)) continue
    if (meta.notBefore && meta.notBefore > now) {
      soonest = Math.min(soonest, meta.notBefore)
      continue
    }
    const local = originals.has(meta.fileId) || hasStoredOriginal(meta.fileId)
    const token = getToken()
    if (!local && (!online || !token)) continue
    if (meta.waitingFor === 'drive' && (!token || token === rejectedToken)) continue
    // The open document included: the viewer is drawing its pages right now.
    // Phones hold one document at a time, so even uploads wait for the viewer to close.
    if (foregroundFileId && (meta.priority < PRIORITY.upload || isMemoryConstrained())) continue
    if (!best || meta.priority > best.priority || (meta.priority === best.priority && meta.queuedAt < best.queuedAt)) best = meta
  }
  if (!best && soonest < Infinity && typeof window !== 'undefined') {
    window.clearTimeout(wakeTimer)
    wakeTimer = window.setTimeout(() => void pump(), soonest - now + 50)
  }
  return best
}

async function pump() {
  if (running) return
  running = true
  try {
    await started
    for (;;) {
      await yieldToBrowser(2000)
      const next = pickNext()
      if (!next) break
      await runJob(next)
      await enforceStorageBudget()
    }
  } finally {
    running = false
  }
}

async function runJob(queued: PreviewMeta) {
  const fileId = queued.fileId
  const record = library.get(fileId)
  if (!record) return
  const epoch = sessionEpoch
  const controller = new AbortController()
  const job = { fileId, priority: queued.priority, controller, paused: false }
  current = job
  let meta = update(queued, { status: 'processing', waitingFor: undefined })

  try {
    await ensureCacheMatchesVersion(record)
    const kind = getPreviewKind(record)
    const isPptx = /\.pptx$/i.test(record.originalName ?? '') || record.mimeType.includes('presentationml')

    if (kind === 'embed') {
      update(meta, { status: 'unsupported', previewKind: kind, error: "Shown with Google Drive's own viewer" })
      return
    }
    if (kind === 'fallback' || (kind === 'office' && !isPptx && !/\.(docx|xlsx|xlsm|xls|ods|csv|tsv)$/i.test(record.originalName ?? ''))) {
      update(meta, { status: 'unsupported', previewKind: kind, error: 'No preview for this kind of file; it can be downloaded' })
      return
    }
    const limit = kind === 'pdf' ? MAX_PDF_BYTES : MAX_OTHER_BYTES
    if ((record.fileSize ?? 0) > limit) {
      update(meta, { status: 'unsupported', previewKind: kind, error: 'Too large to prepare on this device; it opens from Google Drive' })
      return
    }

    const original = await obtainOriginal(record, controller.signal)
    if (epoch !== sessionEpoch || controller.signal.aborted) return
    if (!original) {
      update(meta, { status: 'queued', waitingFor: 'drive' })
      return
    }
    // Originals within the offline limit are stored by the upload or download that produced them.
    meta = update(meta, { originalBytes: original.size <= MAX_OTHER_BYTES ? original.size : 0, previewKind: kind })

    if (kind === 'pdf') {
      await preparePdf(meta, original, controller.signal)
    } else if (isPptx) {
      const { openPptx, snapshotPptx } = await import('./pptx')
      const deck = await openPptx(original)
      try {
        // The first slides are kept as data so they show before the file has loaded.
        const { snapshot, media } = await snapshotPptx(deck)
        const data = new Blob([JSON.stringify(snapshot)], { type: 'application/json' })
        const imageBytes = await saveSlideSnapshot(fileId, data, media)
        update(meta, {
          status: 'ready',
          slideCount: deck.slides.length,
          previewKind: 'presentation',
          imageBytes: (metas.get(fileId)?.imageBytes ?? 0) + imageBytes,
          error: undefined,
        })
      } finally {
        deck.dispose()
      }
    } else {
      // Converts Word, spreadsheet, text and web pages and stores the result
      // next to the original, as opening the document would.
      const preview = await loadDocumentPreview(getToken(), record)
      if (preview.objectUrl) URL.revokeObjectURL(preview.objectUrl)
      update(meta, { status: 'ready', previewKind: preview.kind, error: undefined })
    }
    originals.delete(fileId)
    requestPersistentStorage()
  } catch (error) {
    if (epoch !== sessionEpoch || controller.signal.aborted) return
    if (isDriveAuthorizationError(error)) {
      rejectedToken = getToken()
      update(meta, { status: 'queued', waitingFor: 'drive' })
    } else if (isNetworkError(error)) {
      update(meta, { status: 'queued', waitingFor: 'network', notBefore: Date.now() + RETRY_DELAY_MS })
    } else {
      const attempts = meta.attempts + 1
      console.warn(`Preparing "${record.name}" failed (attempt ${attempts}):`, error)
      update(meta, attempts >= MAX_ATTEMPTS
        ? { status: 'failed', attempts, error: describeFailure(error) }
        : { status: 'queued', attempts, error: describeFailure(error), notBefore: Date.now() + RETRY_DELAY_MS * 2 ** (attempts - 1) })
    }
  } finally {
    if (current?.controller === controller) current = null
    // Paused for an opened document: back in the queue, not counted as an attempt.
    const latest = metas.get(fileId)
    if (job.paused && epoch === sessionEpoch && latest?.status === 'processing') update(latest, { status: 'queued' })
  }
}

async function obtainOriginal(record: VaultDocument, signal: AbortSignal): Promise<Blob | null> {
  const fileId = record.driveFileId
  const uploaded = originals.get(fileId)
  if (uploaded) {
    if (uploaded.size <= MAX_OTHER_BYTES) await saveOfflineBlob(fileId, record.originalName || record.name, record.mimeType, uploaded)
    return uploaded
  }
  const stored = await getOfflineBlob(fileId)
  if (stored?.blob) return stored.blob
  const token = getToken()
  if (!token) return null
  // Stored for offline use by the download itself when within the size limit.
  return downloadDriveFile(token, fileId, record.mimeType, record.mimeType, { signal })
}

async function preparePdf(meta: PreviewMeta, original: Blob, signal: AbortSignal) {
  const { pdf, task } = await openPdf(original)
  try {
    if (isMemoryConstrained() && pdf.numPages > MAX_PDF_PAGES_CONSTRAINED) {
      update(meta, { status: 'unsupported', pageCount: pdf.numPages, error: 'Too long to prepare on this device; it still opens normally' })
      return
    }
    const pageSizes = await readPageSizes(pdf, { signal })
    meta = update(meta, { pageCount: pdf.numPages, pageSizes })
    const width = pictureWidthFor(defaultPageDisplayWidth())
    let drawn = 0
    let imageBytes = 0
    const pages = Math.min(PREPARED_PAGES, pdf.numPages)
    for (let page = 1; page <= pages; page += 1) {
      if (signal.aborted) return
      try {
        imageBytes += await savePageImage(meta.fileId, page, width, await renderPagePicture(pdf, page, width))
        drawn += 1
      } catch (error) {
        console.warn(`Drawing page ${page} of "${meta.name}" failed:`, error)
      }
      await yieldToBrowser()
    }
    update(meta, {
      status: drawn === pages ? 'ready' : 'partial',
      imageBytes: (metas.get(meta.fileId)?.imageBytes ?? 0) + imageBytes,
      error: drawn === pages ? undefined : `${pages - drawn} of the first ${pages} pages could not be drawn`,
    })
  } finally {
    void task.destroy()
  }
}

/** Records that the viewer stored another page picture for this file. */
export function notePageImageStored(fileId: string, bytes: number) {
  const meta = metas.get(fileId)
  if (meta && bytes) update(meta, { imageBytes: meta.imageBytes + bytes })
}

/** The width a page is shown at in the viewer by default, matching its layout. */
export function defaultPageDisplayWidth() {
  if (typeof window === 'undefined') return 900
  const gutter = window.innerWidth <= 720 ? 16 : 48
  return Math.max(200, Math.min(900, window.innerWidth - gutter))
}

async function storageBudget() {
  try {
    const estimate = await navigator.storage?.estimate?.()
    if (estimate?.quota) return Math.min(MAX_BUDGET_BYTES, Math.floor(estimate.quota * 0.3))
  } catch {
    // Unknown quota: use the default.
  }
  return DEFAULT_BUDGET_BYTES
}

/**
 * Keeps prepared data within budget. The least recently used documents lose
 * their stored original first (it can be fetched again), then their pictures.
 */
export async function enforceStorageBudget(budget?: number) {
  const limit = budget ?? (await storageBudget())
  let total = 0
  for (const meta of metas.values()) total += meta.originalBytes + meta.imageBytes
  if (total <= limit) return
  const oldestFirst = [...metas.values()].sort((first, second) => first.lastAccess - second.lastAccess)
  for (const meta of oldestFirst) {
    if (total <= limit) return
    if (!meta.originalBytes || meta.fileId === foregroundFileId || meta.fileId === current?.fileId) continue
    await deleteOfflineBlob(meta.fileId)
    total -= meta.originalBytes
    update(meta, { originalBytes: 0 })
  }
  for (const meta of oldestFirst) {
    if (total <= limit) return
    if (!meta.imageBytes || meta.fileId === foregroundFileId || meta.fileId === current?.fileId) continue
    await deletePageImages(meta.fileId)
    total -= meta.imageBytes
    update(meta, { imageBytes: 0 })
  }
}

let persistRequested = false
function requestPersistentStorage() {
  if (persistRequested) return
  persistRequested = true
  // Asks the browser not to clear prepared previews under storage pressure.
  void navigator.storage?.persist?.().catch(() => false)
}

function isNetworkError(error: unknown) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  return error instanceof TypeError || (error instanceof Error && /network|failed to fetch/i.test(error.message))
}

function describeFailure(error: unknown) {
  if (error instanceof Error && error.message) {
    if (/password|encrypt/i.test(error.message)) return 'The file is password-protected'
    if (/invalid|corrupt|bad|unexpected|end of data|zip/i.test(error.message)) return 'The file looks damaged or is not in the format its name says'
    return error.message.slice(0, 160)
  }
  return 'Could not prepare this file'
}

/** For tests: forget everything held in memory. */
export function resetPreviewQueueForTests() {
  sessionEpoch += 1
  metas.clear()
  library.clear()
  originals.clear()
  recentUploads.clear()
  listeners.clear()
  started = null
  running = false
  current = null
  foregroundFileId = null
  setOpenDocument(null)
  backfillDoneForSession = false
  persistRequested = false
  rejectedToken = null
  if (typeof window !== 'undefined') window.clearTimeout(wakeTimer)
}

/** For tests: resolves once no job can run right now. */
export async function waitForPreviewQueueIdle() {
  for (let i = 0; i < 400; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    if (!running && !pickNext()) return
  }
  throw new Error('Preview queue did not settle')
}
