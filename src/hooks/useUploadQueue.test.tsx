// @vitest-environment happy-dom
/**
 * Runs the real upload queue and the real Google Drive client against a fake
 * Drive that follows the upload protocol (multipart, resumable sessions with
 * 308 + Range, status queries with "bytes * /size"). Connection drops, expired
 * tokens, reloads and lost replies are injected to check nothing is lost or
 * uploaded twice.
 */
import { act, createElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewDocumentMetadata, VaultDocument } from '../types/document'
import type { VaultUser } from '../types/user'

// ─── Fake services ────────────────────────────────────────────────────────────
const records = new Map<string, NewDocumentMetadata>()
const recordWrites: string[] = []
let failNextRecordWrite = false
const storedFiles = new Map<string, File>()

vi.mock('../services/firestore', () => ({
  createDocumentRecord: vi.fn(async (metadata: NewDocumentMetadata, id: string) => {
    recordWrites.push(id)
    records.set(id, metadata)
    if (failNextRecordWrite) {
      // Written, but the reply never arrives.
      failNextRecordWrite = false
      throw new TypeError('Failed to fetch')
    }
    return { id }
  }),
  createFolderRecord: vi.fn(async ({ name }: { name: string }) => ({ id: `folder-record-${name}` })),
}))
vi.mock('../services/users', () => ({
  getUserProfile: vi.fn(async () => ({ driveFolderId: 'vault-root' })),
  updateUserDriveConnection: vi.fn(async () => undefined),
}))
vi.mock('../services/auth', () => ({ clearDriveAccessToken: vi.fn() }))
vi.mock('../services/contentIndex', () => ({ queueContentIndex: vi.fn() }))
vi.mock('../utils/compressor', () => ({
  compressFile: vi.fn(async (file: File) => ({ blob: file, originalSize: file.size, compressedSize: file.size, savedPercentage: 0 })),
}))
vi.mock('../services/uploadFileStore', () => ({
  UPLOAD_STORE_MAX_BYTES: 2 * 1024 * 1024 * 1024,
  saveUploadFiles: vi.fn(async (_owner: string, entries: Array<{ id: string; file: File }>) => {
    for (const { id, file } of entries) storedFiles.set(id, file)
    return new Set(entries.map((entry) => entry.id))
  }),
  loadUploadFiles: vi.fn(async () => new Map(storedFiles)),
  deleteUploadFiles: vi.fn(async (ids: string[]) => ids.forEach((id) => storedFiles.delete(id))),
}))

// ─── Fake Google Drive ────────────────────────────────────────────────────────
interface DriveFileRecord {
  id: string
  name: string
  parent: string
  bytes: Uint8Array
}

const drive = {
  online: true,
  validToken: 'token-1',
  files: [] as DriveFileRecord[],
  sessions: new Map<string, { name: string; parent: string; size: number; parts: Uint8Array[]; received: number }>(),
  /** Fail the Nth chunk PUT from now (0 = next) with a network error, and go offline. */
  dropOnChunk: -1,
  /** Throttle: delay per response in ms. */
  latency: 1,
  chunkPuts: 0,
  bytesSent: 0,
  reset() {
    this.online = true
    this.validToken = 'token-1'
    this.files = []
    this.sessions.clear()
    this.dropOnChunk = -1
    this.chunkPuts = 0
    this.bytesSent = 0
  },
}

async function toBytes(body: unknown): Promise<Uint8Array> {
  if (body == null) return new Uint8Array()
  if (typeof body === 'string') return new TextEncoder().encode(body)
  return new Uint8Array(await (body as Blob).arrayBuffer())
}

