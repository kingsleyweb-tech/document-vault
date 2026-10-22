import { describe, expect, it } from 'vitest'
import { copyFileName, MAX_HASH_BYTES, sha256Hex } from './fileHash'

describe('sha256Hex', () => {
  it('hashes file contents', async () => {
    expect(await sha256Hex(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('skips files too large to hash in memory', async () => {
    const huge = { size: MAX_HASH_BYTES + 1 } as Blob
    expect(await sha256Hex(huge)).toBeNull()
  })
})

describe('copyFileName', () => {
  it('adds "(copy)" before the extension and avoids names in use', () => {
    expect(copyFileName('Report.pdf', [])).toBe('Report (copy).pdf')
    expect(copyFileName('Report.pdf', ['report (copy).pdf'])).toBe('Report (copy 2).pdf')
    expect(copyFileName('Report (copy).pdf', ['Report (copy).pdf'])).toBe('Report (copy 2).pdf')
    expect(copyFileName('Notes', [])).toBe('Notes (copy)')
    expect(copyFileName('archive.tar.gz', [])).toBe('archive.tar (copy).gz')
  })
})
