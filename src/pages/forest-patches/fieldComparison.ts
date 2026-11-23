import { periodCalculator, type Period } from './analysis'
import { classMovements, trendsAway } from './legalEvidence'
import type { FieldComparison } from './explanation'
import { bins, disturbanceBasis, order, table, type Project, type Scenario } from './project'

export interface FieldInput {
  project: Project
  year: number
  scenario: Scenario
  id: string
  earliest: number
  latest: number
  source: string
}
export interface PriorityInput {
  project: Project
  year: number
  scenario: Scenario
  tolerance: number
}
function largestShift(base: Period, candidate: Period) {
  if (!base.totalHa || !candidate.totalHa) return { maxClassShift: null, mostAffected: null }
  const shifts = bins.map((_, i) => Math.abs(base.classes[i].percent! - candidate.classes[i].percent!))
  const maxClassShift = Math.max(...shifts)
  return { maxClassShift, mostAffected: maxClassShift > 1e-8 ? table.labels[shifts.indexOf(maxClassShift)] : null }
}
function compareWithBaseline(
  inputs: FieldInput,
  period: ReturnType<typeof periodCalculator>,
  baseline: Period,
  previous?: Period,
): FieldComparison {
  const { project, year, scenario, id, source, earliest, latest } = inputs
  const footprint = project.features.find((f) => f.properties.id === id)
  if (!footprint || (footprint.properties.scenario !== scenario && footprint.properties.scenario !== 'reference'))
    throw Error('Select a footprint on this schedule.')
  if (
    !source.trim() ||
    ![earliest, latest].every((n) => Number.isInteger(n) && n >= 1600 && n <= 2250) ||
    latest < earliest
  )
    throw Error('Enter a source and ordered disturbance years from 1600 to 2250.')
  // For integer event dates, a period changes only when the footprint enters or leaves its young window.
  // Partition at BOTH periods' boundaries, including cases where both interval endpoints give the same result.
  const [minAge, maxAge] = order.implementationPolicy.youngForestAgeYearsInclusive
  const boundaries = new Set([earliest, latest + 1])
  for (const y of previous ? [previous.year, year] : [year])
    for (const edge of [y - maxAge, y - minAge + 1]) if (edge > earliest && edge <= latest) boundaries.add(edge)
  const sorted = [...boundaries].sort((a, b) => a - b)
  const baselineMovements = classMovements(previous, baseline)
  const baselineScreen = trendsAway(baselineMovements)
  const cases = sorted.slice(0, -1).map((from, i) => {
    const override = { id, year: from }
    const after = period(year, scenario, override)
    const before = previous && period(previous.year, scenario, override)
    const movements = classMovements(before, after)
    return {
      from,
      through: sorted[i + 1] - 1,
      screen: trendsAway(movements),
      maxTrendShift:
        movements && baselineMovements
          ? Math.max(...movements.map((v, i) => Math.abs(v - baselineMovements[i])))
          : null,
      ...largestShift(baseline, after),
    }
  })
  const flips = cases.filter((c) => baselineScreen !== null && c.screen !== null && c.screen !== baselineScreen)
  const minFlipYears = flips.length
    ? Math.min(
        ...flips.map((c) => Math.max(c.from - footprint.properties.year, footprint.properties.year - c.through, 0)),
      )
    : null
  return {
    id,
    source,
    earliest,
    latest,
    baselineYear: footprint.properties.year,
    baselineScreen,
    cases,
    canFlip: flips.length > 0,
    minFlipYears,
    canLoseEvidence: baselineScreen !== null && cases.some((c) => c.screen === null),
  }
}
export function fieldComparison(input: FieldInput) {
  const { project, year, scenario } = input
  const period = periodCalculator(project, year, scenario)
  return compareWithBaseline(
    input,
    period,
    period(year, scenario),
    year > project.startYear ? period(year - 5, scenario) : undefined,
  )
}
export function fieldPriorities(input: PriorityInput) {
  const { project, year, scenario, tolerance } = input
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 650)
    throw Error('Enter a whole-year tolerance from 0 to 650.')
  const period = periodCalculator(project, year, scenario)
  const current = period(year, scenario),
    previous = year > project.startYear ? period(year - 5, scenario) : undefined
  const rows = project.features
    .filter((f) => f.properties.scenario === 'reference' || f.properties.scenario === scenario)
    .map((feature) => {
      const f = feature.properties
      const result = compareWithBaseline(
        {
          ...input,
          id: f.id,
          earliest: Math.max(1600, f.year - tolerance),
          latest: Math.min(2250, f.year + tolerance),
          source: 'Uniform disturbance-date sensitivity test',
        },
        period,
        current,
        previous,
      )
      const shifts = result.cases.map((c) => c.maxClassShift).filter((v) => v !== null)
      const trendShifts = result.cases.map((c) => c.maxTrendShift).filter((v) => v !== null)
      return {
        id: f.id,
        minFlipYears: result.minFlipYears,
        maxTrendShift: trendShifts.length ? Math.max(...trendShifts) : null,
        year: f.year,
        source: f.source ?? project.source,
        basis: disturbanceBasis(feature),
        canFlip: result.canFlip,
        canLoseEvidence: result.canLoseEvidence,
        canResolve: result.baselineScreen === null && result.cases.some((c) => c.screen !== null),
        maxClassShift: shifts.length ? Math.max(...shifts) : null,
      }
    })
  return {
    tolerance,
    year,
    scenario,
    baselineScreen: trendsAway(classMovements(previous, current)),
    rows: rows.sort(
      (a, b) =>
        Number(b.canFlip) - Number(a.canFlip) ||
        (a.minFlipYears ?? Infinity) - (b.minFlipYears ?? Infinity) ||
        Number(b.canResolve || b.canLoseEvidence) - Number(a.canResolve || a.canLoseEvidence) ||
        (b.maxTrendShift ?? -1) - (a.maxTrendShift ?? -1) ||
        (b.maxClassShift ?? -1) - (a.maxClassShift ?? -1) ||
        a.id.localeCompare(b.id),
    ),
  }
}
export type FieldPriorities = ReturnType<typeof fieldPriorities>
