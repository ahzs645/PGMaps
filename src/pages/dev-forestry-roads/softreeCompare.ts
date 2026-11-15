/**
 * **Compare with RoadEng…**: a RoadEng Mass Haul or Optimal Haul export, or a Softree Optimal Areas
 * file, set beside the same file made from the active road's own results. The format rules and the
 * comparisons themselves live in `softreeHaulCsv.ts` (`read…Csv`, `compare…`); this module only
 * tells the three files apart by their content, builds the road's side, and shapes the comparison
 * into the rows the dialog shows (totals, rows with the largest differences first, what each side
 * holds alone) and the comparison's CSV.
 *
 * - **Kind.** Told by content, never by the file's name: a Mass Haul export has a row starting
 *   `Cut Vol`, an Optimal Haul export one of its section titles, and an Areas file the
 *   `version` / `no. station` header that ends at `data start:`.
 * - **Units.** No Softree file states its units; the reader is told them (the project's by
 *   default, `softreeUnits`). Everything compared is metric.
 * - **The road's side** is written in the file's units and read back, so both sides carry the same
 *   precision: the road's own export compared with itself shows no difference at all.
 * - **Stations.** A RoadEng design's stations start where its file says (`roadEngSource.startStation`)
 *   while the road's chainage starts at 0; the file's stations are moved into the road's chainage
 *   (`StationFrame`) before matching.
 * - **Agreement.** A value agrees when the difference is within the larger of the quantity's
 *   rounding in the files (`COMPARE_ABSOLUTE_TOLERANCE`) and the chosen share of the larger value.
 *   A value one side has and the other lacks never agrees.
 *
 * Reading a file never touches the project. Checked by `softreeCompare.test.ts`. Pure: no DOM or
 * network access.
 */
import type { AlignmentEngineering } from './engineeringTypes'
import { optimalHaulUnavailable } from './exportCatalog'
import {
  compareMassHaul,
  compareOptimalAreas,
  compareOptimalHaul,
  massHaulItemsFromAnalysis,
  optimalAreasFromAnalysis,
  optimalHaulFromAnalysis,
  readMassHaulCsv,
  readOptimalAreasCsv,
  readOptimalHaulCsv,
  writeMassHaulCsv,
  writeOptimalAreasCsv,
  writeOptimalHaulCsv,
  OPTIMAL_HAUL_SECTION_TITLES,
  type MassHaulItem,
  type OptimalAreasFile,
  type OptimalHaulExport,
  type QuantityDifference,
  type SoftreeUnits,
} from './softreeHaulCsv'
import type { RoadAnalysis } from './types'

export type SoftreeCompareKind = 'mass-haul' | 'optimal-haul' | 'optimal-areas'

export const SOFTREE_COMPARE_KIND_LABELS: Record<SoftreeCompareKind, string> = {
  'mass-haul': 'RoadEng Mass Haul export',
  'optimal-haul': 'RoadEng Optimal Haul export',
  'optimal-areas': 'Softree Optimal Areas file',
}

/** Units of every compared value. */
export type CompareUnit = 'm³' | 'm' | 'm²' | 'm³·m' | '$'

/** The rounding of each quantity in the files: values closer than this agree. */
export const COMPARE_ABSOLUTE_TOLERANCE: Record<CompareUnit, number> = {
  'm³': 0.05,
  m: 0.01,
  'm²': 0.005,
  'm³·m': 1,
  $: 0.05,
}
/** Decimals the dialog and the comparison CSV print for each unit. */
export const COMPARE_DECIMALS: Record<CompareUnit, number> = { 'm³': 2, m: 3, 'm²': 3, 'm³·m': 1, $: 2 }
/** The share of the larger value two values may differ by and still agree, %, unless changed. */
export const DEFAULT_COMPARE_RELATIVE_PERCENT = 0.1
/** The largest share a person may set, %. */
export const MAX_COMPARE_RELATIVE_PERCENT = 50
/** An Areas file's record matches a road station within this distance, m. */
export const COMPARE_STATION_TOLERANCE_M = 0.01
/** The largest file this comparison reads, bytes (the readers' own limit is higher). */
export const MAX_COMPARE_FILE_BYTES = 50_000_000

export const NOT_A_SOFTREE_FILE =
  'This file is not a RoadEng Mass Haul export, a RoadEng Optimal Haul export or a Softree Optimal Areas file: it has no "Cut Vol" header row, none of the Optimal Haul section titles, and no Areas file header.'

