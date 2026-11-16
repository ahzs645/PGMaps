/**
 * Template values entered at stations, as RoadEng's per-range parameter overrides (Softree's help,
 * Parameter Overrides): a value is entered at chosen stations, a blank (RoadEng's `**`) means the
 * template's own value there, and between two stations the value is interpolated linearly. Before
 * the first station and after the last, the nearest station's value holds (inferred: Softree's
 * tutorials bracket every override with template values at the road's ends, which reads the same
 * either way). Between two blank stations the template's own value applies, so a template range
 * that starts there takes effect as it would without the override.
 *
 * An override changes one value on one side of whichever template is in force (`templateAt`), after
 * template ranges and their transitions are resolved. Pure: no DOM or network access.
 */
import type { RoadTemplate } from './types'

type Side = 'left' | 'right'

/** The side values an override can change, with PGMaps' template limits. */
export const OVERRIDE_FIELDS = {
  Width: { label: 'Width (m)', min: 0.1, max: 50 },
  CrossfallPercent: { label: 'Crossfall (%)', min: -20, max: 20 },
  CutSlope: { label: 'Cut batter (H:V)', min: 0.1, max: 10 },
  FillSlope: { label: 'Fill batter (H:V)', min: 0.1, max: 10 },
  DitchWidth: { label: 'Ditch top width (m)', min: 0, max: 10 },
  DitchDepth: { label: 'Ditch depth (m)', min: 0, max: 5 },
  DitchBottomWidth: { label: 'Ditch bottom width (m)', min: 0, max: 10 },
  SurfaceDepth: { label: 'Surfacing depth (m)', min: 0, max: 2 },
} as const
export type OverrideField = keyof typeof OVERRIDE_FIELDS
export const OVERRIDE_FIELD_NAMES = Object.keys(OVERRIDE_FIELDS) as OverrideField[]

/** Overrides one road holds, and stations one override holds. */
export const MAX_PARAMETER_OVERRIDES = 100
export const MAX_OVERRIDE_POINTS = 200
const EPS = 1e-7

export interface OverridePoint {
  /** Road chainage, m. */
  station: number
  /** The value here; null is the template's own value (RoadEng's `**`). */
  value: number | null
}

/** Where an override read from RoadEng came from, so an unedited one is written back as read. */
export interface OverrideRoadEngSource {
  /** The parameter's name and the code RoadEng stores beside it: the side, 4096 left and 8192 right. */
  parameter: string
  code: number
  /** The `[design] ParmOverrides-<n>` entries of this parameter, as read. */
  entries: string[]
}

export interface TemplateParameterOverride {
  id: string
  name: string
  side: Side
  field: OverrideField
  /** In station order; at least one. */
  points: OverridePoint[]
  roadEng?: OverrideRoadEngSource
}

/** The template's own value of a field on one side. */
export function overrideFieldValue(t: RoadTemplate, side: Side, field: OverrideField): number {
  if (field === 'Width') return t[`${side}Width`]
  const own = t[`${side}${field}`]
  if (typeof own === 'number') return own
  const base = t[`${field[0].toLowerCase()}${field.slice(1)}` as keyof RoadTemplate]
  return typeof base === 'number' ? base : 0
}

/**
 * The overridden value at a chainage, or null where the override leaves the template's own value.
 * `own(station)` is the template's own value at a station (before overrides).
 */
export function overrideValueAt(
  o: Pick<TemplateParameterOverride, 'points'>,
  chainage: number,
  own: (station: number) => number,
): number | null {
  const p = o.points
  if (!p.length) return null
  if (chainage <= p[0].station + EPS) return p[0].value
  const last = p[p.length - 1]
  if (chainage >= last.station - EPS) return last.value
  let k = 0
  while (k + 1 < p.length && p[k + 1].station <= chainage) k++
  const a = p[k],
    b = p[k + 1]
  if (a.value === null && b.value === null) return null
  if (Math.abs(chainage - a.station) < EPS) return a.value
  const va = a.value ?? own(a.station),
    vb = b.value ?? own(b.station)
  const t = (chainage - a.station) / (b.station - a.station)
  return va + (vb - va) * t
}

/**
 * Applies every override to a template resolved at `chainage` (in place). `ownAt(station)` resolves
 * the template at another station without overrides, for a blank end.
 */
export function applyParameterOverrides(
  template: RoadTemplate,
  chainage: number,
  overrides: readonly TemplateParameterOverride[] | undefined,
  ownAt: (station: number) => RoadTemplate,
): string[] {
  const applied: string[] = []
  if (!overrides?.length) return applied
  const cache = new Map<number, RoadTemplate>()
  const at = (station: number) => {
    if (!cache.has(station)) cache.set(station, ownAt(station))
    return cache.get(station)!
  }
  for (const o of overrides) {
    const value = overrideValueAt(o, chainage, (s) => overrideFieldValue(at(s), o.side, o.field))
    if (value === null) continue
    const { min, max } = OVERRIDE_FIELDS[o.field]
    const v = Math.max(min, Math.min(max, value))
    if (o.field === 'Width') template[`${o.side}Width`] = v
    else template[`${o.side}${o.field}`] = v
    applied.push(o.id)
  }
  // An interpolated ditch keeps its bottom within its top width.
  for (const side of ['left', 'right'] as const) {
    const width = overrideFieldValue(template, side, 'DitchWidth')
    if (overrideFieldValue(template, side, 'DitchBottomWidth') > width) template[`${side}DitchBottomWidth`] = width
  }
  return applied
}

