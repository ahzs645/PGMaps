/**
 * A road's section, template ranges, superelevation and widening written back as RoadEng / Location
 * design values: the inverse of `roadEngDesignSettings.ts`, for the design writer (`roadEngExport.ts`).
 *
 * What it writes:
 *
 * - Per curve, the `108` design the writer takes as `RoadEngExportRoad.curves`, by road point id
 *   (`roadEngCurveInputs`): design speed, e max, the transition at the BC and at the EC, the
 *   transition fraction, e, the side friction demanded (v²/(gR) − e, g = 9.81) and the inside and
 *   outside widening, from PGMaps' curve rule (`evaluateCurveCriteria`) at each curve's radius and
 *   deflection. PGMaps runs its whole runoff before the curve, so the fraction outside the curve
 *   is 1. While PGMaps still holds the curve rule it imported from the design, nothing is given and
 *   the writer keeps each curve's own record; `roadEngCurveFromTables` reads an edited curve from the
 *   design's own tables, as RoadEng's Auto settings do.
 * - `.dsn` key overrides (`roadEngSectionOverrides`), `{ section: { key: value | null } }`, null
 *   deleting a key, to apply to the design the road was read from (`mergeRoadEngIni` in `roadEngExport.ts`):
 *   - `[TemplatesSct]` (kept in the first alignment's `.dsn`): each PGMaps section value that differs
 *     from what the import made of its RoadEng template is written into the parameter it came from
 *     (`RoadEngSideSources`): widths, header crossfall and `_SUPER`, batters, ditch depth, bottom,
 *     inslope and backslope, course thicknesses and the rock bench. Each parameter's formula in the
 *     changed component is evaluated again where it is plain arithmetic (`ROAD_WIDTH`, `SG_DEPTH`, …),
 *     and left for RoadEng otherwise. A library template with no RoadEng original is written as a
 *     copy of the road's base RoadEng template under a new code, with its own values. The lookup
 *     tables (superelevation, runoff, widening), `RoadOptions` and `CurveHorizontal` are rewritten
 *     only when PGMaps' curve rule differs from the imported one.
 *   - `[LocationParms]` of the alignment: the station ranges, split at every original boundary and
 *     every PGMaps assignment end, each row keeping all its other fields (ground layers, the
 *     unidentified ones) from the original row it lies in, with the left and right template codes
 *     PGMaps uses there. Neighbouring rows that end up the same are joined. Written only when the
 *     assignments differ from the imported ones.
 * - `.tbl` text for a lookup table (`writeRoadEngTbl`), the inverse of `parseRoadEngTbl`.
 *
 * Everything PGMaps does not model is kept: only changed values are written, every other key and
 * every other field of a rewritten line stays as read. A road with no RoadEng original gets no
 * templates: a template is RoadEng's own component library (fragments, legs, formulas), which this
 * module copies only from the user's own design, never from Softree's.
 *
 * Inferred, beyond what `roadEngDesignSettings.ts` states: `[LocationParms] nparams` counts the rows;
 * a template's `T<n>` numbers are consecutive and a new one takes the next; a formula RoadEng stores
 * for a calculated parameter is evaluated by RoadEng on load, so one this module cannot evaluate is
 * left as stored. Checked by `roadEngSectionExport.test.ts`: read → write → read gives the same PGMaps
 * template, assignments and widening, on synthetic designs and (with `ROADENG_SAMPLES`) on Softree's
 * samples, and every re-read section passes the project's validators.
 *
 * Pure: no DOM or network access.
 */
import { horizontalCurveFits } from './engine'
import type { RoadEngDsnOverrides } from './roadEngExport'
import type { RoadEngCurveFields } from './roadEngImport'
import { evaluateCurveCriteria } from './roadCriteria'
import {
  parseRoadEngSettings,
  readRoadEngIni,
  ROADENG_RUNOFF_TABLE,
  ROADENG_STEP_EPSILON,
  ROADENG_SUPERELEVATION_TABLE,
  ROADENG_WIDENING_TABLE,
  roadEngCurveDesignFor,
  roadEngTemplateFor,
  roadEngTemplateId,
  roadEngTableValue,
  roadEngTemplateToPgmaps,
  ROADENG_TAPER_CODE,
  type RoadEngIni,
  type RoadEngRangeOptions,
  type RoadEngSettings,
  type RoadEngSideSources,
  type RoadEngSource,
  type RoadEngSuperelevationTable,
  type RoadEngTemplate,
  type RoadEngTemplateOptions,
} from './roadEngDesignSettings'
import { rockCutAt } from './rockExcavation'
import { sideValue } from './templates'
import type { Alignment, CurveDesign, RoadTemplate, SectionComponent, SectionLayer, TemplateAssignment } from './types'

/** The last `[LocationParms]` row's end: the end of the road. */
const ROADENG_ROAD_END = '999999999'
/** Gravity used for the side friction RoadEng stores (`108` field 16; Softree's samples match it). */
export const ROADENG_GRAVITY = 9.81
/** A template code this module makes is at most this long, as RoadEng's own are. */
export const ROADENG_NEW_CODE_LENGTH = 8
/** Formula text evaluated at most, characters. */
const MAX_FORMULA_LENGTH = 500
const EPS = 1e-9

// ---- Numbers as RoadEng writes them ----------------------------------------------------------------

/** Up to 12 significant digits, no exponent, no trailing zeros, as RoadEng writes a value. */
export function roadEngNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (Math.abs(value) < 1e-12) return '0'
  let text = Number(value.toPrecision(12)).toString()
  if (/e/i.test(text)) text = value.toFixed(12).replace(/\.?0+$/, '')
  return text === '-0' ? '0' : text
}

// ---- Per curve (`108`) --------------------------------------------------------------------------------

/** JSON with every object's keys sorted, so two values compare equal whatever order they were built in. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : v,
  )
}
const sameCurveRule = (a: CurveDesign | null | undefined, b: CurveDesign | null | undefined) =>
  canonical(a ?? null) === canonical(b ?? null)

/** One curve's `108` design from PGMaps' rule at its radius and deflection. */
export function roadEngCurveFromRule(
  design: CurveDesign | null,
  radiusM: number,
  deflectionDegrees: number,
  spiralM = 0,
  defaultSpeedKmh = 50,
): RoadEngCurveFields {
  const v = (design?.designSpeedKmh ?? defaultSpeedKmh) / 3.6
  const criteria = design && radiusM > 0 ? evaluateCurveCriteria(design, radiusM, deflectionDegrees) : null
  const e = criteria ? criteria.appliedSuperelevationPercent / 100 : 0
  const runoff = design && radiusM > 0 ? Math.max(design.runoffLengthM, spiralM) : 0
  return {
    designSpeedMs: v,
    emax: design ? design.maxSuperelevationPercent / 100 : 0.06,
    runoffIn: runoff,
    runoffOut: runoff,
    // PGMaps runs the whole runoff before the curve.
    transitionFraction: 1,
    e,
    sideFriction: radiusM > 0 ? (v * v) / (ROADENG_GRAVITY * radiusM) - e : 0,
    widening: { insideM: criteria?.insideWideningM ?? 0, outsideM: criteria?.outsideWideningM ?? 0 },
  }
}

