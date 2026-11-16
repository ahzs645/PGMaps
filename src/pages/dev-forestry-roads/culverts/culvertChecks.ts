/**
 * One list of checks for one culvert against BC's Engineering Manual and Fish-stream Crossing
 * Guidebook, read by the culvert editor, the culvert schedule and Review. Each check is met, not
 * met, not assessed (a value it needs is missing) or a note (guidance with no pass or fail).
 *
 * The rules are data (`engineeringManual.ts`). A check that could not be made is never met.
 * Free of DOM and network access.
 */
import type { Culvert, CulvertAnalysis } from '../engineeringTypes'
import { inletControlHeadwater } from './culvertHydraulics'
import { culvertBarrels, culvertPurposeOf, culvertRiseM, culvertShapeOf } from './culvertShape'
import {
  COVER_RULES,
  CROSS_DRAIN_SKEW,
  CROSS_DRAIN_SPACING,
  crossDrainSpacingM,
  DESIGN_FLOOD,
  EMBEDMENT_RULES,
  GRADIENT_RULES,
  HEADWATER_LIMIT,
  STOCK_DIAMETERS_M,
} from './engineeringManual'

export type CulvertCheckState = 'met' | 'not-met' | 'not-assessed' | 'note'
export type CulvertCheckId =
  | 'length'
  | 'cover'
  | 'gradient'
  | 'skew'
  | 'spacing'
  | 'stock-size'
  | 'capacity'
  | 'headwater'
  | 'embedment'
  | 'design-flood'

export interface CulvertCheckResult {
  id: CulvertCheckId
  /** The check as a statement: "Cover meets the manual's rule". */
  label: string
  state: CulvertCheckState
  /** What was found. */
  result: string
  /** The rule it was judged on. */
  judgedOn: string
  locator: string
}

/** What a current drainage check modelled for this culvert. */
export interface CulvertFlowCheck {
  designFlowM3s: number
  capacityM3s: number
  adequate: boolean
  slope: number
  slopeAssumed: boolean
}

export interface CulvertChecksInput {
  culvert: Culvert
  /** The engine's geometry for it; undefined before a calculation. */
  analysis?: Pick<CulvertAnalysis, 'coverM' | 'gradePercent' | 'requiredLengthM'>
  /** The road's design grade at the culvert's station, %; null where it is not known. */
  roadGradePercent: number | null
  drainage: { state: 'current' | 'stale' | 'not-run'; check?: CulvertFlowCheck; rainfallMmPerHr?: number }
  /** The crossing record that replaces this culvert's allowance names an embedded culvert. */
  embeddedStructure?: boolean
  /** The longer of the two runs of road beside this culvert with no other culvert in it. */
  adjacentRun?: CulvertRun
}

/** A run of road between this culvert and the next one, or the road's end. */
export interface CulvertRun {
  lengthM: number
  /** "Culvert 3", "the road start", "the road end". */
  to: string
  /** The steepest design grade in the run, %; null where no grade is known. */
  steepestGradePercent: number | null
}

const trim = (value: number, digits = 2) => String(Number(value.toFixed(digits)))

/** Cover the manual requires over this culvert, m: the greater of the rule's floor and its share of the rise. */
export function requiredCoverM(culvert: Pick<Culvert, 'diameterM' | 'kind'>): number {
  const rule = COVER_RULES[culvertPurposeOf(culvert)]
  return Math.max(rule.minimumM, rule.riseFraction * culvertRiseM(culvert))
}

/** The skew the manual suggests for a cross-drain on a road of this grade, degrees from square. */
export function suggestedCrossDrainSkew(roadGradePercent: number): number {
  const over = Math.abs(roadGradePercent) - CROSS_DRAIN_SKEW.aboveGradePercent
  return Math.min(CROSS_DRAIN_SKEW.maxDegrees, Math.max(0, over * CROSS_DRAIN_SKEW.degreesPerPercent))
}

