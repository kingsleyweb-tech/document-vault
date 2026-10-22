// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultDocument } from '../types/document'

const offline = { blob: null as Blob | null }

vi.mock('./offlineStore', () => ({
  getOfflinePreview: vi.fn(async () => null),
  getOfflineBlob: vi.fn(async () => (offline.blob ? { blob: offline.blob } : null)),
  saveOfflinePreview: vi.fn(async () => undefined),
  saveOfflineBlob: vi.fn(async () => undefined),
}))

const { loadDocumentPreview } = await import('./documentViewer')

function record(overrides: Partial<VaultDocument>): VaultDocument {
  return {
    id: overrides.id ?? 'doc',
    name: 'Doc',
    originalName: 'doc.txt',
    mimeType: 'text/plain',
    fileType: 'text',
    driveFileId: overrides.driveFileId ?? `drive-${Math.random()}`,
    ...overrides,
  } as VaultDocument
}

beforeEach(() => {
  offline.blob = null
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('no network expected')
  }))
})

describe('loadDocumentPreview', () => {
  it('shows Drive’s own preview at once for formats the browser cannot render', async () => {
    const preview = await loadDocumentPreview('token', record({ originalName: 'old.doc', mimeType: 'application/msword', fileType: 'word' }))
    expect(preview.kind).toBe('embed')
    expect(preview.embedUrl).toContain('/preview')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('opens a copy saved in this browser without a Drive connection', async () => {
    offline.blob = new Blob(['saved text'], { type: 'text/plain' })
    const preview = await loadDocumentPreview(null, record({}))
    expect(preview.text).toBe('saved text')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('asks for Drive, rather than waiting forever, when nothing is cached and there is no token', async () => {
    await expect(loadDocumentPreview(null, record({}))).rejects.toMatchObject({ status: 401, reason: 'tokenMissing' })
  })
})
