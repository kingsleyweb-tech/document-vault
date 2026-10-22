import { useSyncExternalStore } from 'react'
import type { PreviewMeta } from '../services/offlineStore'
import { getAllPreviewStatus, getPreviewStatus, subscribePreviewStatus } from '../services/previewQueue'

/** This device's preparation state for one file, kept up to date. */
export function usePreviewStatus(fileId: string | undefined): PreviewMeta | undefined {
  return useSyncExternalStore(subscribePreviewStatus, () => (fileId ? getPreviewStatus(fileId) : undefined))
}

let cachedList: PreviewMeta[] = []
let cachedKey = ''

/** Every file's preparation state on this device. */
export function useAllPreviewStatus(): PreviewMeta[] {
  return useSyncExternalStore(subscribePreviewStatus, () => {
    const list = getAllPreviewStatus()
    // A stable array while nothing changed, as useSyncExternalStore requires.
    const key = list.map((meta) => `${meta.fileId}:${meta.updatedAt}:${meta.status}`).join('|')
    if (key !== cachedKey) {
      cachedKey = key
      cachedList = list
    }
    return cachedList
  })
}
