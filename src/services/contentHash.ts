import { updateDocumentRecord } from './firestore'
import { sha256Hex } from '../utils/fileHash'
import type { VaultDocument } from '../types/document'
import { whenNoDocumentOpen } from './foreground'
import { isMemoryConstrained } from '../utils/device'

/** Hashing reads the whole file into memory once more; phones skip large files. */
const MAX_BYTES_CONSTRAINED = 50 * 1024 * 1024

// Documents uploaded before duplicate detection have no content hash. When one
// is opened its bytes are already in memory, so the hash is filled in then and
// later uploads of the same file are recognised.
const attempted = new Set<string>()

export function backfillContentHash(documentRecord: Pick<VaultDocument, 'id' | 'contentHash' | 'fileType'>, blob: Blob) {
  if (documentRecord.contentHash || documentRecord.fileType === 'folder' || attempted.has(documentRecord.id) || blob.size === 0) return
  if (isMemoryConstrained() && blob.size > MAX_BYTES_CONSTRAINED) return
  attempted.add(documentRecord.id)
  const run = () =>
    void sha256Hex(blob)
      .then((hash) => (hash ? updateDocumentRecord(documentRecord.id, { contentHash: hash }) : undefined))
      .catch((error: unknown) => console.warn('Could not record the file hash:', error))
  // Waits until the viewer is closed, so it never competes with drawing pages.
  void whenNoDocumentOpen().then(() => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 5000 })
    else setTimeout(run, 1000)
  })
}
