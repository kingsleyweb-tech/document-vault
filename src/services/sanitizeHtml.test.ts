// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

vi.mock('./googleDrive', () => ({}))
vi.mock('./offlineStore', () => ({}))

const { sanitizeHtml } = await import('./documentViewer')

function parse(html: string) {
  return new DOMParser().parseFromString(sanitizeHtml(html), 'text/html')
}

describe('sanitizeHtml', () => {
  it('removes active content and remote-loading elements', () => {
    const doc = parse(
      '<html><head><link rel="stylesheet" href="https://evil.example/x.css"><meta http-equiv="refresh" content="0;url=https://evil.example"></head>' +
        '<body><script>alert(1)</script><iframe src="https://evil.example"></iframe><form action="https://evil.example"><input></form>' +
        '<p onclick="steal()">Text</p><a href="javascript:alert(1)">x</a><a href=" JavaScript:alert(1)">y</a></body></html>',
    )
    expect(doc.querySelector('script, iframe, form, input, link')).toBeNull()
    expect(doc.querySelector('meta[http-equiv="refresh"]')).toBeNull()
    expect(doc.querySelector('p')?.getAttribute('onclick')).toBeNull()
    doc.querySelectorAll('a').forEach((anchor) => expect(anchor.getAttribute('href')).toBeNull())
    expect(doc.querySelector('p')?.textContent).toBe('Text')
  })

  it('adds a content security policy that blocks remote requests', () => {
    const csp = parse('<p>Hello</p>').querySelector('meta[http-equiv="Content-Security-Policy"]')
    expect(csp?.getAttribute('content')).toContain("default-src 'none'")
    expect(csp?.getAttribute('content')).toContain('img-src data: blob:')
  })

  it('keeps embedded raster images but drops other data URLs', () => {
    const doc = parse('<img src="data:image/png;base64,AAAA"><img src="data:text/html;base64,PHNjcmlwdD4="><img src="data:image/svg+xml,<svg/>">')
    const sources = Array.from(doc.querySelectorAll('img')).map((img) => img.getAttribute('src'))
    expect(sources).toEqual(['data:image/png;base64,AAAA', null, null])
  })

  it('returns styles and body only, without a policy tag, in fragment mode', () => {
    const html = sanitizeHtml('<style>td { color: red }</style><table><tr><td onclick="x()">1</td></tr></table><script>alert(1)</script>', { fragment: true })
    expect(html.startsWith('<style>td { color: red }</style>')).toBe(true)
    expect(html).not.toMatch(/<meta|<html|<head|<body|<script|onclick/i)
    expect(html).toContain('<td>1</td>')
  })
})
