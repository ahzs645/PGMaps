/**
 * Softree's haul and optimizer CSV files, read and written: RoadEng's Mass Haul export, its Optimal
 * Haul export (the "Haul Table" `.csv`), and the CSV files of the Softree Optimal API (the Areas file
 * RoadEng exports, and materials, pits and the cost model). Writers take PGMaps' calculated road;
 * readers return typed records in metric units; `compare…` puts a RoadEng user's file beside
 * PGMaps' result.
 *
 * Formats, from Softree's descriptions (re-implemented; nothing copied):
 *
 * - **Mass Haul export** (Softree knowledge base, "Mass Haul Export"): one header row, `Cut Vol, Cut
 *   Stn1, Cut Stn2, Cut Centroid, Fill Vol, Fill Stn1, Fill Stn2, Fill Centroid, Type, Over Haul
 *   (vol*dist), Over Haul 2 (vol*(dist-FHD)), Direction`, then one row per balance item. Types are
 *   Free Haul, Over Haul, Borrow and Waste (End Haul); direction Push (material moves up-station) or
 *   Pull. Over-haul columns are blank on free-haul rows. Verified against the article's example
 *   rows: a free-haul row gives the cut and fill the same range and (to rounding) the same
 *   centroid; an over-haul row's Over Haul is its volume × centroid-to-centroid distance and Over
 *   Haul 2 that less volume × free-haul distance.
 * - **Optimal Haul export** (RoadEng 11 help "Optimal Haul Export Contents" and the knowledge-base
 *   walk-through with its tables): sections Cost summary (`Haul, Cut, Fill, Pit Opening`, a `Total`
 *   row then one row per material), Volume summary (`Cut, Borrow, Underflow, Fill, Waste, Overflow,
 *   Sidecast`; sources positive, uses negative, each row sums to zero), Pit summary (one column per
 *   pit; `Station number` and `Distance` rows, then one row per material, extracted positive and
 *   deposited negative), Movement summary (`Cut, Pit Load, Station Unload (movement), Pit Unload,
 *   Same Station Unload (no movement), Sidecast (no movement)`; loads positive, unloads negative),
 *   the movement and pit details, and the Detailed movement summary (`Material, Vol moved, Cut Stn1,
 *   Cut Stn2, Fill Stn1, Fill Stn2, Distance, Type, Direction, Comment`; Freehaul/Overhaul/Endhaul;
 *   a pit movement's pit end takes the pit's station at both ends; a blank row between materials).
 *   The four summaries carry their title in the row-label cell of their header row; the detailed
 *   summary's title is a row of its own.
 * - **Softree Optimal Areas CSV** (Softree Optimal API documentation, Appendix 1, and its example
 *   figure): nine one-cell lines (`version`, its value, `no. h-offset`, its value, `h-offset
 *   distance`, its value, `no. station`, its value, `data start:`), a column line (`h-offset,
 *   station, x, y, z(ground), error, v-offset`), then one record per horizontal offset, station and
 *   level: h-offset, station, X, Y, ground Z, error flag, v-offset (design level above ground), then
 *   `code,value` pairs. `M_xx` is a material's area (cut positive, fill negative; `M_q1`…`M_q4` a fill
 *   of that quality or better), `T_yy` a pseudo material (`T_MCUT`/`T_MFILL` centreline cut and fill
 *   depth, `T_HROW`/`T_VROW` the horizontal and vertical offset to the right of way). A record that
 *   ends after its error flag is a bridge. The text names the fill depth `T_FILL`; the example file
 *   writes `T_MFILL`, which is what is written here (both are read).
 *
 * Inferred, and said so where it is used:
 *
 * - The Optimal Haul export's movement details (one row per segment and material with its cut,
 *   fill, cut-to-fill, sidecast and, for each of the six conveyors, load, unload, load pit, unload
 *   pit and transport) and pit details (one row per pit and material, one column per conveyor) are
 *   described but their columns are not published. The column names written here are PGMaps'; the
 *   reader recognises them, and keeps a RoadEng file's own detail rows as `otherSections` when they
 *   do not match.
 * - The API defines materials, pits and the cost model as structures, not files. The materials,
 *   pits and cost-model CSVs here are one header row and one row per item, with the structures'
 *   fields in the API's order: material identifier, description, embankment and excavation cost,
 *   quality 1–4, cut and fill factor, true material; pit identifier, borrow or waste, smart pit,
 *   access station and distance, comment, waste quality, material, excavation cost, capacity limit,
 *   fixed volume and site preparation, then two PGMaps columns, disposal cost and enabled; move
 *   and load costs for freehaul, overhaul and endhaul, then the freehaul and overhaul distances, −1
 *   for "from the cost lines".
 * - No Softree file states its units. Each reader and writer takes `units` (metric: m, m², m³,
 *   $/m³, $/(m³·km); imperial: ft, ft², yd³, $/yd³, $/(yd³·mile)); `softreeUnitsForRoadEng` gives
 *   them from a RoadEng design's `[design] units`. Costs in dollars are never converted.
 * - Quality: PGMaps' 0–100 class maps to Q1 (≥ 75), Q2 (≥ 50), Q3 (≥ 25) and Q4; Q1–Q4 read back as
 *   75, 50, 25 and 0, so a quality class read and written again is unchanged.
 * - RoadEng's movement cost lines run over the whole haul distance (loading + rate × distance);
 *   PGMaps charges overhaul and endhaul only past the free-haul distance. The cost model converts
 *   between the two at the free-haul distance, so every haul is priced the same either way.
 *
 * What PGMaps writes, and what it leaves out:
 *
 * - Volumes in the haul exports are compacted (fill-equivalent) m³, as the mass-haul diagram draws
 *   them: bank cut, waste and sidecast are converted with the material's compacted/bank factor.
 *   Overflow (nearest-site waste no site could take) has no material and stays in bank m³.
 * - Materials are written by a two-character code (`optimalMaterialCodes`): a RoadEng ground type
 *   keeps its own code; unclassified excavation is `UC`; a movement with no known material `??`.
 * - The Mass Haul export is made from the mass-haul diagram's curve, balanced on zero, by the
 *   classical layer method (`massHaulItems`, the same as the what-if balance line): it describes the
 *   curve and is not the solved allocation, which the Optimal Haul export carries.
 * - The Optimal Haul export is made from the solved allocation (`optimalHaulFromAnalysis`): one
 *   segment per calculated interval, cut and fill per material, each movement on the conveyor of its
 *   haul class and direction. Fill cost is shared between materials by the fill each places.
 *   Waste-disposal and sidecast charges, surfacing, clearing, structures, mobilization and
 *   contingency have no column; `leftOut` lists them with their amounts. A movement within one
 *   interval is a same-station unload and is not in the detailed movement summary.
 * - The Areas CSV holds PGMaps' one design: h-offset 0 and one level per station (the design's own
 *   v-offset), cut by material (strata and site preparation), subgrade fill under the quality or
 *   material its fill requirement names (`q4` without one), material-assigned template components
 *   and surface courses under their material, and `T_MCUT`/`T_MFILL`. An incomplete station is an
 *   error record with no areas. The right-of-way pseudo materials, other levels and other
 *   h-offsets are not written: PGMaps has no band of trial levels.
 *
 * Checked by `softreeHaulCsv.test.ts`: column order against the documentation, write → read → write
 * equality on synthetic files and on PGMaps analyses, the mass-haul layer method against a hand-
 * worked curve, and the conservation of every summary row. Pure: no DOM or network access.
 */
import { requiredFillAt } from './allocationPolicy'
import type { ToGrid } from './designExports'
import {
  materialPlanMissing,
  type AlignmentEngineering,
  type GroundMaterial,
  type HaulMovement,
  type HaulSettings,
  type HaulSite,
} from './engineeringTypes'
import { parseCsv } from './exportCatalog'
import { refuseInvalidResults } from './inputErrors'
import { massHaulDiagram } from './massHaul'
import { lastResortName, lastResortSites } from './lastResortPits'
import type { RoadAnalysis } from './types'

/* ------------------------------------------------------------------------------------------------
 * Units, limits and cells
 * --------------------------------------------------------------------------------------------- */

export type SoftreeUnits = 'metric' | 'imperial'
export const SOFTREE_FT_M = 0.3048
export const SOFTREE_YD3_M3 = 0.764554857984
export const SOFTREE_MILE_KM = 1.609344
/** Largest Softree CSV read, bytes; Softree's own Areas test files are 0.9 and 6.4 MB. */
export const MAX_SOFTREE_CSV_BYTES = 100_000_000
/** Rows read from one file. */
export const MAX_SOFTREE_CSV_ROWS = 2_000_000
/** `code,value` pairs read from one Areas record. */
export const MAX_OPTIMAL_AREA_PAIRS = 500
/** Layers per mass-haul loop between its foot and its peak, besides a break at every vertex height. */
export const MASS_HAUL_LAYERS = 400
/** Optimal's material identifiers are two characters; descriptions at most 50. */
export const OPTIMAL_DESCRIPTION_CHARS = 50
export const OPTIMAL_UNCLASSIFIED_CODE = 'UC'
export const OPTIMAL_UNKNOWN_MATERIAL_CODE = '??'
/** RoadEng's Areas file version this writes (the API documentation's example). */
export const OPTIMAL_AREAS_VERSION = 2

const EPS = 1e-9
const UNCLASSIFIED_ID = '__unclassified'

interface Scale {
  /** Metres per file unit of length, m² per file unit of area, m³ per file unit of volume. */
  len: number
  area: number
  vol: number
  /** Kilometres per file unit of haul distance in a movement cost. */
  haulKm: number
}
const scaleOf = (units: SoftreeUnits = 'metric'): Scale =>
  units === 'imperial'
    ? { len: SOFTREE_FT_M, area: SOFTREE_FT_M ** 2, vol: SOFTREE_YD3_M3, haulKm: SOFTREE_MILE_KM }
    : { len: 1, area: 1, vol: 1, haulKm: 1 }

/** The units of a RoadEng design from its metres per project unit (`[design] units` ÷ 10,000). */
export function softreeUnitsForRoadEng(unitM: number): SoftreeUnits {
  if (Math.abs(unitM - 1) < 1e-9) return 'metric'
  // International or US survey feet (RoadEng's `3048.00609601`): haul files in feet, yd³ and miles.
  if (Math.abs(unitM - SOFTREE_FT_M) < 1e-9 || Math.abs(unitM - 1200 / 3937) < 1e-12) return 'imperial'
  throw Error(`A RoadEng design of ${unitM} m per unit is neither metres nor feet.`)
}

/** A number with at most `digits` decimals and no trailing zeros; blank when missing. Never "-0". */
function fmt(value: number | null | undefined, digits: number): string {
  if (value == null || !Number.isFinite(value)) return ''
  let text = value.toFixed(digits)
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '')
  return text === '-0' ? '0' : text
}
const div = (value: number | null, by: number) => (value === null ? null : value / by)
const mul = (value: number | null, by: number) => (value === null ? null : value * by)

/**
 * A text cell, quoted when it holds a comma, quote or edge space. A leading `=`, `+`, `-` or `@`
 * would run as a formula in a spreadsheet, so it is written behind an apostrophe, which the
 * readers take off again.
 */
