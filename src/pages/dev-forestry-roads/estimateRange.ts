/**
 * A preliminary estimate range for one road: the fixes Review offers for sections that do not close,
 * applied the cheapest way, the way a designer would, and the most expensive way, each priced on a
 * copy of the road. Nothing is applied to the road; the estimate stays its own.
 *
 * - **Low** — the best case (`terrainCases`): 1:1 fill wherever it closes a fill stretch, and the
 *   longer reach that closes the rest. No allowance beyond what the road already prices.
 * - **Medium** — each stretch's leading fix as Review offers it (`stretchFixes`): a full bench where
 *   the ground is at `FULL_BENCH_SIDESLOPE_PERCENT` or steeper, else the 1:1 fill, else the longer
 *   reach; plus the cross-drain allowance.
 * - **High** — every fill stretch full-benched into the hill (`fullBenchProfile`), and the stretches
 *   a slope sheet shows steeper too when one is given (`slopeSheetCase`); plus the cross-drain
 *   allowance.
 *
 * The allowances are the person's own figures (`RangeAssumptions`), never a rate the workspace
 * makes up: cross-drains at an entered spacing and price each, and an end-haul rate for the surplus
 * cut of a road that prices no haul of its own. Left blank, a line is counted and named, not priced.
 * No DOM.
 */
import { fullBenchProfile, type BenchStretch } from './fullBench'
import { MAX_SECTION_REACH_M } from './sectionLimits'
import { incompleteStretches, steepFillPlan, stretchFixes } from './sectionFixes'
import { downhillSide } from './slopeSheetCase'
import { terrainCases, type TerrainCaseResult } from './terrainCases'
import { safeAnalyzeRoad } from './analysisResult'
import type { analyzeRoad } from './engine'
import type { Alignment, ContextFeature, RoadAnalysis, RoadSettings, TerrainSource } from './types'

export interface RangeAssumptions {
  /** Road length per cross-drain culvert, metres. Null counts none. */
  crossDrainSpacingM: number | null
  /** Installed price of one cross-drain culvert, CAD. Null counts them without a price. */
  crossDrainCost: number | null
  /** CAD per m³ of surplus cut taken away, for a road with no haul rates of its own. Null leaves it unpriced. */
  endHaulRate: number | null
}
export const DEFAULT_RANGE_ASSUMPTIONS: RangeAssumptions = {
  crossDrainSpacingM: null,
  crossDrainCost: null,
  endHaulRate: null,
}

export type RangeLevel = 'low' | 'medium' | 'high'
export const RANGE_LEVEL_LABELS: Record<RangeLevel, string> = {
  low: 'Low: 1:1 fill',
  medium: 'Medium: each stretch’s leading fix',
  high: 'High: full bench',
}

export interface RangeScenario {
  /** What the scenario changed on the copy, in plain lines. */
  changes: string[]
  /** Its estimate with the allowances, as the road's estimate is counted; null when it could not be built. */
  estimate: number | null
  /** The copy's own estimate, before the allowances. */
  roadEstimate: number | null
  cutM3: number | null
  fillM3: number | null
  /** Usable cut less fill: positive is surplus to take away. */
  balanceM3: number | null
  completePercent: number | null
  crossDrains: { count: number; cost: number | null } | null
  endHaul: { m3: number; cost: number | null } | null
  /** Why there is no figure. */
  error?: string
}

export interface RoadEstimateRange {
  asIs: { estimate: number; completePercent: number }
  low: RangeScenario
  medium: RangeScenario
  high: RangeScenario
}

type AnalysisOptions = NonNullable<Parameters<typeof analyzeRoad>[4]>

/** The road's estimate as the package counts it: with or without contingency. */
export const countedEstimate = (a: RoadAnalysis, contingency: boolean) =>
  a.engineering ? (contingency ? a.engineering.costs.total : a.engineering.costs.subtotal) : a.estimatedCost

/** Cross-drains the road would need at the spacing, beyond the culverts it already has. */
export function crossDrainCount(alignment: Pick<Alignment, 'engineering'>, lengthM: number, spacingM: number | null) {
  if (!spacingM || spacingM <= 0 || !(lengthM > 0)) return 0
  const existing = (alignment.engineering?.culverts ?? []).filter((c) => c.kind !== 'stream').length
  return Math.max(0, Math.ceil(lengthM / spacingM) - existing)
}

