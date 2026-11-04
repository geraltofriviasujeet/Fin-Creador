import { describe, expect, it } from "vitest"
import type { UserClient } from "../income/client"
import { MAX_EDIT_DEPTH, existingKeys } from "./matches"

// Regression (QA, Sprint 9a): an import key must resolve to the LATEST version of its edit chain.
// Import -> edit (v1 voided, v2 live, new key) -> delete v2 (v2 voided, nothing newer) -> re-import.
// Expected "deleted". Synthetic rows; stand-in client answers like the chained select/in calls.
type Tx = { id: string; idempotency_key: string; voided_at: string | null; replaces_id: string | null }
const clientWith = (transactions: Tx[]) =>
  ({
    from: () => {
      let rows: Record<string, unknown>[] = transactions
      const b = {
        select: () => b,
        in: (col: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[col]))), b),
        then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null }),
      }
      return b
    },
  }) as unknown as UserClient

const KEY = "k-import"
describe("existingKeys edit chains", () => {
  it("imported then edited (v2 live): live", async () => {
    const m = await existingKeys(clientWith([
      { id: "v1", idempotency_key: KEY, voided_at: "2026-10-20T00:00:00Z", replaces_id: null },
      { id: "v2", idempotency_key: "k-edit", voided_at: null, replaces_id: "v1" },
    ]), [KEY])
    expect(m?.get(KEY)).toBe("live")
  })
  it("imported, edited, then the edited version deleted: deleted", async () => {
    const m = await existingKeys(clientWith([
      { id: "v1", idempotency_key: KEY, voided_at: "2026-10-20T00:00:00Z", replaces_id: null },
      { id: "v2", idempotency_key: "k-edit", voided_at: "2026-10-21T00:00:00Z", replaces_id: "v1" },
    ]), [KEY])
    expect(m?.get(KEY)).toBe("deleted")
  })
  it("imported, edited twice, last version deleted: deleted", async () => {
    const m = await existingKeys(clientWith([
      { id: "v1", idempotency_key: KEY, voided_at: "2026-10-20T00:00:00Z", replaces_id: null },
      { id: "v2", idempotency_key: "k-e2", voided_at: "2026-10-21T00:00:00Z", replaces_id: "v1" },
      { id: "v3", idempotency_key: "k-e3", voided_at: "2026-10-22T00:00:00Z", replaces_id: "v2" },
    ]), [KEY])
    expect(m?.get(KEY)).toBe("deleted")
  })
  it("a chain longer than the depth limit, last version deleted: live (Already imported)", async () => {
    const rows: Tx[] = [{ id: "v0", idempotency_key: KEY, voided_at: "2026-10-20T00:00:00Z", replaces_id: null }]
    for (let i = 1; i <= MAX_EDIT_DEPTH + 1; i++) rows.push({ id: `v${i}`, idempotency_key: `k-${i}`, voided_at: "2026-10-21T00:00:00Z", replaces_id: `v${i - 1}` })
    expect((await existingKeys(clientWith(rows), [KEY]))?.get(KEY)).toBe("live")
  })
  it("a chain at the depth limit, last version deleted: deleted", async () => {
    const rows: Tx[] = [{ id: "v0", idempotency_key: KEY, voided_at: "2026-10-20T00:00:00Z", replaces_id: null }]
    for (let i = 1; i <= MAX_EDIT_DEPTH; i++) rows.push({ id: `v${i}`, idempotency_key: `k-${i}`, voided_at: "2026-10-21T00:00:00Z", replaces_id: `v${i - 1}` })
    expect((await existingKeys(clientWith(rows), [KEY]))?.get(KEY)).toBe("deleted")
  })
  it("a key with no row is absent", async () => {
    expect((await existingKeys(clientWith([]), [KEY]))?.has(KEY)).toBe(false)
  })
})
