import { scopeSql } from './access.js'
import { KINDS } from './kinds.js'
import { belowRange, pathKey } from './paths.js'

// Searches the index. Words of three or more letters go through the trigram
// text index (any part of a name or path); shorter words are matched with
// LIKE within those results, or on names alone when every word is short.
// When nothing matches exactly, a typo-tolerant pass compares the words with
// the words of candidate names ("anual reprot" finds "Annual Report").

const MAX_LIMIT = 200
const COUNT_CAP = 5000
const FUZZY_CANDIDATES = 3000
// names: file and folder names only (the original search).
// documents: titles, file names, authors and other metadata.
// fulltext: the text inside documents.
// all: everything, ranked together.
const MODES = ['names', 'documents', 'fulltext', 'all']

export function parseSearch(params) {
  const text = String(params.get('q') ?? '').trim().replace(/\s+/g, ' ').slice(0, 200)
  const number = (name) => {
    const value = params.get(name)
    if (value === null || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  const kinds = (params.get('kind') ?? '').split(',').filter((kind) => KINDS.includes(kind))
  const type = params.get('type')
  const rootIds = (params.get('roots') ?? '').split(',').map(Number).filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 100)
  return {
    text,
    mode: MODES.includes(params.get('mode')) ? params.get('mode') : 'names',
    author: String(params.get('author') ?? '').trim().slice(0, 120) || null,
    kinds,
    type: type === 'file' || type === 'folder' ? type : null,
    rootId: number('root'),
    rootIds,
    within: params.get('within') || null,
    minSize: number('minSize'),
    maxSize: number('maxSize'),
    modifiedAfter: number('modifiedAfter'),
    modifiedBefore: number('modifiedBefore'),
    sort: ['relevance', 'name', 'modified', 'size'].includes(params.get('sort')) ? params.get('sort') : 'relevance',
    limit: Math.min(Math.max(number('limit') ?? 50, 1), MAX_LIMIT),
    offset: Math.max(number('offset') ?? 0, 0),
    // 'all' lists identical copies separately; by default they are shown once.
    copies: params.get('copies') === 'all' ? 'all' : 'once',
  }
}

export const escapeLike = (value) => value.replace(/[\\%_]/g, (character) => '\\' + character)
export const ftsPhrase = (word) => '"' + word.replace(/"/g, '""') + '"'

export function filterClauses(query) {
  // Every search is limited to libraries that may be read and to paths outside their exclusions.
  const scope = scopeSql('e', query.rootIds)
  const clauses = [scope.sql]
  const values = [...scope.values]
  if (query.author) {
    clauses.push('e.id in (select rowid from meta_fts where meta_fts match ?)')
    values.push(`author : ${ftsPhrase(query.author)}`)
  }
  if (query.kinds.length > 0) {
    clauses.push(`e.kind in (${query.kinds.map(() => '?').join(', ')})`)
    values.push(...query.kinds)
  }
  if (query.type) clauses.push(query.type === 'folder' ? 'e.is_dir = 1' : 'e.is_dir = 0')
  if (query.rootId !== null) {
    clauses.push('e.root_id = ?')
    values.push(query.rootId)
  }
  if (query.within) {
    const key = pathKey(query.within)
    clauses.push('e.path_key >= ? and e.path_key < ?')
    values.push(...belowRange(key))
  }
  if (query.minSize !== null) {
    clauses.push('e.size >= ?')
    values.push(query.minSize)
  }
  if (query.maxSize !== null) {
    clauses.push('e.size <= ?')
    values.push(query.maxSize)
  }
  if (query.modifiedAfter !== null) {
    clauses.push('e.mtime >= ?')
    values.push(query.modifiedAfter)
  }
  if (query.modifiedBefore !== null) {
    clauses.push('e.mtime <= ?')
    values.push(query.modifiedBefore)
  }
  return { clauses, values }
}

const ORDER = {
  name: 'e.name collate nocase asc',
  modified: 'e.mtime desc',
  size: 'e.size desc',
}

export function search(db, query) {
  const words = query.text.toLowerCase().split(' ').filter(Boolean)
  const long = words.filter((word) => word.length >= 3)
  const short = words.filter((word) => word.length < 3)
  const { clauses, values } = filterClauses(query)

  const textClauses = []
  const textValues = []
  let from = 'entries e'
  if (long.length > 0) {
    from = 'entries_fts join entries e on e.id = entries_fts.rowid'
    textClauses.push('entries_fts match ?')
    textValues.push(long.map(ftsPhrase).join(' AND '))
  }
  for (const word of short) {
    // Short words must appear in the name itself, or they would match almost every path.
    textClauses.push("lower(e.name) like ? escape '\\'")
    textValues.push('%' + escapeLike(word) + '%')
  }

  const where = [...textClauses, ...clauses]
  const whereSql = where.length > 0 ? 'where ' + where.join(' and ') : ''
  const params = [...textValues, ...values]

  // Relevance: exact name, then names starting with the query, then names
  // containing every word, then matches found only in the folder path.
  const phrase = words.join(' ')
  const nameHits = words.map(() => "instr(lower(e.name), ?) > 0").join(' and ') || '1'
  const relevance = `case
      when lower(e.name) = ? or lower(e.name) like ? escape '\\' then 0
      when lower(e.name) like ? escape '\\' then 1
      when ${nameHits} then 2
      else 3 end`
  const relevanceValues = [phrase, escapeLike(phrase) + '.%', escapeLike(phrase) + '%', ...words]
  // With no words there is nothing to rank by, so "best match" lists the most
  // recently modified items (an empty search box shows recent files).
  const byRelevance = (query.sort === 'relevance' || !ORDER[query.sort]) && words.length > 0
  const order = byRelevance ? `${relevance}, length(e.name), e.mtime desc` : ORDER[query.sort] ?? ORDER.modified
  const orderValues = byRelevance ? relevanceValues : []

  const items = db
    .prepare(`select e.* from ${from} ${whereSql} order by ${order} limit ? offset ?`)
    .all(...params, ...orderValues, query.limit, query.offset)
  const total = Number(
    db.prepare(`select count(*) as n from (select 1 from ${from} ${whereSql} limit ${COUNT_CAP})`).get(...params).n,
  )

  if (total > 0 || words.length === 0 || query.offset > 0) {
    return { items, total, totalCapped: total >= COUNT_CAP, fuzzy: false }
  }
  return fuzzySearch(db, query, words, clauses, values)
}

export function fuzzySearch(db, query, words, clauses, values) {
  const grams = new Set()
  for (const word of words) for (const gram of trigrams(word)) grams.add(gram)
  if (grams.size === 0) return { items: [], total: 0, totalCapped: false, fuzzy: true }
  const match = 'name : (' + [...grams].map(ftsPhrase).join(' OR ') + ')'
  const where = ['entries_fts match ?', ...clauses].join(' and ')
  const candidates = db
    .prepare(`select e.* from entries_fts join entries e on e.id = entries_fts.rowid where ${where} order by bm25(entries_fts) limit ${FUZZY_CANDIDATES}`)
    .all(match, ...values)
  const scored = []
  for (const row of candidates) {
    const score = fuzzyScore(words, row.name)
    if (score !== null) scored.push({ row, score })
  }
  scored.sort((a, b) => a.score - b.score || a.row.name.length - b.row.name.length)
  return {
    items: scored.slice(query.offset, query.offset + query.limit).map((entry) => entry.row),
    total: scored.length,
    totalCapped: false,
    fuzzy: true,
  }
}

function trigrams(word) {
  const result = []
  for (let index = 0; index + 3 <= word.length; index += 1) result.push(word.slice(index, index + 3))
  return result
}

/** Total edit distance when every query word is close to some word of the name, otherwise null. */
export function fuzzyScore(words, name) {
  const nameWords = name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  let total = 0
  for (const word of words) {
    const allowed = word.length >= 8 ? 2 : word.length >= 4 ? 1 : 0
    let best = Infinity
    for (const candidate of nameWords) {
      if (candidate.includes(word)) {
        best = 0
        break
      }
      if (Math.abs(candidate.length - word.length) > allowed) continue
      best = Math.min(best, editDistance(word, candidate, allowed))
    }
    if (best > allowed) return null
    total += best
  }
  return total
}

/** Optimal string alignment distance (a swap of two neighbouring letters counts as one edit). */
export function editDistance(a, b, limit = Infinity) {
  const rows = a.length + 1
  const cols = b.length + 1
  let previous2 = null
  let previous = Array.from({ length: cols }, (_, index) => index)
  for (let i = 1; i < rows; i += 1) {
    const current = [i]
    let rowMin = i
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
      if (previous2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, previous2[j - 2] + 1)
      current.push(value)
      rowMin = Math.min(rowMin, value)
    }
    if (rowMin > limit) return rowMin
    previous2 = previous
    previous = current
  }
  return previous[cols - 1]
}
