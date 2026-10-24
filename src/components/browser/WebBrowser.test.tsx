// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebLibrary, WebNotice, WebState, WebTab } from '../../services/webBrowser'
import { WebBrowser } from './WebBrowser'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const tab = (extra: Partial<WebTab> = {}): WebTab => ({
  id: 1,
  url: 'https://ghalii.org/judgment/2024/12',
  title: 'Mensah v Attorney-General',
  start: false,
  loading: false,
  slow: false,
  canGoBack: true,
  canGoForward: false,
  error: null,
  source: { name: 'Constitutional Law Casebook.htm', entryId: 9 },
  sleeping: false,
  unresponsive: false,
  ...extra,
})

const emptyLibrary: WebLibrary = { folders: [], bookmarks: [], history: [] }

// A stand-in for the desktop app's bridge (desktop/src/preload.cjs).
function fakeBridge(state: WebState, library: WebLibrary = emptyLibrary) {
  const listeners: { state: ((value: WebState) => void)[]; notice: ((value: WebNotice) => void)[] } = { state: [], notice: [] }
  const requests: Record<string, unknown>[] = []
  const request = vi.fn(async (body: Record<string, unknown>) => {
    requests.push(body)
    if (body.action === 'state') return { ok: true, value: state }
    if (body.action === 'library') return { ok: true, value: library }
    if (body.action === 'navigate' && String(body.input).startsWith('file:')) return { ok: true, value: { error: 'Addresses starting with “file:” cannot be opened.' } }
    if (body.action === 'save-bookmark') {
      return { ok: true, value: { existed: false, bookmark: { id: 'b1', url: body.url, title: body.title, note: '', folder: '', source: body.source, createdAt: 1, updatedAt: 1, check: null, duplicate: false } } }
    }
    return { ok: true, value: { ok: true } }
  })
  ;(window as Window & { documentVaultDesktop?: unknown }).documentVaultDesktop = {
    web: {
      request,
      onState: (listener: (value: WebState) => void) => {
        listeners.state.push(listener)
        return () => {}
      },
      onNotice: (listener: (value: WebNotice) => void) => {
        listeners.notice.push(listener)
        return () => {}
      },
      onCheck: () => () => {},
    },
  }
  return {
    requests,
    hosts: () => requests.filter((item) => item.action === 'host'),
    push: (value: WebState) => listeners.state.forEach((listener) => listener(value)),
    notice: (value: WebNotice) => listeners.notice.forEach((listener) => listener(value)),
  }
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

async function render(node: React.ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(node))
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
}

const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0))
  // happy-dom does no layout; give elements a size so the page area has one.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 120, left: 0, top: 120, right: 900, bottom: 720, width: 900, height: 600, toJSON: () => ({}) } as DOMRect)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete (window as Window & { documentVaultDesktop?: unknown }).documentVaultDesktop
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('WebBrowser', () => {
  it('shows the page as an online source, with the book it came from', async () => {
    fakeBridge({ tabs: [tab()], activeId: 1, maxTabs: 8 })
    await render(<WebBrowser variant="page" />)
    expect(container.querySelector('.source-badge--web')?.textContent).toBe('Online source')
    expect(container.textContent).toContain('ghalii.org · not checked as a legal authority')
    expect(container.textContent).toContain('From Constitutional Law Casebook.htm')
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Address or search"]')?.value).toBe('https://ghalii.org/judgment/2024/12')
    expect(button('Back')?.disabled).toBe(false)
    expect(button('Forward')?.disabled).toBe(true)
  })

  it('tells the main process where to draw the page, and hides it when the start page shows', async () => {
    const bridge = fakeBridge({ tabs: [tab()], activeId: 1, maxTabs: 8 })
    await render(<WebBrowser variant="page" />)
    expect(bridge.hosts().at(-1)?.bounds).toEqual({ x: 0, y: 120, width: 900, height: 600 })
    await act(async () => bridge.push({ tabs: [tab({ start: true })], activeId: 1, maxTabs: 8 }))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(bridge.hosts().at(-1)?.bounds).toBeNull()
    expect(container.textContent).toContain('Starting points')
  })

  it('explains an address that cannot be opened', async () => {
    const bridge = fakeBridge({ tabs: [tab()], activeId: 1, maxTabs: 8 })
    await render(<WebBrowser variant="page" />)
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Address or search"]') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'file:///C:/Windows/win.ini')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      input.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(bridge.requests.some((item) => item.action === 'navigate' && item.input === 'file:///C:/Windows/win.ini')).toBe(true)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('cannot be opened')
  })

  it('shows blocked downloads and refusals from the main process', async () => {
    const bridge = fakeBridge({ tabs: [tab()], activeId: 1, maxTabs: 8 })
    await render(<WebBrowser variant="page" />)
    await act(async () => bridge.notice({ tabId: 1, kind: 'download', message: 'Downloads are blocked in Document Vault’s browser, so “a.pdf” was not saved.', url: 'https://ghalii.org/a.pdf', at: 1 }))
    expect(container.textContent).toContain('Downloads are blocked')
  })

  it('shows a clear error page when a site cannot be reached', async () => {
    const bridge = fakeBridge({ tabs: [tab()], activeId: 1, maxTabs: 8 })
    await render(<WebBrowser variant="page" />)
    await act(async () =>
      bridge.push({ tabs: [tab({ error: { code: -106, url: 'https://ghalii.org/', title: 'You are offline', detail: 'Check your internet connection, then try again.' } })], activeId: 1, maxTabs: 8 }),
    )
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(container.querySelector('.web-browser__error h2')?.textContent).toBe('You are offline')
    expect(container.textContent).toContain('Try again')
    expect(bridge.hosts().at(-1)?.bounds).toBeNull()
  })

  it('saves the page as a reference, keeping the book it came from', async () => {
    const bridge = fakeBridge({ tabs: [tab()], activeId: 1, maxTabs: 8 })
    await render(<WebBrowser variant="page" />)
    await act(async () => button('Save this page')?.click())
    const saved = bridge.requests.find((item) => item.action === 'save-bookmark')
    expect(saved).toMatchObject({ url: 'https://ghalii.org/judgment/2024/12', title: 'Mensah v Attorney-General', source: { name: 'Constitutional Law Casebook.htm', entryId: 9 } })
    expect(container.querySelector('.web-panel')).not.toBeNull()
  })

  it('marks saved references that point to the same page', async () => {
    const bookmark = (id: string, url: string) => ({ id, url, title: id, note: '', folder: 'Cases', source: null, createdAt: 1, updatedAt: 1, check: null, duplicate: true })
    fakeBridge({ tabs: [tab()], activeId: 1, maxTabs: 8 }, { folders: ['Cases'], bookmarks: [bookmark('One', 'https://ghalii.org/x'), bookmark('Two', 'https://www.ghalii.org/x/')], history: [] })
    await render(<WebBrowser variant="page" />)
    await act(async () => button('Saved references and recent pages')?.click())
    await act(async () => new Promise((resolve) => setTimeout(resolve, 450)))
    expect(container.textContent).toContain('2 duplicates')
  })

  it('does not allow more tabs than the limit', async () => {
    fakeBridge({ tabs: [tab({ id: 1 }), tab({ id: 2 })], activeId: 1, maxTabs: 2 })
    await render(<WebBrowser variant="page" />)
    expect(button('New tab')?.disabled).toBe(true)
  })
})
