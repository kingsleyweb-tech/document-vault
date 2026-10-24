// @vitest-environment happy-dom
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { renderMht, renderOpenDocument, textDocumentHtml } from './fileFormats'

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const bodyOf = (html: string) => new DOMParser().parseFromString(html, 'text/html').body

describe('older Word and RTF documents', () => {
  it('shows each line as a paragraph, with markup kept as text', () => {
    const body = bodyOf(textDocumentHtml('Letter.doc', [{ text: 'Dear Sir,\n<script>alert(1)</script>' }], false))
    const paragraphs = Array.from(body.querySelectorAll('p:not(.note)'), (p) => p.textContent)
    expect(paragraphs).toEqual(['Dear Sir,', '<script>alert(1)</script>'])
    expect(body.querySelector('script')).toBeNull()
  })
})

describe('OpenDocument files', () => {
  async function build(content: string, pictures: Record<string, string> = {}) {
    const zip = new JSZip()
    zip.file('content.xml', `<?xml version="1.0"?>
      <office:document-content xmlns:office="o" xmlns:text="t" xmlns:style="s" xmlns:fo="f" xmlns:table="tb" xmlns:draw="d" xmlns:xlink="x" xmlns:presentation="p">
        <office:automatic-styles><style:style style:name="B"><style:text-properties fo:font-weight="bold"/></style:style></office:automatic-styles>
        <office:body>${content}</office:body>
      </office:document-content>`)
    for (const [name, data] of Object.entries(pictures)) zip.file(name, data, { base64: true })
    return zip.generateAsync({ type: 'blob' })
  }

  it('shows headings, styled text, lists, tables and pictures', async () => {
    const blob = await build(
      `<office:text>
        <text:h text:outline-level="2">Judgment</text:h>
        <text:p>The <text:span text:style-name="B">appeal</text:span> is allowed.</text:p>
        <text:list><text:list-item><text:p>First ground</text:p></text:list-item></text:list>
        <table:table><table:table-row><table:table-cell><text:p>Cell</text:p></table:table-cell></table:table-row></table:table>
        <draw:frame><draw:image xlink:href="Pictures/seal.png"/></draw:frame>
        <office:annotation><text:p>Private comment</text:p></office:annotation>
      </office:text>`,
      { 'Pictures/seal.png': PNG_1PX },
    )
    const body = bodyOf(await renderOpenDocument(blob, 'Judgment.odt'))
    expect(body.querySelector('h2')?.textContent).toBe('Judgment')
    expect(body.querySelector('strong')?.textContent).toBe('appeal')
    expect(body.querySelector('li')?.textContent).toBe('First ground')
    expect(body.querySelector('td')?.textContent).toBe('Cell')
    expect(body.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
    expect(body.textContent).not.toContain('Private comment')
  })

  it('shows each slide of a presentation', async () => {
    const blob = await build(`<office:presentation>
      <draw:page><draw:frame><draw:text-box><text:p>Opening</text:p></draw:text-box></draw:frame><presentation:notes><text:p>Speaker only</text:p></presentation:notes></draw:page>
      <draw:page><draw:frame><draw:text-box><text:p>Closing</text:p></draw:text-box></draw:frame></draw:page>
    </office:presentation>`)
    const body = bodyOf(await renderOpenDocument(blob, 'Talk.odp'))
    expect(Array.from(body.querySelectorAll('.slide > h2'), (h) => h.textContent)).toEqual(['Slide 1', 'Slide 2'])
    expect(body.textContent).toContain('Closing')
    expect(body.textContent).not.toContain('Speaker only')
  })
})

describe('saved web pages', () => {
  it('shows the page with its saved pictures and styles, without scripts', async () => {
    const mht = [
      'MIME-Version: 1.0',
      'Content-Type: multipart/related; boundary="----=_NextPart"; type="text/html"',
      '',
      '------=_NextPart',
      'Content-Type: text/html; charset="utf-8"',
      'Content-Transfer-Encoding: quoted-printable',
      'Content-Location: https://example.org/case/index.html',
      '',
      '<html><head><link rel=3D"stylesheet" href=3D"site.css"></head><body><h1>R v Mensah</h1>',
      '<img src=3D"seal.png"><img src=3D"https://tracker.example/pixel.gif"><script>alert(1)</script>',
      '<a href=3D"other.html">Other</a></body></html>',
      '------=_NextPart',
      'Content-Type: image/png',
      'Content-Transfer-Encoding: base64',
      'Content-Location: https://example.org/case/seal.png',
      '',
      PNG_1PX,
      '------=_NextPart',
      'Content-Type: text/css',
      'Content-Location: https://example.org/case/site.css',
      '',
      'h1 { color: navy; background: url(seal.png); }',
      '------=_NextPart--',
      '',
    ].join('\r\n')
    const html = await renderMht(new Blob([mht]))
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.querySelector('h1')?.textContent).toBe('R v Mensah')
    const images = Array.from(doc.querySelectorAll('img'))
    expect(images[0].getAttribute('src')).toMatch(/^data:image\/png;base64,/)
    // A picture that was not saved with the page is not fetched from the internet.
    expect(images[1].hasAttribute('src')).toBe(false)
    expect(doc.querySelector('script')).toBeNull()
    expect(doc.querySelector('style')?.textContent).toContain('url("data:image/png;base64,')
    expect(doc.querySelector('a')?.getAttribute('href')).toBe('https://example.org/case/other.html')
  })
})
