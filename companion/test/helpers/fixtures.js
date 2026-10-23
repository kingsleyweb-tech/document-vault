// Builds small but valid documents for the tests, so no binary fixtures are
// checked in and every test shows exactly what its document contains.
import JSZip from 'jszip'
import { createCanvas } from '@napi-rs/canvas'

const escapePdf = (text) => text.replace(/[\\()]/g, (character) => '\\' + character)

/** A PDF with one line of text per page; an empty string makes a page with no text (like a scan). */
export function makePdf(pages, info = {}) {
  const objects = []
  const add = (body) => {
    objects.push(body)
    return objects.length
  }
  const catalog = add(null)
  const pagesObject = add(null)
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const kids = []
  for (const text of pages) {
    const stream = text ? `BT /F1 12 Tf 72 720 Td (${escapePdf(text)}) Tj ET` : ''
    const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`)
    kids.push(add(`<< /Type /Page /Parent ${pagesObject} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`))
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObject} 0 R >>`
  objects[pagesObject - 1] = `<< /Type /Pages /Kids [${kids.map((kid) => `${kid} 0 R`).join(' ')}] /Count ${kids.length} >>`
  const infoEntries = Object.entries(info).map(([key, value]) => `/${key} (${escapePdf(value)})`).join(' ')
  const infoObject = infoEntries ? add(`<< ${infoEntries} >>`) : null

  let out = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(out, 'latin1'))
    out += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  out += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${infoObject ? ` /Info ${infoObject} 0 R` : ''} >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

/** A Word document with one paragraph per string. */
export async function makeDocx(paragraphs, { title, creator } = {}) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>')
  const body = paragraphs.map((text) => `<w:p><w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`).join('')
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`)
  zip.file('docProps/core.xml', `<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">${title ? `<dc:title>${xml(title)}</dc:title>` : ''}${creator ? `<dc:creator>${xml(creator)}</dc:creator>` : ''}</cp:coreProperties>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}

/** An EPUB with one chapter per { title, text }. */
export async function makeEpub(chapters, { title, creator } = {}) {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip')
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
  const manifest = chapters.map((_, index) => `<item id="c${index}" href="text/c${index}.xhtml" media-type="application/xhtml+xml"/>`).join('')
  const spine = chapters.map((_, index) => `<itemref idref="c${index}"/>`).join('')
  zip.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">${title ? `<dc:title>${xml(title)}</dc:title>` : ''}${creator ? `<dc:creator>${xml(creator)}</dc:creator>` : ''}</metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`)
  chapters.forEach((chapter, index) => {
    zip.file(`OEBPS/text/c${index}.xhtml`, `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${xml(chapter.title)}</title></head><body><h1>${xml(chapter.title)}</h1><p>${xml(chapter.text)}</p></body></html>`)
  })
  return zip.generateAsync({ type: 'nodebuffer' })
}

/**
 * A PowerPoint deck with one slide per string. The slide parts are numbered in
 * reverse, so a reader that follows part names instead of the deck order fails.
 */
export async function makePptx(slides) {
  const zip = new JSZip()
  const ids = slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`).join('')
  const rels = slides.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${slides.length - index}.xml"/>`).join('')
  zip.file('ppt/presentation.xml', `<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>${ids}</p:sldIdLst></p:presentation>`)
  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`)
  slides.forEach((text, index) => {
    zip.file(`ppt/slides/slide${slides.length - index}.xml`, `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${xml(text)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`)
  })
  return zip.generateAsync({ type: 'nodebuffer' })
}

function xml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** A picture of a printed page with these lines, as a scanner would produce. */
function drawPage(lines, width = 1275, height = 1650) {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#111111'
  context.font = '34px serif'
  lines.forEach((line, index) => context.fillText(line, 120, 200 + index * 60))
  return canvas
}

/** A PNG scan of one page with these lines. */
export function makeScanImage(lines) {
  return drawPage(lines, 1275, 400 + lines.length * 60).toBuffer('image/png')
}

/**
 * A PDF made of page pictures, like a scanned book: an array of lines becomes
 * a scanned page (a JPEG image, no text layer); a string becomes a normal page
 * with that text, for documents that mix both.
 */
export function makeScannedPdf(pages) {
  const objects = []
  const add = (body) => {
    objects.push(body)
    return objects.length
  }
  const catalog = add(null)
  const pagesObject = add(null)
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const kids = []
  for (const page of pages) {
    let resources
    let stream
    if (typeof page === 'string') {
      resources = `/Font << /F1 ${font} 0 R >>`
      stream = `BT /F1 12 Tf 72 720 Td (${escapePdf(page)}) Tj ET`
    } else {
      const canvas = drawPage(page)
      const jpeg = canvas.toBuffer('image/jpeg', 85)
      const image = add([`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream'])
      resources = `/XObject << /Im1 ${image} 0 R >>`
      stream = 'q 612 0 0 792 0 0 cm /Im1 Do Q'
    }
    const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`)
    kids.push(add(`<< /Type /Page /Parent ${pagesObject} 0 R /MediaBox [0 0 612 792] /Resources << ${resources} >> /Contents ${content} 0 R >>`))
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObject} 0 R >>`
  objects[pagesObject - 1] = `<< /Type /Pages /Kids [${kids.map((kid) => `${kid} 0 R`).join(' ')}] /Count ${kids.length} >>`

  const parts = []
  let size = 0
  const push = (chunk) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'latin1')
    parts.push(buffer)
    size += buffer.length
  }
  push('%PDF-1.4\n')
  const offsets = []
  objects.forEach((body, index) => {
    offsets.push(size)
    push(`${index + 1} 0 obj\n`)
    for (const piece of Array.isArray(body) ? body : [body]) push(piece)
    push('\nendobj\n')
  })
  const xref = size
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join(''))
  push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return Buffer.concat(parts)
}