class FakeXHR {
  status = 0
  responseText = ''
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  onabort: (() => void) | null = null
  private method = ''
  private url = ''
  private headers: Record<string, string> = {}
  private responseHeaders: Record<string, string> = {}
  private aborted = false

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value
  }
  getResponseHeader(name: string) {
    return this.responseHeaders[name.toLowerCase()] ?? null
  }
  abort() {
    this.aborted = true
    this.onabort?.()
  }
  send(body: unknown) {
    void this.handle(body)
  }

  private respond(status: number, json?: unknown, headers: Record<string, string> = {}) {
    if (this.aborted) return
    this.status = status
    this.responseText = json === undefined ? '' : JSON.stringify(json)
    this.responseHeaders = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
    this.onload?.()
  }

  private async handle(body: unknown) {
    await new Promise((resolve) => setTimeout(resolve, drive.latency))
    if (this.aborted) return
    if (!drive.online) {
      this.onerror?.()
      return
    }
    if (this.headers.authorization !== `Bearer ${drive.validToken}`) {
      this.respond(401, { error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError' }] } })
      return
    }

    const bytes = await toBytes(body)
    if (this.method === 'POST' && this.url.includes('uploadType=multipart')) {
      const text = new TextDecoder().decode(bytes)
      const meta = JSON.parse(text.match(/\{"name".*?\}(?=\r\n)/)![0]) as { name: string; parents: string[] }
      const content = text.split(/\r\n\r\n/)[2].replace(/\r\n--document_vault_[0-9a-f-]+--$/, '')
      this.upload.onprogress?.({ lengthComputable: true, loaded: bytes.length, total: bytes.length })
      const file = addDriveFile(meta.name, meta.parents[0], new TextEncoder().encode(content))
      this.respond(200, driveFileJson(file))
      return
    }
    if (this.method === 'POST' && this.url.includes('uploadType=resumable')) {
      const meta = JSON.parse(new TextDecoder().decode(bytes)) as { name: string; parents: string[] }
      const id = `s${drive.sessions.size + 1}`
      drive.sessions.set(id, { name: meta.name, parent: meta.parents[0], size: Number(this.headers['x-upload-content-length']), parts: [], received: 0 })
      this.respond(200, undefined, { Location: `https://upload.fake/session/${id}` })
      return
    }
    if (this.method === 'PUT' && this.url.startsWith('https://upload.fake/session/')) {
      const session = drive.sessions.get(this.url.split('/').pop()!)
      if (!session) {
        this.respond(404, { error: { code: 404, message: 'Not found' } })
        return
      }
      const range = this.headers['content-range']
      const query = range.match(/^bytes \*\/(\d+)$/)
      if (!query) {
        if (drive.dropOnChunk === 0) {
          drive.dropOnChunk = -1
          drive.online = false
          // Part of the chunk was on the wire when the connection died.
          this.upload.onprogress?.({ lengthComputable: true, loaded: Math.floor(bytes.length / 2), total: bytes.length })
          this.onerror?.()
          return
        }
        if (drive.dropOnChunk > 0) drive.dropOnChunk -= 1
        const [, start] = range.match(/^bytes (\d+)-(\d+)\/(\d+)$/)!.map(Number)
        expect(start).toBe(session.received)
        drive.chunkPuts += 1
        drive.bytesSent += bytes.length
        this.upload.onprogress?.({ lengthComputable: true, loaded: bytes.length, total: bytes.length })
        session.parts.push(bytes)
        session.received += bytes.length
      }
      if (session.received >= session.size) {
        const all = new Uint8Array(session.size)
        let offset = 0
        for (const part of session.parts) {
          all.set(part, offset)
          offset += part.length
        }
        const existing = drive.files.find((file) => file.id === `drive-${this.url.split('/').pop()}`)
        this.respond(200, driveFileJson(existing ?? addDriveFile(session.name, session.parent, all, `drive-${this.url.split('/').pop()}`)))
        return
      }
      this.respond(308, undefined, session.received > 0 ? { Range: `bytes=0-${session.received - 1}` } : {})
      return
    }
    this.respond(400, { error: { code: 400, message: `Unexpected ${this.method} ${this.url}` } })
  }
}

function addDriveFile(name: string, parent: string, bytes: Uint8Array, id = `drive-${drive.files.length + 1}`) {
  const file = { id, name, parent, bytes }
  drive.files.push(file)
  return file
}

function driveFileJson(file: DriveFileRecord) {
  return { id: file.id, name: file.name, mimeType: 'application/octet-stream', size: String(file.bytes.length) }
}

async function fakeFetch(input: string | URL, init: RequestInit = {}) {
  const url = String(input)
  await new Promise((resolve) => setTimeout(resolve, drive.latency))
  if (!drive.online) throw new TypeError('Failed to fetch')
  if (init.mode === 'no-cors') return new Response(null, { status: 200 })
  const auth = new Headers(init.headers).get('Authorization')
  if (auth !== `Bearer ${drive.validToken}`) {
    return Response.json({ error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError' }] } }, { status: 401 })
  }
  const query = new URL(url).searchParams.get('q') ?? ''
  if (init.method === 'POST') {
    const meta = JSON.parse(String(init.body)) as { name: string; parents?: string[] }
    return Response.json(driveFileJson(addDriveFile(meta.name, meta.parents?.[0] ?? 'root', new Uint8Array())))
  }
  const name = query.match(/name='((?:[^'\\]|\\.)*)'/)?.[1]
  const parent = query.match(/'([^']+)' in parents/)?.[1]
  const matches = drive.files.filter((file) => file.name === name && (!parent || file.parent === parent))
  return Response.json({ files: matches.slice(0, 1).map(driveFileJson) })
}

