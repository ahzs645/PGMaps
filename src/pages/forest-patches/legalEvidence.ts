import type { FactSet } from '../../../packages/legal-rules/src/contract'
import pgPack from '../../../packages/legal-rules/packs/bc-pgtsa-planning-1.3.0.json'
import type { Analysis } from './analysis'
import { bins, movementTowardTarget, table, type Project, type Scenario } from './project'

type Period = Analysis['timeline'][number]

/** Below this, a change in points is the arithmetic of unrounded shares, not a movement. */
const TOLERANCE = 1e-8

// A worker period contains unrounded shares. Missing or mismatched classes make the interval unknown.
function completePeriod(period: Period | undefined): period is Period {
  return (
    !!period &&
    Number.isFinite(period.totalHa) &&
    period.totalHa > 0 &&
    period.unclassifiedHa === 0 &&
    period.classes.length === bins.length &&
    period.classes.every(
      ({ percent }) => percent !== null && Number.isFinite(percent) && percent >= 0 && percent <= 100 + 1e-8,
    ) &&
    Math.abs(period.classes.reduce((sum, c) => sum + (c.percent ?? 0), 0) - 100) <= 1e-8
  )
}

/** Each class's pair of periods, in `bins` order, when both are complete and read against the same targets. */
function comparable(earlier?: Period, later?: Period) {
  if (!completePeriod(earlier) || !completePeriod(later)) return null
  const pairs = bins.map((bin) => {
    const before = earlier.classes.find((c) => c.bin === bin)
    const after = later.classes.find((c) => c.bin === bin)
    if (
      !before ||
      !after ||
      before.target !== after.target ||
      !Number.isFinite(after.target) ||
      after.target < 0 ||
      after.target > 100
    )
      return null
    return { before: before.percent!, after: after.percent!, target: after.target }
  })
  return pairs.every((p) => p !== null) ? pairs : null
}

/** Per class, how much closer to its target it moved (negative: farther). Null when unknown. */
export function classMovements(earlier?: Period, later?: Period): number[] | null {
  return comparable(earlier, later)?.map((p) => movementTowardTarget(p.before, p.after, p.target)!) ?? null
}
/** Whether any one class moved farther from its target: the test of releases up to 1.2.0, kept as evidence. */
export function trendsAway(changes: number[] | null) {
  return changes === null ? null : changes.some((v) => v < -TOLERANCE)
}

/**
 * Objective C asks for "a trend toward the young forest patch size distribution", and Table 7 gives
 * it as each class's percent of young forest. The distribution's distance from the targets is
 * therefore the four classes' distances added, in percentage points of young forest: half of it is
 * the least share of young forest that would have to be in another class to match Table 7. Each class
 * counts at its own size, with no class weighted above another, and a class whose target is 0
 * counts its whole share. The planning index and the Board comparison add the same distances.
 */
export function distributionDistance(classes: { percent: number; target: number }[]) {
  return classes.reduce((sum, c) => sum + Math.abs(c.percent - c.target), 0)
}

export interface DistributionTrend {
  /** The summed distance at the start and the end of the interval, in points. */
  before: number
  after: number
  /** `after − before`, set to exactly 0 within the tolerance: positive is farther from the targets. */
  growth: number
  /** Per class in `bins` order, how much closer to its target it moved (negative: farther). */
  movements: number[]
}

/** The distribution's change over an interval. Null when either period is incomplete: never a pass. */
export function distributionTrend(earlier?: Period, later?: Period): DistributionTrend | null {
  const pairs = comparable(earlier, later)
  if (!pairs) return null
  const before = distributionDistance(pairs.map((p) => ({ percent: p.before, target: p.target })))
  const after = distributionDistance(pairs.map((p) => ({ percent: p.after, target: p.target })))
  const growth = Math.abs(after - before) <= TOLERANCE ? 0 : after - before
  return { before, after, growth, movements: pairs.map((p) => movementTowardTarget(p.before, p.after, p.target)!) }
}

const points = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 2 })
const signed = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + points.format(Math.abs(v))

/** The figures behind the distance test, in words: both distances, the change, and the classes that moved away. */
export function trendEvidence(trend: DistributionTrend | null, from: number, to: number): string {
  if (!trend) return `Comparable complete distributions are unavailable for ${from}–${to}.`
  const away = trend.movements
    .map((m, i) => ({ m, label: table.labels[i] }))
    .filter(({ m }) => m < -TOLERANCE)
    .map(({ m, label }) => `${label} ${points.format(-m)}`)
  const direction = trend.growth > 0 ? 'farther from' : trend.growth < 0 ? 'closer to' : 'no nearer to or farther from'
  return (
    `Summed distance from Table 7: ${points.format(trend.before)} points in ${from}, ${points.format(trend.after)} in ${to} ` +
    `(${signed(trend.growth)}, ${direction} the targets). ` +
    (away.length
      ? `Classes that moved farther from their targets (points): ${away.join(', ')}.`
      : 'No class moved farther from its target.')
  )
}

// Adapter for calculated facts only. The reviewer supplies applicability and D.5 findings.
export function patchFacts(project: Project, result: Analysis, year: number, scenario: Scenario): FactSet {
  const get = (y: number) => result.timeline.find((r) => r.year === y && r.scenario === scenario)
  const trend = distributionTrend(get(year - 5), get(year))
  const defaults = project.features.filter(
    (f) =>
      f.properties.yearBasis === 'editor-default' &&
      (f.properties.scenario === 'reference' || f.properties.scenario === scenario),
  ).length
  const evidence =
    trendEvidence(trend, year - 5, year) +
    (trend
      ? ' Model comparison of the four class percentages. Inventory and reporting coverage are user-supplied.'
      : '')
  return {
    format: 'pgmaps-legal-facts/v1',
    pack: pgPack.id,
    version: pgPack.version,
    source: [project.source, project.district, project.ndu, scenario, year - 5 + '–' + year, 'pg-2005-buffer-v1'].join(
      ' · ',
    ),
    facts: [
      {
        id: 'patch-distance-growth',
        value: trend?.growth ?? null,
        evidence: defaults
          ? evidence + ' Footprints using an assumed date because the source year was missing: ' + defaults + '.'
          : evidence,
      },
    ],
  }
}
