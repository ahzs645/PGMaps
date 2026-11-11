/** Where a viewer stands and looks: ground position, compass bearing and horizontal field of view. */
export type MapViewer = { lng: number; lat: number; bearing: number; fovDegrees: number }

const EARTH_RADIUS_M = 6_371_008.8

/** The point `distance` metres from `origin` along `bearing`, on a local flat approximation. */
function offset(origin: { lng: number; lat: number }, bearing: number, distance: number): [number, number] {
  const radians = (bearing * Math.PI) / 180
  const north = distance * Math.cos(radians),
    east = distance * Math.sin(radians)
  const lat = origin.lat + (north / EARTH_RADIUS_M) * (180 / Math.PI)
  const lng = origin.lng + (east / (EARTH_RADIUS_M * Math.cos((origin.lat * Math.PI) / 180))) * (180 / Math.PI)
  return [lng, lat]
}

/**
 * A plan-view marker for a viewer: the wedge it sees out to `lengthMeters` (`kind: 'cone'`) and the
 * point it stands on (`kind: 'eye'`), as one collection so a map updates both with a single setData.
 * A field of view is clamped to 1–179°; a viewer that is not finite draws nothing.
 */
export function viewerConeFeatures(viewer: MapViewer | null, lengthMeters: number): GeoJSON.FeatureCollection {
  if (
    !viewer ||
    ![viewer.lng, viewer.lat, viewer.bearing, viewer.fovDegrees, lengthMeters].every(Number.isFinite) ||
    lengthMeters <= 0
  )
    return { type: 'FeatureCollection', features: [] }
  const fov = Math.min(179, Math.max(1, viewer.fovDegrees))
  const steps = Math.max(2, Math.ceil(fov / 5))
  const ring: [number, number][] = [[viewer.lng, viewer.lat]]
  for (let step = 0; step <= steps; step += 1)
    ring.push(offset(viewer, viewer.bearing - fov / 2 + (fov * step) / steps, lengthMeters))
  ring.push([viewer.lng, viewer.lat])
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { kind: 'cone' } },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [viewer.lng, viewer.lat] },
        properties: { kind: 'eye' },
      },
    ],
  }
}

/** Horizontal field of view from a camera's vertical one and its frame's width over height. */
export function horizontalFov(verticalFovDegrees: number, aspect: number): number {
  const half = (verticalFovDegrees * Math.PI) / 360
  return (Math.atan(Math.tan(half) * aspect) * 360) / Math.PI
}
