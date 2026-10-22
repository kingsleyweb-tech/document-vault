export const MAX_TAGS = 20
export const MAX_TAG_LENGTH = 40

/**
 * Trimmed, lower-case, de-duplicated tags within the limits the security rules
 * enforce. Spaces become hyphens so a tag is one word and "#tag" can find it.
 */
export function normalizeTags(tags: string[]) {
  const seen = new Set<string>()
  for (const raw of tags) {
    const tag = raw.trim().replace(/^#+/, '').replace(/\s+/g, '-').toLowerCase().slice(0, MAX_TAG_LENGTH).replace(/^-+|-+$/g, '')
    if (tag) seen.add(tag)
    if (seen.size >= MAX_TAGS) break
  }
  return [...seen]
}
