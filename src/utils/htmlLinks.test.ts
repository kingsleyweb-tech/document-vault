// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { linkFileName, wireHtmlLinks } from './htmlLinks'

// happy-dom does not load frames, so a frame is stood in for by its document.
function framed(html: string) {
  const page = document.implementation.createHTMLDocument('Page')
  page.body.innerHTML = html
  return { contentDocument: page } as unknown as HTMLIFrameElement
}

function click(frame: HTMLIFrameElement, selector: string) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  frame.contentDocument!.querySelector(selector)!.dispatchEvent(event)
  return event
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('wireHtmlLinks', () => {
  it('scrolls to a chapter for a link within the page', () => {
    const frame = framed('<a id="toc" href="#ch2">Chapter 2</a><h2 id="ch2">Chapter 2</h2>')
    const follow = vi.fn()
    wireHtmlLinks(frame, follow)
    const heading = frame.contentDocument!.getElementById('ch2')!
    const scroll = vi.fn()
    heading.scrollIntoView = scroll
    const event = click(frame, '#toc')
    expect(event.defaultPrevented).toBe(true)
    expect(scroll).toHaveBeenCalled()
    expect(follow).not.toHaveBeenCalled()
  })

  it('opens web links in a new window instead of inside the preview', () => {
    const frame = framed('<a href="https://www.law.cornell.edu/">Cornell</a>')
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    wireHtmlLinks(frame, vi.fn())
    expect(click(frame, 'a').defaultPrevented).toBe(true)
    expect(open).toHaveBeenCalledWith('https://www.law.cornell.edu/', '_blank', 'noopener,noreferrer')
  })

  it('hands links to other files to the viewer, including from nested elements', () => {
    const frame = framed('<a href="Criminal%20Law.htm#ch1"><span id="inner">Criminal Law</span></a>')
    const follow = vi.fn()
    wireHtmlLinks(frame, follow)
    expect(click(frame, '#inner').defaultPrevented).toBe(true)
    expect(follow).toHaveBeenCalledWith('Criminal%20Law.htm#ch1')
  })

  it('does not follow other kinds of address', () => {
    const frame = framed('<a href="file:///C:/Windows/notepad.exe">Notepad</a>')
    const follow = vi.fn()
    wireHtmlLinks(frame, follow)
    expect(click(frame, 'a').defaultPrevented).toBe(true)
    expect(follow).not.toHaveBeenCalled()
  })
})

describe('linkFileName', () => {
  it('names the file a link or path leads to', () => {
    expect(linkFileName('../Books/Law%20of%20Torts.htm#ch3')).toBe('Law of Torts.htm')
    expect(linkFileName('C:\\Law\\Company Law.htm')).toBe('Company Law.htm')
  })
})