// ─── Harness ──────────────────────────────────────────────────────────────────
const { UploadQueueProvider, useUploadQueue } = await import('./useUploadQueue')
type QueueApi = ReturnType<typeof useUploadQueue>

const user: VaultUser = { uid: 'user-1', displayName: 'Tester', email: 't@example.com', photoURL: '' }
const probe = { api: null as unknown as QueueApi }
let root: Root | null = null
let container: HTMLElement

function Probe() {
  const value = useUploadQueue()
  useEffect(() => {
    probe.api = value
  })
  return null
}

function render(accessToken: string | null, documents: VaultDocument[] = []) {
  act(() => {
    root!.render(createElement(UploadQueueProvider, { user, accessToken, documents, children: createElement(Probe) }))
  })
}

async function waitFor(condition: () => boolean, timeoutMs = 15000) {
  const startedAt = Date.now()
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(`Timed out. Stats: ${JSON.stringify(probe.api.stats)}`)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25))
    })
  }
}

function makeFile(name: string, size: number, seed = 1) {
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i += 1) bytes[i] = 97 + ((i * 7 + seed) % 26)
  return new File([bytes], name, { type: 'application/octet-stream' })
}

async function sameBytes(file: File, bytes: Uint8Array) {
  const expected = new Uint8Array(await file.arrayBuffer())
  if (expected.length !== bytes.length) return false
  for (let i = 0; i < expected.length; i += 1) if (expected[i] !== bytes[i]) return false
  return true
}

const MB = 1024 * 1024

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  drive.reset()
  records.clear()
  recordWrites.length = 0
  failNextRecordWrite = false
  storedFiles.clear()
  localStorage.clear()
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
  vi.stubGlobal('fetch', fakeFetch)
  container = document.createElement('div')
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.unstubAllGlobals()
})

