import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAppleMobile } from './device'
import { shouldRetryLostSignIn } from '../services/auth'

describe('isAppleMobile', () => {
  it('recognises iPhones, and iPads that report themselves as a Mac', () => {
    expect(isAppleMobile({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 })).toBe(true)
    expect(isAppleMobile({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true)
  })

  it('leaves computers alone', () => {
    expect(isAppleMobile({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false)
    expect(isAppleMobile({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32', maxTouchPoints: 0 })).toBe(false)
  })
})

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  }
}

describe('shouldRetryLostSignIn', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reloads once when this browser was signed in, then gives up', () => {
    const local = memoryStorage()
    vi.stubGlobal('localStorage', local)
    vi.stubGlobal('sessionStorage', memoryStorage())
    local.setItem('documentVault.signedIn', '1')

    expect(shouldRetryLostSignIn(1_000)).toBe(true)
    expect(shouldRetryLostSignIn(5_000)).toBe(false)
    // Given up: the marker is gone, so later visits go straight to the home page.
    expect(local.getItem('documentVault.signedIn')).toBeNull()
    expect(shouldRetryLostSignIn(500_000)).toBe(false)
  })

  it('never reloads for someone who was not signed in', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    vi.stubGlobal('sessionStorage', memoryStorage())
    expect(shouldRetryLostSignIn()).toBe(false)
  })
})
