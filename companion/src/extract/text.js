// Plain text helpers: decoding bytes, reading RTF, and cutting long text into
// sections that make useful search excerpts.

const SECTION_CHARS = 4000

/** Decodes bytes as text: a byte order mark wins, then the declared charset, then UTF-8, then Windows-1252. */
export function decodeText(bytes, declared = null) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf) return new TextDecoder('utf-8').decode(view.subarray(3))
  if (view[0] === 0xff && view[1] === 0xfe) return new TextDecoder('utf-16le').decode(view.subarray(2))
  if (view[0] === 0xfe && view[1] === 0xff) return new TextDecoder('utf-16be').decode(view.subarray(2))
  if (declared) {
    try {
      return new TextDecoder(declared.toLowerCase()).decode(view)
    } catch {
      // Unknown character set name: fall through.
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(view)
  } catch {
    return new TextDecoder('windows-1252').decode(view)
  }
}

/** Text of an RTF document. Formatting, pictures and embedded objects are dropped unread. */
export function rtfToText(source) {
  const out = []
  // Groups whose content is not body text: destinations marked \*, and known ones.
  const skipped = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'footer', 'themedata', 'datastore', 'latentstyles', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'mmathPr'])
  const stack = []
  let skipping = 0
  let unicodeSkip = 0
  let index = 0
  while (index < source.length) {
    const character = source[index]
    if (character === '{') {
      stack.push(skipping)
      index += 1
      continue
    }
    if (character === '}') {
      skipping = stack.pop() ?? 0
      index += 1
      continue
    }
    if (character === '\\') {
      const next = source[index + 1]
      if (next === '\\' || next === '{' || next === '}') {
        if (!skipping) out.push(next)
        index += 2
        continue
      }
      if (next === '*') {
        skipping = 1
        index += 2
        continue
      }
      if (next === "'") {
        const code = parseInt(source.slice(index + 2, index + 4), 16)
        if (!skipping && unicodeSkip === 0 && Number.isFinite(code)) out.push(new TextDecoder('windows-1252').decode(new Uint8Array([code])))
        if (unicodeSkip > 0) unicodeSkip -= 1
        index += 4
        continue
      }
      const match = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(source.slice(index, index + 40))
      if (!match) {
        index += 2
        continue
      }
      const [whole, word, number] = match
      index += whole.length
      if (skipped.has(word)) skipping = 1
      else if (skipping) continue
      else if (word === 'par' || word === 'line' || word === 'sect' || word === 'page' || word === 'row') out.push('\n')
      else if (word === 'tab' || word === 'cell') out.push('\t')
      else if (word === 'u' && number !== undefined) {
        const code = Number(number) < 0 ? Number(number) + 65536 : Number(number)
        out.push(String.fromCharCode(code))
        unicodeSkip = 1
      }
      continue
    }
    if (character === '\r' || character === '\n') {
      index += 1
      continue
    }
    if (!skipping) {
      if (unicodeSkip > 0) unicodeSkip -= 1
      else out.push(character)
    }
    index += 1
  }
  return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Cuts text into sections of about SECTION_CHARS characters at paragraph or sentence boundaries. */
export function sections(text, size = SECTION_CHARS) {
  const result = []
  let rest = text.trim()
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size)
    if (cut < size / 2) cut = rest.lastIndexOf('. ', size) + 1
    if (cut < size / 2) cut = rest.lastIndexOf(' ', size)
    if (cut < size / 2) cut = size
    result.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) result.push(rest)
  return result
}
