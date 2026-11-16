/**
 * RoadEng's vertical optimizer settings, read from and written back to a design's `LocationN.dsn`:
 * the grade and curvature standards by station range, the control points, and the named vertical
 * alignments (RoadEng's "V-align 1", "opt 3", …) as PGMaps' `verticalStandards`, `verticalControls`
 * and `verticalAlternatives`.
 *
 * **What is read.** Each `[OptAlignCost-k]` section is one vertical alignment of the horizontal one
 * (`[OptAlignCost] nOptCostParameters=count,active`):
 *
 * - `OptParms_Constraintv7-n=min grade %,max grade %,sag K,end station,crest K`, one Standards range
 *   ending at the station given (3.40282346639e+38, FLT_MAX, is the end of the road) and starting
 *   where the one before it ends. `Linear` in place of the sag K forces a straight grade over the
 *   range and has no crest K. A K of 0 or blank is no limit;
 * - `OptParms_CtrlPnt-n=station,elevation,elevation tolerance,grade %,grade tolerance,flags,
 *   description[,…]`, a control point; −9999 is a value not set;
 * - `OptParmsVIP-nnn=station,elevation,radius`, the profile of a vertical alignment that is not the
 *   active one (the active one's profile is the `.ds2`'s `109` records, which `roadEngImport.ts`
 *   reads; no `.ds2` in RoadEng's samples holds any other);
 * - `OptParmsNew` field 31 (0-based), the alignment's name.
 *
 * **Verified** against Softree's samples and help: the range layout and its Linear form (LongRoad's
 * bridge ±1 % Linear over 18,838–18,943 and 27,657–27,679 m, against its template ranges); sag before
 * crest (the Standards dialog's field order); control elevation and grade each with one ± tolerance;
 * names; `nOptCostParameters` (2,1 in the cul-de-sac design, whose second alignment, "opt 3", is the
 * one its `109` records and its solved cost belong to).
 * **Inferred**, consistent with every sample but stated nowhere: control flag bit 1 switches the
 * elevation on and bit 8 the grade (the one control with no grade has 33, the others 9; other bits
 * are kept as read); a VIP's third field is the signed vertical-curve radius, as in `109` (every
 * sample's is 0); grade limits at or past ±{@link ROADENG_UNLIMITED_GRADE_PERCENT} % are no limit,
 * the value this writes for a side PGMaps leaves open.
 *
 * **Mapping.** Stations go to the road's chainage as `roadEngImport.ts` moves them (minus the start
 * station, times the station scale). RoadEng's profile and control levels are the finished surface
 * and PGMaps' the subgrade, so both are lowered by `surfaceDepthM`, the depth the importer lowers the
 * active profile by. Ranges become one grade range and one curvature range per stretch of equal
 * limits. One RoadEng tolerance is both PGMaps tolerances; PGMaps' unequal pair is written as the same
 * band, centred. A second vertical alignment with a stored profile makes the road's named
 * alternatives, one per alignment, the active one taking the road's own profile; with one alignment
 * the road carries its standards and controls directly.
 *
 * **Writing** (`roadEngOptimizerOverrides`) returns `.dsn` key changes against the original design,
 * keeping every key PGMaps does not model (pits, haul, cost solutions, curve type, regularization,
 * `[HorOpt]`, flag bits and descriptions) and leaving a value as written when PGMaps' reading of it
 * is unchanged, so an untouched design written in the frame it was read in comes back byte for byte. An alternative removed in PGMaps is
 * removed from the design, later alignments moving down; a stored alignment PGMaps could not read
 * (no profile, or a control off the road) is kept.
 *
 * **Minimum curve and tangent lengths** are `OptParmsNew` fields, matched against Softree's Standards
 * dialog (curve type; Min. curve length; Min. tangent length) and the Optimal API's curve parameters
 * (`SoptSetCurveParam`: curve type, …, min curve length, min tangent length). Field 11 is the curve
 * type, numbered as the API's constants: 20 PolyLine, 21 Curves [Fast], 22 Curves and tangents
 * [Slow], 23 Variable curves and tangents [Slowest], 24 User defined (the samples hold 21, 22 and 23).
 * Field 3 is the minimum curve length and field 28 the minimum tangent length, in project units. That
 * placement is inferred: LongRoad's Curves and tangents alignment, for which RoadEng makes the
 * tangent equal to the curve, holds 100 in both; the cul-de-sac's two Variable alignments hold 80
 * and 10, and 80 and 200; the Fast feet design holds 0 in both. A 0 is no minimum. Each curve type
 * uses what its dialog allows: PolyLine a tangent only, Curves [Fast] a curve only (its tangent is
 * fixed at 0), Curves and tangents one length for both, Variable both, User defined neither. Writing
 * a pair the alignment's curve type cannot hold changes the type to the one that can (Variable for
 * unequal lengths, Curves [Fast] for a curve alone, Curves and tangents for equal ones), and says so.
 * The fields beside them (time limit, heuristic shortcut, base length, flag words) are kept as read.
 *
 * **Left out.** The optimizer's method and cost settings, and `[LocationParms]`, which in every
 * sample holds ground and template ranges (`roadEngDesignSettings.ts`), never grades or curvature.
 *
 * Checked by `roadEngOptimizer.test.ts`: synthetic designs, the project parser, read → write → read,
 * and Softree's samples when `ROADENG_SAMPLES` is set.
 *
 * Pure: no DOM or network access.
 */
import type { RoadEngDsnOverrides } from './roadEngExport'
import { snapshotActiveVerticalAlternative } from './verticalAlternatives'
import { curvatureRuleAt, gradeWindowAt } from './verticalStandards'
import type { Alignment, VerticalAlternative, VerticalControl, VerticalPoint, VerticalStandards } from './types'

