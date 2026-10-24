import { createHash } from 'node:crypto'

// A fingerprint of a document's words, so the same text saved as different
// files (a PDF re-saved with a new title, say) can be recognised. Case,
// punctuation, spacing and line breaks are ignored.

/** Documents with less text than this (in normalised characters) are not compared. */
export const MIN_TEXT = 1000

/** Returns the fingerprint of the given passages, or '' when there is too little text. */
export function textFingerprint(texts) {
  const hash = createHash('sha256')
  let length = 0
  for (const text of texts) {
    const words = String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    if (!words) continue
    if (length > 0) {
      hash.update(' ')
      length += 1
    }
    hash.update(words)
    length += words.length
  }
  return length >= MIN_TEXT ? hash.digest('hex') : ''
}
