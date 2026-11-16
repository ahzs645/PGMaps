/**
 * Softree RoadEng / Location design files (`.dsnx`) brought in as roads.
 *
 * A `.dsnx` is a ZIP of one set of files per alignment (`Location1.*`, `Location2.*`, …). The road
 * is read from two of them:
 *
 * - `LocationN.dsn`, INI text: `[Software] Version2`, `[design] units` (metres per project unit
 *   × 10,000: 10000 is metres, 3048 feet) and `[design] surface`, the terrain file it designs on;
 * - `LocationN.ds2`, comma-separated records. `108` is a horizontal intersection point with a curve
 *   (index, curve type, signed radius with negative turning left, X, Y, and the curve's design
 *   fields 8–18, {@link RoadEngCurveFields}); `109` is a vertical one (index, type, signed
 *   vertical-curve radius with negative a crest, station, elevation, …); `110` is a calculated
 *   station: field 1 RoadEng's "Pt. Type" bits (1 profile point, 2 plan point, 4 report station),
 *   X, Y, Z, station, field 9 = 2 at the end of a horizontal curve (EC), field 10 = 4 at the end of
 *   a vertical one (EVC), field 11 the report-point bits of `[ReportPointProperties]`
 *   ({@link stationEvents}). The first and last `110` records are the alignment's ends.
 *
 * Where a design has `109` records, its profile runs from the first `110` record's level through
 * them to the last one's, each vertical curve as long as its radius times its change of grade; `110`
 * levels are then design levels. Without them `110` levels are ground and the road gets no profile.
 *
 * The layout was read from Softree's published sample projects (RoadEng 8, 9 and 11), not from a
 * specification, so every design is checked as it is read: the plan is rebuilt from its PIs as
 * tangents, circular curves and clothoids and set against every `110` station, and the profile
 * against every `110` level. In order, the plan is rebuilt from
 *
 * 1. the `108` records, a record whose curve type is not 2 and that states transition lengths
 *    (fields 12 and 13) as a spiral curve of those lengths (inferred: no sample has a spiral; Softree
 *    documents that a spiral's transition length is its spiral length), else as a circular curve;
 * 2. the same with every curve circular;
 * 3. either of them with angle points added at the design's plan stations (Pt. Type 2) that are
 *    not a curve's own: RoadEng writes no `108` for a bend without a curve (the cul-de-sac
 *    sample's main road), so its plan stations are those bends.
 *
 * The first that rebuilds every station within {@link ROADENG_PLAN_TOLERANCE_M} is used. Where none
 * does (an alignment whose PIs are kept in a part this does not read), the road follows the
 * design's own stations instead: the plan fitted with tangents and curves within
 * {@link ROADENG_FIT_DEVIATION_M}, the profile the stations' levels thinned to within
 * {@link ROADENG_PROFILE_TOLERANCE_M}. The import notice says which, with the measured figures; a
 * design is never refused on them.
 *
 * What the road model does not hold is kept, not read: each alignment's {@link RoadEngSource} holds
 * the `.dsn` text, the `.ds1` and `.ds3` bytes and the `.ds2` records of every type besides
 * 108/109/110 (the `100` header, `104` ground types, `118`, any unknown type), so that
 * `roadEngExport.ts` can write them back unchanged. Templates and ranges are read by
 * `roadEngDesignSettings.ts`; the binary parts and the `.terx` terrain are not read here.
 *
 * Pure: no DOM or network access.
 */
import { keptStationing, parseRoadStationing, scaleStationing, type RoadStationing } from './roadStationing'
import { strFromU8, unzipSync } from 'fflate'
import { ROADENG_UNITS, ROADENG_UNITS_READ } from './roadEngUnits'
import {
  alignmentCrs,
  gridAlignmentRoad,
  gridToLonLat,
  placedAlignmentRoad,
  type GridAlignment,
  type XY,
} from './landXmlImport'
import { fitPolylineAlignment, MAX_FIT_SOURCE_POINTS } from './polylineFit'
import type { Alignment, Coordinate, RoadTemplate } from './types'
import { createEngineeringDesign, type Culvert } from './engineeringTypes'
import { culvertsFromDesign } from './roadEngPlacedCulverts'
import { parseRoadEngPLineSource, roadEngPLineChars, type RoadEngPLineSource } from './roadEngPLine'

export const MAX_ROADENG_BYTES = 50_000_000
/** Uncompressed size allowed for one part (`.dsn`, `.ds1`, `.ds2`, `.ds3`) inside the archive. */
export const MAX_ROADENG_ENTRY_BYTES = 100_000_000
export const MAX_ROADENG_ALIGNMENTS = 50
/** A road takes at most 2,000 horizontal points (the engine's limit), its two ends among them. */
export const MAX_ROADENG_PIS = 1998
/** A road takes at most 500 vertical points (the engine's limit), its two ends among them. */
export const MAX_ROADENG_VIPS = 498
/** A rebuilt station further than this from the design's own `110` record is reported outside. */
export const ROADENG_PLAN_TOLERANCE_M = 0.01
/** A rebuilt design level further than this from the `110` level is reported outside. */
export const ROADENG_PROFILE_TOLERANCE_M = 0.01
/** Deviation allowed when a plan that does not rebuild is fitted to the design's own stations. */
export const ROADENG_FIT_DEVIATION_M = 0.1
/**
 * Steeper than this between neighbouring stations is a step in the levels, not a grade: such a
 * level is left out of a profile that follows the stations. The cul-de-sac sample's first record
 * sits 0.46 m below the next one, 0.1 m away (482 %).
 */
export const ROADENG_LEVEL_STEP_GRADE = 0.5
/**
 * Characters one alignment's {@link RoadEngSource} may take (its `.dsn` text, base64 `.ds1`/`.ds3`
 * and kept records). Softree's samples take 0.3–0.8 million; past this the source is not kept and
 * the design is written back with this workspace's own parts.
 */
export const MAX_ROADENG_SOURCE_CHARS = 4_000_000
/** `108` curve type of a circular curve, the only one in Softree's samples. */
export const ROADENG_CIRCLE_TYPE = 2
/**
 * `108` curve type written for a spiral curve. Inferred, not seen: RoadEng's curve panel offers
 * Circle and Spiral, circles are 2 and `109`'s parabolas 4, so a spiral is taken as 3. The reader
 * does not rely on it: any type but 2 with transition lengths is tried as a spiral and kept only
 * where that rebuilds the design's stations.
 */
export const ROADENG_SPIRAL_TYPE = 3
/**
 * Report points RoadEng writes this far either side of a template-range, ground-layer or pit
 * boundary, project units (LongRoad: 1199.9 and 1200.1 around the range ending at 1200).
 */
export const ROADENG_REPORT_PAIR_OFFSET = 0.1
/** Metres per project unit for each `[design] units` code. */
export { ROADENG_UNITS }

/**
 * Whether the opening of a file is a RoadEng design: a ZIP whose first entry is one of a design's
 * parts. The content decides the reader, never the file's name.
 */
export function isRoadEngDesign(head: Uint8Array): boolean {
  if (head.length < 30 || head[0] !== 0x50 || head[1] !== 0x4b || head[2] !== 0x03 || head[3] !== 0x04) return false
  const nameLength = head[26] | (head[27] << 8)
  const name = strFromU8(head.subarray(30, Math.min(head.length, 30 + nameLength)), true)
  return /^Location\d+\.ds[n123]$/i.test(name)
}

/**
 * A `108` record's curve design, in metres and metres a second. Field numbers are the record's;
 * meanings are from `roadeng-settings-report.md` (verified: 8, 12–16; 17 and 18 against Softree's
 * bluff road, Location 18 and LongRoad samples; inferred: 10; 9 in part and 11 not identified,
 * kept as numbers so they go back unchanged).
 */
export interface RoadEngCurveFields {
  /** Field 8: design speed, m/s. */
  designSpeedMs?: number
  /**
   * Field 9: a flag word RoadEng writes (5585–5590 in RoadEng 11, 1393 in RoadEng 8). Bit 1 (2) is
   * superelevation typed by hand, Auto off (`ROADENG_MANUAL_SUPERELEVATION_BIT`), bit 8 (256) Auto by
   * the superelevation table rather than the side friction method
   * (`ROADENG_TABLE_SUPERELEVATION_BIT`) and bit 7 (128) Auto widening on the inside
   * (`ROADENG_AUTO_WIDENING_INSIDE_BIT`), all read from Softree's samples; the rest is not
   * identified and goes back as read.
   */
  flags?: number
  /** Field 10: e max, rise over run. */
  emax?: number
  /**
   * Field 11: the curve's f max, the largest side friction (RoadEng's "Max Side Friction"), which
   * the side friction method shares the lateral acceleration by (Softree's bluff road designs hold
   * e = e max · V²/(g R) / (e max + field 11) to twelve digits); 0.10–0.17 in the samples.
   */
  fLimit?: number
  /** Field 12: superelevation transition (runoff) at the BC, m; a spiral curve's entry spiral. */
  runoffIn?: number
  /** Field 13: transition at the EC, m; a spiral curve's exit spiral. */
  runoffOut?: number
  /** Field 14: share of the transition outside the curve (0.667 the common standard). */
  transitionFraction?: number
  /** Field 15: superelevation e used, rise over run. */
  e?: number
  /** Field 16: side friction demanded, v²/(gR) − e. */
  sideFriction?: number
  /** Fields 17 and 18: widening on the inside (toward the curve's centre) and outside of the curve, m. */
  widening?: { insideM: number; outsideM: number }
}

