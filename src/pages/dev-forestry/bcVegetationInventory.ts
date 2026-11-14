/**
 * The province's forest inventory, live.
 *
 * VRI rank-1 (`VEG_COMP_LYR_R1_POLY`) is what this page needed for three
 * separate things and could not get from the ArcGIS map service, which publishes
 * only the VRI *Dead* layer:
 *
 * - **The planimetric denominator.** The 1998 procedure applies denudation to
 *   "the total green (forested) portion of the visual landscape, whether the
 *   area is available for harvest or not". BCLCS level 2 is exactly that
 *   distinction: `T` for treed ground, anything else for water, rock, or
 *   clearing. Dividing by a landform's whole area instead makes the figure read
 *   low wherever the landform carries ground that was never forest.
 * - **Screening.** Projected height and crown closure across the whole
 *   landscape rather than RESULTS forest cover's managed openings.
 * - **The drawn stand.** A leading species code everywhere, so the 3D timber is
 *   what the province recorded rather than a regional mix.
 *
 * It comes from DataBC's WFS rather than the ArcGIS REST service. That has one
 * real cost: GeoServer will not generalise geometry server-side, so a landform's
 * worth of polygons is megabytes rather than the tens of kilobytes the
 * generalised ArcGIS queries return. Hence the tight bounds clamp and the
 * feature cap below.
 */

import { coverSourceFromVri, SPARSE_CROWN_CLOSURE_PERCENT, type SceneCoverSource } from './sceneCover'
import { metersPerDegree, polygonBounds, type PolygonGeometry } from './visibility'

export const BC_VEGETATION_WFS = 'https://openmaps.gov.bc.ca/geo/pub/WHSE_FOREST_VEGETATION.VEG_COMP_LYR_R1_POLY/ows'

const TYPE_NAME = 'pub:WHSE_FOREST_VEGETATION.VEG_COMP_LYR_R1_POLY'

/**
 * The layer carries 189 attributes. Asking for the two dozen the page uses is
 * the difference between a query worth running from a browser and one that is
 * not: geometry is most of the payload, and these add about a tenth to it.
 */
const FIELDS = [
  'FEATURE_ID',
  'BCLCS_LEVEL_1',
  'BCLCS_LEVEL_2',
  'BCLCS_LEVEL_3',
  'BCLCS_LEVEL_4',
  'BCLCS_LEVEL_5',
  // The whole recorded composition, not just the lead: around Prince George a
  // stand led by 30% cottonwood is 70% spruce, birch and fir.
  ...[1, 2, 3, 4, 5, 6].flatMap((rank) => [`SPECIES_CD_${rank}`, `SPECIES_PCT_${rank}`]),
  'PROJ_HEIGHT_1',
  'PROJ_HEIGHT_2',
  'CROWN_CLOSURE',
  'VRI_LIVE_STEMS_PER_HA',
  'PROJ_AGE_1',
  'GEOMETRY',
]

/**
 * Widest box worth asking for. Un-generalised VRI runs about 2 MB over a
 * 13 km × 10 km view, so this is a payload limit rather than a service one.
 */
export const MAX_VEGETATION_QUERY_DEGREES = 0.35

/** Cap on features in one answer, so a dense valley cannot return a hundred megabytes. */
export const MAX_VEGETATION_FEATURES = 4000

export type VriStand = {
  featureId: number | null
  /**
   * BCLCS level 2 is `T` on treed ground. This is the "green (forested)"
   * distinction the denudation procedure turns on.
   */
  treed: boolean
  /**
   * BCLCS level 1 `N` with level 2 `L`: non-vegetated land (rock, rubble, exposed soil, ice), not
   * water. What a VIA figure draws as rock or non-vegetated ground. Absent on stands parsed before it.
   */
  nonVegetatedLand?: boolean
  /** BCLCS level 1 `N`: non-vegetated ground of any kind, water and ice included. */
  nonVegetated?: boolean
  /** Leading species as the inventory spells it — `SX`, `PLI`, `BL`, `AT`. */
  speciesCode: string | null
  /**
   * Every species recorded, ranked, with its percentage (`SPECIES_CD_n`,
   * `SPECIES_PCT_n`). Rank 1 and 2 carry their projected heights.
   */
  speciesComposition?: Array<{ code: string; percent: number; heightMeters: number | null }>
  /** BCLCS levels 2–5, which say what non-treed ground is (water, rock, shrub, herb). */
  landCover?: { level2: string | null; level3: string | null; level4: string | null; level5: string | null }
  /** Projected height of the leading species, in metres. */
  heightMeters: number | null
  crownClosurePercent: number | null
  /** Live stems per hectare (`VRI_LIVE_STEMS_PER_HA`); draws the stand at its own density. */
  stemsPerHa?: number | null
  ageYears: number | null
  geometry: PolygonGeometry
}

