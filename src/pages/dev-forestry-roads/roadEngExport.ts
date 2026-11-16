/**
 * Roads written as a Softree RoadEng / Location design (`.dsnx`): the parts `roadEngImport.ts`
 * reads, laid out as RoadEng 11 writes them. Each road is one alignment (`Location1`, …) with
 *
 * - `.dsn`: `[Software]` RoadEng 11.0.673.0, `[design] units=10000` (metres) and the terrain file
 *   name when there is one, the road's name as `[HAlignOptions] Option, 1`, and `[PGMaps]`, the
 *   road's section and levels for this workspace, the costs RoadEng has no field for (`Costs`, from
 *   `roadEngHaulRecords` through the caller's `dsnOverrides`) and a fingerprint of the design's own
 *   parts as written (`Native`), by which a design RoadEng saved since is told apart;
 * - `.ds2`, in RoadEng's record order: `110` calculated stations, a `108` record per intersection
 *   point that carries a curve (signed radius, negative turning left, X, Y, and the curve's design
 *   fields), a `109` per vertical PI inside the road (signed vertical-curve radius, positive a sag,
 *   station, elevation), then RoadEng's default ground type and `118,1`;
 * - `.ds1`: the road's culverts as RoadEng's placed culverts (`roadEngPlacedCulverts.ts`), in three
 *   chunks as RoadEng 11 writes them (empty without culverts).
 *
 * **Stations** (`110`) are written as Softree's samples hold them (`roadeng-gaps-plan.md` §0): plan
 * points (Pt. Type 2) at the ends, at each curve's BC and EC (field 9 = 2; a spiral's TS, SC, CS and
 * ST, the ST marked, inferred) and at each angle point; profile points (1) at each BVC and EVC
 * (field 10 = 4); and report stations (4) on the design's two report intervals (bits 256 and 4096,
 * from `[ReportPointProperties]` when the design was read from RoadEng, else every
 * {@link ROADENG_EXPORT_STATION_M} and {@link ROADENG_EXPORT_MAJOR_STATION_M}), at the ends, at
 * superelevation transition points (2048: runout start, level, reverse crown and full super at each
 * end of a curve that has e and a transition) and at the caller's template-range, ground-layer and
 * pit boundaries (2, 16, 16384 and 32768, a {@link ROADENG_REPORT_PAIR_OFFSET} either side). A
 * profile point on a report station shares its record; plan points keep their own, as RoadEng 11
 * writes them. A bend with no curve gets no `108` record, only its plan station: RoadEng writes none
 * for one (the cul-de-sac sample), and the reader rebuilds it from the plan station.
 *
 * **Curves** (`108`): fields 8–18 come from the caller's per-curve values ({@link RoadEngCurveInput},
 * by road point id), else from the record the road was read from (matched by position within
 * {@link ROADENG_PI_MATCH_M}), else RoadEng's defaults; the side friction (16) is v²/(gR) − e and
 * field 11 the curve's f max. Fields 6, 7 and 19 on, which are not identified, go back as read; of
 * field 9's flag word only Use Minimum Radius (`useMinimumRadius`, only ever cleared), the Auto
 * method bit (`superelevationByTable`) and the inside Auto widening bit are ever changed, all read
 * from Softree's files. A spiralled curve is
 * written as curve type {@link ROADENG_SPIRAL_TYPE} with its spiral length as both transition
 * lengths (inferred; see `roadEngImport.ts`), so the transitions given for it are not written.
 *
 * **Kept parts.** A road read from a RoadEng design carries a {@link RoadEngSource}. Its `.dsn` is
 * then the original with only the keys this writer owns replaced or added ({@link mergeRoadEngIni}:
 * `[design] units` and `surface`, `[HAlignOptions] Option, 1`, `[PGMaps]`, and `[Software]` on the
 * first alignment when it has none), then the caller's `dsnOverrides`; its `.ds3` is the original
 * bytes and its `.ds1` too, with only the culvert records the road changed rewritten; its `.ds2`
 * is the regenerated 108/109/110 records in place of the old ones, with
 * every other record (the `100` header, `104` ground types, `118`, unknown types) as read, unless
 * `recordOverrides` replaces a type. Stations start at the design's own start station and lengths
 * are in its own units, so the kept template ranges and settings still apply. The software version
 * stays the original's: the kept sections are in that version's layout.
 *
 * Geometry is written in a projected grid, metres. Each curve keeps the tangent points the road
 * model gives it: its tangent length is scaled by the smaller grid-to-model ratio of its two legs
 * and its radius is the one that length gives at the grid's deflection, the inverse of
 * `gridAlignmentRoad`, so a design read back lands where it was; a spiralled curve's radius and
 * spiral are scaled by the mean of its legs' ratios. Stations are the road's chainage over the ratio
 * of its length to the grid plan's, the ratio the import multiplies by.
 *
 * Pure: no DOM or network access.
 */
import { hasStationing } from './roadStationing'
import { zipSync } from 'fflate'
import { alignmentLength, designProfileAt, horizontalCurveFits, planFrame } from './engine'
import type { XY } from './landXmlImport'
import {
  base64ToBytes,
  isRoadEngImpliedStationing,
  rebuildPlan,
  readRoadEngIni,
  roadEngNativeFingerprint,
  ROADENG_CIRCLE_TYPE,
  ROADENG_INTERVAL_BITS,
  ROADENG_REPORT_BITS,
  ROADENG_REPORT_PAIR_OFFSET,
  ROADENG_SPIRAL_TYPE,
  ROADENG_UNITS,
  type RoadEngCurveFields,
  type RoadEngPi,
  type RoadEngSource,
} from './roadEngImport'
import { roadEngUnitName } from './roadEngUnits'
import {
  ROADENG_AUTO_WIDENING_INSIDE_BIT,
  ROADENG_MINIMUM_RADIUS_BIT,
  ROADENG_TABLE_SUPERELEVATION_BIT,
} from './roadEngDesignSettings'
import { groundAlong } from './roadSummaryMetrics'
import type { Culvert } from './engineeringTypes'
import { emptyRoadEngIndex, writeDesignCulverts } from './roadEngPlacedCulverts'
import type { Alignment, Coordinate, RoadAnalysis } from './types'

/** Spacing of the first report interval written (bit 256) when the design states none, grid metres. */
export const ROADENG_EXPORT_STATION_M = 10
/** Spacing of the second report interval (bit 4096) when the design states none, grid metres. */
export const ROADENG_EXPORT_MAJOR_STATION_M = 50
/** Calculated stations one alignment may take; a finer interval is widened to stay within it. */
export const ROADENG_EXPORT_MAX_STATIONS = 200_000
/**
 * A curve's radius within this share of its read record's is the record's, written as read with its
 * side friction: rebuilding the plan in the grid moves a radius by up to about two parts in a million
 * (LongRoad: 0.47 mm on 340 m), and a radius edited in the workspace moves it far more.
 */
