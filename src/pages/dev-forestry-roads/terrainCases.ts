/**
 * Best and worst case for a road whose sections do not close on the terrain at hand, usually coarse
 * regional terrain under a road someone laid out on LiDAR. The road as drawn is taken to be
 * buildable; what the terrain cannot say is how steep the ground under it really is.
 *
 * - **Best case**: the ground is no worse than a normal sidehill section can take. Every fill stretch
 *   the 1:1 fill closes gets it (`steepFillPlan`), and the section reach is widened where that is
 *   what closes a stretch. Cut and fill stay close to balance.
 * - **Worst case**: the ground is as steep as the terrain shows. Every fill stretch is full-benched
 *   (`fullBenchProfile`), and the surplus cut is end haul.
 *
 * - **Designed** (`designedGradeCase`): a grade line fitted inside the project's grade limits, then
 *   the 1:1 fill where its sections still do not close. The middle figure, built the way the road
 *   would be designed.
 *
 * The cases are copies of the road for comparison; neither is applied unless the reader applies the
 * fix itself. `caseSummary` reads the figures the comparison prints from an analysis. No DOM.
 */
import { fullBenchProfile } from './fullBench'
import { incompleteStretches, steepFillPlan, stretchFixes } from './sectionFixes'
import { MAX_SECTION_REACH_M } from './sectionLimits'
import { analyzeRoad } from './engine'
import { optimizeVerticalProfileAsync } from './verticalOptimizer'
import type { Alignment, ContextFeature, RoadAnalysis, RoadSettings, RoadStation, TerrainSource } from './types'

export interface TerrainCase {
  alignment: Alignment
  settings: RoadSettings
  /** What the case changed, in a line. */
  change: string
}

export type TerrainCaseResult = TerrainCase | { error: string }

/** The best and worst case roads for the incomplete stretches in `stations`. */
export function terrainCases(
  alignment: Alignment,
  stations: readonly RoadStation[],
  settings: RoadSettings,
  roadLength: number,
  options: { id: () => string; stationLabel: (chainage: number) => string },
): { best: TerrainCaseResult; worst: TerrainCaseResult } | null {
  const stretches = incompleteStretches(stations, alignment)
  if (!stretches.length) return null
  const fixes = stretches.map((stretch) => ({ stretch, fixes: stretchFixes(stretch) }))
  const fills = stretches.filter((s) => s.batter === 'fill' && s.cause === 'reach')

  // Best: 1:1 fill wherever it closes the stretch, and the reach that closes the converging ones.
  const steep = fixes.filter((f) => f.fixes.some((x) => x.kind === 'steep-fill')).map((f) => f.stretch)
  const reaches = fixes.flatMap((f) => f.fixes.flatMap((x) => (x.kind === 'reach' ? [x.reachM] : [])))
  const reach = Math.min(MAX_SECTION_REACH_M, Math.max(settings.crossSectionHalfWidth, ...reaches))
  let best: TerrainCaseResult
  if (!steep.length && reach === settings.crossSectionHalfWidth)
    best = { error: 'No 1:1 fill or longer reach closes these stretches.' }
  else {
    const planned = steep.length ? steepFillPlan(alignment, steep, roadLength, options) : { alignment, templates: 0 }
    best =
      'error' in planned
        ? planned
        : {
            alignment: planned.alignment,
            settings: { ...settings, crossSectionHalfWidth: reach },
            change: [
              steep.length ? `1:1 fill on ${steep.length} stretch${steep.length === 1 ? '' : 'es'}` : '',
              reach > settings.crossSectionHalfWidth ? `${reach} m reach` : '',
            ]
              .filter(Boolean)
              .join(', '),
          }
  }

  // Worst: every fill stretch benched into the hill.
  let worst: TerrainCaseResult
  if (!fills.length) worst = { error: 'No fill stretch to bench.' }
  else {
    const plan = fullBenchProfile(alignment, stations, fills, options.id)
    worst =
      'error' in plan
        ? plan
        : {
            alignment: { ...alignment, vertical: plan.vertical },
            settings,
            change: `Full bench on ${fills.length} stretch${fills.length === 1 ? '' : 'es'}, up to ${plan.maxLoweringM.toFixed(1)} m lower`,
          }
  }
  return { best, worst }
}

