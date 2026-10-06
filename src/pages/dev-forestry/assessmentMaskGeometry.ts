import difference from '@turf/difference'
import { polygonBounds, type PolygonGeometry } from './visibility'
import type { AssessmentMask } from './types'

/** Keep the drawn cut surface and thinned stand aligned with reviewed exclusions. */
export function assessmentAlterationClipper(masks: AssessmentMask[]) {
  const excluded = masks
    .filter((m) => m.kind !== 'natural')
    .map((m) => ({ geometry: m.geometry, bounds: polygonBounds(m.geometry) }))
  return (geometry: PolygonGeometry): PolygonGeometry | null => {
    const b = polygonBounds(geometry)
    let current: GeoJSON.Feature<PolygonGeometry> | null = { type: 'Feature', properties: {}, geometry }
    for (const mask of excluded) {
      const a = mask.bounds
      if (!current) break
      if (a[2] <= b[0] || a[0] >= b[2] || a[3] <= b[1] || a[1] >= b[3]) continue
      current = difference(current, { type: 'Feature', properties: {}, geometry: mask.geometry })
    }
    return current?.geometry ?? null
  }
}