function textCell(value: string): string {
  let v = value.replace(/[\r\n]+/g, ' ')
  if (/^[=+\-@]/.test(v)) v = `'${v}`
  return /[",]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v
}
const untext = (cell: string) => (/^'[=+\-@]/.test(cell) ? cell.slice(1) : cell)
const line = (cells: readonly string[]) => cells.join(',')
/** Softree is Windows software: lines end CR LF. */
const joinLines = (lines: readonly string[]) => lines.join('\r\n') + '\r\n'

/**
 * CSV rows with cells trimmed and trailing blank cells dropped, keeping at least `keep` cells of a
 * row that has them; a row of blanks is `[]`. Row `i` is line `i + 1` of the file: blank lines are
 * kept as empty rows so messages can name the line.
 */
function readRows(text: string, what: string, keep = 0): string[][] {
  if (text.length > MAX_SOFTREE_CSV_BYTES)
    throw Error(`${what} is larger than ${MAX_SOFTREE_CSV_BYTES / 1_000_000} MB, more than this reader takes.`)
  const body = text
    .replace(/^\uFEFF/, '')
    .split('\n')
    .map((l) => (l.replace(/\r$/, '') === '' ? ',' : l))
    .join('\n')
  const { rows, total } = parseCsv(body, MAX_SOFTREE_CSV_ROWS)
  if (total > MAX_SOFTREE_CSV_ROWS)
    throw Error(`${what} has ${total.toLocaleString('en-CA')} rows, more than the ${MAX_SOFTREE_CSV_ROWS} read.`)
  return rows.map((row) => {
    const cells = row.map((c) => c.trim())
    if (cells.every((c) => c === '')) return []
    while (cells.length > keep && cells[cells.length - 1] === '') cells.pop()
    return cells
  })
}

/** A number cell; blank is null and anything else that is not a number throws, naming the place. */
function numberCell(cell: string | undefined, where: string): number | null {
  const t = (cell ?? '').trim()
  if (!t) return null
  const value = Number(t)
  if (!Number.isFinite(value)) throw Error(`${where}: "${t}" is not a number.`)
  return value
}
const norm = (label: string) => label.trim().toLowerCase().replace(/\s+/g, ' ')

/** Column positions of a header row by normalised name, accepting each column's aliases. */
function columnIndex(header: readonly string[], columns: Record<string, readonly string[]>) {
  const names = header.map(norm)
  const out: Record<string, number> = {}
  for (const [key, aliases] of Object.entries(columns)) {
    const at = names.findIndex((n) => aliases.includes(n))
    out[key] = at
  }
  return out
}

/* ------------------------------------------------------------------------------------------------
 * Material codes and quality
 * --------------------------------------------------------------------------------------------- */

const RESERVED_CODES = new Set(['Q1', 'Q2', 'Q3', 'Q4', OPTIMAL_UNCLASSIFIED_CODE, OPTIMAL_UNKNOWN_MATERIAL_CODE])

/**
 * Optimal's two-character identifier for each material, unique and never a generic quality (`q1`–
 * `q4`): a RoadEng ground type keeps its code (the name `XX · description` or the id `roadeng-XX`
 * its import gives), anything else takes the first two letters or digits of its name, then a
 * letter and digit. Unclassified excavation is `UC`.
 */
export function optimalMaterialCodes(materials: readonly Pick<GroundMaterial, 'id' | 'name'>[]): Map<string, string> {
  const codes = new Map<string, string>([[UNCLASSIFIED_ID, OPTIMAL_UNCLASSIFIED_CODE]])
  const taken = new Set<string>()
  const free = (code: string) =>
    code.length > 0 && !taken.has(code.toUpperCase()) && !RESERVED_CODES.has(code.toUpperCase())
  const take = (id: string, code: string) => {
    codes.set(id, code)
    taken.add(code.toUpperCase())
  }
  const own = (m: Pick<GroundMaterial, 'id' | 'name'>) =>
    /^([A-Za-z0-9]{1,2}) · /.exec(m.name)?.[1] ?? /^roadeng-([A-Za-z0-9]{1,2})$/.exec(m.id)?.[1] ?? null
  // RoadEng's own codes first, so a derived code never takes one.
  for (const m of materials) {
    const code = own(m)
    if (code && free(code)) take(m.id, code)
  }
  for (const m of materials) {
    if (codes.has(m.id)) continue
    const letters = m.name.toUpperCase().replace(/[^A-Z0-9]/g, '')
    const tries = [letters.slice(0, 2), ...[...'123456789'].map((d) => (letters[0] ?? 'M') + d)]
    for (const a of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')
      for (const b of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') tries.push(a + b)
    take(m.id, tries.find((c) => c.length === 2 && free(c))!)
  }
  return codes
}

/** Optimal's quality class 1 (best) – 4 of PGMaps' 0–100 class. */
export function optimalQuality(quality: number): 1 | 2 | 3 | 4 {
  return quality >= 75 ? 1 : quality >= 50 ? 2 : quality >= 25 ? 3 : 4
}
/** The lowest PGMaps quality in an Optimal class: Q1 75, Q2 50, Q3 25, Q4 0. */
export function pgmapsQuality(optimal: number): number {
  return Math.max(0, (4 - Math.min(4, Math.max(1, Math.round(optimal)))) * 25)
}

/* ------------------------------------------------------------------------------------------------
 * Mass Haul export
 * --------------------------------------------------------------------------------------------- */

export const MASS_HAUL_COLUMNS = [
  'Cut Vol',
  'Cut Stn1',
  'Cut Stn2',
  'Cut Centroid',
  'Fill Vol',
  'Fill Stn1',
  'Fill Stn2',
  'Fill Centroid',
  'Type',
  'Over Haul (vol*dist)',
  'Over Haul 2 (vol*(dist-FHD))',
  'Direction',
] as const

export type MassHaulType = 'Free Haul' | 'Over Haul' | 'Borrow' | 'Waste'
export type HaulDirection = 'Push' | 'Pull'

/** One balance item. Metric: m³, metres of station, m³·m. */
export interface MassHaulItem {
  cutVolumeM3: number | null
  cutStn1: number | null
  cutStn2: number | null
  cutCentroid: number | null
  fillVolumeM3: number | null
  fillStn1: number | null
  fillStn2: number | null
  fillCentroid: number | null
  /** One of `MassHaulType`, or a type the file names that this reader does not know, as written. */
  type: MassHaulType | string
  overHaulM3m: number | null
  overHaul2M3m: number | null
  direction: HaulDirection | null
}

interface Chord {
  from: number
  to: number
  touchesStart: boolean
  touchesEnd: boolean
}
/** Intervals of a non-negative polyline at or above h, with whether each runs out at an end. */
function chordsAt(xs: readonly number[], us: readonly number[], h: number): Chord[] {
  const out: Chord[] = []
  let open: number | null = us[0] >= h ? xs[0] : null
  let fromStart = open !== null
  for (let i = 1; i < xs.length; i++) {
    const a = us[i - 1],
      b = us[i]
    if (open === null && a < h && b >= h) {
      open = b - a > EPS ? xs[i - 1] + ((h - a) / (b - a)) * (xs[i] - xs[i - 1]) : xs[i]
      fromStart = false
    } else if (open !== null && a >= h && b < h) {
      const to = a - b > EPS ? xs[i - 1] + ((a - h) / (a - b)) * (xs[i] - xs[i - 1]) : xs[i - 1]
      out.push({ from: open, to, touchesStart: fromStart, touchesEnd: false })
      open = null
    }
  }
  if (open !== null) out.push({ from: open, to: xs[xs.length - 1], touchesStart: fromStart, touchesEnd: true })
  return out
}

interface LayerSum {
  volume: number
  /** Σ position × dh on each side of the chord, Σ width × dh and Σ (width − F) × dh. */
  fromMoment: number
  toMoment: number
  haul: number
  over: number
  /** Outer and inner extents of each side, from the chords at the layers' lower and upper edges. */
  fromLow: number
  fromHigh: number
  toLow: number
  toHigh: number
}
const emptySum = (): LayerSum => ({
  volume: 0,
  fromMoment: 0,
  toMoment: 0,
  haul: 0,
  over: 0,
  fromLow: Infinity,
  fromHigh: -Infinity,
  toLow: -Infinity,
  toHigh: Infinity,
})

/**
 * The balance items of a mass-haul curve ([station, cumulative m³] in station order) balanced on
 * zero, as RoadEng's Mass Haul export lists them. Each loop of the curve is cut into thin layers;
 * a layer is a chord whose volume moves the chord's width. Layers no wider than the free-haul
 * distance make the loop's Free Haul item (cut and fill share its range and centroid), wider ones
 * its Over Haul item (cut from the loop's rising side, fill on its falling side); a chord that runs
 * out at a road end does not balance and is Waste or Borrow there. `freeHaulM` null makes every
 * balanced layer free haul. Items smaller than `minVolumeM3` are left out.
 */
export function massHaulItems(
  balance: readonly (readonly [number, number])[],
  freeHaulM: number | null,
  options: { minVolumeM3?: number } = {},
): MassHaulItem[] {
  const items: MassHaulItem[] = []
  if (balance.length < 2) return items
  const points: [number, number][] = []
  for (let i = 0; i < balance.length; i++) {
    const [x, m] = balance[i]
    const d = Math.abs(m) < EPS ? 0 : m
    if (i > 0) {
      const [px, pd] = points[points.length - 1]
      if (pd * d < 0) points.push([px + (pd / (pd - d)) * (x - px), 0])
    }
    points.push([x, d])
  }
  const minVolume = Math.max(options.minVolumeM3 ?? 0, 1e-6)
  let first = 0
  while (first < points.length - 1) {
    let last = first + 1
    while (last < points.length - 1 && points[last][1] !== 0) last++
    const run = points.slice(first, last + 1)
    const nonZero = run.find(([, d]) => d !== 0)
    if (nonZero && run[run.length - 1][0] - run[0][0] > EPS) {
      const sign = nonZero[1] > 0 ? 1 : -1
      const openStart = first === 0 && run[0][1] !== 0
      const openEnd = last === points.length - 1 && run[run.length - 1][1] !== 0
      items.push(
        ...loopItems(
          run.map(([x]) => x),
          run.map(([, d]) => Math.max(0, sign * d)),
          sign,
          openStart,
          openEnd,
          freeHaulM,
        ).filter((item) => (item.cutVolumeM3 ?? item.fillVolumeM3 ?? 0) >= minVolume),
      )
    }
    first = last
  }
  const firstStation = (i: MassHaulItem) => Math.min(...[i.cutStn1, i.fillStn1].filter((v): v is number => v !== null))
  return items.sort((a, b) => firstStation(a) - firstStation(b))
}

function loopItems(
  xs: number[],
  us: number[],
  sign: 1 | -1,
  openStart: boolean,
  openEnd: boolean,
  freeHaulM: number | null,
): MassHaulItem[] {
  const peak = Math.max(...us)
  if (!(peak > EPS)) return []
  const breaks = [...new Set([0, peak, ...us.filter((u) => u > 0 && u < peak)])].sort((a, b) => a - b)
  // free, over, and the unbalanced remainder at each end: 'end-from' / 'start-to' are the chord
  // sides that run out at a road end.
  const sums = { free: emptySum(), over: emptySum(), endFrom: emptySum(), startTo: emptySum() }
  const add = (sum: LayerSum, chord: Chord, low: Chord, highs: Chord[], dh: number) => {
    const w = chord.to - chord.from
    sum.volume += dh
    sum.fromMoment += chord.from * dh
    sum.toMoment += chord.to * dh
    sum.haul += w * dh
    if (freeHaulM !== null) sum.over += Math.max(0, w - freeHaulM) * dh
    sum.fromLow = Math.min(sum.fromLow, low.from)
    sum.toLow = Math.max(sum.toLow, low.to)
    sum.fromHigh = Math.max(sum.fromHigh, highs.length ? Math.min(...highs.map((c) => c.from)) : chord.from)
    sum.toHigh = Math.min(sum.toHigh, highs.length ? Math.max(...highs.map((c) => c.to)) : chord.to)
  }
  for (let k = 1; k < breaks.length; k++) {
    const span = breaks[k] - breaks[k - 1]
    const parts = Math.max(1, Math.ceil((span / peak) * MASS_HAUL_LAYERS))
    const dh = span / parts
    let lowChords = chordsAt(xs, us, breaks[k - 1])
    for (let j = 0; j < parts; j++) {
      const lo = breaks[k - 1] + j * dh
      const highChords = chordsAt(
        xs,
        us,
        Math.min(peak, lo + dh) - (j === parts - 1 && k === breaks.length - 1 ? EPS : 0),
      )
      for (const chord of chordsAt(xs, us, lo + dh / 2)) {
        const low = lowChords.find((c) => c.from <= chord.from + 1e-7 && c.to >= chord.to - 1e-7) ?? chord
        const highs = highChords.filter((c) => c.from >= chord.from - 1e-7 && c.to <= chord.to + 1e-7)
        const atStart = chord.touchesStart && openStart,
          atEnd = chord.touchesEnd && openEnd
        // Material that passes the whole stretch is neither cut nor fill here.
        if (atStart && atEnd) continue
        if (atEnd) add(sums.endFrom, chord, low, highs, dh)
        else if (atStart) add(sums.startTo, chord, low, highs, dh)
        else
          add(
            freeHaulM !== null && chord.to - chord.from > freeHaulM + 1e-7 ? sums.over : sums.free,
            chord,
            low,
            highs,
            dh,
          )
      }
      lowChords = highChords
    }
  }
  const direction: HaulDirection = sign > 0 ? 'Push' : 'Pull'
  // Above the line the curve rises first: the chord's `from` side is cut. Below, it is fill.
  const side = (s: LayerSum, which: 'from' | 'to') =>
    which === 'from'
      ? { stn1: s.fromLow, stn2: s.fromHigh, centroid: s.fromMoment / s.volume }
      : { stn1: s.toHigh, stn2: s.toLow, centroid: s.toMoment / s.volume }
  const cutSide = sign > 0 ? 'from' : 'to',
    fillSide = sign > 0 ? 'to' : 'from'
  const blank = {
    cutVolumeM3: null,
    cutStn1: null,
    cutStn2: null,
    cutCentroid: null,
    fillVolumeM3: null,
    fillStn1: null,
    fillStn2: null,
    fillCentroid: null,
    overHaulM3m: null,
    overHaul2M3m: null,
  }
  const out: MassHaulItem[] = []
  const { free, over, endFrom, startTo } = sums
  if (free.volume > EPS) {
    const centroid = (free.fromMoment + free.toMoment) / (2 * free.volume)
    out.push({
      ...blank,
      cutVolumeM3: free.volume,
      cutStn1: free.fromLow,
      cutStn2: free.toLow,
      cutCentroid: centroid,
      fillVolumeM3: free.volume,
      fillStn1: free.fromLow,
      fillStn2: free.toLow,
      fillCentroid: centroid,
      type: 'Free Haul',
      direction,
    })
  }
  if (over.volume > EPS) {
    const cut = side(over, cutSide),
      fill = side(over, fillSide)
    out.push({
      cutVolumeM3: over.volume,
      cutStn1: cut.stn1,
      cutStn2: cut.stn2,
      cutCentroid: cut.centroid,
      fillVolumeM3: over.volume,
      fillStn1: fill.stn1,
      fillStn2: fill.stn2,
      fillCentroid: fill.centroid,
      type: 'Over Haul',
      overHaulM3m: over.haul,
      overHaul2M3m: over.over,
      direction,
    })
  }
  // At the road end the `from` side is the open chord's only end inside the road; at the start, `to`.
  for (const [sum, which, end] of [
    [endFrom, 'from', 'end'],
    [startTo, 'to', 'start'],
  ] as const) {
    if (sum.volume <= EPS) continue
    const s = side(sum, which)
    const isCut = which === cutSide
    out.push({
      ...blank,
      ...(isCut
        ? { cutVolumeM3: sum.volume, cutStn1: s.stn1, cutStn2: s.stn2, cutCentroid: s.centroid }
        : { fillVolumeM3: sum.volume, fillStn1: s.stn1, fillStn2: s.stn2, fillCentroid: s.centroid }),
      type: isCut ? 'Waste' : 'Borrow',
      // Waste leaves at the end it runs to and borrow comes in from it: up-station is a push.
      direction: (end === 'end') === isCut ? 'Push' : 'Pull',
    })
  }
  return out
}

/**
 * The Mass Haul export's items for a calculated road: its mass-haul curve (known earthwork, carried
 * across unknown lengths) with the road's free-haul distance, or none when haul has no settings.
 */
export function massHaulItemsFromAnalysis(
  analysis: RoadAnalysis,
  haul?: Pick<HaulSettings, 'freeHaulDistanceM'> | null,
  options: { minVolumeM3?: number } = {},
): MassHaulItem[] {
  refuseInvalidResults('Mass Haul export', analysis)
  const { balance } = massHaulDiagram(analysis)
  if (balance.length < 2) throw Error('The road has no mass-haul curve yet: no interval has known earthwork.')
  return massHaulItems(balance, haul ? haul.freeHaulDistanceM : null, options)
}

export function writeMassHaulCsv(items: readonly MassHaulItem[], options: { units?: SoftreeUnits } = {}): string {
  const k = scaleOf(options.units)
  const v = (value: number | null) => fmt(div(value, k.vol), 2)
  const s = (value: number | null) => fmt(div(value, k.len), 3)
  return joinLines([
    line(MASS_HAUL_COLUMNS),
    ...items.map((i) =>
      line([
        v(i.cutVolumeM3),
        s(i.cutStn1),
        s(i.cutStn2),
        s(i.cutCentroid),
        v(i.fillVolumeM3),
        s(i.fillStn1),
        s(i.fillStn2),
        s(i.fillCentroid),
        textCell(i.type),
        fmt(div(i.overHaulM3m, k.vol * k.len), 2),
        fmt(div(i.overHaul2M3m, k.vol * k.len), 2),
        i.direction ?? '',
      ]),
    ),
  ])
}

const MASS_HAUL_TYPES: Record<string, MassHaulType> = {
  'free haul': 'Free Haul',
  freehaul: 'Free Haul',
  'over haul': 'Over Haul',
  overhaul: 'Over Haul',
  borrow: 'Borrow',
  waste: 'Waste',
  'end haul': 'Waste',
  endhaul: 'Waste',
  'waste (or end haul)': 'Waste',
}
const direction = (cell: string | undefined): HaulDirection | null =>
  /^push$/i.test(cell ?? '') ? 'Push' : /^pull$/i.test(cell ?? '') ? 'Pull' : null

export interface SoftreeRead<T> {
  value: T
  units: SoftreeUnits
  /** Rows passed over, each with its line and why. */
  warnings: string[]
}

/** Reads a Mass Haul export. The header row is found by its first column; rows before it are passed over. */
export function readMassHaulCsv(text: string, options: { units?: SoftreeUnits } = {}): SoftreeRead<MassHaulItem[]> {
  const units = options.units ?? 'metric',
    k = scaleOf(units)
  const rows = readRows(text, 'The Mass Haul export')
  const at = rows.findIndex((r) => norm(r[0] ?? '') === 'cut vol')
  if (at < 0) throw Error('This is not a RoadEng Mass Haul export: no "Cut Vol" header row.')
  const col = columnIndex(rows[at], {
    cutVol: ['cut vol', 'cut volume'],
    cutStn1: ['cut stn1'],
    cutStn2: ['cut stn2'],
    cutCentroid: ['cut centroid'],
    fillVol: ['fill vol', 'fill volume'],
    fillStn1: ['fill stn1'],
    fillStn2: ['fill stn2'],
    fillCentroid: ['fill centroid'],
    type: ['type'],
    overHaul: ['over haul (vol*dist)', 'over haul'],
    overHaul2: ['over haul 2 (vol*(dist-fhd))', 'over haul 2'],
    direction: ['direction'],
  })
  const items: MassHaulItem[] = [],
    warnings: string[] = []
  for (let r = at + 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row.length) continue
    const get = (key: string) => (col[key] >= 0 ? row[col[key]] : undefined)
    try {
      const n = (key: string, by: number) => mul(numberCell(get(key), `Line ${r + 1}, ${key}`), by)
      const typeText = untext(get('type') ?? '')
      items.push({
        cutVolumeM3: n('cutVol', k.vol),
        cutStn1: n('cutStn1', k.len),
        cutStn2: n('cutStn2', k.len),
        cutCentroid: n('cutCentroid', k.len),
        fillVolumeM3: n('fillVol', k.vol),
        fillStn1: n('fillStn1', k.len),
        fillStn2: n('fillStn2', k.len),
        fillCentroid: n('fillCentroid', k.len),
        type: MASS_HAUL_TYPES[norm(typeText)] ?? typeText,
        overHaulM3m: n('overHaul', k.vol * k.len),
        overHaul2M3m: n('overHaul2', k.vol * k.len),
        direction: direction(get('direction')),
      })
    } catch (error) {
      warnings.push((error as Error).message)
    }
  }
  return { value: items, units, warnings }
}

export interface QuantityDifference {
  /** What is compared: a material code, a pit, a haul type or a station. */
  key: string
  field: string
  theirs: number | null
  ours: number | null
  /** Ours − theirs; null when either is missing. */
  difference: number | null
}
const diff = (key: string, field: string, theirs: number | null, ours: number | null): QuantityDifference => ({
  key,
  field,
  theirs,
  ours,
  difference: theirs === null || ours === null ? null : ours - theirs,
})

export interface MassHaulComparison {
  /** Per type: volume, Over Haul and Over Haul 2 totals. */
  totals: QuantityDifference[]
  /** Items of the same type paired by how much their station ranges overlap. */
  pairs: { theirs: MassHaulItem; ours: MassHaulItem; rows: QuantityDifference[] }[]
  onlyTheirs: MassHaulItem[]
  onlyOurs: MassHaulItem[]
}

const itemVolume = (i: MassHaulItem) => i.cutVolumeM3 ?? i.fillVolumeM3 ?? 0
const overlap = (a1: number | null, a2: number | null, b1: number | null, b2: number | null) =>
  a1 === null || a2 === null || b1 === null || b2 === null
    ? 0
    : Math.max(0, Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2)))

/** RoadEng's mass-haul items beside PGMaps': totals per type, then each item paired with its nearest. */
export function compareMassHaul(theirs: readonly MassHaulItem[], ours: readonly MassHaulItem[]): MassHaulComparison {
  const totals: QuantityDifference[] = []
  const types = [...new Set([...theirs, ...ours].map((i) => i.type))]
  const sum = (items: readonly MassHaulItem[], type: string, f: (i: MassHaulItem) => number | null) => {
    const of = items.filter((i) => i.type === type)
    return of.length ? of.reduce((s, i) => s + (f(i) ?? 0), 0) : null
  }
  for (const type of types) {
    totals.push(diff(type, 'volume', sum(theirs, type, itemVolume), sum(ours, type, itemVolume)))
    if (type === 'Over Haul') {
      totals.push(
        diff(
          type,
          'overHaul',
          sum(theirs, type, (i) => i.overHaulM3m),
          sum(ours, type, (i) => i.overHaulM3m),
        ),
      )
      totals.push(
        diff(
          type,
          'overHaul2',
          sum(theirs, type, (i) => i.overHaul2M3m),
          sum(ours, type, (i) => i.overHaul2M3m),
        ),
      )
    }
  }
  const left = new Set(theirs)
  const pairs: MassHaulComparison['pairs'] = [],
    onlyOurs: MassHaulItem[] = []
  for (const o of ours) {
    let best: MassHaulItem | null = null,
      bestOverlap = 0
    for (const t of left) {
      if (t.type !== o.type) continue
      const shared =
        overlap(t.cutStn1, t.cutStn2, o.cutStn1, o.cutStn2) + overlap(t.fillStn1, t.fillStn2, o.fillStn1, o.fillStn2)
      if (shared > bestOverlap) {
        best = t
        bestOverlap = shared
      }
    }
    if (!best) {
      onlyOurs.push(o)
      continue
    }
    left.delete(best)
    const key = `${o.type} ${fmt(o.cutStn1 ?? o.fillStn1, 1)}`
    pairs.push({
      theirs: best,
      ours: o,
      rows: [
        diff(key, 'volume', itemVolume(best), itemVolume(o)),
        diff(key, 'cutCentroid', best.cutCentroid, o.cutCentroid),
        diff(key, 'fillCentroid', best.fillCentroid, o.fillCentroid),
        diff(key, 'overHaul', best.overHaulM3m, o.overHaulM3m),
      ],
    })
  }
  return { totals, pairs, onlyTheirs: [...left], onlyOurs }
}

/* ------------------------------------------------------------------------------------------------
 * Optimal Haul export
 * --------------------------------------------------------------------------------------------- */

export const OPTIMAL_HAUL_SECTION_TITLES = {
  cost: 'Cost summary',
  volume: 'Volume summary',
  pit: 'Pit summary',
  movement: 'Movement summary',
  segments: 'Movement details',
  pitDetails: 'Pit details',
  detailed: 'Detailed movement summary',
} as const
export const OPTIMAL_HAUL_COST_COLUMNS = ['Haul', 'Cut', 'Fill', 'Pit Opening'] as const
export const OPTIMAL_HAUL_VOLUME_COLUMNS = [
  'Cut',
  'Borrow',
  'Underflow',
  'Fill',
  'Waste',
  'Overflow',
  'Sidecast',
] as const
export const OPTIMAL_HAUL_MOVEMENT_COLUMNS = [
  'Cut',
  'Pit Load',
  'Station Unload (movement)',
  'Pit Unload',
  'Same Station Unload (no movement)',
  'Sidecast (no movement)',
] as const
export const OPTIMAL_HAUL_DETAILED_COLUMNS = [
  'Material',
  'Vol moved',
  'Cut Stn1',
  'Cut Stn2',
  'Fill Stn1',
  'Fill Stn2',
  'Distance',
  'Type',
  'Direction',
  'Comment',
] as const
/** The six conveyors of RoadEng's movement model, rightward (up-station) then leftward. */
export const OPTIMAL_CONVEYORS = [
  'Freehaul right',
  'Overhaul right',
  'Endhaul right',
  'Freehaul left',
  'Overhaul left',
  'Endhaul left',
] as const
export type OptimalConveyor = (typeof OPTIMAL_CONVEYORS)[number]
const CONVEYOR_PARTS = ['Load', 'Unload', 'Load Pit', 'Unload Pit', 'Transport'] as const
/** PGMaps' column names for the movement details (inferred: RoadEng publishes the contents, not the columns). */
export const OPTIMAL_HAUL_SEGMENT_COLUMNS = [
  'Material',
  'Stn1',
  'Stn2',
  'Cut',
  'Fill',
  'Cut-to-Fill',
  'Sidecast',
  ...OPTIMAL_CONVEYORS.flatMap((c) => CONVEYOR_PARTS.map((p) => `${c} ${p}`)),
]
export const OPTIMAL_HAUL_PIT_DETAIL_COLUMNS = ['Pit', 'Material', ...OPTIMAL_CONVEYORS]

export interface OptimalHaulCost {
  haul: number | null
  cut: number | null
  fill: number | null
  pitOpening: number | null
}
export interface OptimalHaulVolumes {
  material: string
  cut: number | null
  borrow: number | null
  underflow: number | null
  fill: number | null
  waste: number | null
  overflow: number | null
  sidecast: number | null
}
export interface OptimalHaulPitSummary {
  name: string
  station: number | null
  distance: number | null
  /** Material code → volume: extracted positive, deposited negative. */
  volumes: Record<string, number | null>
}
export interface OptimalHaulMovementTotals {
  material: string
  cut: number | null
  pitLoad: number | null
  stationUnload: number | null
  pitUnload: number | null
  sameStationUnload: number | null
  sidecast: number | null
}
export interface ConveyorFlows {
  load: number
  unload: number
  loadPit: number
  unloadPit: number
  transport: number
}
/** One segment's material: loads positive, unloads negative; transport is what leaves the segment along the conveyor. */
export interface OptimalHaulSegment {
  material: string
  stn1: number
  stn2: number
  cut: number
  fill: number
  cutToFill: number
  sidecast: number
  conveyors: Record<OptimalConveyor, ConveyorFlows>
}
export interface OptimalHaulPitDetail {
  pit: string
  material: string
  /** Loaded from the pit onto each conveyor positive, unloaded into it negative. */
  conveyors: Record<OptimalConveyor, number>
}
export interface OptimalHaulMovement {
  material: string
  volume: number
  cutStn1: number | null
  cutStn2: number | null
  fillStn1: number | null
  fillStn2: number | null
  distance: number | null
  /** `Freehaul`, `Overhaul`, `Endhaul`, or what the file writes. */
  type: string
  direction: HaulDirection | null
  comment: string
}
/** An Optimal Haul export, metric: m³, metres, dollars. Absent sections are empty. */
export interface OptimalHaulExport {
  costTotal: OptimalHaulCost | null
  costs: (OptimalHaulCost & { material: string })[]
  volumes: OptimalHaulVolumes[]
  pits: OptimalHaulPitSummary[]
  movements: OptimalHaulMovementTotals[]
  segments: OptimalHaulSegment[]
  pitDetails: OptimalHaulPitDetail[]
  detailedMovements: OptimalHaulMovement[]
  /** Rows the reader did not recognise, by the section they came in (title '' before the first). */
  otherSections: { title: string; rows: string[][] }[]
  /** What the road's result holds that the file has no place for, in plain words (writer only). */
  leftOut: string[]
}

const emptyFlows = (): ConveyorFlows => ({ load: 0, unload: 0, loadPit: 0, unloadPit: 0, transport: 0 })
const conveyorRecord = <T>(make: () => T) =>
  Object.fromEntries(OPTIMAL_CONVEYORS.map((c) => [c, make()])) as Record<OptimalConveyor, T>
const conveyorOf = (category: HaulMovement['category'], right: boolean): OptimalConveyor =>
  `${category === 'freehaul' ? 'Freehaul' : category === 'overhaul' ? 'Overhaul' : 'Endhaul'} ${right ? 'right' : 'left'}`
const TYPE_NAMES: Record<HaulMovement['category'], string> = {
  freehaul: 'Freehaul',
  overhaul: 'Overhaul',
  endhaul: 'Endhaul',
}

/**
 * The Optimal Haul export of a road's solved material plan. `design` is the road's engineering
 * input (materials for factors and codes, sites for pit names). Throws when the road has no
 * adopted plan: haul off, or a plan that was infeasible or not solved.
 */
export function optimalHaulFromAnalysis(
  analysis: RoadAnalysis,
  design: AlignmentEngineering,
  options: { codes?: Map<string, string> } = {},
): OptimalHaulExport {
  refuseInvalidResults('Optimal Haul export', analysis)
  const e = analysis.engineering
  if (!e || !e.haul.enabled) throw Error('Turn on haul allocation first: the Optimal Haul export is the material plan.')
  if (materialPlanMissing(e.haul)) throw Error('The material plan was not calculated, so there is no haul to export.')
  const codes = options.codes ?? optimalMaterialCodes(design.materials)
  const codeOf = (id: string | null) =>
    id === null ? OPTIMAL_UNKNOWN_MATERIAL_CODE : (codes.get(id) ?? OPTIMAL_UNKNOWN_MATERIAL_CODE)
  const factorOf = new Map(design.materials.map((m) => [m.id, m.compactionFactor]))
  const leftOut: string[] = []
  let bankOnly = 0
  const equivalent = (m: HaulMovement) => {
    if (m.volumeBasis === 'compacted') return m.transportedVolumeM3
    if (m.compactedVolumeM3 !== null) return m.compactedVolumeM3
    const factor = m.materialId === null ? undefined : factorOf.get(m.materialId)
    if (factor === undefined) {
      bankOnly += m.transportedVolumeM3
      return m.transportedVolumeM3
    }
    return m.transportedVolumeM3 * factor
  }

  // Rows in the order of the road's materials, then unclassified and unknown, as they occur.
  const order = [...design.materials.map((m) => codeOf(m.id))]
  const touch = (code: string) => {
    if (!order.includes(code)) order.push(code)
    return code
  }
  const volumes = new Map<string, OptimalHaulVolumes>()
  const movementTotals = new Map<string, OptimalHaulMovementTotals>()
  const volumeRow = (code: string) => {
    touch(code)
    let row = volumes.get(code)
    if (!row) {
      row = { material: code, cut: 0, borrow: 0, underflow: 0, fill: 0, waste: 0, overflow: 0, sidecast: 0 }
      volumes.set(code, row)
    }
    return row as { [K in keyof OptimalHaulVolumes]: K extends 'material' ? string : number }
  }
  const movementRow = (code: string) => {
    touch(code)
    let row = movementTotals.get(code)
    if (!row) {
      row = { material: code, cut: 0, pitLoad: 0, stationUnload: 0, pitUnload: 0, sameStationUnload: 0, sidecast: 0 }
      movementTotals.set(code, row)
    }
    return row as { [K in keyof OptimalHaulMovementTotals]: K extends 'material' ? string : number }
  }
  const haulCost = new Map<string, number>(),
    cutCost = new Map<string, number>()
  const addTo = (map: Map<string, number>, code: string, value: number) =>
    map.set(touch(code), (map.get(code) ?? 0) + value)

  // Pits: every enabled site, named uniquely.
  // The pits of last resort, when on, are not pits: their volumes are RoadEng's Overflow and
  // Underflow columns (`lastResortPits.ts`).
  const planSites = [...design.sites, ...lastResortSites(design)]
  const sites = design.sites.filter((s) => s.enabled !== false)
  const pitNames = new Map<string, string>()
  for (const s of sites) {
    let name = s.name.trim() || (s.kind === 'borrow' ? 'Borrow' : 'Waste'),
      n = 2
    while ([...pitNames.values()].includes(name)) name = `${s.name} (${n++})`
    pitNames.set(s.id, name)
  }
  const pitVolumes = new Map<string, Record<string, number | null>>(sites.map((s) => [s.id, {}]))
  const siteById = new Map(planSites.map((s) => [s.id, s]))

  // Segments: one per calculated interval, `interval-i` ending at station i.
  const stations = analysis.stations
  const segmentOf = (id: string, chainage: number) => {
    const i = /^interval-(\d+)$/.exec(id)?.[1]
    if (i !== undefined && +i >= 1 && +i < stations.length) return +i
    let lo = 1,
      hi = stations.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (stations[mid].chainage < chainage) lo = mid + 1
      else hi = mid
    }
    return Math.max(1, lo)
  }
  const segments = new Map<string, OptimalHaulSegment>()
  const segment = (index: number, code: string) => {
    const key = `${code}\u0000${index}`
    let s = segments.get(key)
    if (!s) {
      s = {
        material: code,
        stn1: stations[index - 1].chainage,
        stn2: stations[index].chainage,
        cut: 0,
        fill: 0,
        cutToFill: 0,
        sidecast: 0,
        conveyors: conveyorRecord(emptyFlows),
      }
      segments.set(key, s)
    }
    return s
  }
  const pitDetails = new Map<string, OptimalHaulPitDetail>()
  const pitDetail = (siteId: string, code: string) => {
    const key = `${siteId}\u0000${code}`
    let d = pitDetails.get(key)
    if (!d) {
      d = { pit: pitNames.get(siteId) ?? siteId, material: code, conveyors: conveyorRecord(() => 0) }
      pitDetails.set(key, d)
    }
    return d
  }
  const convey = (code: string, conveyor: OptimalConveyor, from: number, to: number, v: number) => {
    const right = conveyor.endsWith('right')
    for (let k = from; right ? k < to : k > to; k += right ? 1 : -1) segment(k, code).conveyors[conveyor].transport += v
  }
  const range = (index: number) => [stations[index - 1].chainage, stations[index].chainage] as const

  const detailed: OptimalHaulMovement[] = []
  let unresolved = 0
  for (const m of e.movements) {
    if (m.externalUnresolved) {
      unresolved += m.transportedVolumeM3
      continue
    }
    // Nearest-site borrow records no material; the site's own material is what it supplies.
    const materialId = m.materialId ?? (m.kind === 'borrow' ? (siteById.get(m.sourceId)?.materialId ?? null) : null)
    const code = codeOf(materialId)
    const v = equivalent(m)
    const vol = volumeRow(code),
      mov = movementRow(code)
    addTo(haulCost, code, m.haulCost)
    const right = m.toChainage >= m.fromChainage
    const conveyor = conveyorOf(m.category, right)
    const direction: HaulDirection = right ? 'Push' : 'Pull'
    if (m.kind === 'cut-to-fill') {
      const from = segmentOf(m.sourceId, m.fromChainage),
        to = segmentOf(m.targetId, m.toChainage)
      vol.cut += v
      vol.fill -= v
      mov.cut += v
      segment(from, code).cut += v
      segment(to, code).fill -= v
      if (m.sourceId === m.targetId) {
        mov.sameStationUnload -= v
        segment(from, code).cutToFill += v
        continue
      }
      mov.stationUnload -= v
      segment(from, code).conveyors[conveyor].load += v
      segment(to, code).conveyors[conveyor].unload -= v
      convey(code, conveyor, from, to, v)
      const [c1, c2] = range(from),
        [f1, f2] = range(to)
      detailed.push({
        material: code,
        volume: v,
        cutStn1: c1,
        cutStn2: c2,
        fillStn1: f1,
        fillStn2: f2,
        distance: m.distanceM,
        type: TYPE_NAMES[m.category],
        direction,
        comment: '',
      })
    } else if (m.kind === 'borrow') {
      const site = siteById.get(m.sourceId)
      const to = segmentOf(m.targetId, m.toChainage),
        from = segmentOf('', m.fromChainage)
      if (site?.lastResort) vol.underflow += v
      else vol.borrow += v
      vol.fill -= v
      mov.pitLoad += v
      mov.stationUnload -= v
      if (site) addTo(cutCost, code, m.transportedVolumeM3 * site.unitRate)
      const pit = pitVolumes.get(m.sourceId)
      if (pit) pit[code] = (pit[code] ?? 0) + v
      segment(to, code).fill -= v
      segment(from, code).conveyors[conveyor].loadPit += v
      segment(to, code).conveyors[conveyor].unload -= v
      convey(code, conveyor, from, to, v)
      if (!site?.lastResort) pitDetail(m.sourceId, code).conveyors[conveyor] += v
      const [f1, f2] = range(to)
      detailed.push({
        material: code,
        volume: v,
        cutStn1: m.fromChainage,
        cutStn2: m.fromChainage,
        fillStn1: f1,
        fillStn2: f2,
        distance: m.distanceM,
        type: TYPE_NAMES[m.category],
        direction,
        comment: `Mvt from ${pitNames.get(m.sourceId) ?? lastResortName(m.sourceId) ?? m.sourceId}`,
      })
    } else {
      const from = segmentOf(m.sourceId, m.fromChainage)
      vol.cut += v
      mov.cut += v
      segment(from, code).cut += v
      if (m.disposalMethod === 'sidecast') {
        vol.sidecast -= v
        mov.sidecast -= v
        segment(from, code).sidecast -= v
        continue
      }
      const to = segmentOf('', m.toChainage)
      const overflow = !!siteById.get(m.targetId)?.lastResort
      if (overflow) vol.overflow -= v
      else vol.waste -= v
      mov.pitUnload -= v
      const pit = pitVolumes.get(m.targetId)
      if (pit) pit[code] = (pit[code] ?? 0) - v
      segment(from, code).conveyors[conveyor].load += v
      segment(to, code).conveyors[conveyor].unloadPit -= v
      convey(code, conveyor, from, to, v)
      if (!overflow) pitDetail(m.targetId, code).conveyors[conveyor] -= v
      const [c1, c2] = range(from)
      detailed.push({
        material: code,
        volume: v,
        cutStn1: c1,
        cutStn2: c2,
        fillStn1: m.toChainage,
        fillStn2: m.toChainage,
        distance: m.distanceM,
        type: TYPE_NAMES[m.category],
        direction,
        comment: `Mvt to ${pitNames.get(m.targetId) ?? lastResortName(m.targetId) ?? m.targetId}`,
      })
    }
  }
  // Nearest-site allocation leaves what no site could take at the default rates: Optimal's pits
  // of last resort. Its material is not recorded, and overflow stays in bank m³.
  if (e.haul.unallocatedBorrowM3 > EPS && e.haul.allocationMethod !== 'economic') {
    const row = volumeRow(OPTIMAL_UNKNOWN_MATERIAL_CODE)
    row.underflow += e.haul.unallocatedBorrowM3
    row.fill -= e.haul.unallocatedBorrowM3
    addTo(cutCost, OPTIMAL_UNKNOWN_MATERIAL_CODE, e.haul.unallocatedBorrowM3 * design.haul.borrowRate)
  }
  if (e.haul.unallocatedWasteM3 > EPS && e.haul.allocationMethod !== 'economic') {
    const row = volumeRow(OPTIMAL_UNKNOWN_MATERIAL_CODE)
    row.cut += e.haul.unallocatedWasteM3
    row.overflow -= e.haul.unallocatedWasteM3
    leftOut.push(
      `Overflow of ${fmt(e.haul.unallocatedWasteM3, 2)} bank m³ (waste no site could take) is under ${OPTIMAL_UNKNOWN_MATERIAL_CODE} in bank m³: its material is not recorded.`,
    )
  }
  if (unresolved > EPS)
    leftOut.push(`${fmt(unresolved, 2)} m³ left for external supply or disposal: not a movement, so not exported.`)
  if (bankOnly > EPS)
    leftOut.push(`${fmt(bankOnly, 2)} bank m³ of waste of an unknown material is written in bank m³, unconverted.`)

  for (const q of e.materials) addTo(cutCost, codeOf(q.materialId), q.excavationCost)
  // Fill cost by the material placed: each material's own embankment cost where the road prices fill
  // so (`fillPlacement.ts`), else by the share of fill each material places.
  const fillByMaterial = new Map<string, number>()
  for (const line of e.fillPlacement ?? [])
    if (line.materialId !== null) addTo(fillByMaterial, codeOf(line.materialId), line.amount)
  const fillUnpriced = e.costs.fill - [...fillByMaterial.values()].reduce((s, v) => s + v, 0)
  const fillPlaced = new Map<string, number>()
  for (const row of volumes.values()) if (row.fill! < -EPS) fillPlaced.set(row.material, -row.fill!)
  const fillTotal = [...fillPlaced.values()].reduce((s, v) => s + v, 0)
  const fillShare = (code: string) =>
    e.fillPlacement
      ? (fillByMaterial.get(code) ?? 0) +
        (fillTotal > EPS ? (fillUnpriced * (fillPlaced.get(code) ?? 0)) / fillTotal : 0)
      : fillTotal > EPS
        ? (e.costs.fill * (fillPlaced.get(code) ?? 0)) / fillTotal
        : null
  const codesInUse = order.filter(
    (c) => volumes.has(c) || haulCost.has(c) || cutCost.has(c) || design.materials.some((m) => codeOf(m.id) === c),
  )
  const costs = codesInUse.map((code) => ({
    material: code,
    haul: haulCost.get(code) ?? 0,
    cut: cutCost.get(code) ?? 0,
    fill: fillShare(code),
    pitOpening: null,
  }))
  const costTotal: OptimalHaulCost = {
    haul: costs.reduce((s, c) => s + c.haul, 0),
    cut: costs.reduce((s, c) => s + c.cut, 0),
    fill: e.costs.fill,
    pitOpening: e.costs.sitePreparation,
  }
  if (e.costs.waste > EPS)
    leftOut.push(`Waste disposal and sidecast charges ($${fmt(e.costs.waste, 2)}) have no column in the cost summary.`)
  const other = (
    [
      ['surfacing', e.costs.surfacing],
      ['clearing', e.costs.clearing],
      ['structures', e.costs.structures],
      ['mobilization', e.costs.mobilization],
      ['contingency', e.costs.contingency],
    ] as const
  ).filter(([, v]) => v > EPS)
  if (other.length)
    leftOut.push(
      `Costs outside earthwork are not in this export: ${other.map(([k, v]) => `${k} $${fmt(v, 2)}`).join(', ')}.`,
    )

  const zero = (v: number) => Math.abs(v) <= 1e-9
  const segmentList = [...segments.values()]
    .filter(
      (s) =>
        !zero(s.cut) ||
        !zero(s.fill) ||
        OPTIMAL_CONVEYORS.some((c) => Object.values(s.conveyors[c]).some((v) => !zero(v))),
    )
    .sort((a, b) => order.indexOf(a.material) - order.indexOf(b.material) || a.stn1 - b.stn1)
  return {
    costTotal,
    costs,
    volumes: codesInUse.map(
      (code) =>
        volumes.get(code) ?? {
          material: code,
          cut: 0,
          borrow: 0,
          underflow: 0,
          fill: 0,
          waste: 0,
          overflow: 0,
          sidecast: 0,
        },
    ),
    pits: sites.map((s) => ({
      name: pitNames.get(s.id)!,
      station: s.chainage,
      distance: s.accessDistanceM,
      volumes: Object.fromEntries(codesInUse.map((code) => [code, pitVolumes.get(s.id)![code] ?? 0])),
    })),
    movements: codesInUse.map(
      (code) =>
        movementTotals.get(code) ?? {
          material: code,
          cut: 0,
          pitLoad: 0,
          stationUnload: 0,
          pitUnload: 0,
          sameStationUnload: 0,
          sidecast: 0,
        },
    ),
    segments: segmentList,
    pitDetails: [...pitDetails.values()],
    detailedMovements: detailed
      .map((d, i) => ({ d, i }))
      .sort((a, b) => order.indexOf(a.d.material) - order.indexOf(b.d.material) || a.i - b.i)
      .map(({ d }) => d),
    otherSections: [],
    leftOut,
  }
}

