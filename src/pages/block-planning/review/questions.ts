/**
 * Which questions a review still needs, read from the evaluator's own trace, so the form shows
 * what the answers so far have unlocked rather than every fact of every rule.
 *
 * A rule that is settled (out of scope, not triggered, needing review, outside its dates) asks
 * nothing more. A rule waiting on evidence asks only for the unknown facts of the stage it is
 * stuck at, in the alternatives that are still open, and of each alternative only its first
 * unknown: scope before trigger, so a trigger's questions appear once the rule is known to apply. A raised rule
 * asks only what an exception claimed on it waits on. Facts already answered stay listed so they
 * can be changed. Facts a measurement fills are never asked.
 *
 * DOM- and network-free.
 */
import type { assess } from '../../../../packages/legal-rules/engine/evaluate'
import type { Fact, FactSet, Pack } from '../../../../packages/legal-rules/src/contract'

export type Finding = ReturnType<typeof assess>['releases'][number]['findings'][number]
type Stage = { result: boolean | null; trace: { fact: string; result: boolean | null }[][] }

export interface Question {
  fact: Fact
  /** `answered`: has a value; `open`: a rule waits on it; `measured`: filled by the planner's model. */
  state: 'answered' | 'open' | 'measured'
  /** The rules waiting on it (open) or reading it (answered). */
  rules: string[]
}

function waitingOn(stage: Stage | undefined): string[] {
  if (!stage || stage.result !== null) return []
  return (
    stage.trace
      .filter((group) => !group.some((t) => t.result === false))
      // A group holds only if every check holds, so its first unknown is the one worth asking: a "no"
      // ends the group and its other questions are never needed.
      .flatMap((group) =>
        group
          .filter((t) => t.result === null)
          .slice(0, 1)
          .map((t) => t.fact),
      )
  )
}

/** The facts each finding still waits on. Empty for a settled rule. */
export function openFacts(finding: Finding): string[] {
  // A claimed exception whose own conditions wait on an answer asks for it.
  if (finding.status === 'review_required')
    return 'exception' in finding && finding.exception?.condition ? waitingOn(finding.exception.condition) : []
  if (finding.status !== 'missing_evidence') return []
  const scope = 'scope' in finding ? (finding.scope as Stage) : undefined
  if (scope && scope.result === null) return waitingOn(scope)
  return waitingOn('condition' in finding ? (finding.condition as Stage) : undefined)
}

export function questions(pack: Pack, facts: FactSet, findings: Finding[], measured: ReadonlySet<string>): Question[] {
  const open = new Map<string, string[]>()
  for (const finding of findings)
    for (const id of new Set(openFacts(finding))) open.set(id, [...(open.get(id) ?? []), finding.rule])
  const readers = (id: string) =>
    pack.rules
      .filter((r) =>
        [...(r.scope ?? []), ...r.when, ...(r.exceptions ?? []).flatMap((x) => x.when ?? [])].some((group) =>
          group.some((c) => c.fact === id),
        ),
      )
      .map((r) => r.id)
  const rows: Question[] = []
  for (const fact of pack.facts) {
    const answered = facts.facts.some((f) => f.id === fact.id && f.value !== null)
    if (measured.has(fact.id)) rows.push({ fact, state: 'measured', rules: readers(fact.id) })
    else if (open.has(fact.id)) rows.push({ fact, state: 'open', rules: open.get(fact.id)! })
    else if (answered) rows.push({ fact, state: 'answered', rules: readers(fact.id) })
  }
  // The questions that unlock the most rules first (applicability, holder, region), then pack order.
  const order = new Map(pack.facts.map((f, i) => [f.id, i]))
  return rows.sort(
    (a, b) =>
      Number(b.state === 'open') - Number(a.state === 'open') ||
      b.rules.length - a.rules.length ||
      order.get(a.fact.id)! - order.get(b.fact.id)!,
  )
}

/**
 * How many rules a review has in each state, for a one-line summary. A rule outside its release's
 * dates was not assessed at all: it is counted apart, never as not applying.
 */
export function findingCounts(findings: Finding[]) {
  const counts = { review: 0, exception: 0, open: 0, clear: 0, notApplicable: 0, outsideDates: 0 }
  for (const f of findings) {
    if (f.status === 'review_required') {
      counts.review++
      if ('exception' in f && f.exception) counts.exception++
    } else if (f.status === 'missing_evidence') counts.open++
    else if (f.status === 'condition_not_triggered') counts.clear++
    else if (f.status === 'outside_source_window') counts.outsideDates++
    else counts.notApplicable++
  }
  return counts
}

/** A release whose dates do not cover the review's legal assessment date, and how many rules it left unassessed. */
export interface DateGap {
  pack: Pack
  date: string
  /** `before`: the date is earlier than the release's first day; `after`: later than its last. */
  side: 'before' | 'after'
  rules: number
}

/** The releases of an evaluated review whose dates do not cover its date, in release order. */
export function dateGaps(date: string, releases: { pack: Pack; findings: { status: string }[] }[]): DateGap[] {
  return releases.flatMap(({ pack, findings }) =>
    date < pack.coverage.from || date > pack.coverage.through
      ? [
          {
            pack,
            date,
            side: date < pack.coverage.from ? ('before' as const) : ('after' as const),
            rules: findings.filter((f) => f.status === 'outside_source_window').length,
          },
        ]
      : [],
  )
}

/**
 * The plain statement of a date gap: the release's own window, that its rules were not assessed, and
 * that this is never "does not apply". A date before the window is the law as it stood then, which
 * the release does not hold; a date after it is past what its stored text was checked to.
 */
export function dateGapText(gap: DateGap) {
  const { pack, date, side, rules } = gap
  const window =
    pack.coverage.from === pack.coverage.through
      ? `only ${pack.coverage.from}`
      : `${pack.coverage.from} to ${pack.coverage.through}`
  const why =
    side === 'before'
      ? `A review at an earlier date needs the law as it stood then (its consolidation and orders on that date), which this release does not hold.`
      : `Its stored text was checked to ${pack.coverage.through}; choose a release that covers the date, or a date this one covers.`
  return `${pack.title} ${pack.version} covers ${window}. The legal assessment date ${date} is ${side} that, so none of its ${rules} rule${rules === 1 ? ' was' : 's were'} assessed: they are not shown as applying or not applying. ${why}`
}
