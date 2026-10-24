// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LocalEntry } from '../../services/desktopCompanion'

const shortcutTarget = vi.fn()
const open = vi.fn()
const reveal = vi.fn()
vi.mock('../../services/desktopCompanion', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/desktopCompanion')>()
  return {
    ...original,
    companion: {
      ...original.companion,
      shortcutTarget: (...args: unknown[]) => shortcutTarget(...args),
      open: (...args: unknown[]) => open(...args),
      reveal: (...args: unknown[]) => reveal(...args),
    },
  }
})

const { openLocalEntry } = await import('./openLocalEntry')
const { CompanionError } = await import('../../services/desktopCompanion')

const entry = (extra: Partial<LocalEntry>): LocalEntry => ({ id: 1, name: 'Index.lnk', kind: 'shortcut', isFolder: false, canPreview: false, canOpen: true, ...extra }) as LocalEntry

function withBrowser(on: boolean) {
  const target = window as Window & { documentVaultDesktop?: unknown }
  target.documentVaultDesktop = on ? { web: { request: vi.fn(), onState: vi.fn(), onNotice: vi.fn(), onCheck: vi.fn() } } : undefined
}

afterEach(() => {
  vi.clearAllMocks()
  withBrowser(false)
})

describe('openLocalEntry', () => {
  it('shows a file the viewer can show, without asking anything else', async () => {
    const preview = vi.fn()
    const file = entry({ name: 'Contract.docx', kind: 'word', canPreview: true })
    await openLocalEntry(file, { preview, openWebPage: vi.fn() })
    expect(preview).toHaveBeenCalledWith(file)
    expect(shortcutTarget).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it('shows the indexed page a shortcut points to in the viewer', async () => {
    const preview = vi.fn()
    const page = entry({ id: 7, name: 'Complete Library Index.htm', kind: 'html', canPreview: true })
    shortcutTarget.mockResolvedValue({ url: null, entry: page })
    await openLocalEntry(entry({}), { preview, openWebPage: vi.fn() })
    expect(preview).toHaveBeenCalledWith(page)
    expect(open).not.toHaveBeenCalled()
  })

  it('opens a web shortcut in the in-app browser, noting where it came from', async () => {
    withBrowser(true)
    const openWebPage = vi.fn()
    shortcutTarget.mockResolvedValue({ url: 'https://ghalii.org/', entry: null })
    await openLocalEntry(entry({ id: 3, name: 'GhaLII.url' }), { preview: vi.fn(), openWebPage })
    expect(openWebPage).toHaveBeenCalledWith('https://ghalii.org/', { name: 'GhaLII.url', entryId: 3 })
    expect(open).not.toHaveBeenCalled()
  })

  it('without the in-app browser, a web shortcut opens with its usual app', async () => {
    const openWebPage = vi.fn()
    shortcutTarget.mockResolvedValue({ url: 'https://ghalii.org/', entry: null })
    await openLocalEntry(entry({ id: 3 }), { preview: vi.fn(), openWebPage })
    expect(openWebPage).not.toHaveBeenCalled()
    expect(open).toHaveBeenCalledWith(3)
  })

  it('an older companion that cannot read shortcuts still opens them', async () => {
    shortcutTarget.mockRejectedValue(new CompanionError(404, 'Not found'))
    await openLocalEntry(entry({ id: 4 }), { preview: vi.fn(), openWebPage: vi.fn() })
    expect(open).toHaveBeenCalledWith(4)
  })

  it('a refused shortcut reports the reason instead of opening', async () => {
    shortcutTarget.mockRejectedValue(new CompanionError(403, 'This shortcut points outside your libraries.'))
    await expect(openLocalEntry(entry({ id: 5 }), { preview: vi.fn(), openWebPage: vi.fn() })).rejects.toThrow('outside your libraries')
    expect(open).not.toHaveBeenCalled()
  })

  it('a file that cannot be opened is shown in its folder', async () => {
    await openLocalEntry(entry({ id: 6, name: 'data.bin', kind: 'other', canOpen: false }), { preview: vi.fn(), openWebPage: vi.fn() })
    expect(reveal).toHaveBeenCalledWith(6)
  })
})
