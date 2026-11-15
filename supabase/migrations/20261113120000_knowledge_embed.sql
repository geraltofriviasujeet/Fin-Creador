-- Sprint 10.6b: two changes to Roma's knowledge base (owner decisions 2026-11-13).
--
-- 1. Question embeddings belong to a question. A signed-in person's call to the embed Edge
--    Function is allowed only inside their own open Roma question, the same pattern as
--    roma_search_begin: the question already passed the kill switch, the spend caps and the
--    daily limit (roma_begin_request), so embeddings can't be made outside Roma's limits.
--      * roma_knowledge_embed needs the caller's own roma_usage row, still 'reserved', and the
--        kill switch on. Each allowed call adds one to the row's knowledge_embeds; at most 3
--        per question (one knowledge_search per model round, with room for a retry). A refusal
--        writes nothing. Only a count is kept: no question text, no vector.
--      * The embed function calls it with the person's own access token (never a service key).
--        The owner's ingestion script uses the service role and does not call it.
--
-- 2. Link pending a publisher's permission. Some publishers (the Income Tax Department) need
--    prior permission for any link to their site. Until it is given, a FinCreador explainer
--    based on their material names them in plain text with no link, shown as "FinCreador
--    explainer, based on <publisher> material. Link pending the department's permission."
--      * link_permission_pending is true exactly when an own explainer has no read_more_url.
--        Every other rule of the attribution check is unchanged; an official document always
--        has its source_url and never a pending link.
--      * match_knowledge_chunks returns the flag so the app can show that line. Its return
--        type changes, so it is dropped and created again with the same body and grants.
--
-- New error codes: none (signed out is 42501; bad arguments are 22023).

-- ---------------------------------------------------------------------------
-- 1. Question embeddings
-- ---------------------------------------------------------------------------

alter table public.roma_usage
  add column knowledge_embeds integer not null default 0,
  add constraint roma_usage_knowledge_embeds check (knowledge_embeds between 0 and 3);

comment on column public.roma_usage.knowledge_embeds is
  'Question embeddings made for this question (knowledge_search, 10.6); written only by roma_knowledge_embed.';

-- true: one embedding allowed and counted. false: not the caller's own open question, the kill
-- switch is off, or the question has used its embeddings.
create function public.roma_knowledge_embed(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'Sign in to ask Roma' using errcode = '42501';
  end if;

  if not exists (select 1 from public.roma_settings as s where s.id and s.enabled) then
    return false;
  end if;

  -- One statement: the row lock makes two parallel calls count one at a time.
  update public.roma_usage as u
     set knowledge_embeds = u.knowledge_embeds + 1
   where u.id = p_request_id
     and u.user_id = v_user
     and u.status = 'reserved'
     and u.knowledge_embeds < 3;
  return found;
end;
$$;

revoke execute on function public.roma_knowledge_embed(uuid) from public, anon, service_role;
grant execute on function public.roma_knowledge_embed(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Link pending a publisher's permission
-- ---------------------------------------------------------------------------

alter table public.knowledge_documents
  add column link_permission_pending boolean not null default false;

comment on column public.knowledge_documents.link_permission_pending is
  'Own explainers only: true when the publisher needs prior permission for any link and it has not been given, so read_more_url is null and the publisher is named without a link.';

-- The attribution rule, as in 20261111120000, except that an own explainer's read_more_url may
-- be null when, and only when, link_permission_pending is true.
alter table public.knowledge_documents
  drop constraint knowledge_documents_attribution,
  add constraint knowledge_documents_attribution check (
    (content_kind = 'official'
      and publisher <> 'FinCreador'
      and source_url is not null
      and based_on_publisher is null
      and read_more_url is null
      and not link_permission_pending)
    or
    (content_kind = 'own'
      and publisher = 'FinCreador'
      and source_url is null
      and based_on_publisher is not null
      and based_on_publisher <> 'FinCreador'
      and (read_more_url is null) = link_permission_pending)
  );

drop function public.match_knowledge_chunks(extensions.vector, integer, real);

-- As in 20261111120000, plus link_permission_pending. The closest approved passages to a
-- question's embedding, with what a citation needs. At most 8 passages (a ceiling: the app
-- passes its own count, 4 to start, tuned by the evaluation set without a migration), each at
-- most 1,200 characters (the chunk limit), and only those at or above p_min_similarity (cosine
-- similarity, 0 to 1), so thin evidence comes back as no rows.
-- Refuses (42501) a signed-out caller and (22023) bad arguments.
create function public.match_knowledge_chunks(
  p_embedding      extensions.vector,
  p_count          integer,
  p_min_similarity real
)
returns table (
  chunk_id                uuid,
  document_slug           text,
  title                   text,
  content_kind            text,
  publisher               text,
  based_on_publisher      text,
  source_url              text,
  read_more_url           text,
  link_permission_pending boolean,
  published_on            date,
  verified_on             date,
  financial_year          text,
  content                 text,
  similarity              real
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
         d.link_permission_pending,
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
