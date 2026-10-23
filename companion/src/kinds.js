// File type classification shared by the indexer, the search filters and the
// open/preview safety checks.

const KIND_BY_EXTENSION = {
  pdf: 'pdf',
  doc: 'word', docx: 'word', docm: 'word', dot: 'word', dotx: 'word', odt: 'word', rtf: 'word', wpd: 'word',
  xls: 'spreadsheet', xlsx: 'spreadsheet', xlsm: 'spreadsheet', xlsb: 'spreadsheet', csv: 'spreadsheet', ods: 'spreadsheet', tsv: 'spreadsheet',
  ppt: 'presentation', pptx: 'presentation', pptm: 'presentation', pps: 'presentation', ppsx: 'presentation', odp: 'presentation',
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', bmp: 'image', tif: 'image', tiff: 'image', svg: 'image', heic: 'image', ico: 'image',
  txt: 'text', md: 'text', markdown: 'text', log: 'text', json: 'text', xml: 'text', yaml: 'text', yml: 'text', ini: 'text',
  html: 'html', htm: 'html', xhtml: 'html', mht: 'html', mhtml: 'html',
  epub: 'ebook', mobi: 'ebook', azw: 'ebook', azw3: 'ebook', djvu: 'ebook',
  mp3: 'audio', wav: 'audio', m4a: 'audio', flac: 'audio', ogg: 'audio', aac: 'audio', wma: 'audio', opus: 'audio',
  mp4: 'video', mkv: 'video', avi: 'video', mov: 'video', webm: 'video', wmv: 'video', m4v: 'video',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', tgz: 'archive', bz2: 'archive', xz: 'archive', iso: 'archive',
  lnk: 'shortcut', url: 'shortcut', webloc: 'shortcut',
}

export const KINDS = ['folder', 'pdf', 'word', 'spreadsheet', 'presentation', 'image', 'text', 'html', 'ebook', 'audio', 'video', 'archive', 'shortcut', 'program', 'other']

// Files that run code when opened through their association. Document Vault
// never launches these; it only shows them in File Explorer. Shortcuts are in
// the list because a .lnk or .url can point at any program or website; the
// companion reads their target instead (see shortcuts.js).
const NEVER_LAUNCH = new Set([
  'exe', 'com', 'bat', 'cmd', 'ps1', 'psm1', 'psd1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'msi', 'msp', 'mst', 'scr',
  'pif', 'cpl', 'hta', 'jar', 'reg', 'lnk', 'url', 'appref-ms', 'application', 'gadget', 'msc', 'inf', 'sys', 'dll',
  'ocx', 'scf', 'settingcontent-ms', 'chm', 'appx', 'msix', 'appxbundle', 'msixbundle', 'sct', 'shb', 'ws', 'xbap', 'vb',
  'psc1', 'cab', 'diagcab', 'library-ms', 'search-ms', 'searchconnector-ms', 'webloc', 'inetloc', 'fileloc',
])

const PROGRAM_EXTENSIONS = new Set(['exe', 'com', 'bat', 'cmd', 'ps1', 'vbs', 'msi', 'scr', 'jar', 'appx', 'msix', 'dll', 'sys'])

// Types the web app can preview from the bytes alone, without running anything.
const PREVIEW_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  txt: 'text/plain', md: 'text/plain', markdown: 'text/plain', log: 'text/plain', csv: 'text/plain', tsv: 'text/plain',
  json: 'text/plain', xml: 'text/plain', yaml: 'text/plain', yml: 'text/plain', ini: 'text/plain',
  // Served as plain text; the web app sanitises the page and shows it in a sandboxed frame.
  html: 'text/plain', htm: 'text/plain', xhtml: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  mp4: 'video/mp4', webm: 'video/webm',
}

export function extensionOf(name) {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function kindOf(name, isDirectory) {
  if (isDirectory) return 'folder'
  const extension = extensionOf(name)
  if (PROGRAM_EXTENSIONS.has(extension)) return 'program'
  return KIND_BY_EXTENSION[extension] ?? 'other'
}

export function canLaunch(name) {
  return !NEVER_LAUNCH.has(extensionOf(name))
}

export function previewType(name) {
  return PREVIEW_TYPES[extensionOf(name)] ?? null
}
