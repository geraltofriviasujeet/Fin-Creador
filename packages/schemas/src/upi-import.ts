import { MAX_AMOUNT_MINOR, MAX_UPI_ROWS, STATEMENT_NOTE_MAX, isIsoDate } from "@fin-creador/domain"
import { z } from "zod"
import { hasDigitRun } from "./digits"
import { IMPORT_SAVE_CHUNK } from "./statement-import"

// UPI app statement import (Sprint 9e): the category slots a payment can land in, Paytm's tag map,
// the built-in merchant list, and what the import page sends to the server.

/**
 * Where a payment's category is looked for among the person's own categories: by stable key, then
 * by name (the default's name, current and before 9e), then by icon. Also the fixed list of keys
 * the model may answer with (CATEGORY_SLOT_KEYS); nothing else is accepted from it.
 */
export const CATEGORY_SLOTS = {
  food: { icon: "food", names: ["Food & dining"], hint: "restaurants, cafes, food delivery" },
  groceries: { icon: "groceries", names: ["Groceries"], hint: "supermarkets, grocery delivery, vegetables, milk" },
  transport: { icon: "transport", names: ["Transport & Cabs", "Transport"], hint: "cabs, autos, metro, bus, parking, tolls" },
  home: { icon: "home", names: ["Rent & housing"], hint: "rent, maintenance, housing society" },
  bills: { icon: "bills", names: ["Utilities & bills"], hint: "electricity, water, gas, mobile, internet, DTH" },
  shopping: { icon: "shopping", names: ["Shopping"], hint: "online and retail shopping, clothes, electronics" },
  medical: { icon: "health", names: ["Medical", "Health"], hint: "pharmacies, doctors, hospitals, labs" },
  entertainment: { icon: "fun", names: ["Entertainment"], hint: "movies, events, games" },
  education: { icon: "education", names: ["Education"], hint: "school, college, courses, books" },
  travel: { icon: "travel", names: ["Travel"], hint: "flights, trains, hotels, travel bookings" },
  personal_care: { icon: "care", names: ["Personal care"], hint: "salons, spas, grooming" },
  fuel: { key: "fuel", icon: "fuel", names: ["Fuel"], hint: "petrol, diesel, CNG, EV charging" },
  gift: { key: "gift", icon: "gift", names: ["Gift"], hint: "gifts, donations" },
  subscription: { key: "subscription", icon: "subscription", names: ["Subscription"], hint: "streaming and app subscriptions" },
  membership: { key: "membership", icon: "membership", names: ["Membership"], hint: "gyms, clubs, memberships" },
  services: { key: "services", icon: "services", names: ["Services"], hint: "home services, repairs, laundry, insurance, financial services" },
  money_sent: { key: "money_sent", icon: "money_sent", names: ["Money sent to people"], hint: "money sent to a person, not a business" },
  misc: { icon: "other", names: ["Miscellaneous", "Other expenses"], hint: "anything else" },
} as const satisfies Record<string, { key?: string; icon: string; names: readonly string[]; hint: string }>

export type CategorySlot = keyof typeof CATEGORY_SLOTS
export const CATEGORY_SLOT_KEYS = Object.keys(CATEGORY_SLOTS) as [CategorySlot, ...CategorySlot[]]
export const isCategorySlot = (value: unknown): value is CategorySlot => typeof value === "string" && Object.hasOwn(CATEGORY_SLOTS, value)

/** Paytm's tags (as printed, any case) and the slot each goes to. Money Received is a credit: no slot. */
export const PAYTM_TAG_SLOTS: Record<string, CategorySlot> = {
  food: "food",
  groceries: "groceries",
  medical: "medical",
  shopping: "shopping",
  taxi: "transport",
  entertainment: "entertainment",
  "bill payments": "bills",
  miscellaneous: "misc",
  services: "services",
  "financial services": "services",
  "money transfer": "money_sent",
}

/** A Paytm tag's slot, or null for a tag outside the map. */
export const paytmTagSlot = (tag: string | null): CategorySlot | null => (tag ? (PAYTM_TAG_SLOTS[tag.trim().toLowerCase()] ?? null) : null)

/**
 * Common merchants as payee names show them, each a whole word or phrase (any case) and its slot.
 * Generic words a person's name could hold are left out.
 */
