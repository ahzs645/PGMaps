import clipping from 'polygon-clipping'
import { multiPolygonArea } from '../dev-avast/geometry'
import type { MultiPolygonCoords } from './types'

// THLB calculations must fail visibly on a topology error. The AVAST wrapper
// deliberately swallows some such errors, which is unsuitable for this ledger.
type ClipInput = Parameters<typeof clipping.intersection>[0]
const asClip = (value: MultiPolygonCoords) => value as unknown as ClipInput
export const areaHa = (value: MultiPolygonCoords) => multiPolygonArea(value) / 10_000
export function intersect(a: MultiPolygonCoords, b: MultiPolygonCoords): MultiPolygonCoords {
  if (!a.length || !b.length) return []
  return clipping.intersection(asClip(a), asClip(b)) as MultiPolygonCoords
}
export function difference(a: MultiPolygonCoords, b: MultiPolygonCoords): MultiPolygonCoords {
  if (!a.length || !b.length) return a
  return clipping.difference(asClip(a), asClip(b)) as MultiPolygonCoords
}
export function union(parts: MultiPolygonCoords[]): MultiPolygonCoords {
  // Incremental union avoids argument limits on large imports.
  let result: MultiPolygonCoords = []
  for (const part of parts) {
    if (!part.length) continue
    // A first part is normalised on its own. Passing it twice doubles the sweep events, which exceeds
    // polygon-clipping's 1,000,000-event queue on real proxy features (~277,000 vertices near Prince George).
    result = (
      result.length ? clipping.union(asClip(result), asClip(part)) : clipping.union(asClip(part))
    ) as MultiPolygonCoords
  }
  return result
}