export interface OptimalHaulSections {
  /** Cost, volume, pit and movement summaries ("Include Other Summaries"). */
  summaries?: boolean
  /** Movement and pit details ("Include Haul Details"); their columns are PGMaps'. */
  details?: boolean
  /** The detailed movement summary ("Include Haul Summary"). */
  haulSummary?: boolean
}

/** Writes an Optimal Haul export: summaries, details, then the detailed movement summary, a blank line between. */
export function writeOptimalHaulCsv(
  data: OptimalHaulExport,
  options: { units?: SoftreeUnits; sections?: OptimalHaulSections } = {},
): string {
  const k = scaleOf(options.units)
  const { summaries = true, details = true, haulSummary = true } = options.sections ?? {}
  const v = (value: number | null) => fmt(div(value, k.vol), 2)
  const s = (value: number | null) => fmt(div(value, k.len), 3)
  const money = (value: number | null) => fmt(value, 2)
  const blocks: string[][] = []
  for (const other of data.otherSections) blocks.push(other.rows.map((r) => line(r.map(textCell))))
  if (summaries) {
    blocks.push([
      line([OPTIMAL_HAUL_SECTION_TITLES.cost, ...OPTIMAL_HAUL_COST_COLUMNS]),
      ...(data.costTotal
        ? [
            line([
              'Total',
              money(data.costTotal.haul),
              money(data.costTotal.cut),
              money(data.costTotal.fill),
              money(data.costTotal.pitOpening),
            ]),
          ]
        : []),
      ...data.costs.map((c) =>
        line([textCell(c.material), money(c.haul), money(c.cut), money(c.fill), money(c.pitOpening)]),
      ),
    ])
    blocks.push([
      line([OPTIMAL_HAUL_SECTION_TITLES.volume, ...OPTIMAL_HAUL_VOLUME_COLUMNS]),
      ...data.volumes.map((r) =>
        line([
          textCell(r.material),
          v(r.cut),
          v(r.borrow),
          v(r.underflow),
          v(r.fill),
          v(r.waste),
          v(r.overflow),
          v(r.sidecast),
        ]),
      ),
    ])
    const materials = [...new Set(data.pits.flatMap((p) => Object.keys(p.volumes)))]
    // A pit summary with no pit would have no header to read back: it is left out.
    if (data.pits.length)
      blocks.push([
        line([OPTIMAL_HAUL_SECTION_TITLES.pit, ...data.pits.map((p) => textCell(p.name))]),
        line(['Station number', ...data.pits.map((p) => s(p.station))]),
        line(['Distance', ...data.pits.map((p) => s(p.distance))]),
        ...materials.map((m) => line([textCell(m), ...data.pits.map((p) => v(p.volumes[m] ?? null))])),
      ])
    blocks.push([
      line([OPTIMAL_HAUL_SECTION_TITLES.movement, ...OPTIMAL_HAUL_MOVEMENT_COLUMNS]),
      ...data.movements.map((r) =>
        line([
          textCell(r.material),
          v(r.cut),
          v(r.pitLoad),
          v(r.stationUnload),
          v(r.pitUnload),
          v(r.sameStationUnload),
          v(r.sidecast),
        ]),
      ),
    ])
  }
  if (details) {
    blocks.push([
      OPTIMAL_HAUL_SECTION_TITLES.segments,
      line(OPTIMAL_HAUL_SEGMENT_COLUMNS),
      ...data.segments.map((r) =>
        line([
          textCell(r.material),
          s(r.stn1),
          s(r.stn2),
          v(r.cut),
          v(r.fill),
          v(r.cutToFill),
          v(r.sidecast),
          ...OPTIMAL_CONVEYORS.flatMap((c) => {
            const f = r.conveyors[c]
            return [v(f.load), v(f.unload), v(f.loadPit), v(f.unloadPit), v(f.transport)]
          }),
        ]),
      ),
    ])
    blocks.push([
      OPTIMAL_HAUL_SECTION_TITLES.pitDetails,
      line(OPTIMAL_HAUL_PIT_DETAIL_COLUMNS),
      ...data.pitDetails.map((r) =>
        line([textCell(r.pit), textCell(r.material), ...OPTIMAL_CONVEYORS.map((c) => v(r.conveyors[c]))]),
      ),
    ])
  }
  if (haulSummary) {
    const rows: string[] = [OPTIMAL_HAUL_SECTION_TITLES.detailed, line(OPTIMAL_HAUL_DETAILED_COLUMNS)]
    let previous: string | null = null
    for (const d of data.detailedMovements) {
      if (previous !== null && d.material !== previous) rows.push('')
      previous = d.material
      rows.push(
        line([
          textCell(d.material),
          v(d.volume),
          s(d.cutStn1),
          s(d.cutStn2),
          s(d.fillStn1),
          s(d.fillStn2),
          s(d.distance),
          textCell(d.type),
          d.direction ?? '',
          textCell(d.comment),
        ]),
      )
    }
    blocks.push(rows)
  }
  return joinLines(blocks.flatMap((b, i) => (i ? ['', ...b] : b)))
}

