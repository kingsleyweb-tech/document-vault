// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CompanionStatus, LocalEntry, LocalRoot, TreeLevel } from '../../services/desktopCompanion'

const tree = vi.fn()
const pause = vi.fn(async () => ({}))
vi.mock('../../services/desktopCompanion', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/desktopCompanion')>()
  return { ...original, companion: { ...original.companion, tree: (...args: unknown[]) => tree(...args), pause: () => pause(), resume: vi.fn(async () => ({})) } }
})

const { FolderTree } = await import('./FolderTree')
const { IndexingActivity } = await import('./IndexingActivity')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const file = (id: number, name: string): LocalEntry =>
  ({ id, rootId: 1, name, path: `C:\\Books\\${name}`, folder: 'C:\\Books', kind: 'pdf', extension: 'pdf', isFolder: false, size: 10, modifiedAt: 1, readOnly: false, hidden: false, availability: 'available', canOpen: true, canPreview: true }) as LocalEntry

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

async function render(node: React.ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(node))
  await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
}

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

describe('FolderTree', () => {
  it('shows more of a long folder on request, and orders it as chosen', async () => {
    tree.mockImplementation(async (_id: number, _parent: number | null, options: { offset?: number }): Promise<TreeLevel> =>
      options.offset ? { parent: null, folders: [], files: [file(3, 'c.pdf')], moreFolders: false, moreFiles: false } : { parent: null, folders: [], files: [file(1, 'a.pdf'), file(2, 'b.pdf')], moreFolders: false, moreFiles: true },
    )
    await render(<FolderTree libraryId={1} version="v1" onFile={vi.fn()} onExclude={vi.fn()} />)
    expect(container.textContent).toContain('Showing 0 folders and 2 files.')
    const more = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Show more') as HTMLButtonElement
    await act(async () => more.click())
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
    expect([...container.querySelectorAll('.folder-tree__file .folder-tree__name')].map((item) => item.textContent)).toEqual(['a.pdf', 'b.pdf', 'c.pdf'])
    expect(container.textContent).not.toContain('Show more')

    const select = container.querySelector('select') as HTMLSelectElement
    await act(async () => {
      select.value = 'size'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(tree).toHaveBeenLastCalledWith(1, null, expect.objectContaining({ sort: 'size', offset: 0 }))
  })
})

describe('IndexingActivity', () => {
  const library = { id: 1, status: 'indexing', settings: { extractText: true }, extraction: { pending: 4 } } as unknown as LocalRoot
  const status = (current: Partial<NonNullable<CompanionStatus['index']['current']>> | null) =>
    ({ index: { state: current ? 'indexing' : 'idle', current: current ? { rootId: 1, root: 'C:\\Books', scanned: 0, folder: 'C:\\Books\\Cases', startedAt: 0, ...current } : null, queued: [], watching: [], totals: { files: 0, folders: 0 }, errors: [] }, roots: [] }) as unknown as CompanionStatus

  it('counts what has been found, with no percentage, and says what search covers', async () => {
    await render(<IndexingActivity root={library} status={status({ folders: 12, files: 1340, waiting: 3, errors: 1, elapsedMs: 65_000, full: true })} onChanged={vi.fn()} />)
    expect(container.textContent).toContain('Finding files')
    expect(container.textContent).toContain('1,340')
    expect(container.textContent).toContain('1:05')
    expect(container.textContent).toContain('Text still to read4')
    expect(container.textContent).not.toContain('%')
    expect(container.textContent).toContain('searched by name as soon as they are found')
  })

  it('pauses indexing', async () => {
    await render(<IndexingActivity root={library} status={status({ folders: 1, files: 1, elapsedMs: 0 })} onChanged={vi.fn()} />)
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent === 'Pause') as HTMLButtonElement
    await act(async () => button.click())
    expect(pause).toHaveBeenCalled()
  })

  it('shows nothing when there is nothing to do', async () => {
    await render(<IndexingActivity root={{ ...library, status: 'ready', extraction: {} } as LocalRoot} status={status(null)} onChanged={vi.fn()} />)
    expect(container.textContent).toBe('')
  })
})