/** Stations where an override's value changes slope, for the engine's station knots. */
export function parameterOverrideKnots(overrides: readonly TemplateParameterOverride[] | undefined): number[] {
  return (overrides ?? []).flatMap((o) => o.points.map((p) => p.station))
}

const record = (v: unknown, label: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error(`${label} must be an object.`)
  return v as Record<string, unknown>
}
const finite = (v: unknown, label: string, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    throw Error(`${label} must be between ${min} and ${max}.`)
  return v
}
const text = (v: unknown, label: string, max = 200): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw Error(`${label} must contain 1–${max} characters.`)
  return v.trim()
}

/** Reads a road's overrides from a project file, checking every limit. */
export function parseParameterOverrides(raw: unknown): TemplateParameterOverride[] {
  if (!Array.isArray(raw) || raw.length > MAX_PARAMETER_OVERRIDES)
    throw Error(`Parameter overrides must contain at most ${MAX_PARAMETER_OVERRIDES} entries.`)
  const out = raw.map((entry): TemplateParameterOverride => {
    const r = record(entry, 'Parameter override')
    const id = text(r.id, 'Parameter override ID', 100)
    if (!/^[a-zA-Z0-9_.:-]+$/.test(id)) throw Error('Parameter override ID contains unsupported characters.')
    if (r.side !== 'left' && r.side !== 'right') throw Error('A parameter override side must be left or right.')
    if (typeof r.field !== 'string' || !(r.field in OVERRIDE_FIELDS))
      throw Error(`A parameter override changes one of ${OVERRIDE_FIELD_NAMES.join(', ')}.`)
    const field = r.field as OverrideField
    const { label, min, max } = OVERRIDE_FIELDS[field]
    if (!Array.isArray(r.points) || !r.points.length || r.points.length > MAX_OVERRIDE_POINTS)
      throw Error(`A parameter override holds 1–${MAX_OVERRIDE_POINTS} stations.`)
    const points = r.points.map((p) => {
      const q = record(p, 'Parameter override station')
      return {
        station: finite(q.station, 'Parameter override station', 0, 100000),
        value: q.value === null ? null : finite(q.value, label, min, max),
      }
    })
    const result: TemplateParameterOverride = {
      id,
      name: text(r.name, 'Parameter override name'),
      side: r.side,
      field,
      points,
    }
    if (r.roadEng !== undefined) {
      const s = record(r.roadEng, 'Parameter override RoadEng source')
      if (
        !Array.isArray(s.entries) ||
        s.entries.length > MAX_OVERRIDE_POINTS ||
        s.entries.some((e) => typeof e !== 'string' || e.length > 1000)
      )
        throw Error('A parameter override’s RoadEng entries must be text.')
      result.roadEng = {
        parameter: text(s.parameter, 'RoadEng parameter', 200),
        code: finite(s.code, 'RoadEng parameter code', -1e9, 1e9),
        entries: s.entries as string[],
      }
    }
    validateParameterOverride(result)
    return result
  })
  if (new Set(out.map((o) => o.id)).size !== out.length) throw Error('Parameter override IDs must be unique.')
  return out
}

/** Stations in order and at least one; throws with a message naming the override. */
export function validateParameterOverride(o: TemplateParameterOverride): void {
  if (!o.points.length) throw Error(`${o.name}: enter at least one station.`)
  for (let k = 1; k < o.points.length; k++)
    if (!(o.points[k].station > o.points[k - 1].station + EPS))
      throw Error(`${o.name}: stations must increase (${o.points[k - 1].station} m, then ${o.points[k].station} m).`)
  const { min, max } = OVERRIDE_FIELDS[o.field]
  for (const p of o.points)
    if (p.value !== null && !(p.value >= min && p.value <= max))
      throw Error(`${o.name}: ${OVERRIDE_FIELDS[o.field].label} must be ${min} to ${max}.`)
}

/** A short line for lists: the side, field and its stations. */
export function describeOverride(o: TemplateParameterOverride): string {
  const value = (v: number | null) => (v === null ? 'template' : `${Math.round(v * 1000) / 1000}`)
  return `${o.side === 'left' ? 'Left' : 'Right'} ${OVERRIDE_FIELDS[o.field].label.replace(/ \(.*\)$/, '').toLowerCase()}: ${o.points
    .map((p) => `${Math.round(p.station * 10) / 10} m ${value(p.value)}`)
    .join(', ')}`
}
