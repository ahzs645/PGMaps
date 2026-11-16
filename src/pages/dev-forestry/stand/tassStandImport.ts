/**
 * Trial: a block's stand from a TASS III stem table (PLOTSY `.tdt`, AppType `Tass_Stems`).
 *
 * TASS (BC's Tree and Stand Simulator) writes one row per stem of a modelled plot, usually one
 * hectare, in metres from a plot corner. This module reads that table and places the plot over a
 * block so the existing imported-stand path (`buildStandFromImport`) draws it. It is a trial option
 * beside the ordinary tree-list import, kept in its own file so it can be removed in one piece.
 *
 * What it never does:
 * - guess the columns of a table it cannot check. The column definitions live in a separate `.tcl`
 *   (PLOTSY column metadata, not Tcl code). With one, columns are found by name and their units are
 *   checked; without one, only TASS 4.3.1.2's bundled `Tass_Stems` layout is read, when every row has
 *   exactly its 28 fields, and the read says it assumed it. A `.tcl` that remaps columns (`*ColID`)
 *   is refused.
 * - guess which corner the plot coordinates start from. TASS's help places X/Y at the south-west
 *   corner (X east, Y north) and row/column at the north-west corner (row down, column east), and the
 *   bundled schema labels its X/Y columns "Row" and "Column". The reviewer chooses; the choice is
 *   named wherever the stand's source is shown.
 * - draw a dead tree as a live crown. Snags and down wood (CWD) are counted and left out.
 *
 * Crown base (TASS's "Height to Crown") is kept on each tree. Nothing here reaches the run.
 *
 * DOM-free and network-free.
 */

import { speciesFromCode, type TreeSpeciesId } from '../forest'
import { metersPerDegree, preparePolygons, type PolygonGeometry } from '../visibility'
import { TREE_LIST_MAX_TREES, TREE_LIST_MIN_HEIGHT_M, type ImportedTree } from './treeListImport'

/** The fields this reader takes from a stem table, by the `.tcl` column name (case and spacing ignored). */
const WANTED = {
  standAge: { name: 'Stand Age', units: ['years'] },
  id: { name: 'ID', units: [''] },
  x: { name: 'X', units: ['m'] },
  y: { name: 'Y', units: ['m'] },
  species: { name: 'Species', units: [''] },
  dbh: { name: 'DBH', units: ['cm'] },
  height: { name: 'Total Height', units: ['m'] },
  condition: { name: 'Tree Condition', units: [''] },
  crownWidth: { name: 'Crown Width', units: ['m'] },
  crownBase: { name: 'Height to Crown', units: ['m'] },
} as const

type Field = keyof typeof WANTED
const REQUIRED: Field[] = ['id', 'x', 'y', 'height', 'condition']

export type TassColumn = { index: number; name: string; units: string; description: string }

/**
 * TASS 4.3.1.2's bundled `Plotsy2/Tass_Stems.tcl` column list: used only for a table read without
 * its `.tcl`, and only when every row has exactly these 28 fields.
 */
export const BUNDLED_TASS_STEMS_COLUMNS: ReadonlyArray<readonly [name: string, units: string]> = [
  ['Stand Age', 'years'],
  ['ID', ''],
  ['X', 'm'],
  ['Y', 'm'],
  ['Species', ''],
  ['Tree Age', 'years'],
  ['DBH', 'cm'],
  ['Total Height', 'm'],
  ['Total Volume', 'm3'],
  ['Basal Area', 'm2'],
  ['Light Value', ''],
  ['Tree Condition', ''],
  ['Crown Area', 'm2'],
  ['Crown Length', 'm'],
  ['Crown Len%', '%'],
  ['Crown Width', 'm'],
  ['Crown Radius', 'm'],
  ['Foliar Volume', 'm3'],
  ['Height to Crown', 'm'],
  ['Light HGF', ''],
  ['Mortality Cause', ''],
  ['Stem Status', ''],
  ['Fallen Stand Age', 'years'],
  ['Broken Stem?', ''],
  ['Breakage Stand Age', 'years'],
  ['Breakage Length', 'm'],
  ['Volume of Breakage', 'm3'],
  ['Regen Method', ''],
]

