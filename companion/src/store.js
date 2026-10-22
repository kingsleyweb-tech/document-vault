import { DatabaseSync } from 'node:sqlite'
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

export function openStore(file) {
  const db = new DatabaseSync(file)
  db.exec(SCHEMA)

  const statements = {
    listRoots: db.prepare(`
      select r.*,
        (select count(*) from entries e where e.root_id = r.id and e.is_dir = 0) as file_count,
        (select count(*) from entries e where e.root_id = r.id and e.is_dir = 1) as folder_count
      from roots r order by r.path`),
    getRoot: db.prepare('select * from roots where id = ?'),
    rootByKey: db.prepare('select * from roots where path_key = ?'),
    insertRoot: db.prepare('insert into roots (path, path_key, added_at) values (?, ?, ?)'),
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
    counts: db.prepare('select count(*) as total, sum(is_dir) as folders from entries'),
  }

  const below = belowRange

  return {
    db,
    close: () => db.close(),
    listRoots: () => statements.listRoots.all(),
    getRoot: (id) => statements.getRoot.get(id),
    rootByPath: (value) => statements.rootByKey.get(pathKey(value)),
    addRoot(value) {
      const info = statements.insertRoot.run(value, pathKey(value), Date.now())
      return statements.getRoot.get(info.lastInsertRowid)
    },
    removeRoot(id) {
      statements.deleteRoot.run(id)
    },
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
