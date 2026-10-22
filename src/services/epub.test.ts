// @vitest-environment happy-dom
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { cleanCss, openEpub, resolvePath } from './epub'

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function buildEpub({ nav = true }: { nav?: boolean } = {}) {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip')
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  )
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Test Book</dc:title><dc:creator>A. Writer</dc:creator></metadata>
      <manifest>
        ${nav ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' : ''}
        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
        <item id="c1" href="text/chapter%201.xhtml" media-type="application/xhtml+xml"/>
        <item id="c2" href="text/chapter2.xhtml" media-type="application/xhtml+xml"/>
        <item id="css" href="styles/book.css" media-type="text/css"/>
        <item id="img" href="images/dot.png" media-type="image/png"/>
      </manifest>
      <spine toc="ncx"><itemref idref="c2"/><itemref idref="c1"/></spine>
    </package>`,
  )
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
      <nav epub:type="toc"><ol>
        <li><a href="text/chapter2.xhtml">Opening</a></li>
        <li><a href="text/chapter%201.xhtml">Ending</a><ol><li><a href="text/chapter%201.xhtml#part">A part</a></li></ol></li>
      </ol></nav></body></html>`,
  )
  zip.file(
    'OEBPS/toc.ncx',
    `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
      <navPoint id="p1"><navLabel><text>NCX Opening</text></navLabel><content src="text/chapter2.xhtml"/></navPoint>
      <navPoint id="p2"><navLabel><text>NCX Ending</text></navLabel><content src="text/chapter%201.xhtml"/></navPoint>
    </navMap></ncx>`,
  )
  zip.file(
    'OEBPS/text/chapter 1.xhtml',
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="../styles/book.css"/></head>
      <body><h1 id="part">The end</h1><img src="../images/dot.png" alt="dot"/><script>alert(1)</script>
      <p onclick="steal()">Bye</p><a href="chapter2.xhtml">Back</a></body></html>`,
  )
  zip.file('OEBPS/text/chapter2.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Once upon a time</p></body></html>')
  zip.file('OEBPS/styles/book.css', '@import url("https://evil.example/x.css"); h1 { color: red; background: url(https://evil.example/bg.png) }')
  zip.file('OEBPS/images/dot.png', PNG_1PX, { base64: true })
  return zip.generateAsync({ type: 'blob' })
}

describe('openEpub', () => {
  it('reads the title, author, spine order and EPUB 3 contents', async () => {
    const book = await openEpub(await buildEpub())
    expect(book.title).toBe('The Test Book')
    expect(book.author).toBe('A. Writer')
    expect(book.chapters.map((chapter) => chapter.path)).toEqual(['OEBPS/text/chapter2.xhtml', 'OEBPS/text/chapter 1.xhtml'])
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['Opening', 'Ending'])
    expect(book.toc).toEqual([
      { title: 'Opening', chapterIndex: 0, fragment: undefined, depth: 0 },
      { title: 'Ending', chapterIndex: 1, fragment: undefined, depth: 0 },
      { title: 'A part', chapterIndex: 1, fragment: 'part', depth: 1 },
    ])
  })

  it('falls back to the EPUB 2 NCX contents', async () => {
    const book = await openEpub(await buildEpub({ nav: false }))
    expect(book.toc.map((entry) => entry.title)).toEqual(['NCX Opening', 'NCX Ending'])
  })

  it('renders a chapter with styles and pictures inlined and scripts removed', async () => {
    const book = await openEpub(await buildEpub())
    const html = await book.renderChapter(1)
    expect(html).toContain('The end')
    expect(html).toContain(`data:image/png;base64,${PNG_1PX}`)
    expect(html).toContain('h1 { color: red;')
    expect(html).toContain('Content-Security-Policy')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('evil.example')
  })

  it('rejects files that are not books', async () => {
    const zip = new JSZip()
    zip.file('readme.txt', 'hello')
    await expect(openEpub(await zip.generateAsync({ type: 'blob' }))).rejects.toThrow(/package file/)
  })
})

describe('epub helpers', () => {
  it('resolves paths relative to a file and decodes them', () => {
    expect(resolvePath('OEBPS/text/a.xhtml', '../images/b%20c.png#x')).toBe('OEBPS/images/b c.png')
    expect(resolvePath('content.opf', 'text/a.xhtml')).toBe('text/a.xhtml')
  })

  it('removes imports and outside urls from stylesheets', () => {
    expect(cleanCss(`@import "x.css"; p { background: url('https://x/y.png') }`)).toBe(' p { background: none }')
    expect(cleanCss('p { background: url(data:image/png;base64,AAA) }')).toContain('data:image/png')
  })
})
