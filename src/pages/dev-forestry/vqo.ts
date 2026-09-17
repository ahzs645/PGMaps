/**
 * Visual quality classes and objectives.
 *
 * British Columbia manages scenery by assigning a visual quality objective to
 * a scenic area and then holding proposed harvesting to the share of the
 * visible landscape that objective allows to be altered. The class definitions
 * in the Forest Planning and Practices Regulation are written as degrees of
 * visual dominance; the percentage bands below are the ones the Visual Impact
 * Assessment Guidebook pairs with them for perspective-view denudation.
 *
 * They are defaults, not law: an assessment can be held to a district's own
 * numbers, so every threshold on this page is editable.
 */

export type VisualQualityClassId =
  | 'preservation'
  | 'retention'
  | 'partial-retention'
  | 'modification'
  | 'maximum-modification'

export type VisualQualityClass = {
  id: VisualQualityClassId
  /** Short form used on maps and in tables (P, R, PR, M, MM). */
  code: string
  label: string
  /** Upper bound on altered share of the visible landscape, in percent. */
  maxAlterationPercent: number
  description: string
  color: string
}

export const VISUAL_QUALITY_CLASSES: readonly VisualQualityClass[] = [
  {
    id: 'preservation',
    code: 'P',
    label: 'Preservation',
    maxAlterationPercent: 1,
    description: 'Alteration is very small and not easy to distinguish from the natural landscape.',
    color: '#15803d',
  },
  {
    id: 'retention',
    code: 'R',
    label: 'Retention',
    maxAlterationPercent: 5,
    description: 'Alteration is difficult to see and stays natural in form, line, colour, and texture.',
    color: '#65a30d',
  },
  {
    id: 'partial-retention',
    code: 'PR',
    label: 'Partial retention',
    maxAlterationPercent: 15,
    description: 'Alteration is easy to see but remains subordinate to the landscape as a whole.',
    color: '#ca8a04',
  },
  {
    id: 'modification',
    code: 'M',
    label: 'Modification',
    maxAlterationPercent: 25,
    description: 'Alteration dominates parts of the view while still borrowing natural shapes.',
    color: '#ea580c',
  },
  {
    id: 'maximum-modification',
    code: 'MM',
    label: 'Maximum modification',
    maxAlterationPercent: 40,
    description: 'Alteration is very dominant, out of scale, and reads as a designed opening.',
    color: '#b91c1c',
  },
] as const

export const DEFAULT_VISUAL_QUALITY_CLASS_ID: VisualQualityClassId = 'partial-retention'

/** Editable thresholds keyed by class, seeded from the guidebook defaults. */
export type VisualQualityThresholds = Record<VisualQualityClassId, number>

export const DEFAULT_VISUAL_QUALITY_THRESHOLDS: VisualQualityThresholds = Object.fromEntries(
  VISUAL_QUALITY_CLASSES.map((entry) => [entry.id, entry.maxAlterationPercent]),
) as VisualQualityThresholds

export function visualQualityClass(id: VisualQualityClassId): VisualQualityClass {
  const found = VISUAL_QUALITY_CLASSES.find((entry) => entry.id === id)
  if (!found) throw new Error(`Unknown visual quality class: ${id}`)
  return found
}

export function thresholdFor(id: VisualQualityClassId, thresholds: VisualQualityThresholds): number {
  const value = thresholds[id]
  return Number.isFinite(value) ? value : visualQualityClass(id).maxAlterationPercent
}

/**
 * The most restrictive class an alteration percentage still satisfies, or
 * `null` when it exceeds even maximum modification.
 */
export function classifyAlteration(
  alterationPercent: number,
  thresholds: VisualQualityThresholds = DEFAULT_VISUAL_QUALITY_THRESHOLDS,
): VisualQualityClass | null {
  if (!Number.isFinite(alterationPercent)) return null
  const ordered = [...VISUAL_QUALITY_CLASSES].sort(
    (a, b) => thresholdFor(a.id, thresholds) - thresholdFor(b.id, thresholds),
  )
  return ordered.find((entry) => alterationPercent <= thresholdFor(entry.id, thresholds)) ?? null
}

export type ObjectiveVerdict = {
  objective: VisualQualityClass
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
  thresholds: VisualQualityThresholds = DEFAULT_VISUAL_QUALITY_THRESHOLDS,
): ObjectiveVerdict {
  const objective = visualQualityClass(objectiveId)
  const thresholdPercent = thresholdFor(objectiveId, thresholds)
  return {
    objective,
    alterationPercent,
    thresholdPercent,
    met: Number.isFinite(alterationPercent) && alterationPercent <= thresholdPercent,
    headroomPercent: thresholdPercent - alterationPercent,
    achieved: classifyAlteration(alterationPercent, thresholds),
  }
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
