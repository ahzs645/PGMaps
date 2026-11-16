/**
 * The optional culvert fields (shape, span, end area, barrels, material, embedment, inlet edge,
 * service): their limits, how a project file's are read, and what makes an entered set invalid.
 * A culvert with none of them is read and calculated exactly as before they existed.
 *
 * Free of DOM and network access.
 */
import type { Culvert } from '../engineeringTypes'
import { CULVERT_SHAPES, MAX_CULVERT_BARRELS, culvertShapeOf } from './culvertShape'
import { CULVERT_INLET_EDGES, CULVERT_MATERIALS } from './engineeringManual'

/** Change these with the limits table in `docs/forestry-road-design/culverts.md`. */
export const CULVERT_OPTION_LIMITS = {
  spanM: [0.1, 20],
  openingAreaM2: [0.01, 400],
  barrels: [1, MAX_CULVERT_BARRELS],
  embedmentM: [0, 5],
} as const

export type CulvertOptions = Pick<
  Culvert,
  'shape' | 'spanM' | 'openingAreaM2' | 'barrels' | 'material' | 'embedmentM' | 'inletEdge' | 'service'
>
export const CULVERT_OPTION_KEYS = [
  'shape',
  'spanM',
  'openingAreaM2',
  'barrels',
  'material',
  'embedmentM',
  'inletEdge',
  'service',
] as const satisfies readonly (keyof CulvertOptions)[]

const SERVICES = ['permanent', 'temporary'] as const

function bounded(value: unknown, label: string, [low, high]: readonly [number, number]): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high)
    throw Error(`${label} must be between ${low} and ${high}.`)
  return value
}
function choice<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw Error(`${label} must be ${values.join(', ')}.`)
  return value as T
}

/** The optional fields of one culvert in a project file. Absent fields stay absent. */
export function parseCulvertOptions(v: Record<string, unknown>): CulvertOptions {
  const out: CulvertOptions = {}
  if (v.shape !== undefined)
    out.shape = choice(
      v.shape,
      CULVERT_SHAPES.map((shape) => shape.value),
      'Culvert shape',
    )
  if (v.spanM !== undefined) out.spanM = bounded(v.spanM, 'Culvert span', CULVERT_OPTION_LIMITS.spanM)
  if (v.openingAreaM2 !== undefined)
    out.openingAreaM2 = bounded(v.openingAreaM2, 'Culvert end area', CULVERT_OPTION_LIMITS.openingAreaM2)
  if (v.barrels !== undefined) {
    out.barrels = bounded(v.barrels, 'Culvert barrels', CULVERT_OPTION_LIMITS.barrels)
    if (!Number.isInteger(out.barrels)) throw Error('Culvert barrels must be a whole number.')
  }
  if (v.material !== undefined)
    out.material = choice(
      v.material,
      CULVERT_MATERIALS.map((material) => material.value),
      'Culvert material',
    )
  if (v.embedmentM !== undefined)
    out.embedmentM = bounded(v.embedmentM, 'Culvert embedment', CULVERT_OPTION_LIMITS.embedmentM)
  if (v.inletEdge !== undefined)
    out.inletEdge = choice(
      v.inletEdge,
      CULVERT_INLET_EDGES.map((edge) => edge.value),
      'Culvert inlet',
    )
  if (v.service !== undefined) out.service = choice(v.service, SERVICES, 'Culvert service')
  return out
}

export interface CulvertOptionProblem {
  field: keyof CulvertOptions
  /** Without the culvert's name: "span (m) must be between 0.1 and 20". */
  message: string
}

/** What is wrong with the optional fields as entered; empty when nothing is. */
export function culvertOptionProblems(c: Culvert): CulvertOptionProblem[] {
  const problems: CulvertOptionProblem[] = []
  const range = (field: 'spanM' | 'openingAreaM2' | 'barrels' | 'embedmentM', label: string) => {
    const value = c[field],
      [low, high] = CULVERT_OPTION_LIMITS[field]
    if (value !== undefined && !(Number.isFinite(value) && value >= low && value <= high))
      problems.push({ field, message: `${label} must be between ${low} and ${high}.` })
  }
  range('spanM', 'span (m)')
  range('openingAreaM2', 'end area (m²)')
  range('barrels', 'barrels')
  range('embedmentM', 'embedment (m)')
  if (c.barrels !== undefined && !Number.isInteger(c.barrels))
    problems.push({ field: 'barrels', message: 'barrels must be a whole number.' })
  if (c.embedmentM !== undefined && c.embedmentM >= c.diameterM)
    problems.push({ field: 'embedmentM', message: 'embedment (m) must be less than the opening height.' })
  if (c.embedmentM && culvertShapeOf(c) === 'open-bottom-arch')
    problems.push({ field: 'embedmentM', message: 'an open-bottom arch has no floor to embed; clear the embedment.' })
  return problems
}

/**
 * The culvert with one optional field set or cleared. `undefined` removes the key, so a culvert put
 * back to its defaults is the same object a file without the field reads as.
 */
export function withCulvertOption<K extends keyof CulvertOptions>(
  c: Culvert,
  key: K,
  value: CulvertOptions[K],
): Culvert {
  const next = { ...c }
  if (value === undefined) delete next[key]
  else next[key] = value
  return next
}
