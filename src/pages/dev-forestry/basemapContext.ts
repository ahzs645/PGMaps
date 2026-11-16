/**
 * What the basemap already knows about the ground around a road, for the
 * eye-level preview: where water is, and what kind of road it is.
 *
 * Compared against a street-level photo on the Hart Highway, the preview had
 * grown timber across a lake and hidden the skyline behind a 20 m roadside
 * clearing that is closer to 40 m on a highway. Both facts are in the vector
 * tiles the map is already drawing, so they cost no extra request. Like the
 * road snap, this reads what is loaded: water beyond the loaded tiles is not
 * known, and the stand is drawn there as before.
 *
 * Free of DOM and network access; the map is a structural type so the
 * collectors can be tested without MapLibre.
 */

import { nearestPointOnLine, type RoadCandidate } from './roadSnap'
import { lineLengthMeters, polygonBounds, type PolygonGeometry } from './visibility'

/** The OpenMapTiles layer holding lakes, rivers and reservoirs as polygons. */
export const WATER_SOURCE_LAYER = 'water'

export type BasemapQueryMap = {
  getStyle: () => { layers?: Array<{ id: string; source?: string; 'source-layer'?: string }> } | undefined
  querySourceFeatures: (sourceId: string, options: { sourceLayer: string }) => Array<GeoJSON.Feature | null | undefined>
}

type Bounds = [west: number, south: number, east: number, north: number]

function intersects(a: Bounds, b: Bounds): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}

/**
 * Water polygons from basemap features, deduplicated. A tile boundary cuts a
 * lake into pieces and neighbouring tiles repeat them; each piece is kept
 * once, which is all a point-in-polygon mask needs.
 */
export function waterFromFeatures(
  features: ReadonlyArray<GeoJSON.Feature | null | undefined>,
  within?: Bounds,
): PolygonGeometry[] {
  const seen = new Set<string>()
  const out: PolygonGeometry[] = []
  for (const feature of features) {
    const geometry = feature?.geometry
    if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) continue
    const bounds = polygonBounds(geometry)
    if (within && !intersects(bounds, within)) continue
    const key = JSON.stringify(geometry.coordinates).slice(0, 400) + bounds.join(',')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(geometry)
  }
  return out
}

/** Every vector source that carries a water layer in the current style. */
export function waterSourceIds(map: BasemapQueryMap): string[] {
  const layers = map.getStyle()?.layers ?? []
  return [
    ...new Set(
      layers
        .filter((layer) => layer['source-layer'] === WATER_SOURCE_LAYER && layer.source)
        .map((layer) => layer.source!),
    ),
  ]
}

export function collectWaterFromMap(map: BasemapQueryMap, within?: Bounds): PolygonGeometry[] {
  return waterSourceIds(map).flatMap((source) =>
    waterFromFeatures(map.querySourceFeatures(source, { sourceLayer: WATER_SOURCE_LAYER }), within),
  )
}

/**
 * The basemap class of the road a corridor follows, or null when no drawn road
 * runs along it. The corridor is sampled at up to 20 points; a road counts when
 * it stays within `toleranceMeters` of them on average, and the closest wins.
 */
export function corridorRoadClass(
  roads: readonly RoadCandidate[],
  corridor: ReadonlyArray<readonly [number, number]>,
  toleranceMeters = 30,
): string | null {
  if (corridor.length < 2) return null
  const samples: Array<{ lng: number; lat: number }> = []
  const count = Math.min(20, Math.max(2, Math.round(lineLengthMeters(corridor as Array<[number, number]>) / 50)))
  for (let i = 0; i < count; i += 1) {
    const at = (i / (count - 1)) * (corridor.length - 1)
    const a = corridor[Math.floor(at)]
    const b = corridor[Math.min(corridor.length - 1, Math.floor(at) + 1)]
    const t = at - Math.floor(at)
    samples.push({ lng: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t })
  }
  let best: { roadClass: string | null; mean: number } | null = null
  for (const road of roads) {
    let sum = 0
    for (const sample of samples) sum += nearestPointOnLine(road.coordinates, sample)?.offsetMeters ?? Infinity
    const mean = sum / samples.length
    if (mean <= toleranceMeters && (!best || mean < best.mean)) best = { roadClass: road.roadClass, mean }
  }
  return best?.roadClass ?? null
}

/**
 * Width of the timber-free strip the preview draws along a road of this class,
 * in metres: the road, its shoulders, ditches and brushed verge. Illustrative
 * right-of-way widths, not a survey; the drive panel lets a reviewer change it,
 * and it never enters the numbers.
 */
export const ROAD_CLEARING_METERS: Record<string, number> = {
  motorway: 60,
  trunk: 40,
  primary: 36,
  secondary: 30,
  tertiary: 24,
  minor: 20,
  road: 20,
  unclassified: 18,
  service: 14,
  track: 12,
}

export const DEFAULT_ROAD_CLEARING_METERS = 20

export function clearingWidthForRoadClass(roadClass: string | null): number {
  return (roadClass && ROAD_CLEARING_METERS[roadClass]) || DEFAULT_ROAD_CLEARING_METERS
}

