/**
 * A rule's checks in words a forester reads: "Net area to be reforested is 63 ha, more than
 * 60 ha: met". Every figure is the evaluator's own; nothing is recomputed here.
 *
 * DOM- and network-free.
 */
import type { ExceptionStanding } from '../../../../packages/legal-rules/engine/evaluate'
import type { Fact, Pack, Scalar } from '../../../../packages/legal-rules/src/contract'

export type Status =
  | 'missing_evidence'
  | 'outside_scope'
  | 'outside_source_window'
  | 'condition_not_triggered'
  | 'review_required'

/** The planner's words for each finding status. Never "complies" or "approved": the rules are screens. */
export const STATUS_WORDS: Record<Status, string> = {
  review_required: 'Needs review',
  missing_evidence: 'To answer',
  condition_not_triggered: 'Not triggered',
  outside_scope: 'Does not apply',
  outside_source_window: 'Outside the release’s dates',
}

const OP_WORDS: Record<string, string> = {
  eq: 'is',
  ne: 'is not',
  in: 'is one of',
  gt: 'more than',
  gte: 'at least',
  lt: 'less than',
  lte: 'at most',
}

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 })

export function formatValue(fact: Fact | undefined, value: Scalar | Scalar[] | null): string {
  if (value === null) return 'not answered'
  if (Array.isArray(value)) return value.map((v) => formatValue(fact, v)).join(', ')
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'number') return number.format(value) + (fact?.unit ? ` ${fact.unit}` : '')
  return value
}

export interface CheckLine {
  fact: string
  operator: string
  expected: Scalar | Scalar[]
  actual: Scalar | null
  result: boolean | null
}

/** One check: what it asks, the answer given, and whether it held. */
export function describeCheck(pack: Pack, check: CheckLine) {
  const fact = pack.facts.find((f) => f.id === check.fact)
  const label = fact?.label ?? check.fact
  const numeric = ['gt', 'gte', 'lt', 'lte'].includes(check.operator)
  const asks = numeric
    ? `${label}: ${OP_WORDS[check.operator]} ${formatValue(fact, check.expected)}`
    : `${label} ${OP_WORDS[check.operator] ?? check.operator} ${formatValue(fact, check.expected)}`
  const answer = formatValue(fact, check.actual)
  const held = check.result === null ? 'unknown' : check.result ? 'met' : 'not met'
  return { asks, answer, held, result: check.result }
}

/** Where a claimed exception stands (the evaluator's `ExceptionStanding`), in words. */
export const STANDING_WORDS: Record<ExceptionStanding, string> = {
  relied_on: 'Exception relied on',
  unanswered: 'Exception: to answer',
  not_supported: 'Exception not supported',
  pending: 'Exception pending a decision',
  decided: 'Exception decided',
}