type SectionKey = keyof typeof OPTIMAL_HAUL_SECTION_TITLES
const SECTION_BY_TITLE = new Map<string, SectionKey>(
  Object.entries(OPTIMAL_HAUL_SECTION_TITLES).map(([key, title]) => [norm(title), key as SectionKey]),
)

/** Reads an Optimal Haul export, every section it recognises; the rest is kept in `otherSections`. */
export function readOptimalHaulCsv(
  text: string,
  options: { units?: SoftreeUnits } = {},
): SoftreeRead<OptimalHaulExport> {
  const units = options.units ?? 'metric',
    k = scaleOf(units)
  const rows = readRows(text, 'The Optimal Haul export')
  const out: OptimalHaulExport = {
    costTotal: null,
    costs: [],
    volumes: [],
    pits: [],
    movements: [],
    segments: [],
    pitDetails: [],
    detailedMovements: [],
    otherSections: [],
    leftOut: [],
  }
  const warnings: string[] = []
  // Split into sections at each known title.
  const sections: { key: SectionKey | null; title: string; start: number; rows: [number, string[]][] }[] = []
  let current: (typeof sections)[number] = { key: null, title: '', start: 0, rows: [] }
  rows.forEach((row, r) => {
    const key = row.length ? SECTION_BY_TITLE.get(norm(row[0])) : undefined
    if (key) {
      if (current.key !== null || current.rows.length) sections.push(current)
      current = { key, title: row[0], start: r, rows: [[r, row]] }
    } else if (row.length) current.rows.push([r, row])
  })
  if (current.key !== null || current.rows.length) sections.push(current)
  if (!sections.some((s) => s.key !== null))
    throw Error('This is not a RoadEng Optimal Haul export: none of its section titles were found.')

  for (const section of sections) {
    if (section.key === null) {
      out.otherSections.push({ title: section.title, rows: section.rows.map(([, r]) => r.map(untext)) })
      continue
    }
    // The title shares the header row in the summaries; otherwise the header is the next row.
    const [titleRow, ...rest] = section.rows
    const inline = titleRow[1].length > 1
    const header = inline ? titleRow[1] : rest[0]?.[1]
    const body = inline ? rest : rest.slice(1)
    if (!header) continue
    const where = (r: number, what: string) => `Line ${r + 1}, ${what}`
    const kept: string[][] = []
    const each = (fn: (row: string[], r: number) => void) => {
      for (const [r, row] of body)
        try {
          fn(row, r)
        } catch (error) {
          warnings.push((error as Error).message)
          kept.push(row)
        }
    }
    switch (section.key) {
      case 'cost': {
        const col = columnIndex(header, {
          haul: ['haul', 'earth movement'],
          cut: ['cut'],
          fill: ['fill'],
          pitOpening: ['pit opening', 'site preparation'],
        })
        each((row, r) => {
          const n = (key: string) => (col[key] >= 0 ? numberCell(row[col[key]], where(r, key)) : null)
          const cost = { haul: n('haul'), cut: n('cut'), fill: n('fill'), pitOpening: n('pitOpening') }
          if (norm(row[0] ?? '') === 'total' || (row[0] ?? '') === '') out.costTotal = cost
          else out.costs.push({ material: untext(row[0]), ...cost })
        })
        break
      }
      case 'volume': {
        const keys = ['cut', 'borrow', 'underflow', 'fill', 'waste', 'overflow', 'sidecast'] as const
        const col = columnIndex(header, Object.fromEntries(keys.map((key) => [key, [key]])))
        each((row, r) => {
          const record = { material: untext(row[0] ?? '') } as OptimalHaulVolumes
          for (const key of keys)
            record[key] = col[key] >= 0 ? mul(numberCell(row[col[key]], where(r, key)), k.vol) : null
          out.volumes.push(record)
        })
        break
      }
      case 'pit': {
        const pits: OptimalHaulPitSummary[] = header
          .slice(1)
          .map((name) => ({ name: untext(name), station: null, distance: null, volumes: {} }))
        each((row, r) => {
          const label = norm(row[0] ?? '')
          pits.forEach((pit, i) => {
            const value = numberCell(row[i + 1], where(r, pit.name))
            if (label === 'station number' || label === 'station') pit.station = mul(value, k.len)
            else if (label === 'distance') pit.distance = mul(value, k.len)
            else pit.volumes[untext(row[0])] = mul(value, k.vol)
          })
        })
        out.pits = pits
        break
      }
      case 'movement': {
        const col = columnIndex(header, {
          cut: ['cut', 'station load'],
          pitLoad: ['pit load'],
          stationUnload: ['station unload (movement)', 'station unload'],
          pitUnload: ['pit unload'],
          sameStationUnload: ['same station unload (no movement)', 'same station unload'],
          sidecast: ['sidecast (no movement)', 'sidecast'],
        })
        each((row, r) => {
          const n = (key: string) => (col[key] >= 0 ? mul(numberCell(row[col[key]], where(r, key)), k.vol) : null)
          out.movements.push({
            material: untext(row[0] ?? ''),
            cut: n('cut'),
            pitLoad: n('pitLoad'),
            stationUnload: n('stationUnload'),
            pitUnload: n('pitUnload'),
            sameStationUnload: n('sameStationUnload'),
            sidecast: n('sidecast'),
          })
        })
        break
      }
      case 'segments': {
        const names = header.map(norm)
        if (names.join(',') !== OPTIMAL_HAUL_SEGMENT_COLUMNS.map(norm).join(',')) {
          out.otherSections.push({ title: section.title, rows: section.rows.map(([, r]) => r.map(untext)) })
          break
        }
        each((row, r) => {
          const n = (i: number, by: number) => (numberCell(row[i], where(r, header[i])) ?? 0) * by
          let i = 7
          out.segments.push({
            material: untext(row[0] ?? ''),
            stn1: n(1, k.len),
            stn2: n(2, k.len),
            cut: n(3, k.vol),
            fill: n(4, k.vol),
            cutToFill: n(5, k.vol),
            sidecast: n(6, k.vol),
            conveyors: conveyorRecord(() => {
              const f = {
                load: n(i, k.vol),
                unload: n(i + 1, k.vol),
                loadPit: n(i + 2, k.vol),
                unloadPit: n(i + 3, k.vol),
                transport: n(i + 4, k.vol),
              }
              i += 5
              return f
            }),
          })
        })
        break
      }
      case 'pitDetails': {
        const names = header.map(norm)
        if (names.join(',') !== OPTIMAL_HAUL_PIT_DETAIL_COLUMNS.map(norm).join(',')) {
          out.otherSections.push({ title: section.title, rows: section.rows.map(([, r]) => r.map(untext)) })
          break
        }
        each((row, r) => {
          let i = 2
          out.pitDetails.push({
            pit: untext(row[0] ?? ''),
            material: untext(row[1] ?? ''),
            conveyors: conveyorRecord(() => (numberCell(row[i], where(r, header[i++])) ?? 0) * k.vol),
          })
        })
        break
      }
      case 'detailed': {
        const col = columnIndex(header, {
          material: ['material'],
          volume: ['vol moved', 'volume moved', 'volume'],
          cutStn1: ['cut stn1'],
          cutStn2: ['cut stn2'],
          fillStn1: ['fill stn1'],
          fillStn2: ['fill stn2'],
          distance: ['distance'],
          type: ['type'],
          direction: ['direction'],
          comment: ['comment'],
        })
        each((row, r) => {
          const get = (key: string) => (col[key] >= 0 ? row[col[key]] : undefined)
          const n = (key: string, by: number) => mul(numberCell(get(key), where(r, key)), by)
          const volume = n('volume', k.vol)
          if (volume === null) throw Error(`${where(r, 'Vol moved')}: no volume.`)
          out.detailedMovements.push({
            material: untext(get('material') ?? ''),
            volume,
            cutStn1: n('cutStn1', k.len),
            cutStn2: n('cutStn2', k.len),
            fillStn1: n('fillStn1', k.len),
            fillStn2: n('fillStn2', k.len),
            distance: n('distance', k.len),
            type: untext(get('type') ?? ''),
            direction: direction(get('direction')),
            comment: untext(get('comment') ?? ''),
          })
        })
        break
      }
    }
    if (kept.length)
      out.otherSections.push({ title: `${section.title} (rows not read)`, rows: kept.map((r) => r.map(untext)) })
  }
  return { value: out, units, warnings }
}

