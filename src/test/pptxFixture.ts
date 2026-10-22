import JSZip from 'jszip'

const P_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const SLIDE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide'
const LAYOUT_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout'
const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'

// 1x1 transparent PNG
const PNG_BYTES = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)

export interface FixtureOptions {
  slideCount: number
  /**
   * Maps presentation position (0-based) to the slideN.xml file number.
   * Defaults to identity. Real merged decks often have a scrambled mapping.
   */
  fileNumberForPosition?: (position: number) => number
  withImageOnFile?: number
}

/**
 * Builds a minimal but structurally valid .pptx archive. Each slide's title is
 * "Deck slide P" where P is its 1-based presentation position, so a test can
 * tell immediately whether a viewer shows the right slide.
 */
export async function buildPptx({ slideCount, fileNumberForPosition = (p) => p + 1, withImageOnFile }: FixtureOptions) {
  const zip = new JSZip()
  const sldIds: string[] = []
  const rels: string[] = [
    `<Relationship Id="rIdMaster" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>`,
  ]

  for (let position = 0; position < slideCount; position += 1) {
    const fileNumber = fileNumberForPosition(position)
    const relId = `rIdS${fileNumber}`
    sldIds.push(`<p:sldId id="${256 + position}" r:id="${relId}"/>`)
    rels.push(`<Relationship Id="${relId}" Type="${SLIDE_REL}" Target="slides/slide${fileNumber}.xml"/>`)

    const hasImage = withImageOnFile === fileNumber
    zip.file(`ppt/slides/slide${fileNumber}.xml`, slideXml(position + 1, hasImage))
    zip.file(
      `ppt/slides/_rels/slide${fileNumber}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rIdL" Type="${LAYOUT_REL}" Target="../slideLayouts/slideLayout1.xml"/>` +
        (hasImage ? `<Relationship Id="rIdImg" Type="${IMAGE_REL}" Target="../media/image1.png"/>` : '') +
        `</Relationships>`,
    )
  }

  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="${P_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}">` +
      `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdMaster"/></p:sldMasterIdLst>` +
      `<p:sldIdLst>${sldIds.join('')}</p:sldIdLst>` +
      `<p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
  )
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`,
  )
  zip.file(
    'ppt/slideLayouts/slideLayout1.xml',
    `<?xml version="1.0" encoding="UTF-8"?><p:sldLayout xmlns:p="${P_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}"><p:cSld><p:spTree>` +
      placeholderShape('title', undefined, 838200, 365125, 10515600, 1325563) +
      placeholderShape(undefined, '1', 838200, 1825625, 10515600, 4351338) +
      `</p:spTree></p:cSld></p:sldLayout>`,
  )
  zip.file(
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rIdM" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  )
  zip.file(
    'ppt/slideMasters/slideMaster1.xml',
    `<?xml version="1.0" encoding="UTF-8"?><p:sldMaster xmlns:p="${P_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:bgPr></p:bg><p:spTree/></p:cSld></p:sldMaster>`,
  )
  // Like real decks, the master lists its layouts as relationships.
  zip.file(
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rIdL1" Type="${LAYOUT_REL}" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
  )
  if (withImageOnFile) zip.file('ppt/media/image1.png', PNG_BYTES)

  return zip.generateAsync({ type: 'arraybuffer' })
}

function placeholderShape(type: string | undefined, idx: string | undefined, x: number, y: number, cx: number, cy: number) {
  const ph = `<p:ph${type ? ` type="${type}"` : ''}${idx ? ` idx="${idx}"` : ''}/>`
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${idx ?? 2}" name="ph"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="${type === 'title' ? 4400 : 2800}"/><a:t>Layout text</a:t></a:r></a:p></p:txBody></p:sp>`
  )
}

function slideXml(position: number, withImage: boolean) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="${P_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}"><p:cSld><p:spTree>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/>` +
    `<p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>Deck slide ${position}</a:t></a:r></a:p></p:txBody></p:sp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>` +
    `<p:txBody><a:bodyPr/><a:p><a:pPr><a:buChar char="-"/></a:pPr><a:r><a:t>Body text for position ${position}</a:t></a:r></a:p></p:txBody></p:sp>` +
    (withImage
      ? `<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImg"/></p:blipFill>` +
        `<p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="952500" cy="952500"/></a:xfrm></p:spPr></p:pic>`
      : '') +
    `</p:spTree></p:cSld></p:sld>`
  )
}