export interface RoadEngPi {
  xy: XY
  /** Metres; 0 is an angle point. */
  radiusM: number
  /** From the radius's sign: negative turns left. */
  turn: 'left' | 'right'
  /** The record's curve type field (2, a circle, is the only one seen); 0 for an angle point. */
  type: number
  /** Clothoid lengths before and after the circular arc, m, where the PI was read as a spiral curve. */
  spiral?: { inM: number; outM: number }
  /** The `108` record's curve design; absent on an angle point. */
  curve?: RoadEngCurveFields
  /** A `108` record, or a plan station of a design that wrote no `108` for that bend. */
  from: '108' | 'plan-station'
}

export interface RoadEngStation {
  station: number
  xy: XY
  /** Design level where the design has a profile, else ground. */
  z: number
  /** RoadEng's Pt. Type bits: 1 profile point, 2 plan point, 4 report station. */
  type: number
  /** Field 9: 2 at the end of a horizontal curve (EC), else 0. */
  planMark: number
  /** Field 10: 4 at the end of a vertical curve (EVC), else 0. */
  profileMark: number
  /** Field 11: report-point bits (`[ReportPointProperties] Item01…Item18` = 1…131072), 0 when blank. */
  report: number
}

export interface RoadEngChecks {
  /** Stations set against the plan rebuilt from the PIs. */
  planStations: number
  /** Largest distance between a `110` station and the rebuilt plan at its chainage, m. */
  planOffsetM: number
  /** Rebuilt length less the design's stationed length, m. */
  lengthDifferenceM: number
  /** Levels set against the rebuilt profile; 0 when the design has no profile. */
  profileStations: number
  /** Largest difference between a `110` level and the rebuilt profile, m; null without a profile. */
  profileDifferenceM: number | null
}

/**
 * What an alignment's files hold that the road model does not, kept as read so `roadEngExport.ts`
 * can write it back. Plain JSON: it can be stored in a project file ({@link parseRoadEngSource}).
 */
export interface RoadEngSource {
  version: 1
  /** The `.dsn`, Latin-1 text as read, line endings included; '' when the archive has none. */
  dsn: string
  /** The `.ds1` and `.ds3` bytes, base64; null when the archive has none. */
  ds1: string | null
  ds3: string | null
  /** `.ds2` records of every type besides 108, 109 and 110, in file order, without line endings. */
  ds2Kept: string[]
  /** How many of `ds2Kept` come before the first 108/109/110 record (the `100` header). */
  ds2KeptBefore: number
  /** The `.ds2`'s line ending. */
  ds2Eol: '\r\n' | '\n'
  /** The `108` records as read: their unidentified fields go back with the PI they match. */
  piRecords: string[]
  /** The `109` records as read, likewise. */
  vipRecords: string[]
  /** The design's `[design] units` code (from its first alignment when this one's `.dsn` leaves it out). */
  unitCode: string
  /** The alignment's first station, m: written stations start here so ranges keep their stations. */
  startStation: number
  /** The alignment's last station, m, as read. Absent in sources stored before it was kept. */
  endStation?: number
  /** The part it was read from (`Location2`). */
  part?: string
  /**
   * The first and last `110` records as read: with the kept records and the PI and VIP records they
   * give back the `.ds2` the settings readers take ({@link roadEngSourceDs2Text}), without keeping
   * every calculated station.
   */
  ds2Ends?: string[]
  /** A later alignment's copy of the first alignment's `.dsn`, which holds the design-wide settings (templates). */
  projectDsn?: string
  /** Road chainage ÷ design stations at import (`RoadEngRoad.stationScale`). */
  stationScale?: number
  /** The CRS its file coordinates are in; the local plane's code for a design on the plane. */
  epsg?: number
  /** The section the import fell back on where RoadEng's templates give no value (`roadEngTemplateFor`). */
  fallback?: RoadTemplate
  /**
   * The name the import gave an alignment its `.dsn` leaves unnamed (the design's file name): while
   * the road keeps it, the design is written back unnamed, as RoadEng had it.
   */
  importedName?: string
  /**
   * Set when the `.ds1`'s placed culverts were read onto the road (`roadEngPlacedCulverts.ts`): a
   * record no culvert holds then was deleted. Absent in a source kept before they were read, whose
   * records all go back.
   */
  culvertsRead?: true
  /** The P-line the design names (`[design] roadname`), with its `.tr1`/`.tr2` as read when given (`roadEngPLine.ts`). */
  pLine?: RoadEngPLineSource
}

export interface RoadEngAlignment {
  /** The part's name in the archive, `Location1`. */
  part: string
  /** The alignment's own name (`[HAlignOptions] Option, 1`), when its .dsn gives one. */
  name: string | null
  /**
   * What this workspace wrote into a design it exported (`[PGMaps]`, `roadEngExport.ts`): the
   * surfacing between RoadEng's finished-surface profile and the subgrade, the road's section as
   * JSON, unchecked here, and the costs RoadEng has no field for (`Costs`,
   * `RoadEngCostCarryover`). `nativeChanged` is set when the design's own parts (everything but
   * `[PGMaps]`) are no longer the ones written with it (`Native`, {@link roadEngNativeFingerprint}):
   * RoadEng saved it since. Null in a design RoadEng wrote.
   */
  pgmaps: {
    surfacingM: number
    template: unknown
    engineering: unknown
    curveDesign: unknown
    /** The road's start station and equations (`Stationing`, `roadStationing.ts`), unchecked here. */
    stationing?: unknown
    costs: unknown
    nativeChanged: boolean
  } | null
  startStation: number
  endStation: number
  pis: RoadEngPi[]
  /** Stations as in the file, m. The first and last carry no curve. Empty without a profile. */
  profile: { station: number; elevation: number; curveLength: number }[]
  stations: RoadEngStation[]
  checks: RoadEngChecks
  /**
   * Where the PIs did not rebuild the design's own stations: `plan`, the road is fitted to the
   * stations; `profile`, its PVIs are the stations' levels thinned to {@link ROADENG_PROFILE_TOLERANCE_M}.
   */
  followsStations: { plan: boolean; profile: boolean }
  /** What the plan was rebuilt from: the `108` records, those and the plan stations, or neither (a fit). */
  planFrom: 'pis' | 'pis-and-plan-stations' | 'stations'
  /** The parts kept for writing back; null when over {@link MAX_ROADENG_SOURCE_CHARS}. */
  source: RoadEngSource | null
  warnings: string[]
}

export interface RoadEngDesign {
  /** RoadEng's build, `11.0.673.0`, when the design states it. */
  version: string | null
  /** Metres per project unit. */
  unitM: number
  /** The terrain file the design was made on (`[design] surface`), which this does not read. */
  terrain: string | null
  alignments: RoadEngAlignment[]
}

// ---- Reading -------------------------------------------------------------------------------------

/** `[section] key=value` text; later keys win, keys keep their case. */
export function readRoadEngIni(text: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>()
  let current: Map<string, string> | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const header = /^\[(.+)\]$/.exec(line)
    if (header) {
      current = sections.get(header[1]) ?? new Map()
      sections.set(header[1], current)
    } else if (current) {
      const eq = line.indexOf('=')
      if (eq > 0) current.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim())
    }
  }
  return sections
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
/** Standard base64 with padding. */
export function bytesToBase64(bytes: Uint8Array): string {
  const out: string[] = []
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out.push(
      B64[(n >> 18) & 63] +
        B64[(n >> 12) & 63] +
        (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') +
        (i + 2 < bytes.length ? B64[n & 63] : '='),
    )
  }
  return out.join('')
}
/** The bytes of base64 text; characters outside the alphabet (padding, line breaks) are skipped. */
export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let o = 0
  for (let i = 0; i < clean.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => (i + k < clean.length ? B64.indexOf(clean[i + k]) : 0))
    const n = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3]
    if (o < out.length) out[o++] = (n >> 16) & 255
    if (o < out.length) out[o++] = (n >> 8) & 255
    if (o < out.length) out[o++] = n & 255
  }
  return out
}