export type TassCondition = 'live' | 'snag' | 'down' | 'unknown'

export type TassStem = {
  id: string
  /** Plot coordinates as written, metres; what they measure from is the reviewer's choice (`TassAxes`). */
  x: number
  y: number
  speciesCode: string
  species: TreeSpeciesId | null
  heightMeters: number
  dbhCm: number | null
  crownWidthMeters: number | null
  /** Height to the base of the live crown, metres; null for dead stems and where the table gives none. */
  crownBaseMeters: number | null
  condition: TassCondition
  /** The condition as written ("Live", "Snag", "CWD"). */
  conditionText: string
  /** 1-based line in the file. */
  line: number
}

export type TassStemTable = {
  name: string
  /** Where the column layout came from. */
  schema: { source: 'file'; name: string } | { source: 'assumed' }
  columns: TassColumn[]
  /** Plot width and length, metres, from the table's `Plot size:` line; null when it states none. */
  plotMeters: { width: number; length: number } | null
  /** Stand age of the snapshot, years: the first row's, when every row agrees; else null. */
  standAge: number | null
  /** The `*RUN` lines as written (`File:`, `Reference site index:`, …). */
  run: Array<{ key: string; value: string }>
  stems: TassStem[]
  /** Rows not read, with a reason. */
  skipped: Array<{ line: number; reason: string }>
  /** What the reviewer should know about this read. */
  notes: string[]
}

export class TassReadError extends Error {}

const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '')
const MISSING = new Set(['', '--', '-', 'n/a', 'na'])

/** True when `text` is a PLOTSY table of TASS stems (its `*AppType` section names `Tass_Stems`). */
export function isTassStemTable(text: string): boolean {
  const section = sectionLines(text, 'AppType')
  return !!section && section.some((line) => key(line) === key('Tass_Stems'))
}

/** True when `text` is PLOTSY column metadata (a `.tcl` with a `*COLUMNS` section). */
export function isTassColumnFile(text: string): boolean {
  return sectionLines(text, 'COLUMNS') !== null
}

/** The lines of one `*SECTION`, up to the next; null when the file has no such section. */
function sectionLines(text: string, name: string): string[] | null {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `*${name.toLowerCase()}`)
  if (start < 0) return null
  const out: string[] = []
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('*')) break
    out.push(lines[i])
  }
  return out
}

/** Reads a `.tcl`'s `*COLUMNS` section. Throws on a layout this reader cannot check. */
export function readTassColumns(text: string, name = 'the .tcl'): TassColumn[] {
  if (sectionLines(text, 'ColID') !== null)
    throw new TassReadError(`${name} remaps its columns (*ColID), which this trial reader does not read.`)
  const lines = sectionLines(text, 'COLUMNS')
  if (!lines) throw new TassReadError(`${name} has no *COLUMNS section.`)
  const columns: TassColumn[] = []
  for (const line of lines) {
    if (!line.trim() || line.startsWith("'")) continue
    const cells = line.split('\t')
    const index = Number(cells[0])
    if (!Number.isInteger(index) || cells.length < 5)
      throw new TassReadError(`${name}: a column line does not read as "ID, Name, Units, Decimal, Description".`)
    columns.push({ index, name: cells[1].trim(), units: cells[2].trim(), description: cells[4].trim() })
  }
  columns.sort((a, b) => a.index - b.index)
  if (columns.some((column, i) => column.index !== i))
    throw new TassReadError(`${name}: its column numbers are not 0, 1, 2, … in order.`)
  return columns
}

