import type { Feature, Polygon, MultiPolygon } from 'geojson'
import snapshot from './roofInspection.generated.json'

export interface RoofProperties {
  id: string
  area_m2: number
  height_m: number
  roughness_m: number
  status: string
}
export type RoofFeature = Feature<Polygon | MultiPolygon, RoofProperties>
export type RoofInspection = (typeof snapshot.records)[number]
export const roofSnapshot = snapshot
export const roofInspections = new Map(snapshot.records.map((record) => [record.id, record]))
export const defaultRoofOrigin = snapshot.records.reduce((largest, row) =>
  row.sampled_area_m2 > largest.sampled_area_m2 ? row : largest,
).terrain_median_m
export const SOURCE_MIN_ELEVATION = 589.95 // original LAS header; fixed tile, same source hash as snapshot

export function roofCentre(feature: RoofFeature): [number, number] {
  const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity
  for (const polygon of polygons)
    for (const ring of polygon)
      for (const [x, y] of ring) {
        west = Math.min(west, x)
        east = Math.max(east, x)
        south = Math.min(south, y)
        north = Math.max(north, y)
      }
  return [(west + east) / 2, (south + north) / 2]
}

export function sceneOffset(ground: number | null) {
  return -(ground !== null && Number.isFinite(ground) ? ground : SOURCE_MIN_ELEVATION)
}
