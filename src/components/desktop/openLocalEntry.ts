import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { companion, CompanionError, type LocalEntry } from '../../services/desktopCompanion'
import { hasWebBrowser, webBrowser, type WebTabSource } from '../../services/webBrowser'

interface OpenHandlers {
  /** Shows a file in Document Vault's own viewer. */
  preview: (entry: LocalEntry) => void
  /** Shows a web page in the in-app browser (desktop app only). */
  openWebPage: (url: string, source: WebTabSource) => void | Promise<void>
}

/**
 * Shows a file from a library inside Document Vault whenever it can be shown
 * here, instead of handing it to another program. A shortcut shows what it
 * points to: an indexed page or document in the viewer, a website in the in-app
 * browser. Anything else opens with its usual app, or is shown in its folder.
 */
export async function openLocalEntry(entry: LocalEntry, { preview, openWebPage }: OpenHandlers) {
  if (entry.canPreview) {
    preview(entry)
    return
  }
  if (entry.kind === 'shortcut' && !entry.isFolder) {
    let target: Awaited<ReturnType<typeof companion.shortcutTarget>> | null = null
    try {
      target = await companion.shortcutTarget(entry.id)
    } catch (error) {
      // Companions before 1.2 cannot say where a shortcut points; let them open it.
      if (!(error instanceof CompanionError && error.status === 404)) throw error
    }
    if (target?.url && hasWebBrowser()) {
      await openWebPage(target.url, { name: entry.name, entryId: entry.id })
      return
    }
    if (target?.entry?.canPreview) {
      preview(target.entry)
      return
    }
  }
  if (entry.canOpen) await companion.open(entry.id)
  else await companion.reveal(entry.id)
}

/** openLocalEntry with websites opening on the Web browser page. */
export function useLocalOpener(preview: (entry: LocalEntry) => void) {
  const navigate = useNavigate()
  return useCallback(
    (entry: LocalEntry) =>
      openLocalEntry(entry, {
        preview,
        openWebPage: async (url, source) => {
          await webBrowser.open(url, { newTab: true, source })
          navigate('/browser')
        },
      }),
    [preview, navigate],
  )
}
