import path from 'node:path'
import os from 'node:os'

// Windows and (by default) macOS compare paths case-insensitively; Linux does
// not. Every lookup uses this key.
const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin'

export function pathKey(value) {
  const resolved = path.resolve(value)
  return caseInsensitive ? resolved.toLowerCase() : resolved
}

// Keys strictly below a folder: from "folder<sep>" up to, not including, the
// same prefix ending in the character after the separator ("]" after "\", "0" after "/").
export function belowRange(key) {
  const start = key.endsWith(path.sep) ? key : key + path.sep
  const end = start.slice(0, -1) + String.fromCharCode(path.sep.charCodeAt(0) + 1)
  return [start, end]
}

export function isInside(child, parent) {
  const childKey = pathKey(child)
  const parentKey = pathKey(parent)
  if (childKey === parentKey) return true
  const prefix = parentKey.endsWith(path.sep) ? parentKey : parentKey + path.sep
  return childKey.startsWith(prefix)
}

const env = process.env
const systemDrive = (env.SystemDrive || 'C:') + path.sep

// Locations that hold the operating system, installed programs or other
// applications' private data (browser profiles, saved credentials). They are
// never indexed, even when a parent such as C:\ is added.
export function protectedLocations(dataDir) {
  const home = os.homedir()
  if (process.platform === 'darwin') {
    return [
      ...['/System', '/Library', '/Applications', '/private', '/usr', '/bin', '/sbin', '/etc', '/var', '/opt', '/cores'],
      path.join(home, 'Library'),
      ...['.ssh', '.gnupg', '.config', '.local', '.cache', '.Trash'].map((name) => path.join(home, name)),
      dataDir,
    ]
  }
  if (process.platform !== 'win32') {
    return [
      ...['/proc', '/sys', '/dev', '/run', '/boot', '/usr', '/bin', '/sbin', '/lib', '/lib32', '/lib64', '/etc', '/var', '/opt', '/snap', '/root', '/tmp'],
      ...['.ssh', '.gnupg', '.config', '.local', '.cache', '.mozilla', '.pki', '.var'].map((name) => path.join(home, name)),
      dataDir,
    ]
  }
  return [
    env.SystemRoot || path.join(systemDrive, 'Windows'),
    env.ProgramFiles || path.join(systemDrive, 'Program Files'),
    env['ProgramFiles(x86)'] || path.join(systemDrive, 'Program Files (x86)'),
    env.ProgramData || path.join(systemDrive, 'ProgramData'),
    path.join(systemDrive, 'Recovery'),
    path.join(systemDrive, '$Recycle.Bin'),
    path.join(systemDrive, 'System Volume Information'),
    path.join(home, 'AppData'),
    // Credentials and settings kept by developer and cloud tools.
    ...['.ssh', '.gnupg', '.aws', '.azure', '.config', '.kube', '.docker', '.local', '.cache'].map((name) => path.join(home, name)),
    dataDir,
  ].filter(Boolean)
}

// Folder names skipped wherever they appear: recycle bins, version-control and
// dependency folders hold thousands of files nobody searches for by name.
const SKIPPED_NAMES = new Set(['$recycle.bin', 'system volume information', '.git', '.svn', '.hg', 'node_modules', '__pycache__', '.cache'])

export function isSkippedName(name) {
  return SKIPPED_NAMES.has(name.toLowerCase())
}

export function isProtected(target, dataDir) {
  return protectedLocations(dataDir).some((location) => isInside(target, location))
}

/** Problems with a folder the user wants indexed, or null when it is acceptable. */
export function rootProblem(target, dataDir) {
  if (typeof target !== 'string' || target.length === 0 || target.length > 1024) return 'Enter a folder path.'
  if (!path.isAbsolute(target)) {
    return process.platform === 'win32'
      ? 'Use a full path such as C:\\Users\\you\\Documents.'
      : `Use a full path such as ${path.join(os.homedir(), 'Documents')}.`
  }
  if (process.platform === 'win32' && target.startsWith('\\\\')) return 'Network paths are not supported. Map the share to a drive letter first.'
  if (isProtected(target, dataDir)) return 'System and application folders cannot be indexed.'
  return null
}
