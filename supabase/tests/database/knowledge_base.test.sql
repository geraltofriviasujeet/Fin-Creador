-- pgTAP tests for Roma's knowledge base (migration 20261111120000).
-- Run with `supabase test db` (CI). Everything is rolled back. Fictional content only.
begin;
create extension if not exists pgtap with schema extensions;

select plan(46);

-- Test-only: a valid official document with some fields changed; returns its id.
create function public.t_doc(p_changes jsonb default '{}')
returns uuid language sql set search_path = ''
  as $$ insert into public.knowledge_documents
        select * from pg_catalog.jsonb_populate_record(null::public.knowledge_documents,
          pg_catalog.jsonb_build_object(
            'id', pg_catalog.gen_random_uuid(),
            'slug', 'test-doc',
            'title', 'Test document',
            'content_kind', 'official',
            'publisher', 'Example Regulator',
            'source_url', 'https://example.org/source',
            'reuse_terms', 'Reuse permitted with attribution.',
            'reuse_terms_url', 'https://example.org/terms',
            'reuse_terms_checked_on', '2026-11-10',
            'published_on', '2026-04-01',
            'verified_on', '2026-11-10',
            'status', 'draft',
            'content_hash', pg_catalog.repeat('a', 64),
            'created_at', pg_catalog.now(),
            'updated_at', pg_catalog.now()) || p_changes)
        returning id $$;

-- The changes that make the test document a FinCreador explainer.
create function public.t_own(p_changes jsonb default '{}')
returns jsonb language sql immutable set search_path = ''
  as $$ select '{"content_kind": "own", "publisher": "FinCreador", "source_url": null,
                 "based_on_publisher": "Example Regulator",
                 "read_more_url": "https://example.org/read-more"}'::jsonb || p_changes $$;

-- Test-only: the unit vector along dimension i (orthogonal for different i).
create function public.t_vec(i integer, dims integer default 384)
returns extensions.vector language sql immutable set search_path = ''
  as $$ select ('[' || pg_catalog.array_to_string(
                 array(select case when g = i then 1 else 0 end from pg_catalog.generate_series(1, dims) g), ',')
               || ']')::extensions.vector $$;
grant execute on function public.t_vec(integer, integer) to authenticated, anon;

-- ------------------------------------------------------------ privileges (1-5)
select ok(
  not exists (
    select 1 from unnest(array['public.knowledge_documents', 'public.knowledge_chunks']) as t(tbl),
                  unnest(array['anon', 'authenticated']) as r(role),
                  unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p(priv)
     where has_table_privilege(r.role, t.tbl, p.priv)),
  'anon and signed-in users have no direct access to the knowledge tables');
select ok(
  not exists (
    select 1 from unnest(array['public.knowledge_documents', 'public.knowledge_chunks']) as t(tbl),
                  unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p(priv)
     where not has_table_privilege('service_role', t.tbl, p.priv)),
  'the service role (ingestion script) may read and write both tables');
select ok(
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.knowledge_documents'::regclass, 'public.knowledge_chunks'::regclass)),
  'RLS is enabled on both tables');
select ok(
  has_function_privilege('authenticated', 'public.match_knowledge_chunks(extensions.vector, integer, real)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.match_knowledge_chunks(extensions.vector, integer, real)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.match_knowledge_chunks(extensions.vector, integer, real)', 'EXECUTE'),
  'match_knowledge_chunks: signed-in users only');
select has_trigger('public', 'knowledge_documents', 'knowledge_documents_set_updated_at',
  'documents keep updated_at current');

-- ------------------------------------------------------------ attribution (6-14)
select lives_ok($$ select public.t_doc('{"slug": "ok-official"}') $$, 'an official document is accepted');
select lives_ok($$ select public.t_doc(public.t_own('{"slug": "ok-own"}')) $$, 'a FinCreador explainer is accepted');
select throws_ok($$ select public.t_doc(public.t_own('{"slug": "x1", "publisher": "Example Regulator"}')) $$,
  '23514', null, 'an explainer cannot carry an official publisher');
select throws_ok($$ select public.t_doc('{"slug": "x2", "publisher": "FinCreador"}') $$,
  '23514', null, 'official text cannot be published as FinCreador');
select throws_ok($$ select public.t_doc('{"slug": "x3", "source_url": null}') $$,
  '23514', null, 'official text needs the page it came from');
select throws_ok($$ select public.t_doc('{"slug": "x4", "read_more_url": "https://example.org/more"}') $$,
  '23514', null, 'official text has no "read more" link');
