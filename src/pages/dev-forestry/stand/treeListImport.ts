/**
 * A block's stand from an imported tree list: LiDAR-detected trees (tree approximate objects, FUSION
 * CanopyMaxima or TreeSeg tables, lidR's `locate_trees`/`crown_metrics` written out), a field stem map,
 * or the PGMaps LiDAR page's own crown segmentation (`treeIsolation.ts`).
 *
 * Reading and converting are separate steps on purpose. `readTreeList` only reads the file: columns,
 * rows, a suggested column mapping, and what the file itself states about its coordinate system. It
 * converts nothing. `convertTreeList` converts with the coordinate system and units the person chose:
 * a CRS or a unit is never guessed, and a hint is given only where the file states it (a GeoJSON
 * `crs` member or RFC 7946's longitude/latitude, an EPSG code in a comment line or a `crs` column,
 * columns named longitude and latitude, a unit in a column's name).
 *
 * Each row is one tree, drawn as measured. Nothing here reaches the run.
 *
 * DOM-free and network-free: the component reads the file and hands over its text or parsed JSON.
 */

import proj4 from 'proj4'

import { crsDefinition } from '@/lib/geo/projectedCrs'

import { TREE_SPECIES_IDS, speciesFromCode, type TreeSpeciesId } from '../forest'
import { metersPerDegree } from '../visibility'

/** Most trees one block takes from a file; past it the first trees in file order are kept and the rest named. */
export const TREE_LIST_MAX_TREES = 25_000
/** Most rows read from one file before reading stops and says so. */
export const TREE_LIST_MAX_ROWS = 1_000_000
/** A tree must stand over breast height to carry a diameter, and no tree in BC is over 100 m. */
export const TREE_LIST_MIN_HEIGHT_M = 1.3
export const TREE_LIST_MAX_HEIGHT_M = 100
/** Crown widths over this read as missing: a wider "crown" is a unit or column mistake. */
export const TREE_LIST_MAX_CROWN_WIDTH_M = 50
/** Diameters over this read as missing. */
export const TREE_LIST_MAX_DBH_CM = 500
/** British Columbia's rough box, [west, south, east, north]: converted trees outside it are dropped. */
export const BC_ROUGH_BOUNDS: [number, number, number, number] = [-139.1, 48.2, -114.0, 60.0]

/** Columns a GeoJSON file gets from its geometry, beside its properties. */
export const GEOMETRY_X = '(geometry) x'
export const GEOMETRY_Y = '(geometry) y'
export const GEOMETRY_Z = '(geometry) z'
/** A crown polygon's own area, measured after conversion, in square metres. */
export const GEOMETRY_CROWN_AREA = '(geometry) crown area'

export type TreeListCell = string | number
export type TreeListRow = Record<string, TreeListCell>
export type CrownMeasure = 'width' | 'radius' | 'area'

/** Source column names for each tree field; null where the file has none (or none is chosen). */
export type ColumnMapping = {
  /** Easting, or longitude when the coordinates are longitude/latitude. */
  x: string | null
  /** Northing, or latitude. */
  y: string | null
  height: string | null
  crown: string | null
  /** What the crown column measures: a full width (diameter), a radius or an area. */
  crownMeasure: CrownMeasure
  dbh: string | null
  species: string | null
  id: string | null
}

export type TreeListGeometry = GeoJSON.Point | GeoJSON.Polygon | GeoJSON.MultiPolygon

export type CrsHint = { epsg: number | null; source: string }

export type TreeListRead = {
  kind: 'csv' | 'geojson'
  name: string
  columns: string[]
  rows: TreeListRow[]
  /** GeoJSON only: each row's geometry, for a crown polygon's area. */
  geometries: Array<TreeListGeometry | null> | null
  suggested: ColumnMapping
  /** What the file states about its coordinate system; null where it states nothing. */
  crsHint: CrsHint | null
  problems: string[]
}

export type TreeListUnits = { height: 'm' | 'ft'; diameter: 'cm' | 'in' }
/** Units a mapping's column names state; null where a name states none (ask). */
export type StatedUnits = { height: 'm' | 'ft' | null; diameter: 'cm' | 'in' | null }

export type ImportedTree = {
  /** The file's id where a column gives one, else its record number (1-based). */
  id: string
  lng: number
  lat: number
  heightMeters: number
  /** Crown width (diameter), metres, from the file; null where it gives none. */
  crownWidthMeters: number | null
  /** Diameter at breast height, cm, from the file; null where it gives none. */
  dbhCm: number | null
  species: TreeSpeciesId | null
  /** Height to the base of the live crown, metres; absent or null where the source gives none (trial: TASS). */
  crownBaseMeters?: number | null
}

/** Where a block's imported trees came from, as the prescription dialog shows it. */
export type ImportedTreeSource = {
  fileName: string
  /** The coordinate system the person chose, as labelled: "UTM zone 10 N, NAD83 (EPSG:26910)". */
  crs: string
  count: number
  /** Rows dropped with a reason (no position, an unbelievable height, outside BC). */
  dropped: number
  /** Trees past `TREE_LIST_MAX_TREES`, left out; absent when none were. */
  leftOut?: number
}