/** The size a source takes in a project file, characters. */
export function roadEngSourceChars(source: RoadEngSource): number {
  return (
    source.dsn.length +
    (source.projectDsn?.length ?? 0) +
    [...(source.ds2Ends ?? [])].reduce((sum, line) => sum + line.length + 2, 0) +
    (source.ds1?.length ?? 0) +
    (source.ds3?.length ?? 0) +
    (source.pLine ? roadEngPLineChars(source.pLine) : 0) +
    [...source.ds2Kept, ...source.piRecords, ...source.vipRecords].reduce((sum, line) => sum + line.length + 2, 0)
  )
}

/**
 * A stored {@link RoadEngSource} checked for shape and size, for a project file's parser; null when
 * it is not one. Its content is not interpreted: it is written back as it stands.
 */
export function parseRoadEngSource(value: unknown): RoadEngSource | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const lines = (x: unknown) => Array.isArray(x) && x.every((l) => typeof l === 'string' && !/[\r\n]/.test(l))
  const b64 = (x: unknown) => x === null || (typeof x === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(x))
  if (
    v.version !== 1 ||
    typeof v.dsn !== 'string' ||
    !b64(v.ds1) ||
    !b64(v.ds3) ||
    !lines(v.ds2Kept) ||
    !lines(v.piRecords) ||
    !lines(v.vipRecords) ||
    typeof v.ds2KeptBefore !== 'number' ||
    !Number.isInteger(v.ds2KeptBefore) ||
    v.ds2KeptBefore < 0 ||
    v.ds2KeptBefore > (v.ds2Kept as string[]).length ||
    (v.ds2Eol !== '\r\n' && v.ds2Eol !== '\n') ||
    typeof v.unitCode !== 'string' ||
    ROADENG_UNITS[v.unitCode] === undefined ||
    typeof v.startStation !== 'number' ||
    !Number.isFinite(v.startStation) ||
    (v.endStation !== undefined && (typeof v.endStation !== 'number' || !Number.isFinite(v.endStation))) ||
    (v.part !== undefined && (typeof v.part !== 'string' || !/^Location\d+$/.test(v.part))) ||
    (v.ds2Ends !== undefined && (!lines(v.ds2Ends) || (v.ds2Ends as string[]).length > 2)) ||
    (v.projectDsn !== undefined && typeof v.projectDsn !== 'string') ||
    (v.stationScale !== undefined &&
      (typeof v.stationScale !== 'number' || !(v.stationScale > 0) || !Number.isFinite(v.stationScale))) ||
    (v.epsg !== undefined && (typeof v.epsg !== 'number' || !Number.isInteger(v.epsg) || v.epsg <= 0)) ||
    (v.fallback !== undefined && (!v.fallback || typeof v.fallback !== 'object' || Array.isArray(v.fallback))) ||
    (v.culvertsRead !== undefined && v.culvertsRead !== true) ||
    (v.importedName !== undefined && typeof v.importedName !== 'string') ||
    (v.pLine !== undefined && !parseRoadEngPLineSource(v.pLine))
  )
    return null
  const source: RoadEngSource = {
    version: 1,
    dsn: v.dsn,
    ds1: v.ds1 as string | null,
    ds3: v.ds3 as string | null,
    ds2Kept: [...(v.ds2Kept as string[])],
    ds2KeptBefore: v.ds2KeptBefore,
    ds2Eol: v.ds2Eol,
    piRecords: [...(v.piRecords as string[])],
    vipRecords: [...(v.vipRecords as string[])],
    unitCode: v.unitCode,
    startStation: v.startStation,
    ...(v.endStation !== undefined ? { endStation: v.endStation as number } : {}),
    ...(v.part !== undefined ? { part: v.part as string } : {}),
    ...(v.ds2Ends !== undefined ? { ds2Ends: [...(v.ds2Ends as string[])] } : {}),
    ...(v.projectDsn !== undefined ? { projectDsn: v.projectDsn as string } : {}),
    ...(v.stationScale !== undefined ? { stationScale: v.stationScale as number } : {}),
    ...(v.epsg !== undefined ? { epsg: v.epsg as number } : {}),
    // Checked for shape here; the project parser validates it as a section (`parseTemplate`).
    ...(v.fallback !== undefined ? { fallback: v.fallback as RoadTemplate } : {}),
    ...(v.culvertsRead === true ? { culvertsRead: true as const } : {}),
    ...(typeof v.importedName === 'string' ? { importedName: v.importedName } : {}),
    ...(v.pLine !== undefined ? { pLine: parseRoadEngPLineSource(v.pLine)! } : {}),
  }
  return roadEngSourceChars(source) <= MAX_ROADENG_SOURCE_CHARS ? source : null
}

/**
 * The `.ds2` text the settings readers (`roadEngDesignSettings.ts`, `roadEngHaul.ts`) take, from what
 * a source keeps: the kept records, the alignment's two end stations and its PI and VIP records, in
 * RoadEng's order. The calculated stations between the ends are not kept; no reader of settings
 * needs them.
 */
export function roadEngSourceDs2Text(source: RoadEngSource): string {
  const before = source.ds2Kept.slice(0, source.ds2KeptBefore)
  const after = source.ds2Kept.slice(source.ds2KeptBefore)
  return [...before, ...(source.ds2Ends ?? []), ...source.piRecords, ...source.vipRecords, ...after, ''].join(
    source.ds2Eol,
  )
}

/** Reads a `.dsnx` archive's alignments. Coordinates stay in the design's grid, in metres. */
export function parseRoadEngDesign(bytes: Uint8Array): RoadEngDesign {
  if (bytes.length > MAX_ROADENG_BYTES) throw Error('The RoadEng design is over 50 MB.')
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes, {
      filter: (file) => /^Location\d+\.ds[n123]$/i.test(file.name) && file.originalSize <= MAX_ROADENG_ENTRY_BYTES,
    })
  } catch {
    throw Error('This RoadEng design could not be unpacked: the archive is damaged or not a .dsnx.')
  }
  const parts = new Map<number, { dsn?: string; ds2?: string; ds1?: Uint8Array; ds3?: Uint8Array }>()
  for (const [name, data] of Object.entries(entries)) {
    const match = /^Location(\d+)\.(ds[n123])$/i.exec(name)
    if (!match) continue
    const part = parts.get(Number(match[1])) ?? {}
    const kind = match[2].toLowerCase()
    if (kind === 'dsn' || kind === 'ds2') part[kind] = strFromU8(data, true)
    else part[kind as 'ds1' | 'ds3'] = data
    parts.set(Number(match[1]), part)
  }
  const numbers = [...parts.keys()].filter((n) => parts.get(n)!.ds2 !== undefined).sort((a, b) => a - b)
  if (!numbers.length) throw Error('The RoadEng design holds no alignment (no LocationN.ds2 inside).')
  if (numbers.length > MAX_ROADENG_ALIGNMENTS)
    throw Error(`The RoadEng design holds ${numbers.length} alignments; at most ${MAX_ROADENG_ALIGNMENTS} are read.`)
  // Project-wide settings sit in the first alignment's .dsn; later ones may leave them out.
  const settings = numbers.map((n) => readRoadEngIni(parts.get(n)!.dsn ?? ''))
  const first = <T>(read: (ini: Map<string, Map<string, string>>) => T | undefined) =>
    settings.map(read).find((value) => value !== undefined)
  const unitsText = first((ini) => ini.get('design')?.get('units'))
  if (unitsText === undefined) throw Error('The RoadEng design does not state its units ([design] units).')
  const unitM = ROADENG_UNITS[unitsText]
  if (unitM === undefined)
    throw Error(`The RoadEng design's units code ${unitsText} is not one this import reads (${ROADENG_UNITS_READ}).`)
  const header = parts.get(numbers[0])!.ds2!.split(/\r?\n/, 1)[0].split(',')
  const version = first((ini) => ini.get('Software')?.get('Version2')) ?? (header[0] === '100' ? header[3] : undefined)
  const terrain = first((ini) => ini.get('design')?.get('surface')) ?? null
  return {
    version: version?.trim() || null,
    unitM,
    terrain,
    alignments: numbers.map((n, k) => {
      const part = parts.get(n)!
      const alignment = readAlignment(`Location${n}`, part.ds2!, unitM)
      let source = readSource(part, unitsText, alignment.startStation, {
        part: `Location${n}`,
        endStation: alignment.endStation,
      })
      // A later alignment's templates and design-wide settings live in the first one's .dsn.
      const projectDsn = k > 0 ? parts.get(numbers[0])!.dsn : undefined
      if (source && projectDsn !== undefined) {
        source = { ...source, projectDsn }
        if (roadEngSourceChars(source) > MAX_ROADENG_SOURCE_CHARS) source = null
      }
      if (!source)
        alignment.warnings.push(
          `Its RoadEng files are larger than the ${(MAX_ROADENG_SOURCE_CHARS / 1e6).toFixed(0)} million characters a project keeps, so a RoadEng file written from it holds only what this workspace models.`,
        )
      return {
        ...alignment,
        name: settings[k].get('HAlignOptions')?.get('Option, 1')?.slice(0, 120) || null,
        pgmaps: readPgmaps(settings[k].get('PGMaps'), () => roadEngNativeFingerprint(part.dsn ?? '', part.ds2!)),
        source,
      }
    }),
  }
}

