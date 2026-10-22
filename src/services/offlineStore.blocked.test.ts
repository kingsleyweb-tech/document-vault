// @vitest-environment happy-dom
import 'fake-indexeddb/auto'
import { expect, it, vi } from 'vitest'

// An older build in another tab (or this tab before an update) keeps version 1
// of the database open and never closes it. Opening documents must not wait
// for that tab; the store comes back once it closes.
it('does not wait for an older connection that blocks the upgrade', async () => {
  const old = await new Promise<IDBDatabase>((resolve) => {
    const request = indexedDB.open('DocumentVaultOfflineDB', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('fileBlobs', { keyPath: 'fileId' })
      request.result.createObjectStore('parsedPreviews', { keyPath: 'fileId' })
    }
    request.onsuccess = () => resolve(request.result)
  })

  const store = await import('./offlineStore')
  await expect(store.getOfflineBlob('file-1')).resolves.toBeNull()
  // Later calls fail at once too, instead of queuing behind the waiting upgrade.
  await expect(store.getPreviewMeta('file-1')).resolves.toBeNull()

  old.close()
  await vi.waitFor(async () => {
    await store.saveOfflineBlob('file-1', 'a.pdf', 'application/pdf', new Blob(['%PDF']))
    expect(await store.getOfflineBlob('file-1')).not.toBeNull()
  })
})
