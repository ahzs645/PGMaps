/**
 * Questions two instruments ask about the same fact (a pack's `sameAs`), asked once in a review.
 *
 * Each release keeps its own answer in its own fact set, so it replays exactly from that set alone:
 * an answer given under one is copied into the others, and clearing it clears them. Where they
 * already hold different answers (a review saved before the link), neither is overwritten until the
 * reviewer chooses one answer for both.
 *
 * DOM- and network-free.
 */
import {
  linkedFactGroups,
  releaseKey,
  type LinkedFact,
  type Pack,
  type Scalar,
} from '../../../../packages/legal-rules/src/contract'
import type { ReviewCase } from '../plan'
import { setFact } from './caseEdits'

/** How a linked question shows in one release of a review. */
export type SharedQuestion =
  /** Asked here; the answer is copied to `also`. */
  | { kind: 'ask'; also: Pack[] }
  /** Asked or answered under `under`, with the same answer here (`value`), or none yet. */
  | { kind: 'elsewhere'; under: Pack; value: Scalar | null }
  /** Answered under `under`, but not in this release's facts (a release added later, an older review). */
  | { kind: 'unrecorded'; under: Pack; value: Scalar }
  /** The releases hold different answers: the reviewer chooses one for both. */
  | { kind: 'conflict'; answers: { pack: Pack; value: Scalar | null }[] }
  /** The releases hold different answers, and the choice is offered under `under`. */
  | { kind: 'differs'; under: Pack }

const valueIn = (review: ReviewCase, m: LinkedFact): Scalar | null =>
  review.sets[releaseKey(m.pack)]?.facts.find((f) => f.id === m.fact.id)?.value ?? null

const groupOf = (packs: Pack[], pack: Pack, id: string) =>
  linkedFactGroups(packs).find((g) => g.some((m) => releaseKey(m.pack) === releaseKey(pack) && m.fact.id === id))

/**
 * How the question `id` of `pack` shows, among the releases `packs` used together, or null when it
 * is linked to none. `listed` says whether a release's own questions list it (it waits on it, or
 * holds an answer): the first such release in `packs` order asks it, the others point there.
 */
export function sharedQuestion(
  review: ReviewCase,
  packs: Pack[],
  pack: Pack,
  id: string,
  listed: (pack: Pack, id: string) => boolean,
): SharedQuestion | null {
  const group = groupOf(packs, pack, id)
  if (!group) return null
  const here = group.find((m) => releaseKey(m.pack) === releaseKey(pack))!
  const others = group.filter((m) => m !== here)
  const answers = group.map((m) => ({ member: m, value: valueIn(review, m) }))
  const given = answers.filter((a) => a.value !== null)
  const distinct = new Set(given.map((a) => JSON.stringify(a.value)))
  const first = answers.find((a) => listed(a.member.pack, a.member.fact.id)) ?? answers[0]
  if (distinct.size > 1)
    return first.member === here
      ? { kind: 'conflict', answers: answers.map((a) => ({ pack: a.member.pack, value: a.value })) }
      : { kind: 'differs', under: first.member.pack }
  const owner = given[0] ?? first
  if (owner.member === here) return { kind: 'ask', also: others.map((m) => m.pack) }
  const value = valueIn(review, here)
  if (value === null && owner.value !== null)
    return { kind: 'unrecorded', under: owner.member.pack, value: owner.value }
  return { kind: 'elsewhere', under: owner.member.pack, value }
}

/**
 * Sets or clears a fact and the facts linked to it, each in its own release's facts. A linked fact
 * holding a different answer is left as it is unless `resolve` (the reviewer chose one answer for
 * both), so a disagreement is never settled behind the reviewer's back.
 */
export function setLinkedFact(
  review: ReviewCase,
  packs: Pack[],
  pack: Pack,
  id: string,
  value: Scalar | undefined,
  { resolve = false }: { resolve?: boolean } = {},
): ReviewCase {
  const group = groupOf(packs, pack, id)
  const before = group ? valueIn(review, group.find((m) => releaseKey(m.pack) === releaseKey(pack))!) : null
  let next = setFact(review, pack, id, value)
  for (const m of group ?? []) {
    if (releaseKey(m.pack) === releaseKey(pack)) continue
    const theirs = valueIn(review, m)
    if (!resolve && theirs !== null && JSON.stringify(theirs) !== JSON.stringify(before)) continue
    next = setFact(
      next,
      m.pack,
      m.fact.id,
      value,
      value === undefined ? undefined : `Entered in the block planner under ${pack.title}, the same question`,
    )
  }
  return next
}

/** Records under `pack` the answer its linked question already has under `under`. */
export function recordLinkedAnswer(review: ReviewCase, packs: Pack[], pack: Pack, id: string, under: Pack) {
  const group = groupOf(packs, pack, id)
  const source = group?.find((m) => releaseKey(m.pack) === releaseKey(under))
  const value = source ? valueIn(review, source) : null
  return source && value !== null ? setLinkedFact(review, packs, under, source.fact.id, value) : review
}
