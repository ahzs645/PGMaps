import pointOnFeature from '@turf/point-on-feature'

/** Match the official feature identity, never a name or an approximate circle. */
export function selectResearchBoundary(source: GeoJSON.FeatureCollection, idProperty: string, featureId: string) {
  const feature = source.features.find(
    (candidate) =>
      String(idProperty === 'id' ? (candidate.id ?? candidate.properties?.id) : candidate.properties?.[idProperty]) ===
      featureId,
  )
  if (!feature || (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon')) {
    throw new Error('The configured watershed boundary was not found.')
  }
  const data: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon> = {
    type: 'FeatureCollection',
    features: [feature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>],
  }
  const anchor = pointOnFeature(data).geometry.coordinates as [number, number]
  return { data, anchor }
}
