/**
 * Visual quality classes, and the two different percentage scales British
 * Columbia holds them to.
 *
 * This distinction is the whole reason this file is long. A visual quality
 * objective is *defined* by how much alteration is visible in **perspective
 * view** — what a person standing at a viewpoint actually sees. Timber supply
 * analyses cannot model that, so they use a second, much looser set of
 * **planimetric** percentages applied to map area. The two are not
 * interchangeable, and comparing a perspective number against a planimetric
 * threshold passes alterations that would fail.
 *
 * Sources, both Ministry of Forests:
 * - *A Guide to Visual Quality Objectives* (QP371691, Mar 2013) — the
 *   perspective-view ranges and the partial-cut guide.
 * - *Procedures for Factoring Visual Resources into Timber Supply Analyses*
 *   (Mar 17 1998) — Table 3 planimetric denudation, Table 4 denudation by VAC,
 *   Table 6 visually effective green-up height by slope.
 */

export type VisualQualityClassId =
  | 'preservation'
  | 'retention'
  | 'partial-retention'
  | 'modification'
  | 'maximum-modification'

/**
 * Which scale a percentage is measured on.
 *
 * `perspective` is the objective's own definition: the share of an identifiable
 * landform's visible face that reads as altered from a viewpoint.
 * `planimetric` is the timber-supply proxy: altered share of the landform's
 * forested area, measured flat on the map.
 */
export type AlterationBasis = 'perspective' | 'planimetric'

/** Visual absorption capability — a landform's capacity to hide alteration. */
export type VacRating = 'low' | 'medium' | 'high'

export const VAC_RATINGS: readonly VacRating[] = ['low', 'medium', 'high'] as const

export const VAC_LABELS: Record<VacRating, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

export type VisualQualityClass = {
  id: VisualQualityClassId
  /** Short form used on maps and in tables (P, R, PR, M, MM). */
  code: string
  label: string
  description: string
  color: string
  /** Upper bound of the perspective-view range, in percent (2013 guide). */
  perspectiveMaxPercent: number
  /** Upper bound of the planimetric denudation range, in percent (1998 Table 3). */
  planimetricMaxPercent: number
  /**
   * Planimetric denudation by visual absorption capability (1998 Table 4). A
   * low-VAC landform supports less denudation than a high-VAC one for the same
   * class, so this refines the class range down to a single figure.
   */
  vacDenudationPercent: Record<VacRating, number>
}

export const VISUAL_QUALITY_CLASSES: readonly VisualQualityClass[] = [
  {
    id: 'preservation',
    code: 'P',
    label: 'Preservation',
    description: 'Alteration is very small in scale, and not easily distinguishable from the pre-harvest landscape.',
    color: '#15803d',
    perspectiveMaxPercent: 0,
    planimetricMaxPercent: 1,
    vacDenudationPercent: { low: 0, medium: 0.5, high: 1 },
  },
  {
    id: 'retention',
    code: 'R',
    label: 'Retention',
    description: 'Alteration is difficult to see, small in scale, and natural in appearance.',
    color: '#65a30d',
    perspectiveMaxPercent: 1.5,
    planimetricMaxPercent: 5,
    vacDenudationPercent: { low: 1.1, medium: 3.0, high: 5 },
  },
  {
    id: 'partial-retention',
    code: 'PR',
    label: 'Partial retention',
    description:
      'Alteration is easy to see, small to medium in scale, and natural and not rectilinear or geometric in shape.',
    color: '#ca8a04',
    perspectiveMaxPercent: 7,
    planimetricMaxPercent: 15,
    vacDenudationPercent: { low: 5.1, medium: 10.0, high: 15 },
  },
  {
    id: 'modification',
    code: 'M',
    label: 'Modification',
    description:
      'Alteration is very easy to see, and is large in scale and natural in appearance, or small to medium in scale with some angular characteristics.',
    color: '#ea580c',
    perspectiveMaxPercent: 18,
    planimetricMaxPercent: 25,
    vacDenudationPercent: { low: 15.1, medium: 20.0, high: 25 },
  },
  {
    id: 'maximum-modification',
    code: 'MM',
    label: 'Maximum modification',
    description:
      'Alteration is very easy to see, and is very large in scale, rectilinear and geometric in shape, or both.',
    color: '#b91c1c',
    perspectiveMaxPercent: 30,
    planimetricMaxPercent: 40,
    vacDenudationPercent: { low: 25.1, medium: 32.5, high: 40 },
  },
] as const