/** A RoadEng station at or past this is the end of the road (FLT_MAX in the samples). */
export const ROADENG_OPT_END_STATION = 1e30
/** RoadEng's "not set" value. */
export const ROADENG_UNSET = -9999
/** A grade limit at or past ± this percent is no limit; written for a side PGMaps leaves open. */
export const ROADENG_UNLIMITED_GRADE_PERCENT = 100
/** Vertical alignments read from one design; PGMaps keeps at most 12 alternatives per road. */
export const MAX_ROADENG_VERTICAL_OPTIONS = 12
/** Standards ranges read from one vertical alignment (PGMaps' limit on each range list). */
export const MAX_ROADENG_OPT_RANGES = 100
/** Control points read from one vertical alignment (PGMaps' limit). */
export const MAX_ROADENG_OPT_CONTROLS = 200
/** VIPs read from one stored profile (PGMaps' limit on a profile). */
export const MAX_ROADENG_OPT_VIPS = 500
/** A control or profile end this close to a road end is on it, m. */
export const ROADENG_OPT_END_TOLERANCE_M = 0.001
/** Largest minimum K PGMaps takes. */
const MAX_K = 1000
/** How RoadEng writes FLT_MAX when no original says otherwise. */
const FLT_MAX_TEXT = '3.40282346639e+38'
/** Control flag bits (inferred): elevation and grade switched on. */
const FLAG_ELEVATION = 1
const FLAG_GRADE = 8
/** `OptParmsNew` field holding the alignment's name. */
const NAME_FIELD = 31
/** `OptParmsNew` fields (inferred; see the module comment): curve type, minimum curve and tangent lengths. */
export const ROADENG_CURVE_TYPE_FIELD = 11
export const ROADENG_MIN_CURVE_FIELD = 3
export const ROADENG_MIN_TANGENT_FIELD = 28
/** RoadEng's optimizer curve types (`OptParmsNew` field 11), as the Optimal API numbers them. */
export const ROADENG_CURVE_TYPES = {
  polyline: 20,
  curves: 21,
  curvesAndTangents: 22,
  variable: 23,
  userDefined: 24,
} as const
const CURVE_TYPE_NAMES: Record<number, string> = {
  20: 'PolyLine',
  21: 'Curves [Fast]',
  22: 'Curves and tangents [Slow]',
  23: 'Variable curves and tangents [Slowest]',
  24: 'User defined',
}
/** Longest minimum curve or tangent PGMaps takes, m (`project.ts`). */
const MAX_MIN_LENGTH_M = 10000
/** The `OptParmsNew` a fresh RoadEng 8 design carries, name last but three. */
const DEFAULT_OPT_PARMS_NEW = [
  '-',
  ...'0,0,0,0,-10,10,0,0,-1.79769313486e+308,1.79769313486e+308,21,0,0,32,2275,131071,0,0,0,0,0,0,0,66,0,-9999,-9999,0,0,0'.split(
    ',',
  ),
  'V-align 1',
  '1',
  '0',
  '-9999',
]
const DEFAULT_NAME = 'V-align 1'

// ---- What is read ---------------------------------------------------------------------------------

export interface RoadEngOptConstraint {
  key: string
  /** Signed percent; null is no limit. */
  minGradePercent: number | null
  maxGradePercent: number | null
  /** Minimum K, metres per percent; null is no limit. */
  sagK: number | null
  crestK: number | null
  linear: boolean
  /** Station the range ends at, m; null is the end of the road. */
  endStationM: number | null
}

export interface RoadEngOptControl {
  key: string
  stationM: number
  /** As stored, m; null when not set. Used only where `elevationEnabled`. */
  elevationM: number | null
  elevationToleranceM: number | null
  gradePercent: number | null
  gradeTolerancePercent: number | null
  flags: number
  elevationEnabled: boolean
  gradeEnabled: boolean
  description: string
  /** The value as written, fields split. */
  fields: string[]
}

export interface RoadEngOptVip {
  key: string
  stationM: number
  elevationM: number
  /** Signed vertical-curve radius, m (inferred: positive a sag, as in `109`); 0 no curve. */
  radiusM: number
}

export interface RoadEngVerticalOption {
  /** `OptAlignCost-k`. */
  section: string
  index: number
  name: string
  constraints: RoadEngOptConstraint[]
  controls: RoadEngOptControl[]
  vips: RoadEngOptVip[]
  /** `OptParmsNew` field 11; null when absent or unreadable. */
  curveType: number | null
  /** `OptParmsNew` fields 3 and 28 in metres as stored, 0 for none; null when absent. */
  storedMinCurveM: number | null
  storedMinTangentM: number | null
  /** Every key of the section as written, in file order. */
  keys: Map<string, string>
}

export interface RoadEngOptimizer {
  unitM: number
  options: RoadEngVerticalOption[]
  /** Index into `options` of the active vertical alignment; −1 without any. */
  activeIndex: number
  warnings: string[]
}

/** `.dsn` changes: section → key → new value, or null to remove the key (`mergeRoadEngIni` applies them). */
export type { RoadEngDsnOverrides }

// ---- INI ----------------------------------------------------------------------------------------

/** `[section] key=value` text with values exactly as written; later keys win. */
function readIni(text: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>()
  let current: Map<string, string> | null = null
  for (const raw of text.split(/\r?\n/)) {
    const header = /^\s*\[(.+)\]\s*$/.exec(raw)
    if (header) {
      current = sections.get(header[1]) ?? new Map()
      sections.set(header[1], current)
    } else if (current) {
      const eq = raw.indexOf('=')
      if (eq > 0) current.set(raw.slice(0, eq).trim(), raw.slice(eq + 1))
    }
  }
  return sections
}

// ---- Reading ------------------------------------------------------------------------------------

const num = (text: string | undefined) => (text === undefined || text.trim() === '' ? NaN : Number(text))
const set = (value: number) => (Number.isFinite(value) && value !== ROADENG_UNSET ? value : null)
const indexOf = (key: string, prefix: string) => {
  const match = new RegExp(`^${prefix}(\\d+)$`).exec(key)
  return match ? Number(match[1]) : null
}
const r3 = (v: number) => Math.round(v * 1000) / 1000
const r6 = (v: number) => Math.round(v * 1e6) / 1e6

function readConstraint(key: string, value: string, unitM: number): RoadEngOptConstraint | null {
  const f = value.split(',')
  const min = num(f[0]),
    max = num(f[1]),
    end = num(f[3])
  if (!Number.isFinite(end)) return null
  const linear = /^\s*linear\s*$/i.test(f[2] ?? '')
  const k = (text: string | undefined) => {
    const v = num(text)
    return Number.isFinite(v) && v > 0 ? r6(v * unitM) : null
  }
  return {
    key,
    minGradePercent: Number.isFinite(min) && min > -ROADENG_UNLIMITED_GRADE_PERCENT ? min : null,
    maxGradePercent: Number.isFinite(max) && max < ROADENG_UNLIMITED_GRADE_PERCENT ? max : null,
    sagK: linear ? null : k(f[2]),
    crestK: linear ? null : k(f[4]),
    linear,
    endStationM: end >= ROADENG_OPT_END_STATION ? null : end * unitM,
  }
}

function readControl(key: string, value: string, unitM: number): RoadEngOptControl | null {
  const f = value.split(',')
  const station = num(f[0]),
    flags = num(f[5])
  if (!Number.isFinite(station) || !Number.isFinite(flags)) return null
  const elevation = set(num(f[1])),
    elevationTolerance = set(num(f[2]))
  return {
    key,
    stationM: station * unitM,
    elevationM: elevation === null ? null : elevation * unitM,
    elevationToleranceM: elevationTolerance === null ? null : elevationTolerance * unitM,
    gradePercent: set(num(f[3])),
    gradeTolerancePercent: set(num(f[4])),
    flags,
    elevationEnabled: (flags & FLAG_ELEVATION) !== 0,
    gradeEnabled: (flags & FLAG_GRADE) !== 0,
    description: (f[6] ?? '').trim(),
    fields: f,
  }
}

/**
 * The optimizer settings of one alignment's `.dsn` (Latin-1 text). `unitM` is the design's metres
 * per project unit (`[design] units` ÷ 10,000), which for a later alignment is read from the first.
 */
