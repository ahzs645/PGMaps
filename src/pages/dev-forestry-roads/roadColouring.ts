/**
 * How the plan colours the active road: one settings object for the plan's **Colour road by**,
 * the cost dialog's **Colour road by this** and Save & export's Map PDF options, which all read and
 * write the same value (`useRoadColouring.ts`). A mode is one entry in `ROAD_COLOUR_MODES` plus its
 * own settings here; the colouring itself lives beside it (`costColours.ts`, `gradeClasses.ts`).
 * With nothing changed, every mode draws as its defaults below.
 *
 * Pure: no DOM or network access. Parsed by hand (`parseRoadColouring`), never trusted as stored.
 */
import { COLOR_RAMPS } from '@pgmaps/geo-toolkit/scales/colorRamps'

/** What the plan colours the active road by. */
export type RoadColourMode = 'plain' | 'grade' | 'cost'
export const ROAD_COLOUR_MODES: readonly { value: RoadColourMode; label: string }[] = [
  { value: 'plain', label: 'Plain' },
  { value: 'grade', label: 'Grade class' },
  { value: 'cost', label: 'Cost per metre' },
]
export const isRoadColourMode = (value: unknown): value is RoadColourMode =>
  ROAD_COLOUR_MODES.some((option) => option.value === value)

/** What a cost colour is read against: the road's own average $/m, or a $/m the person types. */
export type CostReference = 'average' | 'target'

export interface CostColourSettings {
  reference: CostReference
  /** The typed $/m, used while `reference` is `'target'`; kept while it is not. */
  targetPerMetre: number
  /** The ramp's ends as multiples of the reference; the ramp is even in log scale between them. */
  minRatio: number
  maxRatio: number
  /** A `COLOR_RAMPS` id, or a person's own ramp (`custom:<name>`) with its anchors in `rampColors`. */
  ramp: string
  rampColors?: readonly string[]
  /** Draw the ramp high to low. */
  reverse: boolean
}

/** The grade classes the person can colour; over the limit and unknown keep the plan's red and grey. */
export type GradeColourClass = 'gentle' | 'moderate' | 'steep'

export interface GradeColourSettings {
  /** The two inner class breaks as fractions of the grade limit; the third break is the limit. */
  breaks: readonly [number, number]
  colors: Record<GradeColourClass, string>
}

export interface RoadColouring {
  mode: RoadColourMode
  cost: CostColourSettings
  grade: GradeColourSettings
}

export const DEFAULT_COST_COLOURING: CostColourSettings = {
  reference: 'average',
  targetPerMetre: 500,
  minRatio: 0.25,
  maxRatio: 4,
  // Viridis runs dark to bright; reversed, a cheap stretch is pale yellow and a dear one deep purple.
  ramp: 'viridis',
  reverse: true,
}

export const DEFAULT_GRADE_COLOURING: GradeColourSettings = {
  breaks: [0.5, 0.75],
  colors: { gentle: '#16a34a', moderate: '#ca8a04', steep: '#ea580c' },
}

export const DEFAULT_ROAD_COLOURING: RoadColouring = {
  mode: 'plain',
  cost: DEFAULT_COST_COLOURING,
  grade: DEFAULT_GRADE_COLOURING,
}

/** What the fields accept; a stored value outside them falls back to its default. */
export const ROAD_COLOURING_LIMITS = {
  /** The ramp's low end, × the reference. */
  minRatio: { min: 0.01, max: 0.99 },
  /** The ramp's high end, × the reference. */
  maxRatio: { min: 1.01, max: 100 },
  targetPerMetre: { min: 0.01, max: 1_000_000 },
  /** A grade break, as a fraction of the limit; the two must rise. */
  gradeBreak: { min: 0.05, max: 0.95 },
  /** A person's own ramp: anchors kept with the settings. */
  rampColors: { min: 2, max: 12 },
} as const

/** The plan's own red and grey are not offered as grade colours; they would read as the flags. */
export const GRADE_FIXED_COLORS = { over: '#dc2626', unknown: '#9ca3af' } as const