const RECORD_TYPE = /^(\d+),/
/** Records the writer regenerates; every other `.ds2` record is kept. */
const REGENERATED = new Set(['108', '109', '110'])

function readSource(
  part: { dsn?: string; ds2?: string; ds1?: Uint8Array; ds3?: Uint8Array },
  unitCode: string,
  startStation: number,
  extra: { part: string; endStation: number },
): RoadEngSource | null {
  const text = part.ds2 ?? ''
  const ds2Eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  const ds2Kept: string[] = []
  const piRecords: string[] = []
  const vipRecords: string[] = []
  let ds2KeptBefore = -1
  let firstStation: string | null = null,
    lastStation: string | null = null
  for (const line of lines) {
    const type = RECORD_TYPE.exec(line)?.[1]
    if (type && REGENERATED.has(type)) {
      if (ds2KeptBefore < 0) ds2KeptBefore = ds2Kept.length
      if (type === '108') piRecords.push(line)
      else if (type === '109') vipRecords.push(line)
      else {
        firstStation ??= line
        lastStation = line
      }
    } else if (line !== '') ds2Kept.push(line)
  }
  const source: RoadEngSource = {
    version: 1,
    dsn: part.dsn ?? '',
    ds1: part.ds1 ? bytesToBase64(part.ds1) : null,
    ds3: part.ds3 ? bytesToBase64(part.ds3) : null,
    ...(part.ds1 ? { culvertsRead: true as const } : {}),
    ds2Kept,
    ds2KeptBefore: ds2KeptBefore < 0 ? ds2Kept.length : ds2KeptBefore,
    ds2Eol,
    piRecords,
    vipRecords,
    unitCode,
    startStation,
    endStation: extra.endStation,
    part: extra.part,
    ds2Ends: firstStation === null ? [] : firstStation === lastStation ? [firstStation] : [firstStation, lastStation!],
  }
  return roadEngSourceChars(source) <= MAX_ROADENG_SOURCE_CHARS ? source : null
}

/**
 * A fingerprint of a design alignment's own parts, as RoadEng holds them: its `.dsn` without the
 * `[PGMaps]` section and its `.ds2`, line endings and blank lines aside. The design writer stores it
 * as `[PGMaps] Native`; a design read back with a different one was saved by RoadEng since.
 */
