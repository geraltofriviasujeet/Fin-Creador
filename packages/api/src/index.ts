// Typed database contract shared by web and mobile.
// database.types.ts is generated from the dev project: run `npm run db:types` after a migration.
import type { Database } from "./database.types"

export type { Database, Json } from "./database.types"

export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"]
/** Columns a signed-in user may update (matches the column grants in the migration). */
export type ProfileEditable = Pick<ProfileRow, "display_name" | "phone" | "country" | "currency" | "time_zone">
export type AccountRow = Database["public"]["Tables"]["accounts"]["Row"]
export type CategoryRow = Database["public"]["Tables"]["categories"]["Row"]
export type TransactionRow = Database["public"]["Tables"]["transactions"]["Row"]
export type AccountBalanceRow = Database["public"]["Views"]["account_balances"]["Row"]

export * from "./auth-errors"
export * from "./ledger-errors"
export * from "./profile"
export * from "./public-key"
export * from "./income"
export * from "./transactions"
export * from "./goals"
export * from "./investments"
export * from "./recurring"
export * from "./dashboard"
export * from "./loans"
export * from "./cards"