/** The figures of one scenario's analysis, with the allowances added. */
export function scenarioOf(
  alignment: Alignment,
  analysis: RoadAnalysis,
  changes: string[],
  assumptions: RangeAssumptions,
  options: { contingency: boolean; crossDrains: boolean },
): RangeScenario {
  const roadEstimate = countedEstimate(analysis, options.contingency)
  const count = options.crossDrains ? crossDrainCount(alignment, analysis.length, assumptions.crossDrainSpacingM) : 0
  const crossDrains = count
    ? { count, cost: assumptions.crossDrainCost === null ? null : count * assumptions.crossDrainCost }
    : null
  // A road that prices its own haul already carries its surplus; only an unpriced surplus is added.
  const haulPriced = !!analysis.engineering && !!alignment.engineering?.haul.enabled
  const surplus = haulPriced ? 0 : Math.max(0, analysis.balanceM3)
  const endHaul =
    surplus > 0.5
      ? { m3: surplus, cost: assumptions.endHaulRate === null ? null : surplus * assumptions.endHaulRate }
      : null
  return {
    changes,
    estimate: roadEstimate + (crossDrains?.cost ?? 0) + (endHaul?.cost ?? 0),
    roadEstimate,
    cutM3: analysis.cutVolumeM3,
    fillM3: analysis.fillVolumeM3,
    balanceM3: analysis.balanceM3,
    completePercent: analysis.coveragePercent,
    crossDrains,
    endHaul,
  }
}

const failed = (error: string): RangeScenario => ({
  changes: [],
  estimate: null,
  roadEstimate: null,
  cutM3: null,
  fillM3: null,
  balanceM3: null,
  completePercent: null,
  crossDrains: null,
  endHaul: null,
  error,
})

/** Every fill stretch, and every stretch a slope sheet shows steeper, benched in one profile. */
export function highCase(
  alignment: Alignment,
  analysis: RoadAnalysis,
  settings: RoadSettings,
  slopeStretches: readonly { from: number; to: number }[],
  id: () => string,
): TerrainCaseResult {
  const fills = incompleteStretches(analysis.stations, alignment).filter((s) => s.batter === 'fill')
  const benches: BenchStretch[] = [
    ...fills.map((s) => ({ side: s.side, rangeFrom: s.rangeFrom, rangeTo: s.rangeTo })),
    ...slopeStretches.flatMap((s) => {
      const side = downhillSide(analysis.stations, s.from, s.to)
      return side ? [{ side, rangeFrom: s.from, rangeTo: s.to }] : []
    }),
  ]
  if (!benches.length) return { error: 'No fill stretch to bench.' }
  const plan = fullBenchProfile(alignment, analysis.stations, benches, id)
  if ('error' in plan) return plan
  const sheet = slopeStretches.length ? benches.length - fills.length : 0
  return {
    alignment: { ...alignment, vertical: plan.vertical },
    settings,
    change: `Full bench on ${[
      fills.length ? `${fills.length} fill stretch${fills.length === 1 ? '' : 'es'}` : '',
      sheet ? `${sheet} stretch${sheet === 1 ? '' : 'es'} the slope sheet shows steeper` : '',
    ]
      .filter(Boolean)
      .join(' and ')} (${Math.round(plan.loweredLengthM)} m), up to ${plan.maxLoweringM.toFixed(1)} m lower`,
  }
}

/** Each incomplete stretch given the fix Review leads with: full bench, else 1:1 fill, else a longer reach. */
export function mediumCase(
  alignment: Alignment,
  analysis: RoadAnalysis,
  settings: RoadSettings,
  options: { id: () => string; stationLabel: (chainage: number) => string },
): TerrainCaseResult {
  const stretches = incompleteStretches(analysis.stations, alignment)
  const led = stretches.map((stretch) => ({ stretch, fix: stretchFixes(stretch)[0] }))
  const bench = led.filter((l) => l.fix?.kind === 'full-bench').map((l) => l.stretch)
  const fill = led.filter((l) => l.fix?.kind === 'steep-fill').map((l) => l.stretch)
  const reaches = led.flatMap((l) => (l.fix?.kind === 'reach' ? [l.fix.reachM] : []))
  const reach = Math.min(MAX_SECTION_REACH_M, Math.max(settings.crossSectionHalfWidth, ...reaches))
  if (!bench.length && !fill.length && reach === settings.crossSectionHalfWidth)
    return { error: 'No stretch has a fix Review can apply.' }
  let road = alignment
  const changes: string[] = []
  if (fill.length) {
    const planned = steepFillPlan(road, fill, analysis.length, options)
    if (!('error' in planned)) {
      road = planned.alignment
      changes.push(`1:1 fill on ${fill.length} stretch${fill.length === 1 ? '' : 'es'}`)
    }
  }
  if (bench.length) {
    const plan = fullBenchProfile(
      road,
      analysis.stations,
      bench.map((s) => ({ side: s.side, rangeFrom: s.rangeFrom, rangeTo: s.rangeTo })),
      options.id,
    )
    if (!('error' in plan)) {
      road = { ...road, vertical: plan.vertical }
      changes.push(
        `full bench on ${bench.length} stretch${bench.length === 1 ? '' : 'es'}, up to ${plan.maxLoweringM.toFixed(1)} m lower`,
      )
    }
  }
  if (reach > settings.crossSectionHalfWidth) changes.push(`${reach} m reach`)
  if (!changes.length) return { error: 'No stretch has a fix Review can apply.' }
  const text = changes.join(', ')
  return {
    alignment: road,
    settings: { ...settings, crossSectionHalfWidth: reach },
    change: text.charAt(0).toUpperCase() + text.slice(1),
  }
}

