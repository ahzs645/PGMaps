import { describe, expect, it } from 'vitest'
import { assess } from '../../../../packages/legal-rules/engine/evaluate'
import {
  checkFactLinks,
  linkedFactGroups,
  parseFacts,
  parsePack,
  releaseKey,
  type Pack,
  type Scalar,
} from '../../../../packages/legal-rules/src/contract'
import profile from '../../../../packages/legal-rules/forestry-profile.json'
import permitsPack from '../../../../packages/legal-rules/packs/bc-forest-permits.json'
import permits110 from '../../../../packages/legal-rules/packs/bc-forest-permits-v1.1.0.json'
import operationsPack from '../../../../packages/legal-rules/packs/bc-forest-operations.json'
import type { ReviewCase } from '../plan'
import { setFact } from './caseEdits'
import { recordLinkedAnswer, setLinkedFact, sharedQuestion } from './linkedFacts'
import { questions } from './questions'

const permits = parsePack(permitsPack)
const earlierPermits = parsePack(permits110)
const operations = parsePack(operationsPack)
// The review lists releases in the library's order: operations, then permits.
const packs = [operations, permits]
const FLA = 'landscape-area'
const fresh = (selected: Pack[] = packs): ReviewCase => ({
  selected: selected.map(releaseKey),
  date: '2026-11-17',
  sets: {},
})
const valueOf = (review: ReviewCase, pack: Pack, id = FLA) =>
  review.sets[releaseKey(pack)]?.facts.find((f) => f.id === id)?.value ?? null

function findings(review: ReviewCase, used: Pack[] = packs) {
  const report = assess(
    review.date,
    used,
    used.map((p) => review.sets[releaseKey(p)] ?? parseFacts(empty(p), p)),
  )
  return report.releases.map((r) => r.findings.map((f) => [f.rule, f.status]))
}
const empty = (p: Pack) => ({
  format: 'pgmaps-legal-facts/v1' as const,
  pack: p.id,
  version: p.version,
  source: 'test',
  facts: [],
})
/** What each release's own questions list, as the review reads it. */
function listedIn(review: ReviewCase, used: Pack[] = packs) {
  const report = assess(
    review.date,
    used,
    used.map((p) => review.sets[releaseKey(p)] ?? empty(p)),
  )
  return (pack: Pack, id: string) =>
    questions(
      pack,
      report.releases.find((r) => releaseKey(r.pack) === releaseKey(pack))!.facts,
      report.releases.find((r) => releaseKey(r.pack) === releaseKey(pack))!.findings,
      new Set(),
    ).some((q) => q.fact.id === id)
}
const shared = (review: ReviewCase, pack: Pack, used: Pack[] = packs) =>
  sharedQuestion(review, used, pack, FLA, listedIn(review, used))