export type VegetationResult = {
  stands: VriStand[]
  /** True when the cap was hit, so the answer covers only part of the box. */
  truncated: boolean
}

/** Keeps a query box inside what the service and the browser can carry. */
export function clampVegetationBounds(
  bounds: [number, number, number, number],
  maxDegrees = MAX_VEGETATION_QUERY_DEGREES,
): [number, number, number, number] {
  const [minLng, minLat, maxLng, maxLat] = bounds
  // A box that already fits comes back untouched, rather than round-tripped
  // through a centre and a half-width and out the other side as -122.45000001.
  if (Math.abs(maxLng - minLng) <= maxDegrees && Math.abs(maxLat - minLat) <= maxDegrees) return bounds

  const centreLng = (minLng + maxLng) / 2
  const centreLat = (minLat + maxLat) / 2
  const halfLng = Math.min(Math.abs(maxLng - minLng) / 2, maxDegrees / 2)
  const halfLat = Math.min(Math.abs(maxLat - minLat) / 2, maxDegrees / 2)
  // Six decimal places is about 10 cm, and keeps the query string short.
  const round = (value: number) => Number(value.toFixed(6))
  return [
    round(centreLng - halfLng),
    round(centreLat - halfLat),
    round(centreLng + halfLng),
    round(centreLat + halfLat),
  ]
}

/**
 * Ground VRI does not record as closed forest: unclassified, non-treed, or treed with sparse crowns. A scene's ground
 * cover asks only for this (`fetchSceneCover`); over the Sechelt Inlet shore it is a seventh of the polygons and of
 * the bytes (157 of 1,152 polygons, 0.4 of 2.6 MB over 0.15° × 0.1°, November 2026).
 */
const OPEN_GROUND_FILTER = `(BCLCS_LEVEL_2 IS NULL OR BCLCS_LEVEL_2 <> 'T' OR BCLCS_LEVEL_5 = 'SP' OR CROWN_CLOSURE < ${SPARSE_CROWN_CLOSURE_PERCENT})`

/** What ground cover reads: the land cover classes and crown closure, nothing else. */
const OPEN_GROUND_FIELDS = [
  'FEATURE_ID',
  'BCLCS_LEVEL_1',
  'BCLCS_LEVEL_2',
  'BCLCS_LEVEL_3',
  'BCLCS_LEVEL_4',
  'BCLCS_LEVEL_5',
  'CROWN_CLOSURE',
  'GEOMETRY',
]

export type VegetationQueryOptions = {
  /** Ask only for treed polygons, when the answer is a canopy rather than a mask. */
  treedOnly?: boolean
  /** Ask only for ground that is not closed forest, with only its land cover fields (`OPEN_GROUND_FILTER`). */
  openGroundOnly?: boolean
  maxFeatures?: number
}

/**
 * The bounding box goes in the CQL filter rather than the WFS `bbox` parameter.
 * WFS 2.0 with a plain `EPSG:4326` bbox is latitude-first, CQL's `BBOX` is
 * longitude-first, and mixing the two silently returns the wrong part of the
 * province.
 */
export function vegetationQueryUrl(
  bounds: [number, number, number, number],
  { treedOnly = false, openGroundOnly = false, maxFeatures = MAX_VEGETATION_FEATURES }: VegetationQueryOptions = {},
): string {
  const [minLng, minLat, maxLng, maxLat] = clampVegetationBounds(bounds)
  const filters = [`BBOX(GEOMETRY,${minLng},${minLat},${maxLng},${maxLat},'EPSG:4326')`]
  if (treedOnly) filters.push("BCLCS_LEVEL_2='T'")
  if (openGroundOnly) filters.push(OPEN_GROUND_FILTER)

  const parameters = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeName: TYPE_NAME,
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    count: String(maxFeatures),
    propertyName: (openGroundOnly ? OPEN_GROUND_FIELDS : FIELDS).join(','),
    CQL_FILTER: filters.join(' AND '),
  })
  return `${BC_VEGETATION_WFS}?${parameters.toString()}`
}