export function roadEngNativeFingerprint(dsn: string, ds2: string): string {
  const lines: string[] = []
  let ours = false
  for (const line of dsn.split(/\r?\n/)) {
    const header = /^\s*\[(.+)\]\s*$/.exec(line)
    if (header) ours = header[1].trim().toLowerCase() === 'pgmaps'
    if (!ours && line.trim()) lines.push(line)
  }
  lines.push('\u0000')
  for (const line of ds2.split(/\r?\n/)) if (line.trim()) lines.push(line)
  // FNV-1a, 32 bits, over the UTF-16 code units, with the length beside it.
  const text = lines.join('\n')
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${text.length.toString(36)}-${hash.toString(16).padStart(8, '0')}`
}

function readPgmaps(section: Map<string, string> | undefined, fingerprint: () => string): RoadEngAlignment['pgmaps'] {
  if (!section) return null
  const surfacingM = Number(section.get('SurfacingM'))
  if (!Number.isFinite(surfacingM) || surfacingM < 0 || surfacingM > 10) return null
  const json = (key: string): unknown => {
    try {
      return JSON.parse(section.get(key) ?? 'null')
    } catch {
      return null
    }
  }
  const native = section.get('Native')?.trim()
  return {
    surfacingM,
    template: json('Template'),
    engineering: json('Engineering'),
    curveDesign: json('CurveDesign'),
    costs: json('Costs'),
    ...(section.has('Stationing') ? { stationing: json('Stationing') } : {}),
    nativeChanged: !!native && native !== fingerprint(),
  }
}

/** A `108` record's curve design fields, converted to metres. Blank or unreadable fields are left out. */
function readCurveFields(n: (i: number) => number, unitM: number): RoadEngCurveFields {
  const curve: RoadEngCurveFields = {}
  const set = <K extends keyof RoadEngCurveFields>(key: K, value: number, scale = 1) => {
    if (Number.isFinite(value)) (curve as Record<string, unknown>)[key] = value * scale
  }
  set('designSpeedMs', n(8), unitM)
  set('flags', n(9))
  set('emax', n(10))
  set('fLimit', n(11))
  set('runoffIn', n(12), unitM)
  set('runoffOut', n(13), unitM)
  set('transitionFraction', n(14))
  set('e', n(15))
  set('sideFriction', n(16))
  if (Number.isFinite(n(17)) && Number.isFinite(n(18)))
    curve.widening = { insideM: n(17) * unitM, outsideM: n(18) * unitM }
  return curve
}

function readAlignment(
  part: string,
  text: string,
  unitM: number,
): Omit<RoadEngAlignment, 'name' | 'pgmaps' | 'source'> {
  const warnings: string[] = []
  const hips: { index: number; pi: RoadEngPi }[] = []
  const vips: { index: number; radius: number; station: number; elevation: number; stated: number }[] = []
  const stations: RoadEngStation[] = []
  for (const line of text.split(/\r?\n/)) {
    const f = line.split(',')
    const n = (i: number) => (f[i] === undefined || f[i].trim() === '' ? NaN : Number(f[i]))
    if (f[0] === '108') {
      const radius = n(3)
      const xy: XY = [n(4) * unitM, n(5) * unitM]
      if (![n(1), radius, ...xy].every(Number.isFinite)) {
        warnings.push(`A horizontal PI record could not be read and is left out: ${line.slice(0, 80)}`)
        continue
      }
      const curve = readCurveFields(n, unitM)
      const spiral =
        n(2) !== ROADENG_CIRCLE_TYPE && radius !== 0 && (curve.runoffIn ?? 0) > 0 && (curve.runoffOut ?? 0) > 0
          ? { inM: curve.runoffIn!, outM: curve.runoffOut! }
          : undefined
      hips.push({
        index: n(1),
        pi: {
          xy,
          radiusM: Math.abs(radius) * unitM,
          turn: radius < 0 ? 'left' : 'right',
          type: n(2),
          ...(spiral ? { spiral } : {}),
          curve,
          from: '108',
        },
      })
    } else if (f[0] === '109') {
      const record = {
        index: n(1),
        radius: n(3) * unitM,
        station: n(4) * unitM,
        elevation: n(5) * unitM,
        stated: n(11),
      }
      if (![record.index, record.radius, record.station, record.elevation].every(Number.isFinite)) {
        warnings.push(`A vertical PI record could not be read and is left out: ${line.slice(0, 80)}`)
        continue
      }
      vips.push({ ...record, stated: Number.isFinite(record.stated) && record.stated > 0 ? record.stated * unitM : -1 })
    } else if (f[0] === '110') {
      const flag = (i: number) => (Number.isFinite(n(i)) ? n(i) : 0)
      const record: RoadEngStation = {
        type: n(1),
        xy: [n(2) * unitM, n(3) * unitM],
        z: n(4) * unitM,
        station: n(5) * unitM,
        planMark: flag(9),
        profileMark: flag(10),
        report: flag(11),
      }
      if ([record.type, ...record.xy, record.z, record.station].every(Number.isFinite)) stations.push(record)
    }
  }
  if (hips.length > MAX_ROADENG_PIS)
    throw Error(`${part} has ${hips.length} PIs; a road takes at most ${MAX_ROADENG_PIS} between its ends.`)
  if (vips.length > MAX_ROADENG_VIPS)
    throw Error(`${part} has ${vips.length} vertical PIs; a road takes at most ${MAX_ROADENG_VIPS} between its ends.`)
  if (stations.length < 2) throw Error(`${part} has no calculated stations (110 records) to find its ends from.`)
  stations.sort((a, b) => a.station - b.station)
  const start = stations[0],
    end = stations[stations.length - 1]
  const read = hips.sort((a, b) => a.index - b.index).map((h) => h.pi)

  // Profile: the ends' levels through the VIPs, each curve its radius times its change of grade.
  const profile: RoadEngAlignment['profile'] = []
  const curveWarnings: string[] = []
  if (vips.length) {
    const sorted = vips.sort((a, b) => a.index - b.index)
    const points = [
      { station: start.station, elevation: start.z, radius: 0, stated: -1 },
      ...sorted,
      { station: end.station, elevation: end.z, radius: 0, stated: -1 },
    ]
    for (let k = 0; k < points.length; k++) {
      const p = points[k]
      let curveLength = 0
      if (k > 0 && k < points.length - 1 && p.radius !== 0) {
        const into = (p.elevation - points[k - 1].elevation) / (p.station - points[k - 1].station)
        const out = (points[k + 1].elevation - p.elevation) / (points[k + 1].station - p.station)
        curveLength = Math.abs(p.radius * (out - into))
        if (p.stated > 0 && Math.abs(p.stated - curveLength) > 0.001)
          curveWarnings.push(
            `The vertical curve at station ${p.station.toFixed(3)} m states ${p.stated.toFixed(3)} m; its radius and grades give ${curveLength.toFixed(3)} m, which is used.`,
          )
      }
      profile.push({ station: p.station, elevation: p.elevation, curveLength })
    }
  }

  // Plan: the first reading of the PIs that rebuilds every station (see the module comment).
  const attempt = (pis: RoadEngPi[]) => {
    const notes: string[] = []
    const plan = rebuildPlan(start, pis, end, notes)
    let offset = 0
    for (const s of stations) {
      const at = plan.at(s.station)
      offset = Math.max(offset, Math.hypot(at[0] - s.xy[0], at[1] - s.xy[1]))
    }
    return { pis, plan, offset, notes }
  }
  const circles = read.map(({ spiral: _spiral, ...pi }) => pi)
  const readings = [read, ...(read.some((p) => p.spiral) ? [circles] : [])]
  const tries = readings.map(attempt)
  for (const pis of readings) {
    if (tries.some((t) => t.offset <= ROADENG_PLAN_TOLERANCE_M)) break
    const merged = withPlanStations(pis, stations)
    if (merged) tries.push(attempt(merged))
  }
  const chosen = tries.find((t) => t.offset <= ROADENG_PLAN_TOLERANCE_M) ?? tries[0]
  const pis = chosen.pis
  warnings.push(...chosen.notes)
  if (chosen === tries[1] && readings.length > 1)
    warnings.push(
      `Its curves of type ${[...new Set(read.filter((p) => p.spiral).map((p) => p.type))].join(', ')} rebuild its stations as circular curves, not spirals, so they are read as circular.`,
    )
  else {
    const odd = [...new Set(pis.filter((p) => p.from === '108' && p.type !== ROADENG_CIRCLE_TYPE).map((p) => p.type))]
    const spirals = pis.filter((p) => p.spiral).length
    if (odd.length && chosen.offset <= ROADENG_PLAN_TOLERANCE_M && spirals)
      warnings.push(
        `${spirals === 1 ? '1 curve' : `${spirals} curves`} of type ${odd.join(', ')} ${spirals === 1 ? 'is' : 'are'} read as spiral curves, their transition lengths the spirals, because that rebuilds the design's stations.`,
      )
    else if (odd.length)
      warnings.push(
        `PI type ${odd.join(', ')} is not one seen in RoadEng's samples; it is read as a ${spirals ? 'spiral' : 'circular'} curve.`,
      )
  }

  let profileDifferenceM: number | null = null
  if (profile.length) {
    profileDifferenceM = 0
    for (const s of stations)
      profileDifferenceM = Math.max(profileDifferenceM, Math.abs(profileAt(profile, s.station) - s.z))
  }
  const planOffsetM = chosen.offset
  const checks: RoadEngChecks = {
    planStations: stations.length,
    planOffsetM,
    lengthDifferenceM: chosen.plan.length - (end.station - start.station),
    profileStations: profile.length ? stations.length : 0,
    profileDifferenceM,
  }
  const followsStations = {
    plan: planOffsetM > ROADENG_PLAN_TOLERANCE_M,
    profile: profileDifferenceM !== null && profileDifferenceM > ROADENG_PROFILE_TOLERANCE_M,
  }
  const planFrom: RoadEngAlignment['planFrom'] = followsStations.plan
    ? 'stations'
    : pis.some((p) => p.from === 'plan-station')
      ? 'pis-and-plan-stations'
      : 'pis'
  if (followsStations.plan)
    warnings.push(
      pis.length
        ? `Its ${pis.length} readable PIs rebuild the plan only to within ${planOffsetM.toFixed(3)} m of the design's own stations (PIs kept where this import does not read), so the road follows those stations instead.`
        : `Its PIs are not in the part of the file this import reads, so the road follows the design's own stations.`,
    )
  const thinned = followsStations.profile ? thinProfile(stations) : null
  if (!thinned) warnings.push(...curveWarnings)
  else {
    warnings.push(
      `Its ${vips.length} readable vertical PIs rebuild the profile only to within ${profileDifferenceM!.toFixed(3)} m of the design's own levels, so the road's PVIs are those levels thinned to within ${(thinned.toleranceM * 1000).toFixed(0)} mm, as straight grades with no vertical curves.`,
    )
    if (thinned.stepped.length)
      warnings.push(
        `The level at station${thinned.stepped.length > 1 ? 's' : ''} ${thinned.stepped.map((s) => s.toFixed(3)).join(', ')} m steps more than ${ROADENG_LEVEL_STEP_GRADE * 100} % from its neighbours and is left out of the profile.`,
      )
  }
  return {
    part,
    startStation: start.station,
    endStation: end.station,
    pis,
    profile: thinned ? thinned.profile : profile,
    stations,
    checks,
    followsStations,
    planFrom,
    warnings,
  }
}

/** Interior plan stations (Pt. Type 2), one per station, in order. */
function interiorPlanStations(stations: readonly RoadEngStation[]): RoadEngStation[] {
  const first = stations[0].station,
    last = stations[stations.length - 1].station
  const out: RoadEngStation[] = []
  for (const s of stations) {
    if (!(s.type & 2) || s.station <= first + 1e-6 || s.station >= last - 1e-6) continue
    const prev = out[out.length - 1]
    if (prev && Math.abs(prev.station - s.station) <= 1e-6) {
      if (s.planMark === 2) out[out.length - 1] = s
    } else out.push(s)
  }
  return out
}

/**
 * The `108` PIs with an angle point (radius 0) at every interior plan station that is not one of a
 * curve's own: the station marked EC (field 9 = 2) and the unmarked ones just before it (the BC; a
 * spiral's TS, SC and CS, inferred). Null when the EC marks and the `108` records do not pair up,
 * or when no plan station is left over.
 */
function withPlanStations(pis: readonly RoadEngPi[], stations: readonly RoadEngStation[]): RoadEngPi[] | null {
  const out: RoadEngPi[] = []
  let next = 0
  let pending: RoadEngStation[] = []
  const angle = (s: RoadEngStation): RoadEngPi => ({
    xy: s.xy,
    radiusM: 0,
    turn: 'right',
    type: 0,
    from: 'plan-station',
  })
  for (const s of interiorPlanStations(stations)) {
    if (s.planMark !== 2) {
      pending.push(s)
      continue
    }
    const pi = pis[next++]
    if (!pi) return null
    const own = pi.spiral ? 3 : 1
    out.push(...pending.slice(0, Math.max(0, pending.length - own)).map(angle), pi)
    pending = []
  }
  out.push(...pending.map(angle))
  if (next !== pis.length || !out.some((p) => p.from === 'plan-station')) return null
  // An angle point's turn, from its neighbours.
  const xy = [stations[0].xy, ...out.map((p) => p.xy), stations[stations.length - 1].xy]
  out.forEach((p, k) => {
    if (p.from !== 'plan-station') return
    const a = xy[k],
      b = xy[k + 1],
      c = xy[k + 2]
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
    p.turn = cross > 0 ? 'left' : 'right'
  })
  return out
}

/**
 * The stations' levels as straight grades, thinned (Douglas–Peucker) to within the profile
 * tolerance, doubled until the PVIs fit a road.
 */
