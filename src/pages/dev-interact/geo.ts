import area from '@turf/area'
import bbox from '@turf/bbox'
import { distanceKm } from '@/lib/geo'
import { neighbourhoodFeatures, parkFeatures, routeFeatures } from './data'
import type { InteractFeature, InteractFeatureProperties, LayerId, YearRange } from './types'

export function formatArea(squareMeters: number): string {
  const squareKm = squareMeters / 1_000_000
  if (squareKm >= 1) return `${squareKm.toLocaleString(undefined, { maximumFractionDigits: 2 })} sq km`
  return `${(squareMeters / 10_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} ha`
}

export function formatDistance(km: number): string {
  if (km >= 1) return `${km.toLocaleString(undefined, { maximumFractionDigits: 2 })} km`
  return `${Math.round(km * 1000).toLocaleString()} m`
}

export function layerLabel(layer: LayerId): string {
  if (layer === 'parks') return 'Parks'
  if (layer === 'routes') return 'Transit routes'
  return 'Neighbourhood areas'
}

export function filterCollection<TGeometry extends GeoJSON.Geometry>(
  collection: GeoJSON.FeatureCollection<TGeometry, InteractFeatureProperties>,
  hiddenIds: Set<string>,
  isolatedId: string | null,
  yearRange?: YearRange,
): GeoJSON.FeatureCollection<TGeometry, InteractFeatureProperties> {
  return {
    ...collection,
    features: collection.features.filter((feature) => {
      if (hiddenIds.has(feature.properties.id)) return false
      if (isolatedId && feature.properties.id !== isolatedId) return false
      if (yearRange && !featureMatchesYearRange(feature, yearRange)) return false
      return true
    }),
  }
}

export function featureMatchesYearRange(feature: GeoJSON.Feature<GeoJSON.Geometry, InteractFeatureProperties>, yearRange: YearRange): boolean {
  return feature.properties.issuedYear >= yearRange[0] && feature.properties.issuedYear <= yearRange[1]
}

export function featureBounds(feature: InteractFeature): [number, number, number, number] {
  return bbox(feature) as [number, number, number, number]
}

export function relatedFeaturesAtPoint(
  point: [number, number],
  primary: InteractFeature,
  includeFeature: (feature: InteractFeature) => boolean = () => true,
): InteractFeature[] {
  const seen = new Set<string>([primary.properties.id])
  const related: InteractFeature[] = [primary]

  for (const feature of [...neighbourhoodFeatures.features, ...parkFeatures.features, ...routeFeatures.features]) {
    if (seen.has(feature.properties.id)) continue
    if (!includeFeature(feature)) continue
    if (boundsContainPoint(featureBounds(feature), point)) {
      related.push(feature)
      seen.add(feature.properties.id)
    }
  }

  return related
}

export function closeRing(points: [number, number][]): [number, number][] {
  if (points.length === 0) return points
  const first = points[0]
  const last = points[points.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) return points
  return [...points, first]
}

export function measurementCanClose(points: [number, number][]): boolean {
  return points.length >= 3
}

export function lineLengthKm(coordinates: [number, number][]): number {
  return coordinates.slice(1).reduce((total, coordinate, index) => total + distanceKm(coordinates[index], coordinate), 0)
}

export function measurementStats(points: [number, number][], complete: boolean) {
  if (points.length < 2) return null
  const lineCoordinates = complete ? closeRing(points) : points
  const perimeter = lineLengthKm(lineCoordinates)
  const areaValue = points.length >= 3 ? area({
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [closeRing(points)] },
  }) : 0
  return { perimeter, area: areaValue }
}

export function circleMeasurementStats(center: [number, number] | null, edge: [number, number] | null) {
  if (!center || !edge) return null
  const radius = lineLengthKm([center, edge])
  const perimeter = 2 * Math.PI * radius
  const areaValue = Math.PI * (radius * 1000) ** 2
  return { radius, perimeter, area: areaValue }
}

function boundsContainPoint(bounds: [number, number, number, number], point: [number, number]): boolean {
  return point[0] >= bounds[0] && point[0] <= bounds[2] && point[1] >= bounds[1] && point[1] <= bounds[3]
}