/** A file station `s` is road chainage `(s − startStationM) × scale`. */
export interface StationFrame {
  startStationM: number
  scale: number
}
export const IDENTITY_FRAME: StationFrame = { startStationM: 0, scale: 1 }

export interface CompareRow {
  id: string
  /** What is compared: a haul type, a material, a pit or a station. */
  item: string
  /** Which value of it. */
  field: string
  unit: CompareUnit
  theirs: number | null
  ours: number | null
  /** Ours − theirs; null when a side is missing. */
  difference: number | null
  /** Difference as a share of the file's value, %; null when the file's value is missing or zero. */
  percent: number | null
  agrees: boolean
  /** Road chainage the row is about, for the station marker; null when it is about no one place. */
  station: number | null
}

export interface SoftreeComparison {
  kind: SoftreeCompareKind
  units: SoftreeUnits
  totals: CompareRow[]
  /** Rows that differ first, the largest relative difference first; then the rows that agree. */
  rows: CompareRow[]
  /** What only the file has, and what only the road has, in words. */
  onlyTheirs: string[]
  onlyOurs: string[]
  /** Rows and totals that do not agree. */
  differing: number
  tolerance: { relativePercent: number; stationM: number | null }
  /** Rows of the file the reader passed over, each with its line. */
  warnings: string[]
  /** What else was done in reading the file, in plain words. */
  notes: string[]
}

/* ------------------------------------------------------------------------------------------------
 * Kind
 * --------------------------------------------------------------------------------------------- */

const norm = (cell: string) =>
  cell
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
const SECTION_TITLES = new Set(Object.values(OPTIMAL_HAUL_SECTION_TITLES).map(norm))

/** Which of the three files `text` is, by its content; null when it is none of them. */
export function detectSoftreeCompareKind(text: string): SoftreeCompareKind | null {
  const firstCells = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => norm(line.split(',')[0] ?? ''))
  if (firstCells.some((c) => c === 'cut vol' || c === 'cut volume')) return 'mass-haul'
  if (firstCells.some((c) => SECTION_TITLES.has(c))) return 'optimal-haul'
  const end = firstCells.findIndex((c) => c === 'data start:' || c === 'data start')
  const header = end < 0 ? [] : firstCells.slice(0, end)
  if (header.length && (header.includes('version') || header.includes('no. station'))) return 'optimal-areas'
  return null
}

/* ------------------------------------------------------------------------------------------------
 * Rows
 * --------------------------------------------------------------------------------------------- */

/** Whether two values agree under the tolerance. */
export function valuesAgree(
  theirs: number | null,
  ours: number | null,
  unit: CompareUnit,
  relativePercent: number,
): boolean {
  if (theirs === null || ours === null) return theirs === ours
  const within = Math.max(
    COMPARE_ABSOLUTE_TOLERANCE[unit],
    (relativePercent / 100) * Math.max(Math.abs(theirs), Math.abs(ours)),
  )
  return Math.abs(ours - theirs) <= within + 1e-9
}

function row(
  id: string,
  item: string,
  field: string,
  unit: CompareUnit,
  theirs: number | null,
  ours: number | null,
  station: number | null,
  relativePercent: number,
): CompareRow {
  const difference = theirs === null || ours === null ? null : ours - theirs
  return {
    id,
    item,
    field,
    unit,
    theirs,
    ours,
    difference,
    percent: difference === null || theirs === null || theirs === 0 ? null : (difference / Math.abs(theirs)) * 100,
    agrees: valuesAgree(theirs, ours, unit, relativePercent),
    station,
  }
}

/** How far apart a row's sides are, relative to the larger: Infinity when a side is missing. */
const relativeGap = (r: CompareRow) => {
  if (r.difference === null) return Infinity
  const scale = Math.max(Math.abs(r.theirs ?? 0), Math.abs(r.ours ?? 0))
  return scale > 0 ? Math.abs(r.difference) / scale : 0
}

/**
 * Rows that differ first, then those that agree; within each, the largest difference relative to
 * the larger value first (a missing side first of all), then the larger absolute difference.
 */
export function sortByDifference(rows: readonly CompareRow[]): CompareRow[] {
  return [...rows].sort(
    (a, b) =>
      Number(a.agrees) - Number(b.agrees) ||
      relativeGap(b) - relativeGap(a) ||
      Math.abs(b.difference ?? 0) - Math.abs(a.difference ?? 0) ||
      a.id.localeCompare(b.id),
  )
}

