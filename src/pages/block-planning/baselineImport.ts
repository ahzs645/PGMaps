/**
 * Past disturbances from DataBC for a reporting unit the planner supplies: BC's consolidated
 * cutblocks (the shared harvest service, `BC_HARVEST_SERVICE`, read as the road designer and the
 * outdoors planner read it) and historical fire perimeters (`PROT_HISTORICAL_FIRE_POLYS_SP`).
 *
 * Each is read in the unit's bounding box, kept only when its year can still matter (young forest
 * is 0–20 years old, so nothing older than the earliest year asked about less 20), clipped to the
 * unit's boundary and kept with its source record. A record with no year is counted and left out,
 * never given one. RESULTS openings are not read separately: consolidated cutblocks are built from
 * them and other sources, and reading both would draw most harvests twice with differing years.
 *
 * DOM- and network-free: `fetch` is passed in. Coordinates are WGS84 longitude, latitude.
 */
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js'
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js'
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js'
import type Geometry from 'jsts/org/locationtech/jts/geom/Geometry.js'
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js'
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js'
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js'
import type { MultiPolygon, Polygon, Position } from 'geojson'
import { BC_HARVEST_FIELDS, BC_HARVEST_SERVICE, bcHarvestEvidence } from '@/lib/forestry/bcHarvest'
import { albersToLngLat, lngLatToAlbers } from '../dev-avast/projection'
import { YEAR_RANGE, type Disturbance, type Shape } from './plan'

export const FIRE_WFS = 'https://openmaps.gov.bc.ca/geo/pub/wfs'
export const FIRE_LAYER = 'pub:WHSE_LAND_AND_NATURAL_RESOURCE.PROT_HISTORICAL_FIRE_POLYS_SP'
/** The cutblock service answers at most this many records a page (its `maxRecordCount`). */
export const CUTBLOCK_PAGE_SIZE = 1000
export const FIRE_PAGE_SIZE = 1000
/** Past this many records in the unit's box the read stops and says so, rather than freezing the page. */
export const MAX_BASELINE_RECORDS = 25_000
export const YOUNG_WINDOW_YEARS = 20
/**
 * How far past the unit disturbances are read, so a patch that crosses the boundary is seen whole and
 * classed by its whole size. A patch reaching further than this is measured to here only.
 */
export const BASELINE_MARGIN_METRES = 5000

export type BaselineSource = 'cutblocks' | 'fires'
export const BASELINE_SOURCE_LABELS: Record<BaselineSource, string> = {
  cutblocks: 'DataBC consolidated cutblocks',
  fires: 'DataBC historical fire perimeters',
}

export interface BaselineRead {
  disturbances: Omit<Disturbance, 'id'>[]
  /** Per source: records read in the box, kept after clipping, outside the unit, and without a year. */
  counts: Record<BaselineSource, { read: number; kept: number; outside: number; noYear: number }>
  /** The earliest disturbance year read: everything older cannot be young in the years asked about. */
  fromYear: number
  readOn: string
  marginMetres: number
}

type Fetch = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

const factory = new GeometryFactory()
const reader = new GeoJSONReader(factory)
const writer = new GeoJSONWriter()

export function shapeBounds(shape: Shape): [number, number, number, number] {
  const polygons: Position[][][] = shape.type === 'Polygon' ? [shape.coordinates] : shape.coordinates
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity
  for (const poly of polygons)
    for (const [x, y] of poly[0]) {
      west = Math.min(west, x)
      east = Math.max(east, x)
      south = Math.min(south, y)
      north = Math.max(north, y)
    }
  return [west, south, east, north]
}

/**
 * Boxes to read a unit by: one per polygon part, merged while a merged box is no more than twice the
 * area of the boxes it replaces. A unit's parts are often scattered across a district, and one box
 * round all of them read 7,923 cutblocks to keep 55 for Fort St. James, Moist Interior - Mountain.
 */
export function readBoxes(shape: Shape): [number, number, number, number][] {
  const parts: Position[][][] = shape.type === 'Polygon' ? [shape.coordinates] : shape.coordinates
  let boxes = parts.map((poly) => shapeBounds({ type: 'Polygon', coordinates: poly }))
  const area = (b: [number, number, number, number]) => (b[2] - b[0]) * (b[3] - b[1])
  const merge = (
    a: [number, number, number, number],
    b: [number, number, number, number],
  ): [number, number, number, number] => [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ]
  for (let merged = true; merged; ) {
    merged = false
    outer: for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const m = merge(boxes[i], boxes[j])
        if (area(m) <= 1.5 * (area(boxes[i]) + area(boxes[j]))) {
          boxes = [...boxes.filter((_, k) => k !== i && k !== j), m]
          merged = true
          break outer
        }
      }
  }
  return boxes
}

