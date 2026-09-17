/**
 * British Columbia's visual landscape inventory, queried live from DataBC.
 *
 * The province publishes what a scenic area is actually held to — the
 * established visual quality objective, and the visual absorption capability
 * that narrows its planimetric allowance — so those do not have to be guessed
 * at or typed in. The polygons themselves are the landform this page divides by.
 *
 * Fetched rather than snapshotted: the service answers cross-origin, and one
 * generalised bbox query is a few tens of kilobytes. Anything that needs the
 * full-resolution inventory offline belongs in the bcdatamapper pipeline
 * instead (see AGENTS.md).
 */

import type { PolygonGeometry } from './visibility'
import type { VacRating, VisualQualityClassId } from './vqo'

export const BC_VISUAL_SERVICE =
  'https://delivery.maps.gov.bc.ca/arcgis/rest/services/whse/bcgw_pub_whse_forest_vegetation/MapServer'

/** Layer ids inside that map service. */
export const BC_VISUAL_LAYERS = {
  /** Visual sensitivity units — carries the established VQO, VAC, and VSC together. */
  sensitivityUnits: 6,
  establishedVqo: 14,
  scenicAreas: 28,
} as const

export const BC_VISUAL_ATTRIBUTION =
  '<a href="https://catalogue.data.gov.bc.ca/" target="_blank" rel="noreferrer">BC Visual Landscape Inventory</a> (DataBC)'

/**
 * Full-resolution sensitivity units run to ~110 KB per polygon, which is far
 * more shape than a screening map can use. Generalising server-side cuts a
 * Prince George-sized query from ~7 MB to under 100 KB.
 */
const DEFAULT_SIMPLIFY_DEGREES = 0.0008

/** The service caps a single response at 1000 records. */
const MAX_RECORDS = 1000

const VQO_CODE_TO_CLASS: Record<string, VisualQualityClassId> = {
  P: 'preservation',
  R: 'retention',
  PR: 'partial-retention',
  M: 'modification',
  MM: 'maximum-modification',
}

const VAC_CODE_TO_RATING: Record<string, VacRating> = {
  L: 'low',
  M: 'medium',
  H: 'high',
}

/** `REC_EVQO_CODE` / `REC_RVQC_CODE` to a class, or null when unrated. */
export function visualQualityClassForCode(code: unknown): VisualQualityClassId | null {
  if (typeof code !== 'string') return null
  return VQO_CODE_TO_CLASS[code.trim().toUpperCase()] ?? null
}

/**
 * `REC_VAC_FINAL_VALUE_CODE` to a rating. Note the collision in the raw data:
 * `M` is medium here but modification in the objective field, so the two are
 * never read through the same table.
 */
export function vacRatingForCode(code: unknown): VacRating | null {
  if (typeof code !== 'string') return null
  return VAC_CODE_TO_RATING[code.trim().toUpperCase()] ?? null
}

export type BcSensitivityUnit = {
  /** `VLI_POLYGON_NO`, unique within the inventory. */
  polygonNumber: string
  name: string
  /** Established objective, or null where none has been set. */
  objectiveId: VisualQualityClassId | null
  /** Recommended class from the inventory, used where nothing is established. */
  recommendedId: VisualQualityClassId | null
  vac: VacRating | null
  /** Visual sensitivity class: 1–5, or a code such as `W` or `NVS`. */
  vsc: string | null
  scenicArea: boolean
  rationale: string | null
  geometry: PolygonGeometry
}

export type Bounds = [number, number, number, number]

export type InventoryQueryOptions = {
  /** Geometry generalisation in degrees; 0 asks for full resolution. */
  simplifyDegrees?: number
  maxRecords?: number
}

/** ArcGIS REST query URL for a bbox, asking for GeoJSON back. */
export function buildInventoryQueryUrl(
  layerId: number,
  bounds: Bounds,
  { simplifyDegrees = DEFAULT_SIMPLIFY_DEGREES, maxRecords = MAX_RECORDS }: InventoryQueryOptions = {},
): string {
  const parameters = new URLSearchParams({
    geometry: bounds.join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: [
      'VLI_POLYGON_NO',
      'REC_EVQO_CODE',
      'REC_RVQC_CODE',
      'REC_VAC_FINAL_VALUE_CODE',
      'REC_VSC_FINAL_VALUE_CODE',
      'SCENIC_AREA_IND',
      'VLI_LABEL',
      'RATIONALE',
    ].join(','),
    returnGeometry: 'true',
    resultRecordCount: String(maxRecords),
    f: 'geojson',
  })
  if (simplifyDegrees > 0) parameters.set('maxAllowableOffset', String(simplifyDegrees))
  return `${BC_VISUAL_SERVICE}/${layerId}/query?${parameters.toString()}`
}

/**
 * Widest area worth asking for in one go. A province-wide view would return a
 * thousand generalised polygons and still be truncated, which is slow and
 * answers nothing useful — the question is always about one place.
 */
