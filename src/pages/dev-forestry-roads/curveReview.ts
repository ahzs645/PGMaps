/** Derived curve review. Uses fitted geometry and calculated sections; never edits the design. */
import { curveDesignAt, horizontalCurveSummary } from './engine'
import { evaluateCurveCriteria } from './roadCriteria'
import { horizontalCurveEvents } from './planAnnotations'
import { sectionCrossfall, templateAt } from './templates'
import type { Alignment, RoadAnalysis, RoadStation, TerrainMetadata } from './types'

export interface CurveReviewRange {
  min: number
  max: number
}
export interface CurveReviewEvent {
  label: 'BC' | 'EC' | 'TS' | 'SC' | 'CS' | 'ST'
  chainage: number
}
export type CurveReview = ReturnType<typeof horizontalCurveSummary>[number] & {
  id: string
  events: CurveReviewEvent[]
  sampleCount: number
  completeSampleCount: number
  circularSampleCount: number
  independentProfile: boolean
  insideWidthM: CurveReviewRange | null
  outsideWidthM: CurveReviewRange | null
  innerFormationRadiusM: CurveReviewRange | null
  minimumInnerDaylightRadiusM: number | null
  centrelineGradePercent: CurveReviewRange | null
  innerEdgeGradePercent: CurveReviewRange | null
  innerEdgeGradeReason: string | null
  requiredSuperelevationPercent: number | null
  cappedSuperelevationPercent: number | null
  insideCrossfallPercent: CurveReviewRange | null
  outsideCrossfallPercent: CurveReviewRange | null
  insideWideningM: number | null
  outsideWideningM: number | null
  warnings: string[]
}

const EPS = 2e-6 // Engine event stations are rounded to one millionth of a metre.
const finite = (value: number | null | undefined): value is number => value != null && Number.isFinite(value)
const range = (values: Array<number | null | undefined>): CurveReviewRange | null => {
  if (!values.length || values.some((value) => !finite(value))) return null
  const known = values as number[]
  return { min: Math.min(...known), max: Math.max(...known) }
}
const constant = (value: CurveReviewRange | null) => value !== null && value.max - value.min <= 1e-5
const between = (station: RoadStation, start: number, end: number) =>
  station.chainage >= start - EPS && station.chainage <= end + EPS

export const INNER_EDGE_GRADE_BASIS =
  'Circular arc only: inner-edge grade = centreline grade × R / (R − inside formation width). ' +
  'Requires constant formation width and crossfall over the sampled arc. Excludes spirals, runoff, ' +
  'wheel tracks, vehicle offtracking and swept paths; this is a geometric screen, not a vehicle grade limit.'

export const CURVE_REVIEW_BASIS =
  'Fitted curves are reviewed independently. A switchback assembled from several curves needs a whole-vehicle ' +
  'maneuver review; per-curve widening does not establish swept-path clearance. Sampled section checks do not ' +
  'prove continuous footprint clearance or curvature-corrected earthwork volumes.'

