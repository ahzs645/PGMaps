import { MercatorCoordinate, type CustomLayerInterface } from 'maplibre-gl'
import { coloredVertexLayer } from './coloredVertexLayer'
import type { TreeCrop } from './treeIsolation'
import { TREE_COLOURS } from './treeIsolation'
import { pointKey, type InspectionState } from './treeInspection'
export interface PointAppearance {
  picked?: string | null
  assignments?: InspectionState['assignments']
  colour?: 'black' | 'height' | 'segment'
  pointSize?: number
}
export function treePointVertices(crop: TreeCrop, appearance?: PointAppearance) {
  const origin = MercatorCoordinate.fromLngLat(crop.centre),
    values: number[] = []
  for (const point of crop.points) {
    const p = MercatorCoordinate.fromLngLat([point.lon, point.lat], point.z - crop.ground_m),
      t = Math.min(1, point.height / 40)
    let colour = [0.15 + 0.7 * t, 0.8 - 0.35 * t, 0.3 - 0.15 * t]
    if (appearance?.colour === 'black') colour = [0.12, 0.12, 0.12]
    if (appearance?.colour === 'segment') {
      const label = appearance.assignments?.[pointKey(point)] ?? crop.id,
        hex = TREE_COLOURS[[...label].reduce((s, c) => s + c.charCodeAt(0), 0) % TREE_COLOURS.length]
      colour = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    }
    if (appearance?.assignments?.[pointKey(point)] === '0') colour = [0.65, 0.65, 0.65]
    if (appearance?.picked === pointKey(point)) colour = [1, 0.05, 0.2]
    values.push(p.x - origin.x, p.y - origin.y, p.z, ...colour)
  }
  return { origin: [origin.x, origin.y, 0], vertices: new Float32Array(values) }
}
export function treePointLayer(crop: TreeCrop, appearance?: PointAppearance): CustomLayerInterface {
  const { origin, vertices } = treePointVertices(crop, appearance)
  return coloredVertexLayer({
    id: 'analysis-tree-points',
    origin,
    vertices,
    primitive: 'points',
    vertexShader: `#version 300 es
        in vec3 position; in vec3 color; uniform mat4 matrix; out vec3 tint;
        void main(){gl_Position=matrix*vec4(position,1.0);tint=color;gl_PointSize=(color.r>0.9&&color.g<0.1)?9.0:${Math.max(1, Math.min(10, (appearance?.pointSize ?? 2.5) * 2)).toFixed(1)};}`,
    fragmentShader: `#version 300 es
        precision highp float; in vec3 tint; out vec4 result;
        void main(){if(length(gl_PointCoord-vec2(0.5))>0.5)discard;result=vec4(tint,1.0);}`,
  })
}
