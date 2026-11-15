-- Sprint 10.6: Roma's knowledge base. Approved documents, their chunks and embeddings, and one
-- search function. Shared reference content, not user data: no user_id, no client writes.
--
-- Rules (docs/sprint-plan.md, Sprint 10, step 10.6):
--   * Two kinds of document, never mixed up on screen:
--       official: the publisher's own text, ingested only where their terms permit reuse. Cited
--                 as "From <publisher>" with source_url.
--       own:      a FinCreador explainer in our own words. publisher is always 'FinCreador';
--                 based_on_publisher names whose material it draws on, and read_more_url links
--                 their page as "read more", never as the source of the wording. Shown as
--                 "FinCreador explainer, based on <based_on_publisher>".
--   * Every document records its reuse terms and the date they were checked, whatever its kind
--     (for an own explainer: why the official text could not be reused).
--   * financial_year ('2026-27') is set on every document whose figures depend on a year (tax
--     slabs, 80C and similar limits) and null on evergreen ones. The app compares it with the
--     person's current financial year and shows "may be out of date" when it is older.
--   * Statuses: draft (ingested, not searchable), approved (searchable), retired (kept, not
--     searchable). Only approved documents are ever returned.
--   * content_hash is the SHA-256 of the document's source file as ingested; the ingestion
--     script re-chunks and re-embeds a document only when it changes.
--   * Embeddings: Supabase's built-in gte-small (384 dimensions, normalised), made by an Edge
--     Function. A chunk is at most 1,200 characters (about 300 tokens; the model reads 512).
--   * Writes: only the ingestion script, with the service-role key held by the owner. Signed-in
--     people search through match_knowledge_chunks and read nothing else directly.
--   * Known and intended: a signed-in person can call match_knowledge_chunks directly and walk
--     the approved knowledge base a few passages at a time. It is shared reference content, not
--     user data, so this exposes nothing private; drafts and retired documents stay hidden.
--
-- New error codes: none (bad arguments are 22023; signed out is 42501).

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------

create table public.knowledge_documents (
  id                     uuid primary key default gen_random_uuid(),
  -- Stable key from the source file name; the evaluation set refers to documents by slug.
  slug                   text not null unique,
  title                  text not null,
  content_kind           text not null,
  publisher              text not null,
  -- official: the page the text was taken from. own: null.
  source_url             text,
  -- own only: whose material the explainer is based on, and their page to read more.
  based_on_publisher     text,
  read_more_url          text,
  reuse_terms            text not null,
  reuse_terms_url        text,
  reuse_terms_checked_on date not null,
  -- The date on the publisher's page or document (official), or when we wrote it (own). Null
  -- when an official page carries no date; the app then shows verified_on as "checked on".
  published_on           date,
  -- When the content was last checked against its source.
  verified_on            date not null,
  financial_year         text,
  status                 text not null default 'draft',
  approved_at            timestamptz,
  content_hash           text not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint knowledge_documents_slug check (
    char_length(slug) <= 80 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  constraint knowledge_documents_title check (char_length(title) between 1 and 200),
  constraint knowledge_documents_kind check (content_kind in ('official', 'own')),
  constraint knowledge_documents_publisher check (char_length(publisher) between 1 and 100),
  constraint knowledge_documents_based_on check (
    based_on_publisher is null or char_length(based_on_publisher) between 1 and 100
  ),
  constraint knowledge_documents_urls check (
    (source_url is null or (char_length(source_url) <= 500 and source_url ~ '^https://'))
    and (read_more_url is null or (char_length(read_more_url) <= 500 and read_more_url ~ '^https://'))
    and (reuse_terms_url is null or (char_length(reuse_terms_url) <= 500 and reuse_terms_url ~ '^https://'))
  ),
  -- The attribution rule: an official document is the publisher's own text from source_url; an
  -- own explainer is FinCreador's, with the official publisher only as "based on".
  constraint knowledge_documents_attribution check (
    (content_kind = 'official'
      and publisher <> 'FinCreador'
      and source_url is not null
      and based_on_publisher is null
      and read_more_url is null)
    or
    (content_kind = 'own'
      and publisher = 'FinCreador'
      and source_url is null
      and based_on_publisher is not null
      and based_on_publisher <> 'FinCreador'
      and read_more_url is not null)
  ),
  constraint knowledge_documents_reuse_terms check (char_length(reuse_terms) between 1 and 500),
  -- 'YYYY-YY', the second year following the first ('2026-27', '2099-00').
  constraint knowledge_documents_financial_year check (
    financial_year is null
    or (financial_year ~ '^[0-9]{4}-[0-9]{2}$'
        and substr(financial_year, 6, 2)::integer = (substr(financial_year, 1, 4)::integer + 1) % 100)
  ),
  constraint knowledge_documents_status check (status in ('draft', 'approved', 'retired')),
  constraint knowledge_documents_approved check (status <> 'approved' or approved_at is not null),
  constraint knowledge_documents_hash check (content_hash ~ '^[0-9a-f]{64}$')
);

create trigger knowledge_documents_set_updated_at
  before update on public.knowledge_documents
  for each row execute function public.set_updated_at();

comment on table public.knowledge_documents is
  'Roma knowledge base documents (shared, not user data). Official text where reuse is permitted, otherwise FinCreador explainers. Written only by the ingestion script (service role).';

-- ---------------------------------------------------------------------------
-- Chunks
-- ---------------------------------------------------------------------------

create table public.knowledge_chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.knowledge_documents (id) on delete cascade,
  seq         integer not null,
  content     text not null,
  embedding   extensions.vector(384) not null,
  created_at  timestamptz not null default now(),

  constraint knowledge_chunks_seq unique (document_id, seq),
  constraint knowledge_chunks_seq_range check (seq between 1 and 200),
  constraint knowledge_chunks_content check (char_length(content) between 1 and 1200)
);