export type ConvertOptions = {
  /** The coordinate system the person chose: 4326 for longitude/latitude. */
  epsg: number
  /** Crown widths, radii and areas are read in the height's unit (m or ft; m² or ft²). */
  units: TreeListUnits
  speciesCodes?: (code: string) => TreeSpeciesId | null
}

/** Converts one position in `epsg` to longitude/latitude. */
export type ProjectToLngLat = (epsg: number, x: number, y: number) => [number, number]

export type TreeListConversion = {
  trees: ImportedTree[]
  /** `row` is the 1-based record number: the data row of a table, the feature of a GeoJSON file. */
  dropped: Array<{ row: number; reason: string }>
  /** [west, south, east, north] of the kept trees, or null when none are kept. */
  bounds: [number, number, number, number] | null
  /** Trees past `TREE_LIST_MAX_TREES`, left out. */
  leftOut: number
  notes: string[]
}

// --- columns -----------------------------------------------------------------------------------

const normalise = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '')
const tokens = (name: string) =>
  name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

/** Aliases in priority order, compared without case, spaces or punctuation. */
const ALIASES = {
  id: ['treeid', 'id', 'taoid', 'stemid', 'index', 'fid', 'objectid', 'tree', 'treenumber', 'treeno', 'no'],
  x: ['x', 'easting', 'east', 'utmx', 'utme', 'xcoord', 'xcoordinate', 'pointx', 'xutm', 'centrex', 'centerx'],
  y: ['y', 'northing', 'north', 'utmy', 'utmn', 'ycoord', 'ycoordinate', 'pointy', 'yutm', 'centrey', 'centery'],
  lon: ['lon', 'long', 'lng', 'longitude', 'xlon', 'longdd'],
  lat: ['lat', 'latitude', 'ylat', 'latdd'],
  height: [
    'heightm',
    'heightft',
    'heightaboveground',
    'treeheight',
    'treeheightm',
    'height',
    'maxheight',
    'maximumheight',
    'zmax',
    'ht',
    'htm',
    'h',
    'z',
    'heightabovegroundm',
  ],
  crownWidth: [
    'crowndiameter',
    'crowndiameterm',
    'crownwidth',
    'crownwidthm',
    'avgcrowndiameter',
    'averagecrowndiameter',
    'meancrowndiameter',
    'maxcrowndiameter',
    'maximumcrowndiameter',
    'crowndiam',
    'cw',
    'cd',
  ],
  crownRadius: ['crownradius', 'crownradiusm', 'avgcrownradius', 'cr'],
  crownArea: ['crownaream2', 'crownarea', 'convhullarea', 'convhullaream2', 'crownprojectedarea', 'area', 'ca'],
  dbh: ['dbh', 'dbhcm', 'dbhin', 'diameterbreastheight', 'diameter', 'diam', 'd'],
  species: ['species', 'speciescode', 'speciescd', 'sp', 'spp', 'spec', 'speciescd1'],
} as const

function pick(columns: string[], aliases: readonly string[]): string | null {
  const byName = new Map<string, string>()
  for (const column of columns) {
    const key = normalise(column)
    if (!byName.has(key)) byName.set(key, column)
  }
  for (const alias of aliases) {
    const found = byName.get(alias)
    if (found) return found
  }
  return null
}

/** A mapping from column names alone, by case-insensitive aliases. Never reads the values. */
export function suggestMapping(columns: string[]): ColumnMapping {
  const lon = pick(columns, ALIASES.lon)
  const lat = pick(columns, ALIASES.lat)
  const lonLat = lon && lat
  const geometry = columns.includes(GEOMETRY_X) && columns.includes(GEOMETRY_Y)
  const width = pick(columns, ALIASES.crownWidth)
  const radius = width ? null : pick(columns, ALIASES.crownRadius)
  const area =
    width || radius
      ? null
      : (pick(columns, ALIASES.crownArea) ?? (columns.includes(GEOMETRY_CROWN_AREA) ? GEOMETRY_CROWN_AREA : null))
  return {
    x: geometry ? GEOMETRY_X : lonLat ? lon : pick(columns, ALIASES.x),
    y: geometry ? GEOMETRY_Y : lonLat ? lat : pick(columns, ALIASES.y),
    height: pick(columns, ALIASES.height),
    crown: width ?? radius ?? area,
    crownMeasure: width ? 'width' : radius ? 'radius' : area ? 'area' : 'width',
    dbh: pick(columns, ALIASES.dbh),
    species: pick(columns, ALIASES.species),
    id: pick(columns, ALIASES.id),
  }
}