function thinProfile(stations: readonly RoadEngStation[]): {
  profile: RoadEngAlignment['profile']
  toleranceM: number
  /** Stations whose level steps from both neighbours (an end, from its one) and was left out, m. */
  stepped: number[]
} {
  const distinct = stations.filter((s, k) => k === 0 || s.station - stations[k - 1].station > 1e-6)
  const steep = (a: RoadEngStation | undefined, b: RoadEngStation | undefined) =>
    !a || !b || Math.abs((b.z - a.z) / (b.station - a.station)) > ROADENG_LEVEL_STEP_GRADE
  const stepped: number[] = []
  const points = distinct.filter((s, k) => {
    const out = steep(distinct[k - 1], s) && steep(s, distinct[k + 1])
    if (out) stepped.push(s.station)
    return !out
  })
  if (points.length < 2) return { profile: [], toleranceM: ROADENG_PROFILE_TOLERANCE_M, stepped }
  for (let toleranceM = ROADENG_PROFILE_TOLERANCE_M; ; toleranceM *= 2) {
    const profile = thinLevels(points, toleranceM)
    if (profile.length <= MAX_ROADENG_VIPS + 2) return { profile, toleranceM, stepped }
  }
}
function thinLevels(points: readonly RoadEngStation[], toleranceM: number): RoadEngAlignment['profile'] {
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const grade = (points[b].z - points[a].z) / (points[b].station - points[a].station)
    let worst = -1,
      far = toleranceM / 2
    for (let k = a + 1; k < b; k++) {
      const off = Math.abs(points[a].z + grade * (points[k].station - points[a].station) - points[k].z)
      if (off > far) {
        far = off
        worst = k
      }
    }
    if (worst > 0) {
      keep[worst] = 1
      stack.push([a, worst], [worst, b])
    }
  }
  return points.filter((_, k) => keep[k]).map((p) => ({ station: p.station, elevation: p.z, curveLength: 0 }))
}

// ---- Station events --------------------------------------------------------------------------------

/** What a report-point bit marks (`roadeng-gaps-plan.md` §0.3; inferred from where each appears). */
export type RoadEngReportKind =
  | 'template-range'
  | 'ground-layer-range'
  | 'superelevation'
  | 'pit-range'
  | 'pit'
  | 'other'

/** Report bits and what they mark. 256, 4096 (the two auto intervals) and 65536 (cost points) are not events. */
export const ROADENG_REPORT_BITS: Readonly<Record<RoadEngReportKind, number>> = {
  'template-range': 2,
  'ground-layer-range': 16,
  superelevation: 2048,
  'pit-range': 16384,
  pit: 32768,
  other: 0,
}
/** Report bits that recur on regular stations: the first and second auto interval and the cost points. */
export const ROADENG_INTERVAL_BITS = { first: 256, second: 4096, cost: 65536 } as const
const NOT_EVENTS = ROADENG_INTERVAL_BITS.first | ROADENG_INTERVAL_BITS.second | ROADENG_INTERVAL_BITS.cost

export interface RoadEngStationEvents {
  /** Every flagged report point, one per bit: station (m, the design's stationing), bit and kind. */
  points: { station: number; bit: number; kind: RoadEngReportKind }[]
  /**
   * Template-range boundaries: RoadEng flags a point {@link ROADENG_REPORT_PAIR_OFFSET} either side
   * of each, and the boundary is their middle (a lone point stands for itself).
   */
  templateRanges: number[]
  /** Ground-layer (sub-horizon) range boundaries, likewise. */
  groundLayerRanges: number[]
  /** Pit (borrow or waste site) stations. */
  pits: number[]
  /** Superelevation transition points: runout start, level, reverse crown and full super at each end. */
  superelevation: number[]
  /** Horizontal curve starts and ends: an EC is marked; its BC is the plan station just before it. */
  bc: number[]
  ec: number[]
  /** Vertical curve starts and ends: an EVC is marked; its BVC is the profile point just before it. */
  bvc: number[]
  evc: number[]
}

/**
 * The events RoadEng flagged on an alignment's stations, for cross-checking what was read from its
 * `.dsn` (template ranges and pits) against where RoadEng put them.
 */
export function stationEvents(alignment: Pick<RoadEngAlignment, 'stations'>): RoadEngStationEvents {
  const { stations } = alignment
  const points: RoadEngStationEvents['points'] = []
  const kinds = Object.entries(ROADENG_REPORT_BITS).filter(([, bit]) => bit) as [RoadEngReportKind, number][]
  for (const s of stations) {
    let rest = s.report & ~NOT_EVENTS
    for (const [kind, bit] of kinds)
      if (s.report & bit) {
        points.push({ station: s.station, bit, kind })
        rest &= ~bit
      }
    for (let bit = 1; rest; bit *= 2)
      if (rest & bit) {
        points.push({ station: s.station, bit, kind: 'other' })
        rest &= ~bit
      }
  }
  const of = (kind: RoadEngReportKind) => [...new Set(points.filter((p) => p.kind === kind).map((p) => p.station))]
  // Pairs a little either side of a boundary; 0.25 m takes RoadEng's ±0.1 project unit in metres or feet.
  const boundaries = (list: number[]) => {
    const out: number[] = []
    for (let k = 0; k < list.length; k++)
      if (k + 1 < list.length && list[k + 1] - list[k] <= 0.25) {
        out.push((list[k] + list[k + 1]) / 2)
        k++
      } else out.push(list[k])
    return out
  }
  const curveEnds = (bit: number, mark: (s: RoadEngStation) => boolean) => {
    const first = stations[0]?.station ?? 0,
      last = stations[stations.length - 1]?.station ?? 0
    const list = stations.filter((s) => s.type & bit)
    const starts: number[] = [],
      ends: number[] = []
    list.forEach((s, k) => {
      if (mark(s)) ends.push(s.station)
      else if (k + 1 < list.length && mark(list[k + 1]) && s.station > first + 1e-6 && s.station < last)
        starts.push(s.station)
    })
    return { starts, ends }
  }
  const plan = curveEnds(2, (s) => s.planMark === 2)
  const profile = curveEnds(1, (s) => s.profileMark === 4)
  return {
    points,
    templateRanges: boundaries(of('template-range')),
    groundLayerRanges: boundaries(of('ground-layer-range')),
    pits: of('pit'),
    superelevation: of('superelevation'),
    bc: plan.starts,
    ec: plan.ends,
    bvc: profile.starts,
    evc: profile.ends,
  }
}

// ---- Rebuilding the design to check it --------------------------------------------------------------

type Piece =
  | { kind: 'line'; from: XY; to: XY; s0: number; length: number }
  | { kind: 'arc'; centre: XY; radius: number; a0: number; sense: 1 | -1; s0: number; length: number }
  /**
   * A clothoid between a tangent point `origin` and its circle: position at distance t along the
   * piece is origin + x(u)·dir + y(u)·normal, u = t from the tangent point (or length − t when the
   * piece runs towards it, an exit spiral).
   */
  | {
      kind: 'spiral'
      origin: XY
      dir: XY
      normal: XY
      spiralLength: number
      radius: number
      towards: boolean
      s0: number
      length: number
    }

/**
 * A clothoid's offsets from its tangent point at distance s along a spiral of length L whose far end
 * has radius R: along the tangent and across it, by the series of the Fresnel integrals.
 */
export function clothoidOffsets(s: number, spiralLength: number, radius: number): XY {
  const a = (s * s) / (2 * radius * spiralLength)
  let x = 0,
    y = 0,
    term = 1
  for (let m = 0; m < 24; m++) {
    const sign = (m >> 1) % 2 ? -1 : 1
    if (m % 2 === 0) x += (sign * term) / (2 * m + 1)
    else y += (sign * term) / (2 * m + 1)
    term *= a / (m + 1)
    if (term < 1e-17) break
  }
  return [s * x, s * y]
}

/** A curve of the rebuilt plan: its PI's index and its stations. */
export interface RebuiltCurve {
  /** Index into the PIs given. */
  pi: number
  /** BC (a spiral's TS) and EC (ST), stations. */
  start: number
  end: number
  /** Spiral lengths in and out, m; 0 for a circular curve. SC = start + spiralIn, CS = end − spiralOut. */
  spiralIn: number
  spiralOut: number
}

