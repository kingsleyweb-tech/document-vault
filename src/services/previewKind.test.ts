import { describe, expect, it } from 'vitest'
import { decodeHtml, getPreviewKind, readInternetShortcut, type PreviewKind } from './documentViewer'
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
    ['Saved page.htm', 'other', 'html'],
    ['Old upload.htm', 'text', 'html'],
    ['Photo.png', 'image', 'image'],
    ['Scan.tiff', 'image', 'embed'],
    ['Song.mp3', 'other', 'media'],
    ['Clip.mp4', 'other', 'media'],
    ['Backup.zip', 'other', 'archive'],
    ['Book.epub', 'ebook', 'epub'],
    ['Site.url', 'other', 'link'],
    ['Site.webloc', 'other', 'link'],
    ['Shortcut.lnk', 'other', 'fallback'],
    ['Setup.exe', 'other', 'fallback'],
    ['Install.bat', 'other', 'text'],
  ])('%s opens as %s', (name, fileType, expected) => {
    expect(kindOf(name, fileType)).toBe(expected)
  })

  it('uses the media type when the name has no known extension', () => {
    expect(kindOf('Recording', 'other', 'audio/webm')).toBe('media')
    expect(kindOf('Page', 'other', 'text/html')).toBe('html')
    expect(kindOf('Unknown.bin', 'other', 'application/octet-stream')).toBe('fallback')
  })
})

describe('readInternetShortcut', () => {
  it('reads the address of a Windows internet shortcut', () => {
    expect(readInternetShortcut('[InternetShortcut]\r\nURL=https://example.com/a?b=1\r\nIconIndex=0\r\n', 'Site.url')).toBe('https://example.com/a?b=1')
  })

  it('reads the address of a Mac web location', () => {
    const plist = '<?xml version="1.0"?><plist><dict><key>URL</key><string>https://example.org/?x=1&amp;y=2</string></dict></plist>'
    expect(readInternetShortcut(plist, 'Site.webloc')).toBe('https://example.org/?x=1&y=2')
  })

  it('ignores addresses that are not web pages', () => {
    expect(readInternetShortcut('[InternetShortcut]\r\nURL=javascript:alert(1)\r\n', 'Bad.url')).toBeNull()
    expect(readInternetShortcut('[InternetShortcut]\r\nURL=file:///C:/Windows/system32/calc.exe\r\n', 'Bad.url')).toBeNull()
    expect(readInternetShortcut('not a shortcut', 'Empty.url')).toBeNull()
  })
})

describe('decodeHtml', () => {
  it('uses the encoding a page declares', async () => {
    const bytes = new Uint8Array([...new TextEncoder().encode('<meta charset="windows-1252"><p>caf'), 0xe9, ...new TextEncoder().encode('</p>')])
    expect(await decodeHtml(new Blob([bytes]))).toBe('<meta charset="windows-1252"><p>café</p>')
  })

  it('reads UTF-16 pages with a byte order mark', async () => {
    const text = '<p>Zoé</p>'
    const bytes = new Uint8Array(2 + text.length * 2)
    bytes.set([0xff, 0xfe])
    for (let i = 0; i < text.length; i += 1) bytes[2 + i * 2] = text.charCodeAt(i)
    expect(await decodeHtml(new Blob([bytes]))).toBe(text)
  })

  it('defaults to UTF-8', async () => {
    expect(await decodeHtml(new Blob(['<p>Zoé ✓</p>']))).toBe('<p>Zoé ✓</p>')
  })
})
