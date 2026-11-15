-- Sprint 10.6d (item 6): a knowledge answer's citations and a tax estimate's card are kept on
-- their turn, so a reopened conversation shows them as they were shown.
--
-- Rules:
--   * ai_messages.citations: the citations shown under the answer, built in code from approved
--     passages (number, title, source label, an allowed https link, the link-pending flag, the
--     financial year, the cited passages' text); null when none were shown.
--   * ai_messages.tax: the tax card, built in code from packages/domain; null otherwise.
--   * Neither stores "out of date": it is worked out again from the year when the turn is shown.
--   * The checks fail closed: each is wrapped so a condition that can't be evaluated (a missing
--     key, a jsonpath error in silent mode) counts as a failure, never as a pass. Like
--     ai_messages.plan: type, size, keys from a fixed list, and no key at any depth naming an
--     account, IBAN, IFSC, card number or balance (the plan check's own pattern). The app also
--     checks the full shape with Zod before writing and again before showing a stored turn.
--   * Written only by roma_record_turn: two new arguments, default null, so a call with the
--     nine arguments of 20261107180000_roma_plans.sql still works. Its body is unchanged except
--     for the two columns. RLS and grants on the table are unchanged.

alter table public.ai_messages
  add column citations jsonb,
  add column tax jsonb,
  add constraint ai_messages_citations_size check (citations is null or octet_length(citations::text) <= 32768),
  add constraint ai_messages_citations_shape check (
    citations is null
    or coalesce(
      case when pg_catalog.jsonb_typeof(citations) = 'array' then
        pg_catalog.jsonb_array_length(citations) between 1 and 12
        -- Every element: an object with n a number, title and source strings, and passages an
        -- array of 1 to 4. Strict mode: a missing key is an error, so that element is not
        -- counted and the counts differ.
        and pg_catalog.jsonb_array_length(pg_catalog.jsonb_path_query_array(
              citations,
              'strict $[*] ? (@.type() == "object" && @.n.type() == "number" && @.title.type() == "string" && @.source.type() == "string" && @.passages.type() == "array" && @.passages.size() >= 1 && @.passages.size() <= 4)',
              '{}'::jsonb,
              true))
            = pg_catalog.jsonb_array_length(citations)
        -- Keys from a fixed list only.
        and not coalesce(pg_catalog.jsonb_path_exists(
              citations,
              'strict $[*].keyvalue() ? (!(@.key like_regex "^(n|title|source|url|linkPending|financialYear|passages)$"))',
              '{}'::jsonb,
              true), true)
        -- A url, where present, is null or an https string: every url value is counted, and
        -- only those that pass are counted again.
        and pg_catalog.jsonb_array_length(pg_catalog.jsonb_path_query_array(
              citations, 'strict $[*].keyvalue() ? (@.key == "url")', '{}'::jsonb, true))
            = pg_catalog.jsonb_array_length(pg_catalog.jsonb_path_query_array(
              citations,
              'strict $[*].keyvalue() ? (@.key == "url" && (@.value == null || (@.value.type() == "string" && @.value starts with "https://")))',
              '{}'::jsonb,
              true))
        -- No key at any depth names an account, account number, IBAN, IFSC, card number or balance.
        and not coalesce(pg_catalog.jsonb_path_exists(
              citations,
              'strict $.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "account|account_no|iban|ifsc|card_number|balance" flag "i")',
              '{}'::jsonb,
              true), true)
      else false end,
      false)
  ),
  add constraint ai_messages_tax_size check (tax is null or octet_length(tax::text) <= 16384),
  add constraint ai_messages_tax_shape check (
    tax is null
    or coalesce(
      case when pg_catalog.jsonb_typeof(tax) = 'object' then
        tax ?& array['taxYear', 'regimes', 'comparison', 'assumptions']
        -- Top-level keys from a fixed list only.
        and tax - array['taxYear', 'regimes', 'comparison', 'assumptions', 'sources'] = '{}'::jsonb
        and pg_catalog.jsonb_typeof(tax -> 'taxYear') = 'string'
        and (tax ->> 'taxYear') ~ '^[0-9]{4}-[0-9]{2}$'
        and case when pg_catalog.jsonb_typeof(tax -> 'regimes') = 'array'
              then pg_catalog.jsonb_array_length(tax -> 'regimes') between 1 and 2
              else false end
        and pg_catalog.jsonb_typeof(tax -> 'comparison') = 'string'
        and pg_catalog.jsonb_typeof(tax -> 'assumptions') = 'array'
        and (not tax ? 'sources' or pg_catalog.jsonb_typeof(tax -> 'sources') = 'array')
        -- No key at any depth names an account, account number, IBAN, IFSC, card number or balance.
        and not coalesce(pg_catalog.jsonb_path_exists(
              tax,
              'strict $.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "account|account_no|iban|ifsc|card_number|balance" flag "i")',
              '{}'::jsonb,
              true), true)
      else false end,
      false)
  );

comment on column public.ai_messages.citations is
  'Roma 10.6d: the knowledge base citations shown under this answer (approved passages, built in code), for reopening from history; null when none.';
comment on column public.ai_messages.tax is
  'Roma 10.6d: the tax estimate card shown with this answer (built in code), for reopening from history; null otherwise. The out-of-date notice is not stored.';
comment on table public.ai_messages is
  'Roma turns (owner-only): question, answer, as-of date, periods, tool names and, where shown, the checked plan, the citations and the tax card; no other tool payloads. Written only by roma_record_turn; deleted with the conversation.';

-- ---------------------------------------------------------------------------
-- Record a turn: as before, plus the citations and the tax card
-- ---------------------------------------------------------------------------

drop function public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean, jsonb);