export const DEFAULT_VISUAL_QUALITY_CLASS_ID: VisualQualityClassId = 'partial-retention'

export const ALTERATION_BASIS_LABELS: Record<AlterationBasis, string> = {
  perspective: 'Perspective view',
  planimetric: 'Planimetric (timber supply)',
}

export const ALTERATION_BASIS_NOTES: Record<AlterationBasis, string> = {
  perspective:
    'How much of the landform’s visible face reads as altered from the viewpoint. This is what the objective is defined by.',
  planimetric:
    'Altered share of the landform’s forested area measured flat on the map. The looser scale timber supply analyses model against.',
}

/** Editable thresholds, one set per basis, keyed by class. */
export type VisualQualityThresholds = Record<AlterationBasis, Record<VisualQualityClassId, number>>

function thresholdsFor(basis: AlterationBasis): Record<VisualQualityClassId, number> {
  return Object.fromEntries(
    VISUAL_QUALITY_CLASSES.map((entry) => [
      entry.id,
      basis === 'perspective' ? entry.perspectiveMaxPercent : entry.planimetricMaxPercent,
    ]),
  ) as Record<VisualQualityClassId, number>
}

export const DEFAULT_VISUAL_QUALITY_THRESHOLDS: VisualQualityThresholds = {
  perspective: thresholdsFor('perspective'),
  planimetric: thresholdsFor('planimetric'),
}

export function visualQualityClass(id: VisualQualityClassId): VisualQualityClass {
  const found = VISUAL_QUALITY_CLASSES.find((entry) => entry.id === id)
  if (!found) throw new Error(`Unknown visual quality class: ${id}`)
  return found
}

export function thresholdFor(
  id: VisualQualityClassId,
  basis: AlterationBasis,
  thresholds: VisualQualityThresholds = DEFAULT_VISUAL_QUALITY_THRESHOLDS,
): number {
  const value = thresholds[basis]?.[id]
  if (Number.isFinite(value)) return value
  const entry = visualQualityClass(id)
  return basis === 'perspective' ? entry.perspectiveMaxPercent : entry.planimetricMaxPercent
}

/**
 * The lower bound of a class's range on a basis — the point where the class
 * below it stops. Preservation starts at zero.
 */
export function rangeFloorFor(
  id: VisualQualityClassId,
  basis: AlterationBasis,
  thresholds: VisualQualityThresholds = DEFAULT_VISUAL_QUALITY_THRESHOLDS,
): number {
  const ordered = orderedClasses(basis, thresholds)
  const index = ordered.findIndex((entry) => entry.id === id)
  if (index <= 0) return 0
  return thresholdFor(ordered[index - 1].id, basis, thresholds)
}

function orderedClasses(basis: AlterationBasis, thresholds: VisualQualityThresholds): VisualQualityClass[] {
  return [...VISUAL_QUALITY_CLASSES].sort(
    (a, b) => thresholdFor(a.id, basis, thresholds) - thresholdFor(b.id, basis, thresholds),
  )
}

/**
 * The most restrictive class an alteration percentage still satisfies on a
 * basis, or `null` when it exceeds even maximum modification.
 */
export function classifyAlteration(
  alterationPercent: number,
  basis: AlterationBasis,
  thresholds: VisualQualityThresholds = DEFAULT_VISUAL_QUALITY_THRESHOLDS,
): VisualQualityClass | null {
  if (!Number.isFinite(alterationPercent)) return null
  return (
    orderedClasses(basis, thresholds).find((entry) => alterationPercent <= thresholdFor(entry.id, basis, thresholds)) ??
    null
  )
}

