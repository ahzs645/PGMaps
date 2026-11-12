import { polygonAreaMeters, type PolygonGeometry } from './visibility'

/**
 * Ground the road view draws without timber: a pullout, a stretch of cleared
 * roadside, a field. Drawn on the plan, kept with the scene, and display only:
 * like the stand height and the cleared width, it changes the picture and never
 * the run, so it stays out of `AnalysisInput` and out of `sceneFingerprint`.
 *
 * Kept free of DOM access.
 */
export type TreeFreeArea = { id: string; name: string; geometry: PolygonGeometry }

export const MAX_TREE_FREE_AREAS = 50

/** Reads saved areas, dropping any that are not a polygon with area rather than failing the whole scene. */
export function parseTreeFreeAreas(raw: unknown): TreeFreeArea[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const areas: TreeFreeArea[] = []
  for (const value of raw.slice(0, MAX_TREE_FREE_AREAS)) {
    const area = value as Partial<TreeFreeArea> | null
    if (
      !area ||
      typeof area.id !== 'string' ||
      seen.has(area.id) ||
      !area.geometry ||
      (area.geometry.type !== 'Polygon' && area.geometry.type !== 'MultiPolygon') ||
      !(polygonAreaMeters(area.geometry) > 0)
    )
      continue
    seen.add(area.id)
    areas.push({
      id: area.id,
      name: typeof area.name === 'string' ? area.name.slice(0, 200) : 'Tree-free area',
      geometry: area.geometry,
    })
  }
  return areas
}

export function treeFreeAreasToGeoJson(areas: ReadonlyArray<TreeFreeArea>): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: areas.map((area) => ({
      type: 'Feature',
      id: area.id,
      geometry: area.geometry,
      properties: { id: area.id, name: area.name },
    })),
  }
}
