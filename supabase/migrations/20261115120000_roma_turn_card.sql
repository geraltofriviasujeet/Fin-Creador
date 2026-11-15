-- Sprint 10.7a follow-up: a goal check's, trip check's or goal "what if"'s card is kept on its
-- turn, so a reopened conversation shows the card and its "How this was worked out" section
-- (the figures table and the assumptions) as they were shown.
--
-- Rules:
--   * ai_messages.card: the card shown with the answer, built in code: its kind ("goal",
--     "trip" or "what_if"), the goal or destination, the verdict, the assumptions and, where
--     shown, the caveat, the lines under it, a what-if's before/after comparison, a trip's
--     web-assisted line, and the figures table (label and value, both formatted in code). Null
--     for any other answer, and for a turn with more than one check (its text is kept).
--     "card" because "check" is an SQL keyword.
--   * The checks fail closed, in the style of ai_messages.tax (20261114180000): the whole check
--     is wrapped in coalesce(..., false), so a condition that can't be evaluated (a missing key,
--     a null, a jsonpath error in silent mode) is a failure, never a pass. Type, size, required
--     keys, top-level keys from a fixed list, kind from a fixed list, the shape of each part,
--     and no key at any depth naming an account, IBAN, IFSC, card number or balance (the plan
--     check's own pattern). The app checks the full shape with Zod before writing and again
--     before showing a stored turn.
--   * Written only by roma_record_turn: one new argument, default null, so the eleven-argument
--     call of 20261114180000 and the nine-argument call of 20261107180000 still work. Its body
--     is unchanged except for the one column. RLS and grants on the table are unchanged.

alter table public.ai_messages
  add column card jsonb,
  add constraint ai_messages_card_size check (card is null or octet_length(card::text) <= 16384),
  add constraint ai_messages_card_shape check (
    card is null
    or coalesce(
      case when pg_catalog.jsonb_typeof(card) = 'object' then
        card ?& array['kind', 'goal', 'verdict', 'assumptions']
        -- Top-level keys from a fixed list only.
        and card - array['kind', 'goal', 'verdict', 'caveat', 'assumptions', 'lines', 'comparison', 'web', 'figures'] = '{}'::jsonb
        and pg_catalog.jsonb_typeof(card -> 'kind') = 'string'
        and (card ->> 'kind') in ('goal', 'trip', 'what_if')
        and pg_catalog.jsonb_typeof(card -> 'goal') = 'string'
        and pg_catalog.jsonb_typeof(card -> 'verdict') = 'string'
        and pg_catalog.jsonb_typeof(card -> 'assumptions') = 'array'
        and (not card ? 'caveat' or pg_catalog.jsonb_typeof(card -> 'caveat') = 'string')
        and (not card ? 'lines' or pg_catalog.jsonb_typeof(card -> 'lines') = 'array')
        -- A comparison: a what-if's only, with two column heads and 1 to 6 rows, each an object
        -- of label, before and after strings and no other key. Strict mode: a row missing a key
        -- is an error, so it is not counted and the counts differ.
        and (not card ? 'comparison' or (
          (card ->> 'kind') = 'what_if'
          and case when pg_catalog.jsonb_typeof(card -> 'comparison') = 'object' then
            card -> 'comparison' ?& array['before', 'after', 'rows']
            and (card -> 'comparison') - array['before', 'after', 'rows'] = '{}'::jsonb
            and pg_catalog.jsonb_typeof(card -> 'comparison' -> 'before') = 'string'
            and pg_catalog.jsonb_typeof(card -> 'comparison' -> 'after') = 'string'
            and case when pg_catalog.jsonb_typeof(card -> 'comparison' -> 'rows') = 'array' then
              pg_catalog.jsonb_array_length(card -> 'comparison' -> 'rows') between 1 and 6
              and pg_catalog.jsonb_array_length(pg_catalog.jsonb_path_query_array(
                    card -> 'comparison' -> 'rows',
                    'strict $[*] ? (@.type() == "object" && @.label.type() == "string" && @.before.type() == "string" && @.after.type() == "string")',
                    '{}'::jsonb,
                    true))
                  = pg_catalog.jsonb_array_length(card -> 'comparison' -> 'rows')
              and not coalesce(pg_catalog.jsonb_path_exists(
                    card -> 'comparison' -> 'rows',
                    'strict $[*].keyvalue() ? (!(@.key like_regex "^(label|before|after)$"))',
                    '{}'::jsonb,
                    true), true)
            else false end
          else false end))
        -- A trip's web-assisted line: verdict and summary strings, and webOnly true if present.
        and (not card ? 'web' or (
          case when pg_catalog.jsonb_typeof(card -> 'web') = 'object' then
            card -> 'web' ?& array['verdict', 'summary']
            and (card -> 'web') - array['verdict', 'summary', 'webOnly'] = '{}'::jsonb
            and pg_catalog.jsonb_typeof(card -> 'web' -> 'verdict') = 'string'
            and pg_catalog.jsonb_typeof(card -> 'web' -> 'summary') = 'string'
            and (not card -> 'web' ? 'webOnly' or card -> 'web' -> 'webOnly' = 'true'::jsonb)
          else false end))
        -- The figures table: at most 40 rows, each an object of label and value strings only.
        and (not card ? 'figures' or (
          case when pg_catalog.jsonb_typeof(card -> 'figures') = 'array' then
            pg_catalog.jsonb_array_length(card -> 'figures') <= 40
            and pg_catalog.jsonb_array_length(pg_catalog.jsonb_path_query_array(
                  card -> 'figures',
                  'strict $[*] ? (@.type() == "object" && @.label.type() == "string" && @.value.type() == "string")',
                  '{}'::jsonb,
                  true))
                = pg_catalog.jsonb_array_length(card -> 'figures')
            and not coalesce(pg_catalog.jsonb_path_exists(
                  card -> 'figures',
                  'strict $[*].keyvalue() ? (!(@.key like_regex "^(label|value)$"))',
                  '{}'::jsonb,
                  true), true)
          else false end))
        -- No key at any depth names an account, account number, IBAN, IFSC, card number or balance.
        and not coalesce(pg_catalog.jsonb_path_exists(
              card,
              'strict $.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "account|account_no|iban|ifsc|card_number|balance" flag "i")',
              '{}'::jsonb,
              true), true)
      else false end,
      false)
  );

comment on column public.ai_messages.card is
  'Roma 10.7a: the goal check, trip check or goal what-if card shown with this answer, with its figures table and assumptions (built in code), for reopening from history; null otherwise.';
comment on table public.ai_messages is
  'Roma turns (owner-only): question, answer, as-of date, periods, tool names and, where shown, the checked plan, the citations, the tax card and the check card; no other tool payloads. Written only by roma_record_turn; deleted with the conversation.';

-- ---------------------------------------------------------------------------
-- Record a turn: as before, plus the card
-- ---------------------------------------------------------------------------

drop function public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean, jsonb, jsonb, jsonb);

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
  p_tax jsonb default null,
  p_card jsonb default null
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
    conversation_id, user_id, seq, request_id, question, answer, as_of, periods, tools, sent_descriptions, plan, citations, tax, card
  )
  values (
    v_conversation, v_user, v_seq, p_request_id, v_question, p_answer, p_as_of, p_periods, p_tools, p_sent_descriptions, p_plan, p_citations, p_tax, p_card
  );

  return query select v_conversation, v_seq;
end;
$$;

comment on function public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean, jsonb, jsonb, jsonb, jsonb) is
  'Roma: stores one answered turn (with, where shown, the checked plan, the citations, the tax card and the check card) against the caller''s own settled roma_usage row; starts a conversation when none is given.';

-- A new signature starts with the default grant to public.
revoke execute on function public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.roma_record_turn(uuid, uuid, text, text, date, daterange[], text[], boolean, jsonb, jsonb, jsonb, jsonb) to authenticated;
