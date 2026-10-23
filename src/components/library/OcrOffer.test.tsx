// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LibraryOcr, LocalRoot } from '../../services/desktopCompanion'

const decideOcr = vi.fn()
vi.mock('../../services/desktopCompanion', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/desktopCompanion')>()
  return { ...original, companion: { ...original.companion, decideOcr: (...args: unknown[]) => decideOcr(...args) } }
})

const { OcrOffer } = await import('./OcrOffer')
const { ocrProgress } = await import('./libraryText')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ocr = (extra: Partial<LibraryOcr> = {}): LibraryOcr => ({
  pref: 'ask',
  scannedDocs: 14,
  scannedPages: 2300,
  recognisedPages: 0,
  pending: 0,
  completed: 0,
  failed: 0,
  states: { none: 14 },
  current: null,
  ...extra,
})

const library = (extra: Partial<LocalRoot> = {}): LocalRoot => ({
  id: 1,
  name: 'Law',
  path: 'C:\\Books\\Law',
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
  settings: { recursive: true, maxDepth: null, fileTypes: null, extractText: true, ocr: false },
  skippedByType: 0,
  exclusions: [],
  extraction: { completed: 10 },
  ocr: ocr(),
  ai: 'off',
  ...extra,
})

let container: HTMLDivElement | null = null

afterEach(() => {
  container?.remove()
  container = null
  decideOcr.mockReset()
})

async function render(root: LocalRoot, onDecided = vi.fn()) {
  container = document.createElement('div')
  document.body.append(container)
  const view = createRoot(container)
  await act(async () => view.render(<OcrOffer root={root} onDecided={onDecided} />))
  return { container, onDecided }
}

const button = (view: HTMLElement, text: string) => [...view.querySelectorAll('button')].find((item) => item.textContent === text)!

describe('OcrOffer', () => {
  it('asks once, with the number of scans and pages and what recognition costs', async () => {
    const { container: view } = await render(library())
    expect(view.textContent).toContain('14 scanned documents (2,300 pages)')
    expect(view.textContent).toContain('about 5 to 10 seconds per page (a 300-page book can take 30 to 50 minutes)')
    expect(view.textContent).toContain('Nothing is uploaded')
  })

  it('sends the answer and passes on the updated library', async () => {
    const answered = library({ ocr: ocr({ pref: 'on', pending: 14 }) })
    decideOcr.mockResolvedValue({ root: answered })
    const { container: view, onDecided } = await render(library())
    await act(async () => button(view, 'Recognise text').click())
    expect(decideOcr).toHaveBeenCalledWith(1, 'on')
    expect(onDecided).toHaveBeenCalledWith(answered)
  })

  it('"Not now" answers not-now', async () => {
    decideOcr.mockResolvedValue({ root: library({ ocr: ocr({ pref: 'off' }) }) })
    const { container: view } = await render(library())
    await act(async () => button(view, 'Not now').click())
    expect(decideOcr).toHaveBeenCalledWith(1, 'not-now')
  })

  it('is not shown once decided, without scans, for a revoked library or with an older companion', async () => {
    for (const root of [
      library({ ocr: ocr({ pref: 'on' }) }),
      library({ ocr: ocr({ pref: 'off' }) }),
      library({ ocr: ocr({ scannedDocs: 0, scannedPages: 0 }) }),
      library({ state: 'revoked' }),
      library({ ocr: undefined }),
    ]) {
      const { container: view } = await render(root)
      expect(view.textContent).toBe('')
      view.remove()
    }
  })
})

describe('ocrProgress', () => {
  it('reports pages recognised while recognition is under way, and nothing otherwise', () => {
    expect(ocrProgress(library({ ocr: ocr({ pref: 'on', pending: 3, recognisedPages: 120 }) }))).toMatchObject({ done: 120, total: 2300 })
    expect(ocrProgress(library({ ocr: ocr({ pref: 'on', pending: 0, recognisedPages: 2300 }) }))).toBeNull()
    expect(ocrProgress(library())).toBeNull()
  })
})