function locate(columns: TassColumn[]): Partial<Record<Field, number>> {
  const at: Partial<Record<Field, number>> = {}
  for (const field of Object.keys(WANTED) as Field[]) {
    const matches = columns.filter((column) => key(column.name) === key(WANTED[field].name))
    if (matches.length > 1) throw new TassReadError(`The columns name "${WANTED[field].name}" more than once.`)
    const column = matches[0]
    if (!column) continue
    const units: readonly string[] = WANTED[field].units
    if (!units.includes(column.units.toLowerCase()))
      throw new TassReadError(
        `Column "${column.name}" is in ${column.units || 'no unit'}, not ${units.filter(Boolean).join(' or ') || 'unitless'}: this reader does not convert it.`,
      )
    at[field] = column.index
  }
  const missing = REQUIRED.filter((field) => at[field] === undefined)
  if (missing.length)
    throw new TassReadError(`The columns have no ${missing.map((field) => `"${WANTED[field].name}"`).join(', ')}.`)
  return at
}

function conditionOf(text: string): TassCondition {
  const value = key(text)
  if (value === 'live') return 'live'
  if (value === 'snag') return 'snag'
  if (value === 'cwd' || value === 'down') return 'down'
  return 'unknown'
}

/**
 * Reads a TASS stem table. `schema` is the `.tcl` that came with the export; without it, only the
 * bundled 4.3.1.2 layout is read, and only when every row has its 28 fields.
 */
