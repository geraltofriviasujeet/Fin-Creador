# Quarterly list refresh

The Goals forms suggest names from hand-kept lists in `packages/schemas/src/goal-data.ts`:
vehicle makes and models (bike, car, HMV), Indian states and union territories, and Indian
cities. Countries come from `packages/schemas/src/region-data.ts` (generated). The lists hold
names only, never prices. The forms accept any typed make, model or city, so a stale list
never blocks anyone, but it should stay current.

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
3. Places: change states, union territories or cities only on an official change, with the
   official source.
4. Record every change in a diff table in the PR description, one row per change, with the
   source URL:

   | List | Change | Make / place | Model / name | Source URL |
   |------|--------|--------------|--------------|------------|
   | car  | add    | Example make | Example model | https://… |
   | bike | remove | Example make | Old model     | https://… |

5. Update `LISTS_REVIEWED_ON` in `goal-data.ts` (`vehicles`, and `places` if checked) to the
   review date, even when nothing changed.
6. Run `npm run typecheck`, `npm run lint` and `npm test`.
7. Open one draft PR. The owner reviews and merges it.
