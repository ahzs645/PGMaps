/**
 * Where each stream crossing stands, and the block's roll-up of its crossings.
 *
 * The evaluator runs once per crossing record, over that crossing's own releases and facts, so one
 * crossing's authority never answers for another's. The block's roll-up is derived here every time
 * and never stored: the worst standing across the block's crossings under a schedule, with every
 * crossing at that standing listed by its label and its raised findings by title. A claimed
 * exception leaves its finding raised, as everywhere else; the standing counts it.
 *
 * DOM- and network-free.
 */
import { assess } from '../../../../packages/legal-rules/engine/evaluate'
import { releaseKey, type FactSet, type Pack } from '../../../../packages/legal-rules/src/contract'
import type { Plan, ReviewCase } from '../plan'
import { questions, type Finding } from '../review/questions'
import { crossingCurrent, crossingsOf, type CrossingRecord } from './record'

/**
 * `raised`: a rule needs review; `undated`: none is raised, but a release does not cover the review's
 * date, so its rules were not assessed; `open`: a rule waits on an answer and none is raised;
 * `clear`: every rule is settled; `unreviewed`: no release is chosen; `error`: the case could not be
 * evaluated. A crossing whose releases do not cover the date is never `clear`.
 */
export type CrossingStanding = 'error' | 'raised' | 'undated' | 'open' | 'unreviewed' | 'clear'
/** Worst first. */
export const STANDING_ORDER: readonly CrossingStanding[] = ['error', 'raised', 'undated', 'open', 'unreviewed', 'clear']
export const CROSSING_STANDING_WORDS: Record<CrossingStanding, string> = {
  error: 'Could not be evaluated',
  raised: 'Needs review',
  undated: 'Not assessed on this date',
  open: 'Needs an answer',
  unreviewed: 'No release chosen',
  clear: 'Nothing raised',
}

export interface RaisedFinding {
  pack: Pack
  finding: Finding
}

export interface CrossingAssessment {
  record: CrossingRecord
  /** Whether it was listed for the block's footprint as it stands now. */
  current: boolean
  standing: CrossingStanding
  /** Raised findings, in release then rule order. */
  raised: RaisedFinding[]
  /** Questions a rule waits on. */
  openQuestions: number
  /** Raised findings an exception is claimed on. */
  exceptions: number
  error?: string
  report?: ReturnType<typeof assess>
}

/** One review case evaluated as `CaseReview` evaluates it: a release with no facts yet reads as unanswered. */
export function assessCase(review: ReviewCase, library: Pack[]) {
  const packs = library.filter((p) => review.selected.includes(releaseKey(p)))
  const inputs: FactSet[] = packs.map(
    (p) =>
      review.sets[releaseKey(p)] ?? {
        format: 'pgmaps-legal-facts/v1',
        pack: p.id,
        version: p.version,
        source: 'Entered in the block planner',
        facts: [],
      },
  )
  return { packs, report: assess(review.date, packs, inputs) }
}

export function assessCrossing(plan: Plan, record: CrossingRecord, library: Pack[]): CrossingAssessment {
  const base = { record, current: crossingCurrent(plan, record), raised: [], openQuestions: 0, exceptions: 0 }
  let evaluated: ReturnType<typeof assessCase>
  try {
    evaluated = assessCase(record.review, library)
  } catch (e) {
    return {
      ...base,
      standing: 'error',
      error: e instanceof Error ? e.message : 'The crossing could not be evaluated.',
    }
  }
  const { packs, report } = evaluated
  const missing = record.review.selected.filter((k) => !packs.some((p) => releaseKey(p) === k))
  if (missing.length)
    return { ...base, standing: 'error', error: `Release not in this browser: ${missing.join(', ')}.`, report }
  const raised = report.releases.flatMap((release) =>
    release.findings.filter((f) => f.status === 'review_required').map((finding) => ({ pack: release.pack, finding })),
  )
  const openQuestions = report.releases.reduce(
    (n, release) =>
      n + questions(release.pack, release.facts, release.findings, new Set()).filter((q) => q.state === 'open').length,
    0,
  )
  const waiting = report.releases.some((release) => release.findings.some((f) => f.status === 'missing_evidence'))
  const undated = report.releases.some((release) => release.findings.some((f) => f.status === 'outside_source_window'))
  const standing: CrossingStanding = !packs.length
    ? 'unreviewed'
    : raised.length
      ? 'raised'
      : undated
        ? 'undated'
        : waiting
          ? 'open'
          : 'clear'
  return {
    ...base,
    standing,
    raised,
    openQuestions,
    exceptions: raised.filter(({ finding }) => 'exception' in finding && finding.exception).length,
    report,
  }
}

export const worseOf = (a: CrossingStanding, b: CrossingStanding) =>
  STANDING_ORDER.indexOf(a) <= STANDING_ORDER.indexOf(b) ? a : b

export interface CrossingRollup {
  /** The worst standing across the crossings, or null when the block lists none. */
  standing: CrossingStanding | null
  crossings: CrossingAssessment[]
  /** The crossings at the worst standing, each by its label. */
  worst: CrossingAssessment[]
}

/** The block's crossings under a schedule, each assessed on its own, and the worst of them. Never stored. */
export function crossingRollup(plan: Plan, block: string, schedule: string, library: Pack[]): CrossingRollup {
  const crossings = crossingsOf(plan, block, schedule).map((record) => assessCrossing(plan, record, library))
  if (!crossings.length) return { standing: null, crossings, worst: [] }
  const standing = crossings.map((c) => c.standing).reduce(worseOf)
  return { standing, crossings, worst: crossings.filter((c) => c.standing === standing) }
}

/** The roll-up in one line: "Needs review: Crossing A (Changes in and about a stream · authority)". */
export function rollupText(rollup: CrossingRollup): string {
  if (!rollup.standing) return 'No crossings listed.'
  const words = CROSSING_STANDING_WORDS[rollup.standing]
  const named = rollup.worst.map((c) =>
    c.raised.length ? `${c.record.label} (${c.raised.map((r) => r.finding.title).join('; ')})` : c.record.label,
  )
  return `${words}: ${named.join(' · ')}`
}
