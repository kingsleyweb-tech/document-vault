-- Document Vault core metadata schema.
--
-- Files stay in each user's own Google Drive; these tables hold only the
-- metadata needed to organise, find and audit them. Users sign in with
-- Firebase Auth, which Supabase accepts as a third-party provider.
--
-- Identity: Firebase uids are not UUIDs, so auth.uid() cannot be used.
-- private.current_uid() returns the token subject only when the token was
-- issued for this Firebase project, and every policy is written against it.
-- Firebase tokens without a `role: authenticated` custom claim reach Postgres
-- as `anon`, so table grants cover both roles; rows stay owner-only because
-- a request with no matching Firebase token has no current_uid().
--
-- Ids of folders and documents mirror Firestore document ids while Firestore
-- remains the system of record, so they are text rather than uuid.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

create extension if not exists pg_trgm with schema extensions;

-- ── Identity ────────────────────────────────────────────────────────────────

create function private.current_uid()
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when (auth.jwt() ->> 'iss') = 'https://securetoken.google.com/document-vault-76520'
     and (auth.jwt() ->> 'aud') = 'document-vault-76520'
     and coalesce(auth.jwt() ->> 'sub', '') <> ''
    then auth.jwt() ->> 'sub'
  end
$$;

revoke all on function private.current_uid() from public;
grant execute on function private.current_uid() to anon, authenticated;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── Tables ──────────────────────────────────────────────────────────────────