create index knowledge_chunks_embedding_idx on public.knowledge_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

comment on table public.knowledge_chunks is
  'Passages of knowledge_documents with their gte-small embeddings. Replaced as a set when the document''s content_hash changes.';

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

revoke all on table public.knowledge_documents, public.knowledge_chunks from anon, authenticated, service_role;

grant select, insert, update, delete on table public.knowledge_documents, public.knowledge_chunks to service_role;

-- No policies: nobody but the service role (which bypasses RLS) reads or writes the tables.
alter table public.knowledge_documents enable row level security;
alter table public.knowledge_chunks enable row level security;

-- ---------------------------------------------------------------------------
-- Search
-- ---------------------------------------------------------------------------

-- The closest approved passages to a question's embedding, with what a citation needs. At most
-- 8 passages (a ceiling: the app passes its own count, 4 to start, tuned by the evaluation set
-- without a migration), each at most 1,200 characters (the chunk limit), and only those at or above
-- p_min_similarity (cosine similarity, 0 to 1), so thin evidence comes back as no rows.
-- Refuses (42501) a signed-out caller and (22023) bad arguments.
create function public.match_knowledge_chunks(
  p_embedding      extensions.vector,
  p_count          integer,
  p_min_similarity real
)
returns table (
  chunk_id           uuid,
  document_slug      text,
  title              text,
  content_kind       text,
  publisher          text,
  based_on_publisher text,
  source_url         text,
  read_more_url      text,
  published_on       date,
  verified_on        date,
  financial_year     text,
  content            text,
  similarity         real
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  -- A function argument's vector(384) is not enforced, so the dimension is checked here.
  if p_embedding is null or extensions.vector_dims(p_embedding) <> 384 then
    raise exception 'Invalid knowledge search' using errcode = '22023';
  end if;
  if p_count is null or p_count < 1 or p_count > 8
     or p_min_similarity is null or p_min_similarity < 0 or p_min_similarity > 1 then
    raise exception 'Invalid knowledge search' using errcode = '22023';
  end if;

  return query
  select c.id,
         d.slug,
         d.title,
         d.content_kind,
         d.publisher,
         d.based_on_publisher,
         d.source_url,
         d.read_more_url,
         d.published_on,
         d.verified_on,
         d.financial_year,
         c.content,
         (1 - (c.embedding operator(extensions.<=>) p_embedding))::real
    from public.knowledge_chunks c
    join public.knowledge_documents d on d.id = c.document_id
   where d.status = 'approved'
     and 1 - (c.embedding operator(extensions.<=>) p_embedding) >= p_min_similarity
   order by c.embedding operator(extensions.<=>) p_embedding
   limit p_count;
end;
$$;

revoke execute on function public.match_knowledge_chunks(extensions.vector, integer, real) from public, anon, service_role;
grant execute on function public.match_knowledge_chunks(extensions.vector, integer, real) to authenticated;