export const ROADENG_RADIUS_ROUNDING = 1e-5
/**
 * A written PI or VIP this close to its read record (plan position; station and level), m, is the
 * record's place, written with the record's own text. The rebuild through the map moves a PI by up
 * to 0.07 mm, and an imported level is rounded to the millimetre.
 */
export const ROADENG_RECORD_UNMOVED_M = 0.001
/**
 * A curve radius this close to its read record's, m, is the record's, whatever its share
 * ({@link ROADENG_RADIUS_ROUNDING}): Location 18's 35 m curves rebuild 0.47 mm off (13 parts in a
 * million), and bluff_road's first, its PI 43 m from the road's start, 3.4 mm off.
 */
export const ROADENG_RADIUS_KEPT_M = 0.005
/**
 * A vertical curve whose length is within this share (or a millimetre) of the one its read record
 * gives over the records' own grades, as the import made it, keeps the record's radius: an imported
 * level's millimetre rounding moves the written grade change, and with it the radius, by 10⁻⁴ (Align
 * stage 4) to 3 % (Hart Rd curves' near-level crests).
 */
export const ROADENG_VERTICAL_CURVE_KEPT = 1e-3
/** A written PI takes the unidentified fields of the read `108` record within this distance, m. */
export const ROADENG_PI_MATCH_M = 1
/** A written VIP takes the unidentified fields of the read `109` record within this many metres of station. */
export const ROADENG_VIP_MATCH_M = 1
/** A PVI this close to an end is that end: imported chainages are rounded to the millimetre. */
const END_TOLERANCE_M = 0.002
/** RoadEng's design speed field default, m/s. */
const DEFAULT_DESIGN_SPEED_MS = 50 / 3.6
const GRAVITY = 9.81
const VERSION = '11.0.673.0'
const HEADER = `100,103,11,${VERSION}, Softree Technical Systems Inc. - Location Line data file`.padEnd(126, ' ')
/** RoadEng's default overburden, the material every design carries. */
const OVERBURDEN = '104,OB,Overburden (Default),100,400,1,1,12,4,0,8,0.6,4,2.6,2,0,0,0,8,'
/** `108` fields 6 on that RoadEng writes for a new circular curve (RoadEng 11). */
const DEFAULT_108_TAIL = ['0', '-1', '', '5590', '0.06', '0.1', '0', '0', '0.667', '0', '0', '0', '0', '0']
/** `109` fields 6–11 that RoadEng writes for a VIP without a stated length. */
const DEFAULT_109_TAIL = ['0', '-1', '', '0', '0', '-1']

/** A curve's design for its `108` record; any value left out comes from the read record or RoadEng's default. */
export interface RoadEngCurveInput extends Omit<RoadEngCurveFields, 'widening'> {
  /** Inside and outside widening, m; one number for both. */
  widening?: number | { insideM: number; outsideM: number }
  /**
   * RoadEng's Use Minimum Radius for the curve (bit {@link ROADENG_MINIMUM_RADIUS_BIT} of field 9,
   * read from Softree's files), which holds its e at e max and lets RoadEng solve the radius or
   * speed again. Applied after `flags`; left out, the flag word is the record's or RoadEng's
   * default. PGMaps only ever clears it: a new curve never takes the default word's (5590).
   */
  useMinimumRadius?: boolean
  /**
   * Which method RoadEng's Auto uses (bit {@link ROADENG_TABLE_SUPERELEVATION_BIT} of field 9, read
   * from Softree's samples): true the superelevation table, false the side friction method. Applied
   * after `flags`; left out, the record's or RoadEng's default.
   */
  superelevationByTable?: boolean
  /**
   * RoadEng's Auto widening on the curve's inside (bit {@link ROADENG_AUTO_WIDENING_INSIDE_BIT} of
   * field 9, read from Softree's samples): on where the inside widening is the widening table's, so
   * RoadEng reads it from its table; off keeps the written value. Applied after `flags`.
   */
  autoWideningInside?: boolean
}

/** A boundary to flag on the stations, at the road's chainage, m. */
export interface RoadEngReportEvent {
  chainageM: number
  kind: 'template-range' | 'ground-layer-range' | 'pit'
}

/** `.dsn` keys to set (a string) or remove (null), by section then key: {@link mergeRoadEngIni} applies them. */
export type RoadEngDsnOverrides = Record<string, Record<string, string | null>>

export interface RoadEngExportRoad {
  alignment: Alignment
  /** Its calculated stations; ground levels come from here when the road has no profile. */
  analysis?: Pick<RoadAnalysis, 'stations'>
  /** What the RoadEng design this road was read from held besides the road (`RoadEngAlignment.source`). */
  source?: RoadEngSource | null
  /** Each curve's `108` design values, by the road point's id (`roadEngCurvesByPoint` for a read design). */
  curves?: Readonly<Record<string, RoadEngCurveInput>>
  /** Template-range, ground-layer and pit boundaries to flag on the stations. */
  reportEvents?: readonly RoadEngReportEvent[]
  /** `.dsn` keys set after the writer's own. */
  dsnOverrides?: RoadEngDsnOverrides
  /** `.ds2` lines replacing every kept record of a type, by type (`104`, `118`, …); never 108, 109 or 110. */
  recordOverrides?: Readonly<Record<string, readonly string[]>>
  /** This road's own grid, when it differs from the archive's: the CRS its RoadEng source was read in. */
  toGrid?: (coordinate: Coordinate) => XY
}

/** The station frame a road is written in (`.ds2` `110` stations): what kept settings must be placed by. */
export interface RoadEngWrittenFrame {
  /** Design station of the road's start, m. */
  startStation: number
  /** Design station of its end, m. */
  endStation: number
  /** Road chainage ÷ design stations. */
  stationScale: number
  /** The grid plan's length, m. */
  planLength: number
}

export interface RoadEngExport {
  bytes: Uint8Array
  /** The text parts as written, by name, for a preview. */
  parts: Record<string, string>
  /** What the notice says about the roads written. */
  notes: string[]
}

export interface RoadEngAlignmentParts {
  dsn: string
  ds2: string
  /** `.ds1` bytes: the source's with the road's culverts written into it, else RoadEng's empty chunks and the road's culverts. */
  ds1: Uint8Array
  /** `.ds3` bytes, the source's; null without one. */
  ds3: Uint8Array | null
  notes: string[]
}

/** Up to six decimals, no exponent, no trailing zeros. */
function num(value: number): string {
  const text = value.toFixed(6).replace(/\.?0+$/, '')
  return text === '-0' ? '0' : text
}

