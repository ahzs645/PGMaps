/**
 * A MapLibre custom layer that draws the stand as instanced 3D trees.
 *
 * This deliberately takes MapLibre's own projection matrix rather than going
 * through a deck.gl overlay. With 3D terrain and a camera at eye level, the
 * map's centre point is a long way off and far below sea level, and deck.gl
 * reads that centre elevation as the camera's reference height — which lands
 * its camera at sea level while MapLibre's is on the hillside. Nothing draws.
 * Taking `modelViewProjectionMatrix` straight from the render call sidesteps the
 * whole camera-sync question: the trees are projected by exactly the matrix that
 * projected the ground under them.
 *
 * MIT throughout: MapLibre for the map, our own geometry and shaders.
 */

import { MercatorCoordinate } from 'maplibre-gl'

import type { ForestMesh, TreeInstance } from './forest'
import { crownColor } from './forest'

/** What MapLibre v5 hands a custom layer's render method. */
type RenderArgs = {
  modelViewProjectionMatrix?: Float32Array | number[]
  defaultProjectionData?: { mainMatrix?: Float32Array | number[] }
}

const VERTEX_SHADER = `#version 300 es
precision highp float;

in vec3 a_position;
in vec3 a_normal;
/** Mercator position of the stem base. */
in vec3 a_offset;
/** Crown width and tree height, in metres. */
in vec2 a_scale;
in vec3 a_color;

uniform mat4 u_matrix;
/** One metre, in mercator units at this latitude. */
uniform float u_meterScale;

out vec3 v_color;
out vec3 v_normal;

void main() {
  // Mercator y runs south, so north-facing geometry flips.
  vec3 metres = vec3(a_position.x * a_scale.x, -a_position.y * a_scale.x, a_position.z * a_scale.y);
  gl_Position = u_matrix * vec4(a_offset + metres * u_meterScale, 1.0);

  v_color = a_color;
  // Non-uniform scaling skews a normal, so divide by the scale rather than
  // carrying the mesh normal through unchanged.
  v_normal = normalize(vec3(a_normal.x / a_scale.x, -a_normal.y / a_scale.x, a_normal.z / a_scale.y));
}`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 v_color;
in vec3 v_normal;
out vec4 fragColor;

/** A late-morning sun from the south-east, which is how BC hillshades are lit. */
const vec3 SUN = vec3(0.4767, -0.3575, 0.8027);

void main() {
  vec3 normal = normalize(v_normal);
  float lambert = max(dot(normal, SUN), 0.0);
  // A little sky fill from above, so north faces are shaded rather than black.
  float sky = 0.5 + 0.5 * normal.z;
  fragColor = vec4(v_color * (0.30 + 0.24 * sky + 0.62 * lambert), 1.0);
}`

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Tree shader failed to compile: ${log}`)
  }
  return shader
}

export type TreeLayer = {
  id: string
  type: 'custom'
  renderingMode: '3d'
  onAdd: (map: unknown, gl: WebGL2RenderingContext | WebGLRenderingContext) => void
  onRemove: () => void
  render: (gl: WebGL2RenderingContext | WebGLRenderingContext, args: RenderArgs) => void
  /** Replaces the stand. Safe to call before the layer is added to the map. */
  setTrees: (trees: TreeInstance[]) => void
  /** How many stems the layer last drew — for tests and diagnostics. */
  readonly treeCount: number
  /** Set when the layer could not start, so a caller can say why. */
  readonly error: string | null
}

/**
 * Builds the layer. The mesh is uploaded once; each regrow only rewrites the
 * per-instance buffers, which is a few megabytes rather than a rebuild.
 */
