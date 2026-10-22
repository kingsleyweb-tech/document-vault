import { describe, expect, it } from 'vitest'
import { getPreviewKind, type PreviewKind } from './documentViewer'
import type { DocumentKind } from '../types/document'

const kindOf = (originalName: string, fileType: DocumentKind = 'other', mimeType = '') => getPreviewKind({ originalName, fileType, mimeType })

describe('getPreviewKind', () => {
  it.each<[string, DocumentKind, PreviewKind]>([
    ['Report.pdf', 'pdf', 'pdf'],
    ['Letter.docx', 'word', 'office'],
    ['Letter.doc', 'word', 'embed'],
    ['Notes.rtf', 'word', 'text'],
    ['Notes.odt', 'other', 'embed'],
    ['Budget.xlsx', 'spreadsheet', 'office'],
    ['Budget.xls', 'spreadsheet', 'office'],
    ['Budget.ods', 'other', 'office'],
    ['Export.csv', 'spreadsheet', 'office'],
    ['Export.tsv', 'other', 'office'],
    ['Deck.pptx', 'presentation', 'office'],
    ['Deck.ppt', 'presentation', 'embed'],
    ['Deck.odp', 'other', 'embed'],
    ['Readme.txt', 'text', 'text'],
    ['Readme.md', 'other', 'text'],
    ['Data.json', 'other', 'text'],
    ['Feed.xml', 'other', 'text'],
    ['Page.html', 'html', 'html'],
    ['Photo.png', 'image', 'image'],
    ['Scan.tiff', 'image', 'embed'],
    ['Song.mp3', 'other', 'media'],
    ['Clip.mp4', 'other', 'media'],
    ['Backup.zip', 'other', 'archive'],
    ['Book.epub', 'ebook', 'epub'],
    ['Site.url', 'other', 'text'],
    ['Shortcut.lnk', 'other', 'fallback'],
    ['Setup.exe', 'other', 'fallback'],
    ['Install.bat', 'other', 'text'],
  ])('%s opens as %s', (name, fileType, expected) => {
    expect(kindOf(name, fileType)).toBe(expected)
  })

  it('uses the media type when the name has no known extension', () => {
    expect(kindOf('Recording', 'other', 'audio/webm')).toBe('media')
    expect(kindOf('Unknown.bin', 'other', 'application/octet-stream')).toBe('fallback')
  })
})
