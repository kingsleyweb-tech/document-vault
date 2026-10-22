// iPhones and iPads (every browser there is Safari underneath) close a page
// that uses a lot of memory and show "A problem repeatedly occurred". Phones and
// tablets with little memory behave much the same. On these devices the app
// keeps fewer pages drawn, draws them smaller and leaves heavy background work
// (OCR, preparing documents ahead of time) to computers.

let constrained: boolean | null = null

export function isAppleMobile(nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> = navigator) {
  // iPadOS reports itself as a Mac; a Mac has no touch screen.
  return /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
}

export function isMemoryConstrained() {
  if (constrained !== null) return constrained
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  const smallScreen = Math.min(window.screen?.width ?? 1024, window.screen?.height ?? 1024) < 600
  constrained = isAppleMobile() || (memory !== undefined && memory <= 4) || (coarse && smallScreen)
  return constrained
}
