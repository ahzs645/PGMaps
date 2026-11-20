/**
 * Grade magnitude bands, set from the project's road-wide grade limit. A grade on a class break
 * belongs to the class below it. The plan applies these bands to grades that meet the reviewed
 * standard and uses the engine's flags for breaches, including direction and short-pitch length.
 * The two inner breaks and three band colours are the person's (`roadColouring.ts`); a breach and
 * an unknown grade keep the plan's own red and grey. No DOM.
 */
import { DEFAULT_GRADE_COLOURING, GRADE_FIXED_COLORS, type GradeColourSettings } from './roadColouring'
import { isGradeBreachFlag, type GradeSpan } from './designStandards'
import type { RoadStation } from './types'

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
 * The active road's plan segments recoloured by grade class. Each segment is named by its end
 * station; `span` determines which station carries that interval's grade. The engine's grade flags
 * decide breaches, including loaded direction and short-pitch length. A permitted pitch above the
 * road-wide limit uses the steep colour. Segments without terrain and other roads keep their colour.
 */
export function gradeClassRoadLines(
  roads: GeoJSON.FeatureCollection,
  stations: readonly Pick<RoadStation, 'chainage' | 'gradePercent' | 'flags'>[],
  limitPercent: number,
  settings: GradeColourSettings = DEFAULT_GRADE_COLOURING,
  span: GradeSpan = 'behind',
): GeoJSON.FeatureCollection {
  const grades = new Map(
    stations.slice(1).map((station, i) => [station.chainage, span === 'ahead' ? stations[i] : station]),
  )
  return {
    ...roads,
    features: roads.features.map((feature) => {
      const p = feature.properties ?? {}
      if (!p.selected || p.chainage === undefined || p.color === GRADE_CLASS_COLORS.unknown) return feature
      const station = grades.get(Number(p.chainage))
      let grade = gradeClassOf(station?.gradePercent ?? null, limitPercent, settings)
      if (grade.id !== 'unknown') {
        if (station?.flags.some(isGradeBreachFlag))
          grade = { id: 'over', color: GRADE_FIXED_COLORS.over, label: 'Grade standard not met' }
        else if (grade.id === 'steep' || grade.id === 'over')
          grade = {
            id: 'steep',
            color: settings.colors.steep,
            label: `Grade above ${percent(settings.breaks[1] * limitPercent)} % · within standard`,
          }
      }
      return { ...feature, properties: { ...p, color: grade.color, legendLabel: grade.label } }
    }),
  }
}
