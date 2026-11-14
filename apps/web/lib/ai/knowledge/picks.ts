// A product pick (10.6d): a question asking which specific fund, scheme, stock, policy or coin
// to buy, or what gives the best returns. Routed to the knowledge base only (route.ts) and
// answered with a code-built line first (chat.ts). No imports, so the knowledge evaluation
// script can use it as it is.

const PRODUCT = String.raw`(?:mutual\s+funds?|funds?|schemes?|stocks?|shares?|polic(?:y|ies)|coins?|crypto(?:currency|currencies)?|tokens?|etfs?|ipos?|bonds?|(?:term|insurance|ulip|endowment|pension|health)\s+plans?)`
const PICKS = [
  // "which mutual fund scheme should I buy", "which stock will double", "which term plan to take"
  new RegExp(String.raw`\bwhich\s+(?:[a-z-]+\s+){0,3}?${PRODUCT}\b[^.?!]*\b(?:buy|invest\w*|pick|choose|take|get|go for|best|top|double|triple|multibagger|go up|rise)\b`, "i"),
  // "best mutual funds for 2027", "top 5 stocks"
  new RegExp(String.raw`\b(?:best|top|safest)\s+(?:\d+\s+)?(?:[a-z-]+\s+){0,2}?${PRODUCT}\b(?!\s+(?:types?|kinds?|categor\w*))`, "i"),
  // "recommend a fund", "suggest some stocks"
  new RegExp(String.raw`\b(?:recommend|suggest)\w*\b[^.?!]*\b${PRODUCT}\b`, "i"),
  // "what will give the best returns", "highest return"
  /\b(?:best|highest|maximum|max|most|top)\s+returns?\b/i,
  // "should I buy Bitcoin or Ethereum"
  /\b(?:should|shall|can)\s+i\s+(?:buy|invest\s+in)\b[^.?!]*\b(?:bitcoin|ethereum|btc|eth|dogecoin|solana|xrp|crypto\w*|coins?)\b/i,
]
/** A general type of product, not a pick: "which type of fund", "mutual fund categories". */
const KINDS = /\b(?:types?|kinds?|categor\w*)\b/i
/** Funds that are not products: taken out before the check. */
const NOT_PRODUCTS = /\b(?:emergency|provident|sinking|contingency)\s+funds?\b/gi

/** A question asking which specific product to buy, or what gives the best returns. */
export function isProductPick(question: string): boolean {
  const text = question.replace(NOT_PRODUCTS, "")
  if (KINDS.test(text) && !/\breturns?\b/i.test(text)) return false
  return PICKS.some((p) => p.test(text))
}
