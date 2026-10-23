import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { KINDS } from './kinds.js'
import { checkIntegrity, migrate } from './migrations.js'
import { belowRange, pathKey } from './paths.js'

// One SQLite file holds the index. Names and paths are searched through an
// FTS5 trigram index, which matches any part of a word ("nnual" finds
// "Annual") without scanning the table. Filters use ordinary indexes.

const SCHEMA = `
pragma journal_mode = wal;
pragma synchronous = normal;
pragma foreign_keys = on;

create table if not exists roots (
  id integer primary key,
  path text not null,
  path_key text not null unique,
  added_at integer not null,
  last_scan_at integer,
  last_scan_ms integer,
  status text not null default 'pending',
  error text
);

create table if not exists entries (
  id integer primary key,
  root_id integer not null references roots(id) on delete cascade,
  path text not null,
  path_key text not null unique,
  parent_key text not null,
  name text not null,
  ext text not null,
  kind text not null,
  is_dir integer not null,
  size integer not null default 0,
  mtime integer not null default 0,
  readonly integer not null default 0,
  hidden integer not null default 0,
  accessible integer not null default 1,
  scan_gen integer not null default 0
);

create index if not exists entries_root_gen on entries (root_id, scan_gen);
create index if not exists entries_parent on entries (parent_key);
create index if not exists entries_kind on entries (kind);
create index if not exists entries_mtime on entries (mtime);
create index if not exists entries_size on entries (size);

create virtual table if not exists entries_fts using fts5(
  name, path, content = 'entries', content_rowid = 'id', tokenize = 'trigram'
);

-- Keep the text index in step with the table. Updates that only touch size,
-- dates or scan bookkeeping do not rewrite the text index.
create trigger if not exists entries_ai after insert on entries begin
  insert into entries_fts (rowid, name, path) values (new.id, new.name, new.path);
end;
create trigger if not exists entries_ad after delete on entries begin
  insert into entries_fts (entries_fts, rowid, name, path) values ('delete', old.id, old.name, old.path);
end;
create trigger if not exists entries_au after update of name, path on entries begin
  insert into entries_fts (entries_fts, rowid, name, path) values ('delete', old.id, old.name, old.path);
  insert into entries_fts (rowid, name, path) values (new.id, new.name, new.path);
end;
`

// Library settings the web app may change, with how each is stored.
const ROOT_SETTINGS = {
  name: (value) => (value === null ? null : String(value).trim().slice(0, 120) || null),
  recursive: (value) => (value ? 1 : 0),
  max_depth: (value) => Math.min(Math.max(Math.round(Number(value) || 0), 0), 256),
  file_types: (value) => (Array.isArray(value) ? JSON.stringify(value.filter((kind) => KINDS.includes(kind))) : null),
  extract_text: (value) => (value ? 1 : 0),
  // Text recognition of scanned pages: 'ask' (offer it when scans are found), 'on' or 'off'.
  ocr_pref: (value) => (['ask', 'on', 'off'].includes(value) ? value : 'ask'),
}

/**
 * Opens the index, creating or upgrading it. A damaged file is moved aside
 * and a new, empty index is started; `recovered` then describes what happened.
 */
