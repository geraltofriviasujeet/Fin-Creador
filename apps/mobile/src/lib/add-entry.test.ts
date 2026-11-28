import type { BalanceMove, LedgerAccount, LedgerCategory } from "@fin-creador/api";
import { runsShortAfterDraft } from "@fin-creador/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { accountRowLabel, categoryTiles, draftMoves, runsShortText, saveLabel } from "./add-entry";

const cat = (id: string, kind: "expense" | "income" = "expense", archived = false): LedgerCategory => ({
  id,
  kind,
  name: id,
  icon: "other",
  archived,
  defaultAccountId: null,
  key: null,
});

const ten = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((id) => cat(id));

describe("categoryTiles", () => {
  it("shows up to 8 in the person's order, without More", () => {
    const { tiles, more } = categoryTiles(ten.slice(0, 8), "expense");
    expect(tiles.map((c) => c.id)).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
    expect(more).toBe(false);
  });

  it("puts the last-used category first, then 6 more and More", () => {
    const { tiles, more } = categoryTiles(ten, "expense", { lastUsedId: "i" });
    expect(tiles.map((c) => c.id)).toEqual(["i", "a", "b", "c", "d", "e", "f"]);
    expect(more).toBe(true);
  });

  it("leaves out archived categories and the other kind; an archived last-used one is ignored", () => {
    const list = [cat("x", "expense", true), cat("a"), cat("s", "income"), cat("b")];
    expect(categoryTiles(list, "expense", { lastUsedId: "x" }).tiles.map((c) => c.id)).toEqual(["a", "b"]);
    expect(categoryTiles(list, "income").tiles.map((c) => c.id)).toEqual(["s"]);
  });

  it("a category picked from More takes the last tile", () => {
    expect(categoryTiles(ten, "expense", { selectedId: "j" }).tiles.map((c) => c.id)).toEqual(["a", "b", "c", "d", "e", "f", "j"]);
    // One already on a tile stays where it is.
    expect(categoryTiles(ten, "expense", { selectedId: "b" }).tiles.map((c) => c.id)).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });
});

describe("saveLabel and accountRowLabel", () => {
  it("names the amount and the type", () => {
    expect(saveLabel("expense", 1_250_00, "INR")).toBe("Save ₹1,250 expense");
    expect(saveLabel("income", 1_25_000_50, "INR")).toBe("Save ₹1,25,000.50 income");
    expect(saveLabel("transfer", null, "INR")).toBe("Save transfer");
  });

  it("labels the account row by type", () => {
    expect(accountRowLabel("expense")).toBe("Paid from");
    expect(accountRowLabel("income")).toBe("Received into");
    expect(accountRowLabel("transfer", "from")).toBe("From");
    expect(accountRowLabel("transfer", "to")).toBe("To");
  });
});

describe("runs-short on Add", () => {
  const hdfc: LedgerAccount = {
    id: "hdfc", kind: "bank", bankType: "savings", label: "HDFC Bank", currency: "INR",
    openingBalanceMinor: 9_000_00, openingBalanceDate: "2026-11-01", inflowMinor: 0, outflowMinor: 0, archived: false,
  };
  const rent = { id: "r1", name: "Rent", accountId: "hdfc", currency: "INR", amountMinor: 12_000_00, dueDate: "2026-12-03" };
  const move = (before: number, after: number): BalanceMove[] => [{ account: hdfc, before, after }];

  it("₹15,000 → ₹14,000 before ₹12,000 rent is fine; → ₹10,000 runs ₹2,000 short", () => {
    expect(runsShortAfterDraft(draftMoves(move(15_000_00, 14_000_00)), [rent])).toBeNull();
    const s = runsShortAfterDraft(draftMoves(move(15_000_00, 10_000_00)), [rent]);
    expect(s && runsShortText(s, "INR")).toBe("With this, Rent on 3 Dec leaves you ₹2,000 short in HDFC Bank.");
  });

  it("says when the account was already short, and rounds the shortfall up", () => {
    const s = runsShortAfterDraft(draftMoves(move(9_000_00, 8_999_50)), [rent]);
    expect(s?.alreadyShort).toBe(true);
    expect(s && runsShortText(s, "INR")).toBe("HDFC Bank is already short for Rent on 3 Dec. With this, it leaves you ₹3,001 short.");
  });

  it("money coming in never warns", () => {
    expect(runsShortAfterDraft(draftMoves(move(9_000_00, 10_000_00)), [rent])).toBeNull();
  });
});

// Hermes on iOS has no formatToParts; the Add text must not need it.
describe("without Intl formatToParts (Hermes iOS)", () => {
  type Proto = { formatToParts?: unknown };
  const proto = Intl.NumberFormat.prototype as Proto;
  let saved: unknown;
  beforeEach(() => {
    saved = proto.formatToParts;
    delete proto.formatToParts;
  });
  afterEach(() => {
    proto.formatToParts = saved;
  });

  it("still formats the save label and the warning", () => {
    expect(saveLabel("expense", 1_250_00, "INR")).toBe("Save ₹1,250 expense");
    const s = { accountId: "h", accountName: "HDFC Bank", bill: { id: "r", name: "Rent", dueDate: "2026-12-03" }, shortAfterBillMinor: 2_000_00, shortByEndMinor: 2_000_00, alreadyShort: false };
    expect(runsShortText(s, "INR")).toBe("With this, Rent on 3 Dec leaves you ₹2,000 short in HDFC Bank.");
  });
});
