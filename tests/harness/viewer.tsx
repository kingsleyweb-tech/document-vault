import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import '../../src/styles/components.css'
import '../../src/styles/viewer.css'
import { DocumentViewer } from '../../src/components/viewer/DocumentViewer'
import { getPreviewKind, PREVIEW_FORMAT_VERSION } from '../../src/services/documentViewer'
import { stripRtf } from '../../src/services/contentIndex'
import { getDocumentKind } from '../../src/utils/fileUtils'
import { deleteOfflineBlob, saveOfflineBlob, saveOfflinePreview } from '../../src/services/offlineStore'
import { enqueuePreview, getPreviewStatus, startPreviewQueue, subscribePreviewStatus } from '../../src/services/previewQueue'
import type { DocumentKind, VaultDocument } from '../../src/types/document'

declare global {
  interface Window {
    harnessOpenedAt?: number
    harnessPrepareMs?: number
    harnessPrepareStatus?: string
  }
}

const kinds: Record<string, { kind: DocumentKind; preview: string; mime: string }> = {
  pdf: { kind: 'pdf', preview: 'pdf', mime: 'application/pdf' },
  pptx: {
    kind: 'presentation',
    preview: 'presentation',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
}

// Other formats take the app's own routing; text is stored as the loader would.
function infoFor(file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (kinds[ext]) return kinds[ext]
  const kind = getDocumentKind(file)
  const mime = file.type || 'application/octet-stream'
  return { kind, mime, preview: getPreviewKind({ fileType: kind, mimeType: mime, originalName: file.name }) }
}

// ?mode=drive serves the chosen file as if from Google Drive's download
// endpoint, at ?kbps= kilobytes per second, instead of seeding the offline
// cache. ?token=none opens without a Drive token.
const params = new URLSearchParams(location.search)
const driveMode = params.get('mode') === 'drive'
const harnessToken = params.get('token') === 'none' ? null : 'offline-harness'
const servedFiles = new Map<string, File>()
// ?prepare=1 runs the background preparation as an upload would, then opens.
// With &dropOriginal=1 the original is removed afterwards, so the open has to
// download it again while the prepared pages are shown.
const prepareFirst = params.get('prepare') === '1'
const dropOriginal = params.get('dropOriginal') === '1'
if (prepareFirst) startPreviewQueue({ getAccessToken: () => harnessToken })

function waitForPrepared(fileId: string) {
  return new Promise<string>((resolve) => {
    const check = () => {
      const status = getPreviewStatus(fileId)?.status
      if (status && status !== 'queued' && status !== 'processing') {
        unsubscribe()
        resolve(status)
      }
    }
    const unsubscribe = subscribePreviewStatus(check)
    check()
  })
}

if (driveMode) {
  const realFetch = window.fetch.bind(window)
  const bytesPerTick = Math.max(1, Number(params.get('kbps') ?? 512)) * 1024 / 10
  window.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    const match = url.match(/googleapis\.com\/drive\/v3\/files\/([^/?]+)\?alt=media/)
    const file = match ? servedFiles.get(decodeURIComponent(match[1])) : undefined
    if (!file) return realFetch(input, init)
    const bytes = new Uint8Array(await file.arrayBuffer())
    let offset = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        if (init?.signal?.aborted) {
          controller.error(new DOMException('Aborted', 'AbortError'))
          return
        }
        const next = bytes.slice(offset, offset + bytesPerTick)
        offset += next.length
        controller.enqueue(next)
        if (offset >= bytes.length) controller.close()
      },
    })
    return new Response(body, { headers: { 'Content-Type': file.type || 'application/octet-stream', 'Content-Length': String(file.size) } })
  }
}

function makeRecord(file: File, id: string): VaultDocument {
  const info = infoFor(file)
  const now = { toDate: () => new Date(), toMillis: () => Date.now() }
  return {
    id,
    ownerId: 'harness',
    name: file.name,
    originalName: file.name,
    mimeType: info.mime,
    fileType: info.kind,
    fileSize: file.size,
    category: 'Other',
    description: '',
    driveFileId: id,
    driveFolderId: 'harness',
    isFavorite: false,
    isDeleted: false,
    createdAt: now,
    uploadedAt: now,
    updatedAt: now,
  }
}

// Entry script, not a module consumed by Fast Refresh.
// eslint-disable-next-line react-refresh/only-export-components
function Harness() {
  const [record, setRecord] = useState<VaultDocument | null>(null)
  const [closed, setClosed] = useState(0)

  const open = async (file: File) => {
    const id = `harness-${file.name}-${file.size}`
    const info = infoFor(file)
    if (prepareFirst) {
      if (driveMode) servedFiles.set(id, file)
      const started = performance.now()
      enqueuePreview(makeRecord(file, id), 'upload', file)
      window.harnessPrepareStatus = await waitForPrepared(id)
      window.harnessPrepareMs = performance.now() - started
      if (dropOriginal) await deleteOfflineBlob(id)
      window.harnessOpenedAt = performance.now()
      setRecord(makeRecord(file, id))
      return
    }
    window.harnessOpenedAt = performance.now()
    if (driveMode) {
      servedFiles.set(id, file)
    } else {
      const text = info.preview === 'text' ? await file.text() : undefined
      await saveOfflineBlob(id, file.name, info.mime, file)
      await saveOfflinePreview(id, info.preview, PREVIEW_FORMAT_VERSION, { text: text && /.rtf$/i.test(file.name) ? stripRtf(text) : text })
    }
    setRecord(makeRecord(file, id))
  }

  return (
    <div>
      <input type="file" aria-label="Document file" onChange={(event) => event.target.files?.[0] && void open(event.target.files[0])} />
      <output data-testid="closed">{closed}</output>
      <DocumentViewer
        documentRecord={record}
        documents={record ? [record] : []}
        accessToken={harnessToken}
        onReauthRequired={() => document.body.setAttribute('data-reauth-requested', 'true')}
        onClose={() => {
          setRecord(null)
          setClosed((value) => value + 1)
        }}
        onDownload={() => undefined}
        onOpenDocument={setRecord}
        onFavorite={() => undefined}
      />
    </div>
  )
}

// ?strict=0 renders without StrictMode, whose doubled effects (development
// only) start pdf.js twice and skew timings against a production build.
createRoot(document.getElementById('root')!).render(
  params.get('strict') === '0' ? (
    <Harness />
  ) : (
    <StrictMode>
      <Harness />
    </StrictMode>
  ),
)
