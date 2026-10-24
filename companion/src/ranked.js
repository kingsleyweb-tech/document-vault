import { scopeSql } from './access.js'
import { escapeLike, filterClauses, ftsPhrase, fuzzySearch, search } from './search.js'
import { contentHashes } from './duplicates.js'

// Searches titles, names, metadata and the text inside documents together,
// and ranks the results in tiers so a close match on meaning never outranks
// an exact match:
//
//   0 exact title          the document's title is the query
//   1 exact file name      the file name (without extension) is the query
//   2 exact phrase         the words appear together, in order, in the text
//   3 text                 every word appears in the text (stemmed: "reviews" finds "review")
//   4 metadata             every word appears in the title, author, subject or keywords
//   5 name or folder       every word appears in the file name or its folder path
//   6 similar name         a name close to the query despite typing mistakes
//
// Within a tier, results are ordered by the text index's own relevance score
// (BM25). Everything is read from the index; no file is opened to search.
//
// Query syntax: words are all required; "quoted words" must appear together;
// OR between two words accepts either; a leading minus excludes a word from
// text matches (-draft).

const TIER = { title: 0, filename: 1, phrase: 2, text: 3, metadata: 4, name: 5, fuzzy: 6 }
const TIER_NAMES = Object.fromEntries(Object.entries(TIER).map(([name, tier]) => [tier, name]))
const LIMIT_PER_TIER = 2000
const WORD = /[\p{L}\p{N}]+/gu

/** Splits a query into required words, phrases, OR groups and excluded words. */
export function parseQuery(text) {
  const groups = []
  const excluded = []
  const pattern = /(-?)"([^"]*)"|(\S+)/g
  let match
  let orNext = false
  while ((match = pattern.exec(text))) {
    if (match[3] === 'OR') {
      orNext = groups.length > 0
      continue
    }
    const negative = match[1] === '-' || (match[3]?.startsWith('-') && match[3].length > 1)
    const raw = match[2] ?? (negative ? match[3].slice(1) : match[3])
    const words = raw.toLowerCase().match(WORD) ?? []
    if (words.length === 0) continue
    const term = { words, phrase: match[2] !== undefined || words.length > 1 }
    if (negative) excluded.push(term)
    else if (orNext) groups[groups.length - 1].push(term)
    else groups.push([term])
    orNext = false
  }
  const words = groups.flat().flatMap((term) => term.words)
  return { groups, excluded, words, phrase: words.join(' ') }
}

const termSql = (term) => (term.phrase ? ftsPhrase(term.words.join(' ')) : term.words.map(ftsPhrase).join(' AND '))

/** The FTS5 expression for a parsed query, or null when nothing searchable remains. */
export function ftsExpression(parsed, { asPhrase = false } = {}) {
  if (parsed.words.length === 0) return null
  let expression = asPhrase
    ? ftsPhrase(parsed.words.join(' '))
    : parsed.groups.map((group) => (group.length > 1 ? `(${group.map(termSql).join(' OR ')})` : termSql(group[0]))).join(' AND ')
  for (const term of parsed.excluded) expression = `(${expression}) NOT ${termSql(term)}`
  return expression
}

