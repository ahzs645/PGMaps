import area from '@turf/area'
import difference from '@turf/difference'
import intersect from '@turf/intersect'
import union from '@turf/union'

export interface SurfaceDifference {
  overlap: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null
  onlyA: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null
  onlyB: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null
  overlapKm2: number
  onlyAKm2: number
  onlyBKm2: number
  aShare: number
  bShare: number
}

export interface DiffSurface {
  id: string
  name: string
  feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
  areaKm2: number
}

export interface DifferenceLayer {
  id: string
  name: string
  features: Array<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>>
}
export interface DifferenceResult {
  surfaces: [DiffSurface, DiffSurface]
  difference: SurfaceDifference
}

// Runs in a worker: feature count alone does not predict polygon clipping cost.
export function compareBoundaryLayers(layers: [DifferenceLayer, DifferenceLayer]): DifferenceResult {
  const surfaces = layers.map((layer): DiffSurface => {
    if (!layer.features.length) throw new Error(`${layer.name} has no polygons to compare.`)
    if (layer.features.length > 500) throw new Error('Filter each layer to 500 boundaries or fewer.')
    for (const feature of layer.features) {
      const polygons =
        feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates
      if (
        !polygons.length ||
        polygons.some(
          (polygon) =>
            !polygon.length ||
            polygon.some(
              (ring) =>
                ring.length < 4 ||
                ring.some((position) => position.length < 2 || !position.every(Number.isFinite)) ||
                ring[0][0] !== ring[ring.length - 1][0] ||
                ring[0][1] !== ring[ring.length - 1][1],
            ),
        )
      )
        throw new Error(
          `${layer.name} contains an invalid polygon. Choose another boundary or repair its source geometry.`,
        )
    }
    const feature = layer.features.reduce((current, next) => {
      const merged = union(current as never, next as never)
      if (!merged) throw new Error(`Unable to combine ${layer.name}.`)
      return merged
    })
    return { id: layer.id, name: layer.name, feature, areaKm2: featureAreaKm2(feature) }
  }) as [DiffSurface, DiffSurface]
  return { surfaces, difference: buildSurfaceDifference(...surfaces) }
}

function polygonFeature(
  feature: GeoJSON.Feature<GeoJSON.Geometry | null> | null,
  properties: Record<string, unknown>,
): GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null {
  if (!feature?.geometry || (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon'))
    return null
  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties,
  }
}

function featureAreaKm2(feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null): number {
  if (!feature) return 0
  const squareMeters = area(feature as never)
  return Number.isFinite(squareMeters) && squareMeters > 0 ? squareMeters / 1_000_000 : 0
}

export function buildSurfaceDifference(a: DiffSurface, b: DiffSurface): SurfaceDifference {
  const overlap = polygonFeature(
    intersect(a.feature as never, b.feature as never) as GeoJSON.Feature<GeoJSON.Geometry | null> | null,
    { id: 'surface-overlap', boundaryId: 'surface-overlap', boundaryName: 'Overlap' },
  )
  const onlyA = polygonFeature(
    difference(a.feature as never, b.feature as never) as GeoJSON.Feature<GeoJSON.Geometry | null> | null,
    { id: 'surface-only-a', boundaryId: 'surface-only-a', boundaryName: `Only ${a.name}` },
  )
  const onlyB = polygonFeature(
    difference(b.feature as never, a.feature as never) as GeoJSON.Feature<GeoJSON.Geometry | null> | null,
    { id: 'surface-only-b', boundaryId: 'surface-only-b', boundaryName: `Only ${b.name}` },
  )
  const overlapKm2 = featureAreaKm2(overlap)
  return {
    overlap,
    onlyA,
    onlyB,
    overlapKm2,
    onlyAKm2: featureAreaKm2(onlyA),
    onlyBKm2: featureAreaKm2(onlyB),
    aShare: a.areaKm2 > 0 ? overlapKm2 / a.areaKm2 : 0,
    bShare: b.areaKm2 > 0 ? overlapKm2 / b.areaKm2 : 0,
  }
}
