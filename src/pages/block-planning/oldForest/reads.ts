/**
 * What Objectives A and B are calculated from, read live from DataBC's WFS for one old forest unit:
 * the unit's own polygons (Map 2, `RMP_PLAN_LEGAL_POLY_SVW`), the VRI rank-1 stands that touch them,
 * OGMAs and parks (section D.1), and the primary linear corridors the 2005 interior method buffers
 * (FSRs, railways, transmission lines).
 *
 * Each read follows the unit's own shapes (`INTERSECTS` with each part's outer ring, sent by POST),
 * never its bounding box: A10's 22 polygons are scattered, and its box holds 153,680 VRI polygons
 * against 6,333 that touch the unit. Records are kept once by their id across parts.
 *
 * DOM- and network-free: `fetch` is passed in. Geometry comes back as WGS84 longitude, latitude.
 */
import type { LineString, MultiLineString, MultiPolygon, Polygon } from 'geojson'
import { ORDER_PLAN_NAME, ORDER_UNITS_LAYER } from '../orderUnits'
import type { Shape } from '../plan'
import { quote, readAcrossParts, wfsPages, type Fetch, type RawFeature } from '../wfsReads'
import { DISTRICT_ORG_CODES } from './units'

export const VRI_LAYER = 'pub:WHSE_FOREST_VEGETATION.VEG_COMP_LYR_R1_POLY'
export const OGMA_LEGAL_LAYER = 'pub:WHSE_LAND_USE_PLANNING.RMP_OGMA_LEGAL_CURRENT_SVW'
export const OGMA_NON_LEGAL_LAYER = 'pub:WHSE_LAND_USE_PLANNING.RMP_OGMA_NON_LEGAL_CURRENT_SVW'
export const PARK_LAYER = 'pub:WHSE_TANTALIS.TA_PARK_ECORES_PA_SVW'
export const ROAD_SECTION_LAYER = 'pub:WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW'
export const RAILWAY_LAYER = 'pub:WHSE_BASEMAPPING.GBA_RAILWAY_TRACKS_SP'
export const TRANSMISSION_LAYER = 'pub:WHSE_BASEMAPPING.GBA_TRANSMISSION_LINES_SP'

export const VRI_FIELDS = [
  'FEATURE_ID',
  'PROJ_AGE_1',
  'PROJECTED_DATE',
  'HARVEST_DATE',
  'BCLCS_LEVEL_2',
  'FOR_MGMT_LAND_BASE_IND',
  'SPECIES_CD_1',
] as const

/** Past this many stands the read stops and says so: a unit that large needs a prepared table. */
export const MAX_STANDS = 30_000

export { ringFilter, type Fetch } from '../wfsReads'

export interface Map2Unit {
  geometry: Shape
  polygons: number
  /** The layer's own `OLD_RETEN` (a fraction), when every polygon agrees; null otherwise. */
  gisFraction: number | null
  becLabels: string[]
  source: string
}

const MAP2_PAIRS: [number, string][] = [
  [1, 'BECLABEL'],
  [3, 'ORG_CODE'],
  [5, 'UNIT_IDENT'],
  [7, 'OLD_RETEN'],
]

