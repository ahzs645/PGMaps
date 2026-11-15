/**
 * Field traverses in the text formats RoadEng's Survey/Map and Terrain modules read, read and
 * written, with their station equations, and mapped onto PGMaps' survey field book
 * (`surveyInterchange.ts`: a start, legs of grid bearing, horizontal distance and grade, and
 * perpendicular side shots):
 *
 * - **Softree ASCII traverse** (`.ASC`, RoadEng help *Softree ASCII Traverse Files*) and its
 *   Terrain Field variant **IPD** (help *IPD File Format*): a version line, then one comma-separated
 *   record per station: station, foreshot and backshot azimuth, HD, SD, slope %, two labels, X, Y,
 *   Z, a TYPE bit word, culvert (`CREEK`), reference shot, three ground layers with centreline
 *   depths, HI, HT, then n perpendicular side shots left and n right (SD, slope %, two layer depths;
 *   IPD adds a code) and the left and right TP flags.
 * - **Polycorder Roads traverse** (help *Polycorder Roads Traverse File Format*): 27 fields per
 *   station: station, distance and bearing to the next, slope %, label, culvert width, two soils and
 *   a depth, then three side shots a side (slope %, slope distance, depth), interleaved left/right.
 * - **Unit survey** (`.pol`, as PEGGER exports for RoadEng; RoadEng 4 Terrain help quoted in the
 *   PEGGER manual): `survey,SR,X,Y,Z,code` and `survey,FS|BS|SD,from,to,azimuth,vertical,distance,
 *   HI,HT,code`. Only the description was used, never PEGGER's code.
 * - **Laser Technology raw unit survey** (help *Unit Survey Raw File Format*):
 *   `$PLTIT,UD,n,seq,FS|SD,from,to,az,D,incl,D,slope distance,unit*checksum`, read as unit-survey
 *   shots of inclination and slope distance, with the XOR checksum checked and written.
 *
 * **Station equations** belong to a traverse (RoadEng's Survey Information → Station Equations): a
 * back station on the calculated chain (start station plus accumulated horizontal distance) and the
 * ahead station the field uses from there on ({@link fieldStation}). No format above has a field for
 * them. RoadEng reads only the first record's station and calculates the rest from the distances,
 * so a station column that jumps carries an equation without changing the traverse RoadEng builds:
 * the readers turn a jump into an equation and the writers write field stations (option
 * `stationColumn`). A jump of at most 1.5 units in the last decimal written is rounding, not an
 * equation (RoadEng's own examples drift by 0.1 at one decimal).
 *
 * None of the formats states its units or coordinate system (the raw format's unit letter aside):
 * the readers return `unitM: null` and `epsg: null`, and the mappings to the field book take the
 * unit (`unitM`) and, when the file gives no absolute start, the start from the caller
 * ({@link SoftreeTraverseStartQuestion}).
 *
 * What the help does not say, and what this module therefore takes as given (checked by the round
 * trips in its tests and against the coordinates in the help's road example, which this reduction
 * reproduces to 2 mm):
 *
 * - A record's foreshot leads from its station to the next record's; a final record with a
 *   foreshot leads to an end station the file does not list. Azimuths are clockwise from grid north,
 *   X is easting and Y northing.
 * - TYPE bits: 3 (both 1 and 2) XY absolute, 4 Z absolute, 8 IFS, 16 SD used, 64 deflection from
 *   the previous foreshot (positive right), 128 the slope field holds an elevation difference
 *   (side shots of that record too), 512 radial side shot. An IFS or radial record is a shot from
 *   the station of the last traverse record before it (the instrument's) and does not advance the
 *   traverse; it becomes a located point, not a leg. A record made absolute after the first is refused: the field book has one start.
 * - Elevation difference along a shot is HD × slope + HI − HT.
 * - Side shots: a slope distance of 0 or less ends a side; a slope given with it is the ground's
 *   slope beyond the last shot (an extension, kept with the station, not a point). ASCII side shots
 *   are measured each from the one before; IPD side shots from the last turning point (TP flag bit
 *   J−1 set: shot J is not a TP), the station being the first; Polycorder's from the one before.
 * - The version line's first token is the version; a major version of 7 or more is IPD.
 * - Unit survey: the start reference is the first foreshot's from-point. Foreshots, backshots and
 *   repeated shots of a leg are averaged (azimuth as a direction, HD and rise arithmetically), as
 *   RoadEng's help says it does. The main line follows foreshots from the start; a radial side shot
 *   within {@link SIDE_SHOT_SQUARE_DEG} of square to its station's leg becomes a field-book side
 *   shot, any other shot a located point. The vertical and distance kinds are import options in
 *   RoadEng, not in the file, so the caller states them. Raw unit letters: `F` feet, `M` metres.
 *
 * What the field book does not hold is returned beside it (`extras`, `points`) and counted in
 * `notes`: labels, ground layers and depths, culverts, HI/HT, side-shot depths and extensions, IFS
 * and radial shots, backshots and reference shots. The file as written comes with it (`source`).
 *
 * **Writing back.** Given those details (`details`), each writer writes every one its format has a
 * field for and names the rest in its notes (Polycorder has no HI/HT, backshot or points; a unit
 * survey no ground layers, culverts or depths; Softree ASCII no side-shot codes). In the format and
 * unit the details were read in, the file as written is the template: a field whose value is
 * unchanged is written as it was, so an unedited field book gives the same bytes and an edited one
 * changes only its own fields; a leg, start or side shot is "unchanged" when it equals the one read
 * (`matchSource`), so readings that disagree within rounding (the file's own X, Y, Z; averaged
 * unit-survey shots) stay as written. In another format or unit the records are written afresh.
 * Culverts move between formats and units through metres (`softreeCulvert.ts`).
 *
 * Limits: {@link MAX_TRAVERSE_RECORDS} records, {@link MAX_SIDE_SHOTS_PER_SIDE} side shots a side
 * (the help's), {@link MAX_STATION_EQUATIONS} equations; the field book's own limits apply on top
 * (`reduceTraverse`).
 *
 * Re-implemented from the published descriptions only. Pure: no DOM or network access.
 */
import { asciiFixed, asciiLines, asciiNumber } from './softreeAscii'
import { culvertFromMetres, culvertInMetres, type SoftreeCulvert } from './softreeCulvert'
import {
  checkStationEquations,
  fieldStation,
  stationEquationsFromColumn,
  type StationEquation,
} from './stationEquations'
import { reduceTraverse, type TraverseInput, type TraverseLeg } from './surveyInterchange'

export { culvertFromMetres, culvertInMetres, type CulvertMetres, type SoftreeCulvert } from './softreeCulvert'
export {
  calculatedStations,
  checkStationEquations,
  fieldStation,
  MAX_STATION_EQUATIONS,
  stationEquationsFromColumn,
  type StationEquation,
} from './stationEquations'

export const MAX_TRAVERSE_RECORDS = 20_000
/** Softree's limit on perpendicular side shots on each side of a station. */
export const MAX_SIDE_SHOTS_PER_SIDE = 25
/** A unit-survey side shot this close to square to its station's leg is a field-book side shot. */
export const SIDE_SHOT_SQUARE_DEG = 5
/** Polycorder's side shots on each side. */
export const POLYCORDER_SIDE_SHOTS = 3
const ASC_FIXED_FIELDS = 22
const RAD = Math.PI / 180

type XYZ = [number, number, number]

// ─── station equations (`stationEquations.ts`, which the field book reads without these formats) ─

const decimalsOf = (texts: readonly string[]) =>
  Math.max(0, ...texts.map((t) => (t.trim().split('.')[1] ?? '').replace(/[eE].*$/, '').length))
const roundingTolerance = (texts: readonly string[]) => 1.5 * 10 ** -decimalsOf(texts) + 1e-9

// ─── what the field book cannot hold ─────────────────────────────────────────────────────────

/** A traverse that gives no absolute start: the import asks for one and runs again with it. */
export class SoftreeTraverseStartQuestion extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SoftreeTraverseStartQuestion'
  }
}

export interface SoftreeSideShotExtra {
  side: 'left' | 'right'
  /** 1-based position in its side's list. */
  n: number
  depths: Array<number | null>
  code?: string
}

/** One field-book station's data that the field book has no field for, in the file's units. */
export interface SoftreeStationExtras {
  /** Field-book station index (0 is the start). */
  station: number
  /** The at-station label (Softree ASCII label 1, Polycorder label, unit-survey code). */
  label?: string
  /** Softree ASCII's between-station label 2. */
  label2?: string
  /**
   * Ground layers from the top, in their file positions: a layer's type and its centreline depth
   * (the third ASCII layer, and Polycorder's second, have no depth field).
   */
  ground?: Array<{ type: string; depth: number | null }>
  culvert?: SoftreeCulvert
  /** Height of instrument and of target of the station's foreshot. */
  hi?: number | null
  ht?: number | null
  /** Backshot azimuth, degrees. */
  backshot?: number | null
  sideShots?: SoftreeSideShotExtra[]
  /** Ground slope (%) beyond the last side shot. */
  extensionSlope?: { left?: number; right?: number }
}

/** A shot that is not a leg or a square side shot, located from the station it was taken at. */
export interface SoftreeTraversePoint {
  id: string
  /** Name of the station it was taken from. */
  from: string
  /** Field-book index of that station. */
  station?: number
  coordinate: XYZ
}

/** The traverse formats a field book is written back in. */
export type SoftreeSourceFormat = 'asc' | 'ipd' | 'polycorder' | 'unit-survey'

/** How a file's lines were written, so a file written back keeps them. */
export interface TextLayout {
  lineEnd: '\r\n' | '\n' | '\r'
  /** The last record ends with a line end. */
  finalLineEnd: boolean
  bom: boolean
}

/** One record of a traverse file as written. */
export interface SoftreeSourceRecord {
  line: string
  /** ASCII and Polycorder: the field-book station of a station record, or the station a shot is from. */
  station?: number
  /**
   * What the record became: a station (ASCII, Polycorder), a shot that is not a leg, or in a unit
   * survey the start reference, a leg (`station` is the leg's from-station), a square side shot,
   * or a record of another survey.
   */
  role?: 'station' | 'shot' | 'start' | 'leg' | 'side' | 'other'
}

/**
 * A traverse file as written, kept beside the field book read from it. Written back in the same
 * format and unit, every record whose leg, side shots and details are unchanged keeps its bytes, and
 * an edited one keeps every field that did not change: the format's fields PGMaps has no use for
 * (types, reference shots, turning-point flags, backshot records, D:M:S angles) survive the trip.
 */
export interface SoftreeTraverseSource {
  format: SoftreeSourceFormat
  layout: TextLayout
  /** Lines before the first record (the ASCII version line and any headings). */
  head: string[]
  records: SoftreeSourceRecord[]
  /** The field book as read (metres), to tell an edited leg, side shot or start from one as read. */
  input: TraverseInput
  startStation: number
  equations: StationEquation[]
  /** Unit survey: what its vertical readings and distances are, the survey read, the main line's point names. */
  vertical?: UnitSurveyVertical
  distance?: UnitSurveyDistance
  survey?: string
  pointNames?: string[]
  /** Unit survey: per station, the record carrying its label (code) and its foreshot's HI/HT; -1 for none. */
  labelRecords?: number[]
  heightRecords?: number[]
}

/** What a traverse file held beyond the field book: written back by the traverse writers. */
export interface SoftreeTraverseDetails {
  /** The format the details were read from (culvert sizes follow its convention). */
  sourceFormat: SoftreeSourceFormat | 'laser-raw'
  /** Metres per unit of the file the details were read from: their lengths are in it. */
  unitM: number
  extras: SoftreeStationExtras[]
  points: SoftreeTraversePoint[]
  source?: SoftreeTraverseSource
}

/** A traverse read for the field book. Lengths are metres; extras keep the file's units. */
export interface SoftreeTraverseImport {
  input: TraverseInput
  /** The traverse's first station, metres. PGMaps' chainage starts at 0. */
  startStation: number
  equations: StationEquation[]
  /** The id of every field-book station (index 0 is `start` in the field book). */
  stationIds: string[]
  extras: SoftreeStationExtras[]
  /** Shots that are not legs or square side shots (IFS, radial, unit-survey side shots), located. */
  points: SoftreeTraversePoint[]
  /** The file as written, for writing it back (not for the Laser Technology raw format). */
  source?: SoftreeTraverseSource
  /** How far the file's own coordinates lie from the reduction, where it gives them. */
  fileCheck: { compared: number; maxDifferenceM: number } | null
  notes: string[]
}

// ─── text kept as written ────────────────────────────────────────────────────────────────────

/** How a text file's lines end. */
export function textLayout(text: string): TextLayout {
  const m = /\r\n|\r|\n/.exec(text)
  return {
    lineEnd: (m?.[0] ?? '\r\n') as TextLayout['lineEnd'],
    finalLineEnd: !m || /[\r\n]$/.test(text),
    bom: text.startsWith('﻿'),
  }
}
const DEFAULT_LAYOUT: TextLayout = { lineEnd: '\r\n', finalLineEnd: true, bom: false }
function joinLines(lines: readonly string[], layout: TextLayout = DEFAULT_LAYOUT): string {
  return (layout.bom ? '﻿' : '') + lines.join(layout.lineEnd) + (layout.finalLineEnd ? layout.lineEnd : '')
}
/** Whether two numbers are the same reading (or both blank), allowing for unit conversions. */
const sameValue = (a: number | null | undefined, b: number | null | undefined) =>
  a === null || a === undefined || b === null || b === undefined
    ? (a ?? null) === (b ?? null)
    : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
