import { MercatorCoordinate, type CustomLayerInterface } from 'maplibre-gl'
import { coloredVertexLayer } from './coloredVertexLayer'
import type { BuildingModel } from './analysisWorkflows'

/** Translate in double precision before GPU upload to preserve small roof facets. */
export function meshVertices(model: BuildingModel, ground: number) {
  const origin = MercatorCoordinate.fromLngLat(model.centre)
  const vertices: number[] = []
  for (const triangle of model.triangles) {
    const base =
      triangle.kind === 'RoofSurface'
        ? [1, 0.66, 0.18]
        : triangle.kind === 'WallSurface'
          ? [0.35, 0.65, 0.83]
          : [0.3, 0.36, 0.4]
    const points = triangle.vertices.map(([lng, lat, z]) => MercatorCoordinate.fromLngLat([lng, lat], z - ground))
    const a = points[0],
      b = points[1],
      c = points[2]
    const u = [b.x - a.x, b.y - a.y, b.z - a.z],
      v = [c.x - a.x, c.y - a.y, c.z - a.z]
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const length = Math.hypot(...normal)
    const shade = length
      ? 0.55 + 0.45 * Math.abs((normal[0] * 0.3 - normal[1] * 0.4 + normal[2] * 0.866) / length)
      : 0.8
    for (const point of points)
      vertices.push(point.x - origin.x, point.y - origin.y, point.z, ...base.map((x) => x * shade))
  }
  return { origin: [origin.x, origin.y, 0], vertices: new Float32Array(vertices) }
}

export function buildingMeshLayer(model: BuildingModel, ground: number): CustomLayerInterface {
  const { origin, vertices } = meshVertices(model, ground)
  return coloredVertexLayer({
    id: 'analysis-building-model',
    origin,
    vertices,
    primitive: 'triangles',
    vertexShader: `#version 300 es
        in vec3 position; in vec3 color; uniform mat4 matrix; out vec3 tint;
        void main(){gl_Position=matrix*vec4(position,1.0);tint=color;}`,
    fragmentShader: `#version 300 es
        precision highp float; in vec3 tint; out vec4 result;
        void main(){result=vec4(tint,1.0);}`,
  })
}