/**
 * One page of cutblocks after `afterId`, by OBJECTID. Keyset paging, not offsets: the service cuts a
 * page short on its transfer limit (105, 488 or even 0 of 1,000 records, each flagged
 * `exceededTransferLimit`), so a short page is not the end and an offset would skip records.
 */
export function cutblockPageUrl(
  bounds: [number, number, number, number],
  fromYear: number,
  afterId: number,
  count = CUTBLOCK_PAGE_SIZE,
) {
  const params = new URLSearchParams({
    where: `HARVEST_START_YEAR_CALENDAR >= ${fromYear} AND OBJECTID > ${afterId}`,
    geometry: bounds.map((v) => v.toFixed(6)).join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: BC_HARVEST_FIELDS.join(','),
    returnGeometry: 'true',
    geometryPrecision: '7',
    orderByFields: 'OBJECTID',
    resultRecordCount: String(count),
    f: 'geojson',
  })
  return `${BC_HARVEST_SERVICE}/query?${params.toString()}`
}

/** WFS 2.0: the box goes in CQL_FILTER, longitude first; `srsName=EPSG:4326` answers longitude first too. */
export function firePageUrl(bounds: [number, number, number, number], fromYear: number, page: number) {
  const [w, s, e, n] = bounds.map((v) => v.toFixed(6))
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeName: FIRE_LAYER,
    outputFormat: 'json',
    srsName: 'EPSG:4326',
    propertyName: 'FIRE_NUMBER,FIRE_YEAR,FIRE_CAUSE,SHAPE',
    CQL_FILTER: `BBOX(SHAPE,${w},${s},${e},${n},'EPSG:4326') AND FIRE_YEAR >= ${fromYear}`,
    sortBy: 'OBJECTID',
    count: String(FIRE_PAGE_SIZE),
    startIndex: String(page * FIRE_PAGE_SIZE),
  })
  return `${FIRE_WFS}?${params.toString()}`
}

interface RawFeature {
  id?: string | number
  geometry: unknown
  properties: Record<string, unknown>
}

async function readPages(
  fetch: Fetch,
  url: (page: number) => string,
  pageSize: number,
  signal: AbortSignal | undefined,
  onPage: (count: number) => void,
): Promise<RawFeature[]> {
  const all: RawFeature[] = []
  for (let page = 0; ; page++) {
    const response = await fetch(url(page), { signal })
    if (!response.ok) throw Error(`DataBC answered ${response.status}.`)
    const body = (await response.json()) as { features?: unknown; error?: { message?: string } }
    if (body.error) throw Error(`DataBC: ${body.error.message ?? 'the query was refused'}.`)
    if (!Array.isArray(body.features)) throw Error('DataBC returned no feature collection.')
    for (const f of body.features as RawFeature[])
      all.push({ id: f.id, geometry: f.geometry, properties: f.properties ?? {} })
    onPage(all.length)
    if (all.length > MAX_BASELINE_RECORDS)
      throw Error(
        `More than ${MAX_BASELINE_RECORDS.toLocaleString()} records in the unit’s box. Use a smaller unit or a later first year.`,
      )
    if (body.features.length < pageSize) return all
  }
}

/** The unit grown by `metres` in BC Albers, back in WGS84. */
export function grownUnit(unit: Shape, metres: number): Shape {
  if (!(metres > 0)) return unit
  const polygons: Position[][][] = unit.type === 'Polygon' ? [unit.coordinates] : unit.coordinates
  const albers = reader.read({
    type: 'MultiPolygon',
    coordinates: polygons.map((p) => p.map((r) => r.map(([x, y]) => lngLatToAlbers(x, y)))),
  })
  const grown = writer.write(BufferOp.bufferOp(albers, metres)) as { type: string; coordinates: unknown }
  const parts = (grown.type === 'Polygon' ? [grown.coordinates] : grown.coordinates) as Position[][][]
  return {
    type: 'MultiPolygon',
    coordinates: parts.map((p) => p.map((r) => r.map(([x, y]) => albersToLngLat(x, y)))),
  }
}

/** The smallest page the cutblock reader shrinks to before it gives up on an empty, truncated answer. */
const MIN_CUTBLOCK_PAGE = 25
/** Statuses a gateway answers when the service behind it took too long: the page is asked again, halved. */
const GATEWAY_GAVE_UP = [502, 504]

/**
 * Every cutblock in a box, by OBJECTID, until the service answers a page that is neither full nor
 * flagged. An empty flagged page, or a gateway timeout, is asked again at half the size.
 */
