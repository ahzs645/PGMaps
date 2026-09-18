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

import type { PolygonGeometry } from './visibility'

export const BC_VEGETATION_WFS = 'https://openmaps.gov.bc.ca/geo/pub/WHSE_FOREST_VEGETATION.VEG_COMP_LYR_R1_POLY/ows'

const TYPE_NAME = 'pub:WHSE_FOREST_VEGETATION.VEG_COMP_LYR_R1_POLY'

/**
 * The layer carries 189 attributes. Asking for seven of them is the difference
 * between a query worth running from a browser and one that is not.
 */
const FIELDS = [
  'FEATURE_ID',
  'BCLCS_LEVEL_1',
  'BCLCS_LEVEL_2',
  'BCLCS_LEVEL_4',
  'SPECIES_CD_1',
  'PROJ_HEIGHT_1',
  'CROWN_CLOSURE',
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
  /** Leading species as the inventory spells it — `SX`, `PLI`, `BL`, `AT`. */
  speciesCode: string | null
  /** Projected height of the leading species, in metres. */
  heightMeters: number | null
  crownClosurePercent: number | null
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

export type VegetationQueryOptions = {
  /** Ask only for treed polygons, when the answer is a canopy rather than a mask. */
  treedOnly?: boolean
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
  { treedOnly = false, maxFeatures = MAX_VEGETATION_FEATURES }: VegetationQueryOptions = {},
): string {
  const [minLng, minLat, maxLng, maxLat] = clampVegetationBounds(bounds)
  const filters = [`BBOX(GEOMETRY,${minLng},${minLat},${maxLng},${maxLat},'EPSG:4326')`]
  if (treedOnly) filters.push("BCLCS_LEVEL_2='T'")

  const parameters = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeName: TYPE_NAME,
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    count: String(maxFeatures),
    propertyName: FIELDS.join(','),
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
    return [
      {
        featureId: finiteNumber(properties.FEATURE_ID),
        treed: trimmed(properties.BCLCS_LEVEL_2)?.toUpperCase() === 'T',
        speciesCode: trimmed(properties.SPECIES_CD_1),
        heightMeters: finiteNumber(properties.PROJ_HEIGHT_1),
        crownClosurePercent: finiteNumber(properties.CROWN_CLOSURE),
        ageYears: finiteNumber(properties.PROJ_AGE_1),
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