export function readTassStemTable(input: {
  name: string
  text: string
  schema?: { name: string; text: string } | null
}): TassStemTable {
  const text = input.text.replace(/^\uFEFF/, '')
  if (!isTassStemTable(text))
    throw new TassReadError(`${input.name} is not a TASS stem table (its *AppType is not Tass_Stems).`)
  const lines = text.split(/\r?\n/)
  const dataStart = lines.findIndex((line) => line.trim().toLowerCase() === '*data')
  if (dataStart < 0) throw new TassReadError(`${input.name} has no *DATA section.`)
  const rows: Array<{ line: number; cells: string[] }> = []
  for (let i = dataStart + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('*')) break
    if (!lines[i].trim()) continue
    rows.push({ line: i + 1, cells: lines[i].split('\t').map((cell) => cell.trim()) })
  }

  const notes: string[] = []
  let columns: TassColumn[]
  let schema: TassStemTable['schema']
  if (input.schema) {
    columns = readTassColumns(input.schema.text, input.schema.name)
    schema = { source: 'file', name: input.schema.name }
  } else {
    const width = BUNDLED_TASS_STEMS_COLUMNS.length
    const off = rows.find((row) => row.cells.length !== width)
    if (off)
      throw new TassReadError(
        `Line ${off.line} has ${off.cells.length} fields, not the ${width} of TASS 4.3.1.2's stem table: add the export's .tcl.`,
      )
    columns = BUNDLED_TASS_STEMS_COLUMNS.map(([name, units], index) => ({ index, name, units, description: '' }))
    schema = { source: 'assumed' }
    notes.push(
      'Columns assumed from TASS 4.3.1.2’s bundled Tass_Stems.tcl. Newer TASS writes its own column file; add it to be sure.',
    )
  }
  const at = locate(columns)

  const run: TassStemTable['run'] = []
  let plotMeters: TassStemTable['plotMeters'] = null
  for (const line of sectionLines(text, 'RUN') ?? []) {
    const match = /^([^:\t]+):\s*(.*)$/.exec(line.trim())
    if (!match) continue
    run.push({ key: match[1].trim(), value: match[2].trim() })
    const size = /^Plot size$/i.test(match[1].trim()) ? /([\d.]+)\s*m\s*x\s*([\d.]+)\s*m/i.exec(match[2]) : null
    if (size) {
      const width = Number(size[1])
      const length = Number(size[2])
      if (width > 0 && length > 0) plotMeters = { width, length }
    }
  }

  const cell = (cells: string[], field: Field) => {
    const index = at[field]
    return index === undefined ? '' : (cells[index] ?? '')
  }
  const numberAt = (cells: string[], field: Field): number | null => {
    const value = cell(cells, field)
    if (MISSING.has(value.toLowerCase())) return null
    const number = Number(value)
    return Number.isFinite(number) ? number : NaN
  }

  const stems: TassStem[] = []
  const skipped: TassStemTable['skipped'] = []
  const ids = new Set<string>()
  const ages = new Set<number>()
  for (const { line, cells } of rows) {
    if (cells.length < columns.length) {
      skipped.push({ line, reason: `${cells.length} fields, not ${columns.length}` })
      continue
    }
    const id = cell(cells, 'id')
    const x = numberAt(cells, 'x')
    const y = numberAt(cells, 'y')
    const height = numberAt(cells, 'height')
    if (!id || x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) {
      skipped.push({ line, reason: 'no position' })
      continue
    }
    if (height === null || !Number.isFinite(height) || height < 0) {
      skipped.push({ line, reason: 'no height' })
      continue
    }
    if (ids.has(id)) {
      skipped.push({ line, reason: `tree ID ${id} again` })
      continue
    }
    ids.add(id)
    const age = numberAt(cells, 'standAge')
    if (age !== null && Number.isFinite(age)) ages.add(age)
    const conditionText = cell(cells, 'condition')
    const condition = conditionOf(conditionText)
    const finiteOrNull = (value: number | null) =>
      value !== null && Number.isFinite(value) && value > 0 ? value : null
    const crownBase = condition === 'live' ? finiteOrNull(numberAt(cells, 'crownBase')) : null
    const speciesCode = cell(cells, 'species')
    stems.push({
      id,
      x,
      y,
      speciesCode,
      species: speciesFromCode(speciesCode),
      heightMeters: height,
      dbhCm: finiteOrNull(numberAt(cells, 'dbh')),
      crownWidthMeters: condition === 'live' ? finiteOrNull(numberAt(cells, 'crownWidth')) : null,
      crownBaseMeters: crownBase !== null && crownBase < height ? crownBase : null,
      condition,
      conditionText,
      line,
    })
  }
  if (!stems.length) throw new TassReadError(`${input.name} has no stems to read.`)
  if (ages.size > 1) notes.push(`The rows carry ${ages.size} stand ages: this table holds more than one snapshot.`)
  const unknown = stems.filter((stem) => stem.condition === 'unknown').length
  if (unknown) notes.push(`${unknown} stems have a condition this reader does not know; they are left out.`)
  if (!plotMeters) notes.push('The table states no plot size: the plot is taken as the stems’ own extent.')

  return {
    name: input.name,
    schema,
    columns,
    plotMeters,
    standAge: ages.size === 1 ? [...ages][0] : null,
    run,
    stems,
    skipped,
    notes,
  }
}

/** Counts of a table's stems by condition. */
export function tassConditionCounts(table: Pick<TassStemTable, 'stems'>): Record<TassCondition, number> {
  const counts: Record<TassCondition, number> = { live: 0, snag: 0, down: 0, unknown: 0 }
  for (const stem of table.stems) counts[stem.condition] += 1
  return counts
}

const median = (values: number[]): number | null => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Live stems' median height, crown width and crown base as a share of height, for the summary. */
export function tassLiveSummary(table: Pick<TassStemTable, 'stems'>) {
  const live = table.stems.filter((stem) => stem.condition === 'live')
  return {
    heightMeters: median(live.map((stem) => stem.heightMeters)),
    crownWidthMeters: median(live.flatMap((stem) => (stem.crownWidthMeters === null ? [] : [stem.crownWidthMeters]))),
    crownBaseShare: median(
      live.flatMap((stem) => (stem.crownBaseMeters === null ? [] : [stem.crownBaseMeters / stem.heightMeters])),
    ),
  }
}