export type ObjectiveVerdict = {
  objective: VisualQualityClass
  basis: AlterationBasis
  /** Percentage the verdict was formed from. */
  alterationPercent: number
  thresholdPercent: number
  met: boolean
  /** Percentage points still available (negative when the objective is exceeded). */
  headroomPercent: number
  /** The class the alteration actually achieves, or null when it exceeds all of them. */
  achieved: VisualQualityClass | null
}

export function assessObjective(
  alterationPercent: number,
  objectiveId: VisualQualityClassId,
  basis: AlterationBasis,
  thresholds: VisualQualityThresholds = DEFAULT_VISUAL_QUALITY_THRESHOLDS,
): ObjectiveVerdict {
  const objective = visualQualityClass(objectiveId)
  const thresholdPercent = thresholdFor(objectiveId, basis, thresholds)
  return {
    objective,
    basis,
    alterationPercent,
    thresholdPercent,
    met: Number.isFinite(alterationPercent) && alterationPercent <= thresholdPercent,
    headroomPercent: thresholdPercent - alterationPercent,
    achieved: classifyAlteration(alterationPercent, basis, thresholds),
  }
}

/**
 * The single planimetric denudation figure a class and VAC rating allow
 * (1998 Table 4), rather than the class's whole range. Falls back to the
 * class maximum when the landform carries no VAC rating — the inventory
 * leaves it unpopulated across much of the province.
 */
export function vacDenudationPercent(id: VisualQualityClassId, vac: VacRating | null): number {
  const entry = visualQualityClass(id)
  return vac ? entry.vacDenudationPercent[vac] : entry.planimetricMaxPercent
}

/**
 * Visually effective green-up: the tree height at which regeneration reads as
 * forest again rather than as disturbance (1998 Table 6). Steeper ground shows
 * more of the block's surface, so it needs taller trees to recover.
 *
 * Assumes a well stocked stand, little site disturbance, a middleground
 * viewing situation, and a vertical viewing angle under 20%.
 */
const VEG_HEIGHT_BY_SLOPE: ReadonlyArray<{ maxSlopePercent: number; heightMeters: number }> = [
  { maxSlopePercent: 5, heightMeters: 3.0 },
  { maxSlopePercent: 10, heightMeters: 3.5 },
  { maxSlopePercent: 15, heightMeters: 4.0 },
  { maxSlopePercent: 20, heightMeters: 4.5 },
  { maxSlopePercent: 25, heightMeters: 5.0 },
  { maxSlopePercent: 30, heightMeters: 5.5 },
  { maxSlopePercent: 35, heightMeters: 6.0 },
  { maxSlopePercent: 45, heightMeters: 6.5 },
  { maxSlopePercent: 50, heightMeters: 7.0 },
  { maxSlopePercent: 55, heightMeters: 7.5 },
  { maxSlopePercent: 60, heightMeters: 8.0 },
  { maxSlopePercent: Number.POSITIVE_INFINITY, heightMeters: 8.5 },
]

export function vegHeightForSlope(slopePercent: number): number {
  if (!Number.isFinite(slopePercent)) return VEG_HEIGHT_BY_SLOPE[0].heightMeters
  const band = VEG_HEIGHT_BY_SLOPE.find((entry) => slopePercent <= entry.maxSlopePercent)
  return (band ?? VEG_HEIGHT_BY_SLOPE[VEG_HEIGHT_BY_SLOPE.length - 1]).heightMeters
}

/**
 * Partial cutting is judged on what is left standing, not on denudation, so it
 * converts: FS1252 Table 4, *Visual Equivalent to Clearcut Percent Alteration
 * Factors for Partial Cut Alterations*. A partial cut of this intensity among
 * residuals of this height reads like a clearcut of this percentage.
 *
 * Rows are volume removed in 10% steps from 10% to 90%; columns are mean
 * residual tree height in 5 m steps from 5 m to 50 m.
 *
 * Held as the form's own numbers rather than as the class letters its shading
 * implies, because the form wants the number: "Clearcut equivalent __ %
 * alteration as read from Table 4. Record this value on line 2.3.2 a." A class
 * letter cannot be added into a sum; a percentage can. The class is then
 * derived from it through Table 3, so the two can never disagree.
 */
