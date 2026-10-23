import fs from 'node:fs'

// Versioned changes to the index schema. The base schema (store.js) is
// version 1; each migration here moves the file up one version inside a
// transaction, and the file is copied aside first so a failed upgrade can be
// recovered. Migrations only add tables and columns: indexed data and the
// user's settings are never dropped.

const MIGRATIONS = [
  // 2: libraries, exclusions, extracted text, metadata, links between documents.
  `
  alter table roots add column name text;
  alter table roots add column recursive integer not null default 1;
  alter table roots add column max_depth integer not null default 64;
  alter table roots add column file_types text;
  alter table roots add column state text not null default 'active';
  alter table roots add column epoch integer not null default 0;
  alter table roots add column revoked_at integer;
  alter table roots add column last_sync_at integer;
  alter table roots add column extract_text integer not null default 1;
  alter table roots add column ocr_pref text not null default 'off';
  alter table roots add column ai_pref text not null default 'off';
  alter table roots add column type_skipped integer not null default 0;

  -- Folders inside a library that the user excluded. key_lo/key_hi bound the
  -- keys of everything below the folder (see paths.belowRange).
  create table exclusions (
    id integer primary key,
    root_id integer not null references roots(id) on delete cascade,
    path text not null,
    path_key text not null,
    key_lo text not null,
    key_hi text not null,
    added_at integer not null,
    unique (root_id, path_key)
  );

  -- Items the scan saw but did not index, with the reason, so nothing is left out silently.
  create table skips (
    path_key text primary key,
    root_id integer not null references roots(id) on delete cascade,
    path text not null,
    reason text not null,
    at integer not null
  );
  create index skips_root on skips (root_id, reason);

  -- Text extraction state of each document (the processing queue).
  create table docs (
    entry_id integer primary key references entries(id) on delete cascade,
    root_id integer not null references roots(id) on delete cascade,
    state text not null,
    priority integer not null default 0,
    attempts integer not null default 0,
    error text,
    size integer,
    mtime integer,
    sha256 text,
    pages integer,
    text_pages integer,
    needs_ocr integer not null default 0,
    truncated integer not null default 0,
    role text,
    extracted_at integer,
    ms integer
  );
  create index docs_queue on docs (state, priority desc, entry_id);
  create index docs_root on docs (root_id, state);
  create index docs_hash on docs (sha256);

  -- Extracted text, one row per page (PDF), slide (PowerPoint), chapter
  -- (EPUB) or section. page is null where the format has no page numbers.
  create table doc_pages (
    id integer primary key,
    entry_id integer not null references entries(id) on delete cascade,
    seq integer not null,
    page integer,
    label text,
    text text not null
  );
  create index doc_pages_entry on doc_pages (entry_id, seq);
  create virtual table doc_pages_fts using fts5(
    text, content = 'doc_pages', content_rowid = 'id', tokenize = 'porter unicode61 remove_diacritics 2'
  );
  create trigger doc_pages_ai after insert on doc_pages begin
    insert into doc_pages_fts (rowid, text) values (new.id, new.text);
  end;
  create trigger doc_pages_ad after delete on doc_pages begin
    insert into doc_pages_fts (doc_pages_fts, rowid, text) values ('delete', old.id, old.text);
  end;

  -- Document metadata with its provenance: 'original' (embedded in the file),
  -- 'extracted' (read from the content, such as a page title) or 'user'
  -- (a correction, which a re-index never overwrites).
  create table doc_meta (
    entry_id integer not null references entries(id) on delete cascade,
    field text not null,
    value text not null,
    source text not null,
    primary key (entry_id, field, source)
  );
  -- The effective values (user over original over extracted), searchable. rowid = entry id.
  create virtual table meta_fts using fts5(title, author, subject, keywords, publisher, tokenize = 'unicode61 remove_diacritics 2');

  -- Links found in web pages. target_id is set while the target is indexed.
  create table doc_links (
    id integer primary key,
    source_id integer not null references entries(id) on delete cascade,
    root_id integer not null,
    href text not null,
    label text,
    target_key text,
    target_id integer,
    status text not null
  );
  create index doc_links_source on doc_links (source_id);
  create index doc_links_target_key on doc_links (target_key);
  create index doc_links_target on doc_links (target_id);
  create index doc_links_status on doc_links (root_id, status);

  create trigger entries_links_ai after insert on entries begin
    update doc_links set target_id = new.id, status = 'verified' where target_key = new.path_key and status <> 'external';
  end;
  create trigger entries_links_ad after delete on entries begin
    update doc_links set target_id = null, status = 'broken' where target_id = old.id;
    delete from meta_fts where rowid = old.id;
  end;

  -- Security-relevant events (libraries added, excluded, revoked). Never
  -- search queries or document text.
  create table events (
    id integer primary key,
    at integer not null,
    kind text not null,
    root_id integer,
    detail text
  );
  `,

  // 3: text recognition (OCR) of scanned pages. ocr_pref becomes
  // 'ask' (offer it once scanned pages are found), 'on' or 'off'.
  `
  update roots set ocr_pref = 'ask' where ocr_pref = 'off';
  alter table docs add column ocr_state text not null default 'none';
  alter table docs add column ocr_pages integer not null default 0;
  alter table docs add column ocr_done integer not null default 0;
  alter table docs add column ocr_failed integer not null default 0;
  alter table docs add column ocr_confidence integer;
  alter table docs add column ocr_error text;
  alter table docs add column ocr_at integer;
  create index docs_ocr on docs (ocr_state, priority desc, entry_id);
  -- 'text' (read from the file) or 'ocr' (recognised from a picture of the page).
  alter table doc_pages add column source text not null default 'text';
  alter table doc_pages add column confidence integer;
  `,
]

export const SCHEMA_VERSION = 1 + MIGRATIONS.length

/** Brings the index up to the current version. `file` is null for in-memory databases. */
export function migrate(db, file) {
  const current = Number(db.prepare('pragma user_version').get().user_version)
  // Files created before versioning was added have the base tables but version 0.
  let version = current === 0 ? 1 : current
  if (version > SCHEMA_VERSION) {
    throw Object.assign(new Error('This index was made by a newer version of Document Vault.'), { code: 'INDEX_TOO_NEW' })
  }
  const hasLibraries = Number(db.prepare('select count(*) as n from roots').get().n) > 0
  if (version < SCHEMA_VERSION && file && hasLibraries) backup(db, file, version)
  while (version < SCHEMA_VERSION) {
    db.exec('begin')
    try {
      db.exec(MIGRATIONS[version - 1])
      version += 1
      db.exec(`pragma user_version = ${version}`)
      db.exec('commit')
    } catch (error) {
      db.exec('rollback')
      throw error
    }
  }
  if (current === 0) db.exec(`pragma user_version = ${version}`)
}

function backup(db, file, version) {
  const target = `${file}.bak-v${version}`
  fs.rmSync(target, { force: true })
  // VACUUM INTO writes a consistent copy even while the WAL holds recent changes.
  db.prepare('vacuum into ?').run(target)
}

/** Runs SQLite's own consistency check. Returns null when the file is sound. */
export function checkIntegrity(db) {
  const rows = db.prepare('pragma quick_check').all()
  const problems = rows.map((row) => Object.values(row)[0]).filter((value) => value !== 'ok')
  return problems.length > 0 ? problems.slice(0, 5).join('; ') : null
}