/**
 * The vector layers that name places, in both schemas the plan's basemap has used. OpenMapTiles: settlements and
 * islands (`place`), lakes, bays and inlets (`water_name`) and summits (`mountain_peak`). The Protomaps schema CARTO's
 * positron now serves: settlements (`places`, `kind` locality with a `kind_detail` of hamlet, village, town or city),
 * lake labels as points (`water`, and `pois` with `kind` water at smaller zooms) and summits (`pois`, `kind` peak).
 * A VIA report places its blocks by them ("6.5 km north of the town").
 */
export const PLACE_SOURCE_LAYERS = ['place', 'water_name', 'mountain_peak', 'places', 'pois', 'water'] as const
export type PlaceSourceLayer = (typeof PLACE_SOURCE_LAYERS)[number]

export type PlaceKind = 'settlement' | 'water' | 'peak' | 'island' | 'other'

/** A named place the basemap labels, at its label point. */
export type PlaceLabel = { name: string; kind: PlaceKind; lngLat: [number, number] }

/** Place classes too large to place a block by (a province, a country). */
const REGION_CLASSES = new Set([
  'continent',
  'country',
  'state',
  'province',
  'county',
  'region',
  'macroregion',
  'macrohood',
])
const SETTLEMENT_CLASSES = new Set([
  'city',
  'town',
  'village',
  'hamlet',
  'suburb',
  'neighbourhood',
  'quarter',
  'locality',
  'isolated_dwelling',
])
/** Protomaps `pois` kinds that name a summit. */
const PEAK_KINDS = new Set(['peak', 'volcano'])

function labelPoint(geometry: GeoJSON.Geometry): [number, number] | null {
  if (geometry.type === 'Point') return [geometry.coordinates[0], geometry.coordinates[1]]
  if (geometry.type === 'MultiPoint' && geometry.coordinates.length)
    return [geometry.coordinates[0][0], geometry.coordinates[0][1]]
  // A water name drawn along a line: its middle vertex.
  const line =
    geometry.type === 'LineString'
      ? geometry.coordinates
      : geometry.type === 'MultiLineString'
        ? geometry.coordinates[0]
        : null
  if (line?.length) {
    const mid = line[Math.floor(line.length / 2)]
    return [mid[0], mid[1]]
  }
  return null
}

/** What a feature of `sourceLayer` names, or null when it names nothing a report places blocks by. */
function placeKind(sourceLayer: PlaceSourceLayer, props: Record<string, unknown>, geometry: GeoJSON.Geometry) {
  const cls = String(props.class ?? '').toLowerCase()
  const kind = String(props.kind ?? '').toLowerCase()
  const detail = String(props.kind_detail ?? '').toLowerCase()
  switch (sourceLayer) {
    case 'water_name':
      return 'water'
    case 'mountain_peak':
      return 'peak'
    case 'place':
      if (REGION_CLASSES.has(cls)) return null
      return SETTLEMENT_CLASSES.has(cls) ? 'settlement' : cls === 'island' || cls === 'islet' ? 'island' : 'other'
    case 'places':
      if (REGION_CLASSES.has(kind) || REGION_CLASSES.has(detail)) return null
      return SETTLEMENT_CLASSES.has(kind) || SETTLEMENT_CLASSES.has(detail)
        ? 'settlement'
        : kind === 'island' || detail === 'island' || detail === 'islet'
          ? 'island'
          : 'other'
    case 'pois':
      return kind === 'water' ? 'water' : PEAK_KINDS.has(kind) ? 'peak' : null
    case 'water':
      // Only the lake labels (points): the layer's polygons are the water itself and its lines are rivers.
      return geometry.type === 'Point' ? 'water' : null
  }
}

/**
 * Named places from one source layer's features, once each by name and kind (tiles repeat a label at their edges).
 * The English name is preferred where the tiles carry one.
 */
export function placesFromFeatures(
  features: ReadonlyArray<GeoJSON.Feature | null | undefined>,
  sourceLayer: PlaceSourceLayer,
): PlaceLabel[] {
  const out = new Map<string, PlaceLabel>()
  for (const feature of features) {
    if (!feature?.geometry) continue
    const props = feature.properties ?? {}
    const name = String(props['name:en'] ?? props.name_en ?? props.name ?? '').trim()
    if (!name) continue
    const kind = placeKind(sourceLayer, props, feature.geometry)
    if (!kind) continue
    const at = labelPoint(feature.geometry)
    if (!at) continue
    const key = `${kind}|${name}`
    if (!out.has(key)) out.set(key, { name, kind, lngLat: at })
  }
  return [...out.values()]
}

/** Every named place the loaded basemap tiles label, from each vector source that carries the place layers. */
export function collectPlacesFromMap(map: BasemapQueryMap): PlaceLabel[] {
  const layers = map.getStyle()?.layers ?? []
  const vectorSources = [
    ...new Set(
      layers
        .filter((layer) => layer.source && layer['source-layer'])
        .filter((layer) =>
          [...PLACE_SOURCE_LAYERS, WATER_SOURCE_LAYER].includes(layer['source-layer'] as PlaceSourceLayer),
        )
        .map((layer) => layer.source!),
    ),
  ]
  const out = new Map<string, PlaceLabel>()
  for (const source of vectorSources)
    for (const sourceLayer of PLACE_SOURCE_LAYERS)
      for (const place of placesFromFeatures(map.querySourceFeatures(source, { sourceLayer }), sourceLayer))
        if (!out.has(`${place.kind}|${place.name}`)) out.set(`${place.kind}|${place.name}`, place)
  return [...out.values()]
}