export function parseRoadEngOptimizer(dsnText: string, unitM = 1): RoadEngOptimizer {
  if (!(unitM > 0)) throw Error('The design units must be a positive number of metres per project unit.')
  const ini = readIni(dsnText)
  const warnings: string[] = []
  const sections = [...ini.keys()]
    .map((name) => ({ name, index: indexOf(name, 'OptAlignCost-') }))
    .filter((s): s is { name: string; index: number } => s.index !== null)
    .sort((a, b) => a.index - b.index)
  const head = (ini.get('OptAlignCost')?.get('nOptCostParameters') ?? '').split(',').map(num)
  const count = Number.isInteger(head[0]) && head[0] >= 0 ? head[0] : sections.length
  if (count < sections.length)
    warnings.push(
      `The design lists ${count} vertical alignment${count === 1 ? '' : 's'} and holds ${sections.length}; the ${sections.length - count} past the count are not read.`,
    )
  const options = sections.slice(0, count).map((s, position): RoadEngVerticalOption => {
    const keys = ini.get(s.name)!
    const constraints: RoadEngOptConstraint[] = [],
      controls: RoadEngOptControl[] = [],
      vips: RoadEngOptVip[] = []
    const indexed = (prefix: string) =>
      [...keys.keys()]
        .map((key) => ({ key, n: indexOf(key, prefix) }))
        .filter((k): k is { key: string; n: number } => k.n !== null)
        .sort((a, b) => a.n - b.n)
    for (const { key } of indexed('OptParms_Constraintv7-')) {
      const c = readConstraint(key, keys.get(key)!, unitM)
      if (c) constraints.push(c)
      else warnings.push(`A standards range could not be read and is left out: ${key}=${keys.get(key)!.slice(0, 80)}`)
    }
    for (const { key } of indexed('OptParms_CtrlPnt-')) {
      const c = readControl(key, keys.get(key)!, unitM)
      if (c) controls.push(c)
      else warnings.push(`A control point could not be read and is left out: ${key}=${keys.get(key)!.slice(0, 80)}`)
    }
    for (const { key } of indexed('OptParmsVIP-')) {
      const f = keys.get(key)!.split(',').map(num)
      const radius = Number.isFinite(f[2]) ? f[2] : 0
      if (Number.isFinite(f[0]) && Number.isFinite(f[1]))
        vips.push({ key, stationM: f[0] * unitM, elevationM: f[1] * unitM, radiusM: radius * unitM })
      else warnings.push(`A stored VIP could not be read and is left out: ${key}=${keys.get(key)!.slice(0, 80)}`)
    }
    const fields = (keys.get('OptParmsNew') ?? '').split(',')
    const name = fields[NAME_FIELD]?.trim()
    const stored = (k: number) => {
      const v = num(fields[k])
      return Number.isFinite(v) && v >= 0 ? r6(v * unitM) : null
    }
    const type = num(fields[ROADENG_CURVE_TYPE_FIELD])
    return {
      section: s.name,
      index: position,
      name: name || `V-align ${position + 1}`,
      constraints,
      controls,
      vips,
      curveType: Number.isInteger(type) ? type : null,
      storedMinCurveM: stored(ROADENG_MIN_CURVE_FIELD),
      storedMinTangentM: stored(ROADENG_MIN_TANGENT_FIELD),
      keys,
    }
  })
  // The active alignment: the count's second field, else the one the reference names, else the
  // first with no stored profile (the active one's is in the `.ds2`).
  let activeIndex = Number.isInteger(head[1]) && head[1] >= 0 && head[1] < options.length ? head[1] : -1
  if (activeIndex < 0 && options.length) {
    const reference = (options[0].keys.get('OptParmsRefAlign') ?? '').split(',')[0]?.trim()
    activeIndex = options.findIndex((o) => o.name === reference && !o.vips.length)
    if (activeIndex < 0)
      activeIndex = Math.max(
        0,
        options.findIndex((o) => !o.vips.length),
      )
  }
  return { unitM, options, activeIndex, warnings }
}

// ---- To PGMaps ----------------------------------------------------------------------------------

export interface RoadEngOptimizerFrame {
  /** The alignment's first and last stations, m (`RoadEngAlignment.startStation`, `endStation`). */
  startStationM: number
  endStationM: number
  /** Road chainage ÷ design stations (`RoadEngRoad.stationScale`); 1 when omitted. */
  stationScale?: number
  /** Metres per project unit; 1 when omitted. */
  unitM?: number
  /** RoadEng's finished surface above PGMaps' profile, m: the depth the importer lowered it by. */
  surfaceDepthM?: number
}

/** A stretch of road with one set of limits; PGMaps' and RoadEng's standards compare through these. */
interface Piece {
  start: number
  end: number
  min: number | null
  max: number | null
  sag: number | null
  crest: number | null
  linear: boolean
}

const samePiece = (a: Piece, b: Piece) =>
  a.min === b.min && a.max === b.max && a.sag === b.sag && a.crest === b.crest && a.linear === b.linear

function mergePieces(pieces: Piece[]): Piece[] {
  const out: Piece[] = []
  for (const p of pieces) {
    const last = out[out.length - 1]
    if (last && samePiece(last, p) && Math.abs(last.end - p.start) < 1e-6) last.end = p.end
    else out.push({ ...p })
  }
  return out
}

/** PGMaps' standards as stretches of equal limits over the road, as its checks read them. */
function standardsPieces(standards: VerticalStandards | undefined, length: number): Piece[] {
  const marks = [0, length]
  for (const r of [...(standards?.gradeRanges ?? []), ...(standards?.curvatureRanges ?? [])])
    for (const v of [r.start, r.end]) if (v !== null && v > 1e-6 && v < length - 1e-6) marks.push(v)
  marks.sort((a, b) => a - b)
  const pieces: Piece[] = []
  for (let k = 0; k + 1 < marks.length; k++) {
    const a = marks[k],
      b = marks[k + 1]
    if (b - a <= 1e-6) continue
    const mid = (a + b) / 2,
      q = (b - a) / 4
    const grade = gradeWindowAt(standards, mid, length)
    const rule = curvatureRuleAt(standards, mid - q, mid + q, length)
    pieces.push({
      start: a,
      end: b,
      min: Number.isFinite(grade.low) ? grade.low : null,
      max: Number.isFinite(grade.high) ? grade.high : null,
      sag: rule.linear || !(rule.minSagK > 0) ? null : rule.minSagK,
      crest: rule.linear || !(rule.minCrestK > 0) ? null : rule.minCrestK,
      linear: rule.linear,
    })
  }
  return mergePieces(pieces)
}

const piecesEqual = (a: Piece[], b: Piece[]) =>
  a.length === b.length &&
  a.every(
    (p, k) =>
      Math.abs(p.start - b[k].start) < 2e-3 &&
      Math.abs(p.end - b[k].end) < 2e-3 &&
      closeOrNull(p.min, b[k].min) &&
      closeOrNull(p.max, b[k].max) &&
      closeOrNull(p.sag, b[k].sag) &&
      closeOrNull(p.crest, b[k].crest) &&
      p.linear === b[k].linear,
  )
const closeOrNull = (a: number | null, b: number | null, tolerance = 1e-6) =>
  a === null || b === null ? a === b : Math.abs(a - b) <= tolerance

