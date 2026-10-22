import { updateDocumentRecord } from './firestore'
import { sha256Hex } from '../utils/fileHash'
import type { VaultDocument } from '../types/document'

// Documents uploaded before duplicate detection have no content hash. When one
// is opened its bytes are already in memory, so the hash is filled in then and
// later uploads of the same file are recognised.
const attempted = new Set<string>()

export function backfillContentHash(documentRecord: Pick<VaultDocument, 'id' | 'contentHash' | 'fileType'>, blob: Blob) {
  if (documentRecord.contentHash || documentRecord.fileType === 'folder' || attempted.has(documentRecord.id) || blob.size === 0) return
  attempted.add(documentRecord.id)
  const run = () =>
    void sha256Hex(blob)
      .then((hash) => (hash ? updateDocumentRecord(documentRecord.id, { contentHash: hash }) : undefined))
      .catch((error: unknown) => console.warn('Could not record the file hash:', error))
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 5000 })
  else setTimeout(run, 1000)
}