/** The units the mapped columns' names state (`height_m`, `dbh_cm`, `HEIGHT (ft)`); null where they state none. */
export function statedUnits(mapping: ColumnMapping): StatedUnits {
  const lengthOf = (column: string | null): 'm' | 'ft' | null => {
    if (!column || column === GEOMETRY_CROWN_AREA) return null
    const words = tokens(column)
    const metres = words.some((word) => ['m', 'm2', 'metre', 'metres', 'meter', 'meters'].includes(word))
    const feet = words.some((word) => ['ft', 'ft2', 'feet', 'foot'].includes(word))
    return metres === feet ? null : metres ? 'm' : 'ft'
  }
  const diameterOf = (column: string | null): 'cm' | 'in' | null => {
    if (!column) return null
    const words = tokens(column)
    const cm = words.includes('cm')
    const inches = words.some((word) => ['in', 'inch', 'inches'].includes(word))
    return cm === inches ? null : cm ? 'cm' : 'in'
  }
  return { height: lengthOf(mapping.height) ?? lengthOf(mapping.crown), diameter: diameterOf(mapping.dbh) }
}

// --- reading -----------------------------------------------------------------------------------

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/

function cell(raw: string): TreeListCell {
  const value = raw.trim()
  return NUMBER.test(value) ? Number(value) : value
}

function splitLine(line: string, delimiter: string | null): string[] {
  if (delimiter === null) return line.trim().split(/\s+/)
  const out: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"'
        i += 1
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"' && field.trim() === '') {
      field = ''
      quoted = true
    } else if (char === delimiter) {
      out.push(field)
      field = ''
    } else field += char
  }
  out.push(field)
  return out
}

function countOutsideQuotes(line: string, char: string): number {
  let count = 0
  let quoted = false
  for (const c of line) {
    if (c === '"') quoted = !quoted
    else if (!quoted && c === char) count += 1
  }
  return count
}

function detectDelimiter(line: string): string | null {
  let best: string | null = null
  let most = 0
  for (const candidate of ['\t', ',', ';', '|']) {
    const count = countOutsideQuotes(line, candidate)
    if (count > most) {
      best = candidate
      most = count
    }
  }
  return best
}

function uniqueColumns(names: string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((raw, index) => {
    const name = raw.trim() || `column ${index + 1}`
    const count = seen.get(name) ?? 0
    seen.set(name, count + 1)
    return count ? `${name} (${count + 1})` : name
  })
}

const EPSG_TEXT = /EPSG\s*[:=]?\s*:?\s*(\d{4,5})\b/i

/** A supported EPSG code a piece of text names, or a hint that it names one this import cannot read. */
function epsgHint(text: string, source: string, problems: string[]): CrsHint | null {
  const match = EPSG_TEXT.exec(text)
  if (!match) return null
  const epsg = Number(match[1])
  if (epsg === 4326 || crsDefinition(epsg) !== null) return { epsg, source }
  problems.push(`The file names EPSG:${epsg}, which this import does not read: reproject it or choose the system.`)
  return { epsg: null, source: `${source}: EPSG:${epsg}, not one this import reads` }
}

function lonLatValues(rows: TreeListRow[], x: string, y: string): boolean {
  let any = false
  for (const row of rows) {
    const lng = row[x]
    const lat = row[y]
    if (lng === '' || lat === '' || lng === undefined || lat === undefined) continue
    if (typeof lng !== 'number' || typeof lat !== 'number') return false
    if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return false
    any = true
  }
  return any
}

