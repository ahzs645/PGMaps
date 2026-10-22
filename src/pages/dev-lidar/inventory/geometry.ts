import type { Feature, Polygon, MultiPolygon, Position, FeatureCollection } from 'geojson'
import intersect from '@turf/intersect'
import kinks from '@turf/kinks'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { toMetric } from '../sourceGrids'
export type InventoryPolygon = Feature<Polygon | MultiPolygon>
const ringArea = (ring: Position[]) => {
  const xy = ring.map((p) => toMetric(p[0], p[1]))
  // Translate before summing: large northings otherwise amplify roundoff.
  const [ox, oy] = xy[0]
  return (
    Math.abs(
      xy.reduce((a, p, i) => {
        const q = xy[(i + 1) % xy.length]
        return a + (p[0] - ox) * (q[1] - oy) - (q[0] - ox) * (p[1] - oy)
      }, 0),
    ) / 2
  )
}
export function polygonHa(feature: InventoryPolygon) {
  const parts = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates
  return (
    parts.reduce((sum, rings) => sum + ringArea(rings[0]) - rings.slice(1).reduce((n, r) => n + ringArea(r), 0), 0) /
    10000
  )
}
export function scopeArea(support: FeatureCollection<Polygon>, polygon: InventoryPolygon | null) {
  let covered = 0
  for (const cell of support.features) {
    const clipped = polygon ? intersect(cell, polygon) : cell
    if (clipped) covered += polygonHa(clipped)
  }
  const requested = polygon ? polygonHa(polygon) : covered
  return {
    requested_ha: requested,
    covered_ha: covered,
    coverage: requested > 0 ? Math.min(1, covered / requested) : 0,
  }
}
export const containsTree = (polygon: InventoryPolygon | null, lon: number, lat: number) =>
  !polygon || booleanPointInPolygon({ type: 'Point', coordinates: [lon, lat] }, polygon)
export function parseInventoryPolygon(text: string): InventoryPolygon {
  if (text.length > 2_000_000) throw Error('Use a GeoJSON boundary smaller than 2 MB')
  const data = JSON.parse(text)
  const f =
    data.type === 'FeatureCollection'
      ? data.features.length === 1
        ? data.features[0]
        : null
      : data.type === 'Feature'
        ? data
        : { type: 'Feature', geometry: data, properties: {} }
  if (!f || !['Polygon', 'MultiPolygon'].includes(f.geometry?.type))
    throw Error('Provide one Polygon or MultiPolygon feature in longitude / latitude GeoJSON')
  const rings = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
  let count = 0
  for (const part of rings)
    for (const ring of part) {
      if (ring.length < 4 || ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])
        throw Error('Polygon rings must be closed with at least four positions')
      for (const p of ring) {
        if (
          ++count > 10000 ||
          p.length < 2 ||
          !Number.isFinite(p[0]) ||
          !Number.isFinite(p[1]) ||
          Math.abs(p[0]) > 180 ||
          Math.abs(p[1]) > 85
        )
          throw Error('Invalid longitude / latitude boundary or too many vertices')
      }
    }
  if (polygonHa(f) <= 1e-8) throw Error('Polygon has no positive area')
  if (kinks(f).features.length) throw Error('Polygon boundary crosses itself')
  // The clipping library validates topology on first intersection; reject self-crossing imports at the UI boundary.
  intersect(f, f)
  return f
}
export function drawnPolygon(points: [number, number][]): InventoryPolygon {
  return parseInventoryPolygon(JSON.stringify({ type: 'Polygon', coordinates: [[...points, points[0]]] }))
}