function frameOf(frame: RoadEngOptimizerFrame) {
  const scale = frame.stationScale ?? 1,
    unitM = frame.unitM ?? 1,
    depth = frame.surfaceDepthM ?? 0
  if (!(scale > 0) || !(unitM > 0)) throw Error('The station scale and units must be positive.')
  const length = (frame.endStationM - frame.startStationM) * scale
  if (!(length > 0)) throw Error('The alignment must end after it starts.')
  return {
    scale,
    unitM,
    depth,
    length,
    chainage: (stationM: number) => (stationM - frame.startStationM) * scale,
    /** File station, project units, for a chainage. */
    station: (chainage: number) => (frame.startStationM + chainage / scale) / unitM,
  }
}
type Frame = ReturnType<typeof frameOf>

function constraintPieces(option: RoadEngVerticalOption, f: Frame, warnings: string[]): Piece[] {
  const pieces: Piece[] = []
  let from = 0
  for (const c of option.constraints.slice(0, MAX_ROADENG_OPT_RANGES)) {
    const to = c.endStationM === null ? f.length : Math.min(f.length, f.chainage(c.endStationM))
    if (c.endStationM !== null && to <= from + 1e-6) {
      if (f.chainage(c.endStationM) > 1e-6)
        warnings.push(`${option.name}: the standards range ${c.key} ends before the one above it and is left out.`)
      continue
    }
    pieces.push({
      start: from,
      end: to,
      min: c.minGradePercent,
      max: c.maxGradePercent,
      sag: c.sagK,
      crest: c.crestK,
      linear: c.linear,
    })
    from = to
    if (from >= f.length - 1e-6) break
  }
  if (pieces.length && from < f.length - 1e-6)
    // RoadEng's last range runs to the end of the road; one that stops short leaves the rest open.
    pieces.push({ start: from, end: f.length, min: null, max: null, sag: null, crest: null, linear: false })
  return mergePieces(pieces)
}

function piecesToStandards(pieces: Piece[], length: number): VerticalStandards | undefined {
  if (!pieces.length) return undefined
  const at = (v: number, end: boolean) => (end ? (v >= length - 1e-6 ? null : r3(v)) : v <= 1e-6 ? null : r3(v))
  const gradeRanges = pieces
    .filter((p) => p.min !== null || p.max !== null)
    .map((p, k) => ({
      id: `roadeng-grade-${k}`,
      start: at(p.start, false),
      end: at(p.end, true),
      minGradePercent: p.min,
      maxGradePercent: p.max,
    }))
  const curvatureRanges = pieces
    .filter((p) => p.sag !== null || p.crest !== null || p.linear)
    .map((p, k) => ({
      id: `roadeng-k-${k}`,
      start: at(p.start, false),
      end: at(p.end, true),
      minSagK: p.sag,
      minCrestK: p.crest,
      ...(p.linear ? { linear: true } : {}),
    }))
  return {
    gradeRanges,
    minSagK: null,
    minCrestK: null,
    minCurveLengthM: null,
    minTangentLengthM: null,
    ...(curvatureRanges.length ? { curvatureRanges } : {}),
  }
}

/** A minimum length as PGMaps holds it: 0 (or nothing stored) is none. */
const lengthOrNull = (v: number | null | undefined) => (v !== null && v !== undefined && v > 1e-9 ? r3(v) : null)

/** The minimum curve and tangent lengths an alignment's curve type uses (see the module comment). */
export function roadEngMinLengths(
  option: Pick<RoadEngVerticalOption, 'curveType' | 'storedMinCurveM' | 'storedMinTangentM'>,
): {
  minCurveLengthM: number | null
  minTangentLengthM: number | null
} {
  const curve = lengthOrNull(option.storedMinCurveM),
    tangent = lengthOrNull(option.storedMinTangentM)
  switch (option.curveType) {
    case ROADENG_CURVE_TYPES.polyline:
      return { minCurveLengthM: null, minTangentLengthM: tangent }
    case ROADENG_CURVE_TYPES.curves:
      return { minCurveLengthM: curve, minTangentLengthM: null }
    case ROADENG_CURVE_TYPES.curvesAndTangents:
      return { minCurveLengthM: curve, minTangentLengthM: curve }
    case ROADENG_CURVE_TYPES.variable:
      return { minCurveLengthM: curve, minTangentLengthM: tangent }
    default:
      return { minCurveLengthM: null, minTangentLengthM: null }
  }
}

/**
 * The curve type that holds a pair of minimum lengths, keeping `current` where it can: equal lengths
 * fit Curves and tangents, a curve alone Curves [Fast], a tangent alone PolyLine only when the
 * alignment is already one (a tangent with curves is Variable), anything else Variable.
 */
export function roadEngCurveTypeFor(
  current: number | null,
  minCurveLengthM: number | null,
  minTangentLengthM: number | null,
): number {
  const T = ROADENG_CURVE_TYPES
  const c = minCurveLengthM,
    t = minTangentLengthM
  const same = c !== null && t !== null ? Math.abs(c - t) < 1e-9 : c === t
  const holds = (type: number | null) => {
    switch (type) {
      case T.polyline:
        return c === null
      case T.curves:
        return t === null
      case T.curvesAndTangents:
        return same
      case T.variable:
        return c !== null && t !== null
      case T.userDefined:
        return c === null && t === null
      default:
        return false
    }
  }
  if (holds(current)) return current!
  if (t === null) return T.curves
  if (same) return T.curvesAndTangents
  return T.variable
}

/** Limits PGMaps cannot take become no limit, said in `unmapped`. */
function fitPieces(pieces: Piece[], name: string, unmapped: string[]): Piece[] {
  return pieces.map((p) => {
    const q = { ...p }
    for (const side of ['sag', 'crest'] as const)
      if (q[side] !== null && q[side]! > MAX_K) {
        unmapped.push(`${name}: a minimum ${side} K of ${q[side]} is past the ${MAX_K} PGMaps takes and is left open`)
        q[side] = null
      }
    if (q.min !== null && q.max !== null && q.max < q.min) {
      unmapped.push(`${name}: a grade range from ${q.min} % to ${q.max} % runs backwards and is left open`)
      q.min = q.max = null
    }
    return q
  })
}

