/**
 * Files larger than this are not hashed: the browser's SHA-256 needs the whole
 * file in memory at once. Duplicate detection simply skips them.
 */
export const MAX_HASH_BYTES = 150 * 1024 * 1024

/** Hex SHA-256 of a file's bytes, or null when it is too large or hashing is unavailable. */
export async function sha256Hex(blob: Blob): Promise<string | null> {
  if (blob.size > MAX_HASH_BYTES || typeof crypto === 'undefined' || !crypto.subtle) return null
  try {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

/** "Report.pdf" → "Report (copy).pdf", then "Report (copy 2).pdf" … avoiding names already taken. */
export function copyFileName(fileName: string, takenNames: Iterable<string>) {
  const taken = new Set(Array.from(takenNames, (name) => name.toLowerCase()))
  const match = /^(.*?)(\.[a-z0-9]{1,10})?$/i.exec(fileName)
  const base = (match?.[1] || fileName).replace(/ \(copy(?: \d+)?\)$/, '')
  const extension = match?.[2] ?? ''
  for (let attempt = 1; ; attempt += 1) {
    const candidate = `${base} (${attempt === 1 ? 'copy' : `copy ${attempt}`})${extension}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}
