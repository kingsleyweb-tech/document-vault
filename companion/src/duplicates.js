import path from 'node:path'
import { scopeSql } from './access.js'

// Groups of duplicate files across the libraries that may be read. Nothing
// here changes a file; dismissing a group only records it in the index.
//
//   exact - identical bytes (same SHA-256), from file_hashes
//   text  - the same words in files whose bytes differ (see fingerprint.js);
//           groups whose copies are all byte-identical are left to 'exact'
//
// Groups are always formed over every readable library, so a book in two
// libraries is one group; the library filter only picks groups with a copy in it.
// A dismissed group is shown again once its copies change (one is added or removed).

export const DUPLICATE_KINDS = ['exact', 'text']

function members(kind, scope) {
  if (kind === 'exact') {
    return {
      sql: `select h.sha256 as k, e.id, e.root_id, e.size, h.sha256 as bytes from file_hashes h join entries e on e.id = h.entry_id
        where h.size = e.size and h.mtime = e.mtime and e.size > 0 and e.is_dir = 0 and ${scope.sql}`,
      values: scope.values,
    }
  }
  return {
    sql: `select d.text_hash as k, e.id, e.root_id, e.size, h.sha256 as bytes from docs d join entries e on e.id = d.entry_id
      left join file_hashes h on h.entry_id = e.id and h.size = e.size and h.mtime = e.mtime
      where d.state = 'completed' and d.text_hash <> '' and d.size = e.size and d.mtime = e.mtime and ${scope.sql}`,
    values: scope.values,
  }
}

function groupsSql(kind) {
  const scope = scopeSql('e')
  const c = members(kind, scope)
  // For 'text', a group needs at least two different files (by bytes).
  const having = kind === 'text' ? 'count(*) > 1 and count(distinct coalesce(bytes, id)) > 1' : 'count(*) > 1'
  return {
    sql: `with c as materialized (${c.sql}),
      g as (select k, count(*) as n, sum(size) - max(size) as extra, max(size) as size,
          sum(case when root_id = ? then 1 else 0 end) as here, group_concat(id, ',' order by id) as members
        from c group by k having ${having})
      select g.*, x.at as dismissed_at from g left join dup_dismissed x on x.kind = ? and x.key = g.k and x.members = g.members`,
    values: c.values,
  }
}

/** Lists duplicate groups, largest waste of space first. */
export function listDuplicates(db, { kind, rootId = null, dismissed = false, limit, offset }) {
  const groups = groupsSql(kind)
  const rows = db.prepare(`select * from (${groups.sql}) where (? is null or here > 0) and (dismissed_at is not null) = ?
      order by extra desc, k limit ? offset ?`)
    .all(...groups.values, rootId ?? -1, kind, rootId, dismissed ? 1 : 0, limit, offset)
  const copies = db.prepare(`select e.*, r.name as root_name, r.path as root_path from entries e join roots r on r.id = e.root_id
      where e.id in (select value from json_each(?)) order by r.id, e.path`)
  return rows.map((row) => {
    const ids = row.members.split(',').map(Number)
    const list = copies.all(JSON.stringify(ids)).map((entry) => ({
      entryId: entry.id,
      libraryId: entry.root_id,
      libraryName: entry.root_name || path.basename(entry.root_path) || entry.root_path,
      name: entry.name,
      folder: path.dirname(entry.path),
      size: entry.size,
      mtime: entry.mtime,
    }))
    return {
      kind,
      key: row.k,
      copies: list,
      extraBytes: Number(row.extra),
      sameName: new Set(list.map((copy) => copy.name.toLowerCase())).size === 1,
      dismissedAt: row.dismissed_at ?? null,
    }
  })
}

/** Counts for the page header and the Libraries page. */
export function duplicateSummary(db) {
  const summary = {}
  for (const kind of DUPLICATE_KINDS) {
    const groups = groupsSql(kind)
    const row = db.prepare(`select count(*) as groups, coalesce(sum(n - 1), 0) as copies, coalesce(sum(extra), 0) as bytes
        from (${groups.sql}) where dismissed_at is null`).get(...groups.values, -1, kind)
    summary[kind] = { groups: Number(row.groups), extraCopies: Number(row.copies), extraBytes: Number(row.bytes) }
  }
  return summary
}

/** Records (or forgets) that a group is not a set of duplicates. Returns false if there is no such group now. */
export function dismissDuplicate(db, { kind, key, dismissed }) {
  if (!dismissed) {
    db.prepare('delete from dup_dismissed where kind = ? and key = ?').run(kind, key)
    return true
  }
  const groups = groupsSql(kind)
  const row = db.prepare(`select members from (${groups.sql}) where k = ?`).get(...groups.values, -1, kind, key)
  if (!row) return false
  db.prepare(`insert into dup_dismissed (kind, key, members, at) values (?, ?, ?, ?)
      on conflict (kind, key) do update set members = excluded.members, at = excluded.at`).run(kind, key, row.members, Date.now())
  return true
}

/** The identical-bytes hash of each of these entries that has a current one. */
export function contentHashes(db, ids) {
  const hashes = new Map()
  for (let index = 0; index < ids.length; index += 500) {
    const slice = ids.slice(index, index + 500)
    const rows = db.prepare(`select h.entry_id, h.sha256 from file_hashes h join entries e on e.id = h.entry_id
        where h.size = e.size and h.mtime = e.mtime and e.size > 0 and h.entry_id in (${slice.map(() => '?').join(', ')})`).all(...slice)
    for (const row of rows) hashes.set(row.entry_id, row.sha256)
  }
  return hashes
}