/** The plan as tangents, circular curves and clothoids through the PIs, positioned by the design's stations. */
export function rebuildPlan(
  start: Pick<RoadEngStation, 'xy' | 'station'>,
  pis: readonly Pick<RoadEngPi, 'xy' | 'radiusM' | 'turn' | 'spiral'>[],
  end: Pick<RoadEngStation, 'xy'>,
  warnings: string[] = [],
) {
  const tangentPoints: number[] = []
  const curves: RebuiltCurve[] = []
  const angles: { pi: number; station: number }[] = []
  const hip: { xy: XY; radius: number; turn?: 'left' | 'right'; spiral?: RoadEngPi['spiral'] }[] = [
    { xy: start.xy, radius: 0 },
    ...pis.map((p) => ({ xy: p.xy, radius: p.radiusM, turn: p.turn, spiral: p.spiral })),
    { xy: end.xy, radius: 0 },
  ]
  const pieces: Piece[] = []
  let at: XY = start.xy,
    s = start.station
  const line = (to: XY) => {
    const length = Math.hypot(to[0] - at[0], to[1] - at[1])
    if (length > 0) pieces.push({ kind: 'line', from: at, to, s0: s, length })
    s += length
    at = to
  }
  for (let i = 1; i < hip.length - 1; i++) {
    const p = hip[i]
    const dIn = Math.atan2(p.xy[1] - hip[i - 1].xy[1], p.xy[0] - hip[i - 1].xy[0])
    const dOut = Math.atan2(hip[i + 1].xy[1] - p.xy[1], hip[i + 1].xy[0] - p.xy[0])
    const delta = Math.atan2(Math.sin(dOut - dIn), Math.cos(dOut - dIn))
    if (p.radius <= 0 || Math.abs(delta) < 1e-12) {
      line(p.xy)
      if (p.radius <= 0 && Math.abs(delta) >= 1e-12) angles.push({ pi: i - 1, station: s })
      continue
    }
    if ((delta > 0 ? 'left' : 'right') !== p.turn)
      warnings.push(`PI ${i}'s radius sign says it turns ${p.turn}; its tangents turn the other way.`)
    const R = p.radius,
      big = Math.abs(delta)
    const sense: 1 | -1 = delta > 0 ? 1 : -1
    const u1: XY = [Math.cos(dIn), Math.sin(dIn)],
      u2: XY = [Math.cos(dOut), Math.sin(dOut)]
    const n1: XY = [-sense * u1[1], sense * u1[0]],
      n2: XY = [-sense * u2[1], sense * u2[0]]
    let L1 = p.spiral?.inM ?? 0,
      L2 = p.spiral?.outM ?? 0
    if (L1 > 0 || L2 > 0) {
      if (!(L1 > 0 && L2 > 0) || L1 / (2 * R) + L2 / (2 * R) >= big || big > Math.PI - 1e-6) {
        warnings.push(`PI ${i}'s spirals are longer than its deflection allows; it is read as a circular curve.`)
        L1 = L2 = 0
      }
    }
    const th1 = L1 / (2 * R),
      th2 = L2 / (2 * R)
    const [x1, y1] = L1 > 0 ? clothoidOffsets(L1, L1, R) : [0, 0]
    const [x2, y2] = L2 > 0 ? clothoidOffsets(L2, L2, R) : [0, 0]
    const p1 = y1 - R * (1 - Math.cos(th1)),
      k1 = x1 - R * Math.sin(th1)
    const p2 = y2 - R * (1 - Math.cos(th2)),
      k2 = x2 - R * Math.sin(th2)
    // Tangent lengths of a curve with unequal spirals; equal ones give (R + p)·tan(Δ/2) + k.
    const t1 = k1 + (R + p2 - (R + p1) * Math.cos(big)) / Math.sin(big)
    const t2 = k2 + (R + p1 - (R + p2) * Math.cos(big)) / Math.sin(big)
    const ts: XY = [p.xy[0] - t1 * u1[0], p.xy[1] - t1 * u1[1]]
    const st: XY = [p.xy[0] + t2 * u2[0], p.xy[1] + t2 * u2[1]]
    line(ts)
    const curve: RebuiltCurve = { pi: i - 1, start: s, end: s, spiralIn: L1, spiralOut: L2 }
    tangentPoints.push(s)
    if (L1 > 0) {
      pieces.push({
        kind: 'spiral',
        origin: ts,
        dir: u1,
        normal: n1,
        spiralLength: L1,
        radius: R,
        towards: false,
        s0: s,
        length: L1,
      })
      s += L1
      tangentPoints.push(s)
    }
    const sc: XY = [ts[0] + x1 * u1[0] + y1 * n1[0], ts[1] + x1 * u1[1] + y1 * n1[1]]
    const centre: XY = [ts[0] + k1 * u1[0] + (R + p1) * n1[0], ts[1] + k1 * u1[1] + (R + p1) * n1[1]]
    const sweep = big - th1 - th2
    pieces.push({
      kind: 'arc',
      centre,
      radius: R,
      a0: Math.atan2(sc[1] - centre[1], sc[0] - centre[0]),
      sense,
      s0: s,
      length: R * sweep,
    })
    s += R * sweep
    if (L2 > 0) {
      tangentPoints.push(s)
      pieces.push({
        kind: 'spiral',
        origin: st,
        dir: [-u2[0], -u2[1]],
        normal: n2,
        spiralLength: L2,
        radius: R,
        towards: true,
        s0: s,
        length: L2,
      })
      s += L2
    }
    tangentPoints.push(s)
    curve.end = s
    curves.push(curve)
    at = st
  }
  line(end.xy)
  const position = (station: number): XY => {
    const piece = pieces.find((q) => station <= q.s0 + q.length) ?? pieces[pieces.length - 1]
    if (!piece) return start.xy
    const t = station - piece.s0
    if (piece.kind === 'line') {
      const f = piece.length > 0 ? t / piece.length : 0
      return [piece.from[0] + (piece.to[0] - piece.from[0]) * f, piece.from[1] + (piece.to[1] - piece.from[1]) * f]
    }
    if (piece.kind === 'spiral') {
      const u = Math.max(0, Math.min(piece.spiralLength, piece.towards ? piece.length - t : t))
      const [x, y] = clothoidOffsets(u, piece.spiralLength, piece.radius)
      return [
        piece.origin[0] + x * piece.dir[0] + y * piece.normal[0],
        piece.origin[1] + x * piece.dir[1] + y * piece.normal[1],
      ]
    }
    const angle = piece.a0 + (piece.sense * t) / piece.radius
    return [piece.centre[0] + piece.radius * Math.cos(angle), piece.centre[1] + piece.radius * Math.sin(angle)]
  }
  /**
   * `at` gives the position at a station; `tangentPoints` the stations where curves and spirals start
   * and end; `curves` each curve's stations; `angles` the stations of PIs with no curve that bend.
   */
  return { at: position, length: s - start.station, tangentPoints, curves, angles }
}

/** Design level at a station: grade lines between PVIs, symmetric parabolas over each curve. */
function profileAt(profile: RoadEngAlignment['profile'], station: number): number {
  const k = Math.max(
    1,
    Math.min(
      profile.length - 1,
      profile.findIndex((p) => p.station >= station),
    ),
  )
  const grade = (i: number) =>
    (profile[i + 1].elevation - profile[i].elevation) / (profile[i + 1].station - profile[i].station)
  for (let i = 1; i < profile.length - 1; i++) {
    const p = profile[i]
    if (p.curveLength > 0 && Math.abs(station - p.station) <= p.curveLength / 2) {
      const gIn = grade(i - 1),
        gOut = grade(i)
      const x = station - (p.station - p.curveLength / 2)
      return p.elevation - (gIn * p.curveLength) / 2 + gIn * x + ((gOut - gIn) / (2 * p.curveLength)) * x * x
    }
  }
  const i = k - 1
  return profile[i].elevation + grade(i) * (station - profile[i].station)
}

// ---- To roads ------------------------------------------------------------------------------------

export interface RoadEngRoad {
  alignment: Alignment
  source: RoadEngAlignment
  stationScale: number
  /** Measured deviation of a plan fitted to the design's stations, m; null when built from its PIs. */
  fitDeviationM: number | null
  warnings: string[]
  /** The culverts placed in the design (`.ds1`), on the road (`roadEngPlacedCulverts.ts`); what reading them says is in `warnings`. */
  culverts: Culvert[]
}

/**
 * Roads from a RoadEng design. A `.dsnx` states no coordinate system, so `epsg` must answer the
 * question {@link alignmentCrs} raises; it is never taken from the open terrain. Each road gets
 * `template` and a new id.
 */