/** A number field: as written while it still says `value`, else `value` to at least `decimals`. */
function numberText(raw: string | undefined, value: number | null, decimals: number): string {
  if (raw !== undefined) {
    const v = asciiNumber(raw)
    if (v !== undefined && sameValue(v, value)) return raw
  }
  return asciiFixed(value, Math.max(decimals, raw === undefined ? 0 : decimalsOf([raw])))
}
/** A whole-number field (types, flags), as written while it still says `value`. */
function intText(raw: string | undefined, value: number | null): string {
  if (raw !== undefined && sameValue(asciiNumber(raw) ?? NaN, value)) return raw
  return value === null ? '' : String(Math.round(value))
}
/** A text field, as written while its trimmed text is `value`. */
const textText = (raw: string | undefined, value: string, clean: (s: string) => string) =>
  raw !== undefined && raw.trim() === value ? raw : clean(value)

// ─── culverts between formats and units (`softreeCulvert.ts`) ─────────────────────────────────

/** The details' culvert as written in another format or unit; unchanged (raw kept) in its own. */
function culvertFor(
  c: SoftreeCulvert,
  from: { format: SoftreeSourceFormat | 'laser-raw'; unitM: number },
  to: { format: SoftreeSourceFormat; unitM: number },
): SoftreeCulvert {
  const sameConvention =
    Math.abs(from.unitM - to.unitM) < 1e-12 &&
    (from.format === to.format || (from.format !== 'ipd' && to.format !== 'ipd'))
  return sameConvention ? c : culvertFromMetres(culvertInMetres(c, from.format, from.unitM), to.format, to.unitM)
}

// ─── matching a field book to the file it was read from ──────────────────────────────────────

const angleSame = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180) < 1e-9
const legSame = (a: TraverseLeg | undefined, b: TraverseLeg | undefined) =>
  !!a &&
  !!b &&
  angleSame(a.bearingDegrees, b.bearingDegrees) &&
  sameValue(a.horizontalDistanceM, b.horizontalDistanceM) &&
  sameValue(a.gradePercent, b.gradePercent)
type SideShot = NonNullable<TraverseInput['sideShots']>[number]
const sideOf = (shots: readonly SideShot[], station: number, side: 'left' | 'right') =>
  shots
    .filter((s) => s.station === station && (side === 'left' ? s.offsetM < 0 : s.offsetM > 0))
    .sort((a, b) => Math.abs(a.offsetM) - Math.abs(b.offsetM))

/** Which source station each field-book station is, and what about it is unchanged since the read. */
interface SourceMatch {
  /** Field-book station → source station, null for one the file does not have. */
  map: Array<number | null>
  /** The leg leaving the station is the leg read. */
  leg: boolean[]
  /** The start and every leg before the station are as read, station for station. */
  upstream: boolean[]
  /** Start station and equations are as read. */
  stations: boolean
  /** The station's side shots on a side are those read. */
  shots: (station: number, side: 'left' | 'right') => boolean
}
function matchSource(
  input: TraverseInput,
  source: SoftreeTraverseSource,
  startStation: number,
  equations: readonly StationEquation[],
): SourceMatch {
  const was = source.input
  const ids = new Map<string, number>()
  const repeated = new Set<string>()
  was.legs.forEach((l, i) => (ids.has(l.id) ? repeated.add(l.id) : ids.set(l.id, i + 1)))
  const map: Array<number | null> = [0]
  input.legs.forEach((l, i) => {
    if (was.legs[i]?.id === l.id) map.push(i + 1)
    else map.push(repeated.has(l.id) ? null : (ids.get(l.id) ?? null))
  })
  // Each source station is used once: a repeated pick keeps its first.
  const used = new Set<number>()
  map.forEach((j, i) => {
    if (j === null) return
    if (used.has(j)) map[i] = null
    else used.add(j)
  })
  const startSame =
    was.start.every((v, k) => sameValue(v, input.start[k])) &&
    sameValue(was.distanceScale ?? 1, input.distanceScale ?? 1)
  const leg = map.map((j, i) => j !== null && legSame(input.legs[i], was.legs[j]))
  const upstream: boolean[] = []
  let ok = startSame
  map.forEach((j, i) => {
    upstream.push(ok && j === i)
    ok = ok && j === i && (i >= input.legs.length ? true : leg[i])
  })
  const wasShots = was.sideShots ?? [],
    shots = input.sideShots ?? []
  return {
    map,
    leg,
    upstream,
    stations:
      sameValue(startStation, source.startStation) &&
      equations.length === source.equations.length &&
      equations.every(
        (e, k) => sameValue(e.back, source.equations[k].back) && sameValue(e.ahead, source.equations[k].ahead),
      ),
    shots: (station, side) => {
      const j = map[station]
      if (j === null || j === undefined) return false
      const a = sideOf(shots, station, side),
        b = sideOf(wasShots, j, side)
      return (
        a.length === b.length &&
        a.every(
          (s, k) =>
            s.id === b[k].id &&
            sameValue(s.offsetM, b[k].offsetM) &&
            sameValue(s.heightDifferenceM, b[k].heightDifferenceM),
        )
      )
    },
  }
}

/** The details' source when it is a file of this format and unit, else null (the file is written afresh). */
function usableSource(details: SoftreeTraverseDetails | undefined, format: SoftreeSourceFormat, unitM: number) {
  const s = details?.source
  return s && s.format === format && Math.abs(details!.unitM - unitM) < 1e-12 ? s : null
}

/** The extras of each station, by field-book index. */
const extrasByStation = (details: SoftreeTraverseDetails | undefined) =>
  new Map((details?.extras ?? []).map((e) => [e.station, e]))

/** Counts of the details a format has no field for, as one note. */
function notCarried(
  format: SoftreeSourceFormat,
  details: SoftreeTraverseDetails | undefined,
  extra: NoteItem[] = [],
): string | null {
  const items: NoteItem[] = []
  if (details) {
    const count = (test: (e: SoftreeStationExtras) => boolean) => details.extras.filter(test).length
    const at = (what: string, n: number): NoteItem => [n, `${what} at ${n} station${n === 1 ? '' : 's'}`]
    const label2 = count((e) => !!e.label2)
    const codes = count((e) => !!e.sideShots?.some((s) => !!s.code))
    const depths = (k?: number) =>
      count(
        (e) =>
          !!e.sideShots?.some((s) =>
            k === undefined ? s.depths.some((d) => d !== null && d !== undefined) : s.depths[k] != null,
          ),
      )
    if (format === 'asc') items.push(at('side-shot codes (an IPD field)', codes))
    if (format === 'polycorder') {
      items.push(at('between-station labels', label2))
      items.push(
        at(
          'third ground layers',
          count((e) => !!e.ground?.[2]?.type),
        ),
      )
      items.push(
        at(
          'second-layer depths',
          count((e) => e.ground?.[1]?.depth != null),
        ),
      )
      items.push(
        at(
          'culvert gradients, azimuths or orientations',
          count(
            (e) =>
              !!e.culvert && [e.culvert.gradientPercent, e.culvert.azimuth, e.culvert.flag].some((v) => v !== null),
          ),
        ),
      )
      items.push(
        at(
          'box culvert heights',
          count((e) => !!e.culvert && e.culvert.sizeX !== null),
        ),
      )
      items.push(
        at(
          'HI/HT',
          count((e) => (e.hi ?? 0) !== 0 || (e.ht ?? 0) !== 0),
        ),
      )
      items.push(
        at(
          'backshots',
          count((e) => e.backshot != null),
        ),
      )
      items.push(at('second side-shot depths', depths(1)))
      items.push(at('side-shot codes', codes))
      const n = details.points.length
      items.push([n, `${n} located point${n === 1 ? '' : 's'}`])
    }
    if (format === 'unit-survey') {
      items.push(at('between-station labels', label2))
      items.push(
        at(
          'ground layers',
          count((e) => !!e.ground?.some((g) => g.type || g.depth !== null)),
        ),
      )
      items.push(
        at(
          'culverts',
          count((e) => !!e.culvert),
        ),
      )
      items.push(
        at(
          'backshots',
          count((e) => e.backshot != null),
        ),
      )
      items.push(at('side-shot depths', depths()))
      items.push(
        at(
          'slopes beyond the last side shot',
          count((e) => !!e.extensionSlope),
        ),
      )
    }
  }
  const shown = [...items, ...extra].filter(([n]) => n > 0)
  if (!shown.length) return null
  return `Not written, because ${FORMAT_NAMES[format]} has no field for them: ${shown.map(([, text]) => text).join('; ')}.`
}
type NoteItem = [number, string]
const FORMAT_NAMES: Record<SoftreeSourceFormat, string> = {
  asc: 'a Softree ASCII traverse',
  ipd: 'an IPD traverse',
  polycorder: 'a Polycorder Roads traverse',
  'unit-survey': 'a unit survey',
}

type ShotMeasure = { h: number; dz: number }
function sideShotMeasure(sd: number, slope: number, elevationDifference: boolean): ShotMeasure {
  if (elevationDifference) return { h: Math.sqrt(Math.max(0, sd * sd - slope * slope)), dz: slope }
  const s = slope / 100,
    h = sd / Math.sqrt(1 + s * s)
  return { h, dz: h * s }
}

const norm360 = (a: number) => ((a % 360) + 360) % 360

// ─── Softree ASCII / IPD ─────────────────────────────────────────────────────────────────────

export type SoftreeAscFormat = 'asc' | 'ipd'

export interface SoftreeAscSideShot {
  sd: number | null
  slope: number | null
  depth1: number | null
  depth2: number | null
  /** IPD only. */
  code?: string
}

/** A CREEK field as read: the culvert and the text it was written as. */
export type SoftreeCreek = SoftreeCulvert & { raw: string }

export interface SoftreeAscRecord {
  station: number | null
  foreshot: number | null
  backshot: number | null
  hd: number | null
  sd: number | null
  slope: number | null
  label1: string
  label2: string
  x: number | null
  y: number | null
  z: number | null
  type: number | null
  creek: SoftreeCulvert | null
  refAzimuth: number | null
  refHd: number | null
  ground1: string
  depth1: number | null
  ground2: string
  depth2: number | null
  ground3: string
  hi: number | null
  ht: number | null
  left: SoftreeAscSideShot[]
  right: SoftreeAscSideShot[]
  tpLeft: number | null
  tpRight: number | null
  /** The station field as written (for equations read from the column). */
  stationText?: string
  /** Every field as written: a field whose value is unchanged is written back as it was. */
  fields?: string[]
}

export interface SoftreeAscTraverse {
  format: SoftreeAscFormat
  /** The version line, as written (`V2.900 Main# T23`). */
  header: string
  /** How the file's lines end; the writer's default is CR LF with a final line end. */
  layout?: TextLayout
  version: string
  /** A column-heading line after the version, when the file has one. */
  headings: string | null
  /** Side shots on each side of every record. */
  sideShots: number
  /** The side-shot count the records' `fields` were written with, when it differs from `sideShots`. */
  fieldsSideShots?: number
  records: SoftreeAscRecord[]
  unitM: null
  epsg: null
  warnings: string[]
}

export const SOFTREE_ASC_TYPE = {
  xyAbsolute: 3,
  zAbsolute: 4,
  ifs: 8,
  slopeDistance: 16,
  deflection: 64,
  elevationDifference: 128,
  radial: 512,
} as const

const VERSION = /^V(\d+)(\.\d+)?\b/

/** Whether a text file is a Softree ASCII traverse or IPD file: a version line, then records. */
export function isSoftreeAscTraverse(text: string): boolean {
  const lines = text
    .slice(0, 16_000)
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim())
  if (!lines.length || !VERSION.test(lines[0].trim())) return false
  const records = lines.slice(1, 12).filter((l) => !/^[A-Za-z]/.test(l.trim()))
  return (
    records.length > 0 &&
    records.every((l) => {
      const f = l.split(',')
      return f.length >= 6 && [0, 1, 2, 3, 4, 5].every((k) => asciiNumber(f[k]) !== undefined)
    })
  )
}

function parseCreek(raw: string): SoftreeCreek | null {
  if (!raw.trim()) return null
  const p = raw.split('x').map((s) => s.trim())
  const n = (k: number) => {
    const v = asciiNumber(p[k])
    return typeof v === 'number' ? v : null
  }
  return { raw, sizeY: n(0), sizeX: n(1), gradientPercent: n(2), azimuth: n(3), flag: n(4), sd: n(5) }
}

const CULVERT_KEYS = ['sizeY', 'sizeX', 'gradientPercent', 'azimuth', 'flag', 'sd'] as const
/** Whether two culverts say the same. */
const sameCulvert = (a: SoftreeCulvert, b: SoftreeCulvert) => CULVERT_KEYS.every((k) => sameValue(a[k], b[k]))

/** The CREEK field: as written (the field, else the culvert's own text) while it still says the same. */
function creekText(c: SoftreeCulvert, decimals: number, field?: string): string {
  for (const raw of [field, c.raw]) {
    const read = raw === undefined ? null : parseCreek(raw)
    if (read && sameCulvert(read, c)) return raw!
  }
  return [c.sizeY, c.sizeX, c.gradientPercent, c.azimuth, c.flag, c.sd]
    .map((v, k) => (k === 4 ? (v === null ? '' : String(Math.round(v))) : asciiFixed(v, decimals)))
    .map((s) => `${s}x`)
    .join('')
}