/** The unit's polygons from the order's Map 2 layer, joined. The attribute pairs are checked by name. */
export async function readMap2Unit({
  district,
  unit,
  fetch,
  signal,
  readOn,
  union,
}: {
  district: string
  unit: string
  fetch: Fetch
  signal?: AbortSignal
  readOn: string
  /** Joins the polygons (JSTS lives with the calculation, not here). */
  union: (shapes: Shape[]) => Shape
}): Promise<Map2Unit> {
  const code = DISTRICT_ORG_CODES[district]
  if (!code) throw Error(`${district} is not one of the order’s districts.`)
  const features = await wfsPages({
    fetch,
    signal,
    layer: ORDER_UNITS_LAYER,
    filter: `STRGC_LAND_RSRCE_PLAN_NAME = ${quote(ORDER_PLAN_NAME)} AND LEGAL_FEAT_ATRB_3_VALUE = ${quote(code)} AND LEGAL_FEAT_ATRB_5_VALUE = ${quote(unit)}`,
    sortBy: 'OBJECTID',
    cap: 5000,
  })
  if (!features.length) throw Error(`DataBC holds no Map 2 polygons for ${unit} in ${district}.`)
  const fractions = new Set<number>()
  const labels = new Set<string>()
  const shapes: Shape[] = []
  for (const f of features) {
    for (const [n, field] of MAP2_PAIRS)
      if (f.properties[`LEGAL_FEAT_ATRB_${n}_NAME`] !== field)
        throw Error(`The order layer's attribute ${n} is no longer ${field}; the unit cannot be read safely.`)
    const fraction = Number(f.properties.LEGAL_FEAT_ATRB_7_VALUE)
    if (Number.isFinite(fraction)) fractions.add(fraction)
    const label = f.properties.LEGAL_FEAT_ATRB_1_VALUE
    if (typeof label === 'string' && label.trim()) labels.add(label.trim())
    if (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon') shapes.push(f.geometry)
  }
  return {
    geometry: union(shapes),
    polygons: features.length,
    gisFraction: fractions.size === 1 ? [...fractions][0] : null,
    becLabels: [...labels].sort(),
    source: `Order Map 2, ${district} · ${unit} (DataBC legal planning objectives, ${features.length} polygons), read ${readOn}`,
  }
}

/** A VRI rank-1 stand as the calculation needs it. Geometry is the stand's whole polygon. */
export interface Stand {
  id: string
  projectedAge: number | null
  projectedYear: number | null
  harvestYear: number | null
  treed: boolean
  forestLandBase: boolean
  leading: string | null
  geometry: Polygon | MultiPolygon
}

const yearOf = (v: unknown) => {
  const m = typeof v === 'string' ? /^(\d{4})/.exec(v) : null
  return m ? Number(m[1]) : null
}

export function standFromVri(f: RawFeature): Stand | null {
  const g = f.geometry
  if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return null
  const p = f.properties
  const age = Number(p.PROJ_AGE_1)
  return {
    id: String(p.FEATURE_ID ?? f.id),
    projectedAge: p.PROJ_AGE_1 == null || !Number.isFinite(age) ? null : age,
    projectedYear: yearOf(p.PROJECTED_DATE),
    harvestYear: yearOf(p.HARVEST_DATE),
    treed: p.BCLCS_LEVEL_2 === 'T',
    forestLandBase: p.FOR_MGMT_LAND_BASE_IND === 'Y',
    leading: typeof p.SPECIES_CD_1 === 'string' && p.SPECIES_CD_1.trim() ? p.SPECIES_CD_1.trim().toUpperCase() : null,
    geometry: g,
  }
}

export async function readStands({
  unit,
  fetch,
  signal,
  onProgress,
}: {
  unit: Shape
  fetch: Fetch
  signal?: AbortSignal
  onProgress?: (message: string) => void
}): Promise<Stand[]> {
  const rows = await readAcrossParts(
    unit,
    (filter, seen) =>
      wfsPages({
        fetch,
        signal,
        layer: VRI_LAYER,
        filter,
        propertyName: [...VRI_FIELDS, 'GEOMETRY'].join(','),
        sortBy: 'FEATURE_ID',
        cap: MAX_STANDS,
        onPage: (n) => onProgress?.(`Read ${(seen + n).toLocaleString()} VRI stands…`),
      }),
    'GEOMETRY',
    (f) => String(f.properties.FEATURE_ID ?? f.id),
  )
  if (rows.length > MAX_STANDS)
    throw Error(`More than ${MAX_STANDS.toLocaleString()} VRI stands in this unit; it needs a prepared table.`)
  return rows.map(standFromVri).filter((s): s is Stand => s !== null)
}

/** An area section D.1 counts toward A and B, whatever its age. */
export interface CountedArea {
  kind: 'ogma-legal' | 'ogma-non-legal' | 'park' | 'retention'
  id: string
  name: string
  /** When it was made: legalised, decided or established. */
  date: string | null
  geometry: Polygon | MultiPolygon
}

export async function readCountedAreas({
  unit,
  fetch,
  signal,
}: {
  unit: Shape
  fetch: Fetch
  signal?: AbortSignal
}): Promise<CountedArea[]> {
  const read = async (
    kind: CountedArea['kind'],
    layer: string,
    geometryField: string,
    id: string,
    name: (p: Record<string, unknown>) => string,
    date: string,
  ) => {
    const rows = await readAcrossParts(
      unit,
      (filter) => wfsPages({ fetch, signal, layer, filter, sortBy: 'OBJECTID', cap: 5000 }),
      geometryField,
      (f) => String(f.properties[id] ?? f.id),
    )
    return rows.flatMap((f): CountedArea[] =>
      f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon'
        ? [
            {
              kind,
              id: String(f.properties[id] ?? f.id),
              name: name(f.properties),
              date: typeof f.properties[date] === 'string' ? (f.properties[date] as string).slice(0, 10) : null,
              geometry: f.geometry,
            },
          ]
        : [],
    )
  }
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '')
  return [
    ...(await read(
      'ogma-legal',
      OGMA_LEGAL_LAYER,
      'GEOMETRY',
      'LEGAL_OGMA_PROVID',
      (p) => `Legal OGMA ${text(p.LEGAL_OGMA_PROVID)}`,
      'LEGALIZATION_FRPA_DATE',
    )),
    ...(await read(
      'ogma-non-legal',
      OGMA_NON_LEGAL_LAYER,
      'GEOMETRY',
      'NON_LEGAL_OGMA_PROVID',
      (p) => `Non-legal OGMA ${text(p.NON_LEGAL_OGMA_PROVID)}`,
      'ORIGINAL_DECISION_DATE',
    )),
    ...(await read(
      'park',
      PARK_LAYER,
      'SHAPE',
      'ADMIN_AREA_SID',
      (p) => text(p.PROTECTED_LANDS_NAME) || 'Park or protected area',
      'ESTABLISHMENT_DATE',
    )),
  ]
}