const one = (value: number | null) => (value === null ? '' : value.toFixed(1))
const range = (a: number | null, b: number | null) => (a === null && b === null ? '' : `${one(a)}–${one(b)}`)

/* ------------------------------------------------------------------------------------------------
 * Mass Haul
 * --------------------------------------------------------------------------------------------- */

const MASS_FIELD: Record<string, { label: string; unit: CompareUnit }> = {
  volume: { label: 'Volume', unit: 'm³' },
  cutCentroid: { label: 'Cut centroid', unit: 'm' },
  fillCentroid: { label: 'Fill centroid', unit: 'm' },
  overHaul: { label: 'Over haul (vol × dist)', unit: 'm³·m' },
  overHaul2: { label: 'Over haul 2 (vol × (dist − FHD))', unit: 'm³·m' },
}

/** One mass-haul item in words: type, cut and fill ranges, volume. */
export function massHaulItemLabel(i: MassHaulItem): string {
  const parts = [i.type]
  if (i.cutStn1 !== null || i.cutStn2 !== null) parts.push(`cut ${range(i.cutStn1, i.cutStn2)}`)
  if (
    (i.fillStn1 !== null || i.fillStn2 !== null) &&
    (i.fillStn1 !== i.cutStn1 || i.fillStn2 !== i.cutStn2 || i.cutStn1 === null)
  )
    parts.push(`fill ${range(i.fillStn1, i.fillStn2)}`)
  const volume = i.cutVolumeM3 ?? i.fillVolumeM3
  if (volume !== null) parts.push(`${volume.toFixed(2)} m³`)
  return parts.join(' · ')
}

function frameMassHaul(items: readonly MassHaulItem[], f: (s: number | null) => number | null): MassHaulItem[] {
  return items.map((i) => ({
    ...i,
    cutStn1: f(i.cutStn1),
    cutStn2: f(i.cutStn2),
    cutCentroid: f(i.cutCentroid),
    fillStn1: f(i.fillStn1),
    fillStn2: f(i.fillStn2),
    fillCentroid: f(i.fillCentroid),
  }))
}

function massHaulRows(theirs: readonly MassHaulItem[], ours: readonly MassHaulItem[], rel: number) {
  const c = compareMassHaul(theirs, ours)
  const totals = c.totals.map((d, k) =>
    row(
      `total-${k}`,
      `${d.key}, all items`,
      MASS_FIELD[d.field].label,
      MASS_FIELD[d.field].unit,
      d.theirs,
      d.ours,
      null,
      rel,
    ),
  )
  const rows = c.pairs.flatMap((p, k) => {
    const item = massHaulItemLabel(p.ours)
    const station = p.ours.cutCentroid ?? p.ours.fillCentroid ?? p.ours.cutStn1 ?? p.ours.fillStn1
    return p.rows
      .filter((d) => d.theirs !== null || d.ours !== null)
      .map((d) =>
        row(
          `item-${k}-${d.field}`,
          item,
          MASS_FIELD[d.field].label,
          MASS_FIELD[d.field].unit,
          d.theirs,
          d.ours,
          station,
          rel,
        ),
      )
  })
  return { totals, rows, onlyTheirs: c.onlyTheirs.map(massHaulItemLabel), onlyOurs: c.onlyOurs.map(massHaulItemLabel) }
}

/* ------------------------------------------------------------------------------------------------
 * Optimal Haul
 * --------------------------------------------------------------------------------------------- */

const OPTIMAL_SECTION: Record<string, string> = {
  cost: 'Cost',
  volume: 'Volume',
  pit: 'Pit',
  movement: 'Movement',
  haul: 'Haul',
}
const OPTIMAL_FIELD: Record<string, string> = {
  haul: 'Haul',
  cut: 'Cut',
  fill: 'Fill',
  pitOpening: 'Pit opening',
  borrow: 'Borrow',
  underflow: 'Underflow',
  waste: 'Waste',
  overflow: 'Overflow',
  sidecast: 'Sidecast',
  pitLoad: 'Pit load',
  stationUnload: 'Station unload (movement)',
  pitUnload: 'Pit unload',
  sameStationUnload: 'Same station unload (no movement)',
  station: 'Station',
  distance: 'Distance',
  volume: 'Volume',
  'volume×distance': 'Volume × distance',
}
const optimalUnit = (section: string, field: string): CompareUnit =>
  section === 'cost'
    ? '$'
    : section === 'pit' && (field === 'station' || field === 'distance')
      ? 'm'
      : field === 'volume×distance'
        ? 'm³·m'
        : 'm³'