export const UPI_MERCHANTS: readonly (readonly [string, CategorySlot])[] = [
  ["swiggy", "food"], ["zomato", "food"], ["dominos", "food"], ["domino's", "food"], ["mcdonalds", "food"], ["mcdonald's", "food"],
  ["kfc", "food"], ["starbucks", "food"], ["burger king", "food"], ["pizza hut", "food"], ["haldiram", "food"], ["chaayos", "food"],
  ["blinkit", "groceries"], ["zepto", "groceries"], ["bigbasket", "groceries"], ["instamart", "groceries"], ["dmart", "groceries"],
  ["jiomart", "groceries"], ["grofers", "groceries"], ["more retail", "groceries"], ["spencers", "groceries"], ["country delight", "groceries"],
  ["uber", "transport"], ["ola", "transport"], ["rapido", "transport"], ["namma yatri", "transport"], ["bmtc", "transport"],
  ["delhi metro", "transport"], ["dmrc", "transport"], ["fastag", "transport"],
  ["irctc", "travel"], ["redbus", "travel"], ["makemytrip", "travel"], ["goibibo", "travel"], ["cleartrip", "travel"], ["indigo", "travel"],
  ["air india", "travel"], ["ixigo", "travel"], ["oyo", "travel"],
  ["amazon", "shopping"], ["flipkart", "shopping"], ["myntra", "shopping"], ["meesho", "shopping"], ["ajio", "shopping"],
  ["croma", "shopping"], ["reliance digital", "shopping"], ["decathlon", "shopping"], ["ikea", "shopping"], ["tata cliq", "shopping"],
  ["nykaa", "personal_care"], ["urban company", "services"], ["lenskart", "medical"],
  ["netflix", "subscription"], ["hotstar", "subscription"], ["spotify", "subscription"], ["youtube premium", "subscription"],
  ["prime video", "subscription"], ["sonyliv", "subscription"], ["zee5", "subscription"], ["jiocinema", "subscription"],
  ["bookmyshow", "entertainment"], ["pvr", "entertainment"], ["inox", "entertainment"], ["district", "entertainment"],
  ["apollo", "medical"], ["pharmeasy", "medical"], ["1mg", "medical"], ["netmeds", "medical"], ["medplus", "medical"],
  ["practo", "medical"], ["truemeds", "medical"],
  ["airtel", "bills"], ["jio", "bills"], ["vodafone idea", "bills"], ["bsnl", "bills"], ["bescom", "bills"], ["tata power", "bills"],
  ["adani electricity", "bills"], ["act fibernet", "bills"], ["tata play", "bills"], ["mahanagar gas", "bills"], ["indane", "bills"],
  ["indian oil", "fuel"], ["iocl", "fuel"], ["hpcl", "fuel"], ["hp petrol", "fuel"], ["bharat petroleum", "fuel"], ["bpcl", "fuel"],
  ["shell", "fuel"], ["nayara", "fuel"],
  ["cult.fit", "membership"], ["cultfit", "membership"],
  ["lic", "services"], ["policybazaar", "services"],
]

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const MERCHANT_RES = UPI_MERCHANTS.map(([name, slot]) => [new RegExp(`(?<![a-z0-9])${escape(name)}(?![a-z0-9])`, "i"), slot] as const)

/** The slot of the first merchant whose name is a whole word or phrase of the payee name, or null. */
export function merchantSlot(payee: string): CategorySlot | null {
  for (const [re, slot] of MERCHANT_RES) if (re.test(payee)) return slot
  return null
}

// What the import page sends to the server.

const isoDate = z.string().refine(isIsoDate, "Enter a date")
const optionalId = z.union([z.uuid(), z.literal("")])
export const UPI_APPS = ["paytm", "phonepe", "bhim", "google_pay"] as const

/** Remembers which account a statement's bank account is (or the Google Pay UPI Lite choice: an account, or none). */
export const upiAccountMatchInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("bank"),
    app: z.enum(UPI_APPS),
    bankLabel: z.string().max(80).refine((v) => !/[0-9]/.test(v), "No digits in the bank name"),
    digits: z.string().regex(/^[0-9]{2,4}$/),
    accountId: z.uuid(),
  }),
  z.object({ kind: z.literal("upi_lite"), app: z.literal("google_pay"), accountId: z.uuid().nullable() }),
])

export type UpiAccountMatchInput = z.infer<typeof upiAccountMatchInputSchema>

/** Lookup for the review: which keys exist, and the entries on these accounts from a day before the range to a day after. */
export const upiMatchesInputSchema = z
  .object({
    keys: z.array(z.uuid()).max(MAX_UPI_ROWS),
    accountIds: z.array(z.uuid()).max(50),
    from: isoDate,
    to: isoDate,
  })
  .refine((v) => v.from <= v.to, { message: "The range ends before it starts", path: ["to"] })

/** Payee names to suggest categories for: short ids and names only, never amounts, dates or accounts. */
export const UPI_SUGGEST_MAX_NAMES = 1_000
export const upiSuggestInputSchema = z.object({
  names: z
    .array(z.object({ id: z.string().regex(/^[a-z0-9]{1,8}$/), name: z.string().trim().min(1).max(80) }))
    .min(1)
    .max(UPI_SUGGEST_MAX_NAMES),
})

/** A payment exactly as the reader read it: its key comes from the reference and direction only. */
const upiRowSchema = z.object({
  ref: z.string().regex(/^[0-9A-Za-z ]{6,40}$/),
  direction: z.enum(["debit", "credit"]),
  date: isoDate,
  amountMinor: z.number().int().positive().max(MAX_AMOUNT_MINOR),
  payee: z
    .string()
    .max(STATEMENT_NOTE_MAX)
    .refine((v) => v === v.trim() && !hasDigitRun(v, 4) && !v.includes("@"), "No account numbers or UPI ids"),
})

/** A payment to save: the row as read, and the type, date, amount, accounts and category as reviewed. */
const upiSaveLineSchema = z.object({
  original: upiRowSchema,
  type: z.enum(["expense", "income", "refund", "transfer"]),
  date: z.string().max(10),
  amount: z.string().max(40),
  /** The account the money left (expense, transfer) or arrived in (income, refund). */
  accountId: z.uuid(),
  /** Transfers only: the account it went to. */
  counterAccountId: optionalId,
  categoryId: optionalId,
})

/** Ticked payments to save. */
export const upiSaveInputSchema = z.object({
  lines: z.array(upiSaveLineSchema).min(1).max(IMPORT_SAVE_CHUNK),
})

/** Payments dated before an account's opening date, added with its opening moved back (one account, one call). */
export const upiOpeningMoveInputSchema = z.object({
  accountId: z.uuid(),
  lines: z.array(upiSaveLineSchema).min(1).max(MAX_UPI_ROWS),
})

/** The opening move's preview: the account and the earliest payment's date. */
export const upiOpeningPreviewInputSchema = z.object({ accountId: z.uuid(), newDate: isoDate })

export type UpiSaveInput = z.infer<typeof upiSaveInputSchema>
