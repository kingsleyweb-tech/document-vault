import { auth } from './firebase'
import { supabase } from './supabase'
import type { DocumentKind, VaultDocument } from '../types/document'
import { normalizeTags } from '../utils/tags'

// Copies Firestore library metadata into Postgres so it can be searched and
// organised there. Firestore stays the system of record: mirroring runs in the
// background, never blocks the UI and only logs failures. Rows are keyed by
// their Firestore ids, and only rows that changed since the last successful
// sync are sent.

const SESSION_ENDED_EVENT = 'documentVault.sessionEnded'
const MIRROR_DELAY_MS = 1500
const BATCH_SIZE = 500

const MIRRORED_KINDS = new Set<DocumentKind | string>([
  'pdf', 'image', 'word', 'spreadsheet', 'presentation', 'html', 'text', 'ebook',
  'audio', 'video', 'archive', 'shortcut', 'other',
])

export interface FolderRow {
  id: string
  owner_id: string
  parent_id: string | null
  name: string
  drive_folder_id: string
  is_favorite: boolean
  deleted_at: string | null
  created_at: string
}

export interface DocumentRow {
  id: string
  owner_id: string
  folder_id: string | null
  name: string
  original_name: string
  mime_type: string
  file_kind: string
  size_bytes: number
  category: string
  description: string
  drive_file_id: string
  drive_folder_id: string | null
  drive_web_view_link: string | null
  folder_path: string
  is_favorite: boolean
  deleted_at: string | null
  uploaded_at: string
  created_at: string
  last_viewed_at: string | null
  tags: string[]
  drive_missing: boolean
}

const clip = (value: string | undefined | null, max: number) => (value ?? '').slice(0, max)

// Firestore has no trash timestamp; the last update is the closest record of when it happened.
const deletedAt = (record: VaultDocument) => (record.isDeleted ? record.updatedAt.toDate().toISOString() : null)

// Splits the merged library into Postgres rows. References to folders that are
// not in the library are dropped so one stale link cannot fail a whole batch.
export function toMirrorRows(ownerId: string, library: VaultDocument[]) {
  const folderRecords = library.filter((record) => record.isFolderRecord)
  const folderIds = new Set(folderRecords.map((record) => record.id))
  const knownFolder = (id: string | null | undefined) => (id && folderIds.has(id) ? id : null)

  const folders: FolderRow[] = folderRecords.map((record) => ({
    id: record.id,
    owner_id: ownerId,
    parent_id: record.parentId === record.id ? null : knownFolder(record.parentId),
    name: clip(record.name, 255) || 'Untitled folder',
    drive_folder_id: clip(record.driveFolderId || record.driveFileId, 256) || 'unknown',
    is_favorite: record.isFavorite,
    deleted_at: deletedAt(record),
    created_at: record.createdAt.toDate().toISOString(),
  }))

  // Parents before children, so batches never reference a folder not yet sent.
  const parentOf = new Map(folders.map((folder) => [folder.id, folder.parent_id]))
  const depthOf = (id: string) => {
    let depth = 0
    for (let parent = parentOf.get(id); parent && depth <= folders.length; parent = parentOf.get(parent)) depth += 1
    return depth
  }
  const depths = new Map(folders.map((folder) => [folder.id, depthOf(folder.id)]))
  folders.sort((first, second) => depths.get(first.id)! - depths.get(second.id)!)

  const documents: DocumentRow[] = library
    .filter((record) => !record.isFolderRecord && record.driveFileId)
    .map((record) => ({
      id: record.id,
      owner_id: ownerId,
      folder_id: knownFolder(record.folderId ?? record.parentId),
      name: clip(record.name, 512) || 'Untitled',
      original_name: clip(record.originalName, 512),
      mime_type: clip(record.mimeType, 255) || 'application/octet-stream',
      file_kind: MIRRORED_KINDS.has(record.fileType) ? record.fileType : 'other',
      size_bytes: Math.max(0, Math.round(Number(record.fileSize) || 0)),
      category: clip(record.category, 64) || 'Other',
      description: clip(record.description, 4000),
      drive_file_id: clip(record.driveFileId, 256),
      drive_folder_id: clip(record.driveFolderId, 256) || null,
      drive_web_view_link: clip(record.driveWebViewLink, 2048) || null,
      folder_path: clip(record.folderPath, 2048),
      is_favorite: record.isFavorite,
      deleted_at: deletedAt(record),
      uploaded_at: record.uploadedAt.toDate().toISOString(),
      created_at: record.createdAt.toDate().toISOString(),
      last_viewed_at: record.lastViewedAt ? record.lastViewedAt.toDate().toISOString() : null,
      tags: normalizeTags(record.tags ?? []),
      drive_missing: Boolean(record.driveMissing),
    }))

  return { folders, documents }
}

