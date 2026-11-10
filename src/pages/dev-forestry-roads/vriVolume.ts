/**
 * VRI rank-1 live stand volume per hectare over a block, live from DataBC's WFS, for volume-weighted
 * cable line selection (`cableVolume.ts`).
 *
 * `LIVE_STAND_VOLUME_125` is the inventory's projected live volume at 12.5 cm+ utilisation, m³/ha:
 * a polygon average from photo interpretation and yield models, not a cruise. The request follows
 * `bcVegetationInventory.ts`: the bounding box goes in `CQL_FILTER` (longitude first), never the WFS
 * `bbox` parameter (latitude first under WFS 2.0 with EPSG:4326), and `propertyName` stays narrow.
 */
import {
  BC_VEGETATION_WFS,
  clampVegetationBounds,
  MAX_VEGETATION_FEATURES,
} from '../dev-forestry/bcVegetationInventory'
import type { VolumeStand } from './cableVolume'

const TYPE_NAME = 'pub:WHSE_FOREST_VEGETATION.VEG_COMP_LYR_R1_POLY'
const FIELDS = ['FEATURE_ID', 'LIVE_STAND_VOLUME_125', 'GEOMETRY']
export const VRI_VOLUME_SOURCE = 'VRI rank-1 live stand volume (12.5 cm+), DataBC'

export function vriVolumeQueryUrl(bounds: [number, number, number, number]): string {
  const [minLng, minLat, maxLng, maxLat] = clampVegetationBounds(bounds)
  const parameters = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeName: TYPE_NAME,
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    count: String(MAX_VEGETATION_FEATURES),
    propertyName: FIELDS.join(','),
    CQL_FILTER: `BBOX(GEOMETRY,${minLng},${minLat},${maxLng},${maxLat},'EPSG:4326')`,
  })
  return `${BC_VEGETATION_WFS}?${parameters.toString()}`
}

/** Stands with their volume; a polygon without a figure keeps `volumePerHa: null` (no stand is not zero). */
export function parseVriVolume(payload: unknown): { stands: VolumeStand[]; truncated: boolean } {
  const collection = payload as { features?: unknown; numberMatched?: unknown }
  if (!Array.isArray(collection?.features)) return { stands: [], truncated: false }
  const stands = collection.features.flatMap((entry): VolumeStand[] => {
    const feature = entry as { geometry?: GeoJSON.Geometry; properties?: Record<string, unknown> }
    const geometry = feature.geometry
    if (geometry?.type !== 'Polygon' && geometry?.type !== 'MultiPolygon') return []
    const v = feature.properties?.LIVE_STAND_VOLUME_125
    return [{ geometry, volumePerHa: typeof v === 'number' && Number.isFinite(v) ? v : null }]
  })
  const matched = typeof collection.numberMatched === 'number' ? collection.numberMatched : null
  return {
    stands,
    truncated: stands.length >= MAX_VEGETATION_FEATURES || (matched !== null && matched > stands.length),
  }
}

/** Fetches the stands over `bounds` (west, south, east, north). */
export async function fetchVriVolume(
  bounds: [number, number, number, number],
  signal?: AbortSignal,
): Promise<{ stands: VolumeStand[]; truncated: boolean }> {
  const response = await fetch(vriVolumeQueryUrl(bounds), { signal })
  if (!response.ok) throw Error(`The BC vegetation inventory answered ${response.status}.`)
  const payload: unknown = await response.json()
  if ((payload as { exceptions?: unknown })?.exceptions) throw Error('The BC vegetation inventory refused that query.')
  return parseVriVolume(payload)
}