/**
 * One curve's `108` design from the RoadEng design's own tables, as RoadEng's Auto curve settings
 * read them: e interpolated in the superelevation table, the runoff in the runoff table (both
 * ends), the widening stepped through the widening table (both sides, and only when the design's
 * curves carry widening). For a curve kept from the design whose radius was edited while the curve
 * rule stayed the imported one. A value the tables do not give (a blank, unsafe combination) is left
 * out, for the writer to keep the read one.
 */
export function roadEngCurveFromTables(
  settings: RoadEngSettings,
  radiusM: number,
  deflectionDegrees: number,
  designSpeedKmh: number,
): RoadEngCurveFields {
  const unitM = settings.unitM
  const speed = unitM === 1 ? designSpeedKmh : designSpeedKmh / 1.609344
  const table = (index: number) => settings.superelevationTables.find((t) => t.index === index && t.rows.length)
  const out: RoadEngCurveFields = { designSpeedMs: designSpeedKmh / 3.6 }
  const superTable = table(ROADENG_SUPERELEVATION_TABLE)
  const e = superTable ? roadEngTableValue(superTable, radiusM / unitM, speed, 'interpolate') : null
  if (e !== null) {
    out.e = e
    out.sideFriction = (designSpeedKmh / 3.6) ** 2 / (ROADENG_GRAVITY * radiusM) - e
  }
  const runoffTable = table(ROADENG_RUNOFF_TABLE)
  const runoff = runoffTable ? roadEngTableValue(runoffTable, radiusM / unitM, speed, 'interpolate') : null
  if (runoff !== null) out.runoffIn = out.runoffOut = runoff * unitM
  const wideningTable = table(ROADENG_WIDENING_TABLE)
  if (wideningTable && settings.curves.some((c) => c.wideningInsideM > 0 || c.wideningOutsideM > 0)) {
    const w = roadEngTableValue(wideningTable, radiusM / unitM, deflectionDegrees, 'step')
    if (w !== null) out.widening = { insideM: w * unitM, outsideM: w * unitM }
  }
  return out
}

/**
 * Each curve's `108` design for the design writer (`RoadEngExportRoad.curves`), by road point id.
 * While PGMaps' curve rule is still the one imported from `original` it is empty (`kept`): the
 * writer then keeps each curve's own record, which the rule was fitted to. Otherwise, or with no
 * original, every fitted curve gets PGMaps' superelevation, side friction, runoff (all before the
 * curve, so a transition fraction of 1) and widening at its radius and deflection in the road model.
 */
export function roadEngCurveInputs(
  alignment: Pick<Alignment, 'points' | 'curveDesign'> & Partial<Alignment>,
  options: { original?: RoadEngSettings | null; designSpeedKmh?: number } = {},
): { curves: Record<string, RoadEngCurveFields>; kept: boolean } {
  const d = alignment.curveDesign ?? null
  const original = options.original ?? null
  if (original && sameCurveRule(roadEngCurveDesignFor(original).curveDesign, d)) return { curves: {}, kept: true }
  const curves: Record<string, RoadEngCurveFields> = {}
  for (const fit of horizontalCurveFits(alignment as Alignment)) {
    if (fit.status !== 'fitted' || !(fit.radiusM > 0)) continue
    const point = alignment.points[fit.point - 1]
    curves[point.id] = roadEngCurveFromRule(
      d,
      fit.radiusM,
      fit.deflectionDegrees,
      point.spiralM ?? 0,
      options.designSpeedKmh,
    )
  }
  return { curves, kept: false }
}

// ---- Lookup tables ------------------------------------------------------------------------------------

/**
 * A lookup table as `.tbl` text: description lines as `#` comments, the column headings with a blank
 * first cell, then a row per radius, comma-delimited, a blank cell where the table has none.
 */
export function writeRoadEngTbl(table: RoadEngSuperelevationTable): string {
  const lines = table.description.map((d) => (d === '#' ? '#' : `#${d}`))
  lines.push(['', ...table.speeds.map(roadEngNumber)].join(','))
  for (const row of table.rows)
    lines.push([roadEngNumber(row.radius), ...row.e.map((v) => (v === null ? '' : roadEngNumber(v)))].join(','))
  return lines.join('\r\n') + '\r\n'
}

/** A table as the `[TemplatesSct]` keys a design keeps it in (`LTable-<nn>-Desc-*`, `-Row-*`). */
export function roadEngTableKeys(table: RoadEngSuperelevationTable, options = '0'): Record<string, string> {
  const n = String(table.index).padStart(2, '0')
  const keys: Record<string, string> = {}
  table.description.forEach((d, k) => (keys[`LTable-${n}-Desc-${String(k).padStart(2, '0')}`] = d))
  keys[`LTable-${n}-Options`] = options
  keys[`LTable-${n}-Row-000`] = ['', ...table.speeds.map(roadEngNumber)].join(',')
  table.rows.forEach(
    (row, k) =>
      (keys[`LTable-${n}-Row-${String(k + 1).padStart(3, '0')}`] = [
        roadEngNumber(row.radius),
        ...row.e.map((v) => (v === null ? '' : roadEngNumber(v))),
      ].join(',')),
  )
  return keys
}

type WideningRow = NonNullable<CurveDesign['wideningTable']>[number]

/**
 * PGMaps' widening table as RoadEng's (radius in project units down, deflection across, the larger
 * of the two sides' widening in the body). A table written as steps by `roadEngWideningRows` comes
 * back as the rows and columns it was made from; any other is written as it stands, and RoadEng then
 * steps through it where PGMaps interpolated (`stepped: false`).
 */
