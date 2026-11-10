/**
 * Grade classes for colouring the plan, set from the project's grade limit. A grade on a class
 * break belongs to the class below it, so a road exactly at the limit is within it, as the grade
 * flag reads it. Classes are judged on the absolute grade: up and down colour the same. No DOM.
 */

export type GradeClassId = 'gentle' | 'moderate' | 'steep' | 'over' | 'unknown'

export interface GradeClass {
  id: GradeClassId
  label: string
  color: string
}

/** Class breaks as fractions of the grade limit: half, three quarters, the limit itself. */
export const GRADE_CLASS_BREAKS = [0.5, 0.75, 1] as const

/** Over the limit and unknown keep the plan's own red and grey, so they read the same either way. */
export const GRADE_CLASS_COLORS: Record<GradeClassId, string> = {
  gentle: '#16a34a',
  moderate: '#ca8a04',
  steep: '#ea580c',
  over: '#dc2626',
  unknown: '#9ca3af',
}

const percent = (value: number) => `${Number(value.toFixed(1))}`

/** The four classes for a grade limit, gentlest first, then the unknown class. */
export function gradeClasses(limitPercent: number): GradeClass[] {
  const limit = Number.isFinite(limitPercent) && limitPercent > 0 ? limitPercent : 0
  const [half, threeQuarters] = GRADE_CLASS_BREAKS.map((fraction) => fraction * limit)
  return [
    { id: 'gentle', label: `Grade 0–${percent(half)} %`, color: GRADE_CLASS_COLORS.gentle },
    {
      id: 'moderate',
      label: `Grade ${percent(half)}–${percent(threeQuarters)} %`,
      color: GRADE_CLASS_COLORS.moderate,
    },
    { id: 'steep', label: `Grade ${percent(threeQuarters)}–${percent(limit)} %`, color: GRADE_CLASS_COLORS.steep },
    { id: 'over', label: `Over the ${percent(limit)} % limit`, color: GRADE_CLASS_COLORS.over },
    { id: 'unknown', label: 'Grade unknown', color: GRADE_CLASS_COLORS.unknown },
  ]
}

/** The class of one grade. A missing or non-finite grade is unknown, never gentle. */
export function gradeClassOf(gradePercent: number | null | undefined, limitPercent: number): GradeClass {
  const classes = gradeClasses(limitPercent)
  const find = (id: GradeClassId) => classes.find((item) => item.id === id)!
  if (gradePercent === null || gradePercent === undefined || !Number.isFinite(gradePercent)) return find('unknown')
  const limit = Number.isFinite(limitPercent) && limitPercent > 0 ? limitPercent : 0
  const grade = Math.abs(gradePercent)
  if (grade > limit) return find('over')
  if (grade > GRADE_CLASS_BREAKS[1] * limit) return find('steep')
  if (grade > GRADE_CLASS_BREAKS[0] * limit) return find('moderate')
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
): GeoJSON.FeatureCollection {
  const grades = new Map(stations.map((station) => [station.chainage, station.gradePercent]))
  return {
    ...roads,
    features: roads.features.map((feature) => {
      const p = feature.properties ?? {}
      if (!p.selected || p.chainage === undefined || p.color === GRADE_CLASS_COLORS.unknown) return feature
      const grade = gradeClassOf(grades.get(Number(p.chainage)) ?? null, limitPercent)
      return { ...feature, properties: { ...p, color: grade.color, legendLabel: grade.label } }
    }),
  }
}