export interface OptimalHaulComparison {
  rows: (QuantityDifference & { section: 'cost' | 'volume' | 'pit' | 'movement' | 'haul' })[]
  /** Materials or pits found on one side only. */
  onlyTheirs: string[]
  onlyOurs: string[]
}

/**
 * RoadEng's Optimal Haul export beside PGMaps': per material, each cost, volume and movement
 * column; per pit (matched by name, else by station within 1 m), each material's volume; and per
 * material and haul type, the detailed movements' volume and volume × distance (m³·m).
 */
export function compareOptimalHaul(theirs: OptimalHaulExport, ours: OptimalHaulExport): OptimalHaulComparison {
  const rows: OptimalHaulComparison['rows'] = []
  const onlyTheirs = new Set<string>(),
    onlyOurs = new Set<string>()
  const byMaterial = <T extends { material: string }>(
    section: OptimalHaulComparison['rows'][number]['section'],
    a: readonly T[],
    b: readonly T[],
    fields: readonly (keyof T & string)[],
  ) => {
    const keys = [...new Set([...a, ...b].map((r) => r.material.toUpperCase()))]
    for (const key of keys) {
      const t = a.find((r) => r.material.toUpperCase() === key),
        o = b.find((r) => r.material.toUpperCase() === key)
      if (!t) onlyOurs.add(key)
      if (!o) onlyTheirs.add(key)
      for (const f of fields)
        rows.push({
          section,
          ...diff(key, f, (t?.[f] as number | null | undefined) ?? null, (o?.[f] as number | null | undefined) ?? null),
        })
    }
  }
  if (theirs.costTotal || ours.costTotal)
    for (const f of ['haul', 'cut', 'fill', 'pitOpening'] as const)
      rows.push({ section: 'cost', ...diff('Total', f, theirs.costTotal?.[f] ?? null, ours.costTotal?.[f] ?? null) })
  byMaterial('cost', theirs.costs, ours.costs, ['haul', 'cut', 'fill'])
  byMaterial('volume', theirs.volumes, ours.volumes, [
    'cut',
    'borrow',
    'underflow',
    'fill',
    'waste',
    'overflow',
    'sidecast',
  ])
  byMaterial('movement', theirs.movements, ours.movements, [
    'cut',
    'pitLoad',
    'stationUnload',
    'pitUnload',
    'sameStationUnload',
    'sidecast',
  ])
  const unmatched = new Set(theirs.pits)
  for (const o of ours.pits) {
    const t =
      [...unmatched].find((p) => p.name.toUpperCase() === o.name.toUpperCase()) ??
      [...unmatched].find((p) => p.station !== null && o.station !== null && Math.abs(p.station - o.station) <= 1)
    if (!t) {
      onlyOurs.add(`pit ${o.name}`)
      continue
    }
    unmatched.delete(t)
    rows.push({ section: 'pit', ...diff(o.name, 'station', t.station, o.station) })
    rows.push({ section: 'pit', ...diff(o.name, 'distance', t.distance, o.distance) })
    for (const m of new Set([...Object.keys(t.volumes), ...Object.keys(o.volumes)]))
      rows.push({ section: 'pit', ...diff(o.name, m, t.volumes[m] ?? null, o.volumes[m] ?? null) })
  }
  for (const t of unmatched) onlyTheirs.add(`pit ${t.name}`)
  const haulTotals = (list: readonly OptimalHaulMovement[]) => {
    const totals = new Map<string, { volume: number; work: number }>()
    for (const d of list) {
      const key = `${d.material.toUpperCase()} ${norm(d.type)}`
      const t = totals.get(key) ?? { volume: 0, work: 0 }
      t.volume += d.volume
      t.work += d.volume * (d.distance ?? 0)
      totals.set(key, t)
    }
    return totals
  }
  const th = haulTotals(theirs.detailedMovements),
    oh = haulTotals(ours.detailedMovements)
  for (const key of new Set([...th.keys(), ...oh.keys()])) {
    rows.push({ section: 'haul', ...diff(key, 'volume', th.get(key)?.volume ?? null, oh.get(key)?.volume ?? null) })
    rows.push({
      section: 'haul',
      ...diff(key, 'volume×distance', th.get(key)?.work ?? null, oh.get(key)?.work ?? null),
    })
  }
  return { rows, onlyTheirs: [...onlyTheirs], onlyOurs: [...onlyOurs] }
}