/** Reads a Softree ASCII traverse or IPD file. `format` overrides the version's reading. */
export function parseSoftreeAscTraverse(text: string, options: { format?: SoftreeAscFormat } = {}): SoftreeAscTraverse {
  const lines = asciiLines(text).filter((l) => l.trim())
  const header = lines[0] ?? ''
  const m = VERSION.exec(header.trim())
  if (!m) throw Error('This is not a Softree ASCII traverse: its first line is not a version such as V3.')
  const format: SoftreeAscFormat = options.format ?? (Number(m[1]) >= 7 ? 'ipd' : 'asc')
  const per = format === 'ipd' ? 5 : 4
  let body = lines.slice(1)
  let headings: string | null = null
  if (body.length && asciiNumber(body[0].split(',')[0]) === undefined) {
    headings = body[0]
    body = body.slice(1)
  }
  if (body.length > MAX_TRAVERSE_RECORDS)
    throw Error(`The traverse has over ${MAX_TRAVERSE_RECORDS.toLocaleString('en-CA')} records.`)
  const written = body.map((l) => l.split(','))
  const rows = written.map((r) => [...r])
  // A record padded with one trailing comma still holds whole side shots.
  for (const r of rows)
    if (
      r.length > ASC_FIXED_FIELDS &&
      (r.length - ASC_FIXED_FIELDS - 2) % (2 * per) !== 0 &&
      r[r.length - 1].trim() === ''
    )
      r.pop()
  const widest = Math.max(0, ...rows.map((r) => r.length))
  const sideShots = widest > ASC_FIXED_FIELDS + 2 ? (widest - ASC_FIXED_FIELDS - 2) / (2 * per) : 0
  if (!Number.isInteger(sideShots)) throw Error(`The side shots do not fill whole groups of ${per} fields per shot.`)
  if (sideShots > MAX_SIDE_SHOTS_PER_SIDE)
    throw Error(`A traverse holds at most ${MAX_SIDE_SHOTS_PER_SIDE} side shots a side.`)
  const warnings: string[] = []
  const records = rows.map((f, i): SoftreeAscRecord => {
    const line = i + 2 + (headings ? 1 : 0)
    const num = (k: number) => {
      const v = asciiNumber(f[k])
      if (v === undefined) throw Error(`Record on line ${line}: field ${k + 1} (${f[k].trim()}) is not a number.`)
      return v
    }
    const text = (k: number) => (f[k] ?? '').trim()
    const shots = (from: number): SoftreeAscSideShot[] =>
      [...Array(sideShots).keys()].map((j) => {
        const b = from + j * per
        return {
          sd: num(b),
          slope: num(b + 1),
          depth1: num(b + 2),
          depth2: num(b + 3),
          ...(per === 5 ? { code: text(b + 4) } : {}),
        }
      })
    const tpAt = ASC_FIXED_FIELDS + 2 * sideShots * per
    return {
      station: num(0),
      foreshot: num(1),
      backshot: num(2),
      hd: num(3),
      sd: num(4),
      slope: num(5),
      label1: text(6),
      label2: text(7),
      x: num(8),
      y: num(9),
      z: num(10),
      type: num(11),
      creek: parseCreek(f[12] ?? ''),
      refAzimuth: num(13),
      refHd: num(14),
      ground1: text(15),
      depth1: num(16),
      ground2: text(17),
      depth2: num(18),
      ground3: text(19),
      hi: num(20),
      ht: num(21),
      left: shots(ASC_FIXED_FIELDS),
      right: shots(ASC_FIXED_FIELDS + sideShots * per),
      tpLeft: sideShots ? num(tpAt) : null,
      tpRight: sideShots ? num(tpAt + 1) : null,
      stationText: f[0] ?? '',
      fields: written[i],
    }
  })
  if (!records.length) throw Error('The traverse has no records.')
  return {
    format,
    header,
    layout: textLayout(text),
    version: header.trim().split(/\s+/)[0],
    headings,
    sideShots,
    fieldsSideShots: sideShots,
    records,
    unitM: null,
    epsg: null,
    warnings,
  }
}

export interface SoftreeAscWriteOptions {
  decimals?: number
  lineEnd?: '\r\n' | '\n'
}

const cleanField = (s: string) => s.replace(/,/g, ';').replace(/[\r\n]+/g, ' ')

/**
 * Writes a Softree ASCII traverse or IPD file. A record that keeps the fields it was read with
 * (`fields`) writes each field as it was while its value is unchanged, so a traverse read and
 * written back unchanged is the same bytes; new numbers take `decimals` (3) or the field's own.
 */
export function writeSoftreeAscTraverse(t: SoftreeAscTraverse, options: SoftreeAscWriteOptions = {}): string {
  const dec = options.decimals ?? 3
  const per = t.format === 'ipd' ? 5 : 4
  const out = [t.header, ...(t.headings ? [t.headings] : [])]
  const rawShots = t.fieldsSideShots ?? t.sideShots
  for (const r of t.records) {
    if (r.left.length !== t.sideShots || r.right.length !== t.sideShots)
      throw Error('Every record must hold the traverse’s number of side shots on each side.')
    const raw = r.fields
    const at = (k: number) => raw?.[k]
    const n = (k: number | undefined, v: number | null) => numberText(k === undefined ? undefined : at(k), v, dec)
    const text = (k: number | undefined, v: string) => textText(k === undefined ? undefined : at(k), v, cleanField)
    // A slot's raw fields exist only for the side-shot count the record was read with.
    const slot = (side: 0 | 1, j: number, q: number) =>
      j < rawShots ? ASC_FIXED_FIELDS + side * rawShots * per + j * per + q : undefined
    const shot = (side: 0 | 1) => (s: SoftreeAscSideShot, j: number) => [
      n(slot(side, j, 0), s.sd),
      n(slot(side, j, 1), s.slope),
      n(slot(side, j, 2), s.depth1),
      n(slot(side, j, 3), s.depth2),
      ...(per === 5 ? [text(slot(side, j, 4), s.code ?? '')] : []),
    ]
    const tpAt = ASC_FIXED_FIELDS + 2 * rawShots * per
    const f = [
      n(0, r.station),
      n(1, r.foreshot),
      n(2, r.backshot),
      n(3, r.hd),
      n(4, r.sd),
      n(5, r.slope),
      text(6, r.label1),
      text(7, r.label2),
      n(8, r.x),
      n(9, r.y),
      n(10, r.z),
      intText(at(11), r.type),
      r.creek ? creekText(r.creek, dec, at(12)) : at(12)?.trim() === '' ? at(12)! : '',
      n(13, r.refAzimuth),
      n(14, r.refHd),
      text(15, r.ground1),
      n(16, r.depth1),
      text(17, r.ground2),
      n(18, r.depth2),
      text(19, r.ground3),
      n(20, r.hi),
      n(21, r.ht),
      ...r.left.flatMap(shot(0)),
      ...r.right.flatMap(shot(1)),
      ...(t.sideShots
        ? [intText(rawShots ? at(tpAt) : undefined, r.tpLeft), intText(rawShots ? at(tpAt + 1) : undefined, r.tpRight)]
        : []),
    ]
    // Trailing blank fields go, down to what the record was written with (six for a new record).
    const keep = raw ? raw.length : t.sideShots ? f.length : 6
    while (f.length > keep && f[f.length - 1] === '') f.pop()
    if (raw && raw.length > f.length && raw.slice(f.length).every((x) => !x.trim())) f.push(...raw.slice(f.length))
    out.push(f.join(','))
  }
  const layout = { ...DEFAULT_LAYOUT, ...t.layout, ...(options.lineEnd ? { lineEnd: options.lineEnd } : {}) }
  return joinLines(out, layout)
}

export interface SoftreeTraverseReadOptions {
  /** Metres per file unit (the project's unit); the file does not say. */
  unitM: number
  /** Grid easting, northing and elevation of the first station, metres, when the file gives none. */
  start?: XYZ
  /** Name field-book stations by their field station (default) or by their label / code. */
  ids?: 'station' | 'label'
}

/** Field-book station names: unique, from labels when asked and present, else the field station. */
function nameStations(stations: number[], labels: string[], mode: 'station' | 'label'): string[] {
  const seen = new Map<string, number>()
  return stations.map((s, i) => {
    let id = mode === 'label' && labels[i]?.trim() ? labels[i].trim().slice(0, 100) : asciiFixed(s, 3)
    const k = seen.get(id) ?? 0
    seen.set(id, k + 1)
    if (k) id = `${id} (${k + 1})`
    return id
  })
}

/** A Softree ASCII or IPD traverse as a field book, with what the field book cannot hold. */
export function softreeAscToTraverse(
  t: SoftreeAscTraverse,
  options: SoftreeTraverseReadOptions,
): SoftreeTraverseImport {
  const unitM = options.unitM
  if (!(unitM > 0)) throw Error('State the traverse’s units: the file does not.')
  const notes: string[] = []
  const T = SOFTREE_ASC_TYPE
  const has = (r: SoftreeAscRecord, bit: number) => ((r.type ?? 0) & bit) === bit
  const offLine = (r: SoftreeAscRecord) => has(r, T.ifs) || has(r, T.radial)

  // Measure every shot in file units.
  const measure = (
    r: SoftreeAscRecord,
    prevAz: number | null,
    line: number,
  ): { az: number; h: number; dz: number } | null => {
    if (r.foreshot === null) return null
    let az = r.foreshot
    if (has(r, T.deflection)) {
      if (prevAz === null) throw Error(`Record ${line} turns a deflection from no previous foreshot.`)
      az = prevAz + r.foreshot
    }
    const ed = has(r, T.elevationDifference)
    let h: number, dz: number
    if (has(r, T.slopeDistance) || r.hd === null) {
      if (r.sd === null) throw Error(`Record ${line} has a foreshot but no distance.`)
      ;({ h, dz } = sideShotMeasure(r.sd, r.slope ?? 0, ed))
    } else {
      h = r.hd
      dz = ed ? (r.slope ?? 0) : (h * (r.slope ?? 0)) / 100
    }
    dz += (r.hi ?? 0) - (r.ht ?? 0)
    return { az: norm360(az), h, dz }
  }

  type Main = { record: SoftreeAscRecord | null; index: number; leg: { az: number; h: number; dz: number } | null }
  const main: Main[] = []
  const offLineShots: Array<{
    record: SoftreeAscRecord
    index: number
    from: number
    shot: { az: number; h: number; dz: number }
  }> = []
  let prevAz: number | null = null
  t.records.forEach((r, i) => {
    if (i > 0 && (has(r, T.xyAbsolute) || has(r, T.zAbsolute)) && !offLine(r))
      throw Error(`Record ${i + 1} is fixed to coordinates part-way; the field book starts from one point only.`)
    const shot = measure(r, prevAz, i + 1)
    if (offLine(r)) {
      if (shot) offLineShots.push({ record: r, index: i, from: Math.max(0, main.length - 1), shot })
      return
    }
    if (main.length && !main[main.length - 1].leg)
      throw Error(`Record ${main[main.length - 1].index + 1} has no foreshot, but the traverse goes on.`)
    main.push({ record: r, index: i, leg: shot && shot.h > 0 ? shot : null })
    if (shot) prevAz = shot.az
  })
  if (!main.length) throw Error('The traverse has no stations.')
  if (main[main.length - 1].leg) main.push({ record: null, index: -1, leg: null })
  if (main.length < 2) throw Error('The traverse has no leg.')

  // Stations and equations, in file units.
  const distances = main.slice(0, -1).map((m) => m.leg!.h)
  const written = main.map((m) => m.record?.station ?? null)
  const tolerance = roundingTolerance(
    main.flatMap((m) => (m.record ? [m.record.stationText ?? '', String(m.record.hd ?? '')] : [])),
  )
  const { start: startStation, equations } = stationEquationsFromColumn(written, distances, tolerance)
  const calc = [startStation]
  for (const d of distances) calc.push(calc[calc.length - 1] + d)
  const field = calc.map((c) => fieldStation(c, equations))
  if (equations.length) notes.push(`${equations.length} station equations were read from the station column.`)
  const ids = nameStations(
    field,
    main.map((m) => m.record?.label1 ?? ''),
    options.ids ?? 'station',
  )

  // Start.
  const first = main[0].record!
  let start: XYZ
  if (has(first, T.xyAbsolute) && has(first, T.zAbsolute) && first.x !== null && first.y !== null && first.z !== null)
    start = [first.x * unitM, first.y * unitM, first.z * unitM]
  else if (options.start) start = options.start
  else
    throw new SoftreeTraverseStartQuestion(
      'This traverse gives no coordinates for its first station; enter its easting, northing and elevation.',
    )

  const legs: TraverseLeg[] = main.slice(0, -1).map((m, i) => ({
    id: ids[i + 1],
    bearingDegrees: m.leg!.az,
    horizontalDistanceM: m.leg!.h * unitM,
    gradePercent: (m.leg!.dz / m.leg!.h) * 100,
  }))

  // Side shots and extras.
  const sideShots: NonNullable<TraverseInput['sideShots']> = []
  const extras: SoftreeStationExtras[] = []
  let lostShots = 0
  main.forEach((m, station) => {
    const r = m.record
    if (!r) return
    const extra: SoftreeStationExtras = { station }
    if (r.label1) extra.label = r.label1
    if (r.label2) extra.label2 = r.label2
    const ground = groundLayers([
      { type: r.ground1, depth: r.depth1 },
      { type: r.ground2, depth: r.depth2 },
      { type: r.ground3, depth: null },
    ])
    if (ground.length) extra.ground = ground
    if (r.creek) extra.culvert = { ...r.creek }
    if (r.hi !== null) extra.hi = r.hi
    if (r.ht !== null) extra.ht = r.ht
    if (r.backshot !== null) extra.backshot = r.backshot
    for (const side of ['left', 'right'] as const) {
      const shots = r[side]
      const tp = (side === 'left' ? r.tpLeft : r.tpRight) ?? 0
      const sign = side === 'left' ? -1 : 1
      let lastTp = { h: 0, dz: 0 },
        prev = { h: 0, dz: 0 }
      for (let j = 0; j < shots.length; j++) {
        const s = shots[j]
        if (s.sd === null || s.sd <= 0) {
          if (s.slope !== null) (extra.extensionSlope ??= {})[side] = s.slope
          break
        }
        const from = t.format === 'ipd' ? lastTp : prev
        const d = sideShotMeasure(s.sd, s.slope ?? 0, has(r, T.elevationDifference))
        const here = { h: from.h + d.h, dz: from.dz + d.dz }
        prev = here
        if (!(tp & (1 << j))) lastTp = here
        const code = s.code?.trim()
        sideShots.push({
          id: code || `${ids[station]} ${side === 'left' ? 'L' : 'R'}${j + 1}`,
          station,
          offsetM: sign * here.h * unitM,
          heightDifferenceM: here.dz * unitM,
        })
        if (s.depth1 !== null || s.depth2 !== null || code)
          (extra.sideShots ??= []).push({ side, n: j + 1, depths: [s.depth1, s.depth2], ...(code ? { code } : {}) })
      }
    }
    if (Object.keys(extra).length > 1) extras.push(extra)
  })
  const input: TraverseInput = { start, adjustment: 'none', legs, sideShots }
  const reduced = reduceTraverse(input)

  // Located shots from the stations they were taken at.
  const points = offLineShots.map((o): SoftreeTraversePoint => {
    const at = reduced.stations[o.from].raw
    const h = o.shot.h * unitM
    return {
      id: o.record.label1 || `${ids[o.from]} shot ${o.index + 1}`,
      from: ids[o.from],
      station: o.from,
      coordinate: [
        at[0] + Math.sin(o.shot.az * RAD) * h,
        at[1] + Math.cos(o.shot.az * RAD) * h,
        at[2] + o.shot.dz * unitM,
      ] as XYZ,
    }
  })
  if (points.length) notes.push(`${points.length} IFS or radial shots are located points, not legs.`)
  lostShots = t.records.reduce((k, r) => k + (r.refAzimuth !== null || r.refHd !== null ? 1 : 0), 0)
  if (lostShots) notes.push(`${lostShots} reference shots are not used (RoadEng ignores them too).`)

  // The file's own coordinates against the reduction.
  let compared = 0,
    worst = 0
  main.forEach((m, i) => {
    const r = m.record
    if (!r || r.x === null || r.y === null || r.z === null) return
    const p = reduced.stations[i].raw
    worst = Math.max(worst, Math.hypot(r.x * unitM - p[0], r.y * unitM - p[1]), Math.abs(r.z * unitM - p[2]))
    compared++
  })
  const kept = extras.filter((e) => e.ground || e.culvert || e.sideShots || e.extensionSlope || e.label).length
  if (kept)
    notes.push(
      `${kept} stations carry labels, ground layers, culverts or side-shot depths the field book does not hold.`,
    )
  // Which station each record became, or the station an off-line shot was taken from.
  const stationOf = new Map(main.flatMap((m, i) => (m.record ? [[m.index, i] as const] : [])))
  const shotFrom = new Map(offLineShots.map((o) => [o.index, o.from]))
  let lastStation = 0
  const records: SoftreeSourceRecord[] = t.records.map((r, i) => {
    const line = (r.fields ?? []).join(',')
    const station = stationOf.get(i)
    if (station !== undefined) {
      lastStation = station
      return { line, station, role: 'station' }
    }
    return { line, station: shotFrom.get(i) ?? lastStation, role: 'shot' }
  })
  const startM = startStation * unitM
  const equationsM = equations.map((e) => ({ back: e.back * unitM, ahead: e.ahead * unitM }))
  return {
    input,
    startStation: startM,
    equations: equationsM,
    stationIds: ids,
    extras,
    points,
    source: {
      format: t.format,
      layout: t.layout ?? DEFAULT_LAYOUT,
      head: [t.header, ...(t.headings ? [t.headings] : [])],
      records,
      input: structuredClone(input),
      startStation: startM,
      equations: equationsM,
    },
    fileCheck: compared ? { compared, maxDifferenceM: worst } : null,
    notes,
  }
}