/** Latin-1 bytes of text; a character outside Latin-1 becomes `?`. */
export function latin1Bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    out[i] = code > 255 ? 0x3f : code
  }
  return out
}

/** JSON whose characters outside Latin-1 are `\u` escapes, so it survives a Latin-1 file unchanged. */
function latin1Json(value: unknown): string {
  return [...JSON.stringify(value)]
    .map((c) => {
      const code = c.charCodeAt(0)
      if (code < 256) return c
      let escaped = ''
      for (let i = 0; i < c.length; i++) escaped += `\\u${c.charCodeAt(i).toString(16).padStart(4, '0')}`
      return escaped
    })
    .join('')
}

/** A numbered key or section's family and number: `OptParms_Pit-12` → [`optparms_pit-`, 12]. */
function numbered(name: string): [string, number] | null {
  const m = /^(.*?)(\d+)$/.exec(name.trim().toLowerCase())
  return m && m[1] ? [m[1], Number(m[2])] : null
}

/**
 * INI text with keys set (a string) or removed (null), touching nothing else: every other line,
 * the order of sections and keys, and the line ending stay as they are. Sections and keys match
 * without regard to case, as Windows reads them; a key keeps its original spelling. A changed key is
 * changed wherever its section repeats. A new key goes into the section's last occurrence, after the
 * last key of its numbered family with a lower number (`OptParms_Pit-3` after `OptParms_Pit-2`),
 * else after the section's last key; a new section goes after the last section of its family with a
 * lower number (`OptAlignCost-2` after `OptAlignCost-1`), else at the end. A section whose keys these
 * edits remove entirely is removed with them. Line breaks in a value become spaces. The text is
 * Latin-1 as read (`strFromU8(bytes, true)`); write it back with {@link latin1Bytes}. This is the one
 * `.dsn` editor: the optimizer, haul and section write-backs all apply their overrides through it.
 */
export function mergeRoadEngIni(text: string, edits: RoadEngDsnOverrides): string {
  const eol = text.includes('\r\n') ? '\r\n' : text.includes('\n') ? '\n' : '\r\n'
  let lines = text.length ? text.split(/\r?\n/) : []
  const endsWithEol = lines.length > 0 && lines[lines.length - 1] === ''
  if (endsWithEol) lines.pop()
  const clean = (value: string) => value.replace(/[\r\n]+/g, ' ')
  const isHeader = (line: string) => /^\s*\[.+\]\s*$/.test(line)
  const headerName = (line: string) => /^\s*\[(.+)\]\s*$/.exec(line)![1].trim()
  const keyOf = (line: string) => {
    const eq = line.indexOf('=')
    return eq > 0 && !/^\s*[;#]/.test(line) ? line.slice(0, eq).trim() : null
  }
  for (const [section, keys] of Object.entries(edits)) {
    if (/[\r\n\]]/.test(section)) throw Error(`"${section}" cannot be an INI section name.`)
    for (const key of Object.keys(keys))
      if (/[\r\n=]/.test(key) || !key.trim()) throw Error(`"${key}" cannot be an INI key.`)
    const wanted = section.trim().toLowerCase()
    // Each section occurrence: [header line, end of its body).
    const all: { name: string; from: number; to: number }[] = []
    for (let i = 0; i < lines.length; i++) {
      if (!isHeader(lines[i])) continue
      if (all.length) all[all.length - 1].to = i
      all.push({ name: headerName(lines[i]), from: i, to: lines.length })
    }
    const spans = all.filter((o) => o.name.toLowerCase() === wanted)
    const edited: (string | null)[] = [...lines]
    const found = new Set<string>()
    const emptied: { from: number; to: number }[] = []
    for (const { from, to } of spans) {
      let had = 0,
        left = 0
      for (let i = from + 1; i < to; i++) {
        const name = keyOf(lines[i])?.toLowerCase()
        if (name === undefined) continue
        had++
        const key = Object.keys(keys).find((k) => k.trim().toLowerCase() === name)
        if (key === undefined) {
          left++
          continue
        }
        found.add(key)
        const value = keys[key]
        if (value === null) edited[i] = null
        else {
          edited[i] = `${lines[i].slice(0, lines[i].indexOf('='))}=${clean(value)}`
          left++
        }
      }
      if (had > 0 && left === 0) emptied.push({ from, to })
    }
    const added = Object.entries(keys)
      .filter(([key, value]) => value !== null && !found.has(key))
      .map(([key, value]) => ({ key, line: `${key}=${clean(value!)}` }))
    // Inserts are placed by original line index; splice from the end so indices stay valid.
    const inserts: { at: number; lines: string[] }[] = []
    if (added.length && spans.length) {
      const { from, to } = spans[spans.length - 1]
      if (emptied.some((e) => e.from === from)) emptied.pop()
      let lastKey = from
      for (let i = from + 1; i < to; i++) if (keyOf(lines[i]) !== null) lastKey = i
      for (const { key, line } of added) {
        const family = numbered(key)
        let at = -1
        if (family)
          for (let i = from + 1; i < to; i++) {
            const other = keyOf(lines[i])
            const theirs = other === null ? null : numbered(other)
            if (theirs && theirs[0] === family[0] && theirs[1] < family[1]) at = i
          }
        inserts.push({ at: (at >= 0 ? at : lastKey) + 1, lines: [line] })
      }
    } else if (added.length) {
      const family = numbered(section)
      let after = -1
      if (family)
        for (const o of all) {
          const theirs = numbered(o.name)
          if (theirs && theirs[0] === family[0] && theirs[1] < family[1]) after = o.to
        }
      // Before the blank lines that end the section it follows.
      if (after >= 0) while (after > 0 && lines[after - 1].trim() === '' && !isHeader(lines[after - 1])) after--
      inserts.push({ at: after >= 0 ? after : lines.length, lines: [`[${section}]`, ...added.map((a) => a.line)] })
    }
    for (const { from, to } of emptied) for (let i = from; i < to; i++) edited[i] = null
    // Keys added at the same place keep the order they were given in.
    const byPlace = new Map<number, string[]>()
    for (const insert of inserts) byPlace.set(insert.at, [...(byPlace.get(insert.at) ?? []), ...insert.lines])
    const out: string[] = []
    for (let i = 0; i <= edited.length; i++) {
      out.push(...(byPlace.get(i) ?? []))
      if (i < edited.length && edited[i] !== null) out.push(edited[i]!)
    }
    lines = out
  }
  return lines.join(eol) + (endsWithEol || !text.length ? eol : '')
}

const deflection = (xy: readonly XY[], k: number) => {
  const a = Math.atan2(xy[k][1] - xy[k - 1][1], xy[k][0] - xy[k - 1][0]),
    b = Math.atan2(xy[k + 1][1] - xy[k][1], xy[k + 1][0] - xy[k][0])
  return Math.atan2(Math.sin(b - a), Math.cos(b - a))
}

