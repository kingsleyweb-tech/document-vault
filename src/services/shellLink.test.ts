import { describe, expect, it } from 'vitest'
import { readShellLink } from './shellLink'

// Builds a shortcut in the layout Windows Explorer writes: a header, a LinkInfo
// block holding the full path in the ANSI code page, and the relative path in UTF-16.
function shortcut({ absolute, relative }: { absolute?: string; relative?: string }) {
  const bytes: number[] = []
  const u16 = (value: number) => bytes.push(value & 0xff, (value >> 8) & 0xff)
  const u32 = (value: number) => bytes.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff)
  const flags = (absolute ? 0x2 : 0) | (relative ? 0x8 : 0) | 0x80

  u32(0x4c)
  bytes.push(0x01, 0x14, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46)
  u32(flags)
  while (bytes.length < 0x4c) bytes.push(0)

  if (absolute) {
    const volume = [0x11, 0, 0, 0, 3, 0, 0, 0, 0x78, 0x56, 0x34, 0x12, 0x10, 0, 0, 0, 0]
    const base = [...Array.from(absolute, (char) => char.charCodeAt(0)), 0]
    const baseOffset = 0x1c + volume.length
    const suffixOffset = baseOffset + base.length
    u32(suffixOffset + 1)
    u32(0x1c)
    u32(0x1)
    u32(0x1c)
    u32(baseOffset)
    u32(0)
    u32(suffixOffset)
    bytes.push(...volume, ...base, 0)
  }
  if (relative) {
    u16(relative.length)
    for (const char of relative) u16(char.charCodeAt(0))
  }
  return new Uint8Array(bytes)
}

describe('readShellLink', () => {
  it('reads the full and relative paths of a shortcut', () => {
    expect(readShellLink(shortcut({ absolute: 'C:\\Law Library\\Contract Law.htm', relative: '.\\Contract Law.htm' }))).toEqual({
      absolute: 'C:\\Law Library\\Contract Law.htm',
      relative: '.\\Contract Law.htm',
    })
  })

  it('reads a shortcut that only has a relative path', () => {
    expect(readShellLink(shortcut({ relative: '..\\Books\\Zoé.htm' }))).toEqual({ absolute: null, relative: '..\\Books\\Zoé.htm' })
  })

  it('reads accented letters in the ANSI path', () => {
    expect(readShellLink(shortcut({ absolute: 'C:\\Droit\\Café.htm' }))?.absolute).toBe('C:\\Droit\\Café.htm')
  })

  it('returns nothing for files that are not shortcuts, or are cut short', () => {
    expect(readShellLink(new TextEncoder().encode('[InternetShortcut]'))).toBeNull()
    expect(readShellLink(shortcut({ absolute: 'C:\\Law\\A.htm' }).subarray(0, 0x60))).toBeNull()
  })
})
