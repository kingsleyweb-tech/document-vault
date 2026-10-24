// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CompanionStatus, DuplicateSet, DuplicateSummary, LocalRoot } from '../services/desktopCompanion'

const companionState: { connection: string; status: CompanionStatus | null } = { connection: 'offline', status: null }
const refresh = async () => {}
vi.mock('../hooks/useCompanion', () => ({
  useCompanion: () => ({ ...companionState, version: '1.2.0', refresh }),
}))

const duplicates = vi.fn()
const duplicateSummary = vi.fn()
const dismissDuplicate = vi.fn()
const reveal = vi.fn()
vi.mock('../services/desktopCompanion', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/desktopCompanion')>()
  return {
    ...original,
    companion: {
      ...original.companion,
      duplicates: (...args: unknown[]) => duplicates(...args),
      duplicateSummary: (...args: unknown[]) => duplicateSummary(...args),
      dismissDuplicate: (...args: unknown[]) => dismissDuplicate(...args),
      reveal: (...args: unknown[]) => reveal(...args),
    },
  }
})

const { Duplicates } = await import('./Duplicates')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

const summary = (extra: Partial<DuplicateSummary> = {}): DuplicateSummary => ({
  exact: { groups: 1, extraCopies: 1, extraBytes: 2 * 1024 * 1024 },
  text: { groups: 0, extraCopies: 0, extraBytes: 0 },
  checking: { state: 'idle', pending: 0 },
  ...extra,
})

const group = (extra: Partial<DuplicateSet> = {}): DuplicateSet => ({
  kind: 'exact',
  key: 'a'.repeat(64),
  copies: [
    { entryId: 1, name: 'Contract Law.pdf', folder: 'C:\\Books\\Law\\Contracts', libraryId: 1, libraryName: 'Law', size: 2 * 1024 * 1024, mtime: 1 },
    { entryId: 2, name: 'Contract Law.pdf', folder: 'C:\\Users\\Me\\Downloads', libraryId: 2, libraryName: 'Downloads', size: 2 * 1024 * 1024, mtime: 1 },
  ],
  extraBytes: 2 * 1024 * 1024,
  sameName: true,
  dismissedAt: null,
  ...extra,
})

function connect(roots: LocalRoot[]) {
  companionState.connection = 'ready'
  companionState.status = {
    version: '1.2.0',
    index: { state: 'idle', current: null, queued: [], watching: [], totals: { files: 10, folders: 2 }, errors: [] },
    text: { state: 'idle', counts: { completed: 10 }, current: [] },
    roots,
  }
}

let container: HTMLElement | null = null
afterEach(() => {
  container?.remove()
  container = null
  for (const mock of [duplicates, duplicateSummary, dismissDuplicate, reveal]) mock.mockReset()
  companionState.connection = 'offline'
  companionState.status = null
})

async function render() {
  container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () =>
    root.render(
      <MemoryRouter>
        <Duplicates />
      </MemoryRouter>,
    ),
  )
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
  return container
}

const button = (view: HTMLElement, text: string) => [...view.querySelectorAll('button')].find((item) => item.textContent?.includes(text))!

describe('Duplicates', () => {
  it('asks for the desktop app when the companion is not running', async () => {
    const view = await render()
    expect(view.querySelector('.companion-setup')).not.toBeNull()
    expect(duplicates).not.toHaveBeenCalled()
  })

  it('lists identical copies across libraries, says nothing is deleted and offers Show in folder', async () => {
    connect([library(1, 'Law'), library(2, 'Downloads'), library(3, 'Old', { state: 'revoked' })])
    duplicates.mockResolvedValue({ kind: 'exact', groups: [group()] })
    duplicateSummary.mockResolvedValue(summary())
    reveal.mockResolvedValue({ ok: true })
    const view = await render()

    expect(duplicates).toHaveBeenCalledWith({ kind: 'exact', library: null, dismissed: false }, expect.any(AbortSignal))
    expect(view.textContent).toContain('1 book has identical copies, using 2.0 MB more than one copy each would.')
    expect(view.textContent).toContain('never deletes or moves files')
    const card = view.querySelector('.duplicate-group')!
    expect(card.querySelector('strong')?.textContent).toBe('Contract Law.pdf')
    expect([...card.querySelectorAll('.duplicate-copy__where')].map((item) => item.textContent)).toEqual([
      'Law · C:\\Books\\Law\\Contracts',
      'Downloads · C:\\Users\\Me\\Downloads',
    ])
    // A revoked library cannot be chosen as a filter.
    expect([...view.querySelectorAll('option')].map((option) => option.textContent)).toEqual(['All libraries', 'Law', 'Downloads'])
    // No button anywhere deletes or moves a file.
    expect([...view.querySelectorAll('button')].some((item) => /delete|remove|move/i.test(item.textContent ?? ''))).toBe(false)

    await act(async () => [...card.querySelectorAll<HTMLButtonElement>('.duplicate-copy__reveal')][1].click())
    expect(reveal).toHaveBeenCalledWith(2)
  })

  it('switches to files with the same text, with a warning to compare them', async () => {
    connect([library(1, 'Law')])
    duplicates.mockResolvedValue({ kind: 'exact', groups: [] })
    duplicateSummary.mockResolvedValue(summary({ text: { groups: 1, extraCopies: 1, extraBytes: 10 } }))
    const view = await render()
    expect(button(view, 'Same text, different file').textContent).toBe('Same text, different file (1)')
    await act(async () => button(view, 'Same text, different file').click())
    expect(duplicates).toHaveBeenLastCalledWith({ kind: 'text', library: null, dismissed: false }, expect.any(AbortSignal))
    expect(view.textContent).toContain('Compare them before removing anything.')
  })

  it('marks a group as not duplicates and reloads the list', async () => {
    connect([library(1, 'Law')])
    duplicates.mockResolvedValueOnce({ kind: 'exact', groups: [group()] }).mockResolvedValue({ kind: 'exact', groups: [] })
    duplicateSummary.mockResolvedValue(summary())
    dismissDuplicate.mockResolvedValue({ ok: true })
    const view = await render()
    await act(async () => button(view, 'Keep all: not duplicates').click())
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(dismissDuplicate).toHaveBeenCalledWith('exact', 'a'.repeat(64), true)
    expect(view.textContent).toContain('The group comes back if another copy appears.')
    expect(view.textContent).toContain('No identical files')
  })

  it('says files are still being compared when the list is empty', async () => {
    connect([library(1, 'Law')])
    duplicates.mockResolvedValue({ kind: 'exact', groups: [] })
    duplicateSummary.mockResolvedValue(summary({ exact: { groups: 0, extraCopies: 0, extraBytes: 0 }, checking: { state: 'checking', pending: 12 } }))
    const view = await render()
    expect(view.textContent).toContain('Still comparing 12 files')
  })
})