create function public.roma_record_turn(
  p_request_id uuid,
  p_conversation_id uuid,
  p_question text,
  p_answer text,
  p_as_of date,
  p_periods daterange[],
  p_tools text[],
  p_sent_descriptions boolean,
  p_plan jsonb default null,
  p_citations jsonb default null,
  p_tax jsonb default null
)
returns table (conversation_id uuid, seq integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_today date;
  v_question text := pg_catalog.btrim(p_question);
  v_conversation uuid;
  v_seq integer;
begin
  if v_user is null then
    raise exception 'Sign in to ask Roma' using errcode = '42501';
  end if;

  -- Locked so two calls with the same request id run one after the other.
  perform 1 from public.roma_usage as u
   where u.id = p_request_id and u.user_id = v_user and u.status = 'settled'
     for update;
  if not found then
    raise exception 'Unknown Roma request' using errcode = '42501';
  end if;

  -- Idempotent: a retry (e.g. after a dropped connection) gets the turn already recorded.
  select m.conversation_id, m.seq into v_conversation, v_seq
    from public.ai_messages as m
   where m.request_id = p_request_id;
  if found then
    return query select v_conversation, v_seq;
    return;
  end if;

  if not exists (select 1 from public.profiles as p where p.id = v_user and p.roma_enabled) then
    raise exception 'Roma is off for this person' using errcode = '42501';
  end if;

  -- The person's today when the question was asked; a question answered just before their
  -- midnight is recorded just after it.
  v_today := public.user_local_today(v_user);
  if p_as_of is null or p_as_of not between v_today - 1 and v_today
     or v_question is null or v_question = '' or p_answer is null
     or p_periods is null or p_tools is null or p_sent_descriptions is null then
    raise exception 'Invalid Roma turn' using errcode = '22023';
  end if;

  if p_conversation_id is null then
    insert into public.ai_conversations (user_id, title)
    values (v_user, pg_catalog.left(pg_catalog.regexp_replace(v_question, '\s+', ' ', 'g'), 80))
    returning id into v_conversation;
  else
    -- Locked so two answers at once get distinct numbers.
    select c.id, c.turn_count into v_conversation, v_seq
      from public.ai_conversations as c
     where c.id = p_conversation_id and c.user_id = v_user
       for update;
    if not found then
      raise exception 'Unknown Roma conversation' using errcode = '42501';
    end if;
    if v_seq >= 100 then
      raise exception 'This Roma conversation is full' using errcode = '22023';
    end if;
  end if;

  update public.ai_conversations as c
     set turn_count = c.turn_count + 1,
         last_message_at = pg_catalog.now()
   where c.id = v_conversation
  returning c.turn_count into v_seq;

  -- A plan that breaks a check above fails the insert (23514); the turn is not recorded.
  insert into public.ai_messages (
    conversation_id, user_id, seq, request_id, question, answer, as_of, periods, tools, sent_descriptions, plan, citations, tax
  )
  values (
    v_conversation, v_user, v_seq, p_request_id, v_question, p_answer, p_as_of, p_periods, p_tools, p_sent_descriptions, p_plan, p_citations, p_tax
  );

  return query select v_conversation, v_seq;
end;
$$;

comment on function public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean, jsonb, jsonb, jsonb) is
  'Roma: stores one answered turn (with, where shown, the checked plan, the citations and the tax card) against the caller''s own settled roma_usage row; starts a conversation when none is given.';

-- A new signature starts with the default grant to public.
revoke execute on function public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean, jsonb, jsonb, jsonb) to authenticated;
