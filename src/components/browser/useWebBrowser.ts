import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { webBrowser, type WebLibrary, type WebNotice, type WebState } from '../../services/webBrowser'

/** The browser's tabs, kept up to date by the main process. */
export function useWebState() {
  const [state, setState] = useState<WebState | null>(null)
  useEffect(() => {
    let live = true
    const stop = webBrowser.onState((next) => {
      if (live) setState(next)
    })
    webBrowser.state().then(
      (next) => {
        if (live) setState((current) => current ?? next)
      },
      () => {},
    )
    return () => {
      live = false
      stop()
    }
  }, [])
  return state
}

/** Saved references and recent pages. reload() fetches them again after a change. */
export function useWebLibrary() {
  const [library, setLibrary] = useState<WebLibrary | null>(null)
  const reload = useCallback(() => {
    webBrowser.library().then(setLibrary, () => {})
  }, [])
  useEffect(() => {
    reload()
    // Link checks report one reference at a time.
    return webBrowser.onCheck(({ bookmarkId, result }) =>
      setLibrary((current) =>
        current ? { ...current, bookmarks: current.bookmarks.map((item) => (item.id === bookmarkId ? { ...item, check: result } : item)) } : current,
      ),
    )
  }, [reload])
  return { library, reload }
}

/** The most recent notice (blocked download, pop-up and so on), cleared after a while. */
export function useWebNotice() {
  const [notice, setNotice] = useState<WebNotice | null>(null)
  useEffect(() => webBrowser.onNotice(setNotice), [])
  useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(() => setNotice(null), 9000)
    return () => window.clearTimeout(timer)
  }, [notice])
  return [notice, () => setNotice(null)] as const
}

// Anything drawn over the page (dialogs, menus, pop-overs) must be visible, and
// a web page is drawn by the system on top of the app; so the web page is hidden
// while one is open, unless the browser itself is inside it.
const OVERLAYS = '[role="dialog"], [role="menu"], .popover, .popover-scrim'

function overlayCovers(host: HTMLElement) {
  return [...document.querySelectorAll(OVERLAYS)].some((element) => !element.contains(host))
}

/**
 * Tells the main process where to draw the active web page: over `hostRef`,
 * while `show` is true, the element is on screen and nothing covers it.
 */
export function useWebHost(hostRef: RefObject<HTMLElement | null>, hostId: string, show: boolean) {
  const last = useRef<string>('')
  useLayoutEffect(() => {
    const element = hostRef.current
    let frame = 0
    const send = () => {
      frame = 0
      const rect = element?.getBoundingClientRect()
      const visible = Boolean(element && show && rect && rect.width > 0 && rect.height > 0 && !overlayCovers(element) && document.visibilityState === 'visible')
      const bounds = visible && rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : null
      const key = JSON.stringify(bounds)
      if (key === last.current) return
      last.current = key
      void webBrowser.setHost(hostId, bounds).catch(() => {})
    }
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(send)
    }
    schedule()
    const resize = new ResizeObserver(schedule)
    if (element) resize.observe(element)
    const overlays = new MutationObserver(schedule)
    overlays.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    document.addEventListener('visibilitychange', schedule)
    return () => {
      window.cancelAnimationFrame(frame)
      resize.disconnect()
      overlays.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      document.removeEventListener('visibilitychange', schedule)
    }
  }, [hostRef, hostId, show])

  // Leaving the page hides the web page.
  useEffect(
    () => () => {
      last.current = ''
      void webBrowser.setHost(hostId, null).catch(() => {})
    },
    [hostId],
  )
}

const TRACKING_PARAMETER = /^(utm_[a-z]+|fbclid|gclid|mc_eid|mc_cid)$/i

/** Same rule as the main process uses for duplicate references (web-urls.cjs urlKey). */
export function urlKey(value: string) {
  try {
    const url = new URL(value)
    url.hash = ''
    for (const name of [...url.searchParams.keys()]) if (TRACKING_PARAMETER.test(name)) url.searchParams.delete(name)
    const pathname = url.pathname.replace(/\/+$/, '') || '/'
    const search = url.searchParams.toString()
    return `${url.hostname.toLowerCase().replace(/^www\./, '')}${url.port ? `:${url.port}` : ''}${pathname}${search ? `?${search}` : ''}`
  } catch {
    return value
  }
}
