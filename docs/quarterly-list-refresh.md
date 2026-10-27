# Quarterly list refresh

The Goals forms suggest names from hand-kept lists in `packages/schemas/src/goal-data.ts`:
vehicle makes and models (bike, car, HMV), Indian states and union territories, and Indian
cities. Countries come from `packages/schemas/src/region-data.ts` (generated). The lists hold
names only, never prices. The forms accept any typed make, model or city, so a stale list
never blocks anyone, but it should stay current.

The fixed-deposit form (Sprint 7) suggests banks from `FD_BANKS` in
`packages/schemas/src/fixed-deposit-forms.ts`: the account bank list (`INDIAN_BANKS` in
`money-forms.ts`) without payments banks, which can't take deposits, plus small finance banks
that do. Any bank name can be typed.

The loan form (Sprint 8a) suggests lenders from `LENDERS` in
`packages/schemas/src/loan-forms.ts`: `FD_BANKS`, card issuers that are not banks, housing
finance companies, NBFCs and education lenders. Any lender name can be typed.

## When

In January, April, July and October. Normally only vehicle makes and models change. Touch
states, countries or cities only when there is a real change (for example a new union
territory or a renamed city).

## Steps

1. Branch from `main`.
2. Vehicles: check each make's official India website (for example the manufacturer's
   `.in` or India pages). Add only models currently on sale in India; remove models that are
   discontinued in India. Keep names exactly as the manufacturer writes them. No prices, no
   specifications.
3. Banks: check the RBI lists of scheduled commercial banks and small finance banks. Add
   banks that take fixed deposits, remove merged or closed ones (keep names as the bank writes
   them). Update `FD_BANKS_REVIEWED_ON` in `fixed-deposit-forms.ts`, even when nothing changed.
   Lenders: check the RBI lists of housing finance companies and NBFCs (upper and middle
   layer) and the card issuers; add active lenders, remove merged or closed ones, and use the
   name the lender uses. Update `LENDERS_REVIEWED_ON` in `loan-forms.ts`, even when nothing
   changed.
4. Places: change states, union territories or cities only on an official change, with the
   official source.
5. Record every change in a diff table in the PR description, one row per change, with the
   source URL:

   | List | Change | Make / place | Model / name | Source URL |
   |------|--------|--------------|--------------|------------|
   | car  | add    | Example make | Example model | https://… |
   | bike | remove | Example make | Old model     | https://… |

6. Update `LISTS_REVIEWED_ON` in `goal-data.ts` (`vehicles`, and `places` if checked) to the
   review date, even when nothing changed.
7. Run `npm run typecheck`, `npm run lint` and `npm test`.
8. Open one draft PR. The owner reviews and merges it.
