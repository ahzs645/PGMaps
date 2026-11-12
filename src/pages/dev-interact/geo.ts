import bbox from '@turf/bbox'
import { neighbourhoodFeatures, parkFeatures, routeFeatures } from './data'
import type { InteractFeature, InteractFeatureProperties, LayerId, YearRange } from './types'

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

export function featureMatchesYearRange(
  feature: GeoJSON.Feature<GeoJSON.Geometry, InteractFeatureProperties>,
  yearRange: YearRange,
): boolean {
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

function boundsContainPoint(bounds: [number, number, number, number], point: [number, number]): boolean {
  return point[0] >= bounds[0] && point[0] <= bounds[2] && point[1] >= bounds[1] && point[1] <= bounds[3]
}