/** Ground layers in their file positions, without the blank ones after the last given. */
function groundLayers(layers: Array<{ type: string; depth: number | null }>) {
  const out = [...layers]
  while (out.length && !out[out.length - 1].type && out[out.length - 1].depth === null) out.pop()
  return out
}

export interface SoftreeTraverseWriteOptions {
  /** Metres per file unit. */
  unitM: number
  /** First station, metres (default 0). */
  startStation?: number
  equations?: readonly StationEquation[]
  /** Write the field stations (the default, which carries the equations) or the calculated ones. */
  stationColumn?: 'field' | 'calculated'
  /**
   * Station names written as the at-station label or not: by default only without `details`. A
   * station with a label of its own in `details` takes that label instead.
   */
  labels?: boolean
  /**
   * What the field book's traverse file held beyond legs and side shots. Each format writes the
   * details it has a field for; written back in the format and unit it was read in, the file keeps
   * every record as written that the field book did not change.
   */
  details?: SoftreeTraverseDetails
}

/** Side shots of one field-book station and side, nearest first, as chained increments. */
function chainedShots(
  shots: NonNullable<TraverseInput['sideShots']>,
  station: number,
  side: 'left' | 'right',
  unitM: number,
): { shots: Array<{ h: number; dz: number; id: string }>; dropped: number } {
  const own = shots
    .filter((s) => s.station === station && (side === 'left' ? s.offsetM < 0 : s.offsetM > 0))
    .sort((a, b) => Math.abs(a.offsetM) - Math.abs(b.offsetM))
  const out: Array<{ h: number; dz: number; id: string }> = []
  let h = 0,
    dz = 0,
    dropped = 0
  for (const s of own) {
    const step = Math.abs(s.offsetM) / unitM - h
    if (step <= 1e-6) {
      dropped++
      continue
    }
    out.push({ h: step, dz: s.heightDifferenceM / unitM - dz, id: s.id })
    h += step
    dz = s.heightDifferenceM / unitM
  }
  return { shots: out, dropped }
}

/** A field book as a Softree ASCII (or IPD) traverse; notes say what the format cannot carry. */
export function traverseToSoftreeAsc(
  input: TraverseInput,
  options: SoftreeTraverseWriteOptions & { format?: SoftreeAscFormat; header?: string },
): { traverse: SoftreeAscTraverse; notes: string[] } {
  const { unitM } = options
  if (!(unitM > 0)) throw Error('Give the file unit in metres.')
  const format = options.format ?? 'asc'
  const ipd = format === 'ipd'
  const T = SOFTREE_ASC_TYPE
  const reduced = reduceTraverse(input)
  const equations = options.equations ?? []
  const start = options.startStation ?? 0
  checkStationEquations(equations, { start, end: start + input.legs.reduce((s, l) => s + l.horizontalDistanceM, 0) })
  const notes: string[] = []
  const details = options.details
  // Details' lengths are in the unit they were read in.
  const k = details ? details.unitM / unitM : 1
  const len = (v: number | null | undefined) => (v === null || v === undefined ? null : v * k)
  const extras = extrasByStation(details)
  const source = usableSource(details, format, unitM)
  const file = source
    ? parseSoftreeAscTraverse(joinLines([...source.head, ...source.records.map((r) => r.line)]), { format })
    : null
  const match = source ? matchSource(input, source, start, equations) : null
  const was = source?.input
  // The source's station records, and the shot records each is followed by.
  const stationRecord = new Map<number, SoftreeAscRecord>()
  const shotsAfter = new Map<number, number[]>()
  const leading: number[] = []
  if (source && file) {
    let last: number | null = null
    source.records.forEach((r, i) => {
      if (r.role === 'station' && r.station !== undefined) {
        stationRecord.set(r.station, file.records[i])
        shotsAfter.set((last = r.station), [])
      } else if (last === null) leading.push(i)
      else shotsAfter.get(last)!.push(i)
    })
  }
  const shots = input.sideShots ?? []
  let dropped = shots.filter((s) => s.offsetM === 0).length,
    lostDepths = 0,
    thirdDepths = 0,
    lostPoints = 0
  const records: SoftreeAscRecord[] = []
  const emptySlot = (): SoftreeAscSideShot => ({
    sd: 0,
    slope: null,
    depth1: null,
    depth2: null,
    ...(ipd ? { code: '' } : {}),
  })
  const blank = (): SoftreeAscRecord => ({
    station: null,
    foreshot: null,
    backshot: null,
    hd: null,
    sd: null,
    slope: null,
    label1: '',
    label2: '',
    x: null,
    y: null,
    z: null,
    type: 0,
    creek: null,
    refAzimuth: null,
    refHd: null,
    ground1: '',
    depth1: null,
    ground2: '',
    depth2: null,
    ground3: '',
    hi: null,
    ht: null,
    left: [],
    right: [],
    tpLeft: null,
    tpRight: null,
  })
  if (match?.map[0] === 0) for (const i of leading) records.push(file!.records[i])
  const mapped = new Set(match?.map.filter((j): j is number => j !== null))
  let calc = start
  reduced.stations.forEach((s, i) => {
    const leg = input.legs[i]
    const station = (options.stationColumn === 'calculated' ? calc : fieldStation(calc, equations)) / unitM
    if (leg) calc += leg.horizontalDistanceM
    const j = match?.map[i] ?? null
    const base = j !== null ? (stationRecord.get(j) ?? null) : null
    // The end station of a file whose last record leads to it has no record of its own.
    if (j !== null && !base && !leg) return
    const e = extras.get(i)
    const r: SoftreeAscRecord = base
      ? { ...base, left: base.left.map((x) => ({ ...x })), right: base.right.map((x) => ({ ...x })) }
      : blank()
    // A record read keeps its own TYPE, blank included.
    const type = base ? base.type : i === 0 ? T.xyAbsolute + T.zAbsolute : 0
    const has = (bit: number) => ((type ?? 0) & bit) === bit
    r.type = type
    r.station =
      base && match!.upstream[i] && match!.stations && options.stationColumn !== 'calculated' ? base.station : station
    // The leg, in the record's own entry modes (deflection, slope distance, elevation difference).
    const hi = len(e?.hi),
      ht = len(e?.ht)
    const prevSame =
      !has(T.deflection) ||
      (i > 0 &&
        j !== null &&
        match!.map[i - 1] === j - 1 &&
        angleSame(input.legs[i - 1].bearingDegrees, was!.legs[j - 1].bearingDegrees))
    const legAsRead = base && match!.leg[i] && prevSame && sameValue(base.hi, hi) && sameValue(base.ht, ht)
    if (!leg) {
      r.foreshot = r.hd = r.sd = r.slope = null
    } else if (!legAsRead) {
      let fs = leg.bearingDegrees
      if (has(T.deflection)) {
        if (i > 0) fs = ((((leg.bearingDegrees - input.legs[i - 1].bearingDegrees) % 360) + 540) % 360) - 180
        else r.type = (type ?? 0) - T.deflection
      }
      if (base?.foreshot != null && angleSame(fs, base.foreshot)) fs = base.foreshot
      const h = leg.horizontalDistanceM / unitM
      const dz = (h * leg.gradePercent) / 100 - ((hi ?? 0) - (ht ?? 0))
      const ed = has(T.elevationDifference)
      const slope = ed ? dz : (dz / h) * 100
      const sd = ed ? Math.hypot(h, dz) : h * Math.sqrt(1 + (slope / 100) ** 2)
      const sdOnly = has(T.slopeDistance) || (base !== null && base.hd === null)
      r.foreshot = fs
      r.hd = sdOnly ? null : h
      r.sd = sdOnly || !base || base.sd !== null ? sd : null
      r.slope = slope
    }
    const name = i === 0 ? '' : input.legs[i - 1].id
    r.label1 = e?.label ?? (base || !(options.labels ?? !details) ? '' : name)
    r.label2 = e?.label2 ?? ''
    const xyz = s.raw.map((v) => v / unitM)
    if (!(base && match!.upstream[i])) {
      r.x = base && base.x === null ? null : xyz[0]
      r.y = base && base.y === null ? null : xyz[1]
      r.z = base && base.z === null ? null : xyz[2]
    }
    r.creek = e?.culvert
      ? culvertFor(e.culvert, { format: details!.sourceFormat, unitM: details!.unitM }, { format, unitM })
      : null
    const g = e?.ground ?? []
    r.ground1 = g[0]?.type ?? ''
    r.depth1 = len(g[0]?.depth)
    r.ground2 = g[1]?.type ?? ''
    r.depth2 = len(g[1]?.depth)
    r.ground3 = g[2]?.type ?? ''
    if (g[2]?.depth != null) thirdDepths++
    r.hi = hi
    r.ht = ht
    r.backshot = e?.backshot ?? null
    // Side shots: as read while unchanged, else chained afresh from the station (all turning points).
    for (const side of ['left', 'right'] as const) {
      const ext = e?.extensionSlope?.[side]
      const same = !!base && match!.shots(i, side)
      let slots: SoftreeAscSideShot[]
      if (same) slots = r[side]
      else {
        slots = []
        let h0 = 0,
          dz0 = 0
        for (const x of sideOf(shots, i, side)) {
          const h = Math.abs(x.offsetM) / unitM,
            dz = x.heightDifferenceM / unitM
          const dh = h - h0,
            ddz = dz - dz0
          if (dh <= 1e-6) {
            dropped++
            continue
          }
          const ed = has(T.elevationDifference)
          // A code only for a shot the person named: not the reader's "<station> L1".
          const generated = x.id.endsWith(` ${side === 'left' ? 'L' : 'R'}${slots.length + 1}`)
          slots.push({
            sd: ed ? Math.hypot(dh, ddz) : dh * Math.sqrt(1 + (ddz / dh) ** 2),
            slope: ed ? ddz : (ddz / dh) * 100,
            depth1: null,
            depth2: null,
            ...(ipd ? { code: generated && details ? '' : x.id } : {}),
          })
          h0 = h
          dz0 = dz
        }
        if (slots.length || ext !== undefined) slots.push({ ...emptySlot(), slope: ext ?? null })
        if (side === 'left') r.tpLeft = 0
        else r.tpRight = 0
      }
      const end = slots.findIndex((x) => x.sd === null || x.sd <= 0)
      const valid = end < 0 ? slots.length : end
      const own = (e?.sideShots ?? []).filter((x) => x.side === side)
      for (let q = 0; q < valid; q++) {
        const xe = own.find((x) => x.n === q + 1)
        slots[q].depth1 = len(xe?.depths[0])
        slots[q].depth2 = len(xe?.depths[1])
        if (ipd && xe?.code !== undefined) slots[q].code = xe.code
      }
      lostDepths += own.filter((x) => x.n > valid && x.depths.some((d) => d !== null)).length
      if (end >= 0) slots[end].slope = ext ?? null
      else if (ext !== undefined) slots.push({ ...emptySlot(), slope: ext })
      r[side] = slots
    }
    records.push(r)
    if (j !== null) for (const idx of shotsAfter.get(j) ?? []) records.push(file!.records[idx])
    // Located points of details not read from this file, as IFS shots from their station.
    if (!source && details)
      for (const p of details.points) {
        const from = p.station ?? (p.from === name ? i : -1)
        if (from !== i) continue
        const d = p.coordinate.map((v, q) => v - s.raw[q])
        const hM = Math.hypot(d[0], d[1])
        if (!(hM > 1e-6)) {
          lostPoints++
          continue
        }
        const h = hM / unitM,
          slope = (d[2] / unitM / h) * 100
        records.push({
          ...blank(),
          station,
          foreshot: norm360(Math.atan2(d[0], d[1]) / RAD),
          hd: h,
          sd: h * Math.sqrt(1 + (slope / 100) ** 2),
          slope,
          label1: p.id,
          x: p.coordinate[0] / unitM,
          y: p.coordinate[1] / unitM,
          z: p.coordinate[2] / unitM,
          type: T.ifs,
        })
      }
  })
  const unplacedPoints =
    details && !source
      ? details.points.filter((p) => p.station === undefined && !input.legs.some((l) => l.id === p.from)).length
      : 0
  // Records of shots from stations the field book no longer has.
  const lostShots = [...shotsAfter].filter(([j]) => !mapped.has(j)).reduce((n, [, list]) => n + list.length, 0)
  const count = Math.max(file?.sideShots ?? 0, ...records.flatMap((r) => [r.left.length, r.right.length]))
  if (count > MAX_SIDE_SHOTS_PER_SIDE)
    throw Error(`A station has over ${MAX_SIDE_SHOTS_PER_SIDE - 1} side shots on a side.`)
  for (const r of records) {
    for (const side of ['left', 'right'] as const)
      r[side] = [...r[side], ...Array.from({ length: count - r[side].length }, emptySlot)]
    // A record read keeps blank flags blank; a new one says every shot is a turning point.
    if (!count) r.tpLeft = r.tpRight = null
    else if (!r.fields) {
      r.tpLeft ??= 0
      r.tpRight ??= 0
    }
  }
  if (dropped) notes.push(`${dropped} side shots at the same offset as a nearer one, or on the line, were left out.`)
  if (lostDepths)
    notes.push(`${lostDepths} side-shot depths belong to side shots no longer in the field book and were left out.`)
  if (lostShots) notes.push(`${lostShots} shots from stations no longer in the field book were left out.`)
  if (lostPoints + unplacedPoints)
    notes.push(`${lostPoints + unplacedPoints} located points not placed from a field-book station were left out.`)
  if (input.target) notes.push('The closing coordinate and adjustment are not part of the format and were not written.')
  if (input.distanceScale !== undefined && input.distanceScale !== 1)
    notes.push('Distances are written as entered (ground); the X, Y, Z columns are the reduced grid coordinates.')
  if (equations.length && options.stationColumn === 'calculated')
    notes.push('The station equations were not written: the station column holds calculated stations.')
  const missing = notCarried(format, details, [[thirdDepths, `third-layer depths at ${thirdDepths} stations`]])
  if (missing) notes.push(missing)
  return {
    traverse: {
      format,
      header: file?.header ?? options.header ?? (ipd ? 'V7' : 'V2.900 PGMaps'),
      layout: file?.layout,
      version: file?.version ?? (ipd ? 'V7' : 'V2.900'),
      headings: file?.headings ?? null,
      sideShots: count,
      ...(file ? { fieldsSideShots: file.sideShots } : {}),
      records,
      unitM: null,
      epsg: null,
      warnings: [],
    },
    notes,
  }
}