function controlsFor(
  option: RoadEngVerticalOption,
  f: Frame,
  unmapped: string[],
): { controls: VerticalControl[]; kept: RoadEngOptControl[] } {
  const controls: VerticalControl[] = []
  const kept: RoadEngOptControl[] = []
  option.controls.forEach((c) => {
    const n = indexOf(c.key, 'OptParms_CtrlPnt-')!
    const chainage = f.chainage(c.stationM)
    const where = `${option.name}: the control point at station ${c.stationM.toFixed(3)} m`
    if (chainage < -ROADENG_OPT_END_TOLERANCE_M || chainage > f.length + ROADENG_OPT_END_TOLERANCE_M) {
      unmapped.push(`${where} is off the road and stays in the RoadEng design`)
      kept.push(c)
      return
    }
    const elevation = c.elevationEnabled && c.elevationM !== null ? r3(c.elevationM - f.depth) : null
    const grade = c.gradeEnabled && c.gradePercent !== null ? c.gradePercent : null
    if (c.elevationM !== null && !c.elevationEnabled)
      unmapped.push(`${where} keeps an elevation that is switched off in RoadEng`)
    if (c.gradePercent !== null && !c.gradeEnabled)
      unmapped.push(`${where} keeps a grade that is switched off in RoadEng`)
    const toleranceM = Math.max(0, c.elevationToleranceM ?? 0),
      gradeTolerance = Math.max(0, c.gradeTolerancePercent ?? 0)
    if (
      (elevation === null && grade === null) ||
      (elevation !== null && Math.abs(elevation) > 12000) ||
      (grade !== null && Math.abs(grade) > 100) ||
      toleranceM > 1000 ||
      gradeTolerance > 100 ||
      controls.length >= MAX_ROADENG_OPT_CONTROLS
    ) {
      unmapped.push(`${where} holds nothing PGMaps can check and stays in the RoadEng design`)
      kept.push(c)
      return
    }
    controls.push({
      id: `roadeng-ctl-${option.index}-${n}`,
      chainage: r3(Math.max(0, Math.min(f.length, chainage))),
      elevation,
      toleranceAboveM: r6(toleranceM),
      toleranceBelowM: r6(toleranceM),
      gradePercent: grade,
      gradeTolerancePercent: r6(gradeTolerance),
    })
  })
  return { controls, kept }
}

/** A stored profile on the road's chainage, its first and last grades carried to the road's ends. */
function storedProfile(option: RoadEngVerticalOption, f: Frame, notes: string[]): VerticalPoint[] | null {
  const vips = [...option.vips]
    .sort((a, b) => a.stationM - b.stationM)
    .filter((v, k, all) => k === 0 || v.stationM - all[k - 1].stationM > 1e-6)
    .slice(0, MAX_ROADENG_OPT_VIPS)
  if (vips.length < 2) return null
  const points = vips.map((v, k) => {
    let curve = 0
    if (k > 0 && k < vips.length - 1 && v.radiusM !== 0) {
      const into = (v.elevationM - vips[k - 1].elevationM) / (v.stationM - vips[k - 1].stationM)
      const out = (vips[k + 1].elevationM - v.elevationM) / (vips[k + 1].stationM - v.stationM)
      curve = Math.abs(v.radiusM * (out - into))
    }
    return { chainage: f.chainage(v.stationM), elevation: v.elevationM - f.depth, curve: curve * f.scale }
  })
  // Elevation on the tangents (curves ignored) at a chainage, carried on past either end.
  const tangentAt = (c: number) => {
    let k = 0
    while (k < points.length - 2 && points[k + 1].chainage < c) k++
    const a = points[k],
      b = points[k + 1]
    return a.elevation + ((b.elevation - a.elevation) * (c - a.chainage)) / (b.chainage - a.chainage)
  }
  const tol = ROADENG_OPT_END_TOLERANCE_M
  const inside = points.filter((p) => p.chainage > tol && p.chainage < f.length - tol)
  const out: VerticalPoint[] = [
    { id: '', chainage: 0, elevation: r3(tangentAt(0)), curveLength: 0 },
    ...inside.map((p) => ({ id: '', chainage: r3(p.chainage), elevation: r3(p.elevation), curveLength: r3(p.curve) })),
    { id: '', chainage: r3(f.length), elevation: r3(tangentAt(f.length)), curveLength: 0 },
  ].filter((p, k, all) => k === 0 || p.chainage - all[k - 1].chainage >= 0.001)
  const first = points[0].chainage,
    last = points[points.length - 1].chainage
  const ends = [
    first > tol
      ? "its first grade is carried back to the road's start"
      : first < -tol
        ? "it is cut at the road's start"
        : '',
    last < f.length - tol
      ? "its last grade is carried on to the road's end"
      : last > f.length + tol
        ? "it is cut at the road's end"
        : '',
  ].filter(Boolean)
  if (ends.length)
    notes.push(
      `${option.name}'s stored profile runs from ${first.toFixed(3)} to ${last.toFixed(3)} m of the road's 0 to ${f.length.toFixed(3)} m: ${ends.join(', and ')}.`,
    )
  return out.map((p, k) => ({ ...p, id: `roadeng-v${option.index}-${k}` }))
}

interface OptionMapping {
  option: RoadEngVerticalOption
  pieces: Piece[]
  standards: VerticalStandards | undefined
  controls: VerticalControl[]
  /** Controls left in the design (off the road or holding nothing PGMaps checks). */
  kept: RoadEngOptControl[]
  /** Null for the active alignment, whose profile is the road's, and where none is stored. */
  vertical: VerticalPoint[] | null
}

function mapOption(
  option: RoadEngVerticalOption,
  f: Frame,
  active: boolean,
  unmapped: string[],
  notes: string[],
  warnings: string[],
): OptionMapping {
  const pieces = fitPieces(constraintPieces(option, f, warnings), option.name, unmapped)
  const { controls, kept } = controlsFor(option, f, unmapped)
  const lengths = roadEngMinLengths(option)
  for (const key of ['minCurveLengthM', 'minTangentLengthM'] as const)
    if (lengths[key] !== null && lengths[key]! > MAX_MIN_LENGTH_M) {
      unmapped.push(
        `${option.name}: a minimum ${key === 'minCurveLengthM' ? 'curve' : 'tangent'} length of ${lengths[key]} m is past the ${MAX_MIN_LENGTH_M} m PGMaps takes and is left open`,
      )
      lengths[key] = null
    }
  if (option.curveType === ROADENG_CURVE_TYPES.userDefined && (option.storedMinCurveM || option.storedMinTangentM))
    unmapped.push(
      `${option.name}: RoadEng's User defined curve type keeps the reference alignment's curves, so its stored minimum lengths are not used`,
    )
  const standards = piecesToStandards(pieces, f.length)
  const lengthsSet = lengths.minCurveLengthM !== null || lengths.minTangentLengthM !== null
  return {
    option,
    pieces,
    standards:
      standards || lengthsSet
        ? { ...(standards ?? { gradeRanges: [], minSagK: null, minCrestK: null }), ...lengths }
        : undefined,
    controls,
    kept,
    vertical: active ? null : storedProfile(option, f, notes),
  }
}

/** Whether an alignment becomes one of the road's alternatives: the active one, or one with a profile. */
const importable = (m: OptionMapping, activeIndex: number) => m.option.index === activeIndex || m.vertical !== null

function mapAll(settings: RoadEngOptimizer, f: Frame, unmapped: string[], notes: string[]) {
  const warnings: string[] = []
  const mapped = settings.options.map((o) =>
    mapOption(o, f, o.index === settings.activeIndex, unmapped, notes, warnings),
  )
  // The active one and up to 11 others with a stored profile, in file order.
  const chosen = new Set<number>()
  if (settings.activeIndex >= 0) chosen.add(settings.activeIndex)
  for (const m of mapped)
    if (chosen.size < MAX_ROADENG_VERTICAL_OPTIONS && importable(m, settings.activeIndex)) chosen.add(m.option.index)
  return { mapped, chosen, warnings }
}

export interface RoadEngOptimizerMapping {
  verticalStandards?: VerticalStandards
  verticalControls?: VerticalControl[]
  /** Set when the design holds a second vertical alignment with a stored profile. */
  verticalAlternatives?: VerticalAlternative[]
  activeVerticalAlternativeId?: string
  /** RoadEng items not carried over, in plain words. */
  unmapped: string[]
  /** Carried over with a stated difference. */
  notes: string[]
}