export interface Corridor {
  kind: 'fsr' | 'railway' | 'transmission'
  geometry: LineString | MultiLineString
}

export const CORRIDOR_LABELS: Record<Corridor['kind'], string> = {
  fsr: 'Forest service roads',
  railway: 'Railways',
  transmission: 'Transmission lines',
}

/**
 * The primary linear features the 2005 method buffers by 200 m. Pipelines are not read: no layer of
 * pipeline rights-of-way was checked for this unit's coverage, and the guide says so.
 */
export async function readCorridors({
  unit,
  fetch,
  signal,
}: {
  unit: Shape
  fetch: Fetch
  signal?: AbortSignal
}): Promise<Corridor[]> {
  const read = async (kind: Corridor['kind'], layer: string, geometryField: string, extra: string, key: string) =>
    (
      await readAcrossParts(
        unit,
        (filter) =>
          wfsPages({
            fetch,
            signal,
            layer,
            filter: extra ? `${filter} AND ${extra}` : filter,
            sortBy: 'OBJECTID',
            cap: 20_000,
          }),
        geometryField,
        (f) => String(f.properties[key] ?? f.id),
      )
    ).flatMap((f): Corridor[] =>
      f.geometry?.type === 'LineString' || f.geometry?.type === 'MultiLineString'
        ? [{ kind, geometry: f.geometry }]
        : [],
    )
  return [
    ...(await read('fsr', ROAD_SECTION_LAYER, 'GEOMETRY', "FILE_TYPE_DESCRIPTION = 'Forest Service Road'", 'OBJECTID')),
    ...(await read('railway', RAILWAY_LAYER, 'SHAPE', '', 'OBJECTID')),
    ...(await read('transmission', TRANSMISSION_LAYER, 'SHAPE', '', 'OBJECTID')),
  ]
}
