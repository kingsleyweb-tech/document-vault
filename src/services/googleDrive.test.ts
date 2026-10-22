// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyDriveFile, deleteDriveRevision, downloadDriveFile, isNetworkError, GoogleDriveError, listDriveRevisions, setRevisionKeepForever } from './googleDrive'

vi.mock('./offlineStore', () => ({
  saveOfflineBlob: vi.fn(async () => undefined),
  getOfflineBlob: vi.fn(async () => null),
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

function streamedResponse(chunks: Uint8Array[], withLength: boolean) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/pdf', ...(withLength ? { 'Content-Length': String(total) } : {}) },
  })
}

describe('downloadDriveFile', () => {
  it('reports progress as the file arrives and skips the metadata request when the type is known', async () => {
    const chunks = [new Uint8Array(1000).fill(1), new Uint8Array(1000).fill(2), new Uint8Array(500).fill(3)]
    const fetchMock = vi.fn(async () => streamedResponse(chunks, true))
    vi.stubGlobal('fetch', fetchMock)
    const progress: Array<[number, number]> = []

    const blob = await downloadDriveFile('token', 'file-progress', 'application/pdf', 'application/pdf', {
      onProgress: (loaded, total) => progress.push([loaded, total]),
    })

    expect(blob.size).toBe(2500)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('alt=media')
    expect(progress[0]).toEqual([0, 2500])
    expect(progress.at(-1)).toEqual([2500, 2500])
  })

  it('still reports bytes received when Drive gives no length', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamedResponse([new Uint8Array(300), new Uint8Array(200)], false)))
    const progress: Array<[number, number]> = []
    await downloadDriveFile('token', 'file-nolength', 'application/pdf', 'application/pdf', {
      onProgress: (loaded, total) => progress.push([loaded, total]),
    })
    expect(progress.at(-1)).toEqual([500, 0])
  })
})

describe('isNetworkError', () => {
  it('tells a lost connection from an answer by Drive', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isNetworkError(new GoogleDriveError(503, 'Unavailable'))).toBe(false)
    expect(isNetworkError(new Error('Upload destination folder was not found.'))).toBe(false)
  })
})

describe('copies and versions', () => {
  function recordRequests(answers: unknown[]) {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
      requests.push({ url: String(input), method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined })
      const answer = answers.shift()
      return answer === undefined ? new Response(null, { status: 204 }) : Response.json(answer)
    }))
    return requests
  }

  it('copies a file into the given folder, or beside the original', async () => {
    const requests = recordRequests([{ id: 'copy-1', name: 'Report (copy).pdf' }, { id: 'copy-2', name: 'x' }])
    expect((await copyDriveFile('token', 'file/1', 'Report (copy).pdf', 'folder-9')).id).toBe('copy-1')
    await copyDriveFile('token', 'file-2', 'x')
    expect(requests[0]).toMatchObject({ method: 'POST', body: { name: 'Report (copy).pdf', parents: ['folder-9'] } })
    expect(requests[0].url).toContain('/files/file%2F1/copy?')
    expect(requests[1].body).toEqual({ name: 'x' })
  })

  it('lists every page of versions, oldest first', async () => {
    const requests = recordRequests([
      { revisions: [{ id: 'r1', modifiedTime: '2026-01-01T00:00:00Z' }], nextPageToken: 'next' },
      { revisions: [{ id: 'r2', modifiedTime: '2026-02-01T00:00:00Z', keepForever: true }] },
    ])
    const revisions = await listDriveRevisions('token', 'file-1')
    expect(revisions.map((revision) => revision.id)).toEqual(['r1', 'r2'])
    expect(new URL(requests[1].url).searchParams.get('pageToken')).toBe('next')
  })

  it('pins and deletes single versions', async () => {
    const requests = recordRequests([{ id: 'r1', keepForever: true }])
    await setRevisionKeepForever('token', 'file-1', 'r1', true)
    await deleteDriveRevision('token', 'file-1', 'r1')
    expect(requests[0]).toMatchObject({ method: 'PATCH', body: { keepForever: true } })
    expect(requests[0].url).toContain('/files/file-1/revisions/r1?')
    expect(requests[1]).toMatchObject({ method: 'DELETE' })
  })
})
