-- Additive only: nothing is dropped or rewritten.
--
-- 1. documents.drive_missing records that Google Drive no longer has a file.
--    The app keeps the record (instead of deleting it) and labels it.
-- 2. documents.tags holds the labels the user gave a file (lower-case, at
--    most 20, as the app and Firestore rules enforce).
-- 3. search_documents_page: the ranked search of search_documents with paging,
--    a total count, the folder path and the missing flag, so results can be
--    paged and never show a missing file as available. Words written as
--    "#tax" must match a tag exactly; other words also match tags. Same rules
--    as the in-app search. search_documents is left unchanged for existing
--    callers.

alter table public.documents
  add column if not exists drive_missing boolean not null default false;

alter table public.documents
  add column if not exists tags text[] not null default '{}'
    constraint documents_tags_limit check (cardinality(tags) <= 20 and char_length(array_to_string(tags, '')) <= 20 * 40);

create index if not exists documents_tags_idx on public.documents using gin (tags);

create function public.search_documents_page(
  search_query text,
  max_results integer default 20,
  result_offset integer default 0,
  include_trashed boolean default false
)
returns table (
  id text,
  name text,
  file_kind text,
  category text,
  folder_id text,
  folder_path text,
  drive_file_id text,
  size_bytes bigint,
  uploaded_at timestamptz,
  drive_missing boolean,
  rank real,
  matched_content boolean,
  snippet text,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with words as (
    select
      lower(btrim(search_query)) as raw,
      -- "#tag" words become exact tag filters; the rest is searched as usual.
      coalesce(array(
        select distinct substr(word, 2)
        from regexp_split_to_table(lower(btrim(search_query)), '\s+') as word
        where word ~ '^#.'
      ), '{}') as tag_filters,
      btrim(regexp_replace(lower(btrim(search_query)), '(^|\s)#\S+', ' ', 'g')) as text_part
  ),
  params as (
    select
      w.tag_filters,
      w.text_part = '' as tags_only,
      websearch_to_tsquery('simple', w.text_part) as simple_query,
      websearch_to_tsquery('english', w.text_part) as english_query,
      '%' || replace(replace(replace(w.text_part, '\', '\\'), '%', '\%'), '_', '\_') || '%' as like_pattern,
      w.text_part as needle
    from words w
    where char_length(w.raw) between 1 and 200
      and (w.text_part <> '' or cardinality(w.tag_filters) > 0)
  ),
  matches as (
    select
      d.id, d.name, d.file_kind, d.category, d.folder_id, d.folder_path, d.drive_file_id, d.size_bytes,
      d.uploaded_at, d.drive_missing,
      c.content,
      (not p.tags_only and c.search_vector @@ p.english_query) as matched_content,
      p.english_query,
      (case when p.tags_only then 0 else
        ts_rank(d.search_vector, p.simple_query) * 2
        + ts_rank(d.search_vector, p.english_query)
        + coalesce(ts_rank(c.search_vector, p.english_query), 0)
        + extensions.word_similarity(p.needle, d.name)
        + case when d.name ilike p.like_pattern then 0.5 else 0 end
        + case when p.needle = any(d.tags) then 1 when exists (select 1 from unnest(d.tags) t where t like p.like_pattern) then 0.5 else 0 end
      end)::real as rank,
      count(*) over () as total_count
    from public.documents d
    cross join params p
    left join public.document_contents c on c.document_id = d.id
    where (include_trashed or d.deleted_at is null)
      and d.tags @> p.tag_filters
      and (
        p.tags_only
        or d.search_vector @@ p.simple_query
        or d.search_vector @@ p.english_query
        or c.search_vector @@ p.english_query
        or d.name ilike p.like_pattern
        or p.needle operator(extensions.<%) d.name
        or exists (select 1 from unnest(d.tags) t where t like p.like_pattern)
      )
    order by rank desc, d.uploaded_at desc, d.id
    limit least(greatest(max_results, 1), 100)
    offset greatest(result_offset, 0)
  )
  select
    m.id, m.name, m.file_kind, m.category, m.folder_id, m.folder_path, m.drive_file_id, m.size_bytes,
    m.uploaded_at, m.drive_missing,
    m.rank,
    coalesce(m.matched_content, false),
    -- Only the page's rows are highlighted, so long documents cost little.
    case when m.matched_content then
      ts_headline('english', left(m.content, 100000), m.english_query,
        'StartSel=<<, StopSel=>>, MaxWords=30, MinWords=12, MaxFragments=2')
    end,
    m.total_count
  from matches m
  order by m.rank desc, m.uploaded_at desc, m.id
$$;

revoke all on function public.search_documents_page(text, integer, integer, boolean) from public;
grant execute on function public.search_documents_page(text, integer, integer, boolean) to anon, authenticated;