function frameOptimalHaul(e: OptimalHaulExport, f: (s: number | null) => number | null): OptimalHaulExport {
  return {
    ...e,
    pits: e.pits.map((p) => ({ ...p, station: f(p.station) })),
    detailedMovements: e.detailedMovements.map((d) => ({
      ...d,
      cutStn1: f(d.cutStn1),
      cutStn2: f(d.cutStn2),
      fillStn1: f(d.fillStn1),
      fillStn2: f(d.fillStn2),
    })),
  }
}

/** A haul key `OB overhaul` in words. */
const haulKey = (key: string) => {
  const [material, ...type] = key.split(' ')
  return `${material} · ${type.join(' ')}`
}

function optimalHaulRows(theirs: OptimalHaulExport, ours: OptimalHaulExport, rel: number) {
  const c = compareOptimalHaul(theirs, ours)
  const pitStation = new Map(ours.pits.map((p) => [p.name, p.station]))
  const totals: CompareRow[] = []
  const rows: CompareRow[] = []
  c.rows.forEach((d, k) => {
    const unit = optimalUnit(d.section, d.field)
    const field = OPTIMAL_FIELD[d.field] ?? (d.section === 'pit' ? `Material ${d.field}` : d.field)
    if (d.section === 'cost' && d.key === 'Total') {
      totals.push(row(`total-cost-${d.field}`, 'Cost, all materials', field, unit, d.theirs, d.ours, null, rel))
      return
    }
    if (d.theirs === null && d.ours === null) return
    const item =
      d.section === 'haul'
        ? `Haul · ${haulKey(d.key)}`
        : d.section === 'pit'
          ? `Pit · ${d.key}`
          : `${OPTIMAL_SECTION[d.section]} · ${d.key}`
    const station = d.section === 'pit' ? (pitStation.get(d.key) ?? null) : null
    rows.push(row(`row-${k}`, item, field, unit, d.theirs, d.ours, station, rel))
  })
  // Each volume column over every material: cut, borrow, fill and waste for the whole road.
  const fields = ['cut', 'borrow', 'underflow', 'fill', 'waste', 'overflow', 'sidecast'] as const
  const sum = (list: OptimalHaulExport['volumes'], f: (typeof fields)[number]) =>
    list.length ? list.reduce((s, v) => s + (v[f] ?? 0), 0) : null
  for (const f of fields)
    totals.push(
      row(
        `total-volume-${f}`,
        'Volume, all materials',
        OPTIMAL_FIELD[f],
        'm³',
        sum(theirs.volumes, f),
        sum(ours.volumes, f),
        null,
        rel,
      ),
    )
  const words = (key: string) => (key.startsWith('pit ') ? `Pit ${key.slice(4)}` : `Material ${key}`)
  return { totals, rows, onlyTheirs: c.onlyTheirs.map(words), onlyOurs: c.onlyOurs.map(words) }
}

/* ------------------------------------------------------------------------------------------------
 * Optimal Areas
 * --------------------------------------------------------------------------------------------- */

const areaField = (field: string) =>
  field === '(cut)'
    ? 'Cut, all materials'
    : field === '(fill)'
      ? 'Fill, all materials'
      : field === 'v-offset'
        ? 'Design level above ground'
        : field

function frameAreas(file: OptimalAreasFile, f: (s: number | null) => number | null): OptimalAreasFile {
  return { ...file, records: file.records.map((r) => ({ ...r, station: f(r.station) ?? r.station })) }
}

/**
 * The file with each station, h-offset and level read once: a road's calculated stations repeat a
 * chainage where a profile point falls on the station interval, and a level read twice at one
 * station would be compared as a band of one. The first record is kept; `repeated` counts the rest.
 */
