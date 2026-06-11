import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import area from '@turf/area'
import intersect from '@turf/intersect'
import union from '@turf/union'
import { point } from '@turf/helpers'
import type { ScoreBuilderRegion } from '../types'

/** A polygon (e.g. a buffered park) pre-tagged with its bounding box for cheap overlap checks. */
export interface ParkBufferRecord {
  feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
  bounds: [number, number, number, number]
}

export function computeMedian(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const midpoint = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[midpoint]
  return (sorted[midpoint - 1] + sorted[midpoint]) / 2
}

export function geometryBounds(geometry: GeoJSON.Geometry): [number, number, number, number] | null {
  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity
  const scan = (coords: number[][]) => {
    coords.forEach(([lng, lat]) => {
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
    })
  }
  if (geometry.type === 'Point') {
    const [lng, lat] = geometry.coordinates
    return [lng, lat, lng, lat]
  }
  if (geometry.type === 'LineString') scan(geometry.coordinates)
  else if (geometry.type === 'Polygon') geometry.coordinates.forEach(scan)
  else if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach((p) => p.forEach(scan))
  else return null
  if (!Number.isFinite(minLng)) return null
  return [minLng, minLat, maxLng, maxLat]
}

export function bboxCenter(geometry: GeoJSON.Geometry): [number, number] | null {
  const bounds = geometryBounds(geometry)
  if (!bounds) return null
  return [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]
}

export function featurePoint(feature: GeoJSON.Feature): GeoJSON.Feature<GeoJSON.Point> | null {
  if (!feature.geometry) return null
  if (feature.geometry.type === 'Point') return feature as GeoJSON.Feature<GeoJSON.Point>
  const center = bboxCenter(feature.geometry)
  return center ? point(center) : null
}

export function regionCenter(region: ScoreBuilderRegion): [number, number] {
  return [(region.bounds[0] + region.bounds[2]) / 2, (region.bounds[1] + region.bounds[3]) / 2]
}

export function distanceKm(a: [number, number], b: [number, number]): number {
  const toRad = (value: number) => (value * Math.PI) / 180
  const earthRadiusKm = 6371
  const deltaLat = toRad(b[1] - a[1])
  const deltaLng = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Linear access score in [0, 1]: 1 at the origin, 0 at or beyond `maxKm` from the nearest point. */
export function catchmentAccess(
  origin: [number, number],
  points: Array<{ lng: number; lat: number }>,
  maxKm: number,
): number {
  if (!points.length) return 0
  const best = points.reduce((minimum, pointRecord) => {
    return Math.min(minimum, distanceKm(origin, [pointRecord.lng, pointRecord.lat]))
  }, Infinity)
  if (!Number.isFinite(best) || best > maxKm) return 0
  return Math.max(0, Math.min(1, 1 - best / maxKm))
}

export function featureLengthKm(feature: GeoJSON.Feature): number {
  const propertyLength = Number(feature.properties?.Shape__Length)
  if (Number.isFinite(propertyLength) && propertyLength > 0) return propertyLength / 1000
  return 0
}

export function featureCount(feature: GeoJSON.Feature): number {
  const crashCount = Number(feature.properties?.crashCount ?? feature.properties?.Crashes ?? feature.properties?.count)
  return Number.isFinite(crashCount) && crashCount > 0 ? crashCount : 1
}

export function boundsOverlap(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}

/** Share of a region's area covered by the union of buffer polygons, clamped to [0, 1]. */
export function bufferedAccessShare(region: ScoreBuilderRegion, bufferRecords: ParkBufferRecord[]): number {
  if (region.areaKm2 <= 0 || bufferRecords.length === 0) return 0

  const relevantBuffers = bufferRecords.filter((record) => boundsOverlap(region.bounds, record.bounds))
  if (!relevantBuffers.length) return 0

  let merged: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null = null
  let fallbackAreaSqKm = 0

  relevantBuffers.forEach((record) => {
    try {
      const clipped = intersect(
        region.feature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
        record.feature,
      ) as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null
      if (!clipped) return
      fallbackAreaSqKm += area(clipped) / 1_000_000
      if (!merged) {
        merged = clipped
        return
      }
      merged = (union(merged, clipped) as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null) ?? merged
    } catch {
      // Invalid source geometries should not break the whole scoring run.
    }
  })

  const accessAreaSqKm = merged ? area(merged) / 1_000_000 : fallbackAreaSqKm
  return Math.max(0, Math.min(1, accessAreaSqKm / region.areaKm2))
}

export function estimateCanopyAreaSqKm(dbh: number | null, treeAge: number | null): number {
  const radiusM = dbh && dbh > 60 ? 8 : dbh && dbh > 30 ? 6 : dbh && dbh > 15 ? 4 : treeAge && treeAge > 25 ? 5 : 2
  return (Math.PI * radiusM * radiusM) / 1_000_000
}

export function hazardWeight(rating: string | null | undefined): number {
  switch ((rating || '').toLowerCase()) {
    case 'moderate':
      return 0.7
    case 'low':
      return 0.3
    default:
      return 0.5
  }
}

export function computeValueGrowth(history: number[] | null | undefined): number | null {
  if (!history || history.length < 2) return null
  const first = history[0]
  const last = history[history.length - 1]
  if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0) return null
  return (last - first) / first
}

export function isInRegion(
  lng: number,
  lat: number,
  feature: GeoJSON.Feature<GeoJSON.Point>,
  region: { bounds: [number, number, number, number]; feature: GeoJSON.Feature },
): boolean {
  const [west, south, east, north] = region.bounds
  if (lng < west || lng > east || lat < south || lat > north) return false
  return booleanPointInPolygon(feature, region.feature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>)
}