export function createTreeLayer(id: string, mesh: ForestMesh): TreeLayer {
  let gl: WebGL2RenderingContext | null = null
  let program: WebGLProgram | null = null
  let vao: WebGLVertexArrayObject | null = null
  let matrixLocation: WebGLUniformLocation | null = null
  let meterScaleLocation: WebGLUniformLocation | null = null

  let offsetBuffer: WebGLBuffer | null = null
  let scaleBuffer: WebGLBuffer | null = null
  let colorBuffer: WebGLBuffer | null = null

  let pending: TreeInstance[] | null = null
  let instanceCount = 0
  let meterScale = 1
  let error: string | null = null

  const indexCount = mesh.indices.value.length

  const upload = (trees: TreeInstance[]) => {
    if (!gl || !offsetBuffer) return

    const offsets = new Float32Array(trees.length * 3)
    const scales = new Float32Array(trees.length * 2)
    const colors = new Float32Array(trees.length * 3)

    if (trees.length > 0) {
      // One metre is worth the same in mercator units across a patch this size,
      // so the conversion is taken once at its centre rather than per stem.
      const sample = MercatorCoordinate.fromLngLat({ lng: trees[0].lng, lat: trees[0].lat }, 0)
      meterScale = sample.meterInMercatorCoordinateUnits()
    }

    trees.forEach((tree, index) => {
      const mercator = MercatorCoordinate.fromLngLat({ lng: tree.lng, lat: tree.lat }, tree.elevationMeters)
      offsets[index * 3] = mercator.x
      offsets[index * 3 + 1] = mercator.y
      offsets[index * 3 + 2] = mercator.z ?? 0

      scales[index * 2] = tree.heightMeters * tree.slenderness
      scales[index * 2 + 1] = tree.heightMeters

      const [red, green, blue] = crownColor(tree.tone)
      colors[index * 3] = red / 255
      colors[index * 3 + 1] = green / 255
      colors[index * 3 + 2] = blue / 255
    })

    gl.bindBuffer(gl.ARRAY_BUFFER, offsetBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, offsets, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, scaleBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, scales, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)

    instanceCount = trees.length
  }

  const layer: TreeLayer = {
    id,
    type: 'custom',
    renderingMode: '3d',

    onAdd(_map, context) {
      if (typeof WebGL2RenderingContext === 'undefined' || !(context instanceof WebGL2RenderingContext)) {
        error = 'The 3D stand needs WebGL 2, which this browser did not give the map.'
        return
      }
      gl = context

      try {
        program = gl.createProgram()!
        const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
        const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
        gl.attachShader(program, vertex)
        gl.attachShader(program, fragment)
        gl.linkProgram(program)
        gl.deleteShader(vertex)
        gl.deleteShader(fragment)
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          throw new Error(gl.getProgramInfoLog(program) ?? 'link failed')
        }
      } catch (linkError) {
        error = linkError instanceof Error ? linkError.message : String(linkError)
        program = null
        return
      }

      matrixLocation = gl.getUniformLocation(program, 'u_matrix')
      meterScaleLocation = gl.getUniformLocation(program, 'u_meterScale')

      vao = gl.createVertexArray()
      gl.bindVertexArray(vao)

      const attribute = (name: string) => gl!.getAttribLocation(program!, name)
      const staticBuffer = (data: ArrayBufferView, location: number, size: number) => {
        const buffer = gl!.createBuffer()
        gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer)
        gl!.bufferData(gl!.ARRAY_BUFFER, data, gl!.STATIC_DRAW)
        gl!.enableVertexAttribArray(location)
        gl!.vertexAttribPointer(location, size, gl!.FLOAT, false, 0, 0)
        return buffer
      }
      const instanceBuffer = (location: number, size: number) => {
        const buffer = gl!.createBuffer()
        gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer)
        gl!.enableVertexAttribArray(location)
        gl!.vertexAttribPointer(location, size, gl!.FLOAT, false, 0, 0)
        gl!.vertexAttribDivisor(location, 1)
        return buffer
      }

      staticBuffer(mesh.attributes.positions.value, attribute('a_position'), 3)
      staticBuffer(mesh.attributes.normals.value, attribute('a_normal'), 3)
      offsetBuffer = instanceBuffer(attribute('a_offset'), 3)
      scaleBuffer = instanceBuffer(attribute('a_scale'), 2)
      colorBuffer = instanceBuffer(attribute('a_color'), 3)

      const indexBuffer = gl.createBuffer()
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices.value, gl.STATIC_DRAW)

      gl.bindVertexArray(null)
      gl.bindBuffer(gl.ARRAY_BUFFER, null)

      if (pending) {
        upload(pending)
        pending = null
      }
    },

    onRemove() {
      if (!gl) return
      if (vao) gl.deleteVertexArray(vao)
      if (program) gl.deleteProgram(program)
      for (const buffer of [offsetBuffer, scaleBuffer, colorBuffer]) {
        if (buffer) gl.deleteBuffer(buffer)
      }
      gl = null
      program = null
      vao = null
      offsetBuffer = null
      scaleBuffer = null
      colorBuffer = null
      instanceCount = 0
    },

    render(_context, args) {
      if (!gl || !program || !vao || instanceCount === 0) return

      // v5 hands over a mercator-to-clip matrix under either name depending on
      // the projection; both are the matrix the ground was just drawn with.
      const matrix = args.defaultProjectionData?.mainMatrix ?? args.modelViewProjectionMatrix
      if (!matrix) return

      gl.useProgram(program)
      gl.uniformMatrix4fv(matrixLocation, false, matrix as Float32Array)
      gl.uniform1f(meterScaleLocation, meterScale)

      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      gl.depthMask(true)
      gl.disable(gl.BLEND)
      // Cone sides are single triangles whose winding varies, so both faces draw.
      gl.disable(gl.CULL_FACE)

      gl.bindVertexArray(vao)
      gl.drawElementsInstanced(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0, instanceCount)
      gl.bindVertexArray(null)
    },

    setTrees(trees) {
      if (gl && offsetBuffer) upload(trees)
      else pending = trees
    },

    get treeCount() {
      return instanceCount
    },

    get error() {
      return error
    },
  }

  return layer
}
