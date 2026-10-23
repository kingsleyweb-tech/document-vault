// Reads text, headings, metadata and links from a web page without rendering
// it. Nothing in the page runs and nothing it refers to is fetched: scripts,
// styles and templates are skipped unread, and links are only collected as
// text for the caller to check against the libraries.

import { decodeText } from './text.js'

const RAW_TEXT = new Set(['script', 'style', 'template', 'noscript', 'svg', 'math', 'object', 'iframe', 'textarea'])
const LINE_BREAKS = new Set([
  'p', 'div', 'br', 'li', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'section', 'article', 'header',
  'footer', 'ul', 'ol', 'dd', 'dt', 'blockquote', 'pre', 'hr', 'title', 'nav', 'aside', 'main', 'figure', 'figcaption',
])
const LINK_ATTRIBUTE = { a: 'href', area: 'href', frame: 'src', iframe: 'src' }
const MAX_LINKS = 5000
const MAX_LABEL = 200

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', mdash: '—', ndash: '–',
  hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', sect: '§', para: '¶', middot: '·',
  bull: '•', deg: '°', eacute: 'é', egrave: 'è', ecirc: 'ê', aacute: 'á', agrave: 'à', acirc: 'â', ocirc: 'ô', ouml: 'ö',
  uuml: 'ü', auml: 'ä', ccedil: 'ç', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', szlig: 'ß', pound: '£', euro: '€',
  cent: '¢', yen: '¥', times: '×', divide: '÷', frac12: '½', frac14: '¼', frac34: '¾', shy: '',
}

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return NAMED[body.toLowerCase()] ?? whole
  })
}

function parseAttributes(source) {
  const attributes = {}
  const pattern = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  let match
  while ((match = pattern.exec(source))) {
    const name = match[1].toLowerCase()
    if (!(name in attributes)) attributes[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attributes
}

/** Finds the end of a tag, skipping quoted attribute values that may contain ">". */
function tagEnd(html, from) {
  let quote = null
  for (let index = from; index < html.length; index += 1) {
    const character = html[index]
    if (quote) {
      if (character === quote) quote = null
    } else if (character === '"' || character === "'") quote = character
    else if (character === '>') return index
  }
  return -1
}

/**
 * Parses a page. Returns { title, headings, text, links, meta } where links
 * are { href, label } exactly as written in the page (entity-decoded only).
 */
export function parseHtml(html) {
  const out = []
  const headings = []
  const links = []
  const meta = {}
  let title = ''
  let link = null
  let heading = null
  let index = 0
  const lower = html.toLowerCase()

  const addText = (raw) => {
    const text = decodeEntities(raw).replace(/\s+/g, ' ')
    if (!text.trim()) {
      if (text && out.length > 0 && !out[out.length - 1].endsWith(' ')) out.push(' ')
      return
    }
    out.push(text)
    if (link && link.label.length < MAX_LABEL) link.label += text
    if (heading) heading.text += text
  }

  while (index < html.length) {
    const open = html.indexOf('<', index)
    if (open === -1) {
      addText(html.slice(index))
      break
    }
    if (open > index) addText(html.slice(index, open))
    if (html.startsWith('<!--', open)) {
      const close = html.indexOf('-->', open + 4)
      index = close === -1 ? html.length : close + 3
      continue
    }
    if (html[open + 1] === '!' || html[open + 1] === '?') {
      const close = html.indexOf('>', open)
      index = close === -1 ? html.length : close + 1
      continue
    }
    const closing = html[open + 1] === '/'
    const nameMatch = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(html.slice(open + (closing ? 2 : 1), open + 40))
    if (!nameMatch) {
      // A lone "<" in text.
      addText('<')
      index = open + 1
      continue
    }
    const name = nameMatch[0].toLowerCase()
    const end = tagEnd(html, open + 1)
    if (end === -1) break
    index = end + 1
    if (LINE_BREAKS.has(name)) out.push('\n')

    if (closing) {
      if ((name === 'a' || name === 'area') && link) {
        link = null
        // Keeps the words of neighbouring links apart in the searchable text.
        out.push(' ')
      }
      if (/^h[1-6]$/.test(name) && heading) {
        const text = heading.text.replace(/\s+/g, ' ').trim()
        if (text) headings.push({ level: heading.level, text: text.slice(0, 300) })
        heading = null
      }
      continue
    }

    const attributes = parseAttributes(html.slice(open + 1 + name.length, end))
    if (name === 'title') {
      const close = lower.indexOf('</title', index)
      const raw = html.slice(index, close === -1 ? html.length : close)
      // Kept as the page's title (searchable as metadata), not repeated in its text.
      if (!title) title = decodeEntities(raw).replace(/\s+/g, ' ').trim().slice(0, 300)
      index = close === -1 ? html.length : tagEnd(html, close) + 1
      continue
    }
    if (name === 'meta' && attributes.name && attributes.content) {
      const key = attributes.name.toLowerCase()
      if (['author', 'description', 'keywords', 'subject', 'dc.title', 'dc.creator'].includes(key)) meta[key] = attributes.content.trim().slice(0, 500)
    }
    const linkAttribute = LINK_ATTRIBUTE[name]
    if (linkAttribute && attributes[linkAttribute] && links.length < MAX_LINKS) {
      const entry = { href: attributes[linkAttribute].trim(), label: '' }
      if (attributes.title) entry.label = attributes.title
      links.push(entry)
      if (name === 'a') link = entry
    }
    if (/^h[1-6]$/.test(name)) heading = { level: Number(name[1]), text: '' }
    if (RAW_TEXT.has(name) && !html.slice(end - 1, end).includes('/')) {
      // Skip the element's content unread, up to its closing tag.
      const close = lower.indexOf(`</${name}`, index)
      index = close === -1 ? html.length : tagEnd(html, close) + 1
    }
  }

  for (const entry of links) entry.label = entry.label.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL)
  const text = out.join('').replace(/[ \t]*\n[ \t\n]*/g, '\n').replace(/[ \t]+/g, ' ').trim()
  return { title, headings, text, links, meta }
}

/** Reads the bytes of a page, using the character set it declares. */
export function decodeHtml(bytes) {
  const head = Buffer.from(bytes.subarray(0, 2048)).toString('latin1')
  const declared = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1]
  return decodeText(bytes, declared)
}
