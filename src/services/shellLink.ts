// Reads where a Windows shortcut (.lnk) points, from its bytes alone, without
// running it. Mirrors companion/src/shortcuts.js, which does the same for files
// on this computer. Format: [MS-SHLLINK].

const HAS_ID_LIST = 0x1
const HAS_LINK_INFO = 0x2
const HAS_NAME = 0x4
const HAS_RELATIVE_PATH = 0x8
const IS_UNICODE = 0x80
const VOLUME_ID_AND_LOCAL_BASE_PATH = 0x1
const COMMON_NETWORK_RELATIVE_LINK = 0x2

export interface ShellLinkTarget {
  /** The full path the shortcut was made for, such as C:\Users\Ama\Law\Contract.htm. */
  absolute: string | null
  /** The path relative to the shortcut, such as .\Contract.htm, when Windows stored one. */
  relative: string | null
}

export function readShellLink(bytes: Uint8Array): ShellLinkTarget | null {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const u16 = (at: number) => view.getUint16(at, true)
    const u32 = (at: number) => view.getUint32(at, true)
    if (bytes.length < 0x4c || u32(0) !== 0x4c) return null
    const flags = u32(0x14)
    let offset = 0x4c
    if (flags & HAS_ID_LIST) offset += 2 + u16(offset)

    let absolute: string | null = null
    if (flags & HAS_LINK_INFO) {
      const info = offset
      // Unicode copies of the paths follow the header when it is long enough.
      const unicode = u32(info + 4) >= 0x24
      const infoFlags = u32(info + 8)
      const at = (field: number) => info + u32(info + field)
      const suffix = unicode ? utf16z(bytes, at(0x20)) : ansiz(bytes, at(0x18))
      if (infoFlags & VOLUME_ID_AND_LOCAL_BASE_PATH) {
        absolute = joinSuffix(unicode ? utf16z(bytes, at(0x1c)) : ansiz(bytes, at(0x10)), suffix)
      } else if (infoFlags & COMMON_NETWORK_RELATIVE_LINK) {
        const network = at(0x14)
        const nameOffset = u32(network + 8)
        absolute = joinSuffix(nameOffset > 0x14 ? utf16z(bytes, network + u32(network + 0x14)) : ansiz(bytes, network + nameOffset), suffix)
      }
      offset = info + u32(info)
    }

    const wide = Boolean(flags & IS_UNICODE)
    const readString = () => {
      const length = u16(offset) * (wide ? 2 : 1)
      const value = new TextDecoder(wide ? 'utf-16le' : 'windows-1252').decode(bytes.subarray(offset + 2, offset + 2 + length))
      offset += 2 + length
      return value
    }
    if (flags & HAS_NAME) readString()
    const relative = flags & HAS_RELATIVE_PATH ? readString() : null

    if (!absolute && !relative) return null
    return { absolute: absolute || null, relative: relative || null }
  } catch {
    // Truncated or malformed shortcut.
    return null
  }
}

function joinSuffix(base: string, suffix: string) {
  if (!suffix) return base
  return base.endsWith('\\') ? base + suffix : `${base}\\${suffix}`
}

function ansiz(bytes: Uint8Array, start: number) {
  let end = start
  while (end < bytes.length && bytes[end] !== 0) end += 1
  return new TextDecoder('windows-1252').decode(bytes.subarray(start, end))
}

function utf16z(bytes: Uint8Array, start: number) {
  let end = start
  while (end + 1 < bytes.length && (bytes[end] !== 0 || bytes[end + 1] !== 0)) end += 2
  return new TextDecoder('utf-16le').decode(bytes.subarray(start, end))
}