/**
 * The low, medium and high estimates of a road. The as-imported road is the floor of a scenario that
 * finds nothing to fix: a road whose sections all close has the same figure at each level, bar the
 * allowances.
 */
export function roadEstimateRange(
  alignment: Alignment,
  input: {
    source: TerrainSource
    settings: RoadSettings
    context: ContextFeature[]
    analysisOptions: AnalysisOptions
    assumptions: RangeAssumptions
    contingency: boolean
    /** Stretches a slope sheet shows steeper (`SlopeSheetCheck.stretches`), benched in the high case. */
    slopeStretches?: readonly { from: number; to: number }[]
    id: () => string
  },
): RoadEstimateRange {
  const { source, settings, context, analysisOptions, assumptions, contingency, id } = input
  const analyse = (road: Alignment, roadSettings = settings) =>
    safeAnalyzeRoad(road, source, roadSettings, context, analysisOptions)
  // The as-imported road analysed the same way as its copies, so the scenarios differ by their fixes alone.
  const base = analyse(alignment)
  const stationLabel = (chainage: number) => `${Math.round(chainage)} m`
  const asScenario = (
    built: TerrainCaseResult,
    crossDrains: boolean,
    nothing: string,
    nothingChange: string,
  ): RangeScenario => {
    if ('error' in built) {
      // Nothing to fix is not a failure: the road as it stands is that level's figure.
      if (built.error === nothing)
        return scenarioOf(alignment, base, [nothingChange], assumptions, { contingency, crossDrains })
      return failed(built.error)
    }
    const copy = analyse(built.alignment, built.settings)
    return scenarioOf(built.alignment, copy, [built.change], assumptions, { contingency, crossDrains })
  }

  const cases = terrainCases(alignment, base.stations, settings, base.length, { id, stationLabel })
  const low = cases
    ? asScenario(
        cases.best,
        false,
        'No 1:1 fill or longer reach closes these stretches.',
        'As imported: no stretch the 1:1 fill or a longer reach closes',
      )
    : scenarioOf(alignment, base, ['As imported: every section closes'], assumptions, {
        contingency,
        crossDrains: false,
      })

  // A road whose sections all close has nothing to fix at any level, bar the allowances.
  const closes = !cases
  const medium = asScenario(
    mediumCase(alignment, base, settings, { id, stationLabel }),
    true,
    'No stretch has a fix Review can apply.',
    closes ? 'As imported: every section closes' : 'As imported: no stretch has a fix Review can apply',
  )
  const high = asScenario(
    highCase(alignment, base, settings, input.slopeStretches ?? [], id),
    true,
    'No fill stretch to bench.',
    closes ? 'As imported: every section closes' : 'As imported: no fill stretch to bench',
  )
  return {
    asIs: { estimate: countedEstimate(base, contingency), completePercent: base.coveragePercent },
    low,
    medium,
    high,
  }
}

/** The range over several roads: each level summed where every road has a figure for it. */
export function rangeTotals(ranges: readonly RoadEstimateRange[]) {
  const total = (level: RangeLevel) =>
    ranges.every((r) => r[level].estimate !== null) ? ranges.reduce((s, r) => s + (r[level].estimate ?? 0), 0) : null
  return { low: total('low'), medium: total('medium'), high: total('high') }
}
