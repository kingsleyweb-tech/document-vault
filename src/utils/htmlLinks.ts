// Link handling for previewed web pages, shared by the vault viewer and the
// preview of files on this computer.

export function safeDecode(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** The file name at the end of a link or path, for messages. */
export function linkFileName(href: string) {
  const path = safeDecode(href.split('#')[0].split('?')[0])
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

/**
 * Makes links in a previewed page work without letting the page navigate its
 * frame: #anchors scroll within the page, web links go to `followWebLink` (or
 * open in a new window), and links to other files open that file from the vault.
 */
export function wireHtmlLinks(frame: HTMLIFrameElement | null, followFileLink: (href: string) => void, followWebLink?: (href: string) => void) {
  const frameDocument = frame?.contentDocument
  if (!frameDocument) return

  frameDocument.addEventListener('click', (event) => {
    const anchor = (event.target as Element | null)?.closest?.('a[href]')
    if (!anchor) return
    event.preventDefault()
    const href = anchor.getAttribute('href')?.trim() ?? ''
    if (href.startsWith('#')) {
      const id = safeDecode(href.slice(1))
      const target = id ? (frameDocument.getElementById(id) ?? frameDocument.getElementsByName(id)[0]) : null
      if (target) target.scrollIntoView({ block: 'start' })
      else if (!id) frameDocument.scrollingElement?.scrollTo({ top: 0 })
      return
    }
    if (/^https?:/i.test(href) && followWebLink) {
      followWebLink(href)
      return
    }
    if (/^(https?:|mailto:)/i.test(href)) {
      window.open(href, '_blank', 'noopener,noreferrer')
      return
    }
    // Other schemes (file:, data: and so on) are not followed.
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) return
    followFileLink(href)
  })
}