export function searchRanked(db, query) {
  if (query.mode === 'names') return { ...search(db, query), mode: 'names' }
  const parsed = parseQuery(query.text)
  if (parsed.words.length === 0) return { ...search(db, { ...query, text: '' }), mode: query.mode }

  const { clauses, values } = filterClauses(query)
  const and = clauses.length > 0 ? ' and ' + clauses.join(' and ') : ''
  const hits = new Map()
  let capped = false
  const consider = (id, tier, score = 0) => {
    const current = hits.get(id)
    if (!current || tier < current.tier || (tier === current.tier && score < current.score)) hits.set(id, { tier, score })
  }
  const run = (sql, ...params) => {
    const rows = db.prepare(sql).all(...params)
    if (rows.length >= LIMIT_PER_TIER) capped = true
    return rows
  }
  const wantDocuments = query.mode === 'documents' || query.mode === 'all'
  const wantText = query.mode === 'fulltext' || query.mode === 'all'
  const multiWord = parsed.words.length > 1

  if (wantDocuments) {
    // 0: exact title.
    for (const row of run(`select e.id from meta_fts m join entries e on e.id = m.rowid
        where meta_fts match ? and lower(m.title) = ?${and} limit ${LIMIT_PER_TIER}`, `title : ${ftsPhrase(parsed.phrase)}`, parsed.phrase, ...values)) {
      consider(row.id, TIER.title)
    }
    // 1: exact file name, with or without its extension.
    if (parsed.phrase.length >= 3) {
      for (const row of run(`select e.id, e.name from entries_fts join entries e on e.id = entries_fts.rowid
          where entries_fts match ? and e.is_dir = 0${and} limit ${LIMIT_PER_TIER}`, `name : ${ftsPhrase(parsed.phrase)}`, ...values)) {
        const base = row.name.toLowerCase().replace(/\.[^.]+$/, '')
        const normalized = base.match(WORD)?.join(' ') ?? ''
        if (base === parsed.phrase || row.name.toLowerCase() === parsed.phrase || normalized === parsed.phrase) consider(row.id, TIER.filename)
      }
    }
    // 4: metadata.
    const metaExpression = ftsExpression({ ...parsed, excluded: [] })
    for (const row of run(`select e.id, bm25(meta_fts) as score from meta_fts m join entries e on e.id = m.rowid
        where meta_fts match ?${and} order by score limit ${LIMIT_PER_TIER}`, metaExpression, ...values)) {
      consider(row.id, TIER.metadata, row.score)
    }
    // 5: words in the name or folder path (the trigram index finds parts of words too).
    const long = parsed.words.filter((word) => word.length >= 3)
    const short = parsed.words.filter((word) => word.length < 3)
    if (long.length > 0) {
      const shortSql = short.map(() => " and lower(e.name) like ? escape '\\'").join('')
      const rows = run(`select e.id, e.name from entries_fts join entries e on e.id = entries_fts.rowid
          where entries_fts match ?${shortSql}${and} order by bm25(entries_fts) limit ${LIMIT_PER_TIER}`,
        long.map(ftsPhrase).join(' AND '), ...short.map((word) => `%${escapeLike(word)}%`), ...values)
      for (const row of rows) {
        const name = row.name.toLowerCase()
        // Names containing every word rank above matches found only in the folder path.
        consider(row.id, TIER.name, parsed.words.every((word) => name.includes(word)) ? 0 : 1)
      }
    }
  }

  const textHits = new Map()
  if (wantText) {
    const textQuery = (expression, tier) => {
      // Materialized, so SQLite cannot fold bm25() into the grouping (where it is not allowed).
      // With min(), SQLite takes page_id from the best-scoring row: the passage to show.
      const rows = run(`with x as materialized (
          select p.entry_id, p.id as page_id, bm25(doc_pages_fts) as score from doc_pages_fts
          join doc_pages p on p.id = doc_pages_fts.rowid join entries e on e.id = p.entry_id
          where doc_pages_fts match ?${and})
        select x.entry_id as id, x.page_id, min(x.score) as score, count(*) as pages from x
        group by x.entry_id order by score limit ${LIMIT_PER_TIER}`, expression, ...values)
      for (const row of rows) {
        consider(row.id, tier, row.score)
        if (!textHits.has(row.id) || tier === TIER.phrase) {
          textHits.set(row.id, { expression, pages: Number(row.pages), phrase: tier === TIER.phrase, pageId: row.page_id })
        }
      }
    }
    if (multiWord && parsed.groups.length > 1 && parsed.groups.every((group) => group.length === 1)) {
      textQuery(ftsExpression(parsed, { asPhrase: true }), TIER.phrase)
    }
    textQuery(ftsExpression(parsed), TIER.text)
    // A single quoted phrase is an exact-phrase search.
    if (parsed.groups.length === 1 && parsed.groups[0].length === 1 && parsed.groups[0][0].phrase) {
      for (const id of textHits.keys()) if (hits.get(id)?.tier === TIER.text) hits.get(id).tier = TIER.phrase
    }
  }

  let fuzzy = false
  if (hits.size === 0 && wantDocuments) {
    const result = fuzzySearch(db, { ...query, offset: 0, limit: LIMIT_PER_TIER }, parsed.words, clauses, values)
    result.items.forEach((row, index) => consider(row.id, TIER.fuzzy, index))
    fuzzy = result.items.length > 0
  }

  const ids = [...hits.keys()]
  const rows = new Map()
  for (let index = 0; index < ids.length; index += 500) {
    const slice = ids.slice(index, index + 500)
    for (const row of db.prepare(`select * from entries where id in (${slice.map(() => '?').join(', ')})`).all(...slice)) rows.set(row.id, row)
  }
  const ranked = ids.filter((id) => rows.has(id)).map((id) => ({ row: rows.get(id), ...hits.get(id) }))
  const byName = (a, b) => a.row.name.localeCompare(b.row.name, undefined, { sensitivity: 'base' })
  const orders = {
    relevance: (a, b) => a.tier - b.tier || a.score - b.score || a.row.name.length - b.row.name.length || byName(a, b),
    name: byName,
    modified: (a, b) => b.row.mtime - a.row.mtime,
    size: (a, b) => b.row.size - a.row.size,
  }
  ranked.sort(orders[query.sort] ?? orders.relevance)
  // Identical copies of a file (same bytes) are shown once, under the best-placed copy.
  const shown = query.copies === 'all' ? ranked : collapseCopies(db, ranked)

  const page = shown.slice(query.offset, query.offset + query.limit)
  const items = page.map(({ row, tier, copies }) => {
    const text = textHits.get(row.id)
    return {
      row,
      match: TIER_NAMES[tier],
      excerpt: text ? bestPassage(db, row.id, text.expression, text.pageId) : null,
      matchingSections: text?.pages ?? 0,
      meta: metaOf(db, row.id),
      referencedBy: referencesTo(db, row.id),
      copies: copies ?? [],
    }
  })
  return { items, total: shown.length, totalCapped: capped, fuzzy, mode: query.mode }
}

