-- Ranked search over document names, metadata and extracted content.
--
-- Exact words use full-text search ('simple' for names so codes and proper
-- nouns are not stemmed, 'english' for prose). Partial and misspelled names
-- fall back to trigram matching. The function runs as the caller, so RLS
-- limits results to the caller's own documents.

create index documents_search_idx on public.documents using gin (search_vector);
create index document_contents_search_idx on public.document_contents using gin (search_vector);
create index documents_name_trgm_idx on public.documents using gin (name extensions.gin_trgm_ops);

create function public.search_documents(
  search_query text,
  max_results integer default 50,
  include_trashed boolean default false
)
returns table (
  id text,
  name text,
  file_kind text,
  category text,
  folder_id text,
  drive_file_id text,
  size_bytes bigint,
  uploaded_at timestamptz,
  rank real,
  matched_content boolean,
  snippet text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select
      websearch_to_tsquery('simple', search_query) as simple_query,
      websearch_to_tsquery('english', search_query) as english_query,
      '%' || replace(replace(replace(lower(btrim(search_query)), '\', '\\'), '%', '\%'), '_', '\_') || '%' as like_pattern,
      lower(btrim(search_query)) as needle
  ),
  matches as (
    select
      d.id, d.name, d.file_kind, d.category, d.folder_id, d.drive_file_id, d.size_bytes, d.uploaded_at,
      c.content,
      (c.search_vector @@ p.english_query) as matched_content,
      p.english_query,
      (
        ts_rank(d.search_vector, p.simple_query) * 2
        + ts_rank(d.search_vector, p.english_query)
        + coalesce(ts_rank(c.search_vector, p.english_query), 0)
        + extensions.word_similarity(p.needle, d.name)
        + case when d.name ilike p.like_pattern then 0.5 else 0 end
      )::real as rank
    from public.documents d
    cross join params p
    left join public.document_contents c on c.document_id = d.id
    where char_length(btrim(search_query)) between 1 and 200
      and (include_trashed or d.deleted_at is null)
      and (
        d.search_vector @@ p.simple_query
        or d.search_vector @@ p.english_query
        or c.search_vector @@ p.english_query
        or d.name ilike p.like_pattern
        or p.needle operator(extensions.<%) d.name
      )
    order by rank desc, d.uploaded_at desc
    limit least(greatest(max_results, 1), 200)
  )
  select
    m.id, m.name, m.file_kind, m.category, m.folder_id, m.drive_file_id, m.size_bytes, m.uploaded_at,
    m.rank,
    coalesce(m.matched_content, false),
    case when m.matched_content then
      ts_headline('english', left(m.content, 100000), m.english_query,
        'StartSel=<<, StopSel=>>, MaxWords=30, MinWords=12, MaxFragments=2')
    end
  from matches m
  order by m.rank desc, m.uploaded_at desc
$$;

revoke all on function public.search_documents(text, integer, boolean) from public;
grant execute on function public.search_documents(text, integer, boolean) to anon, authenticated;
