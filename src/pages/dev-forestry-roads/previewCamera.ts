import type { TerrainVertex } from './terrainMesh'

/** Fit both terrain and design elevations, including roads far above/below ground. */
export function previewCamera({
  bounds,
  low,
  high,
  target,
  targetZ,
  angle,
  tilt,
  exaggeration,
  width,
  height,
  zoom,
  pan,
}: {
  bounds: number[]
  low: number
  high: number
  target: number[]
  targetZ: number
  angle: number
  tilt: number
  exaggeration: number
  width: number
  height: number
  zoom: number
  pan: { x: number; y: number }
}) {
  const span = Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1], 30)
  // Keep the entire box in front of the perspective plane, at every camera angle.
  const radius = Math.hypot(
    Math.max(Math.abs(bounds[0] - target[0]), Math.abs(bounds[2] - target[0])),
    Math.max(Math.abs(bounds[1] - target[1]), Math.abs(bounds[3] - target[1])),
    Math.max(Math.abs(low - targetZ), Math.abs(high - targetZ)) * exaggeration,
  )
  const cameraDistance = Math.max(span, radius) * 2.5
  const cameraPoint = (vertex: TerrainVertex) => {
    const x = vertex.x - target[0],
      y = vertex.y - target[1],
      z = (vertex.z - targetZ) * exaggeration
    const across = x * Math.cos(angle) - y * Math.sin(angle)
    const ahead = x * Math.sin(angle) + y * Math.cos(angle)
    const depth = ahead * Math.cos(tilt) - z * Math.sin(tilt)
    const vertical = ahead * Math.sin(tilt) + z * Math.cos(tilt)
    const perspective = cameraDistance / (cameraDistance + depth)
    return { x: across * perspective, y: -vertical * perspective, depth }
  }
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity
  for (const x of [bounds[0], bounds[2]])
    for (const y of [bounds[1], bounds[3]])
      for (const z of [low, high]) {
        const point = cameraPoint({ x, y, z })
        left = Math.min(left, point.x)
        right = Math.max(right, point.x)
        top = Math.min(top, point.y)
        bottom = Math.max(bottom, point.y)
      }
  const scale =
    zoom *
    Math.max(0.0001, Math.min((width - 24) / Math.max(1, right - left), (height - 24) / Math.max(1, bottom - top)))
  const centreX = (left + right) / 2,
    centreY = (top + bottom) / 2
  return {
    scale,
    cameraDistance,
    project: (vertex: TerrainVertex) => {
      const point = cameraPoint(vertex)
      return {
        x: width / 2 + pan.x + (point.x - centreX) * scale,
        y: height / 2 + pan.y + (point.y - centreY) * scale,
        depth: point.depth,
      }
    },
  }
}
