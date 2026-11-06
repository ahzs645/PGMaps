/** [west, south, east, north] in degrees. */
export type ViewportBounds = [number, number, number, number]

/** Anything carrying a GeoJSON geometry; the helpers below read nothing else. */
export interface GeometryCarrier {
  geometry: GeoJSON.Geometry | null
}

function walkCoordinates(coords: unknown, visit: (lng: number, lat: number) => void): void {
  if (!Array.isArray(coords)) return
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    visit(coords[0], coords[1])
    return
  }
  for (const entry of coords) walkCoordinates(entry, visit)
}

function geometryCoordinates(geometry: GeoJSON.Geometry | null): unknown {
  if (!geometry) return null
  if (geometry.type === 'GeometryCollection') return geometry.geometries.map(geometryCoordinates)
  return geometry.coordinates
}

/** [west, south, east, north] of a set of features, or null when empty. */
export function featuresBounds(features: readonly GeometryCarrier[]): ViewportBounds | null {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const feature of features) {
    walkCoordinates(geometryCoordinates(feature.geometry), (lng, lat) => {
      if (lng < west) west = lng
      if (lng > east) east = lng
      if (lat < south) south = lat
      if (lat > north) north = lat
    })
  }
  return west === Infinity ? null : [west, south, east, north]
}

/** Whether a box overlaps the viewport. */
export function boundsOverlap(box: ViewportBounds, bounds: ViewportBounds): boolean {
  const [west, south, east, north] = bounds
  return box[2] >= west && box[0] <= east && box[3] >= south && box[1] <= north
}

/** Bounding-box overlap with the viewport: good enough for "in view" filters. */
export function featureInBounds(feature: GeometryCarrier, bounds: ViewportBounds): boolean {
  const box = featuresBounds([feature])
  return box ? boundsOverlap(box, bounds) : false
}

/** Rough centre of a feature's coordinates, for flying to a row or anchoring its popup. */
export function featureCenter(feature: GeometryCarrier): [number, number] | null {
  let sumLng = 0
  let sumLat = 0
  let count = 0
  walkCoordinates(geometryCoordinates(feature.geometry), (lng, lat) => {
    sumLng += lng
    sumLat += lat
    count += 1
  })
  return count === 0 ? null : [sumLng / count, sumLat / count]
}
