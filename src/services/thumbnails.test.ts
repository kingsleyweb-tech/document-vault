import { beforeEach, describe, expect, it, vi } from 'vitest'

const drive = vi.hoisted(() => ({
  getDriveFileThumbnail: vi.fn(),
  getDriveFileContent: vi.fn(),
}))
const stored = vi.hoisted(() => ({ getPageImage: vi.fn() }))

vi.mock('./googleDrive', () => drive)
vi.mock('./offlineStore', () => stored)

const { loadThumbnailObjectUrl } = await import('./thumbnails')

const pdf = (id: string, fileSize: number) => ({ driveFileId: id, fileType: 'pdf' as const, fileSize, version: 1 })

describe('thumbnails without one from Google Drive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    drive.getDriveFileThumbnail.mockRejectedValue(new Error('No thumbnail'))
    stored.getPageImage.mockResolvedValue(null)
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:thumb', revokeObjectURL: () => undefined })
  })

  it('uses the first page prepared on this device', async () => {
    stored.getPageImage.mockResolvedValue({ blob: new Blob(['page']) })
    await expect(loadThumbnailObjectUrl('token', pdf('prepared', 40e6))).resolves.toBe('blob:thumb')
    expect(drive.getDriveFileContent).not.toHaveBeenCalled()
  })

  it('never downloads a large PDF just to draw its thumbnail', async () => {
    await expect(loadThumbnailObjectUrl('token', pdf('big', 40e6))).rejects.toThrow()
    expect(drive.getDriveFileContent).not.toHaveBeenCalled()
  })

  it('does not try again for every card on every visit', async () => {
    await expect(loadThumbnailObjectUrl('token', pdf('again', 40e6))).rejects.toThrow()
    await expect(loadThumbnailObjectUrl('token', pdf('again', 40e6))).rejects.toThrow()
    expect(drive.getDriveFileThumbnail).toHaveBeenCalledTimes(1)
  })
})
