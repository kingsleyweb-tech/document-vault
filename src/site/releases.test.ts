import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detectFromUserAgent, formatBytes, isDownloadable, parseManifest, type ReleaseBuild } from './releases'

const build = (overrides: Partial<ReleaseBuild>): ReleaseBuild => ({
  id: 'windows-x64',
  platform: 'windows',
  arch: 'x64',
  type: 'installer',
  label: 'Windows installer',
  fileName: 'Document-Vault-Setup-1.0.0-x64.exe',
  url: null,
  size: null,
  sha256: null,
  minimumOs: 'Windows 10',
  available: false,
  signed: false,
  ...overrides,
})

describe('release manifest', () => {
  it('only offers builds that are marked available and have an https address', () => {
    expect(isDownloadable(build({}))).toBe(false)
    expect(isDownloadable(build({ available: true }))).toBe(false)
    expect(isDownloadable(build({ url: 'https://example.com/a.exe' }))).toBe(false)
    expect(isDownloadable(build({ available: true, url: 'http://example.com/a.exe' }))).toBe(false)
    expect(isDownloadable(build({ available: true, url: 'https://example.com/a.exe' }))).toBe(true)
  })

  it('rejects malformed manifests and drops malformed builds', () => {
    expect(parseManifest(null)).toBeNull()
    expect(parseManifest({ schemaVersion: 2, version: '1', builds: [] })).toBeNull()
    const parsed = parseManifest({ schemaVersion: 1, version: '1.0.0', builds: [build({}), { id: 'x', platform: 'beos' }] })
    expect(parsed?.builds).toHaveLength(1)
  })

  it('the published manifest is valid and offers nothing that is not published', () => {
    const manifest = parseManifest(JSON.parse(readFileSync('public/releases/latest.json', 'utf8')))
    expect(manifest).not.toBeNull()
    const ids = manifest!.builds.map((entry) => entry.id)
    expect(ids).toEqual(expect.arrayContaining(['windows-x64', 'macos-arm64', 'macos-x64', 'linux-x64-appimage', 'linux-x64-deb']))
    for (const entry of manifest!.builds) {
      if (entry.available) {
        expect(entry.url).toMatch(/^https:\/\//)
        expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/)
        expect(entry.size).toBeGreaterThan(0)
      }
    }
  })
})

describe('system detection', () => {
  it('recognises common browsers', () => {
    expect(detectFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/152')).toEqual({ platform: 'windows', arch: 'x64' })
    expect(detectFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605')).toEqual({ platform: 'macos', arch: null })
    expect(detectFromUserAgent('Mozilla/5.0 (X11; Linux x86_64) Firefox/140')).toEqual({ platform: 'linux', arch: 'x64' })
    expect(detectFromUserAgent('Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/152 Mobile')).toEqual({ platform: 'android', arch: null })
    expect(detectFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)')).toEqual({ platform: 'ios', arch: null })
    expect(detectFromUserAgent('Mozilla/5.0 (X11; CrOS x86_64 16000.0.0)')).toEqual({ platform: null, arch: null })
  })

  it('formats sizes', () => {
    expect(formatBytes(null)).toBeNull()
    expect(formatBytes(512)).toBe('512 bytes')
    expect(formatBytes(98_765_432)).toBe('94.2 MB')
  })
})