/* ------------------------------------------------------------------------------------------------
 * Softree Optimal Areas CSV
 * --------------------------------------------------------------------------------------------- */

export const OPTIMAL_AREAS_COLUMNS = ['h-offset', 'station', 'x', 'y', 'z(ground)', 'error', 'v-offset'] as const

export interface OptimalAreaEntry {
  /** As written: `M_OB`, `M_q1`, `T_MCUT`… */
  code: string
  /** m² for a material (cut positive, fill negative); metres for a pseudo material. */
  value: number
}
export interface OptimalAreaRecord {
  hOffset: number
  station: number
  x: number | null
  y: number | null
  zGround: number | null
  error: boolean
  /** The record ends after its error flag: a bridge, with no level. */
  bridge: boolean
  /** Design level above ground; null when blank. */
  vOffset: number | null
  entries: OptimalAreaEntry[]
}
export interface OptimalAreasFile {
  version: number | null
  hOffsetCount: number | null
  hOffsetDistance: number | null
  stationCount: number | null
  /** Header lines other than the four known ones, as label and value. */
  otherHeader: [string, string][]
  records: OptimalAreaRecord[]
}

const isMaterialCode = (code: string) => /^M_/i.test(code)

/**
 * The Areas file of a calculated road: one record per station, at h-offset 0 and the design's own
 * level. `design` is the road's engineering input (fill requirements and material codes);
 * `toGrid` puts stations into the projected grid the X and Y columns are in.
 */
export function optimalAreasFromAnalysis(
  analysis: RoadAnalysis,
  design: AlignmentEngineering | undefined,
  options: { toGrid: ToGrid; codes?: Map<string, string> },
): OptimalAreasFile {
  refuseInvalidResults('Optimal Areas export', analysis)
  if (!analysis.stations.length) throw Error('The road has no calculated stations yet.')
  const codes = options.codes ?? optimalMaterialCodes(design?.materials ?? [])
  const code = (id: string) => codes.get(id) ?? OPTIMAL_UNKNOWN_MATERIAL_CODE
  const fillCode = (chainage: number, layer: string): string | null => {
    const r = design ? requiredFillAt(design, chainage, layer) : undefined
    if (!r) return layer === 'subgrade' ? 'q4' : null
    // An exact requirement takes its material; a replaceable one the quality it accepts.
    if (r.materialId && !r.replaceable) return code(r.materialId)
    const quality = r.minQuality ?? design!.materials.find((m) => m.id === r.materialId)?.quality
    if (quality !== undefined) return `q${optimalQuality(quality)}`
    return r.materialId ? code(r.materialId) : 'q4'
  }
  const records: OptimalAreaRecord[] = analysis.stations.map((s, i) => {
    const [x, y] = options.toGrid(s.coordinate)
    const vOffset =
      s.designElevation !== null && s.groundElevation !== null ? s.designElevation - s.groundElevation : null
    const record: OptimalAreaRecord = {
      hOffset: 0,
      station: s.chainage,
      x: Number.isFinite(x) ? x : null,
      y: Number.isFinite(y) ? y : null,
      zGround: s.groundElevation,
      error: !s.complete,
      bridge: false,
      vOffset,
      entries: [],
    }
    if (!s.complete || s.cutAreaM2 === null || s.fillAreaM2 === null) return record
    const areas = new Map<string, number>()
    const add = (c: string, value: number) => areas.set(c, (areas.get(c) ?? 0) + value)
    const es = analysis.engineering?.stations[i]
    if (es && es.materialAreas.every((m) => m.cutAreaM2 !== null))
      for (const m of es.materialAreas) add(code(m.materialId), m.cutAreaM2!)
    else add(OPTIMAL_UNCLASSIFIED_CODE, s.cutAreaM2)
    for (const p of s.preparationAreas ?? []) add(code(p.materialId ?? UNCLASSIFIED_ID), p.areaM2)
    let subgrade = s.fillAreaM2
    for (const c of s.componentAreas ?? []) {
      const target = c.materialId
        ? code(c.materialId)
        : design && requiredFillAt(design, s.chainage, c.id)
          ? fillCode(s.chainage, c.id)
          : null
      if (target === null) continue
      add(target, -c.areaM2)
      subgrade -= c.areaM2
    }
    add(fillCode(s.chainage, 'subgrade')!, -Math.max(0, subgrade))
    for (const layer of s.layerAreas ?? []) {
      const target = layer.materialId ? code(layer.materialId) : fillCode(s.chainage, layer.id)
      if (target !== null) add(target, -layer.areaM2)
    }
    for (const [c, value] of areas) if (Math.abs(value) >= 5e-5) record.entries.push({ code: `M_${c}`, value })
    if (vOffset !== null) record.entries.push({ code: 'T_MCUT', value: -vOffset }, { code: 'T_MFILL', value: vOffset })
    return record
  })
  return {
    version: OPTIMAL_AREAS_VERSION,
    hOffsetCount: 1,
    hOffsetDistance: 0,
    stationCount: records.length,
    otherHeader: [],
    records,
  }
}

export function writeOptimalAreasCsv(file: OptimalAreasFile, options: { units?: SoftreeUnits } = {}): string {
  const k = scaleOf(options.units)
  const len = (value: number | null) => fmt(div(value, k.len), 4)
  const lines = [
    'version',
    fmt(file.version, 0),
    'no. h-offset',
    fmt(file.hOffsetCount, 0),
    'h-offset distance',
    len(file.hOffsetDistance),
    'no. station',
    fmt(file.stationCount, 0),
    ...file.otherHeader.flatMap(([label, value]) => [textCell(label), textCell(value)]),
    'data start:',
    line(OPTIMAL_AREAS_COLUMNS),
  ]
  for (const r of file.records) {
    const fixed = [len(r.hOffset), len(r.station), len(r.x), len(r.y), len(r.zGround), r.error ? '1' : '0']
    if (r.bridge) {
      lines.push(line(fixed))
      continue
    }
    lines.push(
      line([
        ...fixed,
        len(r.vOffset),
        ...r.entries.flatMap((e) => [
          textCell(e.code),
          fmt(isMaterialCode(e.code) ? e.value / k.area : e.value / k.len, 4),
        ]),
      ]),
    )
  }
  return joinLines(lines)
}