/**
 * PGMaps' standards, controls and named alternatives from one alignment's optimizer settings.
 * `activeVertical` is the road's profile as imported (already on the subgrade): the active
 * alternative takes it.
 */
export function roadEngOptimizerFor(
  settings: RoadEngOptimizer,
  frame: RoadEngOptimizerFrame & { activeVertical: VerticalPoint[] },
): RoadEngOptimizerMapping {
  const f = frameOf(frame)
  const unmapped: string[] = []
  const notes: string[] = [...settings.warnings]
  if (!settings.options.length) return { unmapped, notes }
  const { mapped, chosen, warnings } = mapAll(settings, f, unmapped, notes)
  notes.push(...warnings)
  const active = mapped[settings.activeIndex] ?? mapped[0]
  for (const m of mapped) {
    if (chosen.has(m.option.index)) continue
    unmapped.push(
      m.vertical === null
        ? `The vertical alignment ${m.option.name} stores no profile in the design and stays in it unchanged`
        : `The vertical alignment ${m.option.name} is past the ${MAX_ROADENG_VERTICAL_OPTIONS} alternatives a road takes and stays in the design unchanged`,
    )
  }
  unmapped.push(
    "RoadEng's optimizer method and cost settings (curve type, sampling, regularization) and the horizontal optimizer stay in the design and are written back unchanged; its last cost solution is written back unchanged too, and Compare with RoadEng… sets it beside the road's own costs",
  )
  const result: RoadEngOptimizerMapping = {
    ...(active.standards ? { verticalStandards: active.standards } : {}),
    ...(active.controls.length ? { verticalControls: active.controls } : {}),
    unmapped,
    notes,
  }
  if (chosen.size >= 2) {
    result.verticalAlternatives = mapped
      .filter((m) => chosen.has(m.option.index))
      .map((m) => ({
        id: `roadeng-valign-${m.option.index}`,
        name: m.option.name.slice(0, 100),
        vertical: m === active ? frame.activeVertical.map((p) => ({ ...p })) : m.vertical!,
        ...(m.standards ? { verticalStandards: m.standards } : {}),
        ...(m.controls.length ? { verticalControls: m.controls } : {}),
      }))
    result.activeVerticalAlternativeId = `roadeng-valign-${active.option.index}`
    notes.push(
      `RoadEng's vertical alignments ${result.verticalAlternatives.map((a) => a.name).join(', ')} are the road's alternatives; ${active.option.name} is the active one.`,
    )
  }
  const ranges = active.pieces.filter(
    (p) => p.min !== null || p.max !== null || p.sag !== null || p.crest !== null || p.linear,
  )
  if (ranges.length)
    notes.push(
      `${active.option.name}: ${ranges.length} standards range${ranges.length === 1 ? '' : 's'}${ranges.some((p) => p.linear) ? `, ${ranges.filter((p) => p.linear).length} of them a straight grade only` : ''}, and ${active.controls.length} control point${active.controls.length === 1 ? '' : 's'}.`,
    )
  return result
}

/** The road with a mapping applied; the active alternative keeps the road's own profile. */
export function applyRoadEngOptimizer(alignment: Alignment, mapping: RoadEngOptimizerMapping): Alignment {
  const next: Alignment = { ...alignment }
  if (mapping.verticalStandards) next.verticalStandards = mapping.verticalStandards
  if (mapping.verticalControls) next.verticalControls = mapping.verticalControls
  if (mapping.verticalAlternatives && mapping.activeVerticalAlternativeId) {
    next.verticalAlternatives = mapping.verticalAlternatives.map((a) =>
      a.id === mapping.activeVerticalAlternativeId ? { ...a, vertical: alignment.vertical.map((p) => ({ ...p })) } : a,
    )
    next.activeVerticalAlternativeId = mapping.activeVerticalAlternativeId
  }
  return next
}

// ---- Writing ------------------------------------------------------------------------------------

/** Up to six decimals, no exponent, no trailing zeros. */
function fmt(value: number): string {
  const text = value.toFixed(6).replace(/\.?0+$/, '')
  return text === '-0' ? '0' : text
}
const safeName = (name: string) =>
  name
    .replace(/[,\r\n[\]=]+/g, ' ')
    .trim()
    .slice(0, 100) || DEFAULT_NAME

interface Profile {
  id: string | null
  name: string | null
  vertical: VerticalPoint[]
  standards: VerticalStandards | undefined
  controls: VerticalControl[]
  active: boolean
}

function constraintLines(pieces: Piece[], f: Frame, maxText: string): string[] {
  const lines = pieces.length
    ? pieces
    : [{ start: 0, end: f.length, min: null, max: null, sag: null, crest: null, linear: false }]
  return lines.map((p, k) => {
    const end = k === lines.length - 1 ? maxText : fmt(f.station(p.end))
    const min = fmt(p.min ?? -ROADENG_UNLIMITED_GRADE_PERCENT),
      max = fmt(p.max ?? ROADENG_UNLIMITED_GRADE_PERCENT)
    return p.linear
      ? `${min},${max},Linear,${end}`
      : `${min},${max},${fmt((p.sag ?? 0) / f.unitM)},${end},${fmt((p.crest ?? 0) / f.unitM)}`
  })
}

function controlLine(c: VerticalControl, f: Frame, original: RoadEngOptControl | null, fieldCount: number): string {
  // One tolerance: PGMaps' band, centred.
  const above = c.toleranceAboveM,
    below = c.toleranceBelowM
  const fields = original ? [...original.fields] : ['', '', '', '', '', '', ' ', ...(fieldCount > 7 ? ['0'] : [])]
  const unknownBits = original ? original.flags & ~(FLAG_ELEVATION | FLAG_GRADE) : 0
  fields[0] = fmt(f.station(c.chainage))
  if (c.elevation !== null) {
    fields[1] = fmt((c.elevation + (above - below) / 2 + f.depth) / f.unitM)
    fields[2] = fmt((above + below) / 2 / f.unitM)
  } else if (!original || original.elevationEnabled || original.elevationM === null) {
    fields[1] = String(ROADENG_UNSET)
    fields[2] = String(ROADENG_UNSET)
  }
  if (c.gradePercent !== null) {
    fields[3] = fmt(c.gradePercent)
    fields[4] = fmt(c.gradeTolerancePercent)
  } else if (!original || original.gradeEnabled || original.gradePercent === null) {
    fields[3] = String(ROADENG_UNSET)
    fields[4] = String(ROADENG_UNSET)
  }
  fields[5] = String(
    unknownBits | (c.elevation !== null ? FLAG_ELEVATION : 0) | (c.gradePercent !== null ? FLAG_GRADE : 0),
  )
  return fields.join(',')
}

