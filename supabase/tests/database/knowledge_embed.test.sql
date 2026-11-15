-- pgTAP tests for migration 20261113120000. Question embeddings: roma_knowledge_embed allows at
-- most 3 per question, only on the caller's own open question, only with the kill switch on,
-- and writes nothing on a refusal. Link pending: an own explainer may have no read_more_url
-- exactly when link_permission_pending is true, never an official document, and the search
-- returns the flag. Run with `supabase test db` (CI). Everything is rolled back. Fictional
-- users and content only.
begin;
create extension if not exists pgtap with schema extensions;

select plan(21);

insert into auth.users (id, email) values
  ('a6000000-0000-4000-8000-00000000000a', 'meera@example.test'),
  ('b6000000-0000-4000-8000-00000000000b', 'kabir@example.test');
update public.profiles set roma_enabled = true
 where id in ('a6000000-0000-4000-8000-00000000000a', 'b6000000-0000-4000-8000-00000000000b');
update public.roma_settings set enabled = true, user_daily_requests = 50;

-- ------------------------------------------------------------ link pending (1-8)
-- Test-only: a valid own explainer with some fields changed; returns its id.
create function public.t_doc(p_changes jsonb default '{}')
returns uuid language sql set search_path = ''
  as $$ insert into public.knowledge_documents
        select * from pg_catalog.jsonb_populate_record(null::public.knowledge_documents,
          pg_catalog.jsonb_build_object(
            'id', pg_catalog.gen_random_uuid(),
            'slug', 'test-doc',
            'title', 'Test document',
            'content_kind', 'own',
            'publisher', 'FinCreador',
            'based_on_publisher', 'Example Department',
            'read_more_url', 'https://example.org/read-more',
            'link_permission_pending', false,
            'reuse_terms', 'Reuse needs permission.',
            'reuse_terms_checked_on', '2026-11-13',
            'verified_on', '2026-11-13',
            'status', 'draft',
            'content_hash', pg_catalog.repeat('a', 64),
            'created_at', pg_catalog.now(),
            'updated_at', pg_catalog.now()) || p_changes)
        returning id $$;

select col_default_is('public', 'knowledge_documents', 'link_permission_pending', 'false',
  'documents default to no pending link');
select lives_ok($$ select public.t_doc('{"slug": "pending-ok", "read_more_url": null, "link_permission_pending": true}') $$,
  'an own explainer with no link and the pending flag is accepted');
select lives_ok($$ select public.t_doc('{"slug": "linked-ok"}') $$,
  'an own explainer with a link and no flag is still accepted');
select throws_ok($$ select public.t_doc('{"slug": "y1", "read_more_url": null}') $$,
  '23514', null, 'an own explainer with no link needs the pending flag');
select throws_ok($$ select public.t_doc('{"slug": "y2", "link_permission_pending": true}') $$,
  '23514', null, 'the pending flag is refused when a link is there');
select throws_ok($$ select public.t_doc('{"slug": "y3", "content_kind": "official", "publisher": "Example Department",
                                          "based_on_publisher": null, "read_more_url": null,
                                          "source_url": "https://example.org/source", "link_permission_pending": true}') $$,
  '23514', null, 'an official document can never have a pending link');
select throws_ok($$ select public.t_doc('{"slug": "y4", "content_kind": "official", "publisher": "Example Department",
                                          "based_on_publisher": null, "read_more_url": null, "source_url": null,
                                          "link_permission_pending": true}') $$,
  '23514', null, 'an official document still needs its source_url');

-- An approved pending explainer, with one passage along dimension 1.
update public.knowledge_documents set status = 'approved', approved_at = now() where slug = 'pending-ok';
insert into public.knowledge_chunks (document_id, seq, content, embedding)
select d.id, 1, 'Passage.',
       ('[1' || pg_catalog.repeat(',0', 383) || ']')::extensions.vector
  from public.knowledge_documents d where d.slug = 'pending-ok';

select ok(
  has_function_privilege('authenticated', 'public.roma_knowledge_embed(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.roma_knowledge_embed(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.roma_knowledge_embed(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.roma_knowledge_embed(uuid)', 'EXECUTE'),
  'signed-in users only');

create table public.t_log (name text primary key, request_id uuid);
grant select, insert on table public.t_log to authenticated;
create function public.t_question(p_name text) returns text language sql set search_path = ''
  as $$ insert into public.t_log (name, request_id)
        select p_name, b.request_id from public.roma_begin_request('anthropic', 'claude-haiku-5-5') as b
        returning name $$;
create function public.t_id(p_name text) returns uuid language sql stable set search_path = ''
  as $$ select l.request_id from public.t_log as l where l.name = p_name $$;
grant execute on function public.t_question(text), public.t_id(text) to authenticated;

select set_config('request.jwt.claims', '{"sub": "a6000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;

select is(
  (select array[document_slug, coalesce(read_more_url, '-'), link_permission_pending::text]
     from public.match_knowledge_chunks(('[1' || pg_catalog.repeat(',0', 383) || ']')::extensions.vector, 4, 0.5)),
  array['pending-ok', '-', 'true'],
  'the search returns the pending flag with no link');

select public.t_question('q1');
select ok(public.roma_knowledge_embed(public.t_id('q1')), 'own open question: first embedding allowed');
select ok(public.roma_knowledge_embed(public.t_id('q1')), 'second allowed');
select ok(public.roma_knowledge_embed(public.t_id('q1')), 'third allowed');
select ok(not public.roma_knowledge_embed(public.t_id('q1')), 'a fourth in the same question is refused');
select ok(not public.roma_knowledge_embed('c6000000-0000-4000-8000-00000000000c'), 'an unknown question is refused');

select public.t_question('q2');
select ok(public.roma_release_request(public.t_id('q2')), 'q2 released');
select ok(not public.roma_knowledge_embed(public.t_id('q2')), 'an ended question is refused');

select public.t_question('q3');

-- Kabir cannot use Meera's question.
select set_config('request.jwt.claims', '{"sub": "b6000000-0000-4000-8000-00000000000b", "role": "authenticated"}', true);
select ok(not public.roma_knowledge_embed(public.t_id('q3')), 'another person''s question is refused');

reset role;
update public.roma_settings set enabled = false;
select set_config('request.jwt.claims', '{"sub": "a6000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;
select ok(not public.roma_knowledge_embed(public.t_id('q3')), 'kill switch off: refused');

reset role;
select is((select knowledge_embeds from public.roma_usage where id = public.t_id('q1')), 3, 'q1 counted 3');
select is((select knowledge_embeds from public.roma_usage where id = public.t_id('q3')), 0, 'refusals wrote nothing');

select set_config('request.jwt.claims', '', true);
set local role authenticated;
select throws_ok(
  $$ select public.roma_knowledge_embed('c6000000-0000-4000-8000-00000000000c') $$,
  '42501', 'Sign in to ask Roma', 'signed out: refused');

select * from finish();
rollback;