describe('linked facts: one question two instruments ask', () => {
  it('links the forest landscape area question of the permit and forest operations packs', () => {
    expect(profile.blockReleases).toEqual(expect.arrayContaining([releaseKey(permits), releaseKey(operations)]))
    expect(permits.facts.find((f) => f.id === FLA)?.sameAs).toBe('bc.forest-operations:landscape-area')
    expect(operations.facts.find((f) => f.id === FLA)?.sameAs).toBe('bc.forest-permits:landscape-area')
    const groups = linkedFactGroups(packs)
    expect(groups.map((g) => g.map((m) => `${m.pack.id}:${m.fact.id}`))).toEqual([
      ['bc.forest-operations:landscape-area', 'bc.forest-permits:landscape-area'],
    ])
    // Every release of each instrument the library holds is checked, older ones included.
    const shipped = Object.values(
      import.meta.glob('../../../../packages/legal-rules/packs/*.json', { eager: true, import: 'default' }),
    ).map(parsePack)
    expect(shipped.some((p) => releaseKey(p) === releaseKey(earlierPermits))).toBe(true)
    expect(() => checkFactLinks(shipped)).not.toThrow()
  })

  it('refuses a link to a fact that is missing, takes other answers, or names a third fact', () => {
    const withFact = (pack: Pack, id: string, change: object): Pack => ({
      ...pack,
      facts: pack.facts.map((f) => (f.id === id ? { ...f, ...change } : f)),
    })
    const missing = withFact(operations, FLA, { sameAs: 'bc.forest-permits:no-such-fact' })
    expect(() => checkFactLinks([missing, permits])).toThrow(/not found/)
    const otherChoices = withFact(permits, FLA, { choices: ['No', 'Yes'], sameAs: undefined })
    expect(() => checkFactLinks([operations, otherChoices])).toThrow(/different answers/)
    const otherType = withFact(permits, FLA, { type: 'boolean', choices: undefined, sameAs: undefined })
    expect(() => checkFactLinks([operations, otherType])).toThrow(/different answers/)
    const elsewhere = withFact(permits, FLA, { sameAs: 'bc.forest-operations:holder' })
    expect(() => checkFactLinks([operations, elsewhere])).toThrow(/name each other/)
    // A link inside one instrument, or not in the `pack:fact` form, does not parse.
    expect(() => parsePack(withFact(operations, FLA, { sameAs: 'bc.forest-operations:holder' }))).toThrow(
      /another instrument/,
    )
    expect(() => parsePack(withFact(operations, FLA, { sameAs: 'landscape-area' }))).toThrow()
    // A mismatched pair is never linked in a review either.
    expect(linkedFactGroups([operations, otherChoices])).toEqual([])
  })

  it('asks it once: the first release asks, the other says where it is asked', () => {
    const review = fresh()
    expect(shared(review, operations)).toEqual({ kind: 'ask', also: [permits] })
    expect(shared(review, permits)).toEqual({ kind: 'elsewhere', under: operations, value: null })
  })

  it('copies an answer into the other release’s own facts, and a change or a clear to both', () => {
    let review = setLinkedFact(fresh(), packs, operations, FLA, 'Yes')
    expect(valueOf(review, operations)).toBe('Yes')
    expect(valueOf(review, permits)).toBe('Yes')
    // Each fact set is its own release's, and parses against that release alone.
    expect(() => parseFacts(review.sets[releaseKey(permits)], permits)).not.toThrow()
    expect(review.sets[releaseKey(permits)].facts[0].evidence).toMatch(/under BC forest operations plans/)
    expect(shared(review, permits)).toEqual({ kind: 'elsewhere', under: operations, value: 'Yes' })
    // Changed from the release that shows the line, both change.
    review = setLinkedFact(review, packs, permits, FLA, 'Partly')
    expect([valueOf(review, operations), valueOf(review, permits)]).toEqual(['Partly', 'Partly'])
    review = setLinkedFact(review, packs, operations, FLA, undefined)
    expect([valueOf(review, operations), valueOf(review, permits)]).toEqual([null, null])
    expect(review.sets[releaseKey(permits)].facts).toEqual([])
  })

  it('never overwrites a differing answer: both are shown until the reviewer chooses one', () => {
    // A review saved before the link, answered differently in each release.
    let review = setFact(setFact(fresh(), operations, FLA, 'Yes'), permits, FLA, 'No')
    const conflict = shared(review, operations)
    expect(conflict).toEqual({
      kind: 'conflict',
      answers: [
        { pack: operations, value: 'Yes' },
        { pack: permits, value: 'No' },
      ],
    })
    expect(shared(review, permits)).toEqual({ kind: 'differs', under: operations })
    // Changing one without choosing for both leaves the other as it was.
    const one = setLinkedFact(review, packs, operations, FLA, 'Partly')
    expect([valueOf(one, operations), valueOf(one, permits)]).toEqual(['Partly', 'No'])
    // The reviewer's choice of one answer for both sets both.
    review = setLinkedFact(review, packs, operations, FLA, 'No', { resolve: true })
    expect([valueOf(review, operations), valueOf(review, permits)]).toEqual(['No', 'No'])
    expect(shared(review, permits)).toEqual({ kind: 'elsewhere', under: operations, value: 'No' })
  })

  it('opens an older review on the earlier permit release, replaying it unchanged', () => {
    const used = [operations, earlierPermits]
    const saved = setFact(fresh(used), earlierPermits, FLA, 'No')
    const before = findings(saved, used)
    // Nothing is written on opening: the answer under the earlier release is offered, not copied.
    expect(shared(saved, operations, used)).toEqual({ kind: 'unrecorded', under: earlierPermits, value: 'No' })
    expect(shared(saved, earlierPermits, used)).toEqual({ kind: 'ask', also: [operations] })
    expect(findings(saved, used)).toEqual(before)
    expect(saved.sets[releaseKey(operations)]).toBeUndefined()
    // Recorded on the reviewer's click, into the forest operations release's own facts.
    const recorded = recordLinkedAnswer(saved, used, operations, FLA, earlierPermits)
    expect(valueOf(recorded, operations)).toBe('No')
    expect(recorded.sets[releaseKey(earlierPermits)]).toEqual(saved.sets[releaseKey(earlierPermits)])
  })

  it('leaves each pack’s findings as its own facts give them', () => {
    const answers: Record<string, Scalar>[] = [
      { [FLA]: 'Yes', 'fop-held': false },
      { [FLA]: 'No', fdu: true },
      { [FLA]: 'Partly' },
    ]
    for (const answer of answers) {
      let linked = fresh()
      for (const [id, value] of Object.entries(answer))
        for (const pack of packs)
          if (pack.facts.some((f) => f.id === id)) linked = setLinkedFact(linked, packs, pack, id, value)
      let separate = fresh()
      for (const [id, value] of Object.entries(answer))
        for (const pack of packs) if (pack.facts.some((f) => f.id === id)) separate = setFact(separate, pack, id, value)
      expect(findings(linked)).toEqual(findings(separate))
      // Each pack alone, from its own facts, gives the same findings it gives in the case.
      for (const [i, pack] of packs.entries()) expect(findings(linked, [pack])[0]).toEqual(findings(linked)[i])
    }
  })
})