export function roadEngWideningTableFrom(
  rows: readonly WideningRow[],
  unitM: number,
  description: string[] = [],
): { table: RoadEngSuperelevationTable; stepped: boolean; sidesDiffer: boolean } {
  const radii = [...new Set(rows.map((r) => r.radiusM))].sort((a, b) => a - b)
  const angles = [...new Set(rows.map((r) => r.deflectionDegrees))].sort((a, b) => a - b)
  const at = (r: number, a: number) => rows.find((v) => v.radiusM === r && v.deflectionDegrees === a)
  const value = (r: number, a: number) => {
    const v = at(r, a)
    return v ? Math.max(v.insideM, v.outsideM) : 0
  }
  const sidesDiffer = rows.some((r) => Math.abs(r.insideM - r.outsideM) > EPS)
  const sameRow = (r1: number, r2: number) => angles.every((a) => Math.abs(value(r1, a) - value(r2, a)) < EPS)
  const sameCol = (a1: number, a2: number) => radii.every((r) => Math.abs(value(r, a1) - value(r, a2)) < EPS)
  const near = (x: number, y: number) => Math.abs(x - y - ROADENG_STEP_EPSILON) < 1e-6
  // Rows: each kept radius may be followed by its step end, just short of the next radius.
  const keptRadii: number[] = []
  let steppedRows = radii.length > 1
  for (let i = 0; i < radii.length; i++) {
    keptRadii.push(radii[i])
    if (i + 2 < radii.length && near(radii[i + 2], radii[i + 1]) && sameRow(radii[i], radii[i + 1])) i++
    else if (i + 1 < radii.length) steppedRows = false
  }
  // Columns: [low, high) pairs whose midpoints give back the headings.
  const pairs: { lo: number; hi: number }[] = []
  let steppedCols = angles.length > 1
  for (let j = 0; j < angles.length; j++) {
    if (
      j + 1 < angles.length &&
      sameCol(angles[j], angles[j + 1]) &&
      (j + 2 >= angles.length ? true : near(angles[j + 2], angles[j + 1]))
    ) {
      pairs.push({ lo: angles[j], hi: angles[j + 1] })
      j++
    } else pairs.push({ lo: angles[j], hi: angles[j] })
  }
  const headings: number[] = []
  if (pairs.length) {
    headings.push(pairs[0].lo)
    for (let j = 1; j < pairs.length; j++) headings.push(2 * pairs[j].lo - headings[j - 1])
    const last = pairs.at(-1)!
    if (Math.abs(headings.at(-1)! - last.hi) > 1e-6) steppedCols = false
    for (let j = 0; j + 1 < pairs.length; j++)
      if (Math.abs((headings[j] + headings[j + 1]) / 2 - ROADENG_STEP_EPSILON - pairs[j].hi) > 1e-6) steppedCols = false
    for (let j = 1; j < headings.length; j++) if (!(headings[j] > headings[j - 1])) steppedCols = false
  }
  const stepped = steppedRows && steppedCols
  const useRadii = stepped ? keptRadii : radii
  const useAngles = stepped ? pairs.map((p) => p.lo) : angles
  const shown = stepped ? headings : angles
  const table: RoadEngSuperelevationTable = {
    index: ROADENG_WIDENING_TABLE,
    description,
    speeds: shown.map((a) => round6(a)),
    rows: useRadii.map((r) => ({
      radius: round6(r / unitM),
      e: useAngles.map((a) => round6(value(r, a) / unitM)),
    })),
  }
  return { table, stepped, sidesDiffer }
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6

/**
 * PGMaps' superelevation rule as RoadEng's superelevation table over the radii and speeds of `grid`:
 * e = V²/(127 R) − f held at 0, blank where the rule would need more than e max (an unsafe
 * combination in RoadEng's table).
 */
export function superelevationTableFor(
  design: CurveDesign,
  grid: RoadEngSuperelevationTable,
  unitM: number,
  speedUnitKmh: number,
): RoadEngSuperelevationTable {
  const emax = design.maxSuperelevationPercent / 100
  return {
    index: ROADENG_SUPERELEVATION_TABLE,
    description: grid.description,
    speeds: grid.speeds,
    rows: grid.rows.map((row) => ({
      radius: row.radius,
      e: grid.speeds.map((speed) => {
        const V = speed * speedUnitKmh,
          R = row.radius * unitM
        if (!(R > 0) || !(V > 0)) return null
        const needed = (V * V) / (127 * R) - design.sideFrictionFactor
        return needed > emax + 1e-9 ? null : round6(Math.max(0, needed))
      }),
    })),
  }
}

// ---- Formulas --------------------------------------------------------------------------------------

/**
 * Evaluates a RoadEng parameter formula of plain arithmetic: numbers, parameter names, + − × ÷,
 * brackets and the comparisons > < >= <= == != (1 true, 0 false). Null for anything else (a
 * function, an unknown name), which RoadEng then evaluates itself.
 */
export function evaluateRoadEngFormula(formula: string, values: ReadonlyMap<string, number>): number | null {
  if (formula.length > MAX_FORMULA_LENGTH) return null
  const tokens = formula.match(/\d+\.?\d*(?:e[+-]?\d+)?|\.\d+|[A-Za-z_][A-Za-z0-9_]*|>=|<=|==|!=|[-+*/()<>]|\S/gi) ?? []
  let k = 0
  const peek = () => tokens[k]
  const fail = Symbol('fail')
  const primary = (): number => {
    const t = tokens[k++]
    if (t === undefined) throw fail
    if (t === '(') {
      const v = comparison()
      if (tokens[k++] !== ')') throw fail
      return v
    }
    if (t === '-') return -primary()
    if (t === '+') return primary()
    if (/^[\d.]/.test(t)) return Number(t)
    if (/^[A-Za-z_]/.test(t)) {
      if (tokens[k] === '(') throw fail
      const v = values.get(t.toUpperCase())
      if (v === undefined) throw fail
      return v
    }
    throw fail
  }
  const term = (): number => {
    let v = primary()
    while (peek() === '*' || peek() === '/') {
      const op = tokens[k++]
      const r = primary()
      v = op === '*' ? v * r : v / r
    }
    return v
  }
  const sum = (): number => {
    let v = term()
    while (peek() === '+' || peek() === '-') {
      const op = tokens[k++]
      const r = term()
      v = op === '+' ? v + r : v - r
    }
    return v
  }
  const comparison = (): number => {
    const v = sum()
    const op = peek()
    if (!['>', '<', '>=', '<=', '==', '!='].includes(op ?? '')) return v
    k++
    const r = sum()
    const truth =
      op === '>'
        ? v > r
        : op === '<'
          ? v < r
          : op === '>='
            ? v >= r
            : op === '<='
              ? v <= r
              : op === '=='
                ? v === r
                : v !== r
    return truth ? 1 : 0
  }
  try {
    if (!tokens.length) return null
    const v = comparison()
    return k === tokens.length && Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

// ---- Applying overrides -------------------------------------------------------------------------------

export type { RoadEngDsnOverrides }

/** Later overrides win; a key both set differently is listed in `conflicts`. */
export function mergeRoadEngOverrides(...all: RoadEngDsnOverrides[]): {
  overrides: RoadEngDsnOverrides
  conflicts: string[]
} {
  const overrides: RoadEngDsnOverrides = {}
  const conflicts: string[] = []
  for (const o of all)
    for (const [section, keys] of Object.entries(o)) {
      const into = (overrides[section] ??= {})
      for (const [key, value] of Object.entries(keys)) {
        if (key in into && into[key] !== value) conflicts.push(`[${section}] ${key}`)
        into[key] = value
      }
    }
  return { overrides, conflicts }
}

// ---- Section and ranges --------------------------------------------------------------------------------

/** The RoadEng design a road was read from: what `roadEngSectionOverrides` writes back into. */
export interface RoadEngOriginal {
  /** The alignment's own `LocationN.dsn` and `LocationN.ds2`. */
  dsnText: string
  ds2Text: string
  /** The first alignment's `.dsn`, which holds the template table, when this is a later alignment. */
  projectDsnText?: string
  /** Metres per project unit. */
  unitM: number
  /** As passed to the import's mapping (`RoadEngRangeOptions`). */
  startStation: number
  endStation: number
  stationScale?: number
  /** The section the import fell back on (`roadEngTemplateFor`'s `fallback`). */
  fallback: RoadTemplate
  templateOptions?: RoadEngTemplateOptions
}

export interface RoadEngSectionExport {
  /** Keys for the alignment's own `.dsn` (`[LocationParms]`). */
  alignment: RoadEngDsnOverrides
  /** Keys for the `.dsn` holding `[TemplatesSct]`, the first alignment's. */
  templates: RoadEngDsnOverrides
  /** What was written, in plain words. */
  written: string[]
  /** PGMaps values with no RoadEng parameter to hold them, in plain words. */
  notWritten: string[]
  /** RoadEng template code for each PGMaps template id used (`base` for the road's own section). */
  codes: Record<string, string>
}

type Side = 'left' | 'right'
const SIDES: Side[] = ['left', 'right']

/** One template's parameter and header edits, by key. */
interface TemplateEdits {
  params: Map<string, number>
  header: Map<3 | 4, number>
  said: string[]
  notWritten: string[]
}

const keyOf = (s: Extract<RoadEngSource, { kind: 'parameter' }>, template = s.template) =>
  `T${template}-C${s.component}-U${s.parameter}`

const paramOf = (t: RoadEngTemplate, s: RoadEngSource | undefined) =>
  s?.kind === 'parameter'
    ? t.components.find((c) => c.index === s.component)?.parameters.find((p) => p.index === s.parameter)
    : undefined

const fmt = (v: number, digits = 2) => (Math.round(v * 10 ** digits) / 10 ** digits).toString()
const differs = (a: number | undefined, b: number | undefined) =>
  a === undefined || b === undefined ? a !== b : Math.abs(a - b) > 1e-6

/**
 * The parameter edits that make RoadEng template `t` give `wanted` when it is read again, given what
 * the import made of it (`mapped`) and where each part came from.
 */
function templateEdits(
  t: RoadEngTemplate,
  mapped: RoadTemplate,
  sources: { left: RoadEngSideSources; right: RoadEngSideSources },
  wanted: RoadTemplate,
  unitM: number,
  label: string,
): TemplateEdits {
  const edits: TemplateEdits = { params: new Map(), header: new Map(), said: [], notWritten: [] }
  const setParam = (s: RoadEngSource | undefined, raw: number, what: string) => {
    if (s?.kind === 'header') {
      edits.header.set(s.field, raw)
      return true
    }
    if (s?.kind !== 'parameter') return false
    const key = keyOf(s)
    const had = edits.params.get(key)
    if (had !== undefined && Math.abs(had - raw) > 1e-9) {
      edits.notWritten.push(
        `${label}: the right ${what} (RoadEng keeps one ${s.name} for both sides; the left value is written).`,
      )
      return true
    }
    edits.params.set(key, raw)
    return true
  }
  const rawOf = (s: RoadEngSource | undefined) => paramOf(t, s)?.raw
  const lengthRaw = (m: number) => m / unitM
  const slopeRaw = (s: RoadEngSource | undefined, hv: number) => Math.sign(rawOf(s) || 1) / hv
  const missing = (side: Side, what: string) =>
    edits.notWritten.push(`${label}: the ${side} ${what}; RoadEng's template has no value of its own it came from.`)

  for (const side of SIDES) {
    const src = sources[side]
    const width = { m: mapped[`${side}Width`], w: wanted[`${side}Width`] }
    if (differs(width.m, width.w)) {
      if (!src.width?.length) missing(side, 'road width')
      else {
        const others = src.width.slice(1).reduce((sum, s) => sum + (rawOf(s) ?? 0) * unitM, 0)
        if (width.w - others > EPS) setParam(src.width[0], lengthRaw(width.w - others), 'road width')
        else {
          for (const s of src.width.slice(1)) setParam(s, 0, 'shoulder width')
          setParam(src.width[0], lengthRaw(width.w), 'road width')
        }
        edits.said.push(`${label}: ${side} road width ${fmt(width.w)} m`)
      }
    }
    const fall = {
      m: sideValue(mapped, side, 'CrossfallPercent'),
      w: sideValue(wanted, side, 'CrossfallPercent'),
    }
    if (differs(fall.m, fall.w)) {
      if (!src.crossfall?.length) missing(side, 'crossfall')
      else {
        for (const s of src.crossfall) setParam(s, -fall.w / 100, 'crossfall')
        edits.said.push(`${label}: ${side} crossfall ${fmt(fall.w)} %`)
      }
    }
    const slopes = {
      cut: { m: sideValue(mapped, side, 'CutSlope'), w: sideValue(wanted, side, 'CutSlope') },
      fill: { m: sideValue(mapped, side, 'FillSlope'), w: sideValue(wanted, side, 'FillSlope') },
    }
    const changed = { cut: differs(slopes.cut.m, slopes.cut.w), fill: differs(slopes.fill.m, slopes.fill.w) }
    if (src.sharedSlope && (changed.cut || changed.fill) && differs(slopes.cut.w, slopes.fill.w)) {
      // One closing slope for cut and fill: the edited batter goes in, the cut one if both were.
      const kind = changed.cut ? 'cut' : 'fill',
        other = kind === 'cut' ? 'fill' : 'cut'
      setParam(src.cutSlope, slopeRaw(src.cutSlope, slopes[kind].w), `${kind} batter`)
      edits.said.push(`${label}: ${side} ${kind} batter ${fmt(slopes[kind].w)}:1`)
      edits.notWritten.push(
        `${label}: the ${side} ${other} batter ${fmt(slopes[other].w)}:1; RoadEng's template has one closing slope for cut and fill on this side, which takes the ${kind} batter (${fmt(slopes[kind].w)}:1).`,
      )
    } else
      for (const kind of ['cut', 'fill'] as const) {
        if (!changed[kind]) continue
        const s = kind === 'cut' ? src.cutSlope : src.fillSlope
        if (!s) missing(side, `${kind} batter`)
        else {
          setParam(s, slopeRaw(s, slopes[kind].w), `${kind} batter`)
          edits.said.push(`${label}: ${side} ${kind} batter ${fmt(slopes[kind].w)}:1`)
        }
      }
    // Ditch: depth, bottom and the inslope that keeps PGMaps' top width beside the backslope, which
    // is the cut batter (`batter` mode, or a basic ditch), the slope component's (`component` mode)
    // or RoadEng's own.
    const ditch = {
      m: {
        width: sideValue(mapped, side, 'DitchWidth'),
        depth: sideValue(mapped, side, 'DitchDepth'),
        bottom: sideValue(mapped, side, 'DitchBottomWidth'),
      },
      w: {
        width: sideValue(wanted, side, 'DitchWidth'),
        depth: sideValue(wanted, side, 'DitchDepth'),
        bottom: sideValue(wanted, side, 'DitchBottomWidth'),
      },
    }
    const ditchChanged =
      differs(ditch.m.width, ditch.w.width) ||
      differs(ditch.m.depth, ditch.w.depth) ||
      differs(ditch.m.bottom, ditch.w.bottom)
    const mode = src.backslope?.mode
    const componentId = mode === 'component' ? src.backslope!.componentId : undefined
    const continuation = {
      m: mapped.components?.find((c) => c.id === componentId),
      w: wanted.components?.find((c) => c.id === componentId),
    }
    const ownBack = src.ditch?.backslope ? 1 / Math.abs(rawOf(src.ditch.backslope) || 1) : null
    const backOf = (cut: number, c: SectionComponent | undefined) =>
      mode === 'batter'
        ? cut
        : mode === 'component'
          ? c && c.riseM > 0 && c.widthM > 0
            ? c.widthM / c.riseM
            : ownBack!
          : (ownBack ?? cut)
    const back = { m: backOf(slopes.cut.m, continuation.m), w: backOf(slopes.cut.w, continuation.w) }
    if (ditchChanged || (differs(back.m, back.w) && ditch.w.depth > 0)) {
      const d = src.ditch
      if (!d) {
        if (ditch.w.width > 0 && ditch.w.depth > 0) missing(side, 'ditch')
      } else if (!(ditch.w.width > 0) || !(ditch.w.depth > 0)) {
        if (d.include) setParam(d.include, 0, 'ditch')
        else if (d.depth) setParam(d.depth, 0, 'ditch depth')
        edits.said.push(`${label}: no ${side} ditch`)
      } else {
        const inslope = (ditch.w.width - ditch.w.bottom) / ditch.w.depth - back.w
        if (!(inslope > 0.01) || !d.depth || !d.inslope)
          edits.notWritten.push(
            `${label}: the ${side} ditch (${fmt(ditch.w.width)} m wide, ${fmt(ditch.w.depth)} m deep, ${fmt(ditch.w.bottom)} m bottom); with a ${fmt(back.w)}:1 backslope it leaves no inslope.`,
          )
        else {
          if (d.include && (rawOf(d.include) ?? 1) === 0) setParam(d.include, 1, 'ditch')
          setParam(d.depth, lengthRaw(ditch.w.depth), 'ditch depth')
          if (d.bottom) setParam(d.bottom, lengthRaw(ditch.w.bottom), 'ditch bottom')
          setParam(d.inslope, slopeRaw(d.inslope, inslope), 'ditch inslope')
          if (mode && d.backslope && differs(back.m, back.w))
            setParam(d.backslope, slopeRaw(d.backslope, back.w), 'ditch backslope')
          edits.said.push(
            `${label}: ${side} ditch ${fmt(ditch.w.depth)} m deep, ${fmt(ditch.w.bottom)} m bottom, ${fmt(inslope)}:1 inslope`,
          )
        }
      }
    }
    // A backslope carried as a slope component: its height above the ditch bottom.
    if (mode === 'component' && src.ditch?.backslopeHeight) {
      const rise = (c: SectionComponent | undefined) => (c && c.riseM > 0 && c.widthM > 0 ? c.riseM : 0)
      if (differs(rise(continuation.m), rise(continuation.w)) || differs(ditch.m.depth, ditch.w.depth)) {
        setParam(src.ditch.backslopeHeight, lengthRaw(ditch.w.depth + rise(continuation.w)), 'backslope height')
        edits.said.push(`${label}: ${side} ditch backslope ${fmt(rise(continuation.w))} m above the road edge`)
      }
    }
    // Courses.
    const layerDepth = (template: RoadTemplate, key: string) =>
      (template.layers ?? []).find(
        (l) =>
          (l.id === `roadeng-${key}` && l.side === 'both') || (l.id === `roadeng-${key}-${side}` && l.side === side),
      )?.depthM ?? 0
    for (const [key, s] of Object.entries(src.layers ?? {})) {
      const m = layerDepth(mapped, key),
        w = layerDepth(wanted, key)
      if (!differs(m, w)) continue
      setParam(s, lengthRaw(w), 'course')
      edits.said.push(`${label}: ${side} ${key} ${fmt(w, 3)} m`)
    }
    // Rock bench.
    const rock = { m: rockCutAt(mapped, side), w: rockCutAt(wanted, side) }
    if (differs(rock.m?.cutSlope, rock.w?.cutSlope)) {
      if (!src.rockCutSlope || rock.w?.cutSlope === undefined) missing(side, 'rock cut batter')
      else setParam(src.rockCutSlope, slopeRaw(src.rockCutSlope, rock.w.cutSlope), 'rock cut batter')
    }
    if (differs(rock.m?.ledgeWidthM ?? 0, rock.w?.ledgeWidthM ?? 0)) {
      if (!src.rockLedge) missing(side, 'rock ledge')
      else setParam(src.rockLedge, lengthRaw(rock.w?.ledgeWidthM ?? 0), 'rock ledge')
    }
    for (const field of ['blastDepthM', 'blastCrossfallPercent', 'drainageCrossfallPercent', 'shallowDepthM'] as const)
      if (differs(rock.m?.[field], rock.w?.[field]))
        edits.notWritten.push(`${label}: the ${side} rock cut's ${field}; RoadEng's bench component has no such value.`)
  }
  // Courses and components PGMaps holds that RoadEng's template has no home for.
  const known = new Set(
    SIDES.flatMap((side) =>
      Object.keys(sources[side].layers ?? {}).flatMap((k) => [`roadeng-${k}`, `roadeng-${k}-${side}`]),
    ),
  )
  for (const l of wanted.layers ?? [])
    if (!known.has(l.id) && !sameLayer(mapped.layers, l))
      edits.notWritten.push(`${label}: the course ${l.name} (${fmt(l.depthM, 3)} m, ${l.side}).`)
  if (!(wanted.layers?.length ?? 0) && wanted.surfaceDepth > 0 && differs(mapped.surfaceDepth, wanted.surfaceDepth))
    edits.notWritten.push(
      `${label}: the ${fmt(wanted.surfaceDepth, 3)} m surfacing depth; RoadEng's courses are its layers.`,
    )
  const carried = new Set(SIDES.map((s) => sources[s].backslope?.componentId).filter(Boolean))
  for (const c of wanted.components ?? [])
    if (!carried.has(c.id) && canonical(mapped.components?.find((m) => m.id === c.id)) !== canonical(c))
      edits.notWritten.push(`${label}: the ${c.side} ${c.kind} component ${c.name}.`)
  return edits
}

const sameLayer = (list: SectionLayer[] | undefined, l: SectionLayer) =>
  (list ?? []).some((m) => canonical(m) === canonical(l))

/** The `[TemplatesSct]` keys that apply `edits` to template `t` (written at template number `at`). */
function editKeys(
  t: RoadEngTemplate,
  edits: TemplateEdits,
  section: Map<string, string>,
  at: number,
): Record<string, string> {
  const keys: Record<string, string> = {}
  if (edits.header.size) {
    const f = (section.get(`T${t.index}`) ?? '').split(',')
    for (const [field, raw] of edits.header) f[field] = roadEngNumber(raw)
    keys[`T${at}`] = f.join(',')
  }
  // Values by component, the edits applied, then each plain-arithmetic formula evaluated again.
  const touched = new Set<number>()
  const values = new Map<number, Map<string, number>>()
  for (const c of t.components) values.set(c.index, new Map(c.parameters.map((p) => [p.name.toUpperCase(), p.raw])))
  for (const [key, raw] of edits.params) {
    const [, c, u] = /^T\d+-C(\d+)-U(\d+)$/.exec(key)!.map(Number)
    const p = t.components.find((x) => x.index === c)?.parameters.find((x) => x.index === u)
    if (!p) continue
    values.get(c)!.set(p.name.toUpperCase(), raw)
    touched.add(c)
  }
  const write = (c: number, u: number, raw: number) => {
    const line = section.get(`T${t.index}-C${c}-U${u}`)
    if (line === undefined) return
    const f = line.split('|')
    f[2] = roadEngNumber(raw)
    keys[`T${at}-C${c}-U${u}`] = f.join('|')
  }
  for (const [key, raw] of edits.params) {
    const [, c, u] = /^T\d+-C(\d+)-U(\d+)$/.exec(key)!.map(Number)
    write(c, u, raw)
  }
  for (const c of touched) {
    const component = t.components.find((x) => x.index === c)!
    const vals = values.get(c)!
    // Formulas may refer to one another: evaluate until nothing changes.
    for (let pass = 0; pass < 5; pass++) {
      let changed = false
      for (const p of component.parameters) {
        if (!p.formula || edits.params.has(`T${t.index}-C${c}-U${p.index}`)) continue
        const v = evaluateRoadEngFormula(p.formula, vals)
        if (v === null || Math.abs(v - (vals.get(p.name.toUpperCase()) ?? NaN)) < 1e-12) continue
        vals.set(p.name.toUpperCase(), v)
        write(c, p.index, v)
        changed = true
      }
      if (!changed) break
    }
  }
  return keys
}

/** A new template code not in `taken`, from a PGMaps template's name. */
function newCode(name: string, taken: Set<string>): string {
  const stem =
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, ROADENG_NEW_CODE_LENGTH - 2) || 'PG'
  for (let k = 1; ; k++) {
    const code = k === 1 && !taken.has(stem) ? stem : `${stem.slice(0, ROADENG_NEW_CODE_LENGTH - String(k).length)}${k}`
    if (!taken.has(code)) {
      taken.add(code)
      return code
    }
  }
}

const sameAssignments = (a: readonly TemplateAssignment[], b: readonly TemplateAssignment[]) =>
  a.length === b.length &&
  a.every(
    (x, k) =>
      x.templateId === b[k].templateId &&
      x.side === b[k].side &&
      Math.abs(x.start - b[k].start) < 1e-6 &&
      Math.abs(x.end - b[k].end) < 1e-6 &&
      Math.abs(x.transitionM - b[k].transitionM) < 1e-6 &&
      Math.abs((x.transitionInM ?? 0) - (b[k].transitionInM ?? 0)) < 1e-6 &&
      Math.abs((x.transitionOutM ?? 0) - (b[k].transitionOutM ?? 0)) < 1e-6,
  )

const onSide = (a: TemplateAssignment, side: Side) => a.side === side || a.side === 'both'

/**
 * The stretches of a range that RoadEng's Taper gives: its transitions to the neighbouring ranges, and
 * a transition to the base section (`transitionM`) where the base section is the neighbour there.
 * `kept` lists the base transitions RoadEng cannot give, because another range is the neighbour.
 */
function taperStretches(assignments: readonly TemplateAssignment[], side: Side) {
  const stretches: { start: number; end: number }[] = []
  const kept: TemplateAssignment[] = []
  for (const a of assignments) {
    if (!onSide(a, side)) continue
    const into = a.transitionInM ?? 0,
      out = a.transitionOutM ?? 0
    if (into > 0) stretches.push({ start: a.start, end: a.start + into })
    if (out > 0) stretches.push({ start: a.end - out, end: a.end })
    if (a.transitionM > 0) {
      const touches = (at: number) =>
        assignments.some(
          (b) => b !== a && onSide(b, side) && (Math.abs(b.end - at) < 1e-6 || Math.abs(b.start - at) < 1e-6),
        )
      if (touches(a.start) || touches(a.end)) kept.push(a)
      else
        stretches.push({ start: a.start, end: a.start + a.transitionM }, { start: a.end - a.transitionM, end: a.end })
    }
  }
  return { stretches, kept }
}

/**
 * The `.dsn` keys that put a road's section, template ranges and curve tables back into the RoadEng
 * design it was read from. Only what differs from the import is written; with no original design,
 * nothing is (see the module comment).
 */
export function roadEngSectionOverrides(
  alignment: Pick<Alignment, 'template' | 'engineering' | 'curveDesign' | 'name'>,
  original: RoadEngOriginal | null,
): RoadEngSectionExport {
  const result: RoadEngSectionExport = { alignment: {}, templates: {}, written: [], notWritten: [], codes: {} }
  if (!original) {
    result.notWritten.push(
      `${alignment.name}: its section and template ranges, because the road was not read from a RoadEng design. A RoadEng template is a set of RoadEng's own library components, so it is written only into the design the road came from; RoadEng opens this road with its default template.`,
    )
    return result
  }
  const { unitM } = original
  const settings = parseRoadEngSettings(original.dsnText, original.ds2Text, unitM, {
    ...(original.projectDsnText !== undefined ? { projectDsnText: original.projectDsnText } : {}),
  })
  const projectIni: RoadEngIni = readRoadEngIni(original.projectDsnText ?? original.dsnText)
  const ownIni: RoadEngIni = readRoadEngIni(original.dsnText)
  const templatesSection = ownIni.get('TemplatesSct')?.size
    ? ownIni.get('TemplatesSct')!
    : projectIni.get('TemplatesSct')
  const rangeOptions: RoadEngRangeOptions = {
    startStation: original.startStation,
    endStation: original.endStation,
    ...(original.stationScale !== undefined ? { stationScale: original.stationScale } : {}),
  }
  const mapping = roadEngTemplateFor(settings, {
    ...rangeOptions,
    ...original.templateOptions,
    fallback: original.fallback,
  })
  const byCode = new Map<string, RoadEngTemplate>()
  for (const t of settings.templates) if (!t.folder && t.code && !byCode.has(t.code)) byCode.set(t.code, t)
  const engineering = alignment.engineering
  const usedIds = new Set((engineering?.assignments ?? []).map((a) => a.templateId))
  const templateEditsOut: Record<string, string | null> = {}
  const taken = new Set(settings.templates.map((t) => t.code))
  let nextIndex = Math.max(-1, ...settings.templates.map((t) => t.index)) + 1

  const writeTemplate = (code: string, wanted: RoadTemplate, label: string, at: number) => {
    const t = byCode.get(code)!
    const mapped = roadEngTemplateToPgmaps(t, original.fallback, original.templateOptions)
    if (!mapped.template) {
      result.notWritten.push(
        `${label}: RoadEng template ${code} gives no section this import reads, so it is kept as it is.`,
      )
      return
    }
    const edits = templateEdits(t, mapped.template, mapped.sources, wanted, unitM, label)
    Object.assign(templateEditsOut, editKeys(t, edits, templatesSection ?? new Map(), at))
    result.written.push(...edits.said)
    result.notWritten.push(...edits.notWritten)
  }

  // The road's own section.
  const baseCode = mapping.baseCode
  if (baseCode && byCode.has(baseCode)) {
    result.codes.base = baseCode
    writeTemplate(
      baseCode,
      alignment.template,
      `${alignment.name}'s section (${baseCode})`,
      byCode.get(baseCode)!.index,
    )
  } else
    result.notWritten.push(
      `${alignment.name}'s section: the design gives the road no RoadEng template it was read from.`,
    )
  // Library templates in use.
  for (const def of engineering?.templates ?? []) {
    if (!usedIds.has(def.id)) continue
    const code = [...byCode.keys()].find((c) => roadEngTemplateId(c) === def.id)
    if (code) {
      result.codes[def.id] = code
      writeTemplate(code, def.template, `Template ${def.name}`, byCode.get(code)!.index)
      continue
    }
    if (!baseCode || !byCode.has(baseCode) || !templatesSection) {
      result.notWritten.push(`Template ${def.name}: there is no RoadEng template in the design to write it from.`)
      continue
    }
    // A new template: a copy of the base RoadEng template under a new number and code.
    const base = byCode.get(baseCode)!
    const at = nextIndex++
    const made = newCode(def.name, taken)
    result.codes[def.id] = made
    const prefix = `T${base.index}-`
    for (const [key, value] of templatesSection)
      if (key.startsWith(prefix)) templateEditsOut[`T${at}-${key.slice(prefix.length)}`] = value
    const head = (templatesSection.get(`T${base.index}`) ?? '').split(',')
    head[1] = made
    head[2] = def.name
      .replace(/[\r\n]+/g, ' ')
      .replace(/,/g, '~')
      .slice(0, 120)
    templateEditsOut[`T${at}`] = head.join(',')
    const t = byCode.get(baseCode)!
    const mapped = roadEngTemplateToPgmaps(t, original.fallback, original.templateOptions)
    if (mapped.template) {
      const edits = templateEdits(
        t,
        mapped.template,
        mapped.sources,
        def.template,
        unitM,
        `Template ${def.name} (${made})`,
      )
      const keys = editKeys(t, edits, templatesSection, at)
      if (keys[`T${at}`]) {
        const f = keys[`T${at}`].split(',')
        f[1] = made
        f[2] = head[2]
        keys[`T${at}`] = f.join(',')
      }
      Object.assign(templateEditsOut, keys)
      result.notWritten.push(...edits.notWritten)
    }
    result.written.push(`Template ${def.name}: a new RoadEng template ${made}, made from ${baseCode}`)
  }

  // Station ranges. A transition is a Taper range of its own between the two ranges it joins.
  const assignments = engineering?.assignments ?? []
  const tapers = { left: taperStretches(assignments, 'left'), right: taperStretches(assignments, 'right') }
  const codeAt = (chainage: number, side: Side): string | null => {
    if (tapers[side].stretches.some((t) => chainage > t.start && chainage < t.end)) return ROADENG_TAPER_CODE
    const a = assignments
      .filter((x) => x.side !== (side === 'left' ? 'right' : 'left') && chainage >= x.start && chainage <= x.end)
      .sort((x, y) => y.start - x.start)[0]
    return a ? (result.codes[a.templateId] ?? null) : (result.codes.base ?? null)
  }
  const importedIds = new Set(mapping.templates.map((t) => t.id))
  const rangesSame =
    assignments.every((a) => importedIds.has(a.templateId)) && sameAssignments(mapping.assignments, assignments)
  if (!rangesSame && settings.stationRanges.length && result.codes.base) {
    const kept = new Set([...tapers.left.kept, ...tapers.right.kept])
    if (kept.size)
      result.notWritten.push(
        `${alignment.name}: the transition to the base section of ${kept.size} template range${kept.size === 1 ? '' : 's'} beside another range; RoadEng's Taper changes from the template before it to the one after it, so set the range's transition in and out instead.`,
      )
    const marks = [...tapers.left.stretches, ...tapers.right.stretches].flatMap((t) => [t.start, t.end])
    Object.assign(
      (result.alignment.LocationParms ??= {}),
      locationParms(settings, ownIni, rangeOptions, assignments, codeAt, marks),
    )
    result.written.push(`${alignment.name}: template ranges`)
  }

  // Curve tables, when PGMaps' curve rule is no longer the imported one.
  const imported = roadEngCurveDesignFor(settings).curveDesign
  const d = alignment.curveDesign ?? null
  if (d && templatesSection && !sameCurveRule(imported, d)) {
    const speedUnitKmh = unitM * 3.6 === 3.6 ? 1 : 1.609344
    const tables = settings.superelevationTables
    const superTable = tables.find((t) => t.index === ROADENG_SUPERELEVATION_TABLE && t.rows.length)
    if (
      superTable &&
      (imported === null ||
        imported.designSpeedKmh !== d.designSpeedKmh ||
        imported.maxSuperelevationPercent !== d.maxSuperelevationPercent ||
        imported.sideFrictionFactor !== d.sideFrictionFactor)
    ) {
      Object.assign(
        templateEditsOut,
        replaceTable(templatesSection, superelevationTableFor(d, superTable, unitM, speedUnitKmh)),
      )
      result.written.push(
        `The superelevation table, from PGMaps' rule (e = V²/127R − ${d.sideFrictionFactor}, e max ${d.maxSuperelevationPercent} %)`,
      )
    }
    const runoffTable = tables.find((t) => t.index === ROADENG_RUNOFF_TABLE && t.rows.length)
    if (runoffTable && superTable && (imported === null || imported.runoffLengthM !== d.runoffLengthM)) {
      const e = superelevationTableFor(d, superTable, unitM, speedUnitKmh)
      const runoff: RoadEngSuperelevationTable = {
        ...runoffTable,
        rows: runoffTable.rows.map((row) => ({
          radius: row.radius,
          e: runoffTable.speeds.map((speed) => {
            const k = superTable.speeds.indexOf(speed)
            const er = e.rows.find((r) => r.radius === row.radius)
            const ev = k >= 0 && er ? er.e[k] : null
            return ev === null || ev === undefined ? null : ev > 0 ? round6(d.runoffLengthM / unitM) : 0
          }),
        })),
      }
      Object.assign(templateEditsOut, replaceTable(templatesSection, runoff))
      result.written.push(`The runoff table, ${d.runoffLengthM} m where the rule superelevates`)
    }
    if (canonical(imported?.wideningTable ?? null) !== canonical(d.wideningTable ?? null)) {
      if (d.wideningTable?.length) {
        const old = tables.find((t) => t.index === ROADENG_WIDENING_TABLE)
        const { table, stepped, sidesDiffer } = roadEngWideningTableFrom(d.wideningTable, unitM, old?.description ?? [])
        Object.assign(templateEditsOut, replaceTable(templatesSection, table))
        result.written.push('The widening table')
        if (!stepped)
          result.notWritten.push(
            "The widening table's interpolation: RoadEng takes the row at or below a curve's radius and the column nearest its deflection.",
          )
        if (sidesDiffer)
          result.notWritten.push(
            "The widening table's separate inside and outside values; RoadEng's has one, the larger is written.",
          )
      } else if (tables.some((t) => t.index === ROADENG_WIDENING_TABLE && t.rows.length))
        result.notWritten.push(
          'Curve widening switched off: RoadEng applies its widening table through its templates, so the table is kept.',
        )
    }
    if (d.wideningVehicleLengthM !== null && !d.wideningTable?.length)
      result.notWritten.push(
        `Widening by vehicle length (L²/2R, ${d.wideningVehicleLengthM} m); RoadEng's widening is a table. Each curve's own widening is written with it.`,
      )
    // The road class and the default for a new curve.
    const options = templatesSection.get('RoadOptions')?.split(',')
    if (options) {
      options[1] = roadEngNumber(d.designSpeedKmh / 3.6 / unitM)
      options[13] = roadEngNumber(d.maxSuperelevationPercent / 100)
      templateEditsOut.RoadOptions = options.join(',')
    }
    const curve = templatesSection.get('CurveHorizontal')?.split(',')
    if (curve) {
      curve[8] = roadEngNumber(d.designSpeedKmh / 3.6 / unitM)
      curve[10] = roadEngNumber(d.maxSuperelevationPercent / 100)
      curve[12] = curve[13] = roadEngNumber(d.runoffLengthM / unitM)
      templateEditsOut.CurveHorizontal = curve.join(',')
    }
  }

  // Keys that would not change are not written.
  for (const [key, value] of Object.entries(templateEditsOut))
    if (templatesSection?.get(key) !== value) (result.templates.TemplatesSct ??= {})[key] = value
  for (const [key, value] of Object.entries(result.alignment.LocationParms ?? {}))
    if (ownIni.get('LocationParms')?.get(key) === value) delete result.alignment.LocationParms![key]
  if (result.alignment.LocationParms && !Object.keys(result.alignment.LocationParms).length)
    delete result.alignment.LocationParms
  return result
}

/** The keys replacing a lookup table's rows in `[TemplatesSct]`, its description and options kept. */
function replaceTable(section: Map<string, string>, table: RoadEngSuperelevationTable): Record<string, string | null> {
  const n = String(table.index).padStart(2, '0')
  const keys: Record<string, string | null> = {}
  for (const key of section.keys()) if (key.startsWith(`LTable-${n}-Row-`)) keys[key] = null
  const fresh = roadEngTableKeys(table, section.get(`LTable-${n}-Options`) ?? '0')
  for (const [key, value] of Object.entries(fresh)) if (/-Row-/.test(key)) keys[key] = value
  // A table with no description in the design keeps none; one that had one keeps it as it was.
  if (![...section.keys()].some((k) => k.startsWith(`LTable-${n}-Desc-`)))
    for (const [key, value] of Object.entries(fresh)) if (/-Desc-/.test(key)) keys[key] = value
  return keys
}

/**
 * `[LocationParms]` rows for PGMaps' template ranges: the original rows split at each assignment's
 * ends, each keeping every other field of the row it lies in, joined where neighbours are the same.
 */
function locationParms(
  settings: RoadEngSettings,
  ini: RoadEngIni,
  options: RoadEngRangeOptions,
  assignments: readonly TemplateAssignment[],
  codeAt: (chainage: number, side: Side) => string | null,
  /** More chainages to split the rows at: where each Taper range starts and ends. */
  marks: readonly number[] = [],
): Record<string, string | null> {
  const unitM = settings.unitM
  const scale = options.stationScale ?? 1
  const station = (chainage: number) => options.startStation + chainage / scale
  const ranges = settings.stationRanges
  // Boundaries, metres, with the text each is written as.
  const bounds = new Map<number, string>()
  for (const r of ranges) if (r.toStation !== null) bounds.set(r.toStation, r.raw[0])
  const near = (s: number) => [...bounds.keys()].find((b) => Math.abs(b - s) < 1e-6)
  // The road's own ends split a range that runs past them, so each side of an end keeps its codes.
  for (const s of [options.startStation, options.endStation])
    if (near(s) === undefined) bounds.set(s, roadEngNumber(s / unitM))
  for (const c of [...assignments.flatMap((a) => [a.start, a.end]), ...marks]) {
    const s = station(c)
    if (s <= options.startStation + 1e-6 || s >= options.endStation - 1e-6) continue
    if (near(s) === undefined) bounds.set(s, roadEngNumber(s / unitM))
  }
  const ends = [...bounds.keys()].sort((a, b) => a - b)
  const rows: string[][] = []
  let from = -Infinity
  for (const end of [...ends, Infinity]) {
    const mid = Number.isFinite(from) ? (Number.isFinite(end) ? (from + end) / 2 : from + 1e-3) : end - 1e-3
    const source = ranges.find((r) => r.toStation === null || r.toStation > mid + 1e-9) ?? ranges.at(-1)!
    const row = [...source.raw]
    row[0] = Number.isFinite(end) ? bounds.get(end)! : source.toStation === null ? source.raw[0] : ROADENG_ROAD_END
    if (mid > options.startStation && mid < options.endStation) {
      const chainage = (mid - options.startStation) * scale
      row[17] = codeAt(chainage, 'left') ?? row[17]
      row[18] = codeAt(chainage, 'right') ?? row[18]
    }
    const last = rows.at(-1)
    if (last && last.slice(1).join(',') === row.slice(1).join(',')) last[0] = row[0]
    else rows.push(row)
    from = end
  }
  const keys: Record<string, string | null> = {}
  const old = ini.get('LocationParms') ?? new Map<string, string>()
  for (const key of old.keys()) if (/^\d+$/.test(key) && Number(key) >= rows.length) keys[key] = null
  rows.forEach((row, k) => (keys[String(k)] = row.join(',')))
  if (old.has('nparams')) keys.nparams = String(rows.length)
  return keys
}
