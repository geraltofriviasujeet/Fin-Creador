// What the import page says about category suggestions (Sprint 9e), apart from the model code so
// the browser bundle never carries the prompt or the provider.

export type SuggestBeginOutcome = "ok" | "disabled" | "no_consent" | "global_budget" | "user_budget" | "daily_limit"

/** Why some or all names got no suggestion: off (not configured), a refusal from the database, or a failed call. */
export type RulesOnlyReason = "off" | Exclude<SuggestBeginOutcome, "ok"> | "failed"

export const RULES_ONLY_TEXT: Record<RulesOnlyReason, string> = {
  off: "Category suggestions are off, so categories come from rules only.",
  disabled: "Category suggestions are paused, so categories come from rules only.",
  no_consent: "Categories come from rules only.",
  global_budget: "Category suggestions have reached this month's limit, so categories come from rules only.",
  user_budget: "You've reached this month's limit for suggestions, so categories come from rules only.",
  daily_limit: "You've reached today's limit for suggestions, so the rest come from rules only.",
  failed: "Category suggestions couldn't be reached, so some categories come from rules only.",
}
