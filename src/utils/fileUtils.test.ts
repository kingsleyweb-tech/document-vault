import { describe, expect, it } from 'vitest'
import { getDocumentKind, renamedFileName } from './fileUtils'

describe('renamedFileName', () => {
  it('keeps the original extension', () => {
    expect(renamedFileName('Annual report 2026', 'Report.pdf')).toBe('Annual report 2026.pdf')
    expect(renamedFileName('Budget final', 'budget.XLSX')).toBe('Budget final.XLSX')
  })

  it('does not double an extension the new name already has', () => {
    expect(renamedFileName('Annual report.pdf', 'Report.pdf')).toBe('Annual report.pdf')
    expect(renamedFileName('Annual report.PDF', 'Report.pdf')).toBe('Annual report.PDF')
  })

  it('leaves names without an original extension alone', () => {
    expect(renamedFileName('Notes', 'Notes')).toBe('Notes')
  })
})

describe('getDocumentKind', () => {
  const file = (name: string, type = '') => new File(['x'], name, { type })
  it('recognises OpenDocument, data and TIFF files by extension', () => {
    expect(getDocumentKind(file('a.ods'))).toBe('spreadsheet')
    expect(getDocumentKind(file('a.odt'))).toBe('word')
    expect(getDocumentKind(file('a.odp'))).toBe('presentation')
    expect(getDocumentKind(file('a.md'))).toBe('text')
    expect(getDocumentKind(file('a.json'))).toBe('text')
    expect(getDocumentKind(file('scan.tiff'))).toBe('image')
  })
})
