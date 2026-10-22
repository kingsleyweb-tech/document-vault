'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { buildManifest } = require('../scripts/release-manifest.cjs')

const previous = {
  schemaVersion: 1,
  version: '1.0.0',
  releasedAt: null,
  builds: [
    { id: 'windows-x64', fileName: 'Document-Vault-Setup-1.0.0-x64.exe', url: null, size: null, sha256: null, available: false, signed: false },
    { id: 'macos-arm64', fileName: 'Document-Vault-1.0.0-arm64.dmg', url: null, size: null, sha256: null, available: false, signed: false },
  ],
}

test('marks only the builds whose files exist as available', () => {
  const { manifest, sums } = buildManifest(previous, {
    version: '1.1.0',
    baseUrl: 'https://github.com/owner/repo/releases/download/v1.1.0/',
    files: { 'Document-Vault-Setup-1.1.0-x64.exe': { size: 10, sha256: 'ab' } },
    signed: ['windows-x64'],
    releasedAt: '2026-10-21T00:00:00.000Z',
  })
  assert.equal(manifest.version, '1.1.0')
  const [windows, mac] = manifest.builds
  assert.equal(windows.available, true)
  assert.equal(windows.url, 'https://github.com/owner/repo/releases/download/v1.1.0/Document-Vault-Setup-1.1.0-x64.exe')
  assert.equal(windows.signed, true)
  assert.equal(mac.available, false)
  assert.equal(mac.url, null)
  assert.equal(mac.fileName, 'Document-Vault-1.1.0-arm64.dmg')
  assert.deepEqual(sums, ['ab  Document-Vault-Setup-1.1.0-x64.exe'])
})

test('refuses an address that is not https', () => {
  assert.throws(() => buildManifest(previous, { version: '1.0.0', baseUrl: 'http://example.com', files: {} }))
})
