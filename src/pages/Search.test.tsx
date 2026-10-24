// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CompanionStatus, LocalHit, LocalRoot, LocalSearchParams } from '../services/desktopCompanion'
import { forgetPlaces } from '../services/placeMemory'
import type { VaultDocument } from '../types/document'

const companionState: { connection: string; status: CompanionStatus | null } = { connection: 'offline', status: null }
// refresh is stable, as the real hook's is (it is a dependency of the search effect).
const refresh = async () => {}
vi.mock('../hooks/useCompanion', () => ({
  useCompanion: () => ({ ...companionState, version: '1.1.0', refresh }),
}))

const searchDocumentContent = vi.fn()
vi.mock('../services/contentIndex', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/contentIndex')>()),
  searchDocumentContent: (...args: unknown[]) => searchDocumentContent(...args),
}))

const localSearch = vi.fn()
const reveal = vi.fn()
vi.mock('../services/desktopCompanion', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/desktopCompanion')>()
  return {
    ...original,
    companion: { ...original.companion, search: (...args: unknown[]) => localSearch(...args), reveal: (...args: unknown[]) => reveal(...args) },
  }
})

const { SearchPage } = await import('./Search')

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

const library = (id: number, name: string, extra: Partial<LocalRoot> = {}): LocalRoot => ({
  id,
  name,
  path: `C:\\Books\\${name}`,
  state: 'active',
  status: 'ready',
  error: null,
  needsPermission: false,
  addedAt: 1,
  lastScanAt: 1,
  lastScanMs: 1,
  lastSyncAt: 1,
  revokedAt: null,
  files: 10,
  folders: 2,
  watching: true,
  settings: { recursive: true, maxDepth: null, fileTypes: null, extractText: true },
  skippedByType: 0,
  exclusions: [],
  extraction: { completed: 10 },
  ai: 'off',
  ...extra,
})

const hit = (extra: Partial<LocalHit>): LocalHit => ({
  id: 1,
  rootId: 1,
  name: 'Contract Law Handbook.pdf',
  path: 'C:\\Books\\Law\\Contract Law Handbook.pdf',
  folder: 'C:\\Books\\Law',
  kind: 'pdf',
  extension: 'pdf',
  isFolder: false,
  size: 2048,
  modifiedAt: null,
  readOnly: false,
  hidden: false,
  availability: 'available',
  canOpen: true,
  canPreview: true,
  ...extra,
})

let container: HTMLElement | null = null
afterEach(() => {
  container?.remove()
  container = null
  searchDocumentContent.mockReset()
  localSearch.mockReset()
  reveal.mockReset()
  companionState.connection = 'offline'
  companionState.status = null
  forgetPlaces()
})

async function render(documents: VaultDocument[], search: string, url = '/search') {
  container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[url]}>
        <SearchPage documents={documents} allDocuments={documents} search={search} onOpenDocument={() => {}} />
      </MemoryRouter>,
    ),
  )
  await act(async () => new Promise((resolve) => setTimeout(resolve, 300)))
  return container
}

async function renderUploaded(documents: VaultDocument[], search: string) {
  const view = await render(documents, search)
  const uploadedRadio = [...view.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((button) => button.textContent === 'Document Vault')
  await act(async () => uploadedRadio!.click())
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)))
  return view
}

function connect(roots: LocalRoot[]) {
  companionState.connection = 'ready'
  companionState.status = {
    version: '1.1.0',
    index: { state: 'idle', current: null, queued: [], watching: [], totals: { files: 10, folders: 2 }, errors: [] },
    text: { state: 'idle', counts: { completed: 10 }, current: [] },
    roots,
  }
}