/** The two report intervals of a `.dsn`'s `[ReportPointProperties]`, in project units; null when off or absent. */
function reportIntervals(dsn: string | undefined): { first: number | null; second: number | null } | null {
  if (!dsn) return null
  const section = readRoadEngIni(dsn).get('ReportPointProperties')
  if (!section) return null
  const item = (key: string) => {
    const f = (section.get(key) ?? '').split(',')
    const interval = Number(f[4])
    return f[7]?.trim() === '1' && Number.isFinite(interval) && interval > 0 ? interval : null
  }
  return { first: item('Item09'), second: item('Item13') }
}

/** The road's name as RoadEng shows it: the original's own when the road was not renamed after import. */
function writtenName(alignment: Alignment, source: RoadEngSource | null | undefined): string {
  const original = source ? readRoadEngIni(source.dsn).get('HAlignOptions')?.get('Option, 1') : undefined
  const name =
    original && (alignment.name === original || alignment.name.endsWith(` · ${original}`)) ? original : alignment.name
  return (
    name
      .replace(/[\r\n[\]=]+/g, ' ')
      .replace(/[^\s!-~\u00a0-\u00ff]/g, '?')
      .trim()
      .slice(0, 120) || 'PG Maps road'
  )
}

interface Row {
  station: number
  type: number
  planMark: number
  profileMark: number
  report: number
  /** Order at a shared station: lower first. */
  order: number
}

/** The road as RoadEng PIs in a grid, and the plan they rebuild: what every written station follows. */
/**
 * Each curve's radius as written in the design's grid, m, by road point id: the radius RoadEng reads
 * its lookup tables and side friction method at, so a curve's superelevation can be taken there
 * before it is written. With the design's `108` records (`kept`), a curve the writer matches to a
 * record whose radius it keeps (within {@link ROADENG_RADIUS_ROUNDING} or
 * {@link ROADENG_RADIUS_KEPT_M}) takes that record's radius, the one RoadEng reads back.
 */
export function roadEngWrittenRadii(
  alignment: Alignment,
  toGrid: (coordinate: Coordinate) => XY,
  kept?: { records: readonly (readonly string[])[]; unitM: number },
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const pi of writtenPlan(alignment, toGrid).pis) {
    if (!(pi.radiusM > 0)) continue
    out[pi.pointId] = pi.radiusM
    if (!kept) continue
    const unit = kept.unitM
    let best: readonly string[] | null = null,
      far = ROADENG_PI_MATCH_M
    for (const f of kept.records) {
      const d = Math.hypot(Number(f[4]) * unit - pi.xy[0], Number(f[5]) * unit - pi.xy[1])
      if (d <= far) [best, far] = [f, d]
    }
    const read = best ? Math.abs(Number(best[3])) : NaN
    const units = pi.radiusM / unit
    if (
      read > 0 &&
      Math.abs(read - units) <= Math.max(ROADENG_RADIUS_ROUNDING * Math.max(1, units), ROADENG_RADIUS_KEPT_M / unit)
    )
      out[pi.pointId] = read * unit
  }
  return out
}

function writtenPlan(alignment: Alignment, toGrid: (coordinate: Coordinate) => XY) {
  const points = alignment.points
  const grid = points.map((p) => toGrid(p.coordinate))
  const plane = planFrame(points[0].coordinate)
  const model = points.map((p) => plane.toXY(p.coordinate))
  const leg = (xy: readonly XY[], k: number) => Math.hypot(xy[k + 1][0] - xy[k][0], xy[k + 1][1] - xy[k][1])
  const fits = new Map(horizontalCurveFits(alignment).map((fit) => [fit.point, fit]))

  // Each interior point, a curve or an angle point.
  const pis: (RoadEngPi & { pointId: string })[] = []
  for (let k = 1; k < points.length - 1; k++) {
    const fit = fits.get(k + 1)
    const turn = deflection(grid, k)
    let radiusM = 0
    let spiral: RoadEngPi['spiral']
    if (fit?.status === 'fitted' && fit.tangentM > 0 && Math.abs(turn) > 1e-9) {
      const back = leg(model, k - 1) / leg(grid, k - 1),
        ahead = leg(model, k) / leg(grid, k)
      const spiralM = points[k].spiralM ?? 0
      if (spiralM > 0 && spiralM / points[k].radiusM < Math.abs(turn) - 1e-6) {
        const mean = (back + ahead) / 2
        radiusM = points[k].radiusM / mean
        spiral = { inM: spiralM / mean, outM: spiralM / mean }
      } else radiusM = fit.tangentM / Math.min(back, ahead) / Math.tan(Math.abs(turn) / 2)
    }
    pis.push({
      xy: grid[k],
      radiusM,
      turn: turn > 0 ? 'left' : 'right',
      type: spiral ? ROADENG_SPIRAL_TYPE : radiusM > 0 ? ROADENG_CIRCLE_TYPE : 0,
      ...(spiral ? { spiral } : {}),
      from: radiusM > 0 ? '108' : 'plan-station',
      pointId: points[k].id,
    })
  }
  const plan = rebuildPlan({ xy: grid[0], station: 0 }, pis, { xy: grid[grid.length - 1] })
  return { grid, pis, plan }
}

/**
 * The station frame {@link roadEngAlignmentParts} writes a road in: from its RoadEng source's first
 * station (else 0), the grid plan's length, and road chainage over it.
 */
export function roadEngWrittenFrame(
  road: Pick<RoadEngExportRoad, 'alignment' | 'source' | 'toGrid'>,
  toGrid: (coordinate: Coordinate) => XY,
): RoadEngWrittenFrame {
  const { plan } = writtenPlan(road.alignment, road.toGrid ?? toGrid)
  const startStation = writtenStartStation(road)
  const length = alignmentLength(road.alignment)
  return {
    startStation,
    endStation: startStation + plan.length,
    stationScale: plan.length > 0 ? length / plan.length : 1,
    planLength: plan.length,
  }
}

/**
 * The L-line start station a road is written from: its RoadEng source's (ranges kept from the design
 * are placed by it), else the road's own start station (`Alignment.stationing`), else 0. RoadEng's
 * alignments have no station equations; the road's travel in `[PGMaps] Stationing`.
 */
function writtenStartStation(road: Pick<RoadEngExportRoad, 'alignment' | 'source'>): number {
  if (road.source) return road.source.startStation
  return hasStationing(road.alignment.stationing) ? road.alignment.stationing.startStation : 0
}

