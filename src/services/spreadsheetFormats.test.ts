// @vitest-environment happy-dom
import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { renderSpreadsheet } from './documentViewer'

const workbook = () => {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Item', 'Cost'], ['Valve <b>', 42]]), 'Costs')
  return book
}

describe('renderSpreadsheet', () => {
  it.each(['xls', 'ods', 'xlsx'] as const)('reads .%s workbooks and escapes cell text', async (bookType) => {
    const data = XLSX.write(workbook(), { type: 'array', bookType: bookType === 'xls' ? 'biff8' : bookType }) as ArrayBuffer
    const [sheet] = await renderSpreadsheet(new Blob([data]))
    expect(sheet.name).toBe('Costs')
    expect(sheet.html).toContain('Valve &lt;b&gt;')
    expect(sheet.html).toContain('42')
  })

  it('reads tab-separated text', async () => {
    const [sheet] = await renderSpreadsheet(new Blob(['Item\tCost\nPump\t12\n']))
    expect(sheet.html).toContain('Pump')
    expect(sheet.html).toContain('12')
  })
})
