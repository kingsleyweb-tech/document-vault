import fs from 'node:fs'
import { isInside, isProtected } from './paths.js'

// The one place that decides what Document Vault may index, read or show.
//
// A path may be read only when all of these hold:
// - it lies inside a library (an indexed root) the user added;
// - that library has not been revoked (indexing additionally needs it active,
//   not paused);
// - it is not inside a folder the user excluded from that library;
// - it is not a protected system or application location;
// - its real location on disk (after following links, junctions and short
//   names) still lies inside the library and outside the exclusions.
//
// The indexer, the text extractor, every API route and every search query go
// through these checks. Search queries apply them in SQL through scopeSql(),
// so a revoked library or an excluded folder cannot appear in any result,
// excerpt, count or reference list, whatever the caller asks for.
//
// Each library also has an epoch, a counter raised whenever its access
// changes (revoked, excluded, removed). Background work records the epoch
// when it starts and checks it again before saving anything; work started
// under an older epoch is discarded.

export function createAccess(store, { dataDir }) {
  const libraryById = (rootId) => (Number.isSafeInteger(rootId) ? store.getRoot(rootId) ?? null : null)

  function exclusionFor(root, target) {
    return store.listExclusions(root.id).find((exclusion) => isInside(target, exclusion.path)) ?? null
  }

  /**
   * Why `target` may not be used, or null when it may. `purpose` is 'read'
   * (search, open, preview) or 'index' (scan and extract), which also needs
   * the library to be active rather than paused.
   */
  function problem(root, target, purpose = 'read') {
    if (!root) return 'not-in-library'
    if (root.state === 'revoked') return 'revoked'
    if (purpose === 'index' && root.state !== 'active') return 'paused'
    if (!isInside(target, root.path)) return 'outside'
    if (isProtected(target, dataDir)) return 'protected'
    if (exclusionFor(root, target)) return 'excluded'
    return null
  }

  /**
   * Checks the real location of an existing path. Resolves to { real } when it
   * may be used, or { problem } when it may not. Throws the file system error
   * when the path cannot be resolved (missing, or denied by the system).
   */
  async function checkReal(root, target, purpose = 'read') {
    const stated = problem(root, target, purpose)
    if (stated) return { problem: stated }
    const [real, realRoot] = await Promise.all([fs.promises.realpath(target), fs.promises.realpath(root.path)])
    if (!isInside(real, realRoot)) return { problem: 'outside' }
    if (isProtected(real, dataDir)) return { problem: 'protected' }
    if (exclusionFor(root, real)) return { problem: 'excluded' }
    return { real }
  }

  /** The library a path belongs to, if any library that may be read holds it. */
  function libraryFor(target) {
    return store.listRootRows().find((root) => root.state !== 'revoked' && isInside(target, root.path)) ?? null
  }

  /** The entry and its library when the entry may be read now; null otherwise. */
  function readableEntry(entryId) {
    const entry = Number.isSafeInteger(entryId) ? store.getEntry(entryId) : null
    if (!entry) return null
    const root = libraryById(entry.root_id)
    return problem(root, entry.path) ? null : { entry, root }
  }

  return {
    libraryById,
    problem,
    checkReal,
    libraryFor,
    readableEntry,
    exclusionFor,
    epochOf: (rootId) => libraryById(rootId)?.epoch ?? null,
    /** True while background work started at `epoch` may still save its results. */
    stillValid(rootId, epoch, target) {
      const root = libraryById(rootId)
      return Boolean(root) && root.epoch === epoch && problem(root, target, 'index') === null
    },
    scopeSql,
  }
}

/**
 * SQL condition limiting entries (table alias `alias`) to libraries that may
 * be read and to paths outside their exclusions. `rootIds` narrows the scope
 * to chosen libraries. Returns { sql, values } to splice into a query.
 */
export function scopeSql(alias = 'e', rootIds = null) {
  const values = []
  let libraries = "select id from roots where state <> 'revoked'"
  if (rootIds && rootIds.length > 0) {
    libraries += ` and id in (${rootIds.map(() => '?').join(', ')})`
    values.push(...rootIds)
  }
  const sql = `${alias}.root_id in (${libraries}) and not exists (
    select 1 from exclusions x where x.root_id = ${alias}.root_id
      and (${alias}.path_key = x.path_key or (${alias}.path_key >= x.key_lo and ${alias}.path_key < x.key_hi)))`
  return { sql, values }
}
