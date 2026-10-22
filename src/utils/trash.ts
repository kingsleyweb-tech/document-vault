import type { VaultDocument } from '../types/document'

// An item counts as trashed when it, or any folder above it, is in the trash.
// Only the topmost trashed item is listed in Trash; its contents travel with it
// and come back when it is restored.

export interface LibraryPartition {
  active: VaultDocument[]
  trash: VaultDocument[]
}

export function partitionLibrary(documents: VaultDocument[]): LibraryPartition {
  const byId = new Map(documents.map((record) => [record.id, record]))
  const memo = new Map<string, boolean>()

  // Whether any folder above this record is trashed. Cycles count as not trashed.
  const ancestorTrashed = (record: VaultDocument): boolean => {
    const seen = new Set<string>([record.id])
    const path: string[] = []
    let result = false
    for (let parentId = record.parentId ?? null; parentId; ) {
      if (seen.has(parentId)) break
      seen.add(parentId)
      const cached = memo.get(parentId)
      if (cached !== undefined) {
        result = cached
        break
      }
      const parent = byId.get(parentId)
      if (!parent) break
      path.push(parentId)
      if (parent.isDeleted) {
        result = true
        break
      }
      parentId = parent.parentId ?? null
    }
    // Every folder walked through shares the answer for its own subtree.
    for (const id of path) {
      const folder = byId.get(id)!
      memo.set(id, folder.isDeleted || result)
    }
    return result
  }

  const active: VaultDocument[] = []
  const trash: VaultDocument[] = []
  for (const record of documents) {
    const hidden = ancestorTrashed(record)
    if (!record.isDeleted && !hidden) active.push(record)
    else if (record.isDeleted && !hidden) trash.push(record)
  }
  return { active, trash }
}

// Human-readable location a trashed item will be restored to.
export function originalLocation(documents: VaultDocument[], record: VaultDocument) {
  return locationResolver(documents)(record)
}

// Builds the lookup once so a whole list can be labelled cheaply.
export function locationResolver(documents: VaultDocument[]) {
  const byId = new Map(documents.map((item) => [item.id, item]))
  return (record: VaultDocument) => {
    const names: string[] = []
    const seen = new Set<string>()
    for (let parentId = record.parentId ?? null; parentId && !seen.has(parentId); ) {
      seen.add(parentId)
      const parent = byId.get(parentId)
      if (!parent) break
      names.unshift(parent.name)
      parentId = parent.parentId ?? null
    }
    return names.length ? names.join(' / ') : 'My Vault'
  }
}