function vipLines(vertical: VerticalPoint[], f: Frame): string[] {
  const points = [...vertical]
    .sort((a, b) => a.chainage - b.chainage)
    .map((p) => ({
      station: f.station(p.chainage),
      elevation: (p.elevation + f.depth) / f.unitM,
      curve: p.curveLength,
    }))
  return points.map((p, k) => {
    let radius = 0
    if (k > 0 && k < points.length - 1 && p.curve > 0) {
      const into = (p.elevation - points[k - 1].elevation) / (p.station - points[k - 1].station)
      const out = (points[k + 1].elevation - p.elevation) / (points[k + 1].station - p.station)
      const change = out - into
      if (Math.abs(change) > 1e-12) radius = p.curve / f.scale / f.unitM / change
    }
    return `${fmt(p.station)},${fmt(p.elevation)},${fmt(radius)}`
  })
}

const vipKey = (k: number) => `OptParmsVIP-${String(k).padStart(3, '0')}`

const sameControls = (a: VerticalControl[], b: VerticalControl[]) =>
  a.length === b.length &&
  a.every((c, k) => {
    const d = b[k]
    return (
      c.id === d.id &&
      Math.abs(c.chainage - d.chainage) < 1e-3 &&
      closeOrNull(c.elevation, d.elevation, 1e-3) &&
      Math.abs(c.toleranceAboveM - d.toleranceAboveM) < 1e-6 &&
      Math.abs(c.toleranceBelowM - d.toleranceBelowM) < 1e-6 &&
      closeOrNull(c.gradePercent, d.gradePercent) &&
      Math.abs(c.gradeTolerancePercent - d.gradeTolerancePercent) < 1e-6
    )
  })
const sameVertical = (a: VerticalPoint[], b: VerticalPoint[]) =>
  a.length === b.length &&
  a.every(
    (p, k) =>
      Math.abs(p.chainage - b[k].chainage) < 1e-3 &&
      Math.abs(p.elevation - b[k].elevation) < 1e-3 &&
      Math.abs(p.curveLength - b[k].curveLength) < 1e-3,
  )

/**
 * `.dsn` changes that write a road's standards, controls and vertical alternatives as RoadEng's
 * optimizer settings. With `originalDsn` (the alignment's `.dsn` as read) only what changed is
 * written and every other key is kept; without it the settings are written whole. `frame` is the
 * station frame and surfacing of the design being written, the same one its `.ds2` uses. The active
 * profile's VIPs are the `.ds2`'s `109` records, which the design writer writes from `road.vertical`.
 * Apply the result with `mergeRoadEngIni` (`roadEngExport.ts`), the one `.dsn` editor.
 */
