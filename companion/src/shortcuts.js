import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extensionOf } from './kinds.js'

// Reads where a shortcut points without running it: Windows shortcuts (.lnk,
// parsed from the Shell Link format), internet shortcuts (.url) and Mac web
// locations (.webloc). The caller decides whether the target may be opened.

const SHORTCUT_EXTENSIONS = new Set(['lnk', 'url', 'webloc'])
const MAX_SHORTCUT_BYTES = 1024 * 1024

export function isShortcut(name) {
  return SHORTCUT_EXTENSIONS.has(extensionOf(name))
}

/**
 * Resolves to { url } for a web link, { path } for a file or folder, or null
 * when the shortcut is unreadable or points somewhere that cannot be opened.
 */
export async function readShortcut(file) {
  const info = await fs.promises.stat(file)
  if (info.size > MAX_SHORTCUT_BYTES) return null
  const bytes = await fs.promises.readFile(file)
  const extension = extensionOf(file)
  const link =
    extension === 'lnk' ? lnkTargets(bytes, path.dirname(file))
    : extension === 'url' ? linkFromUrl(/^\s*URL\s*=\s*(.+?)\s*$/im.exec(bytes.toString('utf8'))?.[1])
    : extension === 'webloc' ? linkFromUrl(weblocUrl(bytes.toString('utf8')))
    : null
  if (!link || link.url) return link
  // Several candidate paths can come out of a .lnk; prefer one that exists.
  const candidates = [link.path].flat()
  return { path: candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0] }
}

function linkFromUrl(value) {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol === 'http:' || url.protocol === 'https:') return { url: url.href }
    if (url.protocol === 'file:') return { path: fileURLToPath(url) }
  } catch {
    // Not a URL Document Vault can open.
  }
  return null
}

function weblocUrl(text) {
  const raw = /<key>\s*URL\s*<\/key>\s*<string>([^<]*)<\/string>/i.exec(text)?.[1]
  return raw?.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

// Shell Link Binary File Format ([MS-SHLLINK]).
const HAS_ID_LIST = 0x1
const HAS_LINK_INFO = 0x2
const HAS_NAME = 0x4
const HAS_RELATIVE_PATH = 0x8
const IS_UNICODE = 0x80
const VOLUME_ID_AND_LOCAL_BASE_PATH = 0x1
const COMMON_NETWORK_RELATIVE_LINK = 0x2

function lnkTargets(bytes, folder) {
  try {
    if (bytes.length < 0x4c || bytes.readUInt32LE(0) !== 0x4c) return null
    const flags = bytes.readUInt32LE(0x14)
    let offset = 0x4c
    if (flags & HAS_ID_LIST) offset += 2 + bytes.readUInt16LE(offset)

    const targets = []
    if (flags & HAS_LINK_INFO) {
      const info = offset
      const headerSize = bytes.readUInt32LE(info + 4)
      const infoFlags = bytes.readUInt32LE(info + 8)
      // Unicode copies of the paths follow the header when it is long enough.
      const unicode = headerSize >= 0x24
      const at = (field) => info + bytes.readUInt32LE(info + field)
      const suffix = unicode ? utf16z(bytes, at(0x20)) : ansiz(bytes, at(0x18))
      if (infoFlags & VOLUME_ID_AND_LOCAL_BASE_PATH) {
        targets.push(joinSuffix(unicode ? utf16z(bytes, at(0x1c)) : ansiz(bytes, at(0x10)), suffix))
      } else if (infoFlags & COMMON_NETWORK_RELATIVE_LINK) {
        const network = at(0x14)
        const nameOffset = bytes.readUInt32LE(network + 8)
        const share = nameOffset > 0x14 ? utf16z(bytes, network + bytes.readUInt32LE(network + 0x14)) : ansiz(bytes, network + nameOffset)
        targets.push(joinSuffix(share, suffix))
      }
      offset = info + bytes.readUInt32LE(info)
    }

    // The relative path is always stored in Unicode by current Windows, so it
    // also rescues names the ANSI copy above could not represent.
    const wide = Boolean(flags & IS_UNICODE)
    const readString = () => {
      const length = bytes.readUInt16LE(offset) * (wide ? 2 : 1)
      const value = bytes.toString(wide ? 'utf16le' : 'latin1', offset + 2, offset + 2 + length)
      offset += 2 + length
      return value
    }
    if (flags & HAS_NAME) readString()
    if (flags & HAS_RELATIVE_PATH) targets.push(path.resolve(folder, readString()))

    const usable = targets.filter((target) => target.length > 0)
    return usable.length > 0 ? { path: usable } : null
  } catch {
    // Truncated or malformed shortcut.
    return null
  }
}

function joinSuffix(base, suffix) {
  if (!suffix) return base
  return base.endsWith('\\') ? base + suffix : `${base}\\${suffix}`
}

function ansiz(bytes, start) {
  const end = bytes.indexOf(0, start)
  return bytes.toString('latin1', start, end === -1 ? bytes.length : end)
}

function utf16z(bytes, start) {
  let end = start
  while (end + 1 < bytes.length && (bytes[end] !== 0 || bytes[end + 1] !== 0)) end += 2
  return bytes.toString('utf16le', start, end)
}
