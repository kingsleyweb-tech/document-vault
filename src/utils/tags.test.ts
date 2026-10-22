import { describe, expect, it } from 'vitest'
import { MAX_TAG_LENGTH, MAX_TAGS, normalizeTags } from './tags'
import { matchesSearch } from './sorting'
import type { VaultDocument } from '../types/document'

describe('normalizeTags', () => {
  it('trims, lower-cases, removes # and duplicates, and joins words', () => {
    expect(normalizeTags([' Tax ', '#tax', '##2026', 'Home Office', '', '   '])).toEqual(['tax', '2026', 'home-office'])
  })

  it('keeps within the limits the security rules enforce', () => {
    expect(normalizeTags(Array.from({ length: 30 }, (_, index) => `t${index}`))).toHaveLength(MAX_TAGS)
    expect(normalizeTags(['x'.repeat(100)])[0]).toHaveLength(MAX_TAG_LENGTH)
  })
})

describe('matchesSearch with tags', () => {
  const record = {
    name: 'Return',
    originalName: 'Return.pdf',
    category: 'Personal',
    description: '',
    fileType: 'pdf',
    mimeType: 'application/pdf',
    folderPath: 'Finance',
    tags: ['tax', '2026'],
  } as unknown as VaultDocument

  it('matches tags as plain words', () => {
    expect(matchesSearch(record, 'tax')).toBe(true)
  })

  it('requires an exact tag for #words, combined with the other words', () => {
    expect(matchesSearch(record, '#tax')).toBe(true)
    expect(matchesSearch(record, '#ta')).toBe(false)
    expect(matchesSearch(record, '#tax return')).toBe(true)
    expect(matchesSearch(record, '#tax invoice')).toBe(false)
    expect(matchesSearch(record, '#tax #2026')).toBe(true)
    expect(matchesSearch({ ...record, tags: undefined }, '#tax')).toBe(false)
  })
})