export function openStore(file) {
  let db
  let recovered = null
  try {
    db = new DatabaseSync(file)
    const problem = file === ':memory:' ? null : checkIntegrity(db)
    if (problem) throw new Error(problem)
  } catch (error) {
    if (file === ':memory:') throw error
    db?.close()
    const aside = `${file}.damaged-${Date.now()}`
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(file + suffix)) fs.renameSync(file + suffix, aside + suffix)
    }
    recovered = { at: Date.now(), movedTo: aside, problem: String(error?.message ?? error).slice(0, 300) }
    db = new DatabaseSync(file)
  }
  try {
    db.exec(SCHEMA)
    migrate(db, file === ':memory:' ? null : file)
  } catch (error) {
    db.close()
    throw error
  }

  const statements = {
    listRoots: db.prepare(`
      select r.*,
        (select count(*) from entries e where e.root_id = r.id and e.is_dir = 0) as file_count,
        (select count(*) from entries e where e.root_id = r.id and e.is_dir = 1) as folder_count
      from roots r order by r.path`),
    rootRows: db.prepare('select * from roots order by path'),
    getRoot: db.prepare('select * from roots where id = ?'),
    rootByKey: db.prepare('select * from roots where path_key = ?'),
    insertRoot: db.prepare("insert into roots (path, path_key, added_at, ocr_pref) values (?, ?, ?, 'ask')"),
    deleteRoot: db.prepare('delete from roots where id = ?'),
    setRootStatus: db.prepare('update roots set status = ?, error = ? where id = ?'),
    finishRootScan: db.prepare('update roots set status = ?, error = ?, last_scan_at = ?, last_scan_ms = ? where id = ?'),
    upsert: db.prepare(`
      insert into entries (root_id, path, path_key, parent_key, name, ext, kind, is_dir, size, mtime, readonly, hidden, accessible, scan_gen)
      values (:root_id, :path, :path_key, :parent_key, :name, :ext, :kind, :is_dir, :size, :mtime, :readonly, :hidden, :accessible, :scan_gen)
      on conflict (path_key) do update set
        root_id = excluded.root_id, kind = excluded.kind, is_dir = excluded.is_dir, size = excluded.size,
        mtime = excluded.mtime, readonly = excluded.readonly, hidden = excluded.hidden,
        accessible = excluded.accessible, scan_gen = excluded.scan_gen`),
    // A rename that only changes letter case keeps the same key.
    renameCase: db.prepare('update entries set name = ?, path = ?, ext = ? where path_key = ? and path <> ?'),
    deleteStale: db.prepare('delete from entries where root_id = ? and scan_gen < ? and path_key >= ? and path_key < ?'),
    deleteStaleRoot: db.prepare('delete from entries where root_id = ? and scan_gen < ?'),
    deleteKey: db.prepare('delete from entries where path_key = ?'),
    deleteBelow: db.prepare('delete from entries where path_key >= ? and path_key < ?'),
    getEntry: db.prepare('select * from entries where id = ?'),
    entryByKey: db.prepare('select * from entries where path_key = ?'),
    setAccessible: db.prepare('update entries set accessible = ? where id = ?'),
    counts: db.prepare(`select count(*) as total, sum(e.is_dir) as folders from entries e join roots r on r.id = e.root_id where r.state <> 'revoked'`),
    bumpEpoch: db.prepare('update roots set epoch = epoch + 1 where id = ?'),
    setState: db.prepare('update roots set state = ?, revoked_at = ? where id = ?'),
    setSynced: db.prepare('update roots set last_sync_at = ? where id = ?'),
    setTypeSkipped: db.prepare('update roots set type_skipped = ? where id = ?'),
    listExclusions: db.prepare('select * from exclusions where root_id = ? order by path'),
    allExclusions: db.prepare('select * from exclusions'),
    getExclusion: db.prepare('select * from exclusions where id = ?'),
    insertExclusion: db.prepare('insert or ignore into exclusions (root_id, path, path_key, key_lo, key_hi, added_at) values (?, ?, ?, ?, ?, ?)'),
    deleteExclusion: db.prepare('delete from exclusions where id = ?'),
    recordSkip: db.prepare(`insert into skips (path_key, root_id, path, reason, at) values (?, ?, ?, ?, ?)
      on conflict (path_key) do update set root_id = excluded.root_id, reason = excluded.reason, at = excluded.at`),
    clearSkipsBelow: db.prepare('delete from skips where root_id = ? and (path_key = ? or (path_key >= ? and path_key < ?))'),
    clearSkips: db.prepare('delete from skips where root_id = ?'),
    deleteRootEntries: db.prepare('delete from entries where root_id = ?'),
    deleteRootLinks: db.prepare('delete from doc_links where root_id = ?'),
    deleteRootDocs: db.prepare('delete from docs where root_id = ?'),
    // Links into a folder that is no longer authorized are reported as outside, not broken.
    linksOutside: db.prepare("update doc_links set status = 'outside', target_id = null where status <> 'external' and (target_key = ? or (target_key >= ? and target_key < ?))"),
    linksRecheck: db.prepare("update doc_links set status = 'broken' where status = 'outside' and (target_key = ? or (target_key >= ? and target_key < ?))"),
    event: db.prepare('insert into events (at, kind, root_id, detail) values (?, ?, ?, ?)'),
    recentEvents: db.prepare('select * from events order by id desc limit ?'),
  }

  const below = belowRange

  function transaction(work) {
    db.exec('begin')
    try {
      const result = work()
      db.exec('commit')
      return result
    } catch (error) {
      db.exec('rollback')
      throw error
    }
  }

  return {
    db,
    recovered,
    transaction,
    close: () => db.close(),
    listRoots: () => statements.listRoots.all(),
    /** Libraries without the file counts, for frequent checks. */
    listRootRows: () => statements.rootRows.all(),
    getRoot: (id) => statements.getRoot.get(id),
    rootByPath: (value) => statements.rootByKey.get(pathKey(value)),
    addRoot(value, settings = {}) {
      const info = statements.insertRoot.run(value, pathKey(value), Date.now())
      const id = Number(info.lastInsertRowid)
      this.updateRoot(id, settings)
      return statements.getRoot.get(id)
    },
    /** Changes library settings. Only the names in ROOT_SETTINGS are accepted. */
    updateRoot(id, settings) {
      const columns = Object.keys(settings).filter((key) => Object.hasOwn(ROOT_SETTINGS, key) && settings[key] !== undefined)
      if (columns.length === 0) return
      const values = columns.map((key) => ROOT_SETTINGS[key](settings[key]))
      db.prepare(`update roots set ${columns.map((key) => `${key} = ?`).join(', ')} where id = ?`).run(...values, id)
    },
    removeRoot(id) {
      // The cascade removes entries, extracted text, metadata, skips and exclusions.
      transaction(() => {
        statements.deleteRootLinks.run(id)
        statements.deleteRoot.run(id)
      })
    },
    /** Deletes everything indexed for a library but keeps the library itself. Files on disk are untouched. */
    purgeRoot(id) {
      transaction(() => {
        statements.deleteRootLinks.run(id)
        statements.deleteRootDocs.run(id)
        statements.deleteRootEntries.run(id)
        statements.clearSkips.run(id)
      })
    },
    bumpEpoch: (id) => statements.bumpEpoch.run(id),
    setState: (id, state) => statements.setState.run(state, state === 'revoked' ? Date.now() : null, id),
    setSynced: (id) => statements.setSynced.run(Date.now(), id),
    setTypeSkipped: (id, count) => statements.setTypeSkipped.run(count, id),

    listExclusions: (rootId) => statements.listExclusions.all(rootId),
    allExclusions: () => statements.allExclusions.all(),
    getExclusion: (id) => statements.getExclusion.get(id),
    /** Excludes a folder: removes what was indexed below it and marks links into it as outside. */
    addExclusion(rootId, folder) {
      const key = pathKey(folder)
      const [lo, hi] = below(key)
      transaction(() => {
        statements.insertExclusion.run(rootId, folder, key, lo, hi, Date.now())
        statements.deleteKey.run(key)
        statements.deleteBelow.run(lo, hi)
        statements.clearSkipsBelow.run(rootId, key, lo, hi)
        statements.linksOutside.run(key, lo, hi)
      })
    },
    removeExclusion(exclusion) {
      transaction(() => {
        statements.deleteExclusion.run(exclusion.id)
        statements.linksRecheck.run(exclusion.path_key, exclusion.key_lo, exclusion.key_hi)
      })
    },
    recordSkip: (rootId, target, reason) => statements.recordSkip.run(pathKey(target), rootId, target, reason, Date.now()),
    clearSkipsBelow(rootId, folder) {
      const key = pathKey(folder)
      statements.clearSkipsBelow.run(rootId, key, ...below(key))
    },
    event: (kind, rootId = null, detail = null) => statements.event.run(Date.now(), kind, rootId, detail),
    recentEvents: (limit = 50) => statements.recentEvents.all(limit),
    setRootStatus: (id, status, error = null) => statements.setRootStatus.run(status, error, id),
    finishRootScan: (id, status, error, ms) => statements.finishRootScan.run(status, error, Date.now(), ms, id),

    /** Writes a batch of scanned entries in one transaction. */
    writeEntries(rows) {
      if (rows.length === 0) return
      db.exec('begin')
      try {
        for (const row of rows) {
          statements.upsert.run(row)
          statements.renameCase.run(row.name, row.path, row.ext, row.path_key, row.path)
        }
        db.exec('commit')
      } catch (error) {
        db.exec('rollback')
        throw error
      }
    },

    /** Removes entries of a root (or one folder of it) that the latest scan did not see. */
    removeUnseen(rootId, generation, folderKey = null) {
      if (folderKey === null) return Number(statements.deleteStaleRoot.run(rootId, generation).changes)
      const [from, to] = below(folderKey)
      return Number(statements.deleteStale.run(rootId, generation, from, to).changes)
    },

    /** Removes a path and, for folders, everything inside it. */
    removePath(value) {
      const key = pathKey(value)
      const [from, to] = below(key)
      return Number(statements.deleteKey.run(key).changes) + Number(statements.deleteBelow.run(from, to).changes)
    },

    getEntry: (id) => statements.getEntry.get(id),
    entryByPath: (value) => statements.entryByKey.get(pathKey(value)),
    setAccessible: (id, accessible) => statements.setAccessible.run(accessible ? 1 : 0, id),
    counts() {
      const row = statements.counts.get()
      return { total: Number(row.total ?? 0), folders: Number(row.folders ?? 0) }
    },
    belowRange: below,
  }
}
