-- Sprint 6 (owner, 2026-10-26): a goal can be deleted permanently, but only once it is
-- archived. The person archives a goal first (it can still be restored), then may delete it
-- from the archived list; that cannot be undone.
--
-- Goals hold no money and nothing references them (no transactions or other rows point at a
-- goal), so deleting one cannot change a balance or any history. Budgets, categories,
-- accounts, transactions and everything else stay without delete for clients.

grant delete on table public.goals to authenticated;

-- Only the owner's archived goals. An active goal, or another person's goal, matches no row:
-- the delete removes nothing (and the client says so).
create policy goals_delete_own_archived on public.goals
  for delete to authenticated
  using ((select auth.uid()) = user_id and archived_at is not null);