export function roadEngRoads(
  bytes: Uint8Array,
  options: {
    fileName: string
    newId: () => string
    color: (index: number) => string
    template: RoadTemplate
    epsg?: number
    /**
     * Where the design's metres go, when the caller has placed it already: in its terrain's CRS
     * or on the local plane (`roadEngProject.ts`). `epsg` and the CRS question are then unused.
     */
    placement?: { epsg: number; toLonLat: (xy: XY) => Coordinate }
  },
): { roads: RoadEngRoad[]; design: RoadEngDesign; epsg: number } {
  const design = parseRoadEngDesign(bytes)
  const epsg =
    options.placement?.epsg ??
    alignmentCrs(null, options.epsg, {
      unitM: design.unitM,
      points: design.alignments.flatMap((a) => [a.stations[0].xy, ...a.pis.map((p) => p.xy)]),
      what: `The RoadEng design ${options.fileName}`,
    })
  const toLonLat = options.placement?.toLonLat ?? gridToLonLat(epsg)
  const base = options.fileName.replace(/\.dsnx$/i, '').slice(0, 160)
  const roads = design.alignments.map((source, index): RoadEngRoad => {
    const spiralWarnings: string[] = []
    const grid: GridAlignment = {
      name: source.name
        ? `${base} · ${source.name}`
        : design.alignments.length > 1
          ? `${base} · ${source.part.replace(/(\d+)$/, ' $1')}`
          : base,
      points: [
        { xy: source.stations[0].xy, radiusM: 0, spiralM: 0 },
        ...source.pis.map((p, k) => {
          if (!p.spiral) return { xy: p.xy, radiusM: p.radiusM, spiralM: 0 }
          const spiralM = (p.spiral.inM + p.spiral.outM) / 2
          if (Math.abs(p.spiral.inM - p.spiral.outM) > 1e-3)
            spiralWarnings.push(
              `PI ${k + 1} has spirals of ${p.spiral.inM.toFixed(1)} and ${p.spiral.outM.toFixed(1)} m; the road takes ${spiralM.toFixed(1)} m each side.`,
            )
          return { xy: p.xy, radiusM: p.radiusM, spiralM }
        }),
        { xy: source.stations[source.stations.length - 1].xy, radiusM: 0, spiralM: 0 },
      ],
      profile: source.profile,
      startStation: source.startStation,
      fileLengthM: source.endStation - source.startStation,
    }
    const target = { id: options.newId(), color: options.color(index), template: options.template }
    let fitDeviationM: number | null = null
    let road: ReturnType<typeof gridAlignmentRoad>
    if (source.followsStations.plan) {
      // Every station, or an even share of them with both ends, within what the fit takes.
      const all = source.stations.filter((s, k) => k === 0 || s.station - source.stations[k - 1].station > 1e-6)
      const step = Math.ceil(all.length / MAX_FIT_SOURCE_POINTS)
      const used = all.filter((_, k) => k % step === 0 || k === all.length - 1)
      const fit = fitPolylineAlignment(
        used.map((s) => toLonLat(s.xy)),
        { maxDeviationM: ROADENG_FIT_DEVIATION_M, minRadiusM: 0 },
      )
      fitDeviationM = fit.maxDeviationM
      road = placedAlignmentRoad(
        { ...grid, points: fit.points.map((p) => ({ coordinate: p.coordinate, radiusM: p.radiusM, spiralM: 0 })) },
        target,
      )
    } else road = gridAlignmentRoad(grid, toLonLat, target)
    // A road with no design profile: its station levels are the ground under its centreline.
    const fileGround = source.profile.length
      ? null
      : thinProfile(source.stations).profile.map((p): [number, number] => [
          Math.round((p.station - source.startStation) * road.stationScale * 1000) / 1000,
          Math.round(p.elevation * 1000) / 1000,
        ])
    // Culverts placed in the design, at the road chainage of their L-line stations.
    const read = culvertsFromDesign(source.source?.ds1 ? base64ToBytes(source.source.ds1) : null, {
      unitM: design.unitM,
      frame: { startStation: source.startStation, endStation: source.endStation, stationScale: road.stationScale },
      newId: options.newId,
    })
    // RoadEng's alignments carry no station equations: a road written here keeps its own in [PGMaps].
    // A road starting at another station than 0 takes RoadEng's station names (GuardRail starts at 1+400).
    let stationing: Alignment['stationing'] = keptStationing(
      roadEngImpliedStationing(source.startStation, road.stationScale),
    )
    if (source.pgmaps?.stationing !== undefined)
      try {
        stationing = keptStationing(parseRoadStationing(source.pgmaps.stationing))
      } catch {
        source.warnings.push('The station equations this workspace wrote into the design could not be read.')
      }
    return {
      alignment: {
        ...road.alignment,
        ...(fileGround && fileGround.length >= 2
          ? { fileGround: { source: `${options.fileName} station levels`, points: fileGround } }
          : {}),
        ...(stationing ? { stationing } : {}),
        ...(read.culverts.length ? { engineering: { ...createEngineeringDesign(), culverts: read.culverts } } : {}),
      },
      source,
      stationScale: road.stationScale,
      fitDeviationM,
      warnings: [
        ...source.warnings,
        ...(fitDeviationM === null ? spiralWarnings : []),
        ...road.warnings,
        ...read.notes,
      ],
      culverts: read.culverts,
    }
  })
  return { roads, design, epsg }
}

/**
 * The stationing a RoadEng alignment's own stations give a road: its start station, at `stationScale`
 * road chainage per file station metre. RoadEng's alignments carry no station equations.
 */
export function roadEngImpliedStationing(startStation: number, stationScale: number): RoadStationing {
  return scaleStationing({ startStation, equations: [] }, stationScale)
}

/**
 * Whether a road's stationing is what its RoadEng alignment's stations already give, within a
 * millionth of the chainage scale (the written plan's length, not the read one's, sets it on export):
 * the design then needs no `[PGMaps] Stationing`.
 */
export function isRoadEngImpliedStationing(
  stationing: RoadStationing | null | undefined,
  startStation: number,
  stationScale: number,
): boolean {
  const s = stationing ?? { startStation: 0, equations: [] }
  return (
    !s.equations.length &&
    Math.abs(s.startStation - startStation) <= 1e-9 * Math.max(1, Math.abs(startStation)) &&
    Math.abs((s.chainageScale ?? 1) - stationScale) <= 1e-6
  )
}

/**
 * The `108` curve design of each curve of a road built from its PIs, by the road point's id: what
 * `roadEngExport.ts` takes as `curves` to write it back. Empty for a road fitted to its stations,
 * whose points are not the design's PIs.
 */
export function roadEngCurvesByPoint(
  road: Pick<RoadEngRoad, 'alignment' | 'source'>,
): Record<string, RoadEngCurveFields> {
  const { points } = road.alignment
  const { pis } = road.source
  if (road.source.followsStations.plan || points.length !== pis.length + 2) return {}
  const out: Record<string, RoadEngCurveFields> = {}
  pis.forEach((pi, k) => {
    if (pi.curve) out[points[k + 1].id] = pi.curve
  })
  return out
}

/** One paragraph per road for the import notice: what was read, the checks and the scale. */
export function roadEngImportSummary(road: RoadEngRoad, design: RoadEngDesign): string {
  const c = road.source.checks
  const mm = (m: number) => `${(m * 1000).toFixed(1)} mm`
  const angles = road.source.pis.filter((p) => p.from === 'plan-station').length
  const curves = road.source.pis.length - angles
  const spirals = road.source.pis.filter((p) => p.spiral).length
  const parts = [
    `${road.alignment.name}: ${curves} PIs${angles ? ` and ${angles} angle point${angles === 1 ? '' : 's'}` : ''}${spirals ? ` (${spirals} spiral${spirals === 1 ? '' : 's'})` : ''}, ${road.alignment.vertical.length ? `${road.alignment.vertical.length} PVIs` : 'no design profile (its levels are ground)'}`,
    `stations ${road.source.startStation.toFixed(3)} to ${road.source.endStation.toFixed(3)} m (the road's own chainage starts at 0)`,
    road.fitDeviationM !== null
      ? `plan fitted to its ${c.planStations} design stations within ${road.fitDeviationM.toFixed(3)} m`
      : `plan rebuilt from its ${angles ? (curves ? 'PIs and the angle points at its plan stations' : 'angle points at its plan stations') : 'PIs'} within ${mm(c.planOffsetM)} of ${c.planStations} design stations (limit ${mm(ROADENG_PLAN_TOLERANCE_M)})`,
    ...(road.source.followsStations.profile
      ? ['profile follows their levels as straight grades']
      : c.profileDifferenceM !== null
        ? [`profile within ${mm(c.profileDifferenceM)} of their levels (limit ${mm(ROADENG_PROFILE_TOLERANCE_M)})`]
        : []),
    `road chainage ÷ design stations ${road.stationScale.toFixed(5)}`,
    ...(road.culverts?.length
      ? [`${road.culverts.length} placed culvert${road.culverts.length === 1 ? '' : 's'} read from its .ds1`]
      : []),
  ]
  const notes = [
    ...(design.version ? [`Written by RoadEng ${design.version}.`] : []),
    ...(design.terrain ? [`Its terrain, ${design.terrain}, is not read.`] : []),
  ]
  return `${parts.join('; ')}.${road.warnings.length ? ` ${road.warnings.join(' ')}` : ''}${notes.length ? ` ${notes.join(' ')}` : ''}`
}