/** One road's `.dsn`, `.ds2`, `.ds1` and `.ds3`. */
export function roadEngAlignmentParts(
  road: RoadEngExportRoad,
  toGrid: (coordinate: Coordinate) => XY,
  options: {
    terrainName?: string
    designSpeedKmh?: number
    /** `[design] units` code to write in: the archive's. Default the source's, else metres. */
    unitCode?: string
    /** Whether this is the archive's first alignment, which carries the design-wide settings. Default true. */
    first?: boolean
  } = {},
): RoadEngAlignmentParts {
  const { alignment, source } = road
  const notes: string[] = []
  const unitCode = options.unitCode ?? source?.unitCode ?? '10000'
  const unit = ROADENG_UNITS[unitCode]
  if (unit === undefined) throw Error(`RoadEng units code ${unitCode} is not one this writer writes.`)
  const first = options.first ?? true
  const points = alignment.points
  if (points.length < 2) throw Error(`${alignment.name} needs at least two points to export.`)
  for (const type of Object.keys(road.recordOverrides ?? {}))
    if (['108', '109', '110'].includes(type))
      throw Error(`The ${type} records are written from the road, not replaced.`)
  const { pis, plan } = writtenPlan(alignment, road.toGrid ?? toGrid)
  const spiralCount = pis.filter((p) => p.spiral).length
  if (spiralCount)
    notes.push(
      `${alignment.name}: ${spiralCount === 1 ? '1 spiralled curve is' : `${spiralCount} spiralled curves are`} written as RoadEng spiral curves (type ${ROADENG_SPIRAL_TYPE}), the spiral its transition length at both ends.`,
    )
  const length = alignmentLength(alignment)
  const ratio = plan.length > 0 ? length / plan.length : 1
  const profiled = alignment.vertical.length >= 2
  // RoadEng's profile is the finished surface; this workspace's is the subgrade under the courses.
  const surfacing = profiled ? centreSurfacingM(alignment) : 0
  const stations = road.analysis?.stations ?? []
  const ground = (chainage: number) => {
    let best: number | null = null,
      far = Infinity
    for (const s of stations)
      if (s.groundElevation !== null && Math.abs(s.chainage - chainage) < far) {
        far = Math.abs(s.chainage - chainage)
        best = s.groundElevation
      }
    // A design-only road keeps the ground its design file recorded (`fileGround`).
    if (best !== null) return best
    // Its chainages are rounded to the millimetre, so the ends may fall a little outside them.
    const file = alignment.fileGround?.points ?? []
    const within =
      file.length >= 2 ? Math.min(file[file.length - 1][0], Math.max(file[0][0], chainage)) - chainage : Infinity
    return Math.abs(within) <= END_TOLERANCE_M ? groundAlong(file, chainage + within) : null
  }
  const level = (station: number) => {
    if (!profiled) return ground(station * ratio)
    const subgrade = designProfileAt(alignment, Math.min(length, station * ratio))?.elevation
    return subgrade === undefined ? null : subgrade + surfacing
  }

  // Curve design per curve: the caller's values over the read record over RoadEng's defaults.
  const speedDefault = (options.designSpeedKmh ?? DEFAULT_DESIGN_SPEED_MS * 3.6) / 3.6
  const piRecords = (source?.piRecords ?? []).map((line) => line.split(','))
  const recordAt = (xy: XY) => {
    let best: string[] | null = null,
      far = ROADENG_PI_MATCH_M
    for (const f of piRecords) {
      const d = Math.hypot(Number(f[4]) * unit - xy[0], Number(f[5]) * unit - xy[1])
      if (d <= far) [best, far] = [f, d]
    }
    return best
  }
  const curveFor = new Map<number, { e: number; transitionFraction: number; runoffIn: number; runoffOut: number }>()
  const rows108: string[] = []
  pis.forEach((pi, k) => {
    if (pi.radiusM <= 0) return
    const matched = recordAt(pi.xy)
    const f = matched ? [...matched] : ['108', '', '', '', '', '', ...DEFAULT_108_TAIL]
    while (f.length < 20) f.push('0')
    const given = road.curves?.[pi.pointId] ?? {}
    const field = (i: number, fallback: number) => {
      const v = Number(f[i])
      return f[i] !== undefined && f[i].trim() !== '' && Number.isFinite(v) ? v : fallback
    }
    const radiusUnits = pi.radiusM / unit
    const matchedRadius = matched ? Math.abs(Number(matched[3])) : NaN
    f[1] = String(rows108.length + 1)
    f[2] = pi.spiral
      ? matched && Number(matched[2]) !== ROADENG_CIRCLE_TYPE
        ? matched[2]
        : String(ROADENG_SPIRAL_TYPE)
      : String(ROADENG_CIRCLE_TYPE)
    // A radius the plan rebuilds within rounding of the record's is the record's: it is the same curve.
    const sameRadius =
      matched &&
      Math.abs(matchedRadius - radiusUnits) <=
        Math.max(ROADENG_RADIUS_ROUNDING * Math.max(1, radiusUnits), ROADENG_RADIUS_KEPT_M / unit)
    f[3] =
      sameRadius && Math.sign(Number(matched[3])) === (pi.turn === 'left' ? -1 : 1)
        ? matched[3]
        : num(pi.turn === 'left' ? -radiusUnits : radiusUnits)
    // A PI where its record has it keeps the record's text.
    const samePlace =
      matched &&
      Math.hypot(Number(matched[4]) * unit - pi.xy[0], Number(matched[5]) * unit - pi.xy[1]) <= ROADENG_RECORD_UNMOVED_M
    if (!samePlace) {
      f[4] = num(pi.xy[0] / unit)
      f[5] = num(pi.xy[1] / unit)
    }
    const set = (i: number, value: number | undefined, scale = 1) => {
      if (value !== undefined && Number.isFinite(value)) f[i] = num(value / scale)
    }
    if (!matched) f[8] = num(speedDefault / unit)
    set(8, given.designSpeedMs, unit)
    set(9, given.flags)
    set(10, given.emax)
    set(11, given.fLimit)
    set(12, given.runoffIn, unit)
    set(13, given.runoffOut, unit)
    set(14, given.transitionFraction)
    set(15, given.e)
    if (given.useMinimumRadius !== undefined && Number.isInteger(Number(f[9])))
      f[9] = String(
        given.useMinimumRadius ? Number(f[9]) | ROADENG_MINIMUM_RADIUS_BIT : Number(f[9]) & ~ROADENG_MINIMUM_RADIUS_BIT,
      )
    if (given.superelevationByTable !== undefined && Number.isInteger(Number(f[9])))
      f[9] = String(
        given.superelevationByTable
          ? Number(f[9]) | ROADENG_TABLE_SUPERELEVATION_BIT
          : Number(f[9]) & ~ROADENG_TABLE_SUPERELEVATION_BIT,
      )
    if (given.autoWideningInside !== undefined && Number.isInteger(Number(f[9])))
      f[9] = String(
        given.autoWideningInside
          ? Number(f[9]) | ROADENG_AUTO_WIDENING_INSIDE_BIT
          : Number(f[9]) & ~ROADENG_AUTO_WIDENING_INSIDE_BIT,
      )
    if (given.widening !== undefined) {
      const w =
        typeof given.widening === 'number' ? { insideM: given.widening, outsideM: given.widening } : given.widening
      set(17, w.insideM, unit)
      set(18, w.outsideM, unit)
    }
    if (pi.spiral) {
      f[12] = num(pi.spiral.inM / unit)
      f[13] = num(pi.spiral.outM / unit)
    }
    // Side friction demanded, recomputed unless the record read already holds it for this curve.
    const speed = field(8, speedDefault / unit) * unit
    const e = field(15, 0)
    const unchanged =
      sameRadius && given.designSpeedMs === undefined && given.e === undefined && given.sideFriction === undefined
    if (given.sideFriction !== undefined) set(16, given.sideFriction)
    else if (!unchanged) f[16] = num((speed * speed) / (GRAVITY * pi.radiusM) - e)
    rows108.push(f.join(','))
    curveFor.set(k, {
      e,
      transitionFraction: field(14, 0.667),
      runoffIn: field(12, 0) * unit,
      runoffOut: field(13, 0) * unit,
    })
  })

  // Calculated stations, in grid metres from the start.
  const report = new Map<number, Row>()
  const extra: Row[] = []
  const key = (s: number) => Math.round(s * 1e6)
  const inside = (s: number) => s >= -1e-9 && s <= plan.length + 1e-9
  const addReport = (station: number, bits: number) => {
    if (!inside(station)) return
    const s = Math.min(plan.length, Math.max(0, station))
    const row = report.get(key(s))
    if (row) row.report |= bits
    else report.set(key(s), { station: s, type: 4, planMark: 0, profileMark: 0, report: bits, order: 1 })
  }
  const startStation = writtenStartStation(road)
  const startUnits = startStation / unit
  const intervals = reportIntervals(source?.dsn) ?? {
    first: ROADENG_EXPORT_STATION_M / unit,
    second: ROADENG_EXPORT_MAJOR_STATION_M / unit,
  }
  const { first: firstBit, second: secondBit, cost } = ROADENG_INTERVAL_BITS
  for (const [interval, bit] of [
    [intervals.first, firstBit],
    [intervals.second, secondBit],
  ] as const) {
    if (!interval) continue
    const lengthUnits = plan.length / unit
    const step = Math.max(interval, lengthUnits / ROADENG_EXPORT_MAX_STATIONS)
    for (let n = Math.ceil(startUnits / step); n * step < startUnits + lengthUnits; n++) {
      const s = (n * step - startUnits) * unit
      if (s > 1e-9) addReport(s, bit | cost)
    }
  }
  addReport(0, firstBit | secondBit | cost | 1024)
  addReport(plan.length, firstBit | secondBit | cost)
  // Superelevation transitions: runout start, level, reverse crown and full super at each end.
  const crown =
    Math.max(
      Math.abs(alignment.template.leftCrossfallPercent ?? alignment.template.crossfallPercent),
      Math.abs(alignment.template.rightCrossfallPercent ?? alignment.template.crossfallPercent),
    ) / 100
  for (const c of plan.curves) {
    const design = curveFor.get(c.pi)
    if (!design || !(design.e > 0)) continue
    const ends: [number, number, 1 | -1, number][] = [
      [c.start, c.spiralIn || design.runoffIn, 1, c.spiralIn],
      [c.end, c.spiralOut || design.runoffOut, -1, c.spiralOut],
    ]
    for (const [at, transition, into, spiral] of ends) {
      if (!(transition > 0)) continue
      const outside = spiral > 0 ? 0 : design.transitionFraction * transition
      const level = at - into * outside
      const runout = (transition * crown) / design.e
      for (const s of [level - into * runout, level, level + into * runout, level + into * transition])
        addReport(s, ROADENG_REPORT_BITS.superelevation)
    }
  }
  // The caller's boundaries, at the road's chainage.
  const pair = ROADENG_REPORT_PAIR_OFFSET * unit
  for (const event of road.reportEvents ?? []) {
    if (!Number.isFinite(event.chainageM)) continue
    const s = event.chainageM / ratio
    const bit = ROADENG_REPORT_BITS[event.kind === 'pit' ? 'pit-range' : event.kind]
    addReport(s - pair, bit)
    addReport(s + pair, bit)
    if (event.kind === 'pit') addReport(s, ROADENG_REPORT_BITS.pit)
  }
  // Profile points: the ends, each BVC and EVC; on a report station they share its record.
  const addProfile = (station: number, mark: number) => {
    if (!inside(station)) return
    const s = Math.min(plan.length, Math.max(0, station))
    const row = report.get(key(s))
    if (row) {
      row.type |= 1
      row.profileMark = row.profileMark || mark
    } else extra.push({ station: s, type: 1, planMark: 0, profileMark: mark, report: 0, order: 1 })
  }
  if (profiled) {
    addProfile(0, 0)
    addProfile(plan.length, 0)
  }
  // Vertical PIs inside the road; its ends are the first and last stations' levels.
  const vertical = profiled
    ? [...alignment.vertical]
        .sort((a, b) => a.chainage - b.chainage)
        .filter((p) => p.chainage > END_TOLERANCE_M && p.chainage < length - END_TOLERANCE_M)
        .map((p) => ({
          station: p.chainage / ratio,
          elevation: p.elevation + surfacing,
          curveLength: p.curveLength / ratio,
        }))
    : []
  for (const p of vertical) {
    addProfile(p.station - p.curveLength / 2, 0)
    addProfile(p.station + p.curveLength / 2, 4)
  }
  // Plan points: the ends, each curve's tangent points (EC marked) and each angle point.
  const plans: Row[] = [
    { station: 0, type: 2, planMark: 0, profileMark: 0, report: 0, order: 0 },
    { station: plan.length, type: 2, planMark: 0, profileMark: 0, report: 0, order: 2 },
  ]
  const planPoint = (station: number, planMark = 0) =>
    plans.push({ station, type: 2, planMark, profileMark: 0, report: 0, order: 0 })
  for (const c of plan.curves) {
    planPoint(c.start)
    if (c.spiralIn > 0) planPoint(c.start + c.spiralIn)
    if (c.spiralOut > 0) planPoint(c.end - c.spiralOut)
    planPoint(c.end, 2)
  }
  for (const a of plan.angles) planPoint(a.station)

  const rows = [...plans, ...report.values(), ...extra].sort((a, b) => a.station - b.station || a.order - b.order)
  const rows110: string[] = []
  let skipped = 0
  for (const row of rows) {
    const z = level(row.station)
    const end = row.station === 0 || row.station === plan.length
    if (z === null || !Number.isFinite(z)) {
      if (end) throw Error(`${alignment.name} has no ${profiled ? 'design' : 'ground'} level at its ends to export.`)
      skipped++
      continue
    }
    const [x, y] = plan.at(row.station)
    rows110.push(
      `110,${row.type},${num(x / unit)},${num(y / unit)},${num(z / unit)},${num((startStation + row.station) / unit)},-1,0,0,${row.planMark || ''},${row.profileMark || ''},${row.report}`,
    )
  }
  if (skipped) notes.push(`${alignment.name}: ${skipped} stations without a ground level are left out.`)
  if (!profiled) notes.push(`${alignment.name} has no design profile: its stations carry ground levels.`)
  else if (surfacing > 0)
    notes.push(
      `${alignment.name}'s levels are its finished surface, ${surfacing.toFixed(2)} m of surfacing above the subgrade.`,
    )

  const rows109: string[] = []
  if (profiled) {
    const vipRecords = (source?.vipRecords ?? []).map((line) => line.split(','))
    const profile = [
      { station: 0, elevation: level(0)!, curveLength: 0 },
      ...vertical,
      { station: plan.length, elevation: level(plan.length)!, curveLength: 0 },
    ]
    // Each VIP's read record: the nearest within the match distance.
    const matches = profile.map((p, k) => {
      if (k === 0 || k === profile.length - 1) return null
      let matched: string[] | null = null,
        far = ROADENG_VIP_MATCH_M
      for (const f of vipRecords) {
        const d = Math.abs(Number(f[4]) * unit - (startStation + p.station))
        if (d <= far) [matched, far] = [f, d]
      }
      return matched
    })
    // Where a point is, by its record when it has one: the grades the import took its curves from.
    const recordAt = (k: number) => {
      const f = matches[k]
      return f
        ? { station: Number(f[4]) * unit - startStation, elevation: Number(f[5]) * unit }
        : { station: profile[k].station, elevation: profile[k].elevation }
    }
    for (let k = 1; k < profile.length - 1; k++) {
      const p = profile[k]
      const into = (p.elevation - profile[k - 1].elevation) / (p.station - profile[k - 1].station)
      const out = (profile[k + 1].elevation - p.elevation) / (profile[k + 1].station - p.station)
      const change = out - into
      const radius = p.curveLength > 0 && Math.abs(change) > 1e-12 ? p.curveLength / change : 0
      const matched = matches[k]
      const tail = matched ? matched.slice(6) : [...DEFAULT_109_TAIL]
      while (tail.length < 6) tail.push('')
      if (!matched) tail[2] = num(speedDefault / unit)
      // A VIP where its record has it, with the curve its record gives over the records' grades (as
      // the import made it), is written with the record's text.
      const same = (i: number, value: number) =>
        !!matched && Math.abs(Number(matched[i]) * unit - value) <= ROADENG_RECORD_UNMOVED_M
      const samePlace = same(4, startStation + p.station) && same(5, p.elevation)
      let sameCurve = false
      if (matched && samePlace) {
        const [a, b, c] = [recordAt(k - 1), recordAt(k), recordAt(k + 1)]
        const recordLength = Math.abs(
          Number(matched[3]) *
            unit *
            ((c.elevation - b.elevation) / (c.station - b.station) -
              (b.elevation - a.elevation) / (b.station - a.station)),
        )
        sameCurve =
          Number(matched[3]) === 0
            ? p.curveLength === 0
            : Math.abs(recordLength - p.curveLength) <=
              Math.max(ROADENG_RECORD_UNMOVED_M, ROADENG_VERTICAL_CURVE_KEPT * p.curveLength)
      }
      // A stated curve length (field 11) follows the curve; an unchanged curve keeps the record's,
      // which the import does not use (it reads the length from the radius and the grades, and Road6
      // - 16 in Softree's V10 tutorials states 412 ft where its radius gives 412.05 ft).
      if (
        !(samePlace && sameCurve) &&
        Number(tail[5]) > 0 &&
        Math.abs(Number(tail[5]) * unit - p.curveLength) > ROADENG_RECORD_UNMOVED_M
      )
        tail[5] = num(p.curveLength / unit)
      rows109.push(
        [
          '109',
          k,
          matched?.[2] ?? '4',
          sameCurve ? matched![3] : num(radius / unit),
          samePlace ? matched![4] : num((startStation + p.station) / unit),
          samePlace ? matched![5] : num(p.elevation / unit),
          ...tail,
        ].join(','),
      )
    }
  }

  // The kept records around the regenerated ones, with the caller's replacements.
  const eol = source?.ds2Eol ?? '\r\n'
  let before = source ? source.ds2Kept.slice(0, source.ds2KeptBefore) : [HEADER]
  let after = source ? source.ds2Kept.slice(source.ds2KeptBefore) : [OVERBURDEN, '118,1']
  for (const [type, lines] of Object.entries(road.recordOverrides ?? {})) {
    const replaced = lines.map((line) => line.replace(/[\r\n]+/g, ' '))
    const isType = (line: string) => line.split(',', 1)[0] === type
    const inBefore = before.findIndex(isType)
    if (inBefore >= 0) {
      before = [
        ...before.slice(0, inBefore).filter((l) => !isType(l)),
        ...replaced,
        ...before.slice(inBefore).filter((l) => !isType(l)),
      ]
      after = after.filter((l) => !isType(l))
    } else {
      const inAfter = after.findIndex(isType)
      after =
        inAfter >= 0
          ? [
              ...after.slice(0, inAfter).filter((l) => !isType(l)),
              ...replaced,
              ...after.slice(inAfter).filter((l) => !isType(l)),
            ]
          : [...after, ...replaced]
    }
  }
  const ds2 = [...before, ...rows110, ...rows108, ...rows109, ...after, ''].join(eol)

  // The .dsn: the source's with the writer's keys, or a new one.
  // The road's culverts into the .ds1's placed culverts; [PGMaps] keeps them with the records written.
  const placed = writtenCulverts(road, unit, writtenStartStation(road), ratio)
  notes.push(...placed.notes.map((n) => `${alignment.name}: ${n}`))
  const name = writtenName(alignment, source)
  const pgmaps: Record<string, string | null> = {
    SurfacingM: num(surfacing),
    Template: latin1Json(alignment.template),
    // Template ranges, materials and horizons, and the curve rule, so the road comes back whole.
    Engineering: alignment.engineering
      ? latin1Json(placed.culverts ? { ...alignment.engineering, culverts: placed.culverts } : alignment.engineering)
      : null,
    CurveDesign: alignment.curveDesign ? latin1Json(alignment.curveDesign) : null,
    // The road's start station and equations: RoadEng has no field for an L-line equation. A road
    // whose stations are its design's own (start station, no equations) needs none written.
    Stationing:
      source && isRoadEngImpliedStationing(alignment.stationing, source.startStation, ratio)
        ? null
        : hasStationing(alignment.stationing) || (source && Math.abs(source.startStation) > 1e-9)
          ? latin1Json(alignment.stationing ?? { startStation: 0, equations: [] })
          : null,
  }
  const terrain = options.terrainName?.replace(/[\r\n]+/g, ' ')
  let dsn: string
  if (source) {
    // Only what differs is written, so an unedited design keeps its .dsn text exactly.
    const ini = readRoadEngIni(source.dsn)
    const design: Record<string, string> = {}
    const designIni = ini.get('design')
    if ((first || designIni?.has('units')) && designIni?.get('units') !== unitCode) design.units = unitCode
    if (terrain && (first || designIni?.has('surface')) && designIni?.get('surface') !== terrain)
      design.surface = terrain
    const named = ini.get('HAlignOptions')?.get('Option, 1')
    // An alignment RoadEng left unnamed stays unnamed while the road keeps the name its import gave it.
    const unnamed = named === undefined && source.importedName !== undefined && alignment.name === source.importedName
    dsn = mergeRoadEngIni(source.dsn, {
      ...(first && !ini.has('Software') ? { Software: { Version: '11.000', Version2: VERSION } } : {}),
      ...(Object.keys(design).length ? { design } : {}),
      ...(named !== name && !unnamed ? { HAlignOptions: { 'Option, 1': name } } : {}),
      PGMaps: pgmaps,
    })
    if (source.unitCode !== unitCode)
      notes.push(
        `${alignment.name} was read from a design in ${roadEngUnitName(ROADENG_UNITS[source.unitCode] ?? 1)}; it is written in this design's ${roadEngUnitName(unit)}, and the settings kept from its own design are in its old units.`,
      )
  } else
    dsn = [
      '[Software]',
      'Version=11.000',
      `Version2=${VERSION}`,
      '[design]',
      'nAlignments=1,0',
      ...(terrain ? [`surface=${terrain}`] : []),
      `units=${unitCode}`,
      'Version=11',
      `Version2=${VERSION}`,
      '[HAlignOptions]',
      `Option, 1=${name}`,
      'Option, 2=1',
      // RoadEng skips sections it does not know. This one lets the design come back to this workspace
      // with its section and its levels on the subgrade (`roadEngImport.ts`, `RoadEngAlignment.pgmaps`).
      '[PGMaps]',
      ...Object.entries(pgmaps)
        .filter(([, value]) => value !== null)
        .map(([key, value]) => `${key}=${value}`),
      '',
    ].join('\r\n')
  if (road.dsnOverrides) dsn = mergeRoadEngIni(dsn, road.dsnOverrides)
  // What RoadEng holds of the design as written: opened here again, a different one means RoadEng saved
  // it since, and its own settings are read rather than this section's (`roadEngImport.ts`).
  dsn = mergeRoadEngIni(dsn, { PGMaps: { Native: roadEngNativeFingerprint(dsn, ds2) } })
  return {
    dsn,
    ds2,
    ds1: placed.ds1,
    ds3: source?.ds3 ? base64ToBytes(source.ds3) : null,
    notes,
  }
}

