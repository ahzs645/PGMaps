/**
 * DataBC WFS reads shared by the planner's live reads (old forest, mapped grazing evidence): pages
 * of GeoJSON by POST, and reads that follow a shape's own polygons (`INTERSECTS` with each part's
 * outer ring), never its bounding box. Records are kept once by their id across parts.
 *
 * DOM- and network-free: `fetch` is passed in. Geometry comes back as WGS84 longitude, latitude.
 */
import type { Geometry as GeoJsonGeometry, Position } from 'geojson'
import { ORDER_UNITS_WFS } from './orderUnits'
import type { Shape } from './plan'

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
    const response = await fetch(ORDER_UNITS_WFS, {
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
export async function readAcrossParts(
  shape: Shape,
  read: (filter: string, seen: number) => Promise<RawFeature[]>,
  geometryField: string,
  keyOf: (f: RawFeature) => string,
): Promise<RawFeature[]> {
  const kept = new Map<string, RawFeature>()
  for (const poly of shapeParts(shape))
    for (const f of await read(ringFilter(geometryField, poly[0]), kept.size)) kept.set(keyOf(f), f)
  return [...kept.values()]
}
