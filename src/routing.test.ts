import { describe, expect, it } from 'vitest'
import { isWorkspacePath, legacyHashTarget, safeNextPath, signInPath } from './routing'

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
