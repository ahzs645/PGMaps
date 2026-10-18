import { MercatorCoordinate, type CustomLayerInterface } from 'maplibre-gl'
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
  let program: WebGLProgram | null = null,
    buffer: WebGLBuffer | null = null,
    vao: WebGLVertexArrayObject | null = null
  let matrixLocation: WebGLUniformLocation | null = null
  const matrix = new Float32Array(16)
  return {
    id: 'analysis-building-model',
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
        void main(){gl_Position=matrix*vec4(position,1.0);tint=color;}`,
      )
      const fragment = compile(
        gl.FRAGMENT_SHADER,
        `#version 300 es
        precision highp float; in vec3 tint; out vec4 result;
        void main(){result=vec4(tint,1.0);}`,
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
      gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 6)
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
