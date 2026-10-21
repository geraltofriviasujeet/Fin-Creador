// Typed database contract shared by web and mobile.
// database.types.ts is generated from the dev project: run `npm run db:types` after a migration.
import type { Database } from "./database.types"

export type { Database, Json } from "./database.types"

export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"]
/** Columns a signed-in user may update (matches the column grants in the migration). */
export type ProfileEditable = Pick<ProfileRow, "display_name" | "phone" | "country" | "currency" | "time_zone">
