/**
 * A block's net footprint, as the VIA sheets print it: the FTEN polygon is gross and includes its
 * reserves, and the net block is FTEN minus its RESULTS group reserves (`SILV_RESERVE_CODE = 'G'`;
 * dispersed `D` retention covers the whole block and stays in). In the November 2026 accuracy study
 * this reproduced one VIA's printed net block areas to 0.1 ha (docs/forestry-visual-quality.md,
 * "Evidence for the defaults").
 *
 * Reserves are read live from DataBC's WFS and offered to the reviewer, who adds them as `retained`
 * masks: green, uncleared and never altered, so no engine change is needed. FTEN's planned net area
 * is read beside them for comparison. Bounding boxes go in `CQL_FILTER`, longitude first, and
 * `propertyName` stays narrow. `fetch` is passed in; no DOM or network access of its own.
 */
import clipping from 'polygon-clipping'
import { polygonAreaMeters, polygonBounds, type PolygonGeometry } from './visibility'

export const DATABC_WFS = 'https://openmaps.gov.bc.ca/geo/pub/wfs'
const RESERVES = 'WHSE_FOREST_VEGETATION.RSLT_FOREST_COVER_RESERVE_SVW'
const FTEN_BLOCKS = 'WHSE_FOREST_TENURE.FTEN_CUT_BLOCK_POLY_SVW'
/** Most features one read returns. */
export const MAX_RESERVE_FEATURES = 200

export type GroupReserve = {
  id: string
  openingId: string | null
  /** Why it was left: WTR (wildlife tree retention), VIS (visual), BIO, RIP, … */
  objective: string | null
  geometry: PolygonGeometry
  areaHectares: number
}

export type FtenBlock = {
  cutBlockId: string | null
  plannedNetHectares: number | null
  plannedGrossHectares: number | null
  geometry: PolygonGeometry
}

type Geom = Parameters<typeof clipping.intersection>[0]
const asMulti = (geometry: PolygonGeometry) =>
  (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates) as unknown as Geom

/** Area shared by two polygons, m²; 0 when clipping fails on a degenerate shape. */
export function overlapAreaMeters(a: PolygonGeometry, b: PolygonGeometry): number {
  try {
    const parts = clipping.intersection(asMulti(a), asMulti(b))
    return parts.length ? polygonAreaMeters({ type: 'MultiPolygon', coordinates: parts as GeoJSON.Position[][][] }) : 0
  } catch {
    return 0
  }
}

const text = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' ? String(value) : null
const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

function wfsUrl(typeName: string, properties: string[], filter: string, bounds: [number, number, number, number]) {
  const [w, s, e, n] = bounds.map((value) => Number(value.toFixed(6)))
  return `${DATABC_WFS}?${new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: typeName,
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    count: String(MAX_RESERVE_FEATURES),
    propertyName: [...properties, 'GEOMETRY'].join(','),
    CQL_FILTER: `${filter ? `${filter} AND ` : ''}BBOX(GEOMETRY,${w},${s},${e},${n},'EPSG:4326')`,
  }).toString()}`
}

export const groupReserveQueryUrl = (bounds: [number, number, number, number]) =>
  wfsUrl(RESERVES, ['OPENING_ID', 'SILV_RESERVE_CODE', 'SILV_RESERVE_OBJECTIVE_CODE'], "SILV_RESERVE_CODE='G'", bounds)

export const ftenBlockQueryUrl = (bounds: [number, number, number, number]) =>
  wfsUrl(FTEN_BLOCKS, ['CUT_BLOCK_ID', 'PLANNED_NET_BLOCK_AREA', 'PLANNED_GROSS_BLOCK_AREA'], '', bounds)

function features(payload: unknown) {
  const list = (payload as { features?: unknown })?.features
  return Array.isArray(list)
    ? list.flatMap((entry, index) => {
        const feature = entry as { id?: unknown; geometry?: PolygonGeometry; properties?: Record<string, unknown> }
        const geometry = feature.geometry
        return geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon'
          ? [{ index, id: feature.id, geometry, properties: feature.properties ?? {} }]
          : []
      })
    : []
}

