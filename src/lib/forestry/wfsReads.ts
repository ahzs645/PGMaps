/**
 * DataBC WFS reads shared by the tools that follow a shape's own polygons: the block planner's live
 * reads (old forest, mapped grazing evidence, *On this ground*) and the visual quality page's land
 * status checks, through the ground catalogue's reader (`src/lib/legal/groundLayerRead.ts`). Pages
 * of GeoJSON by POST, and reads that follow a shape's own polygons (`INTERSECTS` with each part's
 * outer ring), never its bounding box. Records are kept once by their id across parts.
 *
 * DOM- and network-free: `fetch` is passed in. Geometry comes back as WGS84 longitude, latitude.
 */
import type { Geometry as GeoJsonGeometry, MultiPolygon, Polygon, Position } from 'geojson'

/** DataBC's public WFS, read by POST here and by GET elsewhere. */
export const DATABC_WFS = 'https://openmaps.gov.bc.ca/geo/pub/wfs'

/** A footprint: one polygon or several, WGS84. */
export type Shape = Polygon | MultiPolygon

export type Fetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export interface RawFeature {
  id?: string | number
  geometry: GeoJsonGeometry | null
  properties: Record<string, unknown>
}

export const PAGE_SIZE = 1000

export interface WfsQuery {
  fetch: Fetch
  signal?: AbortSignal
  layer: string
  filter: string
  propertyName?: string
  sortBy: string
  cap: number
  onPage?: (count: number) => void
}

/** Every page of a query, up to `cap` records; `truncated` when DataBC holds more. */
export async function wfsRead({
  fetch,
  signal,
  layer,
  filter,
  propertyName,
  sortBy,
  cap,
  onPage,
}: WfsQuery): Promise<{ features: RawFeature[]; truncated: boolean }> {
  const all: RawFeature[] = []
  for (let page = 0; ; page++) {
    const body = new URLSearchParams({
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      typeNames: layer,
      outputFormat: 'json',
      srsName: 'EPSG:4326',
      CQL_FILTER: filter,
      sortBy,
      count: String(PAGE_SIZE),
      startIndex: String(page * PAGE_SIZE),
      ...(propertyName ? { propertyName } : {}),
    })
    const response = await fetch(DATABC_WFS, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal,
    })
    if (!response.ok) throw Error(`DataBC answered ${response.status} for ${layer.replace(/^pub:/, '')}.`)
    const json = (await response.json()) as { features?: RawFeature[] }
    if (!Array.isArray(json.features)) throw Error(`DataBC returned no feature collection for ${layer}.`)
    all.push(...json.features)
    onPage?.(all.length)
    if (all.length > cap) return { features: all.slice(0, cap), truncated: true }
    if (json.features.length < PAGE_SIZE) return { features: all, truncated: false }
  }
}

/** Every page of a query; more than `cap` records stops the read with an error. */
export async function wfsPages(query: WfsQuery): Promise<RawFeature[]> {
  const { features, truncated } = await wfsRead(query)
  if (truncated) throw Error(`More than ${query.cap.toLocaleString()} records; the read stopped.`)
  return features
}

export const quote = (s: string) => `'${s.replace(/'/g, "''")}'`

export const shapeParts = (shape: Shape): Position[][][] =>
  shape.type === 'Polygon' ? [shape.coordinates] : shape.coordinates

/** One outer ring as CQL WKT, rounded to about a metre. Holes are left out: the clip later is exact. */
export function ringFilter(geometryField: string, ring: Position[]) {
  const wkt = ring.map(([x, y]) => `${x.toFixed(5)} ${y.toFixed(5)}`).join(',')
  return `INTERSECTS(${geometryField},SRID=4326;POLYGON((${wkt})))`
}

/** Every record touching any part of the shape, once each by `keyOf`. */
/** The convex hull of a ring (Andrew's monotone chain), closed. It holds the ring, so it asks for more, never less. */
export function hullRing(ring: Position[]): Position[] {
  const pts = [...new Map(ring.map(([x, y]) => [`${x},${y}`, [x, y] as Position])).values()].sort(
    (a, b) => a[0] - b[0] || a[1] - b[1],
  )
  if (pts.length < 3) return ring
  const cross = (o: Position, a: Position, b: Position) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (list: Position[]) => {
    const out: Position[] = []
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop()
      out.push(p)
    }
    return out.slice(0, -1)
  }
  const hull = [...half(pts), ...half([...pts].reverse())]
  return [...hull, hull[0]]
}

/**
 * Every record touching any part of the shape, once each by `keyOf`. `byHull` asks with each part's
 * convex hull instead of its ring: for a layer of a few very detailed polygons (TFLs), where the
 * server times out intersecting a 6,974-vertex part with a 32,214-vertex licence, and the clip later
 * is exact either way.
 */
export async function readAcrossParts(
  shape: Shape,
  read: (filter: string, seen: number) => Promise<RawFeature[]>,
  geometryField: string,
  keyOf: (f: RawFeature) => string,
  byHull = false,
): Promise<RawFeature[]> {
  const kept = new Map<string, RawFeature>()
  for (const poly of shapeParts(shape))
    for (const f of await read(ringFilter(geometryField, byHull ? hullRing(poly[0]) : poly[0]), kept.size))
      kept.set(keyOf(f), f)
  return [...kept.values()]
}

/**
 * Only the listed fields, whatever else DataBC sent. GeoServer sends a layer's required fields
 * whatever `propertyName` asks for: the range tenure layer always carries `CLIENT_NAME`, and RESULTS
 * its `*_WHO_*` user ids. Every reader strips a record to its own fields as it arrives.
 */
export function keepFields(properties: Record<string, unknown> | null | undefined, fields: readonly string[]) {
  const out: Record<string, unknown> = {}
  for (const f of fields) if (properties && properties[f] !== undefined) out[f] = properties[f]
  return out
}