/**
 * The `.ds1` a road is written with (`roadEngPlacedCulverts.ts`): its source's with the road's
 * culverts written into the placed culverts, else three empty chunks and the road's culverts. A new
 * culvert starts from the design's default culvert of its kind when the design is in the same units.
 */
function writtenCulverts(
  road: Pick<RoadEngExportRoad, 'alignment' | 'source'>,
  unit: number,
  startStation: number,
  stationScale: number,
): { ds1: Uint8Array; culverts: Culvert[] | null; notes: string[] } {
  const { source } = road
  const culverts = road.alignment.engineering?.culverts ?? []
  const ds1 = source?.ds1 ? base64ToBytes(source.ds1) : null
  if (!culverts.length && (!ds1 || !source?.culvertsRead))
    return { ds1: ds1 ?? emptyRoadEngIndex(), culverts: null, notes: [] }
  const sourceUnit = source ? ROADENG_UNITS[source.unitCode] : undefined
  const defaults: Partial<Record<'cross-drain' | 'stream', string>> = {}
  if (source && sourceUnit === unit) {
    const section = readRoadEngIni(source.dsn).get('Culvert') ?? readRoadEngIni(source.projectDsn ?? '').get('Culvert')
    const drain = section?.get('DefDrainCulvert'),
      stream = section?.get('DefStreamCulvert')
    if (drain) defaults['cross-drain'] = drain
    if (stream) defaults.stream = stream
  }
  const written = writeDesignCulverts(
    ds1 && source && sourceUnit
      ? {
          ds1,
          unitM: sourceUnit,
          frame: { startStation: source.startStation, endStation: source.endStation ?? Infinity },
          read: !!source.culvertsRead,
        }
      : null,
    culverts,
    { unitM: unit, startStation, stationScale, defaults },
  )
  return { ds1: written.ds1, culverts: written.culverts, notes: written.notes }
}

