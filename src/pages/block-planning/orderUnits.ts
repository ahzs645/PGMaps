/**
 * The 2004 order's own unit polygons, read from DataBC's legal planning objectives layer
 * (`RMP_PLAN_LEGAL_POLY_SVW`, plan "Prince George Timber Supply Area (TSA) Legal Order - Landscape
 * Biodiversity Objective Order - Extent", legalised 2004-10-20). Each polygon names its natural
 * disturbance unit (`NDZ_NAME`), sub-unit (`NDZ_SUB`) and historic district (`ORG_CODE`) in
 * numbered name/value pairs; a reporting unit for Objective C is the union of the polygons that
 * share those three. The pairs' names are checked on every polygon, never assumed by position.
 *
 * DOM- and network-free: `fetch` is passed in. The answer is WGS84 longitude, latitude.
 */
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js'
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js'
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js'
import type Geometry from 'jsts/org/locationtech/jts/geom/Geometry.js'
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js'
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js'
import UnaryUnionOp from 'jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js'
import type { MultiPolygon, Polygon } from 'geojson'
import { DATABC_WFS } from '@/lib/forestry/wfsReads'
import type { Shape } from './plan'

export const ORDER_UNITS_WFS = DATABC_WFS
export const ORDER_UNITS_LAYER = 'pub:WHSE_LAND_USE_PLANNING.RMP_PLAN_LEGAL_POLY_SVW'
export const ORDER_PLAN_NAME =
  'Prince George Timber Supply Area (TSA) Legal Order - Landscape Biodiversity Objective Order - Extent'
export const ORDER_UNITS_CATALOGUE = 'https://catalogue.data.gov.bc.ca/dataset/2c02040c-d7c5-4960-8d04-dea01d6d3e9f'

/** The order's historic districts by the code its polygons carry. */
export const DISTRICT_CODES: Record<string, string> = {
  'Fort St. James': 'DJA',
  'Prince George': 'DPG',
  Vanderhoof: 'DVA',
}

/** Table 7's "Moist Interior - Plateau" is NDZ_NAME "Moist Interior" with NDZ_SUB "Plateau". */
export function nduParts(ndu: string): { name: string; sub: string | null } {
  const [name, sub] = ndu.split(' - ')
  return { name: name.trim(), sub: sub?.trim() || null }
}

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`

export function orderUnitUrl(district: string, ndu: string, page: number, pageSize = 1000) {
  const code = DISTRICT_CODES[district]
  if (!code) throw Error(`${district} is not one of the order's historic districts.`)
  const { name, sub } = nduParts(ndu)
  const filter = [
    `STRGC_LAND_RSRCE_PLAN_NAME = ${quote(ORDER_PLAN_NAME)}`,
    `LEGAL_FEAT_ATRB_3_VALUE = ${quote(code)}`,
    `LEGAL_FEAT_ATRB_2_VALUE = ${quote(name)}`,
    sub
      ? `LEGAL_FEAT_ATRB_6_VALUE = ${quote(sub)}`
      : `(LEGAL_FEAT_ATRB_6_VALUE IS NULL OR LEGAL_FEAT_ATRB_6_VALUE = '')`,
  ].join(' AND ')
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: ORDER_UNITS_LAYER,
    outputFormat: 'json',
    srsName: 'EPSG:4326',
    CQL_FILTER: filter,
    sortBy: 'OBJECTID',
    count: String(pageSize),
    startIndex: String(page * pageSize),
  })
  return `${ORDER_UNITS_WFS}?${params.toString()}`
}

type Fetch = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

const EXPECTED_PAIRS: [number, string][] = [
  [2, 'NDZ_NAME'],
  [3, 'ORG_CODE'],
  [6, 'NDZ_SUB'],
]

export interface OrderUnit {
  source: string
  geometry: Shape
  polygons: number
  /** The order's units (UNIT_IDENT, e.g. A14) the sub-unit's polygons belong to, for Objectives A and B. */
  unitIdents: string[]
}

export async function readOrderUnit({
  district,
  ndu,
  fetch,
  signal,
  readOn,
}: {
  district: string
  ndu: string
  fetch: Fetch
  signal?: AbortSignal
  readOn: string
}): Promise<OrderUnit> {
  const factory = new GeometryFactory()
  const reader = new GeoJSONReader(factory)
  const parts: Geometry[] = []
  const idents = new Set<string>()
  const pageSize = 1000
  for (let page = 0; ; page++) {
    const response = await fetch(orderUnitUrl(district, ndu, page, pageSize), { signal })
    if (!response.ok) throw Error(`DataBC answered ${response.status} for the order's units.`)
    const body = (await response.json()) as { features?: { geometry: unknown; properties: Record<string, unknown> }[] }
    if (!Array.isArray(body.features)) throw Error('DataBC returned no feature collection for the order’s units.')
    for (const f of body.features) {
      for (const [n, field] of EXPECTED_PAIRS)
        if (f.properties[`LEGAL_FEAT_ATRB_${n}_NAME`] !== field)
          throw Error(`The order layer's attribute ${n} is no longer ${field}; the unit cannot be read safely.`)
      const ident = f.properties.LEGAL_FEAT_ATRB_5_VALUE
      if (typeof ident === 'string' && ident.trim()) idents.add(ident.trim())
      let g: Geometry = reader.read(f.geometry)
      if (!IsValidOp.isValid(g)) g = BufferOp.bufferOp(g, 0)
      parts.push(g)
    }
    if (body.features.length < pageSize) break
  }
  if (!parts.length) throw Error(`DataBC holds no polygons of the order for ${district} · ${ndu}.`)
  const union = UnaryUnionOp.union(factory.createGeometryCollection(parts))
  const geometry = new GeoJSONWriter().write(union) as Polygon | MultiPolygon
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')
    throw Error('The order’s unit did not form an area.')
  return {
    source: `Order units, ${district} · ${ndu} (DataBC legal planning objectives, ${parts.length} polygons), read ${readOn}`,
    geometry,
    polygons: parts.length,
    unitIdents: [...idents].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
  }
}
