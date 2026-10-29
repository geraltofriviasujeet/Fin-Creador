import type { IsoDate } from "@fin-creador/domain"
import { type UserClient, userToday } from "../income/client"
import { cardName } from "./view"

// The card a statement is imported for (Sprint 9a): read as the signed-in user (RLS), so
// another person's card id finds nothing. Archived cards take no imports.

export type ImportCard = {
  id: string
  /** As the app names the card (nickname, product or issuer); never a number. */
  name: string
  issuer: string
  currency: string
  /** Lines dated before this day are skipped (the card was added then). */
  trackingStartedOn: IsoDate
}

export type ImportCardLoad =
  | { ok: true; card: ImportCard; today: IsoDate }
  | { ok: false; reason: "unauthenticated" | "not_found" | "unavailable" }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function loadImportCard(supabase: UserClient, cardId: string): Promise<ImportCardLoad> {
  const day = await userToday(supabase)
  if (!day.ok) return day
  if (!UUID.test(cardId)) return { ok: false, reason: "not_found" }
  const { data, error } = await supabase
    .from("credit_cards")
    .select("id, issuer, product, product_other, nickname, currency, tracking_started_on, archived_at")
    .eq("id", cardId)
    .maybeSingle()
  if (error) return { ok: false, reason: "unavailable" }
  if (!data || data.archived_at !== null) return { ok: false, reason: "not_found" }
  return {
    ok: true,
    today: day.today,
    card: {
      id: data.id,
      name: cardName({ nickname: data.nickname, issuer: data.issuer, product: data.product, productOther: data.product_other }),
      issuer: data.issuer,
      currency: data.currency,
      trackingStartedOn: data.tracking_started_on,
    },
  }
}
