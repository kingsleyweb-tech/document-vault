'use strict'

// The desktop app reads the same release list as the website's Downloads page
// and only tells the user; it never downloads or runs an installer itself.

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(value))
  return match ? match.slice(1).map(Number) : null
}

function isNewer(candidate, current) {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index]
  }
  return false
}

const PLATFORMS = { win32: 'windows', darwin: 'macos', linux: 'linux' }

/** The newer release for this system, or null when there is none to install. */
function findUpdate(manifest, { version, platform, arch }) {
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.builds)) return null
  if (!isNewer(manifest.version, version)) return null
  const wanted = PLATFORMS[platform]
  const build = manifest.builds.find(
    (entry) => entry.platform === wanted && entry.arch === arch && entry.available === true && /^https:\/\//.test(entry.url ?? ''),
  )
  return build ? { version: manifest.version, build } : null
}

module.exports = { findUpdate, isNewer }