describe('upload queue against a fake Google Drive', () => {
  it('uploads small files and a large file in chunks, each exactly once', async () => {
    render('token-1')
    const small = [makeFile('a.txt', 2000, 1), makeFile('b.txt', 3000, 2), makeFile('c.txt', 100, 3)]
    const large = makeFile('big.bin', 12 * MB, 4)
    act(() => probe.api.enqueueFiles([...small, large], 'Other', '', null))
    act(() => probe.api.start())
    await waitFor(() => probe.api.stats.completed === 4)

    expect(probe.api.stats.failed).toBe(0)
    expect(drive.files.filter((file) => file.parent !== 'vault-root')).toHaveLength(4)
    expect(records.size).toBe(4)
    const bigInDrive = drive.files.find((file) => file.name === 'big.bin')!
    expect(await sameBytes(large, bigInDrive.bytes)).toBe(true)
    // 12 MB in 8 MB chunks.
    expect(drive.chunkPuts).toBe(2)
    for (const file of small) {
      expect(await sameBytes(file, drive.files.find((f) => f.name === file.name)!.bytes)).toBe(true)
    }
    // Uploaded files no longer keep a stored copy.
    expect(storedFiles.size).toBe(0)
  })

  it('pauses on a dropped connection and continues from the last stored chunk', async () => {
    render('token-1')
    const large = makeFile('video.bin', 20 * MB, 5)
    act(() => probe.api.enqueueFiles([large], 'Other', '', null))
    drive.dropOnChunk = 1 // the second chunk dies mid-way
    act(() => probe.api.start())

    await waitFor(() => probe.api.stats.pausedForNetwork)
    expect(probe.api.items[0].status).toBe('PAUSED')
    expect(probe.api.items[0].pauseReason).toBe('offline')
    expect(probe.api.stats.failed).toBe(0)
    expect(probe.api.items[0].progress).toBeGreaterThan(15)

    drive.online = true
    await waitFor(() => probe.api.stats.completed === 1)

    const inDrive = drive.files.filter((file) => file.name === 'video.bin')
    expect(inDrive).toHaveLength(1)
    expect(await sameBytes(large, inDrive[0].bytes)).toBe(true)
    // Only the lost chunk was sent again: 20 MB went over in 3 accepted chunks, one session.
    expect(drive.bytesSent).toBe(20 * MB)
    expect(drive.sessions.size).toBe(1)
    expect(records.size).toBe(1)
  }, 30000)

  it('pauses every upload when the Drive token expires and resumes by itself after reconnecting', async () => {
    render('token-1')
    const files = [makeFile('one.bin', 9 * MB, 6), makeFile('two.txt', 500, 7), makeFile('three.txt', 600, 8)]
    act(() => probe.api.enqueueFiles(files, 'Other', '', null))
    drive.validToken = 'token-2' // token-1 has expired at Google
    act(() => probe.api.start())

    await waitFor(() => probe.api.stats.pausedForAuth && !probe.api.stats.running)
    expect(probe.api.stats.failed).toBe(0)
    expect(probe.api.stats.completed).toBe(0)

    render('token-2')
    await waitFor(() => probe.api.stats.completed === 3)
    expect(probe.api.stats.pausedForAuth).toBe(false)
    expect(drive.files.filter((file) => file.parent !== 'vault-root')).toHaveLength(3)
    expect(records.size).toBe(3)
  }, 30000)

  it('survives a page reload mid-upload: the stored session and file copy continue it', async () => {
    render('token-1')
    const large = makeFile('archive.bin', 20 * MB, 9)
    act(() => probe.api.enqueueFiles([large], 'Other', '', null))
    drive.dropOnChunk = 1
    act(() => probe.api.start())
    await waitFor(() => probe.api.stats.pausedForNetwork)

    // "Reload": the provider and its memory go away; only storage remains.
    act(() => root!.unmount())
    root = createRoot(container)
    drive.online = true
    render('token-1')

    await waitFor(() => probe.api.stats.completed === 1)
    const inDrive = drive.files.filter((file) => file.name === 'archive.bin')
    expect(inDrive).toHaveLength(1)
    expect(await sameBytes(large, inDrive[0].bytes)).toBe(true)
    expect(drive.sessions.size).toBe(1)
    expect(records.size).toBe(1)
  }, 30000)

  it('asks for files whose copies were lost, and finishes them when they are added again', async () => {
    const folderFile = makeFile('report.txt', 1200, 10)
    Object.defineProperty(folderFile, 'webkitRelativePath', { value: 'Projects/report.txt' })
    render(null)
    act(() => probe.api.enqueueFiles([folderFile], 'Other', '', null, 'Projects'))
    act(() => root!.unmount())
    storedFiles.clear() // e.g. signed out, or the batch was too large to keep

    root = createRoot(container)
    render('token-1')
    await waitFor(() => probe.api.stats.needsFile === 1)
    expect(probe.api.items[0].status).toBe('PAUSED')
    expect(probe.api.stats.failed).toBe(0)

    act(() => probe.api.enqueueFiles([folderFile], 'Other', '', null, 'Projects'))
    expect(probe.api.stats.total).toBe(1)
    act(() => probe.api.start())
    await waitFor(() => probe.api.stats.completed === 1)
    expect(await sameBytes(folderFile, drive.files.find((f) => f.name === 'report.txt')!.bytes)).toBe(true)
  }, 30000)

  it('does not create a second record when the first write succeeded but its reply was lost', async () => {
    render('token-1')
    act(() => probe.api.enqueueFiles([makeFile('notes.txt', 800, 11)], 'Other', '', null))
    failNextRecordWrite = true
    act(() => probe.api.start())
    await waitFor(() => probe.api.stats.completed === 1)

    expect(drive.files.filter((file) => file.name === 'notes.txt')).toHaveLength(1)
    // Written twice under the same id: one record.
    expect(recordWrites).toHaveLength(2)
    expect(new Set(recordWrites).size).toBe(1)
    expect(records.size).toBe(1)
  }, 30000)

  it('uploads a folder of 300 files over a slow connection, at most three at a time', async () => {
    drive.latency = 40
    let inFlight = 0
    let peak = 0
    const send = FakeXHR.prototype.send
    vi.spyOn(FakeXHR.prototype, 'send').mockImplementation(function (this: FakeXHR, body: unknown) {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      const done = () => {
        inFlight -= 1
      }
      const self = this as unknown as { onload: (() => void) | null; onerror: (() => void) | null }
      const onload = self.onload
      const onerror = self.onerror
      self.onload = () => {
        done()
        onload?.()
      }
      self.onerror = () => {
        done()
        onerror?.()
      }
      send.call(this, body)
    })

    render('token-1')
    const files = Array.from({ length: 300 }, (_, index) => {
      const file = makeFile(`page-${index}.txt`, 200 + index, index)
      Object.defineProperty(file, 'webkitRelativePath', { value: `Scans/${index < 150 ? 'A' : 'B'}/page-${index}.txt` })
      return file
    })
    const startedAt = Date.now()
    act(() => probe.api.enqueueFiles(files, 'Other', '', null, 'Scans'))
    act(() => probe.api.start())
    await waitFor(() => probe.api.stats.completed === 300, 60000)
    const seconds = (Date.now() - startedAt) / 1000

    expect(probe.api.stats.failed).toBe(0)
    expect(peak).toBeLessThanOrEqual(3)
    expect(records.size).toBe(300)
    expect(new Set([...records.values()].map((record) => record.originalName)).size).toBe(300)
    expect(probe.api.stats.folders.Scans.status).toBe('COMPLETED')
    // Each file costs a lookup, an upload and a record at 40 ms per request; one at a
    // time that is over 36 s, so finishing well under that shows the overlap works.
    expect(seconds).toBeLessThan(25)
  }, 90000)

  it('skips files already in the vault instead of uploading duplicates', async () => {
    const existing = {
      id: 'doc-1',
      fileType: 'text',
      fileSize: 700,
      originalName: 'done.txt',
      parentId: null,
      driveFileId: 'drive-old',
      driveFolderId: 'vault-root',
    } as unknown as VaultDocument
    render('token-1', [existing])
    act(() => probe.api.enqueueFiles([makeFile('done.txt', 700, 12)], 'Other', '', null))
    act(() => probe.api.start())
    await waitFor(() => probe.api.stats.completed === 1)
    expect(drive.files.filter((file) => file.name === 'done.txt')).toHaveLength(0)
    expect(records.size).toBe(0)
  })

  async function recordWithSameContents(file: File) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))
    const contentHash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
    return { id: 'doc-copy', name: 'Old name.txt', originalName: 'Old name.txt', fileType: 'text', fileSize: file.size, contentHash, folderPath: 'Work', isDeleted: false } as unknown as VaultDocument
  }

  it('asks before uploading a file whose contents are already in the vault under another name', async () => {
    const file = makeFile('renamed.txt', 900, 5)
    const other = makeFile('different.txt', 900, 6)
    render('token-1', [await recordWithSameContents(file)])
    act(() => probe.api.enqueueFiles([file, other], 'Other', '', null))
    act(() => probe.api.start())
    await waitFor(() => probe.api.stats.completed === 1 && probe.api.stats.duplicates === 1)
    const waiting = probe.api.items.find((item) => item.pauseReason === 'duplicate')!
    expect(waiting.duplicateOf).toMatchObject({ id: 'doc-copy', name: 'Old name.txt', folderPath: 'Work' })
    expect(drive.files.map((entry) => entry.name).filter((name) => name.endsWith('.txt'))).toEqual(['different.txt'])

    act(() => probe.api.resolveDuplicate(waiting.id, 'upload'))
    await waitFor(() => probe.api.stats.completed === 2)
    expect(drive.files.map((entry) => entry.name).filter((name) => name.endsWith('.txt')).sort()).toEqual(['different.txt', 'renamed.txt'])
    expect(await sameBytes(file, drive.files.find((entry) => entry.name === 'renamed.txt')!.bytes)).toBe(true)
  })

  it('drops suspected duplicates the owner chooses to skip', async () => {
    const file = makeFile('again.txt', 800, 9)
    render('token-1', [await recordWithSameContents(file)])
    act(() => probe.api.enqueueFiles([file], 'Other', '', null))
    act(() => probe.api.start())
    await waitFor(() => probe.api.stats.duplicates === 1)
    act(() => probe.api.resolveDuplicate('all', 'skip'))
    await waitFor(() => probe.api.items.length === 0)
    expect(drive.files.filter((entry) => entry.name.endsWith('.txt'))).toHaveLength(0)
    expect(records.size).toBe(0)
  })
})
