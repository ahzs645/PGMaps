// Fire danger is a classified VECTOR product (cffdrs fdr polygons). The WMS
// renders these fine polygons (~100 m boundaries), far finer than the 2 km WCS
// raster, so the deck.gl layer renders prebuilt vector tiles from the snapshot.

/**
 * Committed slimmed fire-danger VECTOR snapshot (GRIDCODE → `g`, 0-4). Built by
 * `scripts/build-aqmap-fire-danger-vector.mjs` from the CWFIS WFS.
 */
export const FIRE_DANGER_VECTOR_SNAPSHOT_URL = '/data/aqmap/fire-danger-vector.geojson.gz'
export const FIRE_DANGER_VECTOR_TILE_URL_TEMPLATE = '/data/aqmap/fire-danger-vector-tiles/{z}/{x}/{y}.geojson.gz'
export const FIRE_DANGER_VECTOR_TILE_MIN_ZOOM = 5
export const FIRE_DANGER_VECTOR_TILE_MAX_ZOOM = 5

export const FIRE_DANGER_CLASS_LABELS = ['Low', 'Moderate', 'High', 'Very High', 'Extreme'] as const
