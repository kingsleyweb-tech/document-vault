import path from 'node:path'
import { bestPassage, ftsExpression, parseQuery, searchRanked } from './ranked.js'

// The only way any assistant feature may read library content.
//
// No AI model is connected in this version. When one is, it must receive
// passages through these functions and nothing else: it gets no file paths
// to open, no file system access and no way to widen the libraries. Every
// call applies the same access rules as search (access.js), at the moment of
// the call, so:
// - a revoked library, an excluded folder or a removed document yields nothing,
//   even when its id comes from an earlier conversation;
// - passages are short excerpts, never whole documents;
// - locations are given relative to their library, so the assistant never
//   sees where the libraries are on disk.

const MAX_PASSAGES = 20
const MAX_PASSAGE_CHARS = 700

function describe(access, entry, root, passage) {
  return {
    entryId: entry.id,
    library: root.name || path.basename(root.path),
    libraryId: root.id,
    name: entry.name,
    folder: path.relative(root.path, path.dirname(entry.path)).split(path.sep).filter(Boolean).join(' / '),
    page: passage?.page ?? null,
    section: passage?.section ?? null,
    excerpt: passage ? passage.text.slice(0, MAX_PASSAGE_CHARS) : null,
    // Recognised from a scan: an answer citing it should say the wording may contain errors.
    recognised: passage?.source === 'ocr',
  }
}

/**
 * Finds passages for a question. `libraries` (ids) narrows the search; ids of
 * revoked or unknown libraries simply match nothing.
 */
export function retrieveEvidence(db, access, { query, libraries = [], limit = 8 }) {
  const allowed = libraries.filter((id) => {
    const root = access.libraryById(id)
    return root && root.state !== 'revoked'
  })
  if (libraries.length > 0 && allowed.length === 0) return []
  const result = searchRanked(db, {
    text: String(query ?? '').slice(0, 300),
    mode: 'fulltext',
    author: null,
    kinds: [],
    type: 'file',
    rootId: null,
    rootIds: allowed,
    within: null,
    minSize: null,
    maxSize: null,
    modifiedAfter: null,
    modifiedBefore: null,
    sort: 'relevance',
    limit: Math.min(Math.max(limit, 1), MAX_PASSAGES),
    offset: 0,
  })
  const passages = []
  for (const item of result.items) {
    // Checked again one by one: the search scope is SQL, this is the same rule in code.
    const readable = access.readableEntry(item.row.id)
    if (!readable || !item.excerpt) continue
    passages.push(describe(access, readable.entry, readable.root, item.excerpt))
  }
  return passages
}

/** Re-reads a passage of a document named in an earlier answer, if it may still be read. */
export function revisitEvidence(db, access, { entryId, query }) {
  const readable = access.readableEntry(entryId)
  if (!readable) return null
  const expression = ftsExpression(parseQuery(String(query ?? '')))
  const passage = expression ? bestPassage(db, entryId, expression) : null
  return describe(access, readable.entry, readable.root, passage)
}