export function buildCurveReview(alignment: Alignment, analysis: RoadAnalysis): CurveReview[] {
  return horizontalCurveSummary(alignment).map((curve, index) => {
    const samples = analysis.stations.filter((s) => between(s, curve.fullStart, curve.fullEnd))
    const circular = samples.filter((s) => between(s, curve.start, curve.end))
    const inside = curve.direction
    const outside = inside === 'left' ? 'right' : 'left'
    const crossfalls = circular.map((s) => {
      const template = templateAt(alignment, s.chainage).template
      const design = curveDesignAt(alignment, s.chainage)
      return {
        inside: sectionCrossfall(template, inside, design),
        outside: sectionCrossfall(template, outside, design),
        banking: !!design && design.superPercent > 0,
      }
    })
    const insideWidthM = range(circular.map((s) => (inside === 'left' ? s.leftWidth : s.rightWidth)))
    const outsideWidthM = range(circular.map((s) => (outside === 'left' ? s.leftWidth : s.rightWidth)))
    const innerFormationRadiusM = range(
      circular.map((s) => curve.radius - (inside === 'left' ? s.leftWidth : s.rightWidth)),
    )
    const insideCrossfallPercent = range(crossfalls.map((s) => s.inside))
    const outsideCrossfallPercent = range(crossfalls.map((s) => s.outside))
    const daylightRadii = circular.map((s) => {
      const offset = inside === 'left' ? s.leftDaylightM : s.rightDaylightM
      return finite(offset) ? curve.radius - Math.abs(offset) : null
    })
    const daylight = range(daylightRadii)
    // One PVI is the engine's explicit constant-level formation; only zero PVIs follows ground.
    const independentProfile = alignment.vertical.length > 0
    const centrelineGradePercent = independentProfile ? range(circular.map((s) => s.gradePercent)) : null
    const completeSampleCount = samples.filter((s) => s.complete).length
    const warnings: string[] = []
    const criteria = alignment.curveDesign
      ? evaluateCurveCriteria(alignment.curveDesign, curve.radius, curve.deflectionDegrees)
      : null
    if (criteria) warnings.push(...criteria.warnings)
    else warnings.push('No speed/superelevation or vehicle-widening criteria entered for this road.')
    if (!circular.length)
      warnings.push('No calculated circular-arc sections; width, crossfall and grade review unavailable.')
    if (completeSampleCount < samples.length)
      warnings.push(
        `${samples.length - completeSampleCount} of ${samples.length} calculated curve sections are incomplete. Quantities remain covered subtotals.`,
      )
    if (innerFormationRadiusM && innerFormationRadiusM.min <= 0)
      warnings.push(
        'Inside formation reaches or crosses the curve centre. The swept formation folds; review geometry and quantities.',
      )
    // An unknown neighbouring section must not hide a known folded footprint.
    if (daylightRadii.some((radius) => finite(radius) && radius <= 0))
      warnings.push(
        'Inside daylight reaches or crosses the curve centre. Swept sections may overlap; review the footprint and earthworks.',
      )
    if (circular.length && !daylight) warnings.push('Inside daylight is unresolved at one or more arc sections.')
    if (
      alignment.curveDesign &&
      crossfalls.some((s) => s.banking && s.inside > alignment.curveDesign!.maxSuperelevationPercent + 1e-6)
    )
      warnings.push(
        'Actual inside crossfall exceeds the entered maximum after retaining the template crown. Review crown and superelevation criteria.',
      )
    const innerEdgeGradeReason = !independentProfile
      ? 'No independent formation profile; ground-following grades are not a designed edge grade.'
      : !centrelineGradePercent || !innerFormationRadiusM
        ? 'Calculated formation grades or widths are unavailable on the circular arc.'
        : innerFormationRadiusM.min <= 0
          ? 'Inside formation radius is zero or negative; no finite inner-edge grade screen is valid.'
          : !constant(insideWidthM) || !constant(insideCrossfallPercent)
            ? 'Inside width or crossfall changes across the arc; review the actual edge profile instead of the constant-offset formula.'
            : null
    const innerEdgeGradePercent = innerEdgeGradeReason
      ? null
      : range(
          circular.map((s) =>
            finite(s.gradePercent)
              ? (s.gradePercent * curve.radius) / (curve.radius - (inside === 'left' ? s.leftWidth : s.rightWidth))
              : null,
          ),
        )
    const events: CurveReviewEvent[] = horizontalCurveEvents(curve)
    return {
      ...curve,
      id: `H${index + 1}`,
      events,
      sampleCount: samples.length,
      completeSampleCount,
      circularSampleCount: circular.length,
      independentProfile,
      insideWidthM,
      outsideWidthM,
      innerFormationRadiusM,
      minimumInnerDaylightRadiusM: daylight?.min ?? null,
      centrelineGradePercent,
      innerEdgeGradePercent,
      innerEdgeGradeReason,
      requiredSuperelevationPercent: criteria?.requiredSuperelevationPercent ?? null,
      cappedSuperelevationPercent: criteria?.appliedSuperelevationPercent ?? null,
      insideCrossfallPercent,
      outsideCrossfallPercent,
      insideWideningM: criteria?.insideWideningM ?? null,
      outsideWideningM: criteria?.outsideWideningM ?? null,
      warnings: [...new Set(warnings)],
    }
  })
}