// Last successfully mirrored row per id, as JSON, for the signed-in user.
let synced = { ownerId: '', folders: new Map<string, string>(), documents: new Map<string, string>() }
let pending: { ownerId: string; library: VaultDocument[]; complete: boolean } | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let running = false
let lastErrorMessage = ''

if (typeof window !== 'undefined') {
  window.addEventListener(SESSION_ENDED_EVENT, () => {
    pending = null
    if (timer) clearTimeout(timer)
    synced = { ownerId: '', folders: new Map(), documents: new Map() }
  })
}

/**
 * Queues a mirror of the user's library. `complete` must only be true when the
 * library came from the Firestore server rather than the offline cache, since
 * rows missing from a complete library are deleted from Postgres.
 */
export function scheduleLibraryMirror(ownerId: string, library: VaultDocument[], complete: boolean) {
  if (!supabase) return
  pending = { ownerId, library, complete }
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void flush(), MIRROR_DELAY_MS)
}

async function flush() {
  timer = null
  if (running || !pending) return
  const job = pending
  pending = null
  running = true
  try {
    await mirror(job.ownerId, job.library, job.complete)
    lastErrorMessage = ''
  } catch (error) {
    const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error)
    if (message !== lastErrorMessage) {
      console.warn('Metadata mirror to Supabase failed; will retry on the next library change.', message)
      lastErrorMessage = message
    }
  } finally {
    running = false
    if (pending) timer = setTimeout(() => void flush(), MIRROR_DELAY_MS)
  }
}

async function mirror(ownerId: string, library: VaultDocument[], complete: boolean) {
  const client = supabase
  const user = auth.currentUser
  if (!client || !user || user.uid !== ownerId) return

  if (synced.ownerId !== ownerId) {
    synced = { ownerId, folders: new Map(), documents: new Map() }
    const { error } = await client
      .from('profiles')
      .upsert({ id: ownerId, email: user.email, display_name: user.displayName, photo_url: user.photoURL }, { onConflict: 'id' })
    if (error) {
      synced.ownerId = ''
      throw error
    }
  }

  const { folders, documents } = toMirrorRows(ownerId, library)
  await upsertChanged('folders', folders, synced.folders)
  await upsertChanged('documents', documents, synced.documents)

  if (complete) {
    // Documents first, so a removed folder is never blocked by its old contents.
    await removeMissing('documents', new Set(documents.map((row) => row.id)), synced.documents)
    await removeMissing('folders', new Set(folders.map((row) => row.id)), synced.folders)
  }
}

async function upsertChanged(table: 'folders' | 'documents', rows: Array<FolderRow | DocumentRow>, cache: Map<string, string>) {
  const changed = rows.filter((row) => cache.get(row.id) !== JSON.stringify(row))
  for (let start = 0; start < changed.length; start += BATCH_SIZE) {
    const batch = changed.slice(start, start + BATCH_SIZE)
    const { error } = await supabase!.from(table).upsert(batch, { onConflict: 'id' })
    if (error) throw error
    for (const row of batch) cache.set(row.id, JSON.stringify(row))
  }
}

async function removeMissing(table: 'folders' | 'documents', keep: Set<string>, cache: Map<string, string>) {
  const existing: string[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase!.from(table).select('id').order('id').range(from, from + 999)
    if (error) throw error
    existing.push(...data.map((row) => row.id as string))
    if (data.length < 1000) break
  }

  const stale = existing.filter((id) => !keep.has(id))
  for (let start = 0; start < stale.length; start += 200) {
    const batch = stale.slice(start, start + 200)
    const { error } = await supabase!.from(table).delete().in('id', batch)
    if (error) throw error
    for (const id of batch) cache.delete(id)
  }
}