const PARTIAL_CUT_EQUIVALENT: ReadonlyArray<ReadonlyArray<number>> = [
  [0.1, 0.2, 0.4, 0.6, 0.7, 0.8, 1.0, 1.2, 1.8, 2.2],
  [0.3, 0.4, 0.7, 1.0, 1.2, 1.4, 1.8, 2.2, 3.3, 4.4],
  [0.7, 0.9, 1.2, 1.4, 2.0, 2.4, 3.3, 4.2, 5.0, 6.5],
  [1.2, 1.4, 2.0, 2.4, 3.4, 4.3, 5.2, 6.1, 6.7, 7.8],
  [1.8, 2.3, 3.4, 4.3, 5.2, 6.2, 6.8, 7.7, 8.4, 9.0],
  [3.5, 4.3, 5.0, 6.2, 6.7, 7.7, 8.4, 9.2, 10.0, 11.5],
  [4.9, 5.5, 6.5, 7.7, 8.4, 9.2, 10.0, 11.4, 12.7, 14.0],
  [6.0, 6.6, 8.3, 9.2, 10.0, 11.0, 12.0, 13.2, 14.4, 15.5],
  [8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0, 17.0],
]

/**
 * The clearcut-equivalent percent alteration a partial cut reads as, for adding
 * into the alteration sum. Null below 10% removed, where the table does not
 * start — that little does not read as an alteration at all.
 *
 * Read from the nearest cell rather than interpolated, because the form says
 * "as read from Table 4" and a reader with the paper form does exactly that.
 */
export function partialCutEquivalentPercent(
  volumeRemovedPercent: number,
  residualTreeHeightMeters: number,
): number | null {
  if (!Number.isFinite(volumeRemovedPercent) || !Number.isFinite(residualTreeHeightMeters)) return null
  if (volumeRemovedPercent < 10) return null

  const row = Math.min(PARTIAL_CUT_EQUIVALENT.length - 1, Math.max(0, Math.round(volumeRemovedPercent / 10) - 1))
  const columns = PARTIAL_CUT_EQUIVALENT[row].length
  const column = Math.min(columns - 1, Math.max(0, Math.round(residualTreeHeightMeters / 5) - 1))
  return PARTIAL_CUT_EQUIVALENT[row][column]
}

/**
 * The class a partial cut most likely achieves — its clearcut equivalent read
 * against the perspective ranges, which is what the shading on the form's own
 * copy of Table 4 shows.
 */
export function partialCutClass(
  volumeRemovedPercent: number,
  residualTreeHeightMeters: number,
  thresholds: VisualQualityThresholds = DEFAULT_VISUAL_QUALITY_THRESHOLDS,
): VisualQualityClass | null {
  const equivalent = partialCutEquivalentPercent(volumeRemovedPercent, residualTreeHeightMeters)
  if (equivalent === null) return null
  return classifyAlteration(equivalent, 'perspective', thresholds)
}

/**
 * Distance zones from the BC visual landscape inventory. They matter because
 * the same opening reads very differently depending on how far back it sits.
 */
export type ViewingZoneId = 'foreground' | 'middleground' | 'background'

export type ViewingZone = {
  id: ViewingZoneId
  label: string
  /** Inclusive lower bound and exclusive upper bound, in metres. */
  minMeters: number
  maxMeters: number
  color: string
}

export const VIEWING_ZONES: readonly ViewingZone[] = [
  { id: 'foreground', label: 'Foreground', minMeters: 0, maxMeters: 1000, color: '#ef4444' },
  { id: 'middleground', label: 'Middleground', minMeters: 1000, maxMeters: 8000, color: '#f97316' },
  {
    id: 'background',
    label: 'Background',
    minMeters: 8000,
    maxMeters: Number.POSITIVE_INFINITY,
    color: '#a855f7',
  },
] as const

export function viewingZoneFor(distanceMeters: number): ViewingZone {
  return (
    VIEWING_ZONES.find((zone) => distanceMeters >= zone.minMeters && distanceMeters < zone.maxMeters) ??
    VIEWING_ZONES[VIEWING_ZONES.length - 1]
  )
}