create table public.profiles (
  id text primary key default private.current_uid()
    check (char_length(id) between 1 and 128),
  email text check (char_length(email) <= 320),
  display_name text check (char_length(display_name) <= 200),
  photo_url text check (char_length(photo_url) <= 2048),
  drive_folder_id text check (char_length(drive_folder_id) <= 256),
  drive_connected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.folders (
  id text primary key default gen_random_uuid()::text
    check (char_length(id) between 1 and 128),
  owner_id text not null default private.current_uid()
    references public.profiles (id) on delete cascade,
  parent_id text,
  name text not null check (char_length(name) between 1 and 255),
  drive_folder_id text not null check (char_length(drive_folder_id) between 1 and 256),
  is_favorite boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  check (parent_id is distinct from id),
  -- A parent must belong to the same owner; deleting it moves children to the root.
  foreign key (parent_id, owner_id) references public.folders (id, owner_id)
    on delete set null (parent_id)
);

create table public.documents (
  id text primary key default gen_random_uuid()::text
    check (char_length(id) between 1 and 128),
  owner_id text not null default private.current_uid()
    references public.profiles (id) on delete cascade,
  folder_id text,
  name text not null check (char_length(name) between 1 and 512),
  original_name text not null default '' check (char_length(original_name) <= 512),
  mime_type text not null default 'application/octet-stream' check (char_length(mime_type) <= 255),
  file_kind text not null default 'other' check (file_kind in (
    'pdf', 'image', 'word', 'spreadsheet', 'presentation', 'html', 'text', 'ebook',
    'audio', 'video', 'archive', 'shortcut', 'other'
  )),
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  category text not null default 'Other' check (char_length(category) <= 64),
  description text not null default '' check (char_length(description) <= 4000),
  drive_file_id text not null check (char_length(drive_file_id) between 1 and 256),
  drive_folder_id text check (char_length(drive_folder_id) <= 256),
  drive_web_view_link text check (char_length(drive_web_view_link) <= 2048),
  folder_path text not null default '' check (char_length(folder_path) <= 2048),
  is_favorite boolean not null default false,
  deleted_at timestamptz,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_viewed_at timestamptz,
  -- Names, description and category; extracted file text lives in document_contents.
  search_vector tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(original_name, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(category, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C')
  ) stored,
  unique (id, owner_id),
  foreign key (folder_id, owner_id) references public.folders (id, owner_id)
    on delete set null (folder_id)
);

create table public.document_contents (
  document_id text primary key,
  owner_id text not null default private.current_uid(),
  content text not null default '' check (char_length(content) <= 2000000),
  source text not null default 'extracted' check (source in ('extracted', 'ocr')),
  extractor_version integer not null default 1,
  indexed_at timestamptz not null default now(),
  -- to_tsvector input is capped so very large documents stay under the 1 MB tsvector limit.
  search_vector tsvector generated always as (
    to_tsvector('english', left(content, 400000))
  ) stored,
  foreign key (document_id, owner_id) references public.documents (id, owner_id) on delete cascade
);

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default private.current_uid()
    references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.collection_documents (
  collection_id uuid not null,
  document_id text not null,
  owner_id text not null default private.current_uid(),
  added_at timestamptz not null default now(),
  primary key (collection_id, document_id),
  foreign key (collection_id, owner_id) references public.collections (id, owner_id) on delete cascade,
  foreign key (document_id, owner_id) references public.documents (id, owner_id) on delete cascade
);

-- Append-only record of important changes, written by triggers.
create table public.audit_events (
  id bigint generated always as identity primary key,
  owner_id text not null,
  action text not null check (char_length(action) <= 64),
  entity_type text not null check (char_length(entity_type) <= 64),
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ── Indexes ─────────────────────────────────────────────────────────────────

create unique index collections_owner_name_key on public.collections (owner_id, lower(name));
create index folders_owner_parent_idx on public.folders (owner_id, parent_id);
create index documents_owner_folder_idx on public.documents (owner_id, folder_id);
create index documents_owner_uploaded_idx on public.documents (owner_id, uploaded_at desc);
create index documents_owner_drive_file_idx on public.documents (owner_id, drive_file_id);
create index document_contents_owner_idx on public.document_contents (owner_id);
create index collection_documents_document_idx on public.collection_documents (document_id, owner_id);
create index collection_documents_owner_idx on public.collection_documents (owner_id);
create index audit_events_owner_created_idx on public.audit_events (owner_id, created_at desc);

-- ── Triggers ────────────────────────────────────────────────────────────────

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger folders_set_updated_at before update on public.folders
  for each row execute function private.set_updated_at();
create trigger documents_set_updated_at before update on public.documents
  for each row execute function private.set_updated_at();
create trigger collections_set_updated_at before update on public.collections
  for each row execute function private.set_updated_at();

-- Runs as the caller, so the audit insert is itself subject to RLS.
create function private.audit_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  row_data jsonb := to_jsonb(coalesce(new, old));
  action_name text := lower(tg_op);
begin
  if tg_op = 'UPDATE' then
    if old.deleted_at is null and new.deleted_at is not null then
      action_name := 'trash';
    elsif old.deleted_at is not null and new.deleted_at is null then
      action_name := 'restore';
    elsif old.name is distinct from new.name then
      action_name := 'rename';
    else
      -- Favourites, view times and metadata refreshes are not audited.
      return new;
    end if;
  end if;

  insert into public.audit_events (owner_id, action, entity_type, entity_id, details)
  values (
    row_data ->> 'owner_id',
    action_name,
    tg_table_name,
    row_data ->> 'id',
    jsonb_build_object('name', row_data ->> 'name', 'drive_id', coalesce(row_data ->> 'drive_file_id', row_data ->> 'drive_folder_id'))
  );
  return coalesce(new, old);
end;
$$;

create trigger documents_audit after insert or update or delete on public.documents
  for each row execute function private.audit_change();
create trigger folders_audit after insert or update or delete on public.folders
  for each row execute function private.audit_change();

-- ── Row-level security ──────────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.folders enable row level security;
alter table public.documents enable row level security;
alter table public.document_contents enable row level security;
alter table public.collections enable row level security;
alter table public.collection_documents enable row level security;
alter table public.audit_events enable row level security;

create policy "Profiles: owner reads" on public.profiles for select to anon, authenticated
  using (id = (select private.current_uid()));
create policy "Profiles: owner creates" on public.profiles for insert to anon, authenticated
  with check (id = (select private.current_uid()));
create policy "Profiles: owner updates" on public.profiles for update to anon, authenticated
  using (id = (select private.current_uid()))
  with check (id = (select private.current_uid()));

create policy "Folders: owner reads" on public.folders for select to anon, authenticated
  using (owner_id = (select private.current_uid()));
create policy "Folders: owner creates" on public.folders for insert to anon, authenticated
  with check (owner_id = (select private.current_uid()));
create policy "Folders: owner updates" on public.folders for update to anon, authenticated
  using (owner_id = (select private.current_uid()))
  with check (owner_id = (select private.current_uid()));
create policy "Folders: owner deletes" on public.folders for delete to anon, authenticated
  using (owner_id = (select private.current_uid()));

create policy "Documents: owner reads" on public.documents for select to anon, authenticated
  using (owner_id = (select private.current_uid()));
create policy "Documents: owner creates" on public.documents for insert to anon, authenticated
  with check (owner_id = (select private.current_uid()));
create policy "Documents: owner updates" on public.documents for update to anon, authenticated
  using (owner_id = (select private.current_uid()))
  with check (owner_id = (select private.current_uid()));
create policy "Documents: owner deletes" on public.documents for delete to anon, authenticated
  using (owner_id = (select private.current_uid()));

create policy "Contents: owner reads" on public.document_contents for select to anon, authenticated
  using (owner_id = (select private.current_uid()));
create policy "Contents: owner creates" on public.document_contents for insert to anon, authenticated
  with check (owner_id = (select private.current_uid()));
create policy "Contents: owner updates" on public.document_contents for update to anon, authenticated
  using (owner_id = (select private.current_uid()))
  with check (owner_id = (select private.current_uid()));
create policy "Contents: owner deletes" on public.document_contents for delete to anon, authenticated
  using (owner_id = (select private.current_uid()));

create policy "Collections: owner reads" on public.collections for select to anon, authenticated
  using (owner_id = (select private.current_uid()));
create policy "Collections: owner creates" on public.collections for insert to anon, authenticated
  with check (owner_id = (select private.current_uid()));
create policy "Collections: owner updates" on public.collections for update to anon, authenticated
  using (owner_id = (select private.current_uid()))
  with check (owner_id = (select private.current_uid()));
create policy "Collections: owner deletes" on public.collections for delete to anon, authenticated
  using (owner_id = (select private.current_uid()));

create policy "Collection items: owner reads" on public.collection_documents for select to anon, authenticated
  using (owner_id = (select private.current_uid()));
create policy "Collection items: owner adds" on public.collection_documents for insert to anon, authenticated
  with check (owner_id = (select private.current_uid()));
create policy "Collection items: owner removes" on public.collection_documents for delete to anon, authenticated
  using (owner_id = (select private.current_uid()));

-- Audit events can be read and appended by their owner, never changed or removed.
create policy "Audit: owner reads" on public.audit_events for select to anon, authenticated
  using (owner_id = (select private.current_uid()));
create policy "Audit: owner appends" on public.audit_events for insert to anon, authenticated
  with check (owner_id = (select private.current_uid()));

-- ── Data API grants ─────────────────────────────────────────────────────────
-- New tables are not exposed automatically; grant only what the policies use.

revoke all on public.profiles, public.folders, public.documents, public.document_contents,
  public.collections, public.collection_documents, public.audit_events
  from anon, authenticated;

grant select, insert, update on public.profiles to anon, authenticated;
grant select, insert, update, delete on public.folders, public.documents, public.document_contents,
  public.collections to anon, authenticated;
grant select, insert, delete on public.collection_documents to anon, authenticated;
grant select, insert on public.audit_events to anon, authenticated;
