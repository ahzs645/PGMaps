/**
 * What a block's and each of its crossings' reviews cannot answer from public data, derived every
 * time from the reviews as they stand and never stored.
 *
 * A fact the channel catalogue tags (`gapKindOfFact`) is a gap while it is unanswered and a rule
 * that is not settled reads it: a rule waiting on evidence (its scope while that is open, else its
 * trigger), or an exception claimed on a raised rule whose own conditions wait. Within a rule's
 * test, only the alternatives no answer has already ruled out count. A gap is *asked* when the
 * review's questions ask one of its facts now (`openFacts`); otherwise it *may be needed*, once
 * an earlier answer says the rule applies. The forest stewardship plan's identification is part
 * of the `fsp-amendment` gap until the reviewer states the plan and amendment.
 *
 * Ids are stable: `<kind>:<block>:<schedule>[:<crossing key>]`. A request kept for a gap that is
 * no longer derived (an answer, from public data or a received record, settled it) shows as no
 * longer needed.
 *
 * DOM- and network-free.
 */
import profile from '../../../../packages/legal-rules/forestry-profile.json'
import { releaseKey, type Expression, type FactSet, type Pack } from '../../../../packages/legal-rules/src/contract'
import { crossingsOf } from '../crossings/record'
import { assessCase } from '../crossings/standing'
import type { Plan, ReviewCase } from '../plan'
import { openFacts, type Finding } from '../review/questions'
import { bctsPlanOf, CHANNEL_CATALOGUE, channelOf, gapKindOf, gapKindOfFact, type GapKind } from './channels'
import { recordIdsOf } from './record'

export interface GapFact {
  pack: string
  /** The release the case uses. */
  release: string
  fact: string
  label: string
  /** Asked by the review now, rather than possibly needed later. */
  asked: boolean
}

export interface Gap {
  id: string
  kind: GapKind
  block: string
  schedule: string
  crossing?: string
  facts: GapFact[]
  /** What else the gap waits on that is no fact: the plan's identification. */
  statements: string[]
  asked: boolean
  /** The channels that can answer it, most direct first, for this block's holder. */
  channels: string[]
}

export const FSP_UNSTATED = 'Which plan and amendment the permit relied on (state it under Forest stewardship plan)'

export const gapId = (kind: GapKind, block: string, schedule: string, crossing?: string) =>
  [kind, block, schedule, ...(crossing ? [crossing] : [])].join(':')

/** The block's review as the review step shows it: its own, or a fresh one on the block releases. */
export const blockReviewOf = (plan: Pick<Plan, 'reviews'>, block: string): ReviewCase =>
  plan.reviews[block] ?? { selected: [...profile.blockReleases], date: profile.assessmentDate, sets: {} }

const unanswered = (facts: FactSet, id: string) => !facts.facts.some((f) => f.id === id && f.value !== null)

/** Facts with no answer yet in the alternatives no answer has ruled out. */
function openIn(stage: { result: boolean | null; trace: { fact: string; result: boolean | null }[][] }) {
  if (stage.result !== null) return []
  return stage.trace
    .filter((group) => !group.some((t) => t.result === false))
    .flatMap((group) => group.filter((t) => t.result === null).map((t) => t.fact))
}
const factsOf = (expression: Expression | undefined) => (expression ?? []).flat().map((c) => c.fact)

/** Every unanswered fact a rule that is not settled still reads. */
function waitingFacts(pack: Pack, facts: FactSet, finding: Finding): string[] {
  const rule = pack.rules.find((r) => r.id === finding.rule)
  if (!rule) return []
  if (finding.status === 'review_required')
    return 'exception' in finding && finding.exception?.condition ? openIn(finding.exception.condition) : []
  if (finding.status !== 'missing_evidence') return []
  const scope = 'scope' in finding ? (finding.scope as Parameters<typeof openIn>[0]) : undefined
  if (scope && scope.result === null)
    // The trigger is not tested while the scope is open: everything it reads may be needed.
    return [...openIn(scope), ...factsOf(rule.when).filter((id) => unanswered(facts, id))]
  return 'condition' in finding ? openIn(finding.condition as Parameters<typeof openIn>[0]) : []
}

interface CaseFact extends GapFact {
  kind: GapKind
}

/** A review case's tagged facts that are gaps. */
export function caseGapFacts(review: ReviewCase, library: Pack[]): CaseFact[] {
  let evaluated: ReturnType<typeof assessCase>
  try {
    evaluated = assessCase(review, library)
  } catch {
    return []
  }
  const out = new Map<string, CaseFact>()
  for (const release of evaluated.report.releases) {
    const asked = new Set(release.findings.flatMap((f) => openFacts(f)))
    for (const finding of release.findings)
      for (const id of waitingFacts(release.pack, release.facts, finding)) {
        const entry = gapKindOfFact(release.pack.id, id)
        if (!entry || !unanswered(release.facts, id)) continue
        const key = `${releaseKey(release.pack)}:${id}`
        const previous = out.get(key)
        out.set(key, {
          kind: entry.kind,
          pack: release.pack.id,
          release: releaseKey(release.pack),
          fact: id,
          label: release.pack.facts.find((f) => f.id === id)?.label ?? id,
          asked: asked.has(id) || !!previous?.asked,
        })
      }
  }
  return [...out.values()]
}

