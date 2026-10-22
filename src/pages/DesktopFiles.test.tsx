// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VaultDocument } from '../types/document'

vi.mock('../hooks/useCompanion', () => ({
  useCompanion: () => ({ connection: 'offline', status: null, version: null, refresh: async () => {} }),
}))

const searchDocumentContent = vi.fn()
vi.mock('../services/contentIndex', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/contentIndex')>()),
  searchDocumentContent: (...args: unknown[]) => searchDocumentContent(...args),
}))

const { DesktopFiles } = await import('./DesktopFiles')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const stamp = { toDate: () => new Date('2026-10-01T10:00:00Z'), toMillis: () => Date.parse('2026-10-01T10:00:00Z') }
const doc = (id: string, name: string, extra: Partial<VaultDocument> = {}) =>
  ({
    id,
    ownerId: 'u',
    name,
    originalName: `${name}.pdf`,
    mimeType: 'application/pdf',
    fileType: 'pdf',
    fileSize: 1000,
    category: 'Work',
    description: '',
    driveFileId: `drive-${id}`,
    driveFolderId: '',
    isFavorite: false,
    isDeleted: false,
    createdAt: stamp,
    uploadedAt: stamp,
    updatedAt: stamp,
    parentId: null,
    isFolderRecord: false,
    ...extra,
  }) as unknown as VaultDocument

let container: HTMLElement | null = null
afterEach(() => {
  container?.remove()
  container = null
  searchDocumentContent.mockReset()
})

async function renderUploaded(documents: VaultDocument[], search: string) {
  container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<DesktopFiles documents={documents} allDocuments={documents} search={search} onOpenDocument={() => {}} />))
  const uploadedRadio = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((button) => button.textContent === 'Uploaded documents')
  await act(async () => uploadedRadio!.click())
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)))
  return container
}

describe('Desktop Files uploaded results', () => {
  it('adds documents found by their text, with a highlighted excerpt', async () => {
    const documents = [doc('a', 'Compressor manual'), doc('b', 'Site visit notes'), doc('c', 'Unrelated')]
    searchDocumentContent.mockResolvedValue({
      items: [
        { id: 'a', rank: 2, matchedContent: false, snippet: null, driveMissing: false },
        { id: 'b', rank: 1, matchedContent: true, snippet: 'checked the <<compressor>> valves', driveMissing: false },
        { id: 'gone', rank: 1, matchedContent: true, snippet: 'stale <<compressor>> row', driveMissing: false },
      ],
      total: 3,
    })
    const view = await renderUploaded(documents, 'compressor')

    expect(searchDocumentContent).toHaveBeenCalledWith('compressor', 30, 0, expect.any(AbortSignal))
    const rows = [...view.querySelectorAll('[aria-label="Uploaded documents"] > li')]
    expect(rows.map((row) => row.querySelector('.result-row__name')?.textContent)).toEqual(['Compressor manual', 'Site visit notes'])
    expect(rows[1].textContent).toContain('Found in the text')
    expect(rows[1].querySelector('mark')?.textContent).toBe('compressor')
    expect(rows[1].querySelector('.result-row__snippet')?.textContent).toBe('checked the compressor valves')
    // A database row for a document that is not in the library is never shown.
    expect(view.textContent).not.toContain('stale')
    for (const row of rows) expect(row.querySelector('.source-badge--vault')?.textContent).toBe('Uploaded')
  })

  it('labels documents missing from Drive and does not offer to view them', async () => {
    searchDocumentContent.mockResolvedValue({ items: [], total: 0 })
    const view = await renderUploaded([doc('a', 'Lost report', { driveMissing: true })], 'report')
    const row = view.querySelector('[aria-label="Uploaded documents"] > li')!
    expect(row.textContent).toContain('Missing from Drive')
    expect(row.querySelector<HTMLButtonElement>('.result-row__actions button')?.disabled).toBe(true)
  })

  it('still lists name matches when text search fails', async () => {
    searchDocumentContent.mockRejectedValue(new Error('offline'))
    const view = await renderUploaded([doc('a', 'Pump report')], 'pump')
    expect(view.textContent).toContain('Names are still searched')
    expect(view.querySelector('.result-row__name')?.textContent).toBe('Pump report')
  })
})