/** Folds results with identical bytes into the first of them, which lists the others as copies. */
function collapseCopies(db, ranked) {
  const hashes = contentHashes(db, ranked.filter((hit) => !hit.row.is_dir).map((hit) => hit.row.id))
  const first = new Map()
  const shown = []
  for (const hit of ranked) {
    const hash = hashes.get(hit.row.id)
    const primary = hash ? first.get(hash) : null
    if (primary) {
      primary.copies.push(hit.row)
      continue
    }
    const kept = { ...hit, copies: [] }
    if (hash) first.set(hash, kept)
    shown.push(kept)
  }
  return shown
}

// The text index is searched by row id range of one document's pages, so a
// passage lookup does not evaluate the words against the whole library.
const ONE_DOCUMENT = 'doc_pages_fts.rowid in (select id from doc_pages where entry_id = ?)'
const PASSAGE = "p.page, p.label, p.seq, p.source, p.confidence, snippet(doc_pages_fts, 0, '<<', '>>', '…', 24) as text"

// source is 'ocr' when the words were recognised from a picture of the page
// (and may contain recognition errors), 'text' when they were read from the file.
const passage = (row) => ({
  page: row.page ?? null,
  label: row.label ?? null,
  section: Number(row.seq) + 1,
  text: row.text,
  source: row.source,
  ...(row.source === 'ocr' ? { confidence: row.confidence } : {}),
})

/**
 * The best matching passage of one document, with its page where the format
 * has pages. When the search already found the best page, only that page is read.
 */
export function bestPassage(db, entryId, expression, pageId = null) {
  const row = pageId !== null && pageId !== undefined
    ? db.prepare(`select ${PASSAGE} from doc_pages_fts join doc_pages p on p.id = doc_pages_fts.rowid
        where doc_pages_fts match ? and doc_pages_fts.rowid = ? and p.entry_id = ?`).get(expression, pageId, entryId)
    : db.prepare(`select ${PASSAGE} from doc_pages_fts join doc_pages p on p.id = doc_pages_fts.rowid
        where doc_pages_fts match ? and ${ONE_DOCUMENT} order by bm25(doc_pages_fts) limit 1`).get(expression, entryId)
  return row ? passage(row) : null
}

/** Every matching passage of one document, in reading order, for moving from one match to the next. */
export function matchesIn(db, entryId, text, limit = 500) {
  const parsed = parseQuery(text)
  const expression = ftsExpression(parsed)
  if (!expression) return []
  // By page first: recognised pages are stored beside the text pages of the same PDF.
  return db.prepare(`select ${PASSAGE} from doc_pages_fts join doc_pages p on p.id = doc_pages_fts.rowid
      where doc_pages_fts match ? and ${ONE_DOCUMENT} order by coalesce(p.page, p.seq + 1), p.seq limit ?`).all(expression, entryId, limit)
    .map(passage)
}

/** The effective metadata of a document, with where each value came from. */
export function metaOf(db, entryId) {
  const rows = db.prepare('select field, value, source from doc_meta where entry_id = ?').all(entryId)
  if (rows.length === 0) return null
  const rank = { user: 0, original: 1, extracted: 2 }
  const result = {}
  for (const row of rows) {
    if (!result[row.field] || rank[row.source] < rank[result[row.field].source]) result[row.field] = { value: row.value, source: row.source }
  }
  return result
}

/** How many readable web pages link to this document, and the name of one of them. */
export function referencesTo(db, entryId) {
  const scope = scopeSql('s')
  const row = db.prepare(`select count(*) as n, min(s.name) as example from doc_links l join entries s on s.id = l.source_id
      where l.target_id = ? and l.status = 'verified' and ${scope.sql}`).get(entryId, ...scope.values)
  return Number(row.n) > 0 ? { count: Number(row.n), example: row.example } : null
}
