/**
 * The two D.5 pathways of the 2004 Prince George order as checklists, read from the landscape
 * review's answers, the patch calculation and the planner's records. A step is never marked done
 * by the model alone where the order asks for a person's determination, and nothing here says a
 * pathway is approved, met or permitted: D.5(a) is approved by the minister's designate, D.5(b) is
 * submitted, and both are outside this tool.
 *
 * DOM- and network-free.
 */
import { firstShortfall, oldForestCurrent } from '../records'
import type { FactSet } from '../../../../packages/legal-rules/src/contract'
import { entryOf, periodYears, type Plan } from '../plan'
import type { PlanAnalysis } from '../planAnalysis'

export type StepState = 'done' | 'open' | 'blocked' | 'not-needed'

export interface PathwayStep {
  id: string
  label: string
  state: StepState
  detail: string
}

export interface Pathway {
  id: 'D.5(a)' | 'D.5(b)'
  title: string
  /** One line for the card's header. */
  status: string
  steps: PathwayStep[]
}

const answer = (facts: FactSet | undefined, id: string) => {
  const value = facts?.facts.find((f) => f.id === id)?.value
  return value === undefined ? null : value
}

/** The default trend interval: the first period after the schedule under review first cuts. */
export function defaultTrendYear(plan: Plan): number {
  const years = periodYears(plan.area.startYear)
  const cuts = plan.blocks
    .map((b) => entryOf(plan, plan.reviewSchedule, b.id).year)
    .filter((y): y is number => y !== null)
  const first = cuts.length ? Math.min(...cuts) : plan.area.startYear
  return years.find((y) => y > first) ?? years[1]
}

export const trendYearOf = (plan: Plan) => {
  const years = periodYears(plan.area.startYear)
  const chosen = plan.landscape.trendYear
  return chosen !== undefined && years.indexOf(chosen) > 0 ? chosen : defaultTrendYear(plan)
}

/** Whether a class of the schedule under review moved away from its target over the trend interval. */
export function measuredTrend(plan: Plan, result: PlanAnalysis | undefined) {
  if (!result) return null
  const year = trendYearOf(plan)
  const run = result.runs.find((r) => r.schedule === plan.reviewSchedule)
  const index = periodYears(plan.area.startYear).indexOf(year)
  return run && index > 0 ? { year, movedAway: run.movedAway[index] } : null
}

/** Whether the plan compares the proposal with no further harvest and at least one other schedule. */
export function alternativesCompared(plan: Plan) {
  const cutsNothing = plan.schedules.filter((s) => plan.blocks.every((b) => entryOf(plan, s.id, b.id).year === null))
  const others = plan.schedules.filter((s) => s.id !== plan.reviewSchedule && !cutsNothing.includes(s))
  return { cutsNothing: cutsNothing.length > 0, others: others.length, total: plan.schedules.length }
}