/**
 * Which corner the plot coordinates measure from:
 * - `xy`: south-west corner, first value east, second north (TASS help, "X/Y").
 * - `rowColumn`: north-west corner, first value down the plot (south), second east (TASS help,
 *   "Row/Column"; the bundled schema describes its X and Y columns as Row and Column).
 */
export type TassAxes = 'xy' | 'rowColumn'

export const TASS_AXES_LABELS: Record<TassAxes, string> = {
  xy: 'X east, Y north, from the south-west corner',
  rowColumn: 'Row south, column east, from the north-west corner',
}

export type TassPlacement = {
  axes: TassAxes
  /** Which way the plot's own north edge faces, degrees clockwise from true north. */
  bearingDegrees: number
  /** Repeat the plot across the whole block; otherwise one plot at the block's centre. */
  repeat: boolean
}

export type TassPlacementResult = {
  trees: ImportedTree[]
  /** Plot copies with at least one tree drawn in the block. */
  copies: number
  /** Live stems at or below breast height, which the stand does not draw (per copy). */
  shortLive: number
  /** Trees inside the block past `TREE_LIST_MAX_TREES`, left out: the copies farthest from the block's centre. */
  leftOut: number
  /** The block's share covered by the plot, when it is not repeated (0–1); 1 when repeated. */
  coveredShare: number
}

/** A plot position to metres east and north of the plot's centre. */
function plotOffset(stem: Pick<TassStem, 'x' | 'y'>, axes: TassAxes, plot: { width: number; length: number }) {
  if (axes === 'xy') return { east: stem.x - plot.width / 2, north: stem.y - plot.length / 2 }
  // Row runs south from the north edge, column east from the west edge.
  return { east: stem.y - plot.width / 2, north: plot.length / 2 - stem.x }
}

function boundsOf(geometry: PolygonGeometry): [number, number, number, number] {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  for (const polygon of polygons)
    for (const [lng, lat] of polygon[0] ?? []) {
      if (lng < west) west = lng
      if (lng > east) east = lng
      if (lat < south) south = lat
      if (lat > north) north = lat
    }
  return [west, south, east, north]
}

/**
 * Places a TASS plot over a block: its centre at the centre of the block's bounding box, its north
 * edge turned to `bearingDegrees`, repeated edge to edge across the block when `repeat` is set. Only
 * live stems over breast height inside the block become trees; each copy's trees keep the TASS ID,
 * suffixed with the copy (`17@2,-1`) so no two share one. Crown base is carried as written.
 */
