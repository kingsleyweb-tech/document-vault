import { useEffect } from 'react'

// While a viewer, dialog or menu sheet is open the page behind it must not
// scroll: on phones a swipe would otherwise move the library underneath, and
// the open layer could end up partly off screen. Several layers can be open at
// once, so the lock is counted.
let locks = 0
let saved: { overflow: string; overscroll: string } | null = null

export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return undefined
    const root = document.documentElement
    if (locks === 0) {
      saved = { overflow: root.style.overflow, overscroll: root.style.overscrollBehavior }
      root.style.overflow = 'hidden'
      root.style.overscrollBehavior = 'none'
    }
    locks += 1
    return () => {
      locks -= 1
      if (locks === 0 && saved) {
        root.style.overflow = saved.overflow
        root.style.overscrollBehavior = saved.overscroll
        saved = null
      }
    }
  }, [active])
}