export async function readCutblockPages(
  fetch: Fetch,
  bounds: [number, number, number, number],
  fromYear: number,
  signal: AbortSignal | undefined,
  onPage: (count: number) => void,
): Promise<RawFeature[]> {
  const all: RawFeature[] = []
  let afterId = -1
  let count = CUTBLOCK_PAGE_SIZE
  for (;;) {
    const response = await fetch(cutblockPageUrl(bounds, fromYear, afterId, count), { signal })
    // A gateway gives up on a page the service takes over two minutes to answer (502 on Prince George
    // Moist Interior - Mountain, 24 November 2026); the same records in two halves come back.
    if (GATEWAY_GAVE_UP.includes(response.status) && count > MIN_CUTBLOCK_PAGE) {
      count = Math.max(MIN_CUTBLOCK_PAGE, Math.floor(count / 2))
      continue
    }
    if (!response.ok) throw Error(`DataBC answered ${response.status}.`)
    const body = (await response.json()) as {
      features?: unknown
      error?: { message?: string }
      exceededTransferLimit?: boolean
      properties?: { exceededTransferLimit?: boolean }
    }
    if (body.error) throw Error(`DataBC: ${body.error.message ?? 'the query was refused'}.`)
    if (!Array.isArray(body.features)) throw Error('DataBC returned no feature collection.')
    const more = body.exceededTransferLimit === true || body.properties?.exceededTransferLimit === true
    const rows = (body.features as RawFeature[]).map((f) => ({
      id: f.id,
      geometry: f.geometry,
      properties: f.properties ?? {},
    }))
    if (!rows.length) {
      if (!more) return all
      if (count <= MIN_CUTBLOCK_PAGE)
        throw Error('DataBC kept answering an empty page while saying more records remain.')
      count = Math.max(MIN_CUTBLOCK_PAGE, Math.floor(count / 2))
      continue
    }
    all.push(...rows)
    onPage(all.length)
    if (all.length > MAX_BASELINE_RECORDS)
      throw Error(
        `More than ${MAX_BASELINE_RECORDS.toLocaleString()} records in the unit’s box. Use a smaller unit or a later first year.`,
      )
    const ids = rows.map((r) => Number(r.properties.OBJECTID))
    if (ids.some((id) => !Number.isFinite(id))) throw Error('A cutblock came back without its OBJECTID.')
    afterId = Math.max(...ids)
    if (!more && rows.length < count) return all
  }
}

/** The part of a polygon inside the unit, or null. Invalid source rings are repaired by a zero buffer. */
function clip(geometry: unknown, unit: Geometry): Shape | null {
  if (!geometry || typeof geometry !== 'object') return null
  const type = (geometry as { type?: string }).type
  if (type !== 'Polygon' && type !== 'MultiPolygon') return null
  let shape: Geometry = reader.read(geometry)
  if (!IsValidOp.isValid(shape)) shape = BufferOp.bufferOp(shape, 0)
  if (!shape.getEnvelopeInternal().intersects(unit.getEnvelopeInternal())) return null
  const inside = OverlayOp.intersection(shape, unit)
  if (inside.isEmpty() || !(inside.getArea() > 0)) return null
  const out = writer.write(inside) as { type: string; coordinates: unknown; geometries?: unknown[] }
  if (out.type === 'Polygon' || out.type === 'MultiPolygon') return out as unknown as Polygon | MultiPolygon
  // A clip can leave lines and points beside the area: keep the polygons.
  const polygons: Position[][][] = []
  for (const part of out.geometries ?? []) {
    const p = part as { type: string; coordinates: unknown }
    if (p.type === 'Polygon') polygons.push(p.coordinates as Position[][])
    if (p.type === 'MultiPolygon') polygons.push(...(p.coordinates as Position[][][]))
  }
  return polygons.length ? { type: 'MultiPolygon', coordinates: polygons } : null
}

/**
 * Reads the chosen sources for a unit. `fromYear` is the earliest year whose young forest is asked
 * about less 20: the planner passes the projection's first year, or 2015 to check the Board's figures.
 */
