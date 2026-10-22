import { describe, expect, it, vi } from 'vitest'
import type { VaultDocument } from '../types/document'

vi.mock('./firebase', () => ({ auth: { currentUser: null } }))
vi.mock('./supabase', () => ({ supabase: null }))

const { toMirrorRows } = await import('./metadataMirror')

const at = (iso: string) => ({ toDate: () => new Date(iso), toMillis: () => Date.parse(iso) })

function record(values: Partial<VaultDocument> & { id: string }): VaultDocument {
  return {
    ownerId: 'owner',
    name: values.id,
    originalName: values.id,
    mimeType: 'application/pdf',
    fileType: 'pdf',
    fileSize: 10,
    category: 'Work',
    description: '',
    driveFileId: `drive-${values.id}`,
    driveFolderId: 'drive-root',
    isFavorite: false,
    isDeleted: false,
    createdAt: at('2026-01-01T00:00:00Z'),
    uploadedAt: at('2026-01-02T00:00:00Z'),
    updatedAt: at('2026-01-03T00:00:00Z'),
    ...values,
  }
}

const folder = (id: string, parentId: string | null) =>
  record({ id, isFolderRecord: true, fileType: 'folder', parentId, folderId: parentId, driveFileId: `drive-${id}`, driveFolderId: `drive-${id}` })

describe('toMirrorRows', () => {
  it('splits folders from documents and orders parents first', () => {
    const library = [folder('child', 'parent'), folder('grandchild', 'child'), folder('parent', null), record({ id: 'doc', folderId: 'child' })]
    const { folders, documents } = toMirrorRows('owner', library)

    expect(folders.map((row) => row.id)).toEqual(['parent', 'child', 'grandchild'])
    expect(documents).toHaveLength(1)
    expect(documents[0]).toMatchObject({ id: 'doc', folder_id: 'child', owner_id: 'owner', drive_file_id: 'drive-doc', file_kind: 'pdf' })
  })

  it('drops links to folders that are not in the library', () => {
    const { folders, documents } = toMirrorRows('owner', [folder('orphan', 'missing'), record({ id: 'doc', folderId: 'gone' })])
    expect(folders[0].parent_id).toBeNull()
    expect(documents[0].folder_id).toBeNull()
  })

  it('maps trash, unknown kinds and bad sizes into valid rows', () => {
    const { documents } = toMirrorRows('owner', [
      record({ id: 'trashed', isDeleted: true, fileType: 'folder', fileSize: Number.NaN, name: 'x'.repeat(600) }),
      record({ id: 'no-drive-file', driveFileId: '' }),
    ])
    expect(documents).toHaveLength(1)
    expect(documents[0]).toMatchObject({ deleted_at: '2026-01-03T00:00:00.000Z', file_kind: 'other', size_bytes: 0 })
    expect(documents[0].name).toHaveLength(512)
  })

  it('sends tags within the database limits and the missing-from-Drive flag', () => {
    const tags = ['#Tax', 'Tax', 'Q3 audit', ...Array.from({ length: 30 }, (_, index) => `t${index}`)]
    const { documents } = toMirrorRows('owner', [record({ id: 'tagged', tags, driveMissing: true }), record({ id: 'plain' })])
    expect(documents[0].tags.slice(0, 3)).toEqual(['tax', 'q3-audit', 't0'])
    expect(documents[0].tags).toHaveLength(20)
    expect(documents[0].drive_missing).toBe(true)
    expect(documents[1]).toMatchObject({ tags: [], drive_missing: false })
  })
})
