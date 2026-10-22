import { describe, expect, it } from 'vitest'
import { anchoredOffset, computePageTops, PAGE_BORDER, PAGE_GAP, PAGE_HEADER, pageIndexAt } from './pdfLayout'

const card = (pageWidth: number, aspect: number) => PAGE_HEADER + PAGE_BORDER + Math.round(pageWidth * aspect) + PAGE_GAP

describe('PDF page layout', () => {
  it('places pages from their sizes before anything is drawn', () => {
    // A4 portrait, then A4 landscape.
    const tops = computePageTops(3, [595, 842, 842, 595, 595, 842], 800)
    expect(tops[1]).toBe(card(800, 842 / 595))
    expect(tops[2] - tops[1]).toBe(card(800, 595 / 842))
    expect(tops[3]).toBe(2 * card(800, 842 / 595) + card(800, 595 / 842))
  })

  it('assumes unknown pages are shaped like the last known page', () => {
    const tops = computePageTops(1000, [612, 792], 900)
    expect(tops[1000]).toBe(1000 * card(900, 792 / 612))
    // A book whose cover is shaped differently from its pages.
    const book = computePageTops(1000, [252, 312, 510, 669], 900)
    expect(book[1000] - book[2]).toBe(998 * card(900, 669 / 510))
  })

  it('finds the page under any offset', () => {
    const tops = computePageTops(400, [612, 792], 900)
    expect(pageIndexAt(tops, 0)).toBe(0)
    expect(pageIndexAt(tops, tops[1] - 1)).toBe(0)
    expect(pageIndexAt(tops, tops[1])).toBe(1)
    expect(pageIndexAt(tops, tops[199] + 5)).toBe(199)
    expect(pageIndexAt(tops, tops[400] + 5000)).toBe(399)
  })

  it('keeps the page at the top of the view in place when sizes above it become known', () => {
    // Opened assuming every page is portrait; pages 1-50 turn out landscape.
    const guessed = computePageTops(400, [612, 792], 900)
    const sizes: number[] = []
    for (let page = 1; page <= 400; page += 1) sizes.push(...(page <= 50 ? [792, 612] : [612, 792]))
    const actual = computePageTops(400, sizes, 900)

    // Reading page 200, a quarter of the way down.
    const y = guessed[199] + (guessed[200] - guessed[199]) / 4
    const next = anchoredOffset(guessed, actual, y)
    expect(pageIndexAt(actual, next)).toBe(199)
    expect(next - actual[199]).toBeCloseTo((actual[200] - actual[199]) / 4)
  })

  it('keeps the place when the zoom or window width changes', () => {
    const narrow = computePageTops(50, [612, 792], 360)
    const wide = computePageTops(50, [612, 792], 900)
    const y = narrow[30] + 10
    const next = anchoredOffset(narrow, wide, y)
    expect(pageIndexAt(wide, next)).toBe(30)
  })

  it('leaves the top of the document alone', () => {
    const a = computePageTops(10, [612, 792], 900)
    const b = computePageTops(10, [792, 612], 900)
    expect(anchoredOffset(a, b, 0)).toBe(0)
  })
})