export const MAX_QUERY_SPAN_DEGREES = 1.5

/**
 * Shrinks a bbox around its centre when it is too wide to query usefully.
 * A box already inside the cap is returned untouched rather than rebuilt from
 * its centre, which would drift its edges by a rounding error for nothing.
 */
export function clampQueryBounds(bounds: Bounds, maxSpan = MAX_QUERY_SPAN_DEGREES): Bounds {
  const [minLng, minLat, maxLng, maxLat] = bounds
  if (maxLng - minLng <= maxSpan && maxLat - minLat <= maxSpan) return bounds

  const centreLng = (minLng + maxLng) / 2
  const centreLat = (minLat + maxLat) / 2
  const halfLng = Math.min(maxSpan, maxLng - minLng) / 2
  const halfLat = Math.min(maxSpan, maxLat - minLat) / 2
  return [centreLng - halfLng, centreLat - halfLat, centreLng + halfLng, centreLat + halfLat]
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Turns the service's GeoJSON into the shape this page works in. */
export function parseSensitivityUnits(payload: unknown): BcSensitivityUnit[] {
  const collection = payload as { features?: unknown }
  if (!Array.isArray(collection?.features)) return []

  return collection.features.flatMap((entry): BcSensitivityUnit[] => {
    const feature = entry as { geometry?: unknown; properties?: Record<string, unknown> }
    const geometry = feature.geometry as PolygonGeometry | undefined
    if (geometry?.type !== 'Polygon' && geometry?.type !== 'MultiPolygon') return []

    const properties = feature.properties ?? {}
    const polygonNumber = String(properties.VLI_POLYGON_NO ?? '').trim()
    if (!polygonNumber) return []

    const objectiveId = visualQualityClassForCode(properties.REC_EVQO_CODE)
    return [
      {
        polygonNumber,
        name: `VLI ${polygonNumber}`,
        objectiveId,
        recommendedId: visualQualityClassForCode(properties.REC_RVQC_CODE),
        vac: vacRatingForCode(properties.REC_VAC_FINAL_VALUE_CODE),
        vsc: text(properties.REC_VSC_FINAL_VALUE_CODE),
        scenicArea: text(properties.SCENIC_AREA_IND)?.toUpperCase() === 'Y',
        rationale: text(properties.RATIONALE),
        geometry,
      },
    ]
  })
}

export type InventoryQueryResult = {
  units: BcSensitivityUnit[]
  /** True when the service hit its record cap, so the area holds more. */
  truncated: boolean
}

/**
 * Fetches sensitivity units intersecting a bounding box.
 *
 * Coverage is real but patchy: province-wide about 5,000 units carry an
 * established objective and about 6,400 a VAC rating, and around Prince George
 * VAC is set on only a handful. Callers have to treat both as missing rather
 * than assume a rating exists.
 */
export async function fetchSensitivityUnits(
  bounds: Bounds,
  options: InventoryQueryOptions & { signal?: AbortSignal } = {},
): Promise<InventoryQueryResult> {
  const url = buildInventoryQueryUrl(BC_VISUAL_LAYERS.sensitivityUnits, bounds, options)
  const response = await fetch(url, { signal: options.signal })
  if (!response.ok) {
    throw new Error(`BC inventory service returned ${response.status} ${response.statusText}`)
  }

  const payload = await response.json()
  // ArcGIS reports failures with a 200 and an error body.
  const failure = (payload as { error?: { message?: string } }).error
  if (failure) throw new Error(failure.message ?? 'The BC inventory service rejected the query')

  const units = parseSensitivityUnits(payload)
  const maxRecords = options.maxRecords ?? MAX_RECORDS
  return { units, truncated: units.length >= maxRecords }
}

/** Counts worth showing after a lookup, since so much of the inventory is unrated. */
export function summariseUnits(units: BcSensitivityUnit[]): {
  total: number
  withObjective: number
  withVac: number
  scenicAreas: number
} {
  return {
    total: units.length,
    withObjective: units.filter((unit) => unit.objectiveId !== null).length,
    withVac: units.filter((unit) => unit.vac !== null).length,
    scenicAreas: units.filter((unit) => unit.scenicArea).length,
  }
}

export function unitsToGeoJson(units: BcSensitivityUnit[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: units.map((unit) => ({
      type: 'Feature',
      id: unit.polygonNumber,
      geometry: unit.geometry,
      properties: {
        id: unit.polygonNumber,
        name: unit.name,
        objectiveId: unit.objectiveId ?? '',
        vac: unit.vac ?? '',
        vsc: unit.vsc ?? '',
        scenicArea: unit.scenicArea ? 1 : 0,
        // Units with nothing established are drawn back, so the ones that
        // actually constrain harvesting stand out.
        rated: unit.objectiveId ? 1 : 0,
      },
    })),
  }
}
