-- Sprint 10a: "Repeat this?" on the add income and add expense forms.
--
-- Rules (docs/sprint-plan.md decision 2026-11-05):
--   * No new mechanism: a repeating entry is a recurring rule (recurring_rules) whose start
--     date is the entry's date, plus that rule's first occurrence confirmed in the same call.
--     Both are created, in one database transaction, so either both exist or neither does.
--   * The entry is posted by confirm_recurring_occurrence, so it carries recurring_rule_id
--     and occurrence_date = start date. The existing partial unique index (one non-voided
--     entry per rule and occurrence date) means that occurrence can never be due or post
--     again: nothing is counted twice.
--   * A back-dated entry starts the rule on that past date. Later occurrences up to today
--     show as due on Recurring, to confirm or skip one by one; nothing posts by itself.
--   * Only income and expense, monthly or yearly (the form's choices). Every other check is
--     the existing one (create_recurring_rule, confirm_recurring_occurrence and the
--     transactions insert trigger), so the rule and the entry follow the same rules as ever.
--   * Retrying the same request key with the same details returns the saved entry (both
--     callees are idempotent on the key); different details are FC007.
--
-- New error codes: none. Reused: FC001, FC002, FC003, FC006, FC007, FC010, FC016, FC020.

create function public.record_entry_with_repeat(
  p_idempotency_key uuid,
  p_type text,
  p_frequency text,
  p_amount_minor bigint,
  p_occurred_on date,
  p_account_id uuid,
  p_category_id uuid,
  p_note text default null,
  p_payment_mode text default null
)
returns public.transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rule public.recurring_rules;
begin
  if p_type is null or p_type not in ('income', 'expense') then
    raise exception 'Only income and expenses can repeat from the add form' using errcode = '22023';
  end if;
  if p_frequency is null or p_frequency not in ('monthly', 'yearly') then
    raise exception 'Repeat every month or every year' using errcode = '22023';
  end if;

  v_rule := public.create_recurring_rule(
    p_idempotency_key, p_type, p_amount_minor, p_frequency, p_occurred_on, p_account_id,
    p_category_id => p_category_id, p_payment_mode => p_payment_mode, p_note => p_note);

  return public.confirm_recurring_occurrence(
    v_rule.id, p_occurred_on, p_idempotency_key, p_amount_minor, p_occurred_on, p_account_id,
    p_note => p_note, p_payment_mode => p_payment_mode);
end;
$$;

comment on function public.record_entry_with_repeat(uuid, text, text, bigint, date, uuid, uuid, text, text) is
  'Add form "Repeat this?": creates a monthly or yearly recurring rule starting on the entry date and confirms its first occurrence as the entry, atomically, once per request key.';

revoke execute on function public.record_entry_with_repeat(uuid, text, text, bigint, date, uuid, uuid, text, text) from public, anon;
grant execute on function public.record_entry_with_repeat(uuid, text, text, bigint, date, uuid, uuid, text, text) to authenticated;