/** Group reserves only: a dispersed reserve is never subtracted, even if a reply carries one. */
export function parseGroupReserves(payload: unknown): GroupReserve[] {
  return features(payload).flatMap(({ index, id, geometry, properties }) =>
    text(properties.SILV_RESERVE_CODE)?.toUpperCase() === 'G'
      ? [
          {
            id: text(id) ?? `reserve-${index}`,
            openingId: text(properties.OPENING_ID),
            objective: text(properties.SILV_RESERVE_OBJECTIVE_CODE),
            geometry,
            areaHectares: polygonAreaMeters(geometry) / 10_000,
          },
        ]
      : [],
  )
}

export function parseFtenBlocks(payload: unknown): FtenBlock[] {
  return features(payload).map(({ geometry, properties }) => ({
    cutBlockId: text(properties.CUT_BLOCK_ID),
    plannedNetHectares: number(properties.PLANNED_NET_BLOCK_AREA),
    plannedGrossHectares: number(properties.PLANNED_GROSS_BLOCK_AREA),
    geometry,
  }))
}

/** One block's footprint three ways, and the reserves that make the net one. */
export type BlockFootprint = {
  grossHectares: number
  /** FTEN's planned net area of the FTEN block that best overlaps this one; null when none does. */
  plannedNetHectares: number | null
  ftenCutBlockId: string | null
  /** Gross minus the group reserves inside it. */
  netOfReservesHectares: number
  /** Reserves overlapping the block by at least 10 % of their own area. */
  reserves: GroupReserve[]
}

export function blockFootprint(
  block: PolygonGeometry,
  reserves: readonly GroupReserve[],
  ftenBlocks: readonly FtenBlock[],
): BlockFootprint {
  const gross = polygonAreaMeters(block)
  const inside = reserves
    .map((reserve) => ({ reserve, shared: overlapAreaMeters(block, reserve.geometry) }))
    .filter(({ reserve, shared }) => shared >= 0.1 * reserve.areaHectares * 10_000 && shared > 0)
  const reserved = inside.reduce((sum, { shared }) => sum + shared, 0)
  const best = ftenBlocks
    .map((ften) => ({ ften, shared: overlapAreaMeters(block, ften.geometry) }))
    .filter(({ shared }) => shared > 0.5 * gross)
    .sort((a, b) => b.shared - a.shared)[0]
  return {
    grossHectares: gross / 10_000,
    plannedNetHectares: best?.ften.plannedNetHectares ?? null,
    ftenCutBlockId: best?.ften.cutBlockId ?? null,
    netOfReservesHectares: Math.max(0, gross - reserved) / 10_000,
    reserves: inside.map(({ reserve }) => reserve),
  }
}

/** The mask name and source a reserve is added under. */
export function reserveMaskFields(reserve: GroupReserve): { name: string; source: string } {
  return {
    name: `Group reserve${reserve.objective ? ` (${reserve.objective})` : ''}${reserve.openingId ? `, opening ${reserve.openingId}` : ''}`,
    source: `RESULTS forest cover reserve (DataBC WFS), group reserve ${reserve.id}; added by the reviewer`,
  }
}

/** Reads the group reserves and FTEN blocks round `blocks`. A refused or failed read is an error. */
export async function fetchBlockFootprints(
  blocks: readonly PolygonGeometry[],
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<{ reserves: GroupReserve[]; ftenBlocks: FtenBlock[] }> {
  const boxes = blocks.map((block) => polygonBounds(block))
  const bounds: [number, number, number, number] = [
    Math.min(...boxes.map((b) => b[0])) - 0.002,
    Math.min(...boxes.map((b) => b[1])) - 0.002,
    Math.max(...boxes.map((b) => b[2])) + 0.002,
    Math.max(...boxes.map((b) => b[3])) + 0.002,
  ]
  const read = async (url: string, what: string) => {
    const response = await fetcher(url, { signal })
    if (!response.ok) throw new Error(`DataBC answered ${response.status} for ${what}. Try again.`)
    const payload: unknown = await response.json()
    if ((payload as { exceptions?: unknown })?.exceptions) throw new Error(`DataBC refused the ${what} query.`)
    return payload
  }
  const [reserves, ften] = await Promise.all([
    read(groupReserveQueryUrl(bounds), 'RESULTS reserves'),
    read(ftenBlockQueryUrl(bounds), 'FTEN cut blocks'),
  ])
  return { reserves: parseGroupReserves(reserves), ftenBlocks: parseFtenBlocks(ften) }
}
