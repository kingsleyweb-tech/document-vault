import type { VaultTimestamp } from '../types/document'

export function formatFileSize(bytes: number) {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

const htmlEscapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (character) => htmlEscapes[character])
}

/**
 * HTML for showing a document's plain text with every match of `query` marked.
 * The text is escaped, so markup inside a file is shown, never run.
 */
export function highlightPlainText(text: string, query: string) {
  const needle = query.trim()
  if (!needle) return escapeHtml(text)
  const pattern = new RegExp(needle.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi')
  let html = ''
  let last = 0
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    html += escapeHtml(text.slice(last, match.index)) + '<mark>' + escapeHtml(match[0]) + '</mark>'
    last = match.index + match[0].length
  }
  return html + escapeHtml(text.slice(last))
}

export function formatDate(value?: VaultTimestamp) {
  if (!value) return 'Never'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(value.toDate())
}
