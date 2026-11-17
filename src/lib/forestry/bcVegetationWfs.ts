/**
 * The request limits for DataBC's VRI rank-1 layer, shared by every tool that reads it live: the
 * visual-quality inventory (`src/pages/dev-forestry/bcVegetationInventory.ts`) and the road designer's
 * stand volume (`src/pages/dev-forestry-roads/vriVolume.ts`). No DOM or network access.
 */
export const BC_VEGETATION_WFS = 'https://openmaps.gov.bc.ca/geo/pub/WHSE_FOREST_VEGETATION.VEG_COMP_LYR_R1_POLY/ows'

/**
 * Widest box worth asking for. Un-generalised VRI runs about 2 MB over a
 * 13 km × 10 km view, so this is a payload limit rather than a service one.
 */
export const MAX_VEGETATION_QUERY_DEGREES = 0.35

/** Cap on features in one answer, so a dense valley cannot return a hundred megabytes. */
export const MAX_VEGETATION_FEATURES = 4000

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