/** Whether the block is BC Timber Sales': from the tenure answered, else the plan the reviewer stated; null when neither says. */
export function blockIsBcts(plan: Plan, block: string): boolean | null {
  const review = blockReviewOf(plan, block)
  const tenure = Object.values(review.sets)
    .filter((s) => s.pack === 'bc.forest-permits')
    .map((s) => s.facts.find((f) => f.id === 'tenure')?.value)
    .find((v) => typeof v === 'string')
  if (typeof tenure === 'string') return /BC Timber Sales/.test(tenure)
  const fsp = recordIdsOf(plan, block).fsp
  return fsp ? Boolean(bctsPlanOf(fsp.id)) : null
}

/** A gap kind's channels for this block: BC Timber Sales' only for a BCTS block, the holder's only for another's. */
export function channelsFor(kind: GapKind, bcts: boolean | null): string[] {
  return gapKindOf(kind).channels.filter((id) => {
    const c = channelOf(id)
    return !c || c.bcts === undefined || bcts === null || c.bcts === bcts
  })
}

function gather(
  facts: CaseFact[],
  base: { block: string; schedule: string; crossing?: string },
  bcts: boolean | null,
  subject: 'block' | 'crossing',
): Map<GapKind, Gap> {
  const gaps = new Map<GapKind, Gap>()
  for (const f of facts) {
    if (gapKindOf(f.kind).subject !== subject) continue
    const gap = gaps.get(f.kind) ?? {
      id: gapId(f.kind, base.block, base.schedule, base.crossing),
      kind: f.kind,
      ...base,
      facts: [],
      statements: [],
      asked: false,
      channels: channelsFor(f.kind, bcts),
    }
    gap.facts.push({ pack: f.pack, release: f.release, fact: f.fact, label: f.label, asked: f.asked })
    gap.asked ||= f.asked
    gaps.set(f.kind, gap)
  }
  return gaps
}

/**
 * Every gap of a block and its crossings under a schedule, block first, then each crossing in the
 * order it was listed, each in the catalogue's order of kinds.
 */
export function blockGaps(plan: Plan, library: Pack[], block: string, schedule: string): Gap[] {
  if (!plan.blocks.some((b) => b.id === block) || !plan.schedules.some((s) => s.id === schedule)) return []
  const bcts = blockIsBcts(plan, block)
  const review = blockReviewOf(plan, block)
  const own = gather(caseGapFacts(review, library), { block, schedule }, bcts, 'block')
  // The plan's identification: needed while the permit release is chosen and the plan is not stated.
  const fsp = recordIdsOf(plan, block).fsp
  if (review.selected.some((k) => k.startsWith('bc.forest-permits@')) && (!fsp || !fsp.amendment)) {
    const gap = own.get('fsp-amendment') ?? {
      id: gapId('fsp-amendment', block, schedule),
      kind: 'fsp-amendment' as const,
      block,
      schedule,
      facts: [],
      statements: [],
      asked: false,
      channels: channelsFor('fsp-amendment', bcts),
    }
    gap.statements.push(FSP_UNSTATED)
    gap.asked = true
    own.set('fsp-amendment', gap)
  }
  const order = (gaps: Map<GapKind, Gap>) =>
    CHANNEL_CATALOGUE.gaps.flatMap((g) => (gaps.has(g.kind) ? [gaps.get(g.kind)!] : []))
  const crossings = crossingsOf(plan, block, schedule).flatMap((c) =>
    order(gather(caseGapFacts(c.review, library), { block, schedule, crossing: c.key }, bcts, 'crossing')),
  )
  return [...order(own), ...crossings]
}

/** The gaps of every block under the schedule under review. */
export function planGaps(plan: Plan, library: Pack[], schedule = plan.reviewSchedule): Gap[] {
  return plan.blocks.flatMap((b) => blockGaps(plan, library, b.id, schedule))
}

/** The subject of a gap, in words: the block, or the crossing by its label. */
export function gapSubject(plan: Plan, gap: Pick<Gap, 'block' | 'crossing'>): string {
  const block = plan.blocks.find((b) => b.id === gap.block)?.name ?? gap.block
  if (!gap.crossing) return block
  const crossing = plan.crossings?.find((c) => c.key === gap.crossing)
  return `${block} · ${crossing?.label ?? gap.crossing}`
}