export function uniqueAreaRecords(file: OptimalAreasFile): { file: OptimalAreasFile; repeated: number } {
  const seen = new Set<string>()
  const records = file.records.filter((r) => {
    const key = `${r.station.toFixed(4)} ${r.hOffset.toFixed(4)} ${r.vOffset === null ? '' : r.vOffset.toFixed(4)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { file: { ...file, records }, repeated: file.records.length - records.length }
}

const station3 = (s: number) => s.toFixed(3)

function optimalAreasRows(theirs: OptimalAreasFile, ours: OptimalAreasFile, rel: number) {
  const c = compareOptimalAreas(theirs, ours, { stationToleranceM: COMPARE_STATION_TOLERANCE_M })
  const rows = c.rows.map((d: QuantityDifference & { station: number }, k) =>
    row(
      `station-${k}`,
      `Station ${station3(d.station)}`,
      areaField(d.field),
      d.field === 'v-offset' ? 'm' : 'm²',
      d.theirs,
      d.ours,
      d.station,
      rel,
    ),
  )
  // Cut and fill volumes by average end area between neighbouring stations both sides hold.
  const at = new Map<number, { cut: [number, number]; fill: [number, number] }>()
  for (const d of c.rows) {
    if (d.field !== '(cut)' && d.field !== '(fill)') continue
    const entry = at.get(d.station) ?? { cut: [0, 0], fill: [0, 0] }
    entry[d.field === '(cut)' ? 'cut' : 'fill'] = [d.theirs ?? 0, d.ours ?? 0]
    at.set(d.station, entry)
  }
  const stations = ours.records.map((r) => r.station)
  const volume = { cut: [0, 0], fill: [0, 0] }
  let pairs = 0
  for (let k = 1; k < stations.length; k++) {
    const a = at.get(stations[k - 1]),
      b = at.get(stations[k])
    if (!a || !b) continue
    const span = stations[k] - stations[k - 1]
    pairs++
    for (const side of ['cut', 'fill'] as const)
      for (const who of [0, 1]) volume[side][who] += (Math.abs(a[side][who]) + Math.abs(b[side][who])) * 0.5 * span
  }
  const totals = pairs
    ? [
        row(
          'total-cut',
          'Between matched stations',
          'Cut volume (average end area)',
          'm³',
          volume.cut[0],
          volume.cut[1],
          null,
          rel,
        ),
        row(
          'total-fill',
          'Between matched stations',
          'Fill volume (average end area)',
          'm³',
          volume.fill[0],
          volume.fill[1],
          null,
          rel,
        ),
      ]
    : []
  return {
    totals,
    rows,
    onlyTheirs: c.unmatchedTheirs.map((s) => `Station ${station3(s)}`),
    onlyOurs: c.unmatchedOurs.map((s) => `Station ${station3(s)}`),
  }
}

/* ------------------------------------------------------------------------------------------------
 * The comparison
 * --------------------------------------------------------------------------------------------- */

/** The active road's results, as the page holds them. */
export interface RoadResults {
  analysis: RoadAnalysis
  engineering: AlignmentEngineering | undefined
}

export interface CompareOptions {
  units: SoftreeUnits
  /** Share of the larger value two values may differ by and still agree, %. */
  relativePercent?: number
  /** Where the file's stations start (`StationFrame`); the road's own chainage by default. */
  frame?: StationFrame
}

/** Why the road's side of a comparison of `kind` cannot be made, or null when it can. */
export function roadSideUnavailable(kind: SoftreeCompareKind, road: RoadResults): string | null {
  if (!road.analysis.stations.length) return 'The road has no calculated results yet.'
  if (kind === 'optimal-haul') {
    const reason = optimalHaulUnavailable(road.analysis.engineering?.haul)
    if (reason) return reason
    if (!road.engineering) return 'Turn on haul allocation first.'
  }
  return null
}

/**
 * Reads `text` as whichever of the three files it is and compares it with the same file made from
 * the road's results. Throws, saying which, when the file is none of them, cannot be read, or the
 * road has no results to compare (no results; haul off or not solved for an Optimal Haul export).
 */
export function compareSoftreeFile(text: string, road: RoadResults, options: CompareOptions): SoftreeComparison {
  if (text.length > MAX_COMPARE_FILE_BYTES)
    throw Error(`The file is larger than ${MAX_COMPARE_FILE_BYTES / 1_000_000} MB, more than this comparison reads.`)
  const kind = detectSoftreeCompareKind(text)
  if (!kind) throw Error(NOT_A_SOFTREE_FILE)
  const label = SOFTREE_COMPARE_KIND_LABELS[kind]
  const unavailable = roadSideUnavailable(kind, road)
  if (unavailable) throw Error(`This is a ${label}, and the road's side cannot be made: ${unavailable}`)
  const units = options.units
  const rel = Math.min(
    Math.max(options.relativePercent ?? DEFAULT_COMPARE_RELATIVE_PERCENT, 0),
    MAX_COMPARE_RELATIVE_PERCENT,
  )
  const frame = options.frame ?? IDENTITY_FRAME
  if (!Number.isFinite(frame.startStationM) || !(frame.scale > 0) || !Number.isFinite(frame.scale))
    throw Error('Enter the station the file starts at.')
  const identity = frame.startStationM === 0 && frame.scale === 1
  const f = (s: number | null) => (s === null || identity ? s : (s - frame.startStationM) * frame.scale)
  const { analysis, engineering } = road
  let shaped: { totals: CompareRow[]; rows: CompareRow[]; onlyTheirs: string[]; onlyOurs: string[] }
  let warnings: string[]
  const notes: string[] = []
  if (kind === 'mass-haul') {
    const theirs = readMassHaulCsv(text, { units })
    const ours = readMassHaulCsv(writeMassHaulCsv(massHaulItemsFromAnalysis(analysis, engineering?.haul), { units }), {
      units,
    }).value
    warnings = theirs.warnings
    shaped = massHaulRows(frameMassHaul(theirs.value, f), ours, rel)
  } else if (kind === 'optimal-haul') {
    const theirs = readOptimalHaulCsv(text, { units })
    const ours = readOptimalHaulCsv(writeOptimalHaulCsv(optimalHaulFromAnalysis(analysis, engineering!), { units }), {
      units,
    }).value
    warnings = theirs.warnings
    shaped = optimalHaulRows(frameOptimalHaul(theirs.value, f), ours, rel)
  } else {
    const theirs = readOptimalAreasCsv(text, { units })
    // X and Y are not compared, so the road's side needs no grid.
    const written = optimalAreasFromAnalysis(analysis, engineering, { toGrid: () => [NaN, NaN] })
    const ours = uniqueAreaRecords(readOptimalAreasCsv(writeOptimalAreasCsv(written, { units }), { units }).value)
    const their = uniqueAreaRecords(frameAreas(theirs.value, f))
    warnings = theirs.warnings
    if (their.repeated)
      notes.push(
        `${their.repeated} of the file's records repeat a station and level read before them; the first of each is compared.`,
      )
    shaped = optimalAreasRows(their.file, ours.file, rel)
  }
  const rows = sortByDifference(shaped.rows)
  return {
    kind,
    units,
    totals: shaped.totals,
    rows,
    onlyTheirs: shaped.onlyTheirs,
    onlyOurs: shaped.onlyOurs,
    differing: [...shaped.totals, ...rows].filter((r) => !r.agrees).length,
    tolerance: { relativePercent: rel, stationM: kind === 'optimal-areas' ? COMPARE_STATION_TOLERANCE_M : null },
    warnings,
    notes,
  }
}

/* ------------------------------------------------------------------------------------------------
 * The comparison's CSV
 * --------------------------------------------------------------------------------------------- */

/** A cell, quoted where needed; text that would run as a spreadsheet formula goes behind an apostrophe. */
const csvCell = (value: string) => {
  const v = /^[=+\-@]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}
const number = (value: number | null, digits: number) => (value === null ? '' : value.toFixed(digits))

/** The comparison as a CSV: what was compared, the tolerance, the totals, every row, and what each side holds alone. */
export function comparisonCsv(c: SoftreeComparison, fileName: string): string {
  const lines: string[][] = [
    ['Compared', `${SOFTREE_COMPARE_KIND_LABELS[c.kind]} ${fileName}`],
    ['Units read', c.units === 'imperial' ? 'feet and cubic yards' : 'metres and cubic metres'],
    [
      'Agree within',
      `${c.tolerance.relativePercent} % of the larger value, or ${Object.entries(COMPARE_ABSOLUTE_TOLERANCE)
        .map(([unit, v]) => `${v} ${unit}`)
        .join(', ')}`,
    ],
    ...(c.tolerance.stationM !== null ? [['Stations matched within', `${c.tolerance.stationM} m`]] : []),
    [],
    ['Part', 'Item', 'Value', 'Unit', 'File', 'PGMaps', 'Difference', 'Difference %', 'Station', 'Agrees'],
  ]
  const add = (part: string, r: CompareRow) =>
    lines.push([
      part,
      r.item,
      r.field,
      r.unit,
      number(r.theirs, COMPARE_DECIMALS[r.unit]),
      number(r.ours, COMPARE_DECIMALS[r.unit]),
      number(r.difference, COMPARE_DECIMALS[r.unit]),
      number(r.percent, 2),
      number(r.station, 3),
      r.agrees ? 'yes' : 'no',
    ])
  for (const r of c.totals) add('Total', r)
  for (const r of c.rows) add('Row', r)
  for (const item of c.onlyTheirs) lines.push(['Only in the file', item])
  for (const item of c.onlyOurs) lines.push(['Only in PGMaps', item])
  return lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