function readTable(name: string, text: string): TreeListRead {
  const problems: string[] = []
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  let index = 0
  const comments: string[] = []
  while (index < lines.length && (lines[index].trim() === '' || /^\s*(#|\/\/)/.test(lines[index]))) {
    if (lines[index].trim()) comments.push(lines[index])
    index += 1
  }
  const empty = (): TreeListRead => ({
    kind: 'csv',
    name,
    columns: [],
    rows: [],
    geometries: null,
    suggested: suggestMapping([]),
    crsHint: null,
    problems: [...problems, `${name} has no rows to read.`],
  })
  if (index >= lines.length) return empty()
  const delimiter = detectDelimiter(lines[index])
  const first = splitLine(lines[index], delimiter)
  const headerless = first.every((field) => NUMBER.test(field.trim()))
  const columns = uniqueColumns(headerless ? first.map((_, i) => `column ${i + 1}`) : first)
  if (headerless)
    problems.push(`${name} has no header row: its columns are numbered, so choose each one in the mapping.`)
  if (!headerless) index += 1
  if (columns.length < 3) problems.push(`${name} has ${columns.length} column(s): a tree list needs x, y and height.`)

  const rows: TreeListRow[] = []
  let ragged = 0
  for (; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === '' || /^\s*(#|\/\/)/.test(line)) continue
    if (rows.length >= TREE_LIST_MAX_ROWS) {
      problems.push(`Reading stopped at ${TREE_LIST_MAX_ROWS.toLocaleString('en-CA')} rows.`)
      break
    }
    const fields = splitLine(line, delimiter)
    if (fields.length !== columns.length) ragged += 1
    const row: TreeListRow = {}
    columns.forEach((column, i) => {
      row[column] = cell(fields[i] ?? '')
    })
    rows.push(row)
  }
  if (ragged) problems.push(`${ragged} row(s) have a different number of fields from the header.`)
  if (!rows.length) return { ...empty(), columns }

  const suggested = headerless ? suggestMapping([]) : suggestMapping(columns)
  let crsHint: CrsHint | null = null
  for (const comment of comments) {
    crsHint = epsgHint(comment, 'an EPSG code in the file’s comment lines', problems)
    if (crsHint) break
  }
  if (!crsHint) {
    const crsColumn = pick(columns, ['crs', 'epsg', 'srid', 'epsgcode'])
    if (crsColumn) {
      const values = new Set(rows.map((row) => String(row[crsColumn]).trim()).filter(Boolean))
      if (values.size === 1) {
        const [value] = values
        crsHint = epsgHint(/^\d+$/.test(value) ? `EPSG:${value}` : value, `the file’s ${crsColumn} column`, problems)
      } else if (values.size > 1) problems.push(`The ${crsColumn} column names more than one coordinate system.`)
    }
  }
  const lon = pick(columns, ALIASES.lon)
  const lat = pick(columns, ALIASES.lat)
  if (!crsHint && !headerless && lon && lat && suggested.x === lon && lonLatValues(rows, lon, lat))
    crsHint = { epsg: 4326, source: `columns named ${lon} and ${lat}` }
  return { kind: 'csv', name, columns, rows, geometries: null, suggested, crsHint, problems }
}

type Position = number[]

function ringCentroid(ring: Position[]): { area: number; x: number; y: number } {
  if (!ring.length) return { area: 0, x: 0, y: 0 }
  // Taken about the ring's first vertex: at UTM or longitude magnitudes the cross products of raw
  // coordinates cancel to a few metres' error on a crown a few metres wide.
  const [ox, oy] = ring[0]
  let area = 0
  let cx = 0
  let cy = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xj = ring[j][0] - ox
    const yj = ring[j][1] - oy
    const xi = ring[i][0] - ox
    const yi = ring[i][1] - oy
    const cross = xj * yi - xi * yj
    area += cross
    cx += (xj + xi) * cross
    cy += (yj + yi) * cross
  }
  area /= 2
  return area === 0 ? { area: 0, x: 0, y: 0 } : { area, x: ox + cx / (6 * area), y: oy + cy / (6 * area) }
}

function polygonsOf(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): Position[][][] {
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
}

/** A polygon's area-weighted centroid in its own coordinates (holes subtracted); the vertex mean if it has no area. */
function centroid(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number] | null {
  let area = 0
  let x = 0
  let y = 0
  let count = 0
  let sumX = 0
  let sumY = 0
  for (const polygon of polygonsOf(geometry))
    polygon.forEach((ring, index) => {
      const part = ringCentroid(ring)
      // Signed by ring order: an outer ring and its holes always weigh in opposite senses.
      const weight = index === 0 ? Math.abs(part.area) : -Math.abs(part.area)
      area += weight
      x += part.x * weight
      y += part.y * weight
      for (const position of ring) {
        sumX += position[0]
        sumY += position[1]
        count += 1
      }
    })
  if (Math.abs(area) > 0) return [x / area, y / area]
  return count ? [sumX / count, sumY / count] : null
}

function scalar(value: unknown): TreeListCell | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : ''
  if (typeof value === 'string') return cell(value)
  if (typeof value === 'boolean') return String(value)
  if (value === null) return ''
  return undefined
}

function readGeoJson(name: string, json: unknown): TreeListRead {
  const problems: string[] = []
  const root = (json ?? {}) as Record<string, unknown>
  // The PGMaps LiDAR page's crown segmentation: { grid: { crs }, crowns: FeatureCollection }.
  const crownFile =
    typeof root.crowns === 'object' && root.crowns !== null && typeof root.grid === 'object' && root.grid !== null
  const collection = (crownFile ? root.crowns : root) as Record<string, unknown>
  const features: GeoJSON.Feature[] =
    collection.type === 'FeatureCollection' && Array.isArray(collection.features)
      ? (collection.features as GeoJSON.Feature[])
      : collection.type === 'Feature'
        ? [collection as unknown as GeoJSON.Feature]
        : []
  const base: TreeListRead = {
    kind: 'geojson',
    name,
    columns: [],
    rows: [],
    geometries: [],
    suggested: suggestMapping([]),
    crsHint: null,
    problems,
  }
  if (!features.length) {
    problems.push(`${name} has no GeoJSON features to read.`)
    return base
  }

  const propertyColumns: string[] = []
  const seen = new Set<string>()
  const skipped = new Set<string>()
  const rows: TreeListRow[] = []
  const geometries: Array<TreeListGeometry | null> = []
  let polygons = 0
  let withZ = false
  let unread = 0
  for (const feature of features.slice(0, TREE_LIST_MAX_ROWS)) {
    const row: TreeListRow = { [GEOMETRY_X]: '', [GEOMETRY_Y]: '' }
    const geometry = feature?.geometry ?? null
    let kept: TreeListGeometry | null = null
    if (geometry?.type === 'Point') {
      kept = geometry
      row[GEOMETRY_X] = geometry.coordinates[0]
      row[GEOMETRY_Y] = geometry.coordinates[1]
      if (geometry.coordinates.length > 2) {
        row[GEOMETRY_Z] = geometry.coordinates[2]
        withZ = true
      }
    } else if (geometry?.type === 'MultiPoint' && geometry.coordinates.length === 1) {
      const [point] = geometry.coordinates
      kept = { type: 'Point', coordinates: point }
      row[GEOMETRY_X] = point[0]
      row[GEOMETRY_Y] = point[1]
      if (point.length > 2) {
        row[GEOMETRY_Z] = point[2]
        withZ = true
      }
    } else if (geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon') {
      kept = geometry
      polygons += 1
      const centre = centroid(geometry)
      if (centre) {
        row[GEOMETRY_X] = centre[0]
        row[GEOMETRY_Y] = centre[1]
      }
    } else unread += 1
    for (const [key, value] of Object.entries(feature?.properties ?? {})) {
      const read = scalar(value)
      if (read === undefined) {
        skipped.add(key)
        continue
      }
      if (!seen.has(key)) {
        seen.add(key)
        propertyColumns.push(key)
      }
      row[key] = read
    }
    rows.push(row)
    geometries.push(kept)
  }
  if (features.length > TREE_LIST_MAX_ROWS)
    problems.push(`Reading stopped at ${TREE_LIST_MAX_ROWS.toLocaleString('en-CA')} features.`)
  if (unread) problems.push(`${unread} feature(s) are not points or crown polygons and have no position.`)
  if (skipped.size)
    problems.push(`Properties that are not single values were left out: ${[...skipped].sort().join(', ')}.`)

  const columns = [
    GEOMETRY_X,
    GEOMETRY_Y,
    ...(withZ ? [GEOMETRY_Z] : []),
    ...(polygons ? [GEOMETRY_CROWN_AREA] : []),
    ...propertyColumns.filter((column) => ![GEOMETRY_X, GEOMETRY_Y, GEOMETRY_Z, GEOMETRY_CROWN_AREA].includes(column)),
  ]
  for (const row of rows) for (const column of columns) if (!(column in row)) row[column] = ''

  let crsHint: CrsHint | null = null
  if (crownFile) {
    const grid = root.grid as { crs?: unknown }
    crsHint = {
      epsg: 4326,
      source: `PGMaps crown segmentation: outlines in longitude/latitude${typeof grid.crs === 'string' ? ` (its grid is ${grid.crs})` : ''}`,
    }
  } else if (collection.crs != null) {
    const crs = collection.crs as { properties?: { name?: unknown } }
    const crsName = typeof crs.properties?.name === 'string' ? crs.properties.name : ''
    if (/CRS84$/i.test(crsName)) crsHint = { epsg: 4326, source: 'the file’s crs member (CRS84)' }
    else crsHint = epsgHint(crsName.replace(/::/g, ':'), 'the file’s crs member', problems)
    if (!crsHint) {
      problems.push(`The file’s crs member (${crsName || 'unnamed'}) is not one this import reads: choose the system.`)
      crsHint = { epsg: null, source: `the file’s crs member names ${crsName || 'no system'}` }
    }
  } else if (lonLatValues(rows, GEOMETRY_X, GEOMETRY_Y))
    crsHint = { epsg: 4326, source: 'GeoJSON without a crs member is longitude/latitude (RFC 7946)' }
  else
    problems.push(
      'The coordinates are not longitude/latitude, though GeoJSON without a crs member should be: choose the system.',
    )

  return { ...base, columns, rows, geometries, suggested: suggestMapping(columns), crsHint }
}

/**
 * Reads a tree list without converting anything: CSV, TSV or other delimited text (`text`), or GeoJSON
 * (`json`, already parsed): Point features, or crown Polygon/MultiPolygon features whose centroid is
 * the stem and whose area gives the crown width (column `GEOMETRY_CROWN_AREA`).
 */
export function readTreeList(input: { name: string; text?: string; json?: unknown }): TreeListRead {
  if (input.json !== undefined) return readGeoJson(input.name, input.json)
  const text = input.text ?? ''
  if (/^\s*[{[]/.test(text)) {
    try {
      return readGeoJson(input.name, JSON.parse(text))
    } catch {
      // Not JSON after all: read it as a table, which says what is wrong with it.
    }
  }
  return readTable(input.name, text)
}

// --- converting --------------------------------------------------------------------------------

/** The systems a tree list is offered in; a supported system the file states is added beside them. */
export const TREE_LIST_CRS_CHOICES: ReadonlyArray<{ epsg: number; label: string }> = [
  { epsg: 4326, label: 'Longitude/latitude (WGS 84)' },
  { epsg: 3005, label: 'BC Albers (EPSG:3005)' },
  ...[9, 10, 11].map((zone) => ({ epsg: 26900 + zone, label: `UTM zone ${zone} N, NAD83 (EPSG:${26900 + zone})` })),
  ...[9, 10, 11].map((zone) => ({ epsg: 32600 + zone, label: `UTM zone ${zone} N, WGS 84 (EPSG:${32600 + zone})` })),
]

/** The choice list for a read: the standard systems, plus the one the file states when it is another this import reads. */
export function crsChoicesFor(hint: CrsHint | null): Array<{ epsg: number; label: string }> {
  const choices = [...TREE_LIST_CRS_CHOICES]
  const epsg = hint?.epsg
  if (epsg != null && !choices.some((choice) => choice.epsg === epsg) && crsDefinition(epsg))
    choices.push({ epsg, label: `EPSG:${epsg} (stated by the file)` })
  return choices
}

const projections = new Map<number, (xy: [number, number]) => [number, number]>()

/** proj4 through the repository's EPSG definitions (`projectedCrs.ts`). Throws for an unsupported code. */
export const projectWithProj4: ProjectToLngLat = (epsg, x, y) => {
  if (epsg === 4326) return [x, y]
  let forward = projections.get(epsg)
  if (!forward) {
    const definition = crsDefinition(epsg)
    if (!definition) throw new Error(`EPSG:${epsg} is not a coordinate system this import reads.`)
    const converter = proj4(definition, 'EPSG:4326')
    forward = (xy) => converter.forward(xy) as [number, number]
    projections.set(epsg, forward)
  }
  return forward([x, y])
}

const FOOT = 0.3048
const INCH_CM = 2.54

/** The default species reading: a drawn species' own name, a common name, else a VRI species code. */
export function speciesFromText(code: string): TreeSpeciesId | null {
  const key = normalise(code)
  if (!key) return null
  const own = TREE_SPECIES_IDS.find((id) => id.toLowerCase() === key)
  if (own) return own
  if (key.length > 4) {
    if (key.includes('douglas')) return 'douglasFir'
    for (const [word, id] of [
      ['pine', 'pine'],
      ['spruce', 'spruce'],
      ['fir', 'fir'],
      ['hemlock', 'fir'],
      ['cedar', 'fir'],
      ['aspen', 'aspen'],
      ['poplar', 'aspen'],
      ['cottonwood', 'aspen'],
      ['birch', 'birch'],
    ] as const)
      if (key.includes(word)) return id
    return null
  }
  return speciesFromCode(code)
}

const numberOf = (value: TreeListCell | undefined): number =>
  typeof value === 'number' ? value : value === undefined || value === '' ? NaN : Number(value)

function geometryAreaM2(
  geometry: TreeListGeometry | null,
  toLngLat: (x: number, y: number) => [number, number],
): number | null {
  if (!geometry || geometry.type === 'Point') return null
  let area = 0
  for (const polygon of polygonsOf(geometry))
    polygon.forEach((ring, index) => {
      const points = ring.map(([x, y]) => toLngLat(x, y))
      if (!points.length) return
      const [lng0, lat0] = points[0]
      const scale = metersPerDegree(lat0)
      const metres = points.map(([lng, lat]) => [(lng - lng0) * scale.lng, (lat - lat0) * scale.lat])
      let sum = 0
      for (let i = 0, j = metres.length - 1; i < metres.length; j = i, i += 1)
        sum += metres[j][0] * metres[i][1] - metres[i][0] * metres[j][1]
      area += (index === 0 ? 1 : -1) * Math.abs(sum / 2)
    })
  return area > 0 && Number.isFinite(area) ? area : null
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString('en-CA')} ${count === 1 ? one : many}`

/**
 * Converts a read tree list with the coordinate system and units the person chose. Rows without a
 * position or a believable height are dropped with a reason; a missing crown, diameter or species
 * leaves that field null. Never guesses: `options.epsg` and `options.units` are the person's.
 */
export function convertTreeList(
  read: TreeListRead,
  mapping: ColumnMapping,
  options: ConvertOptions,
  project: ProjectToLngLat = projectWithProj4,
): TreeListConversion {
  if (!mapping.x || !mapping.y || !mapping.height)
    throw new Error('Choose the columns for x, y and height before converting.')
  if (options.epsg !== 4326 && !crsDefinition(options.epsg))
    throw new Error(`EPSG:${options.epsg} is not a coordinate system this import reads.`)
  const toLngLat = (x: number, y: number) => project(options.epsg, x, y)
  const species = options.speciesCodes ?? speciesFromText
  const length = options.units.height === 'ft' ? FOOT : 1
  const [west, south, east, north] = BC_ROUGH_BOUNDS
  const dropped: TreeListConversion['dropped'] = []
  const all: ImportedTree[] = []
  const ids = new Set<string>()
  let duplicateIds = 0
  let outside = 0
  let crownsOver = 0
  let dbhsOver = 0
  const unknownSpecies = new Map<string, number>()

  read.rows.forEach((row, index) => {
    const record = index + 1
    const drop = (reason: string) => dropped.push({ row: record, reason })
    const x = numberOf(row[mapping.x!])
    const y = numberOf(row[mapping.y!])
    if (!Number.isFinite(x) || !Number.isFinite(y)) return drop('no coordinates')
    let lng: number
    let lat: number
    try {
      ;[lng, lat] = toLngLat(x, y)
    } catch {
      return drop('coordinates could not be converted')
    }
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90)
      return drop('coordinates could not be converted')
    if (lng < west || lng > east || lat < south || lat > north) {
      outside += 1
      return drop('outside British Columbia (check the coordinate system)')
    }
    const height = numberOf(row[mapping.height!]) * length
    if (!Number.isFinite(height)) return drop('no height')
    if (height <= TREE_LIST_MIN_HEIGHT_M) return drop('not taller than breast height (1.3 m)')
    if (height > TREE_LIST_MAX_HEIGHT_M) return drop('taller than 100 m')

    let crownWidthMeters: number | null = null
    if (mapping.crown) {
      let width = NaN
      if (mapping.crown === GEOMETRY_CROWN_AREA) {
        const area = geometryAreaM2(read.geometries?.[index] ?? null, toLngLat)
        if (area !== null) width = 2 * Math.sqrt(area / Math.PI)
      } else {
        const value = numberOf(row[mapping.crown])
        if (mapping.crownMeasure === 'width') width = value * length
        else if (mapping.crownMeasure === 'radius') width = 2 * value * length
        else width = 2 * Math.sqrt((value * length * length) / Math.PI)
      }
      if (width > TREE_LIST_MAX_CROWN_WIDTH_M) crownsOver += 1
      else if (width > 0) crownWidthMeters = width
    }

    let dbhCm: number | null = null
    if (mapping.dbh) {
      const value = numberOf(row[mapping.dbh]) * (options.units.diameter === 'in' ? INCH_CM : 1)
      if (value > TREE_LIST_MAX_DBH_CM) dbhsOver += 1
      else if (value > 0) dbhCm = value
    }

    let speciesId: TreeSpeciesId | null = null
    if (mapping.species) {
      const code = String(row[mapping.species] ?? '').trim()
      if (code) {
        speciesId = species(code)
        if (!speciesId) unknownSpecies.set(code, (unknownSpecies.get(code) ?? 0) + 1)
      }
    }

    let id = mapping.id ? String(row[mapping.id] ?? '').trim() : ''
    if (!id) id = String(record)
    if (ids.has(id)) {
      duplicateIds += 1
      id = `${id}-${record}`
    }
    ids.add(id)

    all.push({ id, lng, lat, heightMeters: height, crownWidthMeters, dbhCm, species: speciesId })
  })

  const notes: string[] = []
  const leftOut = Math.max(0, all.length - TREE_LIST_MAX_TREES)
  const trees = leftOut ? all.slice(0, TREE_LIST_MAX_TREES) : all
  if (leftOut)
    notes.push(
      `${plural(leftOut, 'tree')} left out: a block takes at most ${TREE_LIST_MAX_TREES.toLocaleString('en-CA')}, the first in file order.`,
    )
  if (outside && outside === read.rows.length)
    notes.push(
      `None of the trees fall in British Columbia read as ${options.epsg === 4326 ? 'longitude/latitude' : `EPSG:${options.epsg}`}: the coordinate system is probably not this one.`,
    )
  else if (outside) notes.push(`${plural(outside, 'tree')} fall outside British Columbia and were dropped.`)
  if (crownsOver)
    notes.push(`${plural(crownsOver, 'crown')} wider than ${TREE_LIST_MAX_CROWN_WIDTH_M} m read as missing.`)
  if (dbhsOver) notes.push(`${plural(dbhsOver, 'diameter')} over ${TREE_LIST_MAX_DBH_CM} cm read as missing.`)
  if (unknownSpecies.size) {
    const count = [...unknownSpecies.values()].reduce((sum, n) => sum + n, 0)
    const codes = [...unknownSpecies.keys()].slice(0, 6).join(', ')
    notes.push(
      `${plural(count, 'tree')} with a species not read (${codes}${unknownSpecies.size > 6 ? ', …' : ''}): their species is left blank.`,
    )
  }
  if (duplicateIds) notes.push(`${plural(duplicateIds, 'repeated id')} given the record number as a suffix.`)

  let bounds: TreeListConversion['bounds'] = null
  for (const tree of trees) {
    if (!bounds) bounds = [tree.lng, tree.lat, tree.lng, tree.lat]
    else {
      bounds[0] = Math.min(bounds[0], tree.lng)
      bounds[1] = Math.min(bounds[1], tree.lat)
      bounds[2] = Math.max(bounds[2], tree.lng)
      bounds[3] = Math.max(bounds[3], tree.lat)
    }
  }
  return { trees, dropped, bounds, leftOut, notes }
}

/** "12 no height · 3 not taller than breast height (1.3 m)": the dropped rows by reason, most first. */
export function droppedSummary(dropped: TreeListConversion['dropped']): string {
  const counts = new Map<string, number>()
  for (const { reason } of dropped) counts.set(reason, (counts.get(reason) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${count.toLocaleString('en-CA')} ${reason}`)
    .join(' · ')
}

// --- saving ------------------------------------------------------------------------------------

/** The packed fields, in order, per tree. */
export const IMPORTED_TREE_FIELDS = ['lng', 'lat', 'heightMeters', 'crownWidthMeters', 'dbhCm', 'species'] as const
/**
 * Appended to `IMPORTED_TREE_FIELDS` only when some tree carries a crown base (trial: TASS), so a
 * list without one packs exactly as before and older files read unchanged.
 */
export const IMPORTED_TREE_CROWN_BASE_FIELD = 'crownBaseMeters'

/** Imported trees for a scene file: one flat number array, `IMPORTED_TREE_FIELDS.length` numbers a tree. */
export type PackedImportedTrees = {
  fields: string[]
  /** `species` values index this list; −1 is none. */
  species: TreeSpeciesId[]
  /** lng/lat to 1e-7°, heights, crown widths and diameters to 0.1; −1 for null. */
  data: number[]
  /** Omitted when every id is its 1-based position. */
  ids?: string[]
}

const NONE = -1
const round = (value: number, places: number) => {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

export function packImportedTrees(trees: ReadonlyArray<ImportedTree>): PackedImportedTrees {
  const species: TreeSpeciesId[] = []
  const data: number[] = []
  const withCrownBase = trees.some((tree) => tree.crownBaseMeters != null)
  let sequential = true
  for (const [index, tree] of trees.entries()) {
    if (tree.id !== String(index + 1)) sequential = false
    let speciesIndex = NONE
    if (tree.species) {
      speciesIndex = species.indexOf(tree.species)
      if (speciesIndex < 0) speciesIndex = species.push(tree.species) - 1
    }
    data.push(
      round(tree.lng, 7),
      round(tree.lat, 7),
      round(tree.heightMeters, 1),
      tree.crownWidthMeters === null ? NONE : round(tree.crownWidthMeters, 1),
      tree.dbhCm === null ? NONE : round(tree.dbhCm, 1),
      speciesIndex,
    )
    if (withCrownBase) data.push(tree.crownBaseMeters == null ? NONE : round(tree.crownBaseMeters, 1))
  }
  return {
    fields: withCrownBase ? [...IMPORTED_TREE_FIELDS, IMPORTED_TREE_CROWN_BASE_FIELD] : [...IMPORTED_TREE_FIELDS],
    species,
    data,
    ...(sequential ? {} : { ids: trees.map((tree) => tree.id) }),
  }
}

/** Reads packed trees back. Throws when the fields or the data length do not match this codec. */
export function unpackImportedTrees(packed: PackedImportedTrees): ImportedTree[] {
  const withCrownBase =
    Array.isArray(packed?.fields) &&
    packed.fields.length === IMPORTED_TREE_FIELDS.length + 1 &&
    packed.fields[IMPORTED_TREE_FIELDS.length] === IMPORTED_TREE_CROWN_BASE_FIELD
  const known: readonly string[] = withCrownBase
    ? [...IMPORTED_TREE_FIELDS, IMPORTED_TREE_CROWN_BASE_FIELD]
    : IMPORTED_TREE_FIELDS
  const width = known.length
  if (
    !Array.isArray(packed?.fields) ||
    packed.fields.length !== width ||
    packed.fields.some((field, i) => field !== known[i])
  )
    throw new Error('Imported trees were saved with fields this version does not read.')
  if (!Array.isArray(packed.data) || packed.data.length % width !== 0)
    throw new Error('Imported trees are cut short in this file.')
  const count = packed.data.length / width
  if (packed.ids && packed.ids.length !== count) throw new Error('Imported tree ids do not match the trees.')
  const nullable = (value: number) => (value === NONE || !Number.isFinite(value) ? null : value)
  const trees: ImportedTree[] = []
  for (let i = 0; i < count; i += 1) {
    const at = i * width
    const speciesIndex = packed.data[at + 5]
    trees.push({
      id: packed.ids?.[i] ?? String(i + 1),
      lng: packed.data[at],
      lat: packed.data[at + 1],
      heightMeters: packed.data[at + 2],
      crownWidthMeters: nullable(packed.data[at + 3]),
      dbhCm: nullable(packed.data[at + 4]),
      species: speciesIndex === NONE ? null : (packed.species[speciesIndex] ?? null),
      ...(withCrownBase ? { crownBaseMeters: nullable(packed.data[at + 6]) } : {}),
    })
  }
  return trees
}
