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

// Only these file types are opened with their associated app. Everything else
// (programs, scripts, installers, macro-enabled Office files, shortcuts, SVG
// images, which can carry scripts, and any type not listed) is only shown in
// its folder. This is an allowlist on purpose: an unknown extension may be
// associated with a program that runs code. Shortcuts are opened through the
// target they name instead (see shortcuts.js), which must pass the same checks.
const OPENABLE = new Set([
  'pdf',
  'doc', 'docx', 'dot', 'dotx', 'odt', 'rtf', 'wpd', 'pages',
  'xls', 'xlsx', 'xlsb', 'csv', 'tsv', 'ods', 'numbers',
  'ppt', 'pptx', 'pps', 'ppsx', 'odp', 'key',
  'txt', 'md', 'markdown', 'log', 'json', 'xml', 'yaml', 'yml',
  'html', 'htm', 'xhtml', 'mht', 'mhtml',
  'epub', 'mobi', 'azw', 'azw3', 'djvu',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic',
  'mp3', 'wav', 'm4a', 'flac', 'ogg', 'aac', 'wma', 'opus',
  'mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'm4v',
  'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz',
])

// Folders that macOS treats as a single item which runs when opened
// (applications, installers, plug-ins). They are only shown in Finder.
const BUNDLE_EXTENSIONS = new Set([
  'app', 'bundle', 'framework', 'pkg', 'mpkg', 'prefpane', 'plugin', 'kext', 'workflow', 'action', 'saver', 'appex', 'xpc',
  'qlgenerator', 'mdimporter', 'scptd',
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
  epub: 'application/epub+zip',
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

/** Whether a file of this name may be opened with its associated app. */
export function canLaunch(name) {
  return OPENABLE.has(extensionOf(name))
}

/** Whether a folder may be opened in Finder or File Explorer (false for app bundles). */
export function canOpenFolder(name) {
  return !BUNDLE_EXTENSIONS.has(extensionOf(name))
}

export function previewType(name) {
  return PREVIEW_TYPES[extensionOf(name)] ?? null
}
