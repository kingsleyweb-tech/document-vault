// The download centre and the desktop app's update check both read
// /releases/latest.json. A build is only offered when the manifest marks it
// available and gives a download address; anything else shows as not yet
// available, never as a button that goes nowhere.

export type Platform = 'windows' | 'macos' | 'linux'
export type Arch = 'x64' | 'arm64'

export interface ReleaseBuild {
  id: string
  platform: Platform
  arch: Arch
  /** installer, disk image, AppImage or package */
  type: 'installer' | 'dmg' | 'appimage' | 'deb'
  label: string
  fileName: string
  url: string | null
  size: number | null
  sha256: string | null
  minimumOs: string
  available: boolean
  signed: boolean
  note?: string
}

export interface ReleaseManifest {
  schemaVersion: 1
  product: string
  version: string
  releasedAt: string | null
  notes: string[]
  notesUrl: string | null
  builds: ReleaseBuild[]
}

export const MANIFEST_URL = '/releases/latest.json'

export function isDownloadable(build: ReleaseBuild) {
  return build.available && typeof build.url === 'string' && /^https:\/\//.test(build.url)
}

export function parseManifest(value: unknown): ReleaseManifest | null {
  if (!value || typeof value !== 'object') return null
  const manifest = value as Partial<ReleaseManifest>
  if (manifest.schemaVersion !== 1 || typeof manifest.version !== 'string' || !Array.isArray(manifest.builds)) return null
  return {
    schemaVersion: 1,
    product: typeof manifest.product === 'string' ? manifest.product : 'Document Vault',
    version: manifest.version,
    releasedAt: typeof manifest.releasedAt === 'string' ? manifest.releasedAt : null,
    notes: Array.isArray(manifest.notes) ? manifest.notes.filter((note): note is string => typeof note === 'string') : [],
    notesUrl: typeof manifest.notesUrl === 'string' ? manifest.notesUrl : null,
    builds: manifest.builds.filter(isBuild),
  }
}

function isBuild(value: unknown): value is ReleaseBuild {
  if (!value || typeof value !== 'object') return false
  const build = value as Partial<ReleaseBuild>
  return (
    typeof build.id === 'string' &&
    (build.platform === 'windows' || build.platform === 'macos' || build.platform === 'linux') &&
    (build.arch === 'x64' || build.arch === 'arm64') &&
    typeof build.label === 'string' &&
    typeof build.available === 'boolean'
  )
}

export async function loadManifest(signal?: AbortSignal): Promise<ReleaseManifest | null> {
  // Always ask the server, so a new release shows up without a stale copy.
  const response = await fetch(MANIFEST_URL, { cache: 'no-store', signal })
  if (!response.ok) return null
  return parseManifest(await response.json())
}

export interface DetectedSystem {
  platform: Platform | 'android' | 'ios' | null
  /** null when the browser does not say (Safari on a Mac never does). */
  arch: Arch | null
}

interface UADataLike {
  platform?: string
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string; bitness?: string; platform?: string }>
}

export function detectFromUserAgent(userAgent: string, platformHint = ''): DetectedSystem {
  const ua = userAgent.toLowerCase()
  const hint = platformHint.toLowerCase()
  if (/android/.test(ua)) return { platform: 'android', arch: null }
  if (/iphone|ipad|ipod/.test(ua)) return { platform: 'ios', arch: null }
  // iPadOS reports itself as a Mac; touch support gives it away.
  if (/macintosh|mac os x/.test(ua) || hint.startsWith('mac')) return { platform: 'macos', arch: null }
  if (/windows/.test(ua) || hint.startsWith('win')) {
    return { platform: 'windows', arch: /arm64|aarch64/.test(ua) ? 'arm64' : 'x64' }
  }
  if (/cros/.test(ua)) return { platform: null, arch: null }
  if (/linux/.test(ua) || hint.startsWith('linux')) {
    return { platform: 'linux', arch: /aarch64|arm64/.test(ua) ? 'arm64' : /x86_64|amd64/.test(ua) ? 'x64' : null }
  }
  return { platform: null, arch: null }
}

export async function detectSystem(nav: Navigator = navigator): Promise<DetectedSystem> {
  const base = detectFromUserAgent(nav.userAgent, (nav as Navigator & { platform?: string }).platform ?? '')
  if (base.platform === 'macos' && 'ontouchend' in document && nav.maxTouchPoints > 1) {
    return { platform: 'ios', arch: null }
  }
  const uaData = (nav as Navigator & { userAgentData?: UADataLike }).userAgentData
  if (!uaData?.getHighEntropyValues || base.platform === 'android' || base.platform === 'ios') return base
  try {
    const values = await uaData.getHighEntropyValues(['architecture', 'bitness'])
    if (values.architecture === 'arm') return { ...base, arch: 'arm64' }
    if (values.architecture === 'x86' && values.bitness === '64') return { ...base, arch: 'x64' }
  } catch {
    // The browser declined; keep what the user agent said.
  }
  return base
}

export function formatBytes(bytes: number | null) {
  if (!bytes || bytes <= 0) return null
  const units = ['bytes', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

export function platformName(platform: Platform) {
  return platform === 'windows' ? 'Windows' : platform === 'macos' ? 'macOS' : 'Linux'
}

export function archName(platform: Platform, arch: Arch) {
  if (platform === 'macos') return arch === 'arm64' ? 'Apple Silicon (M1 and later)' : 'Intel'
  return arch === 'arm64' ? 'ARM 64-bit' : '64-bit (x64)'
}
