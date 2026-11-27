/**
 * The words each rule rests on (`packages/legal-rules/catalogue/rule-quotes.json`), keyed by
 * instrument and rule id so every release of a rule shares them. A quote is copied word for word
 * from the stored text of the law (`catalogue/generated/`) or from the order's transcription
 * (`catalogue/orders/`), and `ruleQuotes.test.ts` fails when a new consolidation no longer prints
 * it: that is the signal to read the rule again. DOM-free.
 */

export interface RuleQuote {
  /** Catalogue id of the instrument quoted: "bc.fppr", "bc.omineca.ada-sra.2006". */
  source: string
  /** The section ("64") or the order's provision ("C.5"). */
  provision: string
  quote: string
}
export interface RuleQuotesFile {
  format: 'pgmaps-rule-quotes/v1'
  notice: string
  /** Pack id → rule id → quotes. */
  rules: Record<string, Record<string, RuleQuote[]>>
}

/** A statute quote stays short enough to read as the reason, not as the section. */
export const MAX_RULE_QUOTE_CHARS = 320

export const quotesFor = (file: RuleQuotesFile | null, packId: string, ruleId: string) =>
  file?.rules[packId]?.[ruleId] ?? []

let pending: Promise<RuleQuotesFile> | null = null
/** Loads the quotes once, on first use, as its own chunk. */
export function loadRuleQuotes() {
  pending ??= import('../../../packages/legal-rules/catalogue/rule-quotes.json').then(
    (m) => (m.default ?? m) as unknown as RuleQuotesFile,
  )
  return pending
}