// ─── Polycorder Roads ─────────────────────────────────────────────────────────────────────────

export interface PolycorderSideShot {
  slope: number | null
  distance: number | null
  depth: number | null
}
export interface PolycorderRecord {
  station: number | null
  distance: number | null
  bearing: number | null
  slope: number | null
  label: string
  culvert: number | null
  soil1: string
  depth: number | null
  soil2: string
  left: PolycorderSideShot[]
  right: PolycorderSideShot[]
  stationText?: string
  /** Every field as written (text fields with their quotes). */
  fields?: string[]
}
const POLYCORDER_FIELDS = 9 + 6 * POLYCORDER_SIDE_SHOTS
const POLYCORDER_TEXT = new Set([4, 6, 8])
const POLYCORDER_TEXT_MAX: Record<number, number> = { 4: 60, 6: 2, 8: 2 }

/** Comma fields with double-quoted text (`""` inside quotes is a quote); null when unbalanced. */
function quotedFields(line: string): Array<{ text: string; quoted: boolean; raw: string }> | null {
  const out: Array<{ text: string; quoted: boolean; raw: string }> = []
  let i = 0
  for (;;) {
    const from = i
    if (line[i] === '"') {
      let text = ''
      i++
      for (;;) {
        if (i >= line.length) return null
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            text += '"'
            i += 2
            continue
          }
          i++
          break
        }
        text += line[i++]
      }
      while (i < line.length && line[i] === ' ') i++
      out.push({ text, quoted: true, raw: line.slice(from, i) })
    } else {
      const end = line.indexOf(',', i)
      out.push({ text: line.slice(i, end < 0 ? line.length : end), quoted: false, raw: '' })
      i = end < 0 ? line.length : end
      out[out.length - 1].raw = line.slice(from, i)
    }
    if (i >= line.length) return out
    if (line[i] !== ',') return null
    i++
  }
}

/** Whether a text file is a Polycorder Roads traverse: 27 fields, text fields quoted. */
export function isPolycorderTraverse(text: string): boolean {
  const lines = text
    .slice(0, 16_000)
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim())
    .slice(0, 10)
  if (text.length > 16_000) lines.pop()
  return (
    lines.length > 0 &&
    lines.every((l) => {
      const f = quotedFields(l)
      return (
        f !== null &&
        f.length === POLYCORDER_FIELDS &&
        f.every((x, k) => (POLYCORDER_TEXT.has(k) ? x.quoted : !x.quoted && asciiNumber(x.text) !== undefined))
      )
    })
  )
}

export function parsePolycorderTraverse(text: string): {
  records: PolycorderRecord[]
  layout: TextLayout
  unitM: null
  epsg: null
} {
  const lines = asciiLines(text).filter((l) => l.trim())
  if (lines.length > MAX_TRAVERSE_RECORDS)
    throw Error(`The traverse has over ${MAX_TRAVERSE_RECORDS.toLocaleString('en-CA')} records.`)
  const records = lines.map((line, i): PolycorderRecord => {
    const f = quotedFields(line)
    if (!f || f.length !== POLYCORDER_FIELDS)
      throw Error(`Line ${i + 1} is not a Polycorder Roads record of ${POLYCORDER_FIELDS} fields.`)
    const num = (k: number) => {
      const v = asciiNumber(f[k].text)
      if (v === undefined || f[k].quoted) throw Error(`Line ${i + 1}: field ${k + 1} is not a number.`)
      return v
    }
    const shot = (k: number): PolycorderSideShot => ({ slope: num(k), distance: num(k + 1), depth: num(k + 2) })
    const left: PolycorderSideShot[] = [],
      right: PolycorderSideShot[] = []
    for (let j = 0; j < POLYCORDER_SIDE_SHOTS; j++) {
      left.push(shot(9 + 6 * j))
      right.push(shot(12 + 6 * j))
    }
    return {
      station: num(0),
      distance: num(1),
      bearing: num(2),
      slope: num(3),
      label: f[4].text,
      culvert: num(5),
      soil1: f[6].text,
      depth: num(7),
      soil2: f[8].text,
      left,
      right,
      stationText: f[0].text,
      fields: f.map((x) => x.raw),
    }
  })
  if (!records.length) throw Error('The traverse has no records.')
  return { records, layout: textLayout(text), unitM: null, epsg: null }
}

/** A quoted field's text, `""` read as a quote. */
const unquote = (raw: string) => {
  const t = raw.trim()
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).split('""').join('"') : t
}

/**
 * Writes Polycorder Roads records. A record that keeps its `fields` writes each one as it was while
 * its value is unchanged; new numbers take `decimals` (1, the help's) or the field's own.
 */
