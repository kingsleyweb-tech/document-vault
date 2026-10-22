// Page layout for the PDF viewer, kept apart from the component so it can be tested.

/** Height of the bar above each page, fixed in CSS (`.pdf-page-card-header`). */
export const PAGE_HEADER = 30
/** Card border, top and bottom. */
export const PAGE_BORDER = 2
export const PAGE_GAP = 24
/** US Letter, used for pages whose size is not known yet. */
const DEFAULT_ASPECT = 11 / 8.5

/**
 * Where each page's card starts: tops[i] for page i + 1, and tops[count] is
 * the total height. `sizes` is [width, height, ...] in points and may cover
 * only the first pages; the rest are assumed to be shaped like the last known
 * one (a book's cover is often a different size from its pages).
 */
export function computePageTops(count: number, sizes: number[], pageWidth: number): Float64Array {
  const tops = new Float64Array(count + 1)
  let knownAspect = DEFAULT_ASPECT
  for (let i = 0; i < count; i += 1) {
    const width = sizes[i * 2]
    const height = sizes[i * 2 + 1]
    if (width && height) knownAspect = height / width
    const aspect = knownAspect
    tops[i + 1] = tops[i] + PAGE_HEADER + PAGE_BORDER + Math.round(pageWidth * aspect) + PAGE_GAP
  }
  return tops
}

/** Index (0-based) of the page whose box contains offset y, by binary search. */
export function pageIndexAt(tops: Float64Array, y: number) {
  const count = tops.length - 1
  if (count <= 0) return 0
  let low = 0
  let high = count - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (tops[mid] <= y) low = mid
    else high = mid - 1
  }
  return low
}

/**
 * The offset that keeps the same spot of the same page at the top of the view
 * after the layout changed from `previous` to `next`.
 */
export function anchoredOffset(previous: Float64Array, next: Float64Array, y: number) {
  if (y <= 0 || previous.length < 2 || next.length < 2) return y
  const index = Math.min(pageIndexAt(previous, y), next.length - 2)
  const span = previous[index + 1] - previous[index]
  const fraction = span > 0 ? Math.min(1, (y - previous[index]) / span) : 0
  return next[index] + fraction * (next[index + 1] - next[index])
}