export function placeTassPlot(
  table: Pick<TassStemTable, 'stems' | 'plotMeters'>,
  geometry: PolygonGeometry,
  placement: TassPlacement,
): TassPlacementResult {
  const [west, south, east, north] = boundsOf(geometry)
  if (!Number.isFinite(west)) throw new TassReadError('The block has no shape to place the plot in.')
  const live = table.stems.filter((stem) => stem.condition === 'live')
  const standing = live.filter((stem) => stem.heightMeters > TREE_LIST_MIN_HEIGHT_M)
  const plot = table.plotMeters ?? {
    width: Math.max(1, ...table.stems.map((stem) => (placement.axes === 'xy' ? stem.x : stem.y))),
    length: Math.max(1, ...table.stems.map((stem) => (placement.axes === 'xy' ? stem.y : stem.x))),
  }
  const centre = { lng: (west + east) / 2, lat: (south + north) / 2 }
  const scale = metersPerDegree(centre.lat)
  const turn = (placement.bearingDegrees * Math.PI) / 180
  const cos = Math.cos(turn)
  const sin = Math.sin(turn)
  // Plot frame (east, north) turned clockwise by the bearing into map east and north.
  const toMap = (e: number, n: number) => ({ east: e * cos + n * sin, north: -e * sin + n * cos })
  const toPlot = (e: number, n: number) => ({ east: e * cos - n * sin, north: e * sin + n * cos })

  // How many copies cover the block's box, in the plot's own frame.
  let iMin = 0
  let iMax = 0
  let jMin = 0
  let jMax = 0
  if (placement.repeat) {
    const halfE = ((east - west) / 2) * scale.lng
    const halfN = ((north - south) / 2) * scale.lat
    let reachE = 0
    let reachN = 0
    for (const [e, n] of [
      [halfE, halfN],
      [halfE, -halfN],
    ]) {
      const p = toPlot(e, n)
      reachE = Math.max(reachE, Math.abs(p.east))
      reachN = Math.max(reachN, Math.abs(p.north))
    }
    iMax = Math.ceil(reachE / plot.width - 0.5)
    iMin = -iMax
    jMax = Math.ceil(reachN / plot.length - 0.5)
    jMin = -jMax
  }

  const inside = preparePolygons([geometry], [west, south, east, north])
  const trees: ImportedTree[] = []
  const copies = new Set<string>()
  let leftOut = 0
  // Copies nearest the block's centre first, so a block past the tree limit is drawn as one patch
  // round its centre rather than a strip along one edge.
  const order: Array<[number, number]> = []
  for (let j = jMin; j <= jMax; j += 1) for (let i = iMin; i <= iMax; i += 1) order.push([i, j])
  order.sort(([ai, aj], [bi, bj]) => {
    const a = (ai * plot.width) ** 2 + (aj * plot.length) ** 2
    const b = (bi * plot.width) ** 2 + (bj * plot.length) ** 2
    return a - b || aj - bj || ai - bi
  })
  for (const [i, j] of order)
    for (const stem of standing) {
      const local = plotOffset(stem, placement.axes, plot)
      const map = toMap(local.east + i * plot.width, local.north + j * plot.length)
      const lng = centre.lng + map.east / scale.lng
      const lat = centre.lat + map.north / scale.lat
      if (!inside.contains(lng, lat)) continue
      const copy = `${i},${j}`
      if (trees.length >= TREE_LIST_MAX_TREES) {
        leftOut += 1
        continue
      }
      copies.add(copy)
      trees.push({
        id: placement.repeat ? `${stem.id}@${copy}` : stem.id,
        lng,
        lat,
        heightMeters: stem.heightMeters,
        crownWidthMeters: stem.crownWidthMeters,
        dbhCm: stem.dbhCm,
        species: stem.species,
        crownBaseMeters: stem.crownBaseMeters,
      })
    }

  let coveredShare = 1
  if (!placement.repeat) {
    // The share of the block the one plot covers, sampled on a 5 m grid of the block's box.
    const step = 5
    let inBlock = 0
    let covered = 0
    for (let n = (south - centre.lat) * scale.lat; n <= (north - centre.lat) * scale.lat; n += step)
      for (let e = (west - centre.lng) * scale.lng; e <= (east - centre.lng) * scale.lng; e += step) {
        if (!inside.contains(centre.lng + e / scale.lng, centre.lat + n / scale.lat)) continue
        inBlock += 1
        const p = toPlot(e, n)
        if (Math.abs(p.east) <= plot.width / 2 && Math.abs(p.north) <= plot.length / 2) covered += 1
      }
    coveredShare = inBlock ? covered / inBlock : 0
  }

  return {
    trees,
    copies: copies.size,
    shortLive: live.length - standing.length,
    leftOut,
    coveredShare,
  }
}

/** The stand's source line: what was read and how it was placed, for `ImportedTreeSource.crs`. */
export function tassPlacementLabel(table: Pick<TassStemTable, 'standAge'>, placement: TassPlacement): string {
  const age = table.standAge === null ? '' : `stand age ${table.standAge}, `
  const turn = placement.bearingDegrees ? `, turned ${placement.bearingDegrees}°` : ''
  return `TASS plot (trial; ${age}${TASS_AXES_LABELS[placement.axes].toLowerCase()}${turn}, ${placement.repeat ? 'repeated across the block' : 'one plot at the block’s centre'})`
}
