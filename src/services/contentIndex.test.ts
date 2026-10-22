// @vitest-environment happy-dom
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { buildPptx } from '../test/pptxFixture'
import { extractDocumentText, normaliseContent, snippetParts, stripRtf } from './contentIndex'

const target = (originalName: string, mimeType = '', fileType: string = 'other') => ({
  name: originalName.replace(/\.[^.]+$/, ''),
  originalName,
  mimeType,
  fileType: fileType as never,
})

async function buildDocx(paragraphs: string[]) {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  )
  zip.file(
    'word/document.xml',
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('') +
      '</w:body></w:document>',
  )
  return zip.generateAsync({ type: 'blob' })
}

describe('extractDocumentText', () => {
  it('reads Word documents', async () => {
    const text = await extractDocumentText(await buildDocx(['Hydraulic pump service', 'Annual inspection']), target('Service.docx'))
    expect(text).toContain('Hydraulic pump service')
    expect(text).toContain('Annual inspection')
  })

  it('reads every sheet of a spreadsheet', async () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Item', 'Cost'], ['Valve', 42]]), 'Budget')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Supplier'], ['Acme Fittings']]), 'Suppliers')
    const data = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const text = await extractDocumentText(new Blob([data]), target('Costs.xlsx'))
    expect(text).toContain('Budget')
    expect(text).toContain('Valve,42')
    expect(text).toContain('Acme Fittings')
  })

  it('reads slides in presentation order', async () => {
    const data = await buildPptx({ slideCount: 3, fileNumberForPosition: (position) => 3 - position })
    const text = (await extractDocumentText(new Blob([data]), target('Deck.pptx'))) ?? ''
    expect(text.indexOf('Deck slide 1')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('Deck slide 1')).toBeLessThan(text.indexOf('Deck slide 3'))
  })

  it('reads HTML without scripts or styles', async () => {
    const html = '<html><head><style>.x{color:red}</style></head><body><h1>Safety</h1><script>alert(1)</script><p>Wear gloves</p></body></html>'
    const text = await extractDocumentText(new Blob([html]), target('Guide.html', 'text/html'))
    expect(text).toContain('Safety')
    expect(text).toContain('Wear gloves')
    expect(text).not.toContain('alert')
    expect(text).not.toContain('color')
  })

  it('reads plain text formats and RTF', async () => {
    expect(await extractDocumentText(new Blob(['{"site":"North yard"}']), target('site.json'))).toContain('North yard')
    expect(await extractDocumentText(new Blob(['# Notes\nCheck the boiler']), target('notes.md'))).toContain('Check the boiler')
    expect(await extractDocumentText(new Blob(['{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0\\fs24 Boiler \\b log\\b0}']), target('log.rtf'))).toContain('Boiler log')
  })

  it('returns null for formats without text', async () => {
    expect(await extractDocumentText(new Blob([new Uint8Array([1, 2, 3])]), target('photo.jpg', 'image/jpeg', 'image'))).toBeNull()
    expect(await extractDocumentText(new Blob([new Uint8Array([1, 2, 3])]), target('setup.zip', 'application/zip', 'archive'))).toBeNull()
  })
})

describe('content helpers', () => {
  it('normalises whitespace and caps the length', () => {
    expect(normaliseContent('  a\t\tb\r\n\n\n\nc\u0000 ')).toBe('a b\n\nc')
    expect(normaliseContent('x'.repeat(2_100_000))).toHaveLength(2_000_000)
  })

  it('splits highlighted snippets without producing HTML', () => {
    expect(snippetParts('the <<hydraulic>> pump <<service>>')).toEqual([
      { text: 'the ', hit: false },
      { text: 'hydraulic', hit: true },
      { text: ' pump ', hit: false },
      { text: 'service', hit: true },
    ])
    expect(snippetParts('<img src=x onerror=alert(1)>')).toEqual([{ text: '<img src=x onerror=alert(1)>', hit: false }])
  })

  it('strips RTF control words', () => {
    expect(stripRtf("{\\rtf1 Caf\\'e9 menu}")).toBe('Café menu')
  })
})

describe('stripRtf', () => {
  it('drops font, colour and hidden groups but keeps the body', () => {
    const rtf =
      String.raw`{\rtf1\ansi{\fonttbl{\f0\fswiss Arial;}{\f1 Times;}}{\colortbl;\red255\green0\blue0;}` +
      String.raw`{\*\generator Writer;}{\info{\title Secret title}}\f0\fs24 Dear team,\par the \b boiler\b0  is fixed.\par Price: 5\{units\}}`
    expect(stripRtf(rtf)).toBe('Dear team,\nthe boiler is fixed.\nPrice: 5{units}')
  })
})
