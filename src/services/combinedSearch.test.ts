import { describe, expect, it } from 'vitest'
import { excerptParts, libraryState, textProgress } from '../components/library/libraryText'
import type { LocalRoot } from './desktopCompanion'
import { mergeUploadedMatches, SOURCE_LABELS } from './combinedSearch'
import type { VaultDocument } from '../types/document'

const doc = (id: string) => ({ id, name: id }) as unknown as VaultDocument
const match = (id: string, matchedContent: boolean, snippet: string | null = null) => ({ id, rank: 1, matchedContent, snippet, driveMissing: false })

describe('combined search', () => {
  it('labels the two sources distinctly', () => {
    expect(SOURCE_LABELS).toEqual({ local: 'Local Library', vault: 'Document Vault' })
  })

  it('adds text-only matches once, keeps snippets, and drops rows for documents not in the vault', () => {
    const visible = [doc('a'), doc('b'), doc('c')]
    const { snippets, textOnly } = mergeUploadedMatches(visible, [doc('a')], [
      match('a', true, 'name and <<text>>'),
      match('b', true, 'only <<text>>'),
      match('b', true, 'only <<text>> again'),
      match('c', false),
      match('deleted', true, 'stale'),
    ])
    expect(textOnly.map((record) => record.id)).toEqual(['b'])
    expect(snippets.get('a')).toBe('name and <<text>>')
    expect(snippets.has('deleted')).toBe(false)
  })
})

describe('excerpts', () => {
  it('marks only the words between << and >>, as text', () => {
    expect(excerptParts('the <<duty>> of <<care>>')).toEqual([
      { text: 'the ', hit: false },
      { text: 'duty', hit: true },
      { text: ' of ', hit: false },
      { text: 'care', hit: true },
    ])
    expect(excerptParts('<script>alert(1)</script>')).toEqual([{ text: '<script>alert(1)</script>', hit: false }])
  })
})

describe('library state', () => {
  const root = (extra: Partial<LocalRoot>) =>
    ({
      id: 1,
      state: 'active',
      status: 'ready',
      needsPermission: false,
      error: null,
      watching: true,
      settings: { recursive: true, maxDepth: null, fileTypes: null, extractText: true },
      extraction: {},
      ...extra,
    }) as LocalRoot

  it('puts revocation and missing permission ahead of everything else', () => {
    expect(libraryState(root({ state: 'revoked', status: 'denied', needsPermission: true })).label).toBe('Access revoked')
    expect(libraryState(root({ status: 'denied', needsPermission: true })).label).toBe('Permission needed')
    expect(libraryState(root({ status: 'unavailable' })).label).toBe('Not available')
    expect(libraryState(root({ state: 'paused' })).label).toBe('Paused')
    expect(libraryState(root({ extraction: { pending: 3, completed: 1 } })).label).toBe('Reading text')
    expect(libraryState(root({})).label).toBe('Up to date')
  })

  it('counts text reading progress', () => {
    expect(textProgress(root({ extraction: { completed: 5, failed: 1, pending: 4 } }))).toEqual({ done: 6, total: 10, readable: 5, failed: 1 })
  })
})