export function writePolycorderTraverse(
  records: readonly PolycorderRecord[],
  options: { decimals?: number; lineEnd?: '\r\n' | '\n'; layout?: TextLayout } = {},
): string {
  const dec = options.decimals ?? 1
  return joinLines(
    records.map((r) => {
      const raw = r.fields
      const n = (k: number, v: number | null) => numberText(raw?.[k], v ?? 0, dec)
      const q = (k: number, s: string) => {
        const text = s.slice(0, POLYCORDER_TEXT_MAX[k]).replace(/"/g, "'")
        return raw?.[k] !== undefined && unquote(raw[k]) === s ? raw[k] : `"${text}"`
      }
      const f = [
        n(0, r.station),
        n(1, r.distance),
        n(2, r.bearing),
        n(3, r.slope),
        q(4, r.label),
        intText(raw?.[5], Math.round(r.culvert ?? 0)),
        q(6, r.soil1),
        n(7, r.depth),
        q(8, r.soil2),
      ]
      for (let j = 0; j < POLYCORDER_SIDE_SHOTS; j++)
        for (const [side, s] of [
          [0, r.left[j]],
          [3, r.right[j]],
        ] as const) {
          const at = 9 + 6 * j + side
          f.push(n(at, s?.slope ?? 0), n(at + 1, s?.distance ?? 0), n(at + 2, s?.depth ?? 0))
        }
      return f.join(',')
    }),
    { ...DEFAULT_LAYOUT, ...options.layout, ...(options.lineEnd ? { lineEnd: options.lineEnd } : {}) },
  )
}

/** A Polycorder Roads traverse as a field book. The format has no coordinates: give the start. */
export function polycorderToTraverse(
  records: readonly PolycorderRecord[],
  options: SoftreeTraverseReadOptions & { layout?: TextLayout },
): SoftreeTraverseImport {
  const { unitM } = options
  if (!(unitM > 0)) throw Error('State the traverse’s units: the file does not.')
  if (!options.start)
    throw new SoftreeTraverseStartQuestion(
      'A Polycorder traverse has no coordinates; enter the easting, northing and elevation of its first station.',
    )
  const stations = [...records]
  // A last record with a distance leads to an end station the file does not list.
  const tail = stations[stations.length - 1]
  const closed = !(tail.distance && tail.distance > 0)
  for (let i = 0; i < stations.length - (closed ? 1 : 0); i++)
    if (!(stations[i].distance! > 0) || stations[i].bearing === null)
      throw Error(`Record ${i + 1} has no distance or bearing to the next station.`)
  const distances = stations.slice(0, closed ? -1 : undefined).map((r) => r.distance!)
  const written = [...stations.map((r) => r.station), ...(closed ? [] : [null])]
  const tolerance = roundingTolerance(stations.flatMap((r) => [r.stationText ?? '', String(r.distance ?? '')]))
  const { start: startStation, equations } = stationEquationsFromColumn(written, distances, tolerance)
  const calc = [startStation]
  for (const d of distances) calc.push(calc[calc.length - 1] + d)
  const ids = nameStations(
    calc.map((c) => fieldStation(c, equations)),
    [...stations.map((r) => r.label), ''],
    options.ids ?? 'station',
  )
  const legs: TraverseLeg[] = distances.map((d, i) => ({
    id: ids[i + 1],
    bearingDegrees: norm360(stations[i].bearing!),
    horizontalDistanceM: d * unitM,
    gradePercent: stations[i].slope ?? 0,
  }))
  const sideShots: NonNullable<TraverseInput['sideShots']> = []
  const extras: SoftreeStationExtras[] = []
  stations.forEach((r, station) => {
    const extra: SoftreeStationExtras = { station }
    if (r.label) extra.label = r.label
    // The format writes 0 for an empty number: a depth of 0 is none.
    const ground = groundLayers([
      { type: r.soil1, depth: r.depth || null },
      { type: r.soil2, depth: null },
    ])
    if (ground.length) extra.ground = ground
    if (r.culvert)
      extra.culvert = { sizeY: r.culvert, sizeX: null, gradientPercent: null, azimuth: null, flag: null, sd: null }
    for (const side of ['left', 'right'] as const) {
      let h = 0,
        dz = 0
      const sign = side === 'left' ? -1 : 1
      for (let j = 0; j < r[side].length; j++) {
        const s = r[side][j]
        if (!(s.distance && s.distance > 0)) {
          if (s.slope) (extra.extensionSlope ??= {})[side] = s.slope
          break
        }
        const d = sideShotMeasure(s.distance, s.slope ?? 0, false)
        h += d.h
        dz += d.dz
        sideShots.push({
          id: `${ids[station]} ${side === 'left' ? 'L' : 'R'}${j + 1}`,
          station,
          offsetM: sign * h * unitM,
          heightDifferenceM: dz * unitM,
        })
        if (s.depth) (extra.sideShots ??= []).push({ side, n: j + 1, depths: [s.depth] })
      }
    }
    if (Object.keys(extra).length > 1) extras.push(extra)
  })
  const input: TraverseInput = { start: options.start, adjustment: 'none', legs, sideShots }
  reduceTraverse(input)
  const notes: string[] = []
  if (equations.length) notes.push(`${equations.length} station equations were read from the station column.`)
  if (extras.length)
    notes.push(
      `${extras.length} stations carry labels, soils, culverts or side-shot depths the field book does not hold.`,
    )
  const startM = startStation * unitM
  const equationsM = equations.map((e) => ({ back: e.back * unitM, ahead: e.ahead * unitM }))
  const canKeep = records.every((r) => r.fields)
  return {
    input,
    startStation: startM,
    equations: equationsM,
    stationIds: ids,
    extras,
    points: [],
    ...(canKeep
      ? {
          source: {
            format: 'polycorder' as const,
            layout: options.layout ?? DEFAULT_LAYOUT,
            head: [],
            records: records.map((r, station) => ({ line: r.fields!.join(','), station, role: 'station' as const })),
            input: structuredClone(input),
            startStation: startM,
            equations: equationsM,
          },
        }
      : {}),
    fileCheck: null,
    notes,
  }
}

/** A field book as Polycorder Roads records (three side shots a side at most). */
export function traverseToPolycorder(
  input: TraverseInput,
  options: SoftreeTraverseWriteOptions,
): { records: PolycorderRecord[]; layout?: TextLayout; notes: string[] } {
  const { unitM } = options
  if (!(unitM > 0)) throw Error('Give the file unit in metres.')
  const reduced = reduceTraverse(input)
  const equations = options.equations ?? []
  const start = options.startStation ?? 0
  checkStationEquations(equations, { start, end: start + reduced.lengthM / (input.distanceScale ?? 1) })
  const notes: string[] = []
  const details = options.details
  const k = details ? details.unitM / unitM : 1
  const len = (v: number | null | undefined) => (v === null || v === undefined ? null : v * k)
  const extras = extrasByStation(details)
  const source = usableSource(details, 'polycorder', unitM)
  const file = source ? parsePolycorderTraverse(joinLines(source.records.map((r) => r.line))) : null
  const match = source ? matchSource(input, source, start, equations) : null
  let dropped = 0,
    truncated = 0,
    soilsCut = 0,
    lostExtensions = 0,
    lostDepths = 0
  let calc = start
  const records: PolycorderRecord[] = []
  reduced.stations.forEach((_station, i) => {
    const leg = input.legs[i]
    const station = (options.stationColumn === 'calculated' ? calc : fieldStation(calc, equations)) / unitM
    if (leg) calc += leg.horizontalDistanceM
    const j = match?.map[i] ?? null
    const base = j !== null ? (file!.records[j] ?? null) : null
    // The end station of a file whose last record leads to it has no record of its own.
    if (j !== null && !base && !leg) return
    const e = extras.get(i)
    const r: PolycorderRecord = base
      ? { ...base, left: base.left.map((x) => ({ ...x })), right: base.right.map((x) => ({ ...x })) }
      : {
          station: null,
          distance: 0,
          bearing: 0,
          slope: 0,
          label: '',
          culvert: 0,
          soil1: '',
          depth: 0,
          soil2: '',
          left: [],
          right: [],
        }
    r.station =
      base && match!.upstream[i] && match!.stations && options.stationColumn !== 'calculated' ? base.station : station
    if (leg) {
      if (!(base && match!.leg[i])) {
        r.distance = leg.horizontalDistanceM / unitM
        r.bearing =
          base?.bearing != null && angleSame(base.bearing, leg.bearingDegrees) ? base.bearing : leg.bearingDegrees
        r.slope = leg.gradePercent
      }
    } else if (!base || (base.distance ?? 0) > 0) {
      r.distance = 0
      if (!base) r.bearing = r.slope = 0
    }
    const name = i === 0 ? '' : input.legs[i - 1].id
    const label = e?.label ?? (base || !(options.labels ?? !details) ? '' : name)
    if (label.length > 60) truncated++
    r.label = label.slice(0, 60)
    const c = e?.culvert
      ? culvertFor(e.culvert, { format: details!.sourceFormat, unitM: details!.unitM }, { format: 'polycorder', unitM })
      : null
    r.culvert = c ? Math.round(c.sizeX ?? c.sizeY ?? 0) : 0
    const g = e?.ground ?? []
    if ((g[0]?.type.length ?? 0) > 2 || (g[1]?.type.length ?? 0) > 2) soilsCut++
    r.soil1 = (g[0]?.type ?? '').slice(0, 2)
    r.depth = len(g[0]?.depth) ?? 0
    r.soil2 = (g[1]?.type ?? '').slice(0, 2)
    for (const side of ['left', 'right'] as const) {
      const ext = e?.extensionSlope?.[side]
      let slots: PolycorderSideShot[]
      if (base && match!.shots(i, side)) slots = r[side]
      else {
        const c = chainedShots(input.sideShots ?? [], i, side, unitM)
        dropped += c.dropped + Math.max(0, c.shots.length - POLYCORDER_SIDE_SHOTS)
        slots = c.shots.slice(0, POLYCORDER_SIDE_SHOTS).map((x) => {
          const slope = (x.dz / x.h) * 100
          return { slope, distance: x.h * Math.sqrt(1 + (slope / 100) ** 2), depth: 0 }
        })
      }
      slots = [
        ...slots,
        ...Array.from({ length: POLYCORDER_SIDE_SHOTS - slots.length }, () => ({ slope: 0, distance: 0, depth: 0 })),
      ]
      const end = slots.findIndex((x) => !(x.distance && x.distance > 0))
      const valid = end < 0 ? slots.length : end
      const own = (e?.sideShots ?? []).filter((x) => x.side === side)
      for (let q = 0; q < valid; q++) slots[q].depth = len(own.find((x) => x.n === q + 1)?.depths[0]) ?? 0
      lostDepths += own.filter((x) => x.n > valid && x.depths[0] != null).length
      if (end >= 0) slots[end].slope = ext ?? 0
      else if (ext !== undefined) lostExtensions++
      r[side] = slots
    }
    records.push(r)
  })
  if (dropped)
    notes.push(`${dropped} side shots beyond three a side, at a repeated offset, or on the line were left out.`)
  if (truncated) notes.push(`${truncated} station names were cut to Polycorder's 60 characters.`)
  if (soilsCut) notes.push(`Soil codes at ${soilsCut} stations were cut to Polycorder's 2 characters.`)
  if (lostDepths)
    notes.push(`${lostDepths} side-shot depths belong to side shots no longer in the field book and were left out.`)
  const missing = notCarried('polycorder', details, [
    [lostExtensions, `slopes beyond a third side shot at ${lostExtensions} station sides`],
  ])
  if (missing) notes.push(missing)
  notes.push('Polycorder files carry no coordinates: the start must be entered again when the file is read.')
  return { records, ...(file ? { layout: file.layout } : {}), notes }
}

// ─── Unit survey (.pol) and Laser Technology raw ─────────────────────────────────────────────

export type UnitSurveyKind = 'SR' | 'FS' | 'BS' | 'SD'
export interface UnitSurveyRecord {
  survey: string
  kind: UnitSurveyKind
  /** SR: the start's X, Y, Z. */
  x?: number | null
  y?: number | null
  z?: number | null
  from?: string
  to?: string
  /** Decimal degrees; the text keeps D:M:S as written. */
  azimuth?: number | null
  azimuthText?: string
  vertical?: number | null
  verticalText?: string
  distance?: number | null
  hi?: number | null
  ht?: number | null
  /** Code of the to-point (SR: of the start), at most 15 characters. */
  code: string
  /** Every field as written. */
  fields?: string[]
}
export type UnitSurveyVertical = 'inclination' | 'zenith' | 'slope-percent' | 'elevation' | 'elevation-difference'
export type UnitSurveyDistance = 'horizontal' | 'slope'

const DMS = /^([+-]?)(\d+):(\d+)(?::(\d+(?:\.\d*)?))?$/
/** An angle as decimal degrees or D:M:S; null when blank, undefined when neither. */
export function parseAngle(text: string | undefined): number | null | undefined {
  const s = (text ?? '').trim()
  if (!s) return null
  const m = DMS.exec(s)
  if (m) {
    const v = Number(m[2]) + Number(m[3]) / 60 + Number(m[4] ?? 0) / 3600
    return m[1] === '-' ? -v : v
  }
  return asciiNumber(s)
}
/** D:M:S with whole seconds unless `secondsDecimals` is given. */
export function formatDms(degrees: number, secondsDecimals = 0): string {
  const sign = degrees < 0 ? '-' : ''
  let total = Math.round(Math.abs(degrees) * 3600 * 10 ** secondsDecimals) / 10 ** secondsDecimals
  const d = Math.floor(total / 3600)
  total -= d * 3600
  const m = Math.floor(total / 60)
  const s = total - m * 60
  return `${sign}${d}:${String(m).padStart(2, '0')}:${s.toFixed(secondsDecimals).padStart(secondsDecimals ? 3 + secondsDecimals : 2, '0')}`
}

const UNIT_KINDS = new Set(['SR', 'FS', 'BS', 'SD'])

/** Whether a text file is a unit survey: `name,SR|FS|BS|SD,…` records. */
export function isUnitSurvey(text: string): boolean {
  const lines = text
    .slice(0, 16_000)
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim())
    .slice(0, 12)
  if (text.length > 16_000) lines.pop()
  return (
    lines.length > 0 &&
    lines.every((l) => {
      const f = l.split(',').map((s) => s.trim())
      if (!UNIT_KINDS.has(f[1]?.toUpperCase())) return false
      if (f[1].toUpperCase() === 'SR')
        return f.length >= 5 && f.length <= 6 && [2, 3, 4].every((k) => typeof asciiNumber(f[k]) === 'number')
      return f.length >= 4 && f.length <= 10 && parseAngle(f[4]) !== undefined
    })
  )
}

export function parseUnitSurvey(text: string): {
  records: UnitSurveyRecord[]
  surveys: string[]
  layout: TextLayout
  unitM: null
  epsg: null
} {
  const lines = asciiLines(text).filter((l) => l.trim())
  if (lines.length > MAX_TRAVERSE_RECORDS)
    throw Error(`The survey has over ${MAX_TRAVERSE_RECORDS.toLocaleString('en-CA')} records.`)
  const records = lines.map((line, i): UnitSurveyRecord => {
    const fields = line.split(',')
    const f = fields.map((s) => s.trim())
    const kind = f[1]?.toUpperCase() as UnitSurveyKind
    if (!UNIT_KINDS.has(kind)) throw Error(`Line ${i + 1} is not an SR, FS, BS or SD record.`)
    const num = (k: number) => {
      const v = asciiNumber(f[k])
      if (v === undefined) throw Error(`Line ${i + 1}: field ${k + 1} is not a number.`)
      return v
    }
    if (kind === 'SR') return { survey: f[0], kind, x: num(2), y: num(3), z: num(4), code: f[5] ?? '', fields }
    const az = parseAngle(f[4]),
      v = parseAngle(f[5])
    if (az === undefined || v === undefined)
      throw Error(`Line ${i + 1}: an angle is neither decimal degrees nor D:M:S.`)
    return {
      survey: f[0],
      kind,
      from: f[2] ?? '',
      to: f[3] ?? '',
      azimuth: az,
      azimuthText: f[4] ?? '',
      vertical: v,
      verticalText: f[5] ?? '',
      distance: num(6),
      hi: num(7),
      ht: num(8),
      code: f[9] ?? '',
      fields,
    }
  })
  if (!records.length) throw Error('The survey has no records.')
  return {
    records,
    surveys: [...new Set(records.map((r) => r.survey))],
    layout: textLayout(text),
    unitM: null,
    epsg: null,
  }
}

/**
 * Writes unit-survey records. A record that keeps its `fields` writes each one as it was while its
 * value is unchanged (an angle keeps D:M:S when it was written so); `angles` sets how new angles
 * are written, by default as the field they replace was, else decimal degrees.
 */
export function writeUnitSurvey(
  records: readonly UnitSurveyRecord[],
  options: {
    decimals?: number
    angles?: 'decimal' | 'dms' | 'as-read'
    lineEnd?: '\r\n' | '\n'
    layout?: TextLayout
  } = {},
): string {
  const dec = options.decimals ?? 3
  const clean = (s: string) => s.replace(/,/g, ';').replace(/[\r\n]+/g, ' ')
  // A new angle in a file read with D:M:S azimuths is written as they are.
  const fileDms =
    options.angles === undefined ? records.map((r) => r.fields?.[4]?.trim() ?? '').find((t) => DMS.test(t)) : undefined
  const angle = (raw: string | undefined, v: number | null | undefined, text: string | undefined, isAngle: boolean) => {
    for (const written of [raw, text]) {
      if (written === undefined) continue
      const read = parseAngle(written)
      if (read !== undefined && sameValue(read, v ?? null)) return written
    }
    if (v === null || v === undefined) return ''
    const like = raw !== undefined && DMS.test(raw.trim()) ? raw.trim() : fileDms
    const dms = options.angles === 'dms' || (options.angles !== 'decimal' && like !== undefined)
    if (isAngle && dms) {
      const seconds = (like ?? '').split(':')[2]?.split('.')[1]?.length ?? 0
      return formatDms(v, seconds)
    }
    return asciiFixed(v, Math.max(dec, 4))
  }
  return joinLines(
    records.map((r) => {
      const raw = r.fields
      const n = (k: number, v: number | null | undefined) => numberText(raw?.[k], v ?? null, dec)
      const text = (k: number, v: string, max: number) => {
        const cut = clean(v).slice(0, max)
        return raw?.[k] !== undefined && raw[k].trim() === v ? raw[k] : cut
      }
      const f =
        r.kind === 'SR'
          ? [text(0, r.survey, 8), raw?.[1] ?? 'SR', n(2, r.x), n(3, r.y), n(4, r.z), text(5, r.code, 15)]
          : [
              text(0, r.survey, 8),
              raw?.[1] !== undefined && raw[1].trim().toUpperCase() === r.kind ? raw[1] : r.kind,
              text(2, r.from ?? '', 100),
              text(3, r.to ?? '', 100),
              angle(raw?.[4], r.azimuth, r.azimuthText, true),
              angle(raw?.[5], r.vertical, r.verticalText, false),
              n(6, r.distance),
              n(7, r.hi),
              n(8, r.ht),
              text(9, r.code, 15),
            ]
      // A record written short (no code, an SR without one) stays short while the rest is blank.
      const keep = raw ? raw.length : f.length
      while (f.length > keep && f[f.length - 1] === '') f.pop()
      return f.join(',')
    }),
    { ...DEFAULT_LAYOUT, ...options.layout, ...(options.lineEnd ? { lineEnd: options.lineEnd } : {}) },
  )
}