const HEX = /^#[0-9a-f]{6}$/i
const within = (value: unknown, range: { min: number; max: number }): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= range.min && value <= range.max
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseCost(value: unknown): CostColourSettings {
  if (!isObject(value)) return DEFAULT_COST_COLOURING
  const d = DEFAULT_COST_COLOURING
  const L = ROAD_COLOURING_LIMITS
  const rampColors =
    Array.isArray(value.rampColors) &&
    value.rampColors.length >= L.rampColors.min &&
    value.rampColors.length <= L.rampColors.max &&
    value.rampColors.every((c) => typeof c === 'string' && HEX.test(c))
      ? (value.rampColors as string[]).map((c) => c.toLowerCase())
      : undefined
  const ramp = typeof value.ramp === 'string' && value.ramp.length > 0 && value.ramp.length <= 80 ? value.ramp : d.ramp
  // A ramp this build does not list and whose colours were not kept cannot be drawn: the default.
  const drawable = rampColors || COLOR_RAMPS.some((entry) => entry.id === ramp)
  return {
    reference: value.reference === 'target' ? 'target' : 'average',
    targetPerMetre: within(value.targetPerMetre, L.targetPerMetre) ? value.targetPerMetre : d.targetPerMetre,
    minRatio: within(value.minRatio, L.minRatio) ? value.minRatio : d.minRatio,
    maxRatio: within(value.maxRatio, L.maxRatio) ? value.maxRatio : d.maxRatio,
    ramp: drawable ? ramp : d.ramp,
    ...(drawable && rampColors ? { rampColors } : {}),
    reverse: value.reverse === true,
  }
}

function parseGrade(value: unknown): GradeColourSettings {
  if (!isObject(value)) return DEFAULT_GRADE_COLOURING
  const d = DEFAULT_GRADE_COLOURING
  const b = value.breaks
  const breaks: [number, number] =
    Array.isArray(b) &&
    b.length === 2 &&
    within(b[0], ROAD_COLOURING_LIMITS.gradeBreak) &&
    within(b[1], ROAD_COLOURING_LIMITS.gradeBreak) &&
    b[0] < b[1]
      ? [b[0], b[1]]
      : [...d.breaks]
  const colors = isObject(value.colors) ? value.colors : {}
  const colour = (id: GradeColourClass) =>
    typeof colors[id] === 'string' && HEX.test(colors[id] as string)
      ? (colors[id] as string).toLowerCase()
      : d.colors[id]
  return { breaks, colors: { gentle: colour('gentle'), moderate: colour('moderate'), steep: colour('steep') } }
}

/** A stored value read back; anything it does not hold, or holds out of range, is the default. */
export function parseRoadColouring(value: unknown): RoadColouring {
  if (!isObject(value)) return DEFAULT_ROAD_COLOURING
  return {
    mode: isRoadColourMode(value.mode) ? value.mode : DEFAULT_ROAD_COLOURING.mode,
    cost: parseCost(value.cost),
    grade: parseGrade(value.grade),
  }
}

/** The cost ramp's colours, low to high as drawn (reversed when asked). */
export function costRampColors(settings: CostColourSettings): readonly string[] {
  const colors =
    settings.rampColors ??
    COLOR_RAMPS.find((entry) => entry.id === settings.ramp)?.colors ??
    COLOR_RAMPS.find((entry) => entry.id === DEFAULT_COST_COLOURING.ramp)!.colors
  return settings.reverse ? [...colors].reverse() : colors
}

/** Whether these cost settings are the defaults, so a reset has something to do. */
export function isDefaultCostColouring(settings: CostColourSettings): boolean {
  const d = DEFAULT_COST_COLOURING
  return (
    settings.reference === d.reference &&
    settings.minRatio === d.minRatio &&
    settings.maxRatio === d.maxRatio &&
    settings.ramp === d.ramp &&
    !settings.rampColors &&
    settings.reverse === d.reverse
  )
}

export function isDefaultGradeColouring(settings: GradeColourSettings): boolean {
  const d = DEFAULT_GRADE_COLOURING
  return (
    settings.breaks[0] === d.breaks[0] &&
    settings.breaks[1] === d.breaks[1] &&
    (Object.keys(d.colors) as GradeColourClass[]).every((id) => settings.colors[id] === d.colors[id])
  )
}

/** A multiple as people write it: ¼, ½, 2, 1.5. */
export function ratioText(ratio: number): string {
  if (ratio === 0.25) return '¼'
  if (ratio === 0.5) return '½'
  if (ratio === 0.75) return '¾'
  return String(Number(ratio.toPrecision(3)))
}
