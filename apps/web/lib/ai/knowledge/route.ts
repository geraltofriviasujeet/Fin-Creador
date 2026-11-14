import { rupeeAmountsIn } from "@fin-creador/domain"
import type { RomaRoute } from "../prompts/roma-system"

// Which tools a question gets (Sprint 10.6c), decided in code before the model sees it:
//   * records: the person's own money only (the finance tools, and the web tools when on);
//   * knowledge: a general question only (knowledge_search alone), so a general answer can't
//     use the person's figures;
//   * both: both kinds of signal, or none clear: every tool;
//   * neither: a greeting or small talk only, with no tools (any money figure is then refused
//     by the figure check, as for any answer);
//   * tax (10.6e): tax to be worked out on a salary: tax_estimate and knowledge_search only.
// A product pick (10.6d: which fund, scheme, stock, policy or coin to buy, or what gives the
// best returns) goes to the knowledge route; chat.ts puts a code-built line before the answer.
// Unclear questions go to "both", never to "neither".

export type Route = RomaRoute

const SMALL_TALK =
  /^(?:hi|hii+|hello|hey|hiya|yo|namaste|good (?:morning|afternoon|evening|night)|thanks|thank you|thank you so much|thanks a lot|ty|ok|okay|cool|great|nice|bye|goodbye|see you|how are you|who are you|what's up|whats up)(?:\s+roma)?[\s!.?,🙂😊🙏]*$/iu

/** The person speaks about their own money: first person, or their records' own words. */
const RECORDS =
  /\b(?:i|i'm|im|i've|ive|i'd|me|my|mine|myself|we|our|us)\b|\b(?:spent|spend|spending|earned|income|salary|savings rate|net worth|balance|budget|goal|goals|trip|transactions?|expenses?|accounts?|emi due|due soon|afford)\b/i

/** A general question: how something works, a definition, a rule, rate, limit or slab. */
const KNOWLEDGE =
  /\b(?:what (?:is|are|does)|what's|whats|how (?:does|do|is|are)|why (?:do|does|is|are)|explain|meaning|mean by|define|definition|difference between|vs\.?|versus|which is better|good|bad|enough|normal|typical|healthy|ideal|recommended|rules?|rates?|limits?|slabs?|regime|section \d+|80c|80d|deductions?|tax|taxed|capital gains?|ltcg|stcg|sip|mutual funds?|nav|expense ratio|direct plan|regular plan|elss|ppf|epf|nps|fixed deposit|inflation|real return|compounding|compound interest|diversif\w*|risk|emergency fund|insurance|term plan|premium|cover|credit score|cibil|credit report|minimum due|prepay\w*|interest rate|emi)\b/i

/** Tax to be worked out: a tax word, a working-out word, and an amount or a salary or regime word. */
const TAX = /\btax(?:es)?\b/i
const WORK_OUT = /\b(?:calculat\w*|comput\w*|work(?:ing)? out|estimat\w*|how much|tax on|payable|liability)\b/i
const SALARY_WORDS = /\b(?:salary|ctc|lpa|in[\s-]?hand|take[\s-]?home|income|regimes?|records?)\b/i

export function isTaxCalculation(text: string): boolean {
  return TAX.test(text) && WORK_OUT.test(text) && (SALARY_WORDS.test(text) || rupeeAmountsIn(text).length > 0)
}

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

export function routeQuestion(question: string): Route {
  const text = question.trim()
  if (SMALL_TALK.test(text)) return "neither"
  if (isProductPick(text)) return "knowledge"
  if (isTaxCalculation(text)) return "tax"
  const records = RECORDS.test(text)
  const knowledge = KNOWLEDGE.test(text)
  if (records && !knowledge) return "records"
  if (knowledge && !records) return "knowledge"
  return "both"
}