/** Blank unknowns, numeric signed grades, and spreadsheet-safe text. */
const csvValue = (value: string | number | null | undefined): string => {
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return ''
  if (typeof value === 'number') return String(value)
  const safe = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

export function curveReviewCsv(alignment: Alignment, rows: CurveReview[], terrain?: TerrainMetadata): string {
  const header = [
    'road',
    'curve',
    'direction',
    'radius_m',
    'full_deflection_deg',
    'circular_deflection_deg',
    'full_start_m',
    'arc_start_m',
    'arc_end_m',
    'full_end_m',
    'spiral_in_m',
    'arc_length_m',
    'spiral_out_m',
    'inside_width_min_m',
    'inside_width_max_m',
    'inner_formation_radius_min_m',
    'inner_daylight_radius_min_m',
    'centreline_grade_min_percent',
    'centreline_grade_max_percent',
    'inner_edge_grade_min_percent',
    'inner_edge_grade_max_percent',
    'required_e_percent',
    'capped_target_e_percent',
    'actual_inside_crossfall_min_percent',
    'actual_inside_crossfall_max_percent',
    'actual_outside_crossfall_min_percent',
    'actual_outside_crossfall_max_percent',
    'inside_widening_m',
    'outside_widening_m',
    'complete_curve_sections',
    'calculated_curve_sections',
    'criteria_name',
    'criteria_source',
    'warnings',
    'inner_edge_grade_status',
    'inner_edge_grade_basis',
    'review_limits',
    'terrain_source',
    'terrain_resolution_m',
    'vertical_reference',
    'terrain_source_url',
    'terrain_sha256',
  ]
  return [
    header.map(csvValue).join(','),
    ...rows.map((r) =>
      [
        alignment.name,
        r.id,
        r.direction,
        r.radius,
        r.deflectionDegrees,
        r.circularDeflectionDegrees,
        r.fullStart,
        r.start,
        r.end,
        r.fullEnd,
        r.spiralInLengthM,
        r.length,
        r.spiralOutLengthM,
        r.insideWidthM?.min,
        r.insideWidthM?.max,
        r.innerFormationRadiusM?.min,
        r.minimumInnerDaylightRadiusM,
        r.centrelineGradePercent?.min,
        r.centrelineGradePercent?.max,
        r.innerEdgeGradePercent?.min,
        r.innerEdgeGradePercent?.max,
        r.requiredSuperelevationPercent,
        r.cappedSuperelevationPercent,
        r.insideCrossfallPercent?.min,
        r.insideCrossfallPercent?.max,
        r.outsideCrossfallPercent?.min,
        r.outsideCrossfallPercent?.max,
        r.insideWideningM,
        r.outsideWideningM,
        r.completeSampleCount,
        r.sampleCount,
        alignment.curveDesign?.criteriaName,
        alignment.curveDesign?.criteriaSource,
        r.warnings.join(' | '),
        r.innerEdgeGradeReason ?? 'Available under stated assumptions',
        INNER_EDGE_GRADE_BASIS,
        CURVE_REVIEW_BASIS,
        terrain?.name ?? 'Source metadata not supplied',
        terrain?.resolutionM,
        terrain?.verticalReference,
        terrain?.sourceUrl,
        terrain?.sha256,
      ]
        .map(csvValue)
        .join(','),
    ),
  ].join('\r\n')
}