/** Embedment the guidebook requires for this opening, m. Null for an open-bottom arch, which has no floor. */
export function requiredEmbedmentM(culvert: Pick<Culvert, 'diameterM' | 'shape'>): number | null {
  const shape = culvertShapeOf(culvert)
  if (shape === 'open-bottom-arch') return null
  return shape === 'round'
    ? Math.max(EMBEDMENT_RULES.roundMinimumM, EMBEDMENT_RULES.roundFraction * culvert.diameterM)
    : EMBEDMENT_RULES.archBoxRiseFraction * culvertRiseM(culvert)
}

export function culvertChecks(input: CulvertChecksInput): CulvertCheckResult[] {
  const { culvert, analysis, drainage } = input
  const purpose = culvertPurposeOf(culvert),
    shape = culvertShapeOf(culvert),
    embedded = (culvert.embedmentM ?? 0) > 0 || !!input.embeddedStructure
  const out: CulvertCheckResult[] = []

  // Length: the engine's centred daylight span.
  const required = analysis?.requiredLengthM ?? null
  out.push({
    id: 'length',
    label: 'Barrel reaches both toes of the road',
    judgedOn: 'Horizontal span at least the centred daylight span at this station and skew',
    locator: 'Road section at the culvert',
    ...(required === null
      ? { state: 'not-assessed', result: 'The road’s daylight is not resolved here' }
      : culvert.lengthM + 1e-6 >= required
        ? { state: 'met', result: `Span ${trim(culvert.lengthM)} m against ${trim(required)} m needed` }
        : {
            state: 'not-met',
            result: `Span ${trim(culvert.lengthM)} m is shorter than the ${trim(required)} m needed`,
          }),
  })

  // Cover: the manual's rule for this purpose, not the entered minimum.
  const coverRule = COVER_RULES[purpose],
    needCover = requiredCoverM(culvert),
    cover = analysis?.coverM ?? null
  out.push({
    id: 'cover',
    label: 'Cover meets the manual’s rule',
    judgedOn: `${purpose === 'stream' ? 'Stream culvert' : 'Cross-drain'}: the greater of ${trim(coverRule.minimumM * 1000, 0)} mm and half the ${shape === 'round' ? 'diameter' : 'rise'}, here ${trim(needCover)} m`,
    locator: coverRule.locator,
    ...(cover === null
      ? { state: 'not-assessed', result: 'Cover is not known: enter both inverts on resolved ground' }
      : cover + 1e-6 >= needCover
        ? { state: 'met', result: `Least cover ${trim(cover)} m` }
        : { state: 'not-met', result: `Least cover ${trim(cover)} m is under ${trim(needCover)} m` }),
  })

  // Gradient: the engine's grade is negative for a falling pipe.
  const fall = analysis?.gradePercent === null || analysis?.gradePercent === undefined ? null : -analysis.gradePercent
  const protection =
    fall !== null && fall > GRADIENT_RULES.outletProtectionAbovePercent
      ? ` Over ${trim(GRADIENT_RULES.outletProtectionAbovePercent)}%: consider outlet protection.`
      : ''
  out.push({
    id: 'gradient',
    label: 'Pipe gradient is within the manual’s range',
    judgedOn:
      purpose === 'stream'
        ? `Stream culvert: at most ${trim(GRADIENT_RULES.streamMaxPercent)}%`
        : `Cross-drain: at least ${trim(GRADIENT_RULES.crossDrainMinPercent)}%`,
    locator: purpose === 'stream' ? GRADIENT_RULES.streamLocator : GRADIENT_RULES.crossDrainLocator,
    ...(fall === null
      ? { state: 'not-assessed', result: 'Gradient is not known: enter both inverts' }
      : fall <= 0
        ? { state: 'not-met', result: 'The outlet is not below the inlet' }
        : purpose === 'stream'
          ? fall <= GRADIENT_RULES.streamMaxPercent + 1e-6
            ? { state: 'met', result: `Falls ${trim(fall)}%.${protection}` }
            : {
                state: 'not-met',
                result: `Falls ${trim(fall)}%, over ${trim(GRADIENT_RULES.streamMaxPercent)}%.${protection}`,
              }
          : fall + 1e-6 >= GRADIENT_RULES.crossDrainMinPercent
            ? { state: 'met', result: `Falls ${trim(fall)}%.${protection}` }
            : {
                state: 'not-met',
                result: `Falls ${trim(fall)}%, under ${trim(GRADIENT_RULES.crossDrainMinPercent)}%`,
              }),
  })

  // Skew: guidance for a cross-drain; a stream culvert follows its channel.
  if (purpose === 'cross-drain')
    out.push({
      id: 'skew',
      label: 'Cross-drain skew for the road grade',
      judgedOn: `${trim(CROSS_DRAIN_SKEW.degreesPerPercent)}° for each 1% of road grade over ${trim(CROSS_DRAIN_SKEW.aboveGradePercent)}%, to ${trim(CROSS_DRAIN_SKEW.maxDegrees)}° at most`,
      locator: CROSS_DRAIN_SKEW.locator,
      ...(input.roadGradePercent === null
        ? { state: 'not-assessed', result: 'The road grade here is not known' }
        : {
            state: 'note',
            result: `Road grade ${trim(Math.abs(input.roadGradePercent), 1)}% suggests ${trim(suggestedCrossDrainSkew(input.roadGradePercent), 0)}° from square; entered ${trim(Math.abs(culvert.skewDegrees), 0)}°`,
          }),
    })

  // Spacing: the manual's maximum depends on the ditch soil, which the project does not hold, so
  // the run is stated against all three classes and judged by the reader.
  const run = input.adjacentRun
  if (run)
    out.push({
      id: 'spacing',
      label: 'Run of road to the next culvert',
      judgedOn: 'Maximum cross-drain spacing by road gradient and the ditch soil’s erosion hazard',
      locator: CROSS_DRAIN_SPACING.locator,
      ...(run.steepestGradePercent === null
        ? { state: 'not-assessed', result: `${trim(run.lengthM, 0)} m to ${run.to}; the road grade there is not known` }
        : (() => {
            const max = crossDrainSpacingM(run.steepestGradePercent)
            return {
              state: 'note' as const,
              result: `${trim(run.lengthM, 0)} m to ${run.to} at up to ${trim(Math.abs(run.steepestGradePercent), 1)}%: the manual’s maximum is ${max.slight} m on slight, ${max.moderate} m on moderate and ${max.high} m on high erosion-hazard ditch soil`,
            }
          })()),
    })

  if (shape === 'round' && !STOCK_DIAMETERS_M.some((size) => Math.abs(size - culvert.diameterM) < 0.0005))
    out.push({
      id: 'stock-size',
      label: 'Diameter is a stock size',
      state: 'note',
      result: `${trim(culvert.diameterM * 1000, 0)} mm is not one of the manual’s stock sizes`,
      judgedOn: `Stock sizes ${STOCK_DIAMETERS_M.map((size) => trim(size * 1000, 0)).join(', ')} mm`,
      locator: 'EM Table 3-13, p. 166',
    })

  // Capacity and headwater need a current drainage check.
  const flow = drainage.state === 'current' ? drainage.check : undefined
  const noFlow =
    drainage.state === 'stale'
      ? 'The drainage check is out of date'
      : drainage.state === 'not-run'
        ? 'No drainage check has been run'
        : 'The drainage check did not reach this culvert'
  out.push({
    id: 'capacity',
    label: 'Barrel-full capacity carries the modelled peak',
    judgedOn: 'Manning capacity of every barrel together at least the Rational-method peak',
    locator: 'Drainage check',
    ...(embedded
      ? {
          state: 'not-assessed',
          result: 'Embedded: the streambed is not deducted from the opening, and the peak has to pass after embedment',
        }
      : !flow
        ? { state: 'not-assessed', result: noFlow }
        : flow.adequate
          ? {
              state: 'met',
              result: `${trim(flow.capacityM3s, 3)} m³/s against a peak of ${trim(flow.designFlowM3s, 3)} m³/s`,
            }
          : {
              state: 'not-met',
              result: `${trim(flow.capacityM3s, 3)} m³/s is under the peak of ${trim(flow.designFlowM3s, 3)} m³/s`,
            }),
  })
  const headwaterBase = {
    id: 'headwater' as const,
    label: 'Inlet-control headwater stays at or below the crown',
    judgedOn: `Headwater depth over diameter at most ${trim(HEADWATER_LIMIT.hwOverD)} at the modelled peak, by HDS-5's inlet-control equations on the nomographs' 2% slope`,
    locator: HEADWATER_LIMIT.locator,
  }
  if (shape !== 'round')
    out.push({
      ...headwaterBase,
      state: 'not-assessed',
      result: 'Inlet-control coefficients are held for round pipes only',
    })
  else if (embedded)
    out.push({ ...headwaterBase, state: 'not-assessed', result: 'Embedded: the streambed changes the inlet' })
  else if (!flow) out.push({ ...headwaterBase, state: 'not-assessed', result: noFlow })
  else {
    const headwater = inletControlHeadwater(culvert, flow.designFlowM3s)
    if (!headwater)
      out.push({
        ...headwaterBase,
        state: 'not-assessed',
        result: 'No inlet-control coefficients are held for this inlet and material',
      })
    else {
      const barrels = culvertBarrels(culvert)
      const text = `HW/D ${trim(headwater.hwOverD)} (${trim(headwater.headwaterM)} m above the inlet invert, ${headwater.edge} inlet${barrels > 1 ? `, ${barrels} barrels sharing the peak` : ''})`
      out.push({
        ...headwaterBase,
        ...(headwater.hwOverD <= HEADWATER_LIMIT.hwOverD + 1e-6
          ? { state: 'met', result: text }
          : { state: 'not-met', result: `${text} is over ${trim(HEADWATER_LIMIT.hwOverD)}` }),
      })
    }
  }

  if (embedded) {
    const need = requiredEmbedmentM(culvert),
      entered = culvert.embedmentM ?? null
    out.push({
      id: 'embedment',
      label: 'Embedment meets the guidebook’s depth',
      judgedOn:
        shape === 'round'
          ? `Round pipe: the greater of ${trim(EMBEDMENT_RULES.roundFraction * 100, 0)}% of the diameter and ${trim(EMBEDMENT_RULES.roundMinimumM)} m${need === null ? '' : `, here ${trim(need)} m`}`
          : `Box or pipe arch: ${trim(EMBEDMENT_RULES.archBoxRiseFraction * 100, 0)}% of the rise${need === null ? '' : `, here ${trim(need)} m`}`,
      locator: EMBEDMENT_RULES.locator,
      ...(need === null || entered === null || entered <= 0
        ? { state: 'not-assessed', result: 'No embedment depth is entered' }
        : entered + 1e-6 >= need
          ? { state: 'met', result: `Embedded ${trim(entered)} m` }
          : { state: 'not-met', result: `Embedded ${trim(entered)} m is under ${trim(need)} m` }),
    })
  }

  const temporary = culvert.service === 'temporary'
  out.push({
    id: 'design-flood',
    label: 'Design flood for the culvert’s time on site',
    state: 'note',
    result: `${temporary ? `Temporary (on site ${DESIGN_FLOOD.temporaryYears} years or less): the ${DESIGN_FLOOD.temporary} peak` : `Permanent: the ${DESIGN_FLOOD.permanent} peak`}. ${
      drainage.rainfallMmPerHr === undefined
        ? 'The drainage check uses one storm intensity for every culvert'
        : `The drainage check used ${trim(drainage.rainfallMmPerHr, 1)} mm/h for every culvert`
    }: confirm it is that storm for this catchment.`,
    judgedOn: `${DESIGN_FLOOD.permanent} for a culvert on site over ${DESIGN_FLOOD.temporaryYears} years, ${DESIGN_FLOOD.temporary} otherwise`,
    locator: DESIGN_FLOOD.locator,
  })
  return out
}

/** The checks that fail, which Review and the schedule list as outstanding. */
export const culvertChecksNotMet = (checks: readonly CulvertCheckResult[]) =>
  checks.filter((check) => check.state === 'not-met')
