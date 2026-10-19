import { MercatorCoordinate, type CustomLayerInterface } from 'maplibre-gl'
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
  let program: WebGLProgram | null = null,
    buffer: WebGLBuffer | null = null,
    vao: WebGLVertexArrayObject | null = null
  let matrixLocation: WebGLUniformLocation | null = null
  const matrix = new Float32Array(16)
  return {
    id: 'analysis-tree-points',
    type: 'custom',
    renderingMode: '3d',
    onAdd(_map, context) {
      const gl = context as WebGL2RenderingContext
      const compile = (type: number, source: string) => {
        const shader = gl.createShader(type)!
        gl.shaderSource(shader, source)
        gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          const message = gl.getShaderInfoLog(shader)
          gl.deleteShader(shader)
          throw Error(message ?? 'Mesh shader failed')
        }
        return shader
      }
      const vertex = compile(
        gl.VERTEX_SHADER,
        `#version 300 es
        in vec3 position; in vec3 color; uniform mat4 matrix; out vec3 tint;
        void main(){gl_Position=matrix*vec4(position,1.0);tint=color;gl_PointSize=(color.r>0.9&&color.g<0.1)?9.0:${Math.max(1, Math.min(10, (appearance?.pointSize ?? 2.5) * 2)).toFixed(1)};}`,
      )
      const fragment = compile(
        gl.FRAGMENT_SHADER,
        `#version 300 es
        precision highp float; in vec3 tint; out vec4 result;
        void main(){if(length(gl_PointCoord-vec2(0.5))>0.5)discard;result=vec4(tint,1.0);}`,
      )
      program = gl.createProgram()!
      gl.attachShader(program, vertex)
      gl.attachShader(program, fragment)
      gl.linkProgram(program)
      gl.deleteShader(vertex)
      gl.deleteShader(fragment)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw Error(gl.getProgramInfoLog(program) ?? 'Mesh shader link failed')
      vao = gl.createVertexArray()
      buffer = gl.createBuffer()
      gl.bindVertexArray(vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)
      for (const [name, offset] of [
        ['position', 0],
        ['color', 12],
      ] as const) {
        const location = gl.getAttribLocation(program, name)
        gl.enableVertexAttribArray(location)
        gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 24, offset)
      }
      matrixLocation = gl.getUniformLocation(program, 'matrix')
      gl.bindVertexArray(null)
    },
    render(context, args) {
      if (!program || !vao) return
      const gl = context as WebGL2RenderingContext
      const projection = args.defaultProjectionData?.mainMatrix ?? args.modelViewProjectionMatrix
      if (!projection) return
      for (let i = 0; i < 16; i++) matrix[i] = projection[i]
      for (let row = 0; row < 4; row++)
        matrix[12 + row] = projection[row] * origin[0] + projection[4 + row] * origin[1] + projection[12 + row]
      gl.useProgram(program)
      gl.uniformMatrix4fv(matrixLocation, false, matrix)
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      gl.depthMask(true)
      gl.disable(gl.BLEND)
      gl.disable(gl.CULL_FACE)
      gl.bindVertexArray(vao)
      gl.drawArrays(gl.POINTS, 0, vertices.length / 6)
      gl.bindVertexArray(null)
    },
    onRemove(_map, context) {
      const gl = context as WebGL2RenderingContext
      if (buffer) gl.deleteBuffer(buffer)
      if (vao) gl.deleteVertexArray(vao)
      if (program) gl.deleteProgram(program)
      buffer = null
      vao = null
      program = null
    },
  }
}