/** Reads an Areas file. Values come back metric: m, m² for materials, metres for pseudo materials. */
export function readOptimalAreasCsv(
  text: string,
  options: { units?: SoftreeUnits } = {},
): SoftreeRead<OptimalAreasFile> {
  const units = options.units ?? 'metric',
    k = scaleOf(units)
  // Seven cells: a record with a blank level is not a bridge, whose record ends at its error flag.
  const rows = readRows(text, 'The Optimal Areas file', OPTIMAL_AREAS_COLUMNS.length)
  const file: OptimalAreasFile = {
    version: null,
    hOffsetCount: null,
    hOffsetDistance: null,
    stationCount: null,
    otherHeader: [],
    records: [],
  }
  const warnings: string[] = []
  let r = 0
  // The header: one-cell label lines, each followed by its value, up to "data start:".
  for (; r < rows.length; r++) {
    const label = norm(rows[r][0] ?? '')
    if (label === 'data start:' || label === 'data start') {
      r++
      break
    }
    if (!label) continue
    if (/^-?[\d.]/.test(label))
      throw Error(`Line ${r + 1}: a number before "data start:"; this is not an Optimal Areas file.`)
    const value = rows[r + 1]?.[0] ?? ''
    r++
    if (label === 'version') file.version = numberCell(value, `Line ${r + 1}, version`)
    else if (label === 'no. h-offset') file.hOffsetCount = numberCell(value, `Line ${r + 1}, no. h-offset`)
    else if (label === 'h-offset distance')
      file.hOffsetDistance = mul(numberCell(value, `Line ${r + 1}, h-offset distance`), k.len)
    else if (label === 'no. station') file.stationCount = numberCell(value, `Line ${r + 1}, no. station`)
    else file.otherHeader.push([untext(rows[r - 1][0]), untext(value)])
  }
  if (file.version === null && file.stationCount === null)
    throw Error('This is not a Softree Optimal Areas file: no "version" or "no. station" in its header.')
  if (r < rows.length && norm(rows[r][0] ?? '') === 'h-offset') r++
  for (; r < rows.length; r++) {
    const row = rows[r]
    if (!row.length) continue
    const where = (what: string) => `Line ${r + 1}, ${what}`
    try {
      if (row.length < 6) throw Error(`${where('record')}: ${row.length} fields, fewer than the six fixed ones.`)
      const n = (i: number, what: string) => numberCell(row[i], where(what))
      const record: OptimalAreaRecord = {
        hOffset: (n(0, 'h-offset') ?? 0) * k.len,
        station: mul(n(1, 'station'), k.len) ?? NaN,
        x: mul(n(2, 'x'), k.len),
        y: mul(n(3, 'y'), k.len),
        zGround: mul(n(4, 'z(ground)'), k.len),
        error: (n(5, 'error') ?? 0) !== 0,
        bridge: row.length === 6,
        vOffset: row.length > 6 ? mul(n(6, 'v-offset'), k.len) : null,
        entries: [],
      }
      if (!Number.isFinite(record.station)) throw Error(`${where('station')}: no station.`)
      const pairs = row.slice(7)
      if (pairs.length % 2) throw Error(`${where('materials')}: a code without its value.`)
      if (pairs.length / 2 > MAX_OPTIMAL_AREA_PAIRS)
        throw Error(`${where('materials')}: more than ${MAX_OPTIMAL_AREA_PAIRS} materials.`)
      for (let i = 0; i < pairs.length; i += 2) {
        const c = untext(pairs[i])
        if (!/^[MT]_/i.test(c))
          throw Error(`${where('materials')}: "${c}" is neither an M_ material nor a T_ pseudo material.`)
        const value = numberCell(pairs[i + 1], where(c))
        if (value === null) throw Error(`${where(c)}: no value.`)
        record.entries.push({ code: c, value: value * (isMaterialCode(c) ? k.area : k.len) })
      }
      file.records.push(record)
    } catch (error) {
      warnings.push((error as Error).message)
    }
  }
  return { value: file, units, warnings }
}

export interface OptimalAreasComparison {
  /** Per matched station: each material code, `(cut)` and `(fill)` totals, and the level when theirs has one. */
  rows: (QuantityDifference & { station: number })[]
  /** Our stations with no record of theirs within the tolerance, or whose level is outside their band. */
  unmatchedOurs: number[]
  unmatchedTheirs: number[]
}

/**
 * A RoadEng Areas file beside PGMaps'. Each of our stations is matched to their records at that
 * station (within `stationToleranceM`) and the h-offset nearest `hOffset`. With several levels,
 * their areas are read at our level by straight-line interpolation between the levels either side
 * (a material missing at a level is zero there); with one level, it is read as it is and the two
 * levels are listed. Cut and fill totals are compared as well as each code, because the two
 * programs may name materials differently.
 */
export function compareOptimalAreas(
  theirs: OptimalAreasFile,
  ours: OptimalAreasFile,
  options: { stationToleranceM?: number; hOffset?: number } = {},
): OptimalAreasComparison {
  const tolerance = options.stationToleranceM ?? 0.01,
    h0 = options.hOffset ?? 0
  const usable = (r: OptimalAreaRecord) => !r.error && !r.bridge && r.vOffset !== null
  const theirStations = [...new Set(theirs.records.filter(usable).map((r) => r.station))].sort((a, b) => a - b)
  const matchedTheirs = new Set<number>()
  const rows: OptimalAreasComparison['rows'] = [],
    unmatchedOurs: number[] = []
  const valuesOf = (r: OptimalAreaRecord) => {
    const map = new Map<string, number>()
    for (const e of r.entries)
      if (isMaterialCode(e.code)) map.set(e.code.toUpperCase(), (map.get(e.code.toUpperCase()) ?? 0) + e.value)
    return map
  }
  for (const o of ours.records) {
    if (!usable(o)) continue
    const nearest = theirStations.reduce<number | undefined>(
      (best, s) => (best === undefined || Math.abs(s - o.station) < Math.abs(best - o.station) ? s : best),
      undefined,
    )
    const station = nearest !== undefined && Math.abs(nearest - o.station) <= tolerance ? nearest : undefined
    if (station === undefined) {
      unmatchedOurs.push(o.station)
      continue
    }
    const atStation = theirs.records.filter((r) => usable(r) && r.station === station)
    const nearestH = atStation.reduce(
      (best, r) => (Math.abs(r.hOffset - h0) < Math.abs(best - h0) ? r.hOffset : best),
      Infinity,
    )
    const levels = atStation.filter((r) => r.hOffset === nearestH).sort((a, b) => a.vOffset! - b.vOffset!)
    let theirValues: Map<string, number> | null
    if (levels.length === 1) {
      theirValues = valuesOf(levels[0])
      rows.push({ station: o.station, ...diff(String(o.station), 'v-offset', levels[0].vOffset, o.vOffset) })
    } else {
      const v = o.vOffset!
      const above = levels.findIndex((r) => r.vOffset! >= v)
      if (above < 0 || (above === 0 && levels[0].vOffset! > v)) theirValues = null
      else {
        const b = levels[above],
          a = levels[Math.max(0, above - 1)]
        const t = b.vOffset! - a.vOffset! > EPS ? (v - a.vOffset!) / (b.vOffset! - a.vOffset!) : 0
        const va = valuesOf(a),
          vb = valuesOf(b)
        theirValues = new Map(
          [...new Set([...va.keys(), ...vb.keys()])].map((c) => [c, (va.get(c) ?? 0) * (1 - t) + (vb.get(c) ?? 0) * t]),
        )
      }
    }
    if (!theirValues) {
      unmatchedOurs.push(o.station)
      continue
    }
    matchedTheirs.add(station)
    const ourValues = valuesOf(o)
    for (const c of [...new Set([...theirValues.keys(), ...ourValues.keys()])].sort())
      rows.push({ station: o.station, ...diff(String(o.station), c, theirValues.get(c) ?? 0, ourValues.get(c) ?? 0) })
    const total = (m: Map<string, number>, sign: 1 | -1) =>
      [...m.values()].filter((v) => sign * v > 0).reduce((s, v) => s + v, 0)
    rows.push({ station: o.station, ...diff(String(o.station), '(cut)', total(theirValues, 1), total(ourValues, 1)) })
    rows.push({
      station: o.station,
      ...diff(String(o.station), '(fill)', total(theirValues, -1), total(ourValues, -1)),
    })
  }
  return { rows, unmatchedOurs, unmatchedTheirs: theirStations.filter((s) => !matchedTheirs.has(s)) }
}

/* ------------------------------------------------------------------------------------------------
 * Optimal API: materials, pits and cost model
 * --------------------------------------------------------------------------------------------- */

export const OPTIMAL_MATERIAL_COLUMNS = [
  'Identifier',
  'Description',
  'Embankment Cost',
  'Excavation Cost',
  'Quality',
  'Cut Factor',
  'Fill Factor',
  'True Material',
] as const

/** A material of the Optimal API, metric ($/m³). */
export interface OptimalMaterial {
  id: string
  description: string
  embankmentCost: number | null
  excavationCost: number | null
  /** 1 (best) – 4; null when unknown. */
  quality: number | null
  cutFactor: number | null
  fillFactor: number | null
  /** False for a generic quality class rather than a ground type. */
  trueMaterial: boolean
}

/**
 * The road's materials as Optimal API materials. PGMaps has one fill placement rate for every
 * material, so each takes `embankmentRate` (blank without it). The cut factor is 1 and the fill
 * factor bank per compacted (1 ÷ the compacted/bank factor), as RoadEng's expansion factors are
 * read. `unclassified` adds unclassified excavation (`UC`) at the project's cut rate and factor.
 */
export function optimalMaterialsFromDesign(
  materials: readonly GroundMaterial[],
  options: {
    codes?: Map<string, string>
    embankmentRate?: number | null
    unclassified?: { cutRate: number; compactionFactor: number } | null
  } = {},
): OptimalMaterial[] {
  const codes = options.codes ?? optimalMaterialCodes(materials)
  const rows: OptimalMaterial[] = materials.map((m) => ({
    id: codes.get(m.id) ?? OPTIMAL_UNKNOWN_MATERIAL_CODE,
    description: m.name.replace(/^[A-Za-z0-9]{1,2} · /, '').slice(0, OPTIMAL_DESCRIPTION_CHARS),
    embankmentCost: options.embankmentRate ?? null,
    excavationCost: m.cutRate,
    quality: m.quality === undefined ? null : optimalQuality(m.quality),
    cutFactor: 1,
    fillFactor: m.compactionFactor > 0 ? 1 / m.compactionFactor : null,
    trueMaterial: true,
  }))
  if (options.unclassified)
    rows.push({
      id: OPTIMAL_UNCLASSIFIED_CODE,
      description: 'Unclassified excavation',
      embankmentCost: options.embankmentRate ?? null,
      excavationCost: options.unclassified.cutRate,
      quality: null,
      cutFactor: 1,
      fillFactor: options.unclassified.compactionFactor > 0 ? 1 / options.unclassified.compactionFactor : null,
      trueMaterial: true,
    })
  return rows
}

/** What of an Optimal material a PGMaps ground material takes: name, cut rate, factor and quality. */
export function groundMaterialFieldsFromOptimal(
  m: OptimalMaterial,
): Pick<GroundMaterial, 'name'> & Partial<Pick<GroundMaterial, 'cutRate' | 'compactionFactor' | 'quality'>> {
  const factor = m.cutFactor !== null && m.fillFactor !== null && m.fillFactor > 0 ? m.cutFactor / m.fillFactor : null
  return {
    name: `${m.id} · ${m.description}`,
    ...(m.excavationCost !== null ? { cutRate: m.excavationCost } : {}),
    ...(factor !== null ? { compactionFactor: factor } : {}),
    ...(m.quality !== null ? { quality: pgmapsQuality(m.quality) } : {}),
  }
}

export function writeOptimalMaterialsCsv(
  rows: readonly OptimalMaterial[],
  options: { units?: SoftreeUnits } = {},
): string {
  const k = scaleOf(options.units)
  const rate = (v: number | null) => fmt(mul(v, k.vol), 4)
  return joinLines([
    line(OPTIMAL_MATERIAL_COLUMNS),
    ...rows.map((m) =>
      line([
        textCell(m.id),
        textCell(m.description),
        rate(m.embankmentCost),
        rate(m.excavationCost),
        fmt(m.quality, 0),
        fmt(m.cutFactor, 6),
        fmt(m.fillFactor, 6),
        m.trueMaterial ? '1' : '0',
      ]),
    ),
  ])
}

export function readOptimalMaterialsCsv(
  text: string,
  options: { units?: SoftreeUnits } = {},
): SoftreeRead<OptimalMaterial[]> {
  const units = options.units ?? 'metric',
    k = scaleOf(units)
  const rows = readRows(text, 'The Optimal materials file')
  const at = rows.findIndex((r) => norm(r[0] ?? '') === 'identifier')
  if (at < 0) throw Error('This is not an Optimal materials file: no "Identifier" header row.')
  const col = columnIndex(rows[at], {
    id: ['identifier'],
    description: ['description'],
    embankment: ['embankment cost'],
    excavation: ['excavation cost'],
    quality: ['quality'],
    cut: ['cut factor'],
    fill: ['fill factor'],
    trueMaterial: ['true material'],
  })
  const out: OptimalMaterial[] = [],
    warnings: string[] = []
  for (let r = at + 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row.length) continue
    const get = (key: string) => (col[key] >= 0 ? row[col[key]] : undefined)
    const n = (key: string) => numberCell(get(key), `Line ${r + 1}, ${key}`)
    try {
      const quality = n('quality')
      if (quality !== null && ![1, 2, 3, 4].includes(quality))
        throw Error(`Line ${r + 1}, quality: ${quality} is not a class 1 to 4.`)
      out.push({
        id: untext(get('id') ?? ''),
        description: untext(get('description') ?? ''),
        embankmentCost: div(n('embankment'), k.vol),
        excavationCost: div(n('excavation'), k.vol),
        quality,
        cutFactor: n('cut'),
        fillFactor: n('fill'),
        trueMaterial: (n('trueMaterial') ?? 1) !== 0,
      })
    } catch (error) {
      warnings.push((error as Error).message)
    }
  }
  return { value: out, units, warnings }
}

export const OPTIMAL_PIT_COLUMNS = [
  'Identifier',
  'Type',
  'Smart',
  'Access Station',
  'Access Distance',
  'Comment',
  'Waste Quality',
  'Material',
  'Excavation Cost',
  'Capacity Limit',
  'Volume',
  'Site Preparation',
  'Disposal Cost',
  'Enabled',
] as const

