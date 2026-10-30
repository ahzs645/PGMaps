import type { CustomLayerInterface } from 'maplibre-gl'

interface ColoredVertexLayerOptions {
  id: string
  /** Mercator x/y origin, subtracted in double precision before the Float32 upload. */
  origin: readonly number[]
  /** Interleaved local position.xyz and color.rgb. */
  vertices: Float32Array
  vertexShader: string
  fragmentShader: string
  primitive: 'triangles' | 'points'
}

/** Shared GPU lifetime for the LiDAR point and roof renderers; geometry and shaders stay with each tool. */
export function coloredVertexLayer({
  id,
  origin,
  vertices,
  vertexShader,
  fragmentShader,
  primitive,
}: ColoredVertexLayerOptions): CustomLayerInterface {
  let program: WebGLProgram | null = null
  let buffer: WebGLBuffer | null = null
  let vao: WebGLVertexArrayObject | null = null
  let matrixLocation: WebGLUniformLocation | null = null
  const matrix = new Float32Array(16)
  const release = (gl: WebGL2RenderingContext) => {
    if (buffer) gl.deleteBuffer(buffer)
    if (vao) gl.deleteVertexArray(vao)
    if (program) gl.deleteProgram(program)
    buffer = null
    vao = null
    program = null
    matrixLocation = null
  }
  return {
    id,
    type: 'custom',
    renderingMode: '3d',
    onAdd(_map, context) {
      const gl = context as WebGL2RenderingContext
      const shaders: WebGLShader[] = []
      const compile = (type: number, source: string) => {
        const shader = gl.createShader(type)
        if (!shader) throw Error('Could not allocate a LiDAR shader')
        shaders.push(shader)
        gl.shaderSource(shader, source)
        gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
          throw Error(gl.getShaderInfoLog(shader) ?? 'LiDAR shader failed')
        return shader
      }
      try {
        const vertex = compile(gl.VERTEX_SHADER, vertexShader)
        const fragment = compile(gl.FRAGMENT_SHADER, fragmentShader)
        program = gl.createProgram()
        if (!program) throw Error('Could not allocate a LiDAR shader program')
        gl.attachShader(program, vertex)
        gl.attachShader(program, fragment)
        gl.linkProgram(program)
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
          throw Error(gl.getProgramInfoLog(program) ?? 'LiDAR shader link failed')
        vao = gl.createVertexArray()
        buffer = gl.createBuffer()
        if (!vao || !buffer) throw Error('Could not allocate a LiDAR vertex buffer')
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
      } catch (error) {
        release(gl)
        throw error
      } finally {
        for (const shader of shaders) gl.deleteShader(shader)
        gl.bindVertexArray(null)
      }
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
      gl.drawArrays(primitive === 'triangles' ? gl.TRIANGLES : gl.POINTS, 0, vertices.length / 6)
      gl.bindVertexArray(null)
    },
    onRemove(_map, context) {
      release(context as WebGL2RenderingContext)
    },
  }
}