select throws_ok($$ select public.t_doc(public.t_own('{"slug": "x5", "based_on_publisher": null}')) $$,
  '23514', null, 'an explainer names whose material it is based on');
select throws_ok($$ select public.t_doc(public.t_own('{"slug": "x6", "source_url": "https://example.org/source"}')) $$,
  '23514', null, 'an explainer has no source of wording');
select throws_ok($$ select public.t_doc(public.t_own('{"slug": "x7", "based_on_publisher": "FinCreador"}')) $$,
  '23514', null, 'an explainer is not based on FinCreador itself');

-- ------------------------------------------------------------ other document rules (15-26)
select lives_ok($$ select public.t_doc('{"slug": "fy-ok", "financial_year": "2026-27"}') $$, 'financial year 2026-27 is accepted');
select lives_ok($$ select public.t_doc('{"slug": "fy-century", "financial_year": "2099-00"}') $$, 'financial year 2099-00 is accepted');
select throws_ok($$ select public.t_doc('{"slug": "x8", "financial_year": "2026-28"}') $$,
  '23514', null, 'a financial year spans consecutive years');
select throws_ok($$ select public.t_doc('{"slug": "x9", "financial_year": "26-27"}') $$,
  '23514', null, 'a financial year is written YYYY-YY');
select throws_ok($$ select public.t_doc('{"slug": "x10", "status": "approved"}') $$,
  '23514', null, 'an approved document records when it was approved');
select throws_ok($$ select public.t_doc('{"slug": "x11", "status": "published"}') $$,
  '23514', null, 'status is draft, approved or retired');
select throws_ok($$ select public.t_doc('{"slug": "x12", "content_hash": "abc"}') $$,
  '23514', null, 'content_hash is a SHA-256 in hex');
select throws_ok($$ select public.t_doc('{"slug": "x13", "source_url": "http://example.org/source"}') $$,
  '23514', null, 'URLs are https');
select throws_ok($$ select public.t_doc('{"slug": "Not A Slug"}') $$,
  '23514', null, 'slugs are lowercase words joined by hyphens');
select throws_ok($$ select public.t_doc('{"slug": "ok-official"}') $$,
  '23505', null, 'slugs are unique');
select throws_ok($$ select public.t_doc('{"slug": "x14", "reuse_terms_checked_on": null}') $$,
  '23502', null, 'every document records when its reuse terms were checked');
select throws_ok($$ select public.t_doc('{"slug": "x15", "reuse_terms": ""}') $$,
  '23514', null, 'every document records its reuse terms');

-- ------------------------------------------------------------ chunks (27-30)
create table public.t_ids (name text primary key, id uuid);
insert into public.t_ids values ('chunky', public.t_doc('{"slug": "chunky"}'));

select throws_ok($$ insert into public.knowledge_chunks (document_id, seq, content, embedding)
                    select id, 1, repeat('x', 1201), public.t_vec(1) from public.t_ids where name = 'chunky' $$,
  '23514', null, 'a chunk is at most 1,200 characters');
select throws_ok($$ insert into public.knowledge_chunks (document_id, seq, content, embedding)
                    select id, 1, 'text', public.t_vec(1, 3) from public.t_ids where name = 'chunky' $$,
  '22000', null, 'an embedding has 384 dimensions');
insert into public.knowledge_chunks (document_id, seq, content, embedding)
  select id, 1, 'text', public.t_vec(1) from public.t_ids where name = 'chunky';
select throws_ok($$ insert into public.knowledge_chunks (document_id, seq, content, embedding)
                    select id, 1, 'again', public.t_vec(2) from public.t_ids where name = 'chunky' $$,
  '23505', null, 'one chunk per sequence number in a document');
delete from public.knowledge_documents where slug = 'chunky';
select is((select count(*)::int from public.knowledge_chunks c join public.t_ids t on t.id = c.document_id),
  0, 'deleting a document deletes its chunks');