export interface LaserRawRecord {
  /** The field after `UD` (1 in the help's example). */
  group: number
  sequence: number
  kind: 'FS' | 'SD'
  from: string
  to: string
  azimuth: number | null
  inclination: number | null
  slopeDistance: number | null
  /** The distance unit letter as written (`F`, `M`), '' when the record has no measurement. */
  unit: string
}

const nmeaChecksum = (body: string) => {
  let c = 0
  for (let i = 0; i < body.length; i++) c ^= body.charCodeAt(i)
  return c.toString(16).toUpperCase().padStart(2, '0')
}

/** Whether a text file is a Laser Technology raw unit survey (`$PLTIT,UD,` sentences). */
export function isLaserRawSurvey(text: string): boolean {
  return /^\s*\$PLTIT,UD,/.test(text.slice(0, 200).replace(/^\uFEFF/, ''))
}

/** Reads `$PLTIT,UD` sentences (one or several a line). A wrong checksum is refused. */
export function parseLaserRawSurvey(text: string): { records: LaserRawRecord[]; unitM: number | null; epsg: null } {
  if (text.length > 50_000_000) throw Error('The raw survey is over 50 MB.')
  const sentences = text.match(/\$[^$\r\n]*/g) ?? []
  if (sentences.length > MAX_TRAVERSE_RECORDS)
    throw Error(`The survey has over ${MAX_TRAVERSE_RECORDS.toLocaleString('en-CA')} shots.`)
  const records = sentences.map((raw, i): LaserRawRecord => {
    const s = raw.trim()
    const star = s.lastIndexOf('*')
    if (star < 0) throw Error(`Sentence ${i + 1} has no checksum.`)
    const body = s.slice(1, star)
    if (nmeaChecksum(body) !== s.slice(star + 1).toUpperCase()) throw Error(`Sentence ${i + 1} fails its checksum.`)
    const f = body.split(',')
    if (f[0] !== 'PLTIT' || f[1] !== 'UD' || f.length !== 13 || (f[4] !== 'FS' && f[4] !== 'SD'))
      throw Error(`Sentence ${i + 1} is not a $PLTIT,UD foresight or side shot.`)
    const num = (k: number) => {
      const v = asciiNumber(f[k])
      if (v === undefined) throw Error(`Sentence ${i + 1}: field ${k + 1} is not a number.`)
      return v
    }
    return {
      group: num(2) ?? 0,
      sequence: num(3) ?? 0,
      kind: f[4],
      from: f[5],
      to: f[6],
      azimuth: num(7),
      inclination: num(9),
      slopeDistance: num(11),
      unit: f[12],
    }
  })
  if (!records.length) throw Error('The file has no $PLTIT,UD sentences.')
  const units = new Set(records.map((r) => r.unit).filter(Boolean))
  const unitM = units.size === 1 ? (({ F: 0.3048, M: 1 } as Record<string, number>)[[...units][0]] ?? null) : null
  return { records, unitM, epsg: null }
}

export function writeLaserRawSurvey(
  records: readonly LaserRawRecord[],
  options: { lineEnd?: '\r\n' | '\n' } = {},
): string {
  const eol = options.lineEnd ?? '\r\n'
  return (
    records
      .map((r) => {
        const measured = r.azimuth !== null || r.inclination !== null || r.slopeDistance !== null
        const body = [
          'PLTIT',
          'UD',
          String(r.group),
          String(r.sequence),
          r.kind,
          r.from,
          r.to,
          measured ? asciiFixed(r.azimuth, 1) : '',
          measured ? 'D' : '',
          measured ? asciiFixed(r.inclination, 2) : '',
          measured ? 'D' : '',
          measured ? asciiFixed(r.slopeDistance, 1) : '',
          measured ? r.unit : '',
        ].join(',')
        return `$${body}*${nmeaChecksum(body)}`
      })
      .join(eol) + eol
  )
}

/** Raw shots as unit-survey records (inclination, slope distance), for the same reduction. */
export function laserRawAsUnitSurvey(records: readonly LaserRawRecord[]): UnitSurveyRecord[] {
  return records.map((r) => ({
    survey: String(r.group),
    kind: r.kind,
    from: r.from,
    to: r.to,
    azimuth: r.azimuth,
    vertical: r.inclination,
    distance: r.slopeDistance,
    hi: null,
    ht: null,
    code: '',
  }))
}

export interface UnitSurveyReadOptions extends SoftreeTraverseReadOptions {
  vertical: UnitSurveyVertical
  distance: UnitSurveyDistance
  /** The survey (traverse) to read when the file holds several; the first by default. */
  survey?: string
  /** How the file's lines end, kept for writing it back. */
  layout?: TextLayout
}

/** A unit survey's main line as a field book; other shots are located points. */
export function unitSurveyToTraverse(
  records: readonly UnitSurveyRecord[],
  options: UnitSurveyReadOptions,
): SoftreeTraverseImport {
  const { unitM, vertical, distance } = options
  if (!(unitM > 0)) throw Error('State the survey’s units: the file does not.')
  const notes: string[] = []
  const surveys = [...new Set(records.map((r) => r.survey))]
  const name = options.survey ?? surveys[0]
  if (surveys.length > 1) notes.push(`The file holds ${surveys.length} surveys; ${name} was read.`)
  const own = records.filter((r) => r.survey === name)
  const sr = own.find((r) => r.kind === 'SR')
  const firstFs = own.find((r) => r.kind === 'FS' && r.azimuth !== null && r.distance !== null)
  if (!firstFs) throw Error(`Survey ${name} has no measured foreshot.`)
  const startId = firstFs.from!
  let start: XYZ
  if (sr && sr.x != null && sr.y != null && sr.z != null) start = [sr.x * unitM, sr.y * unitM, sr.z * unitM]
  else if (options.start) start = options.start
  else
    throw new SoftreeTraverseStartQuestion(
      `Survey ${name} has no start reference; enter the easting, northing and elevation of point ${startId}.`,
    )

  // Each shot as (az, h, dz) from its from-point; elevation shots resolve once the from-point's level is known.
  type Shot = { r: UnitSurveyRecord; az: number; h: number; dz: number | null; z: number | null }
  const shotOf = (r: UnitSurveyRecord): Shot | null => {
    if (r.azimuth == null || r.distance == null) return null
    const d = r.distance
    const v = r.vertical ?? null
    const hiHt = (r.hi ?? 0) - (r.ht ?? 0)
    let h: number,
      dz: number | null = null,
      z: number | null = null
    if (vertical === 'elevation') {
      if (v === null) return null
      z = v
      h = d // a slope distance needs the rise: resolved below
    } else if (vertical === 'elevation-difference') {
      if (v === null) return null
      dz = v + hiHt
      h = distance === 'slope' ? Math.sqrt(Math.max(0, d * d - v * v)) : d
    } else {
      const incl = vertical === 'inclination' ? (v ?? 0) : vertical === 'zenith' ? 90 - (v ?? 90) : null
      if (incl !== null) {
        h = distance === 'slope' ? d * Math.cos(incl * RAD) : d
        dz = (distance === 'slope' ? d * Math.sin(incl * RAD) : d * Math.tan(incl * RAD)) + hiHt
      } else {
        const s = (v ?? 0) / 100
        h = distance === 'slope' ? d / Math.sqrt(1 + s * s) : d
        dz = h * s + hiHt
      }
    }
    return { r, az: norm360(r.azimuth), h, dz, z }
  }
  const resolve = (s: Shot, fromZ: number): { h: number; dz: number } => {
    if (s.z === null) return { h: s.h, dz: s.dz! }
    const dz = s.z - fromZ
    return { h: distance === 'slope' ? Math.sqrt(Math.max(0, s.h * s.h - dz * dz)) : s.h, dz }
  }

  // Legs: foreshots and reversed backshots, grouped by point pair.
  const legShots = new Map<string, Array<{ shot: Shot; reversed: boolean }>>()
  const legKey = (a: string, b: string) => `${a}\u0000${b}`
  let backshots = 0
  for (const r of own) {
    if (r.kind !== 'FS' && r.kind !== 'BS') continue
    const shot = shotOf(r)
    if (!shot) continue
    if (r.kind === 'BS') backshots++
    const fwd = r.kind === 'FS'
    const key = fwd ? legKey(r.from!, r.to!) : legKey(r.to!, r.from!)
    const list = legShots.get(key) ?? []
    list.push({ shot, reversed: !fwd })
    legShots.set(key, list)
  }
  const visited = [startId]
  const zAt = new Map<string, number>([[startId, start[2] / unitM]])
  const legs: TraverseLeg[] = []
  let spread = 0
  const order = own.filter((r) => r.kind === 'FS').map((r) => r.to!)
  for (;;) {
    const here = visited[visited.length - 1]
    const next = order.find((to) => !visited.includes(to) && legShots.has(legKey(here, to)))
    if (next === undefined) break
    const list = legShots.get(legKey(here, next))!
    let sx = 0,
      sy = 0,
      sh = 0,
      sdz = 0,
      measured = 0
    const fromZ = zAt.get(here)!
    for (const { shot, reversed } of list) {
      const az = reversed ? shot.az + 180 : shot.az
      sx += Math.sin(az * RAD)
      sy += Math.cos(az * RAD)
      // A backshot to an elevation reads the level of this point, which says nothing of the next.
      if (reversed && shot.z !== null) continue
      const m = reversed ? { h: shot.h, dz: shot.dz! } : resolve(shot, fromZ)
      sh += m.h
      sdz += reversed ? -m.dz : m.dz
      measured++
    }
    const az = norm360(Math.atan2(sx, sy) / RAD)
    for (const { shot, reversed } of list) {
      const a = norm360((reversed ? shot.az + 180 : shot.az) - az)
      spread = Math.max(spread, Math.min(a, 360 - a))
    }
    if (!measured) throw Error(`The leg from ${here} to ${next} has no foreshot with a distance.`)
    const h = sh / measured,
      dz = sdz / measured
    if (!(h > 0)) throw Error(`The leg from ${here} to ${next} has no horizontal distance.`)
    zAt.set(next, fromZ + dz)
    legs.push({ id: next, bearingDegrees: az, horizontalDistanceM: h * unitM, gradePercent: (dz / h) * 100 })
    visited.push(next)
  }
  if (!legs.length) throw Error(`Survey ${name} has no foreshot leading on from point ${startId}.`)
  if (backshots) notes.push(`${backshots} backshots were averaged with their foreshots.`)
  if (spread > 0.5)
    notes.push(`Shots of the same leg disagree by up to ${spread.toFixed(1)}° in azimuth; they were averaged.`)
  const offMain = own.filter(
    (r) => r.kind === 'FS' && (!visited.includes(r.to!) || !visited.includes(r.from!)) && r.azimuth != null,
  )
  const codes = new Map(own.filter((r) => r.kind !== 'SR' && r.code).map((r) => [r.to!, r.code]))
  const ids = visited.map((p) => (options.ids === 'label' && codes.get(p) ? codes.get(p)!.slice(0, 100) : p))
  const input: TraverseInput = { start, adjustment: 'none', legs: legs.map((l, i) => ({ ...l, id: ids[i + 1] })) }
  const reduced = reduceTraverse(input)

  // Side shots and other shots from main-line points.
  const sideShots: NonNullable<TraverseInput['sideShots']> = []
  const points: SoftreeTraverseImport['points'] = []
  const sideRecords = new Map<UnitSurveyRecord, number>()
  let unplaced = 0
  for (const r of own) {
    if (r.kind !== 'SD' && !offMain.includes(r)) continue
    const station = visited.indexOf(r.from!)
    const shot = shotOf(r)
    if (station < 0 || !shot) {
      unplaced++
      continue
    }
    const m = resolve(shot, zAt.get(r.from!)!)
    const legBearing = input.legs[Math.min(station, input.legs.length - 1)].bearingDegrees
    const rel = norm360(shot.az - legBearing)
    const square = Math.min(Math.abs(rel - 90), Math.abs(rel - 270))
    const id = (options.ids === 'label' && r.code) || r.to || ''
    if (r.kind === 'SD' && square <= SIDE_SHOT_SQUARE_DEG && m.h > 0) {
      const across = m.h * Math.sin(rel * RAD)
      sideShots.push({ id, station, offsetM: across * unitM, heightDifferenceM: m.dz * unitM })
      sideRecords.set(r, station)
    } else {
      const at = reduced.stations[station].raw
      points.push({
        id,
        from: ids[station],
        station,
        coordinate: [
          at[0] + Math.sin(shot.az * RAD) * m.h * unitM,
          at[1] + Math.cos(shot.az * RAD) * m.h * unitM,
          at[2] + m.dz * unitM,
        ],
      })
    }
  }
  if (sideShots.length) input.sideShots = sideShots
  reduceTraverse(input)
  if (points.length)
    notes.push(`${points.length} shots are not square to the line or off the main line; they are located points.`)
  if (unplaced)
    notes.push(`${unplaced} shots have no measurement or start from a point off the main line; they were left out.`)

  // Each station's label (its code) and its foreshot's HI/HT, and the records carrying them.
  const index = new Map(records.map((r, i) => [r, i]))
  const labelRecords = visited.map((p, k) => {
    let at = -1
    if (k === 0 && sr) at = index.get(sr)!
    for (const r of own) if (r.kind !== 'SR' && r.to === p && r.code) at = index.get(r)!
    if (at < 0 && k > 0) {
      const fs = own.find((r) => r.kind === 'FS' && r.from === visited[k - 1] && r.to === p)
      if (fs) at = index.get(fs)!
    }
    return at
  })
  const heightRecords = visited.map((p, k) => {
    const fs = own.find((r) => r.kind === 'FS' && r.from === p && r.to === visited[k + 1])
    return fs ? index.get(fs)! : -1
  })
  const extras: SoftreeStationExtras[] = visited.flatMap((_, k) => {
    const extra: SoftreeStationExtras = { station: k }
    const label = labelRecords[k] >= 0 ? records[labelRecords[k]].code : ''
    if (label) extra.label = label
    const fs = heightRecords[k] >= 0 ? records[heightRecords[k]] : null
    if (fs && ((fs.hi ?? 0) !== 0 || (fs.ht ?? 0) !== 0)) {
      extra.hi = fs.hi ?? null
      extra.ht = fs.ht ?? null
    }
    return Object.keys(extra).length > 1 ? [extra] : []
  })
  const legOf = (r: UnitSurveyRecord) => {
    if (r.kind !== 'FS' && r.kind !== 'BS') return -1
    const [a, b] = r.kind === 'FS' ? [r.from, r.to] : [r.to, r.from]
    const k = visited.indexOf(a!)
    return k >= 0 && visited[k + 1] === b ? k : -1
  }
  const canKeep = records.every((r) => r.fields)
  const source: SoftreeTraverseSource | undefined = canKeep
    ? {
        format: 'unit-survey',
        layout: options.layout ?? DEFAULT_LAYOUT,
        head: [],
        records: records.map((r): SoftreeSourceRecord => {
          const line = r.fields!.join(',')
          if (r.survey !== name) return { line, role: 'other' }
          if (r === sr) return { line, station: 0, role: 'start' }
          const leg = legOf(r)
          if (leg >= 0) return { line, station: leg, role: 'leg' }
          const side = sideRecords.get(r)
          if (side !== undefined) return { line, station: side, role: 'side' }
          return { line, role: 'shot' }
        }),
        input: structuredClone(input),
        startStation: 0,
        equations: [],
        vertical,
        distance,
        survey: name,
        pointNames: [...visited],
        labelRecords,
        heightRecords,
      }
    : undefined
  return {
    input,
    startStation: 0,
    equations: [],
    stationIds: ids,
    extras,
    points,
    ...(source ? { source } : {}),
    fileCheck: null,
    notes,
  }
}

