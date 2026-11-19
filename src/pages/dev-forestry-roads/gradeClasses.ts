/**
 * Grade classes for colouring the plan, set from the project's grade limit. A grade on a class
 * break belongs to the class below it, so a road exactly at the limit is within it, as the grade
 * flag reads it. Classes are judged on the absolute grade: up and down colour the same. The two
 * inner breaks and the three colours within the limit are the person's (`roadColouring.ts`);
 * over the limit and unknown keep the plan's own red and grey. No DOM.
 */
import { DEFAULT_GRADE_COLOURING, GRADE_FIXED_COLORS, type GradeColourSettings } from './roadColouring'

export type GradeClassId = 'gentle' | 'moderate' | 'steep' | 'over' | 'unknown'

export interface GradeClass {
  id: GradeClassId
  label: string
  color: string
}

/** The default class breaks as fractions of the grade limit: half, three quarters, the limit itself. */
export const GRADE_CLASS_BREAKS = [...DEFAULT_GRADE_COLOURING.breaks, 1] as const

/** The default colours. Over the limit and unknown keep the plan's own red and grey, so they read the same either way. */
export const GRADE_CLASS_COLORS: Record<GradeClassId, string> = {
  ...DEFAULT_GRADE_COLOURING.colors,
  ...GRADE_FIXED_COLORS,
}

const percent = (value: number) => `${Number(value.toFixed(1))}`

/** The four classes for a grade limit, gentlest first, then the unknown class. */
export function gradeClasses(
  limitPercent: number,
  settings: GradeColourSettings = DEFAULT_GRADE_COLOURING,
): GradeClass[] {
  const limit = Number.isFinite(limitPercent) && limitPercent > 0 ? limitPercent : 0
  const [low, high] = settings.breaks.map((fraction) => fraction * limit)
  return [
    { id: 'gentle', label: `Grade 0–${percent(low)} %`, color: settings.colors.gentle },
    { id: 'moderate', label: `Grade ${percent(low)}–${percent(high)} %`, color: settings.colors.moderate },
    { id: 'steep', label: `Grade ${percent(high)}–${percent(limit)} %`, color: settings.colors.steep },
    { id: 'over', label: `Over the ${percent(limit)} % limit`, color: GRADE_FIXED_COLORS.over },
    { id: 'unknown', label: 'Grade unknown', color: GRADE_FIXED_COLORS.unknown },
  ]
}

/** The class of one grade. A missing or non-finite grade is unknown, never gentle. */
export function gradeClassOf(
  gradePercent: number | null | undefined,
  limitPercent: number,
  settings: GradeColourSettings = DEFAULT_GRADE_COLOURING,
): GradeClass {
  const classes = gradeClasses(limitPercent, settings)
  const find = (id: GradeClassId) => classes.find((item) => item.id === id)!
  if (gradePercent === null || gradePercent === undefined || !Number.isFinite(gradePercent)) return find('unknown')
  const limit = Number.isFinite(limitPercent) && limitPercent > 0 ? limitPercent : 0
  const grade = Math.abs(gradePercent)
  if (grade > limit) return find('over')
  if (grade > settings.breaks[1] * limit) return find('steep')
  if (grade > settings.breaks[0] * limit) return find('moderate')
  return find('gentle')
}

/**
 * The active road's plan segments recoloured by grade class. Each segment is named by the station
 * that ends it, whose design grade is the interval's. Segments the plan already marks as having no
 * terrain under them keep that colour; other roads keep their own. Each recoloured segment carries
 * its class label for the legend.
 */
export function gradeClassRoadLines(
  roads: GeoJSON.FeatureCollection,
  stations: readonly { chainage: number; gradePercent: number | null }[],
  limitPercent: number,
  settings: GradeColourSettings = DEFAULT_GRADE_COLOURING,
): GeoJSON.FeatureCollection {
  const grades = new Map(stations.map((station) => [station.chainage, station.gradePercent]))
  return {
    ...roads,
    features: roads.features.map((feature) => {
      const p = feature.properties ?? {}
      if (!p.selected || p.chainage === undefined || p.color === GRADE_CLASS_COLORS.unknown) return feature
      const grade = gradeClassOf(grades.get(Number(p.chainage)) ?? null, limitPercent, settings)
      return { ...feature, properties: { ...p, color: grade.color, legendLabel: grade.label } }
    }),
  }
}