-- ------------------------------------------------------------ search fixtures
-- Approved official (two chunks), approved explainer, a draft and a retired document whose
-- chunks match the question exactly and must never come back.
insert into public.t_ids values
  ('official', public.t_doc('{"slug": "s-official", "title": "Official guide", "financial_year": "2026-27",
                              "status": "approved", "approved_at": "2026-11-10T00:00:00Z"}')),
  ('own', public.t_doc(public.t_own('{"slug": "s-own", "title": "Our explainer",
                              "status": "approved", "approved_at": "2026-11-10T00:00:00Z"}'))),
  ('draft', public.t_doc('{"slug": "s-draft"}')),
  ('retired', public.t_doc('{"slug": "s-retired", "status": "retired", "approved_at": "2026-11-10T00:00:00Z"}'));
insert into public.knowledge_chunks (document_id, seq, content, embedding)
select t.id, v.seq, v.content, public.t_vec(v.dim)
  from public.t_ids t
  join (values ('official', 1, 'Official passage one.', 1),
               ('official', 2, 'Official passage two.', 2),
               ('own', 1, 'Explainer passage.', 3),
               ('draft', 1, 'Draft passage.', 1),
               ('retired', 1, 'Retired passage.', 1)) as v(name, seq, content, dim) on v.name = t.name;

grant select on table public.t_ids to authenticated;

-- ------------------------------------------------------------ search (31-46)
select set_config('request.jwt.claims', '{"sub": "a3000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;

select is(
  (select array_agg(document_slug || '#' || content order by similarity desc, document_slug)
     from public.match_knowledge_chunks(public.t_vec(1), 8, 0)),
  array['s-official#Official passage one.', 's-official#Official passage two.', 's-own#Explainer passage.'],
  'only approved documents are searched; drafts and retired ones never come back');
select is(
  (select array[document_slug, similarity::text] from public.match_knowledge_chunks(public.t_vec(1), 4, 0) limit 1),
  array['s-official', '1'],
  'the closest passage comes first with its cosine similarity');
select is(
  (select array[title, content_kind, publisher, source_url, coalesce(based_on_publisher, '-'),
                coalesce(read_more_url, '-'), published_on::text, verified_on::text, financial_year]
     from public.match_knowledge_chunks(public.t_vec(1), 1, 0.5)),
  array['Official guide', 'official', 'Example Regulator', 'https://example.org/source', '-', '-',
        '2026-04-01', '2026-11-10', '2026-27'],
  'an official passage carries its publisher, source, dates and financial year');
select is(
  (select array[title, content_kind, publisher, coalesce(source_url, '-'), based_on_publisher,
                read_more_url, coalesce(financial_year, '-')]
     from public.match_knowledge_chunks(public.t_vec(3), 1, 0.5)),
  array['Our explainer', 'own', 'FinCreador', '-', 'Example Regulator',
        'https://example.org/read-more', '-'],
  'an explainer carries FinCreador as publisher and the official page only as read more');
select is((select count(*)::int from public.match_knowledge_chunks(public.t_vec(1), 8, 0.5)), 1,
  'passages below the similarity threshold are left out');
select is((select count(*)::int from public.match_knowledge_chunks(public.t_vec(5), 8, 0.5)), 0,
  'thin evidence returns no passages');
select is((select count(*)::int from public.match_knowledge_chunks(public.t_vec(1), 2, 0)), 2,
  'the count caps the passages returned');
select throws_ok($$ select * from public.match_knowledge_chunks(public.t_vec(1), 9, 0) $$,
  '22023', null, 'at most 8 passages');
select throws_ok($$ select * from public.match_knowledge_chunks(public.t_vec(1), 0, 0) $$,
  '22023', null, 'at least 1 passage');
select throws_ok($$ select * from public.match_knowledge_chunks(public.t_vec(1), 4, 1.5) $$,
  '22023', null, 'the threshold is at most 1');
select throws_ok($$ select * from public.match_knowledge_chunks(public.t_vec(1), 4, -0.1) $$,
  '22023', null, 'the threshold is at least 0');
select throws_ok($$ select * from public.match_knowledge_chunks(public.t_vec(1, 3), 4, 0) $$,
  '22023', null, 'the question embedding has 384 dimensions');
select throws_ok($$ select * from public.match_knowledge_chunks(null, 4, 0) $$,
  '22023', null, 'the question embedding is required');
select throws_ok($$ select count(*) from public.knowledge_chunks $$,
  '42501', null, 'signed-in users cannot read the chunks directly');

select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select throws_ok($$ select * from public.match_knowledge_chunks(public.t_vec(1), 4, 0) $$,
  '42501', null, 'no caller identity, no search');

reset role;
set local role anon;
select throws_ok($$ select * from public.match_knowledge_chunks(public.t_vec(1), 4, 0) $$,
  '42501', null, 'anon cannot search');

reset role;
select * from finish();
rollback;