/** A borrow or waste pit of the Optimal API, metric. */
export interface OptimalPit {
  id: string
  kind: 'borrow' | 'waste'
  /** Used only when economic. */
  smart: boolean
  accessStation: number
  accessDistance: number
  comment: string
  /** Lowest quality a fixed-volume waste pit takes, 1–4. */
  wasteQuality: number | null
  /** Material code a borrow pit supplies (PGMaps writes a waste site's accepted material here too). */
  material: string | null
  /** $/m³ to excavate borrow. */
  excavationCost: number | null
  /** Most a variable pit takes or gives, m³; null is no limit. */
  capacityLimit: number | null
  /** The exact volume of a fixed pit, m³; null for a variable pit. */
  volume: number | null
  /** $ to open the pit. */
  sitePreparation: number | null
  /** PGMaps column: $/m³ to dispose of waste. */
  disposalCost: number | null
  /** PGMaps column. */
  enabled: boolean
}

/**
 * The road's borrow and waste sites as Optimal pits. Every PGMaps site is variable (no fixed
 * volume) and is used when the allocation chooses it, so `smart` follows the allocation: true for
 * the economic solver. A waste site's rate is its disposal cost.
 */
export function optimalPitsFromSites(
  sites: readonly HaulSite[],
  options: { codes?: Map<string, string>; smart?: boolean } = {},
): OptimalPit[] {
  return sites.map((s) => ({
    id: s.name,
    kind: s.kind,
    smart: options.smart ?? false,
    accessStation: s.chainage,
    accessDistance: s.accessDistanceM,
    comment: s.sourceNotes ?? '',
    wasteQuality: null,
    material: s.materialId ? (options.codes?.get(s.materialId) ?? null) : null,
    excavationCost: s.kind === 'borrow' ? s.unitRate : null,
    capacityLimit: s.capacityM3,
    volume: null,
    sitePreparation: s.fixedCost,
    disposalCost: s.kind === 'waste' ? s.unitRate : null,
    enabled: s.enabled !== false,
  }))
}

/** A PGMaps site from an Optimal pit. A fixed volume becomes the capacity; a material code goes through `materialIdOf`. */
export function haulSiteFromOptimalPit(
  pit: OptimalPit,
  options: { id: string; materialIdOf?: (code: string) => string | undefined },
): HaulSite {
  const materialId = pit.material ? options.materialIdOf?.(pit.material) : undefined
  return {
    id: options.id,
    name: pit.id,
    kind: pit.kind,
    ...(pit.enabled ? {} : { enabled: false }),
    ...(pit.comment ? { sourceNotes: pit.comment } : {}),
    chainage: pit.accessStation,
    accessDistanceM: pit.accessDistance,
    capacityM3: pit.volume ?? pit.capacityLimit,
    unitRate: (pit.kind === 'borrow' ? pit.excavationCost : pit.disposalCost) ?? 0,
    fixedCost: pit.sitePreparation ?? 0,
    ...(materialId ? { materialId } : {}),
  }
}

export function writeOptimalPitsCsv(rows: readonly OptimalPit[], options: { units?: SoftreeUnits } = {}): string {
  const k = scaleOf(options.units)
  const s = (v: number | null) => fmt(div(v, k.len), 3)
  const v = (value: number | null) => fmt(div(value, k.vol), 3)
  const rate = (value: number | null) => fmt(mul(value, k.vol), 4)
  return joinLines([
    line(OPTIMAL_PIT_COLUMNS),
    ...rows.map((p) =>
      line([
        textCell(p.id),
        p.kind === 'borrow' ? 'Borrow' : 'Waste',
        p.smart ? '1' : '0',
        s(p.accessStation),
        s(p.accessDistance),
        textCell(p.comment),
        fmt(p.wasteQuality, 0),
        textCell(p.material ?? ''),
        rate(p.excavationCost),
        v(p.capacityLimit),
        v(p.volume),
        fmt(p.sitePreparation, 2),
        rate(p.disposalCost),
        p.enabled ? '1' : '0',
      ]),
    ),
  ])
}

export function readOptimalPitsCsv(text: string, options: { units?: SoftreeUnits } = {}): SoftreeRead<OptimalPit[]> {
  const units = options.units ?? 'metric',
    k = scaleOf(units)
  const rows = readRows(text, 'The Optimal pits file')
  const at = rows.findIndex((r) => norm(r[0] ?? '') === 'identifier')
  if (at < 0) throw Error('This is not an Optimal pits file: no "Identifier" header row.')
  const col = columnIndex(
    rows[at],
    Object.fromEntries(OPTIMAL_PIT_COLUMNS.map((c) => [c, [norm(c)]])) as Record<string, string[]>,
  )
  const out: OptimalPit[] = [],
    warnings: string[] = []
  for (let r = at + 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row.length) continue
    const get = (c: (typeof OPTIMAL_PIT_COLUMNS)[number]) => (col[c] >= 0 ? row[col[c]] : undefined)
    const n = (c: (typeof OPTIMAL_PIT_COLUMNS)[number]) => numberCell(get(c), `Line ${r + 1}, ${c}`)
    try {
      const type = norm(get('Type') ?? '')
      if (type !== 'borrow' && type !== 'waste' && type !== '1' && type !== '0')
        throw Error(`Line ${r + 1}, Type: "${get('Type') ?? ''}" is neither Borrow nor Waste.`)
      const station = mul(n('Access Station'), k.len)
      if (station === null) throw Error(`Line ${r + 1}: no access station.`)
      out.push({
        id: untext(get('Identifier') ?? ''),
        kind: type === 'borrow' || type === '1' ? 'borrow' : 'waste',
        smart: (n('Smart') ?? 0) !== 0,
        accessStation: station,
        accessDistance: mul(n('Access Distance'), k.len) ?? 0,
        comment: untext(get('Comment') ?? ''),
        wasteQuality: n('Waste Quality'),
        material: untext(get('Material') ?? '') || null,
        excavationCost: div(n('Excavation Cost'), k.vol),
        capacityLimit: mul(n('Capacity Limit'), k.vol),
        volume: mul(n('Volume'), k.vol),
        sitePreparation: n('Site Preparation'),
        disposalCost: div(n('Disposal Cost'), k.vol),
        enabled: (n('Enabled') ?? 1) !== 0,
      })
    } catch (error) {
      warnings.push((error as Error).message)
    }
  }
  return { value: out, units, warnings }
}

/**
 * One `[design] OptParms_Pit-n` value of a RoadEng design as an Optimal pit, in project units
 * converted with `unitM` (metres per project unit). Inferred field order (from Softree's samples
 * beside the Pits dialog): access station, access distance, excavation cost, site preparation,
 * capacity, borrow (1) or waste (0), identifier, material; the remaining fields (one holds an
 * elevation) are not read. A capacity of 1,000,000 or more is no limit.
 */
export function optimalPitFromRoadEng(value: string, unitM: number): OptimalPit {
  const f = value.split(',')
  if (f.length < 8) throw Error(`A RoadEng pit has ${f.length} fields, fewer than the eight read.`)
  const n = (i: number) => {
    const v = Number(f[i])
    if (!Number.isFinite(v)) throw Error(`RoadEng pit field ${i + 1} "${f[i]}" is not a number.`)
    return v
  }
  const vol = unitM === 1 ? 1 : SOFTREE_YD3_M3
  const capacity = n(4)
  const borrow = n(5) !== 0
  return {
    id: f[6].trim(),
    kind: borrow ? 'borrow' : 'waste',
    smart: false,
    accessStation: n(0) * unitM,
    accessDistance: n(1) * unitM,
    comment: '',
    wasteQuality: null,
    material: f[7].trim() || null,
    excavationCost: borrow ? n(2) / vol : null,
    capacityLimit: capacity >= 1_000_000 ? null : capacity * vol,
    volume: null,
    sitePreparation: n(3),
    disposalCost: borrow ? null : n(2) / vol,
    enabled: true,
  }
}

export const OPTIMAL_COST_MODEL_COLUMNS = [
  'Freehaul Move Cost',
  'Overhaul Move Cost',
  'Endhaul Move Cost',
  'Freehaul Load Cost',
  'Overhaul Load Cost',
  'Endhaul Load Cost',
  'Freehaul Distance',
  'Overhaul Distance',
] as const

/** The Optimal cost model, metric: $/(m³·km) to move, $/m³ to load; distances m, null "from the cost lines". */
export interface OptimalCostModel {
  move: [freehaul: number, overhaul: number, endhaul: number]
  load: [freehaul: number, overhaul: number, endhaul: number]
  freeHaulDistanceM: number | null
  overhaulDistanceM: number | null
}

type HaulRates = Pick<
  HaulSettings,
  | 'freeHaulDistanceM'
  | 'overhaulDistanceM'
  | 'freeHaulRate'
  | 'overhaulRate'
  | 'endHaulRate'
  | 'freeHaulLoadingRate'
  | 'overhaulLoadingRate'
  | 'endHaulLoadingRate'
>

/**
 * PGMaps' haul rates as Optimal's cost lines. Optimal charges each class over the whole distance
 * (load + move × distance); PGMaps charges overhaul and endhaul past the free-haul distance, so
 * their loading costs are lowered by move × free-haul distance to price every haul the same.
 */
export function optimalCostModelFromHaul(h: HaulRates): OptimalCostModel {
  const fhdKm = h.freeHaulDistanceM / 1000
  return {
    move: [h.freeHaulRate, h.overhaulRate, h.endHaulRate],
    load: [
      h.freeHaulLoadingRate,
      h.overhaulLoadingRate - h.overhaulRate * fhdKm,
      h.endHaulLoadingRate - h.endHaulRate * fhdKm,
    ],
    freeHaulDistanceM: h.freeHaulDistanceM,
    overhaulDistanceM: h.overhaulDistanceM,
  }
}

/**
 * PGMaps' haul rates from Optimal's cost lines. A distance left to the cost lines (null) is where
 * the two classes' lines cross; lines that never cross ahead leave the distance as `fallback`'s.
 */
export function haulRatesFromOptimalCostModel(
  cm: OptimalCostModel,
  fallback: Pick<HaulSettings, 'freeHaulDistanceM' | 'overhaulDistanceM'>,
): HaulRates {
  const cross = (a: number, b: number) => {
    const dMove = cm.move[a] - cm.move[b]
    const km = dMove > EPS ? (cm.load[b] - cm.load[a]) / dMove : NaN
    return km > 0 ? km * 1000 : null
  }
  const fhd = cm.freeHaulDistanceM ?? cross(0, 1) ?? fallback.freeHaulDistanceM
  const ohd = cm.overhaulDistanceM ?? cross(1, 2) ?? fallback.overhaulDistanceM
  const fhdKm = fhd / 1000
  return {
    freeHaulDistanceM: fhd,
    overhaulDistanceM: ohd,
    freeHaulRate: cm.move[0],
    overhaulRate: cm.move[1],
    endHaulRate: cm.move[2],
    freeHaulLoadingRate: cm.load[0],
    overhaulLoadingRate: cm.load[1] + cm.move[1] * fhdKm,
    endHaulLoadingRate: cm.load[2] + cm.move[2] * fhdKm,
  }
}

export function writeOptimalCostModelCsv(cm: OptimalCostModel, options: { units?: SoftreeUnits } = {}): string {
  const k = scaleOf(options.units)
  const move = (v: number) => fmt(v * k.vol * k.haulKm, 6)
  const load = (v: number) => fmt(v * k.vol, 6)
  const dist = (v: number | null) => (v === null ? '-1' : fmt(v / k.len, 3))
  return joinLines([
    line(OPTIMAL_COST_MODEL_COLUMNS),
    line([...cm.move.map(move), ...cm.load.map(load), dist(cm.freeHaulDistanceM), dist(cm.overhaulDistanceM)]),
  ])
}

export function readOptimalCostModelCsv(
  text: string,
  options: { units?: SoftreeUnits } = {},
): SoftreeRead<OptimalCostModel> {
  const units = options.units ?? 'metric',
    k = scaleOf(units)
  const rows = readRows(text, 'The Optimal cost model file')
  const at = rows.findIndex((r) => norm(r[0] ?? '') === norm(OPTIMAL_COST_MODEL_COLUMNS[0]))
  const row = at < 0 ? undefined : rows.slice(at + 1).find((r) => r.length)
  if (!row) throw Error('This is not an Optimal cost model file: no header row with a row of costs below it.')
  const col = columnIndex(rows[at], Object.fromEntries(OPTIMAL_COST_MODEL_COLUMNS.map((c) => [c, [norm(c)]])))
  const n = (c: (typeof OPTIMAL_COST_MODEL_COLUMNS)[number]) => {
    const value = numberCell(col[c] >= 0 ? row[col[c]] : undefined, c)
    if (value === null) throw Error(`The cost model has no ${c}.`)
    return value
  }
  const move = (c: (typeof OPTIMAL_COST_MODEL_COLUMNS)[number]) => n(c) / (k.vol * k.haulKm)
  const load = (c: (typeof OPTIMAL_COST_MODEL_COLUMNS)[number]) => n(c) / k.vol
  const dist = (c: (typeof OPTIMAL_COST_MODEL_COLUMNS)[number]) => (n(c) < 0 ? null : n(c) * k.len)
  return {
    value: {
      move: [move('Freehaul Move Cost'), move('Overhaul Move Cost'), move('Endhaul Move Cost')],
      load: [load('Freehaul Load Cost'), load('Overhaul Load Cost'), load('Endhaul Load Cost')],
      freeHaulDistanceM: dist('Freehaul Distance'),
      overhaulDistanceM: dist('Overhaul Distance'),
    },
    units,
    warnings: [],
  }
}
