// @vitest-environment happy-dom
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { buildPptx } from '../test/pptxFixture'
import { createPptxDocument, openPptx, resolvePartPath } from './pptx'

/** Presentation position -> file number, the way merged decks end up: the first
 * slide in the deck lives in slide600.xml. */
function mergedDeckOrder(slideCount: number) {
  return (position: number) => ((position + 599) % slideCount) + 1
}

describe('pptx slide order', () => {
  it('follows presentation.xml, not slide file names', async () => {
    const data = await buildPptx({ slideCount: 1200, fileNumberForPosition: mergedDeckOrder(1200) })
    const doc = await openPptx(data)

    expect(doc.slides).toHaveLength(1200)
    expect(doc.slides[0]).toEqual({ number: 1, path: 'ppt/slides/slide600.xml' })

    const first = await doc.loadSlide(0)
    expect(first.number).toBe(1)
    expect(first.title).toBe('Deck slide 1')

    const last = await doc.loadSlide(1199)
    expect(last.title).toBe('Deck slide 1200')
    doc.dispose()
  })

  it.each([1, 20, 100, 500, 1000])('opens a %i-slide deck on slide 1 with the right content', async (count) => {
    const data = await buildPptx({ slideCount: count, fileNumberForPosition: (p) => count - p })
    const doc = await openPptx(data)
    expect(doc.slides).toHaveLength(count)
    expect((await doc.loadSlide(0)).title).toBe('Deck slide 1')
    expect((await doc.loadSlide(count - 1)).title).toBe(`Deck slide ${count}`)
    doc.dispose()
  })

  it('falls back to file-name order when presentation.xml has no slide list', async () => {
    const zip = new JSZip()
    zip.file('ppt/slides/slide10.xml', '<p:sld xmlns:p="p" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree/></p:cSld></p:sld>')
    zip.file('ppt/slides/slide2.xml', '<p:sld xmlns:p="p"><p:cSld><p:spTree/></p:cSld></p:sld>')
    const doc = await createPptxDocument(zip)
    expect(doc.slides.map((s) => s.path)).toEqual(['ppt/slides/slide2.xml', 'ppt/slides/slide10.xml'])
  })
})

describe('pptx slide content', () => {
  it('inherits placeholder positions from the layout and reads text formatting', async () => {
    const doc = await openPptx(await buildPptx({ slideCount: 3 }))
    const slide = await doc.loadSlide(1)
    const title = slide.elements.find((e) => e.type === 'text' && e.isTitle)
    expect(title).toMatchObject({ x: 838200, y: 365125, w: 10515600 })
    if (title?.type === 'text') expect(title.paragraphs[0].runs[0].sizePt).toBe(44)

    const body = slide.elements.find((e) => e.type === 'text' && !e.isTitle)
    expect(body).toMatchObject({ x: 838200, y: 1825625 })
    if (body?.type === 'text') expect(body.paragraphs[0].bullet).toBe(true)
    expect(slide.background).toBe('#FFFFFF')
    expect(doc.width).toBe(1280)
    expect(doc.height).toBe(720)
  })

  it('only attaches images that the slide actually references', async () => {
    const doc = await openPptx(await buildPptx({ slideCount: 3, withImageOnFile: 2 }))
    const withImage = await doc.loadSlide(1)
    const withoutImage = await doc.loadSlide(0)
    expect(withImage.elements.filter((e) => e.type === 'image')).toHaveLength(1)
    expect(withoutImage.elements.filter((e) => e.type === 'image')).toHaveLength(0)
  })

  it('extracts slide text without rendering', async () => {
    const doc = await openPptx(await buildPptx({ slideCount: 5, fileNumberForPosition: (p) => 5 - p }))
    expect(await doc.loadSlideText(0)).toEqual(['Deck slide 1', 'Body text for position 1'])
  })
})

describe('resolvePartPath', () => {
  it('resolves relative and absolute targets', () => {
    expect(resolvePartPath('ppt/slides', '../media/image1.png')).toBe('ppt/media/image1.png')
    expect(resolvePartPath('ppt', 'slides/slide1.xml')).toBe('ppt/slides/slide1.xml')
    expect(resolvePartPath('ppt/slides', '/ppt/media/a.png')).toBe('ppt/media/a.png')
  })
})