export function pathways(plan: Plan, facts: FactSet | undefined, result: PlanAnalysis | undefined): Pathway[] {
  const applies = answer(facts, 'applicable')
  const trend = measuredTrend(plan, result)
  const compared = alternativesCompared(plan)
  const { a = {}, b = {} } = plan.landscape.pathways ?? {}
  const applyStep: PathwayStep = {
    id: 'applies',
    label: 'The order applies here',
    state: applies === true ? 'done' : applies === false ? 'blocked' : 'open',
    detail:
      applies === true
        ? 'Recorded by the reviewer.'
        : applies === false
          ? 'Recorded as not applying: neither pathway is needed.'
          : 'Answer the order’s applicability question below: footprint, tenure, date, plan, exclusions and later orders.',
  }

  const patchNeeded = answer(facts, 'patch-unachievable')
  const rationaleSteps: PathwayStep[] = [
    applyStep,
    {
      id: 'trend',
      label: 'Trend measured',
      state: trend && trend.movedAway !== null ? 'done' : 'open',
      detail: trend
        ? trend.movedAway === null
          ? `No complete distribution for ${trend.year - 5}–${trend.year}.`
          : `${trend.year - 5}–${trend.year}: ${trend.movedAway ? 'a class moved farther from its target' : 'no class moved farther from its target'} (schedule under review, method pg-2005-buffer-v1).`
        : 'Set the reporting unit (step 1) so the patches can be calculated.',
    },
    {
      id: 'determination',
      label: 'Determination: the patch objective cannot be achieved',
      state: patchNeeded === true ? 'done' : patchNeeded === false ? 'not-needed' : 'open',
      detail:
        patchNeeded === null
          ? 'A professional determination, recorded below. A worsening class alone does not make it.'
          : patchNeeded
            ? 'Recorded by the reviewer.'
            : 'Recorded as achievable: no rationale is needed.',
    },
    {
      id: 'alternatives',
      label: 'Alternatives compared',
      state: compared.cutsNothing && compared.others > 0 ? 'done' : 'open',
      detail: `${compared.total} schedules: ${compared.cutsNothing ? 'one cuts nothing' : 'none cuts nothing'}, ${compared.others} alternative${compared.others === 1 ? '' : 's'} beside the proposal. The rationale has to say why quicker routes are impracticable.`,
    },
    {
      id: 'rationale',
      label: 'Rationale drafted',
      state: plan.landscape.rationale?.trim() ? 'done' : 'open',
      detail:
        'Results or strategies for a forest condition consistent with the objective in the shortest practicable time, considering timber harvesting rights.',
    },
    {
      id: 'submitted',
      label: 'Rationale submitted',
      state: b.submitted ? 'done' : 'open',
      detail: b.submitted
        ? `Submitted ${b.submitted}${b.reference ? ` · ${b.reference}` : ''}. D.5(b) asks for submission; it names no approval.`
        : 'Record the date and reference once submitted. D.5(b) asks for submission; it names no approval.',
    },
  ]

  const oldNeeded = answer(facts, 'old-unachievable')
  const recruitmentSteps: PathwayStep[] = [
    applyStep,
    {
      id: 'determination',
      label: 'Determination: old or old-interior forest cannot be achieved',
      state: oldNeeded === true ? 'done' : oldNeeded === false ? 'not-needed' : 'open',
      detail:
        oldNeeded === null
          ? 'A professional determination, recorded below, considering timely and economic harvesting of timber rights.'
          : oldNeeded
            ? 'Recorded by the reviewer.'
            : 'Recorded as achievable: no recruitment strategy is needed.',
    },
    {
      id: 'analysis',
      label: 'Recruitment analysis',
      state: a.analysis?.trim() ? 'done' : 'open',
      detail: oldForestEvidence(plan),
    },
    {
      id: 'strategy',
      label: 'Strategy drafted',
      state: a.strategy?.trim() ? 'done' : 'open',
      detail: 'How the recruitment reaches the objective in the shortest practicable time.',
    },
    {
      id: 'submitted',
      label: 'Strategy submitted',
      state: a.submitted ? 'done' : 'open',
      detail: a.submitted ? `Submitted ${a.submitted}.` : 'Record the date once submitted.',
    },
    {
      id: 'approved',
      label: 'Approved by the minister’s designate',
      state: a.approved ? 'done' : 'open',
      detail: a.approved
        ? `Approved ${a.approved}${a.approver ? ` by ${a.approver}` : ''}${a.reference ? ` · ${a.reference}` : ''}.`
        : 'D.5(a) requires approval before the strategy is followed. Record the decision, who made it and its reference.',
    },
  ]

  const summarise = (steps: PathwayStep[], done: string): string => {
    if (steps.some((s) => s.state === 'blocked')) return 'Does not apply'
    if (steps.some((s) => s.state === 'not-needed')) return 'Not needed'
    const count = steps.filter((s) => s.state === 'done').length
    return count === steps.length ? done : `${count} of ${steps.length} steps`
  }
  return [
    {
      id: 'D.5(b)',
      title: 'Young-forest patch rationale',
      status: summarise(rationaleSteps, 'Submitted'),
      steps: rationaleSteps,
    },
    {
      id: 'D.5(a)',
      title: 'Old-forest recruitment strategy',
      status: summarise(recruitmentSteps, 'Approved'),
      steps: recruitmentSteps,
    },
  ]
}

/**
 * What PGMaps' own A/B calculation says, for the reviewer to weigh: shown beside the step, never
 * written into the determination or the analysis field (docs/forestry-old-forest.md, decision 8).
 */
function oldForestEvidence(plan: Plan): string {
  const record = plan.checks?.oldForest
  const ask = 'Name the analysis relied on and its date.'
  if (!record) return `Not calculated here: Compare → Old and old interior forest calculates it for one unit. ${ask}`
  const run = record.schedules.find((s) => s.schedule === plan.reviewSchedule)
  const first = run ? firstShortfall(run.years) : null
  const when = oldForestCurrent(plan) ? `calculated ${record.ranOn}` : `calculated ${record.ranOn}, out of date`
  return `PGMaps (${record.unit}, ${when}, VRI age-based): ${
    first
      ? `the schedule under review falls short of ${first.what.join(', ')} from ${first.year}`
      : 'no shortfall over the projection for the schedule under review'
  }. Evidence only; the determination and the analysis named are yours. ${ask}`
}
