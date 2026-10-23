// Combined search: local libraries (through the companion on this computer)
// and documents uploaded to Document Vault (names in the browser, text through
// the Supabase mirror, which only returns the signed-in user's rows). Every
// result carries its source so the two are never confused.

import type { ContentMatch } from './contentIndex'
import type { VaultDocument } from '../types/document'

export type ResultSource = 'local' | 'vault'

export const SOURCE_LABELS: Record<ResultSource, string> = {
  local: 'Local Library',
  vault: 'Document Vault',
}

/**
 * Joins the uploaded documents whose names match with those whose text
 * matches. Only documents still in the visible vault are returned, so a stale
 * search row never shows as available.
 */
export function mergeUploadedMatches(visible: VaultDocument[], nameMatches: VaultDocument[], contentMatches: ContentMatch[]) {
  const byId = new Map(visible.map((record) => [record.id, record]))
  const nameMatched = new Set(nameMatches.map((record) => record.id))
  const snippets = new Map<string, string>()
  const textOnly: VaultDocument[] = []
  for (const match of contentMatches) {
    const record = byId.get(match.id)
    if (!record) continue
    if (match.snippet) snippets.set(match.id, match.snippet)
    if (match.matchedContent && !nameMatched.has(match.id)) {
      textOnly.push(record)
      nameMatched.add(match.id)
    }
  }
  return { snippets, textOnly }
}
