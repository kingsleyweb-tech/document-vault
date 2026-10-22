import { describe, expect, it } from 'vitest'
import {
  allowSignInPage,
  canShowSignInPage,
  clearSignInNotes,
  isWorkspacePath,
  legacyHashTarget,
  rememberDestination,
  rememberedDestination,
  safeNextPath,
  signInPath,
} from './routing'

const origin = 'https://documents-vault.vercel.app'

describe('routing', () => {
  it('recognises workspace paths', () => {
    expect(isWorkspacePath('/app')).toBe(true)
    expect(isWorkspacePath('/app/folders/1')).toBe(true)
    expect(isWorkspacePath('/apple')).toBe(false)
    expect(isWorkspacePath('/')).toBe(false)
  })

  it('moves old hash links into the workspace', () => {
    expect(legacyHashTarget('#/')).toBe('/app')
    expect(legacyHashTarget('#/files')).toBe('/app/files')
    expect(legacyHashTarget('#/folders/abc')).toBe('/app/folders/abc')
    expect(legacyHashTarget('#/login')).toBe('/login')
    expect(legacyHashTarget('#section')).toBeNull()
    expect(legacyHashTarget('')).toBeNull()
  })

  it('only returns to pages inside the workspace after sign-in', () => {
    expect(safeNextPath('/app/settings', origin)).toBe('/app/settings')
    expect(safeNextPath('/app/folders/1?view=list', origin)).toBe('/app/folders/1?view=list')
    expect(safeNextPath(null, origin)).toBe('/app')
    expect(safeNextPath('/features', origin)).toBe('/app')
    expect(safeNextPath('https://example.com/app', origin)).toBe('/app')
    expect(safeNextPath('//example.com/app', origin)).toBe('/app')
    expect(safeNextPath('/app/../features', origin)).toBe('/app')
    expect(safeNextPath('javascript:alert(1)', origin)).toBe('/app')
  })

  it('builds the sign-in link', () => {
    expect(signInPath()).toBe('/login')
    expect(signInPath('/app/files')).toBe('/login?next=%2Fapp%2Ffiles')
  })
})

function fakeStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  }
}

describe('sign-in gate', () => {
  it('hides the sign-in page until a sign-in button is clicked', () => {
    const storage = fakeStorage()
    expect(canShowSignInPage(storage, 1_000)).toBe(false)
    allowSignInPage(storage, 1_000)
    expect(canShowSignInPage(storage, 2_000)).toBe(true)
  })

  it('closes the gate after 30 minutes', () => {
    const storage = fakeStorage()
    allowSignInPage(storage, 1)
    expect(canShowSignInPage(storage, 30 * 60 * 1000)).toBe(true)
    expect(canShowSignInPage(storage, 30 * 60 * 1000 + 1)).toBe(false)
  })

  it('ignores tampered or future entries', () => {
    const storage = fakeStorage()
    storage.setItem('documentVault.signInEntry', 'yes')
    expect(canShowSignInPage(storage, 1_000)).toBe(false)
    allowSignInPage(storage, 5_000)
    expect(canShowSignInPage(storage, 1_000)).toBe(false)
  })

  it('remembers the requested page and forgets everything after sign-in', () => {
    const storage = fakeStorage()
    rememberDestination('/app/files?folder=1', storage)
    allowSignInPage(storage, 1_000)
    expect(rememberedDestination(storage)).toBe('/app/files?folder=1')
    clearSignInNotes(storage)
    expect(rememberedDestination(storage)).toBeNull()
    expect(canShowSignInPage(storage, 1_000)).toBe(false)
  })

  it('treats unavailable storage as a closed gate', () => {
    expect(canShowSignInPage(null)).toBe(false)
    expect(rememberedDestination(null)).toBeNull()
    expect(() => allowSignInPage(null)).not.toThrow()
  })
})