export async function readBaseline({
  unit,
  sources,
  earliestYear,
  fetch,
  signal,
  onProgress,
  readOn,
  marginMetres = 0,
}: {
  unit: Shape
  /** Read and keep disturbances this far past the unit (`BASELINE_MARGIN_METRES` for whole patches). */
  marginMetres?: number
  sources: BaselineSource[]
  earliestYear: number
  fetch: Fetch
  signal?: AbortSignal
  onProgress?: (message: string) => void
  readOn: string
}): Promise<BaselineRead> {
  if (!IsValidOp.isValid(reader.read(unit)))
    throw Error('The unit boundary is not a valid polygon. Repair it in GIS first.')
  const reach = grownUnit(unit, marginMetres)
  const unitGeometry: Geometry = reader.read(reach)
  const fromYear = Math.max(YEAR_RANGE[0], earliestYear - YOUNG_WINDOW_YEARS)
  const counts = {
    cutblocks: { read: 0, kept: 0, outside: 0, noYear: 0 },
    fires: { read: 0, kept: 0, outside: 0, noYear: 0 },
  }
  const disturbances: Omit<Disturbance, 'id'>[] = []
  const boxes = readBoxes(reach)
  /** Every box's pages, each record once: neighbouring boxes return the records on their shared edge. */
  async function readBoxesOnce(
    list: [number, number, number, number][],
    readBox: (box: [number, number, number, number], onPage: (count: number) => void) => Promise<RawFeature[]>,
    keyOf: (f: RawFeature) => string,
    label: string,
  ) {
    const seen = new Map<string, RawFeature>()
    for (const [i, box] of list.entries()) {
      const rows = await readBox(box, (n) =>
        onProgress?.(`Read ${(seen.size + n).toLocaleString()} ${label} (area ${i + 1} of ${list.length})…`),
      )
      for (const row of rows) seen.set(keyOf(row), row)
      if (seen.size > MAX_BASELINE_RECORDS)
        throw Error(
          `More than ${MAX_BASELINE_RECORDS.toLocaleString()} ${label} in the unit. Use a smaller unit or a later first year.`,
        )
    }
    return [...seen.values()]
  }
  if (sources.includes('cutblocks')) {
    const rows = await readBoxesOnce(
      boxes,
      (box, onPage) => readCutblockPages(fetch, box, fromYear, signal, onPage),
      (f) => String(f.properties.VCCB_SYSID ?? f.properties.OBJECTID),
      'cutblocks',
    )
    counts.cutblocks.read = rows.length
    rows.forEach((row, i) => {
      if (i % 200 === 0)
        onProgress?.(`Clipping cutblocks to the unit… ${i.toLocaleString()} of ${rows.length.toLocaleString()}`)
      let evidence
      try {
        evidence = bcHarvestEvidence(row.properties)
      } catch {
        counts.cutblocks.noYear++
        return
      }
      const year = evidence.startYear ?? evidence.midYear
      if (year === undefined || year < YEAR_RANGE[0] || year > YEAR_RANGE[1]) {
        counts.cutblocks.noYear++
        return
      }
      const geometry = clip(row.geometry, unitGeometry)
      if (!geometry) {
        counts.cutblocks.outside++
        return
      }
      counts.cutblocks.kept++
      disturbances.push({
        name: `Cutblock ${evidence.openingId ? `opening ${evidence.openingId}` : evidence.sourceId} · ${year}`,
        kind: 'harvest',
        year,
        yearBasis: 'source-attribute',
        source: `${BASELINE_SOURCE_LABELS.cutblocks}, record ${evidence.sourceId}${evidence.dataSource ? ` (${evidence.dataSource})` : ''}, read ${readOn}`,
        geometry,
      })
    })
  }
  if (sources.includes('fires')) {
    const rows = await readBoxesOnce(
      boxes,
      (box, onPage) => readPages(fetch, (p) => firePageUrl(box, fromYear, p), FIRE_PAGE_SIZE, signal, onPage),
      (f) => String(f.id ?? `${f.properties.FIRE_NUMBER}-${f.properties.FIRE_YEAR}`),
      'fire perimeters',
    )
    counts.fires.read = rows.length
    for (const row of rows) {
      const year = Number(row.properties.FIRE_YEAR)
      if (!Number.isInteger(year) || year < YEAR_RANGE[0] || year > YEAR_RANGE[1]) {
        counts.fires.noYear++
        continue
      }
      const geometry = clip(row.geometry, unitGeometry)
      if (!geometry) {
        counts.fires.outside++
        continue
      }
      counts.fires.kept++
      const number = String(row.properties.FIRE_NUMBER ?? '').trim()
      disturbances.push({
        name: `Fire ${number || 'unnamed'} · ${year}`,
        kind: 'fire',
        year,
        yearBasis: 'source-attribute',
        source: `${BASELINE_SOURCE_LABELS.fires}${number ? `, fire ${number}` : ''}, read ${readOn}`,
        geometry,
      })
    }
  }
  return { disturbances, counts, fromYear, readOn, marginMetres }
}

/** True for a baseline entry this import wrote, so reading again replaces rather than duplicates it. */
export const fromSource = (d: Pick<Disturbance, 'source'>, source: BaselineSource) =>
  !!d.source?.startsWith(BASELINE_SOURCE_LABELS[source])