describe('Search: uploaded documents', () => {
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
    // A database row for a document that is not in the vault is never shown.
    expect(view.textContent).not.toContain('stale')
    for (const row of rows) expect(row.querySelector('.source-badge--vault')?.textContent).toBe('Document Vault')
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

describe('Search: local libraries', () => {
  it('explains that libraries need the desktop app when the companion is not running', async () => {
    const view = await render([], '')
    expect(view.querySelector('.companion-setup')).not.toBeNull()
    expect(localSearch).not.toHaveBeenCalled()
  })

  it('shows where the words were found, why the document matched and which catalog lists it', async () => {
    connect([library(1, 'Law')])
    localSearch.mockResolvedValue({
      items: [
        hit({
          match: 'phrase',
          excerpt: { page: 3, label: null, section: 3, text: '…the <<duty>> <<of>> <<care>> owed…' },
          matchingSections: 4,
          meta: { title: { value: 'Principles of Contract', source: 'original' }, author: { value: 'A. Scholar', source: 'original' } },
          referencedBy: { count: 2, example: 'index.htm' },
        }),
      ],
      total: 1,
      totalCapped: false,
      fuzzy: false,
      tookMs: 4,
    })
    const view = await render([], '"duty of care"')
    const row = view.querySelector('[aria-label="Results from your libraries"] > li')!
    expect(row.querySelector('.result-row__name')?.textContent).toBe('Principles of Contract')
    expect(row.querySelector('.result-row__filename')?.textContent).toBe('Contract Law Handbook.pdf')
    expect(row.querySelector('.source-badge--local')?.textContent).toBe('Local Library')
    expect(row.querySelector('.result-row__library')?.textContent).toBe('Law')
    expect(row.textContent).toContain('Exact phrase in text')
    expect(row.textContent).toContain('A. Scholar')
    expect(row.querySelector('.result-row__where')?.textContent).toBe('Page 3')
    expect([...row.querySelectorAll('.result-row__snippet mark')].map((mark) => mark.textContent)).toEqual(['duty', 'of', 'care'])
    expect(row.textContent).toContain('Found in 4 pages')
    expect(row.textContent).toContain('Referenced in index.htm and 1 more page')
    expect([...row.querySelectorAll('button')].some((button) => button.textContent === 'Open at page 3')).toBe(true)
  })

  it('marks a passage recognised from a scan and warns that it may contain errors', async () => {
    connect([library(1, 'Law')])
    localSearch.mockResolvedValue({
      items: [hit({ match: 'text', excerpt: { page: 2, label: null, section: 2, text: 'as in Adams v <<Lindsell>>', source: 'ocr', confidence: 91 } })],
      total: 1,
      totalCapped: false,
      fuzzy: false,
      tookMs: 3,
    })
    const view = await render([], 'Lindsell')
    const row = view.querySelector('[aria-label="Results from your libraries"] > li')!
    expect(row.textContent).toContain('Recognised text (OCR)')
    expect(row.querySelector('.result-row__where')?.textContent).toBe('Page 2')
    expect(row.querySelector('.ocr-note')?.textContent).toContain('Text recognised from a scan; it may contain errors.')
  })

  it('shows identical copies once, listing where the others are', async () => {
    connect([library(1, 'Law'), library(2, 'Downloads')])
    reveal.mockResolvedValue({ ok: true })
    localSearch.mockResolvedValue({
      items: [
        hit({ copies: [{ entryId: 7, name: 'Contract Law Handbook (1).pdf', folder: 'C:\\Users\\Me\\Downloads', libraryId: 2, libraryName: 'Downloads' }] }),
        hit({ id: 2, name: 'Torts.pdf', copies: [] }),
      ],
      total: 2,
      totalCapped: false,
      fuzzy: false,
      tookMs: 3,
    })
    const view = await render([], 'contract')
    const [row, other] = [...view.querySelectorAll('[aria-label="Results from your libraries"] > li')]
    expect(row.querySelector('.result-row__copies summary')?.textContent).toBe('Identical copy also in 1 other place')
    expect(row.querySelector('.result-row__copies li')?.textContent).toContain('Downloads · C:\\Users\\Me\\Downloads · Contract Law Handbook (1).pdf')
    expect(other.querySelector('.result-row__copies')).toBeNull()
    const show = [...row.querySelectorAll<HTMLButtonElement>('.result-row__copies button')].find((button) => button.textContent === 'Show in folder')!
    await act(async () => show.click())
    expect(reveal).toHaveBeenCalledWith(7)
  })

  it('does not mark passages read from the text of the file', async () => {
    connect([library(1, 'Law')])
    localSearch.mockResolvedValue({
      items: [hit({ match: 'text', excerpt: { page: 1, label: null, section: 1, text: '<<duty>> of care', source: 'text' } })],
      total: 1,
      totalCapped: false,
      fuzzy: false,
      tookMs: 3,
    })
    const view = await render([], 'duty')
    const row = view.querySelector('[aria-label="Results from your libraries"] > li')!
    expect(row.textContent).not.toContain('Recognised text (OCR)')
    expect(row.querySelector('.ocr-note')).toBeNull()
  })

  it('searches everything by default, scoped to the library in the address, and never offers revoked libraries', async () => {
    connect([library(1, 'Law'), library(2, 'Old cases', { state: 'revoked' })])
    localSearch.mockResolvedValue({ items: [], total: 0, totalCapped: false, fuzzy: false, tookMs: 1 })
    const view = await render([], 'negligence', '/search?library=1')
    const params = localSearch.mock.calls.at(-1)![0] as LocalSearchParams
    expect(params).toMatchObject({ q: 'negligence', mode: 'all', roots: [1] })
    const options = [...view.querySelectorAll<HTMLOptionElement>('select[aria-label="Library"] option')].map((option) => option.textContent)
    expect(options).toEqual(['All libraries', 'Law'])
  })

  it('shows the last search again on coming back, unless a link asks for another library', async () => {
    connect([library(1, 'Law'), library(2, 'Cases')])
    localSearch.mockResolvedValue({ items: [], total: 0, totalCapped: false, fuzzy: false, tookMs: 1 })
    const first = await render([], 'estoppel')
    const fullText = [...first.querySelectorAll<HTMLButtonElement>('[aria-label="What to search"] button')].find((button) => button.textContent === 'Full text')!
    await act(async () => fullText.click())
    first.remove()

    const back = await render([], '')
    expect(back.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe('estoppel')
    expect(localSearch.mock.calls.at(-1)![0]).toMatchObject({ q: 'estoppel', mode: 'fulltext' })
    back.remove()

    await render([], '', '/search?library=2')
    expect(localSearch.mock.calls.at(-1)![0]).toMatchObject({ q: 'estoppel', mode: 'all', roots: [2] })
  })

  it('switches to full-text search and explains scanned PDFs when nothing matches', async () => {
    connect([library(1, 'Law')])
    localSearch.mockResolvedValue({ items: [], total: 0, totalCapped: false, fuzzy: false, tookMs: 1 })
    const view = await render([], 'estoppel')
    const fullText = [...view.querySelectorAll<HTMLButtonElement>('[aria-label="What to search"] button')].find((button) => button.textContent === 'Full text')!
    await act(async () => fullText.click())
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)))
    expect((localSearch.mock.calls.at(-1)![0] as LocalSearchParams).mode).toBe('fulltext')
    expect(view.textContent).toContain('Scanned PDFs are searched by their words only after their text is recognised (OCR)')
  })
})