export interface CaseSummary {
  completePercent: number
  cutM3: number
  fillM3: number
  /** The road's balance, usable cut less fill: positive is surplus to haul away, negative a shortfall to borrow. */
  balanceM3: number
  /** Waste the haul allocation sends to disposal, bank m³; null without an engineering result. */
  wasteBankM3: number | null
  estimatedCost: number
  /** False when there is surplus or waste to move but the haul and waste lines cost nothing: no rate was entered. */
  disposalPriced: boolean
  maxGradePercent: number
}

/** The figures a case prints, from its analysis. */
export function caseSummary(analysis: RoadAnalysis): CaseSummary {
  const engineering = analysis.engineering
  const waste = engineering?.haul.wasteBankM3 ?? null
  const disposalCost = (engineering?.costs.waste ?? 0) + (engineering?.costs.haul ?? 0)
  return {
    completePercent: analysis.coveragePercent,
    cutM3: analysis.cutVolumeM3,
    fillM3: analysis.fillVolumeM3,
    // The road's own balance: usable cut (after the reuse factor or materials) less fill.
    balanceM3: analysis.balanceM3,
    wasteBankM3: waste,
    estimatedCost: analysis.estimatedCost,
    // A surplus, or waste the allocation sends away, with nothing charged for moving it.
    disposalPriced: !(analysis.balanceM3 > 0.5 || (waste !== null && waste > 0.5)) || disposalCost > 0,
    maxGradePercent: analysis.maxGradePercent,
  }
}

/** Search bands tried for the designed grade line: how far the formation may sit from the ground, and the level step. */
export const DESIGNED_GRADE_BANDS: readonly { maxDepthM: number; levelStepM: number }[] = [
  { maxDepthM: 5, levelStepM: 0.5 },
  { maxDepthM: 10, levelStepM: 1 },
  { maxDepthM: 20, levelStepM: 2 },
]

/**
 * The **designed** case: what a designer does after drawing the line. The profile optimizer fits the
 * cheapest grade line inside the project's grade limits (`optimizeVerticalProfileAsync`), trying a
 * wider band from the ground each time none fits, and the fill stretches that still do not close on
 * that line get the 1:1 fill. Returns the optimizer's own reason when no line holds the limits within
 * the widest band: on coarse terrain that is a finding about the terrain, not a failure to hide.
 */
export async function designedGradeCase(
  alignment: Alignment,
  roadLength: number,
  terrain: TerrainSource,
  settings: RoadSettings,
  context: ContextFeature[],
  analysisOptions: NonNullable<Parameters<typeof analyzeRoad>[4]>,
  options: { id: () => string; stationLabel: (chainage: number) => string; signal?: AbortSignal },
): Promise<TerrainCaseResult> {
  let reason = 'No grade line was found.'
  for (const band of DESIGNED_GRADE_BANDS) {
    let vertical: Alignment['vertical']
    try {
      const result = await optimizeVerticalProfileAsync(
        { ...alignment, vertical: [] },
        roadLength,
        terrain,
        settings,
        { ...band, context, ...analysisOptions },
        { signal: options.signal },
      )
      vertical = result.vertical.map((p) => ({ ...p, id: options.id() }))
    } catch (error) {
      if (options.signal?.aborted) throw error
      reason = error instanceof Error ? error.message : reason
      continue
    }
    let designed: Alignment = { ...alignment, vertical }
    const analysis = analyzeRoad(designed, terrain, settings, context, analysisOptions)
    const steep = incompleteStretches(analysis.stations, designed).filter((stretch) =>
      stretchFixes(stretch).some((fix) => fix.kind === 'steep-fill'),
    )
    let filled = 0
    if (steep.length) {
      const planned = steepFillPlan(designed, steep, roadLength, options)
      if (!('error' in planned)) {
        designed = planned.alignment
        filled = steep.length
      }
    }
    return {
      alignment: designed,
      settings,
      change: `Grade line within ${settings.maxGradePercent}%, ${vertical.length} PVIs, up to ${band.maxDepthM} m from the ground${filled ? `, 1:1 fill on ${filled} stretch${filled === 1 ? '' : 'es'}` : ''}`,
    }
  }
  return { error: `${reason} (tried up to ${DESIGNED_GRADE_BANDS.at(-1)!.maxDepthM} m from the ground)` }
}