function finiteNumber(value: unknown): number | null {
  // Not `Number(value)`: VRI leaves every attribute null on ground that carries
  // no stand, and `Number(null)` is 0 — which would report a lake as a
  // zero-height, zero-closure stand rather than as having no stand at all.
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function parseVegetationStands(payload: unknown, maxFeatures = MAX_VEGETATION_FEATURES): VegetationResult {
  const collection = payload as { features?: unknown; numberMatched?: unknown }
  if (!Array.isArray(collection?.features)) return { stands: [], truncated: false }

  const stands = collection.features.flatMap((entry): VriStand[] => {
    const feature = entry as { geometry?: unknown; properties?: Record<string, unknown> }
    const geometry = feature.geometry as PolygonGeometry | undefined
    if (geometry?.type !== 'Polygon' && geometry?.type !== 'MultiPolygon') return []

    const properties = feature.properties ?? {}
    const speciesComposition = [1, 2, 3, 4, 5, 6].flatMap((rank) => {
      const code = trimmed(properties[`SPECIES_CD_${rank}`])
      const percent = finiteNumber(properties[`SPECIES_PCT_${rank}`])
      if (!code || percent === null || percent <= 0) return []
      const height = rank <= 2 ? finiteNumber(properties[`PROJ_HEIGHT_${rank}`]) : null
      return [{ code, percent, heightMeters: height }]
    })
    return [
      {
        featureId: finiteNumber(properties.FEATURE_ID),
        treed: trimmed(properties.BCLCS_LEVEL_2)?.toUpperCase() === 'T',
        nonVegetated: trimmed(properties.BCLCS_LEVEL_1)?.toUpperCase() === 'N',
        nonVegetatedLand:
          trimmed(properties.BCLCS_LEVEL_1)?.toUpperCase() === 'N' &&
          trimmed(properties.BCLCS_LEVEL_2)?.toUpperCase() === 'L',
        speciesCode: trimmed(properties.SPECIES_CD_1),
        heightMeters: finiteNumber(properties.PROJ_HEIGHT_1),
        crownClosurePercent: finiteNumber(properties.CROWN_CLOSURE),
        stemsPerHa: finiteNumber(properties.VRI_LIVE_STEMS_PER_HA),
        ageYears: finiteNumber(properties.PROJ_AGE_1),
        speciesComposition,
        landCover: {
          level2: trimmed(properties.BCLCS_LEVEL_2),
          level3: trimmed(properties.BCLCS_LEVEL_3),
          level4: trimmed(properties.BCLCS_LEVEL_4),
          level5: trimmed(properties.BCLCS_LEVEL_5),
        },
        geometry,
      },
    ]
  })

  // GeoServer reports the full match count even when `count` truncates the answer.
  const matched = finiteNumber(collection.numberMatched)
  return { stands, truncated: stands.length >= maxFeatures || (matched !== null && matched > stands.length) }
}

/** Just the treed ground, which is what the denudation denominator divides by. */
export function forestedGeometries(stands: ReadonlyArray<VriStand>): PolygonGeometry[] {
  return stands.filter((stand) => stand.treed).map((stand) => stand.geometry)
}

/** Non-vegetated ground of any kind (rock, water, ice): what the perspective denominator leaves out. */
export function nonVegetatedGeometries(stands: ReadonlyArray<VriStand>): PolygonGeometry[] {
  return stands.filter((stand) => stand.nonVegetated).map((stand) => stand.geometry)
}

/**
 * Non-vegetated land whose box meets `bounds` ([w, s, e, n]), at most `limit` polygons: the rock
 * a VIA figure draws in and around the landform. Display only; no figure in the run reads it.
 */
export function nonVegetatedNear(
  stands: ReadonlyArray<VriStand>,
  bounds: [number, number, number, number],
  limit = 400,
): PolygonGeometry[] {
  const [w, s, e, n] = bounds
  return stands
    .filter((stand) => {
      if (!stand.nonVegetatedLand) return false
      const b = polygonBounds(stand.geometry)
      return b[0] <= e && b[2] >= w && b[1] <= n && b[3] >= s
    })
    .slice(0, limit)
    .map((stand) => stand.geometry)
}

export async function fetchVegetationStands(
  bounds: [number, number, number, number],
  options: VegetationQueryOptions & { signal?: AbortSignal } = {},
): Promise<VegetationResult> {
  const { signal, ...queryOptions } = options
  const response = await fetch(vegetationQueryUrl(bounds, queryOptions), { signal })
  if (!response.ok) {
    throw new Error(`The BC vegetation inventory answered ${response.status}. Try a smaller view.`)
  }

  const payload: unknown = await response.json()
  // GeoServer reports its own failures inside a 200, the way the ArcGIS service does.
  const exception = (payload as { exceptions?: unknown })?.exceptions
  if (exception) throw new Error('The BC vegetation inventory refused that query.')

  return parseVegetationStands(payload, queryOptions.maxFeatures ?? MAX_VEGETATION_FEATURES)
}

/** Tile edge for a scene's ground cover read, degrees: about 13 km north–south, a few hundred kB of open ground. */
export const SCENE_COVER_TILE_DEGREES = 0.12
/** At most this many tiles in one read: a 15 km radius at 60° N is 3 × 6. */
export const MAX_SCENE_COVER_TILES = 30

/** A box cut into tiles of at most `tileDegrees`, south-west first, centre-out so the nearest ground reads first. */
export function sceneCoverTiles(
  bounds: [number, number, number, number],
  tileDegrees = SCENE_COVER_TILE_DEGREES,
): Array<[number, number, number, number]> {
  const [w, s, e, n] = bounds
  const across = Math.max(1, Math.ceil((e - w) / tileDegrees - 1e-9))
  const down = Math.max(1, Math.ceil((n - s) / tileDegrees - 1e-9))
  const round = (value: number) => Number(value.toFixed(6))
  const tiles: Array<[number, number, number, number]> = []
  for (let j = 0; j < down; j += 1)
    for (let i = 0; i < across; i += 1)
      tiles.push([
        round(w + ((e - w) * i) / across),
        round(s + ((n - s) * j) / down),
        round(w + ((e - w) * (i + 1)) / across),
        round(s + ((n - s) * (j + 1)) / down),
      ])
  const cx = (w + e) / 2
  const cy = (s + n) / 2
  const off = (t: [number, number, number, number]) => Math.hypot((t[0] + t[2]) / 2 - cx, (t[1] + t[3]) / 2 - cy)
  return tiles.sort((a, b) => off(a) - off(b))
}

/**
 * The ground cover under a scene's terrain (`terrain.cover`, `coverOnGrid`): VRI rank-1's open ground (non-treed,
 * unclassified and sparse polygons, `openGroundOnly`) over the square of `radiusMeters` round the eye, in tiles read
 * four at a time. A tile that came back whole is a complete box, where ground with no open polygon is closed forest;
 * a tile that failed or hit the feature cap is not, and its unread ground stays unknown. Never rejects: a failed read
 * is a source with fewer complete boxes and a note saying so.
 */
export async function fetchSceneCover(
  eye: { lng: number; lat: number },
  radiusMeters: number,
  {
    signal,
    fetchImpl = fetch,
    tileDegrees = SCENE_COVER_TILE_DEGREES,
    maxTiles = MAX_SCENE_COVER_TILES,
    timeoutMs = 30_000,
  }: {
    signal?: AbortSignal
    fetchImpl?: typeof fetch
    tileDegrees?: number
    maxTiles?: number
    timeoutMs?: number
  } = {},
): Promise<SceneCoverSource> {
  const scale = metersPerDegree(eye.lat)
  const bounds: [number, number, number, number] = [
    eye.lng - radiusMeters / scale.lng,
    eye.lat - radiusMeters / scale.lat,
    eye.lng + radiusMeters / scale.lng,
    eye.lat + radiusMeters / scale.lat,
  ]
  const tiles = sceneCoverTiles(bounds, tileDegrees)
  const read = tiles.slice(0, maxTiles)
  const stands: VriStand[] = []
  const seen = new Set<number>()
  const complete: Array<[number, number, number, number]> = []
  let failed = 0
  let capped = 0
  let next = 0
  const worker = async () => {
    while (next < read.length) {
      const tile = read[next++]
      const abort = new AbortController()
      const stop = () => abort.abort()
      signal?.addEventListener('abort', stop)
      const timer = setTimeout(stop, timeoutMs)
      try {
        const response = await fetchImpl(vegetationQueryUrl(tile, { openGroundOnly: true }), { signal: abort.signal })
        if (!response.ok) throw new Error(String(response.status))
        const payload: unknown = await response.json()
        if ((payload as { exceptions?: unknown })?.exceptions) throw new Error('refused')
        const result = parseVegetationStands(payload)
        for (const stand of result.stands) {
          if (stand.featureId !== null) {
            if (seen.has(stand.featureId)) continue
            seen.add(stand.featureId)
          }
          stands.push(stand)
        }
        if (result.truncated) capped += 1
        else complete.push(tile)
      } catch {
        failed += 1
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', stop)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, read.length) }, worker))
  const km = (radiusMeters / 1000).toFixed(1)
  const gaps = [
    failed ? `${failed} failed` : '',
    capped ? `${capped} over the ${MAX_VEGETATION_FEATURES}-polygon cap` : '',
    tiles.length > read.length ? `${tiles.length - read.length} past the ${maxTiles}-tile limit` : '',
  ].filter(Boolean)
  const note = gaps.length
    ? `Ground cover: VRI open ground read ${complete.length} of ${tiles.length} tiles within ${km} km (${gaps.join(', ')}); the rest is unknown past the run's own read.`
    : `Ground cover: VRI open ground read within ${km} km of the eye; slope, water and sea past it.`
  return coverSourceFromVri(stands, complete, { note })
}
