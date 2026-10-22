// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The indexer's database calls, recorded instead of sent.
const calls = vi.hoisted(() => ({ upserts: [] as unknown[], deletes: [] as string[], existing: null as null | { extractor_version: number } }))

vi.mock('./firebase', () => ({ auth: { currentUser: { uid: 'alice' } } }))
vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: calls.existing }) }) }),
      upsert: async (row: unknown) => {
        calls.upserts.push(row)
        return { error: null }
      },
      delete: () => ({
        eq: async (_column: string, id: string) => {
          calls.deletes.push(id)
          return { error: null }
        },
      }),
    }),
  },
}))
vi.mock('./ocr', () => ({
  isOcrEnabled: () => true,
  looksScanned: (text: string | null) => (text ?? '').replace(/\W/g, '').length < 40,
  recognizeImage: vi.fn(async () => 'Invoice 4471 total due'),
  recognizePdf: vi.fn(async () => ''),
}))

const { queueContentIndex, EXTRACTOR_VERSION } = await import('./contentIndex')
const ocr = await import('./ocr')

async function settle() {
  for (let index = 0; index < 20; index += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('content indexing with OCR', () => {
  beforeEach(() => {
    calls.upserts = []
    calls.deletes = []
    calls.existing = null
    vi.stubGlobal('requestIdleCallback', (run: () => void) => run())
  })

  it('stores the words read from a picture, marked as OCR', async () => {
    queueContentIndex({ id: 'img-1', name: 'Scan', originalName: 'Scan.png', mimeType: 'image/png', fileType: 'image' }, new Blob([new Uint8Array([1, 2, 3])]))
    await settle()
    expect(ocr.recognizeImage).toHaveBeenCalled()
    expect(calls.upserts).toEqual([
      expect.objectContaining({ document_id: 'img-1', content: 'Invoice 4471 total due', source: 'ocr', extractor_version: EXTRACTOR_VERSION }),
    ])
  })

  it('stores nothing when OCR finds no words', async () => {
    queueContentIndex({ id: 'pdf-1', name: 'Blank', originalName: 'Blank.png', mimeType: 'image/png', fileType: 'image' }, new Blob([new Uint8Array([1])]))
    vi.mocked(ocr.recognizeImage).mockResolvedValueOnce('   ')
    await settle()
    expect(calls.upserts).toEqual([])
  })

  it('re-indexes a replaced file and clears text the new version does not have', async () => {
    calls.existing = { extractor_version: EXTRACTOR_VERSION }
    const target = { id: 'doc-1', name: 'Notes', originalName: 'Notes.txt', mimeType: 'text/plain', fileType: 'text' as const }
    queueContentIndex(target, new Blob(['first version text']))
    await settle()
    expect(calls.upserts).toEqual([])

    queueContentIndex(target, new Blob(['second version text']), { force: true })
    await settle()
    expect(calls.upserts).toEqual([expect.objectContaining({ document_id: 'doc-1', content: 'second version text', source: 'extracted' })])

    queueContentIndex({ ...target, originalName: 'Notes.zip', mimeType: 'application/zip', fileType: 'other' as never }, new Blob([new Uint8Array([9])]), { force: true })
    await settle()
    expect(calls.deletes).toEqual(['doc-1'])
  })
})
