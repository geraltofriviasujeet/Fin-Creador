import { MAX_PRICE_SCALED, MAX_UNITS_SCALED, investedMinorWithinLimit, isIsoDate, parseScaledInput, type ScaledInputError } from "@fin-creador/domain";
import { z } from "zod";

// Investments (Sprint 7), shared by web and mobile. Mirrors the investments migration: the
// database checks ranges, the invested cap, ownership and the buy date again. Units and the
// buy price per unit are typed with up to 4 decimals and stored as scaled integers.

const text = z
  .string()
  .optional()
  .transform((v) => (v ?? "").trim());
const uuidOrEmpty = (message: string) => text.pipe(z.union([z.literal(""), z.uuid({ message })]));

const UNITS_MESSAGES: Record<ScaledInputError, string> = {
  empty: "Enter the number of units",
  invalid: "Enter a number, e.g. 12.5",
  too_many_decimals: "Use at most 4 decimal places",
  zero: "Units must be more than zero",
  too_large: "That's too many units",
};

const PRICE_MESSAGES: Record<ScaledInputError, string> = {
  empty: "Enter the buy price per unit",
  invalid: "Enter a price, e.g. 1,250.50",
  too_many_decimals: "Use at most 4 decimal places",
  zero: "Enter the buy price per unit",
  too_large: "The price is too large",
};

/**
 * Add a holding record (no `holdingId`: instrument and request key required) or edit one
 * (`holdingId`; the instrument never changes, so `instrumentId` is ignored). A buy price of 0
 * is allowed (e.g. bonus or gifted units). `today` is the person's local date.
 */
export function holdingFormSchema({ today }: { today: string }) {
  return z
    .object({
      holdingId: uuidOrEmpty("Holding not found"),
      instrumentId: uuidOrEmpty("Choose a fund or share from the search"),
      units: text,
      buyPrice: text,
      buyDate: text,
      idempotencyKey: uuidOrEmpty("Please reopen the form and try again"),
    })
    .transform((v, ctx) => {
      const fail = (path: string, message: string) => {
        ctx.addIssue({ code: "custom", path: [path], message });
        return z.NEVER;
      };
      if (!v.holdingId) {
        if (!v.instrumentId) return fail("instrumentId", "Choose a fund or share from the search");
        if (!v.idempotencyKey) return fail("idempotencyKey", "Please reopen the form and try again");
      }
      const units = parseScaledInput(v.units, { max: MAX_UNITS_SCALED });
      if (!units.ok) return fail("units", UNITS_MESSAGES[units.error]);
      const price = parseScaledInput(v.buyPrice, { max: MAX_PRICE_SCALED, allowZero: true });
      if (!price.ok) return fail("buyPrice", PRICE_MESSAGES[price.error]);
      if (investedMinorWithinLimit(units.scaled, price.scaled) === null) {
        return fail("buyPrice", "Units × buy price is too large");
      }
      if (!isIsoDate(v.buyDate)) return fail("buyDate", "Enter a valid date");
      if (v.buyDate > today) return fail("buyDate", "The buy date can't be in the future");
      return {
        holdingId: v.holdingId || null,
        instrumentId: v.holdingId ? null : v.instrumentId,
        unitsScaled: units.scaled,
        buyPriceScaled: price.scaled,
        buyDate: v.buyDate,
        idempotencyKey: v.holdingId ? null : v.idempotencyKey,
      };
    });
}

export type HoldingFormOutput = z.output<ReturnType<typeof holdingFormSchema>>;
