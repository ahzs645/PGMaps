/**
 * Changes to one review case: which release of each instrument it uses, the facts entered and the
 * exceptions claimed.
 * DOM- and network-free.
 */
import {
  releaseKey,
  type Claim,
  type FactSet,
  type Pack,
  type Scalar,
} from '../../../../packages/legal-rules/src/contract'
import type { ReviewCase } from '../plan'

export const instrumentOf = (key: string) => key.slice(0, key.lastIndexOf('@'))

/** Uses `release` for its instrument, or stops using the instrument when `release` is null. */
export function chooseRelease(review: ReviewCase, instrument: string, release: Pack | null): ReviewCase {
  const selected = review.selected.filter((key) => instrumentOf(key) !== instrument)
  return { ...review, selected: release ? [...selected, releaseKey(release)] : selected }
}

/** Sets or clears one fact. Evidence is kept when only the value changes. */
export function setFact(
  review: ReviewCase,
  pack: Pack,
  id: string,
  value: Scalar | undefined,
  evidence?: string,
): ReviewCase {
  const key = releaseKey(pack)
  const set = review.sets[key] ?? emptySet(pack)
  const previous = set.facts.find((f) => f.id === id)
  const facts = set.facts.filter((f) => f.id !== id)
  if (value !== undefined)
    facts.push({ id, value, evidence: evidence?.trim() || previous?.evidence || 'Entered in the block planner' })
  return { ...review, sets: { ...review.sets, [key]: { ...set, facts } } }
}

const emptySet = (pack: Pack): FactSet => ({
  format: 'pgmaps-legal-facts/v1',
  pack: pack.id,
  version: pack.version,
  source: 'Entered in the block planner',
  facts: [],
})

/**
 * Claims, changes or withdraws the exception relied on for one rule. A claim is the reviewer's
 * record beside the answers, never a fact; withdrawing the last one leaves no `claims` key.
 */
export function setClaim(review: ReviewCase, pack: Pack, rule: string, claim: Claim | undefined): ReviewCase {
  const key = releaseKey(pack)
  const set = review.sets[key] ?? emptySet(pack)
  const claims = [...(set.claims ?? []).filter((c) => c.rule !== rule), ...(claim ? [claim] : [])]
  const next: FactSet = { ...set, claims }
  if (!claims.length) delete next.claims
  return { ...review, sets: { ...review.sets, [key]: next } }
}

/** The releases a case names that are not built in, so a saved plan opens anywhere. */
export function extraPacks(reviews: ReviewCase[], library: Pack[], builtIn: Pack[]): Pack[] {
  const bundled = new Set(builtIn.map(releaseKey))
  const used = new Set(reviews.flatMap((r) => r.selected))
  return library.filter((p) => used.has(releaseKey(p)) && !bundled.has(releaseKey(p)))
}