export function roadEngOptimizerOverrides(
  road: Alignment,
  frame: RoadEngOptimizerFrame,
  originalDsn?: string,
): { overrides: RoadEngDsnOverrides; notes: string[] } {
  const f = frameOf(frame)
  const notes: string[] = []
  const original = originalDsn === undefined ? null : parseRoadEngOptimizer(originalDsn, f.unitM)
  const scratch: string[] = []
  const read = original?.options.length ? mapAll(original, f, scratch, scratch) : null

  const saved = road.verticalAlternatives?.length ? snapshotActiveVerticalAlternative(road) : road
  const profiles: Profile[] = saved.verticalAlternatives?.length
    ? saved.verticalAlternatives.map((a) => ({
        id: a.id,
        name: a.name,
        vertical: a.vertical,
        standards: a.verticalStandards,
        controls: a.verticalControls ?? [],
        active: a.id === saved.activeVerticalAlternativeId,
      }))
    : [
        {
          id: null,
          name: null,
          vertical: road.vertical,
          standards: road.verticalStandards,
          controls: road.verticalControls ?? [],
          active: true,
        },
      ]
  if (!read && profiles.length === 1 && !profiles[0].standards && !profiles[0].controls.length)
    return { overrides: {}, notes }

  // Each profile to the original alignment it came from: its id, else its name, else (one profile)
  // the active alignment.
  const blockOf = new Map<Profile, number>()
  if (read && original) {
    const taken = new Set<number>()
    for (const p of profiles) {
      const n = p.id === null ? null : indexOf(p.id, 'roadeng-valign-')
      if (n !== null && n < original.options.length && !taken.has(n)) {
        blockOf.set(p, n)
        taken.add(n)
      }
    }
    for (const p of profiles) {
      if (blockOf.has(p)) continue
      const n =
        profiles.length === 1 && p.id === null
          ? original.activeIndex
          : original.options.findIndex((o, k) => !taken.has(k) && o.name === p.name)
      if (n >= 0 && !taken.has(n)) {
        blockOf.set(p, n)
        taken.add(n)
      }
    }
  }
  const profileOf = new Map([...blockOf].map(([p, n]) => [n, p]))
  const removed = new Set<number>()
  if (read && original && saved.verticalAlternatives?.length)
    for (const n of read.chosen) if (!profileOf.has(n)) removed.add(n)

  const maxText =
    [...(original?.options ?? [])]
      .flatMap((o) =>
        [...o.keys].filter(([k]) => k.startsWith('OptParms_Constraintv7-')).map(([, v]) => v.split(',')[3]),
      )
      .find((v) => v !== undefined && Number(v) >= ROADENG_OPT_END_STATION)
      ?.trim() ?? FLT_MAX_TEXT
  const ctrlFields =
    original?.options.flatMap((o) => o.controls.map((c) => c.fields.length)).reduce((a, b) => Math.max(a, b), 0) || 8
  const template = original?.options[original.activeIndex] ?? original?.options[0] ?? null
  const activeName = safeName(profiles.find((p) => p.active)?.name ?? template?.name ?? DEFAULT_NAME)

  const renames = new Map<string, string>()
  const blocks: { from: number | null; keys: Map<string, string> }[] = []
  const write = (keys: Map<string, string>, prefix: string, lines: string[], keyFor: (k: number) => string) => {
    for (const key of [...keys.keys()]) if (indexOf(key, prefix) !== null) keys.delete(key)
    lines.forEach((line, k) => keys.set(keyFor(k), line))
  }
  const setName = (keys: Map<string, string>, name: string) => {
    const fields = (keys.get('OptParmsNew') ?? DEFAULT_OPT_PARMS_NEW.join(',')).split(',')
    while (fields.length <= NAME_FIELD) fields.push('0')
    fields[NAME_FIELD] = name
    keys.set('OptParmsNew', fields.join(','))
  }
  const fill = (keys: Map<string, string>, p: Profile, from: OptionMapping | null) => {
    const name = safeName(p.name ?? from?.option.name ?? DEFAULT_NAME)
    if (p.name !== null && name !== p.name.trim())
      notes.push(
        `The vertical alignment ${p.name} is named ${name} in RoadEng, which keeps no commas or brackets in it.`,
      )
    if (!from || from.option.name !== name) {
      setName(keys, name)
      if (from) renames.set(from.option.name, name)
    }
    const pieces = standardsPieces(p.standards, f.length)
    if (!from || !piecesEqual(pieces, from.pieces))
      write(keys, 'OptParms_Constraintv7-', constraintLines(pieces, f, maxText), (k) => `OptParms_Constraintv7-${k}`)
    if (!from || !sameControls(p.controls, from.controls)) {
      const own = (c: VerticalControl) => {
        const m = /^roadeng-ctl-(\d+)-(\d+)$/.exec(c.id)
        if (!from || !m || Number(m[1]) !== from.option.index) return null
        return from.option.controls.find((o) => o.key === `OptParms_CtrlPnt-${m[2]}`) ?? null
      }
      const lines = [
        ...(from?.kept ?? []).map((c) => ({ station: c.stationM, line: c.fields.join(',') })),
        ...p.controls.map((c) => ({
          station: frame.startStationM + c.chainage / f.scale,
          line: controlLine(c, f, own(c), ctrlFields),
        })),
      ]
        .sort((a, b) => a.station - b.station)
        .map((l) => l.line)
      write(keys, 'OptParms_CtrlPnt-', lines, (k) => `OptParms_CtrlPnt-${k}`)
    }
    if (p.active) write(keys, 'OptParmsVIP-', [], vipKey)
    else if (!from || from.vertical === null || !sameVertical(p.vertical, from.vertical)) {
      if (p.vertical.length < 2) notes.push(`The vertical alignment ${name} has no profile to store.`)
      write(keys, 'OptParmsVIP-', p.vertical.length < 2 ? [] : vipLines(p.vertical, f), vipKey)
    }
    // Minimum curve and tangent lengths, with the curve type that holds them.
    const want = {
      minCurveLengthM: lengthOrNull(p.standards?.minCurveLengthM),
      minTangentLengthM: lengthOrNull(p.standards?.minTangentLengthM),
    }
    const had = from ? roadEngMinLengths(from.option) : { minCurveLengthM: null, minTangentLengthM: null }
    if (
      !closeOrNull(want.minCurveLengthM, had.minCurveLengthM, 1e-3) ||
      !closeOrNull(want.minTangentLengthM, had.minTangentLengthM, 1e-3)
    ) {
      const fields = (keys.get('OptParmsNew') ?? DEFAULT_OPT_PARMS_NEW.join(',')).split(',')
      while (fields.length <= Math.max(NAME_FIELD, ROADENG_MIN_TANGENT_FIELD)) fields.push('0')
      const typeNow = Number(fields[ROADENG_CURVE_TYPE_FIELD])
      const current = Number.isInteger(typeNow) ? typeNow : null
      const type = roadEngCurveTypeFor(current, want.minCurveLengthM, want.minTangentLengthM)
      fields[ROADENG_CURVE_TYPE_FIELD] = String(type)
      fields[ROADENG_MIN_CURVE_FIELD] = fmt((want.minCurveLengthM ?? 0) / f.unitM)
      // Curves and tangents keeps one length for both; Curves [Fast] fixes the tangent at 0.
      fields[ROADENG_MIN_TANGENT_FIELD] = fmt(
        (type === ROADENG_CURVE_TYPES.curvesAndTangents
          ? (want.minCurveLengthM ?? 0)
          : type === ROADENG_CURVE_TYPES.curves
            ? 0
            : (want.minTangentLengthM ?? 0)) / f.unitM,
      )
      keys.set('OptParmsNew', fields.join(','))
      if (current !== null && type !== current)
        notes.push(
          `${name}: RoadEng's curve type is now ${CURVE_TYPE_NAMES[type]}, in place of ${CURVE_TYPE_NAMES[current] ?? `type ${current}`}, the one that holds ${
            want.minTangentLengthM === null
              ? 'a minimum curve length alone'
              : want.minCurveLengthM === null
                ? 'a minimum tangent length alone'
                : 'these minimum curve and tangent lengths'
          }.`,
        )
      if (type === ROADENG_CURVE_TYPES.variable && (want.minCurveLengthM === null || want.minTangentLengthM === null))
        notes.push(
          `${name}: RoadEng's Variable curves and tangents needs both minimum lengths; the one not set is written as 0.`,
        )
    }
  }

  let activeBlock = 0
  if (original && read)
    original.options.forEach((o, n) => {
      if (removed.has(n)) return
      const keys = new Map(o.keys)
      const p = profileOf.get(n)
      if (p) fill(keys, p, read.mapped[n])
      if (p?.active || (!p && n === original.activeIndex && !profiles.some((q) => q.active)))
        activeBlock = blocks.length
      blocks.push({ from: n, keys })
    })
  for (const p of profiles) {
    if (blockOf.has(p)) continue
    const keys = new Map<string, string>()
    // A new alignment starts from the design's active one, less what belongs to that alignment alone.
    for (const [key, value] of template?.keys ?? [])
      if (
        !/^(OptParms_Constraintv7-|OptParms_CtrlPnt-|OptParmsVIP-|OptParms_CostSolution|OptParms_FullSolution)/.test(
          key,
        )
      )
        keys.set(key, value)
    if (!keys.has('OptParmsDesc')) keys.set('OptParmsDesc', '-')
    if (!keys.has('OptParmsRefAlign')) keys.set('OptParmsRefAlign', `${activeName},${activeName},Ground`)
    fill(keys, p, null)
    if (p.active) activeBlock = blocks.length
    blocks.push({ from: null, keys })
  }
  // RoadEng names the reference alignment in every block: follow a rename, and a reference to an
  // alignment no longer written becomes the active one.
  const names = new Set(blocks.map((b) => (b.keys.get('OptParmsNew') ?? '').split(',')[NAME_FIELD]?.trim()))
  const activeWritten = (blocks[activeBlock]?.keys.get('OptParmsNew') ?? '').split(',')[NAME_FIELD]?.trim()
  for (const b of blocks) {
    const ref = b.keys.get('OptParmsRefAlign')
    if (!ref) continue
    const fields = ref.split(',')
    for (let k = 0; k < Math.min(2, fields.length); k++) {
      const name = renames.get(fields[k].trim()) ?? fields[k].trim()
      if (renames.has(fields[k].trim())) fields[k] = name
      if (!names.has(name) && activeWritten) fields[k] = activeWritten
    }
    b.keys.set('OptParmsRefAlign', fields.join(','))
  }
  const overrides: RoadEngDsnOverrides = {}
  const ini = readIni(originalDsn ?? '')
  const head = ini.get('OptAlignCost')?.get('nOptCostParameters')?.split(',') ?? []
  const nextHead = [String(blocks.length), String(activeBlock), ...head.slice(2)].join(',')
  if (head.join(',') !== nextHead) overrides.OptAlignCost = { nOptCostParameters: nextHead }
  blocks.forEach((b, k) => {
    const before = ini.get(`OptAlignCost-${k}`) ?? new Map<string, string>()
    const changes: Record<string, string | null> = {}
    for (const [key, value] of b.keys) if (before.get(key) !== value) changes[key] = value
    for (const key of before.keys()) if (!b.keys.has(key)) changes[key] = null
    if (Object.keys(changes).length) overrides[`OptAlignCost-${k}`] = changes
  })
  // Sections past the last alignment written, moved down or removed.
  for (const [section, keys] of ini) {
    const n = indexOf(section, 'OptAlignCost-')
    if (n !== null && n >= blocks.length)
      overrides[section] = Object.fromEntries([...keys.keys()].map((key) => [key, null]))
  }
  if (removed.size)
    notes.push(
      `Removed from the RoadEng design with their alternatives: ${[...removed].map((n) => original!.options[n].name).join(', ')}.`,
    )
  return { overrides, notes }
}