/** Surfacing on the centreline, m: the course stack on the left side, or the legacy depth. */
export function centreSurfacingM(alignment: Pick<Alignment, 'template'>): number {
  const t = alignment.template
  if (t.layers?.length) return t.layers.filter((l) => l.side !== 'right').reduce((sum, l) => sum + l.depthM, 0)
  return t.leftSurfaceDepth ?? t.surfaceDepth ?? 0
}

/**
 * Roads as one `.dsnx` archive, one alignment each, in the order given. Every alignment is written
 * in the first road's units (its source's, else metres), the units the archive states.
 */
export function roadEngDesign(
  roads: readonly RoadEngExportRoad[],
  toGrid: (coordinate: Coordinate) => XY,
  options: { terrainName?: string; designSpeedKmh?: number } = {},
): RoadEngExport {
  if (!roads.length) throw Error('Choose at least one road to export.')
  const files: Record<string, Uint8Array> = {}
  const parts: Record<string, string> = {}
  const notes: string[] = []
  const unitCode = roads[0].source?.unitCode ?? '10000'
  roads.forEach((road, k) => {
    const part = `Location${k + 1}`
    const written = roadEngAlignmentParts(road, toGrid, { ...options, unitCode, first: k === 0 })
    files[`${part}.ds1`] = written.ds1
    files[`${part}.ds2`] = latin1Bytes(written.ds2)
    if (written.ds3) files[`${part}.ds3`] = written.ds3
    files[`${part}.dsn`] = latin1Bytes(written.dsn)
    parts[`${part}.dsn`] = written.dsn
    parts[`${part}.ds2`] = written.ds2
    notes.push(...written.notes)
  })
  return { bytes: zipSync(files, { mtime: new Date(2000, 0, 1) }), parts, notes }
}