/** A unit survey's vertical reading and distance for a shot of horizontal `h` and rise `dz` (file units). */
function unitSurveyReading(
  vertical: UnitSurveyVertical,
  distance: UnitSurveyDistance,
  h: number,
  dz: number,
  targetZ: number,
): { vertical: number; distance: number } {
  const d = distance === 'slope' ? Math.hypot(h, dz) : h
  const v =
    vertical === 'slope-percent'
      ? (dz / h) * 100
      : vertical === 'elevation-difference'
        ? dz
        : vertical === 'inclination'
          ? Math.atan2(dz, h) / RAD
          : vertical === 'zenith'
            ? 90 - Math.atan2(dz, h) / RAD
            : targetZ
  return { vertical: v, distance: d }
}

/** The kept unit survey with the field book's changes, or null when its main line changed shape. */
function patchUnitSurvey(
  input: TraverseInput,
  details: SoftreeTraverseDetails,
  source: SoftreeTraverseSource,
  unitM: number,
): UnitSurveyRecord[] | null {
  const was = source.input
  const names = source.pointNames ?? []
  if (
    names.length !== input.legs.length + 1 ||
    input.legs.length !== was.legs.length ||
    input.legs.some((l, i) => l.id !== was.legs[i].id)
  )
    return null
  const file = parseUnitSurvey(joinLines(source.records.map((r) => r.line)))
  if (file.records.length !== source.records.length) return null
  const match = matchSource(input, source, 0, [])
  const reduced = reduceTraverse(input)
  const vertical = source.vertical ?? 'slope-percent',
    distance = source.distance ?? 'horizontal'
  const extras = extrasByStation(details)
  const zAt = (station: number) => reduced.stations[station].raw[2] / unitM
  const labelOf = new Map((source.labelRecords ?? []).flatMap((idx, st) => (idx >= 0 ? [[idx, st] as const] : [])))
  const heightsOf = new Map((source.heightRecords ?? []).flatMap((idx, st) => (idx >= 0 ? [[idx, st] as const] : [])))
  const names_ = new Set(file.records.flatMap((r) => [r.from ?? '', r.to ?? '']))
  const unique = (id: string) => {
    let name = id.replace(/,/g, ';') || 'SS'
    for (let n = 2; names_.has(name); n++) name = `${id}-${n}`
    names_.add(name)
    return name
  }
  const shotsSame = (st: number) => match.shots(st, 'left') && match.shots(st, 'right')
  const freshSides = (st: number): UnitSurveyRecord[] => {
    // The side shots replaced free their point names for the ones written in their place.
    source.records.forEach((r, idx) => {
      if (r.role === 'side' && r.station === st) names_.delete(file.records[idx].to ?? '')
    })
    const leg = input.legs[Math.min(st, input.legs.length - 1)]
    return (input.sideShots ?? [])
      .filter((s) => s.station === st && s.offsetM !== 0)
      .map((s) => {
        const h = Math.abs(s.offsetM) / unitM,
          dz = s.heightDifferenceM / unitM
        return {
          survey: source.survey ?? file.records[0].survey,
          kind: 'SD' as const,
          from: names[st],
          to: unique(s.id),
          azimuth: norm360(leg.bearingDegrees + (s.offsetM > 0 ? 90 : -90)),
          ...unitSurveyReading(vertical, distance, h, dz, zAt(st) + dz),
          hi: 0,
          ht: 0,
          code: '',
        }
      })
  }
  const replaced = new Set<number>()
  const out: UnitSurveyRecord[] = []
  file.records.forEach((read, idx) => {
    const role = source.records[idx]
    const r: UnitSurveyRecord = { ...read }
    if (role.role === 'start' && !match.upstream[0]) {
      r.x = input.start[0] / unitM
      r.y = input.start[1] / unitM
      r.z = input.start[2] / unitM
    }
    const labelled = labelOf.get(idx)
    if (labelled !== undefined) r.code = extras.get(labelled)?.label ?? ''
    if (role.role === 'leg' && role.station !== undefined) {
      const st = role.station
      const leg = input.legs[st]
      const fwd = r.kind === 'FS'
      if (heightsOf.get(idx) === st) {
        const e = extras.get(st)
        r.hi = e && 'hi' in e ? (e.hi ?? null) : read.hi === null ? null : 0
        r.ht = e && 'ht' in e ? (e.ht ?? null) : read.ht === null ? null : 0
      }
      const changed =
        !match.leg[st] ||
        !sameValue(r.hi, read.hi) ||
        !sameValue(r.ht, read.ht) ||
        (vertical === 'elevation' && !match.upstream[st])
      if (changed && leg) {
        const h = leg.horizontalDistanceM / unitM,
          rise = (h * leg.gradePercent) / 100
        const az = norm360(leg.bearingDegrees + (fwd ? 0 : 180))
        r.azimuth = read.azimuth != null && angleSame(read.azimuth, az) ? read.azimuth : az
        const dz = fwd ? rise : -rise
        const measured = vertical === 'elevation' ? dz : dz - ((r.hi ?? 0) - (r.ht ?? 0))
        const reading = unitSurveyReading(vertical, distance, h, measured, zAt(fwd ? st + 1 : st))
        r.vertical = reading.vertical
        r.distance = reading.distance
      }
    }
    if (role.role === 'side' && role.station !== undefined && !shotsSame(role.station)) {
      // Side shots edited since the read are written afresh in place of the first one read.
      if (!replaced.has(role.station)) out.push(...freshSides(role.station))
      replaced.add(role.station)
      return
    }
    out.push(r)
  })
  // Stations that gained side shots where the file had none.
  for (let st = 0; st < names.length; st++) if (!replaced.has(st) && !shotsSame(st)) out.push(...freshSides(st))
  return out
}

/** A field book as unit-survey records: point 1 is the start, legs 1→2→…, side shots after. */
export function traverseToUnitSurvey(
  input: TraverseInput,
  options: {
    unitM: number
    survey?: string
    vertical?: Exclude<UnitSurveyVertical, 'elevation'>
    labels?: boolean
    details?: SoftreeTraverseDetails
  },
): {
  records: UnitSurveyRecord[]
  layout?: TextLayout
  vertical: UnitSurveyVertical
  distance: UnitSurveyDistance
  notes: string[]
} {
  const { unitM, details } = options
  if (!(unitM > 0)) throw Error('Give the file unit in metres.')
  const reduced = reduceTraverse(input)
  const notes: string[] = []
  const source = usableSource(details, 'unit-survey', unitM)
  if (source) {
    const records = patchUnitSurvey(input, details!, source, unitM)
    const vertical = source.vertical ?? 'slope-percent',
      distance = source.distance ?? 'horizontal'
    if (records) {
      if (input.target)
        notes.push('The closing coordinate and adjustment are not part of the format and were not written.')
      const missing = notCarried('unit-survey', details)
      if (missing) notes.push(missing)
      notes.push(
        `Read it back with the vertical as ${vertical.replace('-', ' ')} and ${distance} distances, as it was read: the file does not say.`,
      )
      return { records, layout: source.layout, vertical, distance, notes }
    }
    notes.push(
      'The main line changed in number or names of points since the survey was read, so it was written afresh.',
    )
  }
  const vertical = options.vertical ?? 'slope-percent'
  const k = details ? details.unitM / unitM : 1
  const len = (v: number | null | undefined) => (v === null || v === undefined ? null : v * k)
  const extras = extrasByStation(details)
  const survey = (options.survey ?? 'PGMAPS').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8) || 'PGMAPS'
  const v = (h: number, dz: number) => unitSurveyReading(vertical, 'horizontal', h, dz, 0).vertical
  let cut = 0
  const code = (id: string) => {
    if (id.length > 15) cut++
    return id.slice(0, 15)
  }
  const records: UnitSurveyRecord[] = [
    {
      survey,
      kind: 'SR',
      x: input.start[0] / unitM,
      y: input.start[1] / unitM,
      z: input.start[2] / unitM,
      code: code(extras.get(0)?.label ?? ''),
    },
  ]
  input.legs.forEach((leg, i) => {
    const h = leg.horizontalDistanceM / unitM
    const e = extras.get(i)
    const hi = len(e?.hi) ?? 0,
      ht = len(e?.ht) ?? 0
    records.push({
      survey,
      kind: 'FS',
      from: String(i + 1),
      to: String(i + 2),
      azimuth: leg.bearingDegrees,
      vertical: v(h, (h * leg.gradePercent) / 100 - (hi - ht)),
      distance: h,
      hi,
      ht,
      code: code(extras.get(i + 1)?.label ?? ((options.labels ?? !details) ? leg.id : '')),
    })
  })
  let next = input.legs.length + 2,
    skipped = 0,
    lostPoints = 0
  for (const s of input.sideShots ?? []) {
    if (s.offsetM === 0) {
      skipped++
      continue
    }
    const bearing = input.legs[Math.min(s.station, input.legs.length - 1)].bearingDegrees
    const h = Math.abs(s.offsetM) / unitM
    records.push({
      survey,
      kind: 'SD',
      from: String(s.station + 1),
      to: String(next++),
      azimuth: norm360(bearing + (s.offsetM > 0 ? 90 : -90)),
      vertical: v(h, s.heightDifferenceM / unitM),
      distance: h,
      hi: 0,
      ht: 0,
      code: code((options.labels ?? !details) ? s.id : ''),
    })
  }
  // Located points, as side shots from the station they were taken at, named by their own name.
  const stationNames = ['', ...input.legs.map((l) => l.id)]
  const used = new Set(records.flatMap((r) => [r.from ?? '', r.to ?? '']))
  const pointName = (id: string) => {
    const clean = id.replace(/,/g, ';').slice(0, 100)
    if (clean && !/^\d+$/.test(clean) && !used.has(clean)) {
      used.add(clean)
      return clean
    }
    return String(next++)
  }
  for (const p of details?.points ?? []) {
    const station = p.station ?? stationNames.indexOf(p.from)
    if (!(station >= 0 && station < reduced.stations.length)) {
      lostPoints++
      continue
    }
    const d = p.coordinate.map((c, q) => c - reduced.stations[station].raw[q])
    const h = Math.hypot(d[0], d[1]) / unitM
    if (!(h > 1e-6)) {
      lostPoints++
      continue
    }
    records.push({
      survey,
      kind: 'SD',
      from: String(station + 1),
      to: pointName(p.id),
      azimuth: norm360(Math.atan2(d[0], d[1]) / RAD),
      vertical: v(h, d[2] / unitM),
      distance: h,
      hi: 0,
      ht: 0,
      code: code(p.id),
    })
  }
  if (cut) notes.push(`${cut} names were cut to the format's 15 characters.`)
  if (skipped) notes.push(`${skipped} side shots on the line were left out.`)
  if (lostPoints) notes.push(`${lostPoints} located points not placed from a field-book station were left out.`)
  if (input.target) notes.push('The closing coordinate and adjustment are not part of the format and were not written.')
  const missing = notCarried('unit-survey', details)
  if (missing) notes.push(missing)
  notes.push(
    `Read it back with the vertical as ${vertical.replace('-', ' ')} and horizontal distances: the file does not say.`,
  )
  return { records, vertical, distance: 'horizontal', notes }
}
