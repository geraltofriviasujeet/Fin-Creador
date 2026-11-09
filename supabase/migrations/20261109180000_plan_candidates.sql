-- Sprint 10.9 follow-up: purchase plans suggest models. A plan for a bike or a car without a
-- model now holds a shortlist of models found on web pages: a new top-level "candidates" key
-- on ai_messages.plan. Each candidate is a make and model from the app's vehicle list with a
-- price, both found in code on a listing page, and that page's site and link.
--
-- Rules:
--   * Only the plan-shape check's key list changes: "candidates" joins it. Every other part of
--     the check is as in 20261107180000_roma_plans.sql (version 1, kind trip or purchase, no
--     key naming an account, account number, IBAN, IFSC, card number or balance at any depth),
--     and the 32 KB size check is unchanged.
--   * Plans stored before this migration have no "candidates" key and still pass.
--   * No change to earlier migrations.

alter table public.ai_messages
  drop constraint ai_messages_plan_shape,
  add constraint ai_messages_plan_shape check (
    plan is null
    or (
      pg_catalog.jsonb_typeof(plan) = 'object'
      and plan ->> 'v' = '1'
      and plan ->> 'kind' in ('trip', 'purchase')
      -- Top-level keys from a fixed list only.
      and plan - array['v', 'kind', 'intake', 'lines', 'saved', 'carriers', 'hotels', 'verdicts', 'changes', 'assumptions', 'sources', 'candidates']
          = '{}'::jsonb
      -- No key at any depth names an account, account number, IBAN, IFSC, card number or balance.
      and not pg_catalog.jsonb_path_exists(
        plan,
        'strict $.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "account|account_no|iban|ifsc|card_number|balance" flag "i")',
        '{}'::jsonb,
        true
      )
    )
  );
