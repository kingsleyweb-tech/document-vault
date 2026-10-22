import { describe, expect, it } from 'vitest'
import type { VaultDocument } from '../types/document'
import { originalLocation, partitionLibrary } from './trash'

const at = { toDate: () => new Date(0), toMillis: () => 0 }

function item(id: string, parentId: string | null, isDeleted = false, folder = false): VaultDocument {
  return {
    id,
    ownerId: 'owner',
    name: id,
    originalName: id,
    mimeType: folder ? 'application/vnd.google-apps.folder' : 'application/pdf',
    fileType: folder ? 'folder' : 'pdf',
    fileSize: 1,
    category: 'Other',
    description: '',
    driveFileId: `drive-${id}`,
    driveFolderId: 'root',
    isFavorite: false,
    isDeleted,
    createdAt: at,
    uploadedAt: at,
    updatedAt: at,
    parentId,
    folderId: parentId,
    isFolderRecord: folder,
  }
}

const ids = (records: VaultDocument[]) => records.map((record) => record.id).sort()

describe('partitionLibrary', () => {
  it('lists a trashed file inside a folder in Trash', () => {
    const { active, trash } = partitionLibrary([item('reports', null, false, true), item('q1', 'reports', true)])
    expect(ids(trash)).toEqual(['q1'])
    expect(ids(active)).toEqual(['reports'])
  })

  it('hides the contents of a trashed folder and lists only the folder', () => {
    const library = [
      item('archive', null, true, true),
      item('nested', 'archive', false, true),
      item('deep', 'nested'),
      item('flagged', 'nested', true),
      item('keep', null),
    ]
    const { active, trash } = partitionLibrary(library)
    expect(ids(trash)).toEqual(['archive'])
    expect(ids(active)).toEqual(['keep'])
  })

  it('treats missing parents and cycles as active', () => {
    const library = [item('orphan', 'gone'), item('a', 'b', false, true), item('b', 'a', false, true)]
    expect(ids(partitionLibrary(library).active)).toEqual(['a', 'b', 'orphan'])
  })
})

describe('originalLocation', () => {
  it('names the folder path or the vault root', () => {
    const library = [item('work', null, false, true), item('taxes', 'work', false, true), item('form', 'taxes', true)]
    expect(originalLocation(library, library[2])).toBe('work / taxes')
    expect(originalLocation(library, library[0])).toBe('My Vault')
  })
})
