/**
 * The shadows the nearest stems lay on the ground.
 *
 * A stand drawn on evenly lit ground reads as cut-outs standing on a green sheet. What makes a
 * tree stand on its ground is the dark patch beside it, falling away from the sun. A real shadow
 * map is not available here: MapLibre draws the ground and gives a custom layer no way to light
 * it. So each near stem lays one soft dark quad on the ground along the sun's bearing, as long as
 * its height and the sun's elevation make it, bent over the terrain at its middle and its end.
 * (octahedral-impostor's showcase casts each tree's shadow from a box in place of the tree, a
 * cheap stand-in for the same reason; `NOTICE-OCTAHEDRAL-IMPOSTOR.md`.)
 *
 * Display only, and a trial: on ground steeper than the three points a shadow is bent over, part
 * of one can lie under the surface or a little above it. It darkens the ground and is drawn before
 * the trees, so it changes no pixel a tree covers.
 */

import { MercatorCoordinate } from 'maplibre-gl'

import type { TreeInstance } from './forest'
import type { ElevationSource } from './terrain'

/** Stems within this many metres of the eye lay a shadow; they fade out over the last quarter. */
export const SHADOW_REACH_METERS = 140
/**
 * How dark one shadow is at its middle, 0–1. Overlapping shadows darken together, as under a stand:
 * at a mature stand's density about four lie on any one spot, which at this strength leaves the
 * floor about half as light as open ground.
 */
export const SHADOW_STRENGTH = 0.16
/** A shadow is at most this many times its tree's height long, however low the sun. */
export const LONGEST_SHADOW = 1.8
/** Lifted this far off the ground it is bent over, metres, so the two never fight for a pixel. */
const SHADOW_LIFT_METERS = 0.25

const VERTEX_SHADER = `#version 300 es
precision highp float;
in vec3 a_position;
/** Across the shadow −1 to 1, along it 0 at the stem to 1 at its end. */
in vec2 a_shape;
uniform mat4 u_matrix;
uniform vec3 u_eye;
uniform float u_meterScale;
uniform float u_reach;
out vec2 v_shape;
out float v_fade;
void main() {
  gl_Position = u_matrix * vec4(a_position, 1.0);
  v_shape = a_shape;
  float metres = length(a_position.xy - u_eye.xy) / u_meterScale;
  v_fade = 1.0 - smoothstep(u_reach * 0.75, u_reach, metres);
}`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_shape;
in float v_fade;
uniform float u_strength;
out vec4 fragColor;
void main() {
  // Soft at its sides and fading toward its end, where a crown's shadow is thin and broken.
  float side = 1.0 - smoothstep(0.35, 1.0, abs(v_shape.x));
  float along = smoothstep(0.0, 0.08, v_shape.y) * (1.0 - smoothstep(0.55, 1.0, v_shape.y));
  float shade = u_strength * side * along * v_fade;
  if (shade < 0.004) discard;
  fragColor = vec4(0.0, 0.0, 0.0, shade);
}`

/** A sun direction in the mercator frame (x east, y south, z up). */
type Sun = readonly [number, number, number]

/**
 * The shadows' triangles: for each stem a strip of two quads from its foot along the ground away
 * from the sun, as `[x, y, z]` positions (longitude, latitude, metres) and `[across, along]` shapes.
 * Free of DOM access, so the layout can be tested.
 */
export function shadowStrips(
  trees: ReadonlyArray<TreeInstance>,
  sun: Sun,
  elevationAt: (lng: number, lat: number) => number,
): { positions: Float64Array; shapes: Float32Array; count: number } {
  const horizontal = Math.hypot(sun[0], sun[1])
  const positions = new Float64Array(trees.length * 12 * 3)
  const shapes = new Float32Array(trees.length * 12 * 2)
  // The sun overhead lays no shadow to the side; nor does a direction with no height.
  if (horizontal < 1e-6 || sun[2] <= 0) return { positions, shapes, count: 0 }
  // Away from the sun, east and north.
  const east = -sun[0] / horizontal
  const north = sun[1] / horizontal
  const lengthPerHeight = Math.min(LONGEST_SHADOW, horizontal / sun[2])
  let count = 0
  for (const tree of trees) {
    const length = tree.heightMeters * lengthPerHeight
    const half = Math.max(0.4, (tree.heightMeters * tree.slenderness) / 2)
    if (!(length > 0.2)) continue
    const metresPerDegreeLat = 111_320
    const metresPerDegreeLng = metresPerDegreeLat * Math.max(0.05, Math.cos((tree.lat * Math.PI) / 180))
    // Three stations along the shadow, each a pair of points either side of its centre line.
    const rows: Array<[number, number, number, number, number, number, number]> = []
    for (const along of [0, 0.5, 1]) {
      const centreEast = east * length * along
      const centreNorth = north * length * along
      const lng = tree.lng + centreEast / metresPerDegreeLng
      const lat = tree.lat + centreNorth / metresPerDegreeLat
      const ground = along === 0 ? tree.elevationMeters : elevationAt(lng, lat)
      const z = (Number.isFinite(ground) ? ground : tree.elevationMeters) + SHADOW_LIFT_METERS
      // A crown's shadow is widest a little way out from the foot.
      const width = half * (along === 0 ? 0.55 : along === 0.5 ? 1 : 0.8)
      const sideEast = -north * width
      const sideNorth = east * width
      rows.push([
        lng - sideEast / metresPerDegreeLng,
        lat - sideNorth / metresPerDegreeLat,
        lng + sideEast / metresPerDegreeLng,
        lat + sideNorth / metresPerDegreeLat,
        z,
        along,
        0,
      ])
    }
    const corner = (row: number, side: -1 | 1) => {
      const r = rows[row]
      const at = count * 3
      positions[at] = side < 0 ? r[0] : r[2]
      positions[at + 1] = side < 0 ? r[1] : r[3]
      positions[at + 2] = r[4]
      shapes[count * 2] = side
      shapes[count * 2 + 1] = r[5]
      count += 1
    }
    for (const row of [0, 1]) {
      corner(row, -1)
      corner(row, 1)
      corner(row + 1, 1)
      corner(row, -1)
      corner(row + 1, 1)
      corner(row + 1, -1)
    }
  }
  return { positions, shapes, count }
}

export type TreeShadowLayer = {
  onAdd: (map: unknown, gl: WebGL2RenderingContext | WebGLRenderingContext) => void
  onRemove: () => void
  render: (
    gl: WebGL2RenderingContext | WebGLRenderingContext,
    args: {
      modelViewProjectionMatrix?: Float32Array | number[]
      defaultProjectionData?: { mainMatrix?: Float32Array | number[] }
    },
  ) => void
  /** The stems that lay shadows, the light, and the ground the shadows are bent over. */
  setTrees: (trees: ReadonlyArray<TreeInstance>, sun: Sun, elevation: ElevationSource) => void
  setEye: (eye: { lng: number; lat: number }) => void
  readonly shadowCount: number
}

export function createTreeShadowLayer(): TreeShadowLayer {
  let gl: WebGL2RenderingContext | null = null
  let program: WebGLProgram | null = null
  let vao: WebGLVertexArrayObject | null = null
  let positionBuffer: WebGLBuffer | null = null
  let shapeBuffer: WebGLBuffer | null = null
  let pending: { trees: ReadonlyArray<TreeInstance>; sun: Sun; elevation: ElevationSource } | null = null
  let vertexCount = 0
  let origin = [0, 0, 0]
  let meterScale = 1
  let eye = { lng: 0, lat: 0 }
  const translated = new Float32Array(16)

  const upload = (trees: ReadonlyArray<TreeInstance>, sun: Sun, elevation: ElevationSource) => {
    if (!gl || !positionBuffer || !shapeBuffer) return
    const strips = shadowStrips(trees, sun, (lng, lat) => elevation.elevationAt(lng, lat))
    vertexCount = strips.count
    if (strips.count === 0) return
    const first = MercatorCoordinate.fromLngLat({ lng: strips.positions[0], lat: strips.positions[1] }, 0)
    meterScale = first.meterInMercatorCoordinateUnits()
    origin = [first.x, first.y, 0]
    // Relative to the first point, in double precision, before the GPU sees them as floats.
    const relative = new Float32Array(strips.count * 3)
    for (let i = 0; i < strips.count; i += 1) {
      const mercator = MercatorCoordinate.fromLngLat(
        { lng: strips.positions[i * 3], lat: strips.positions[i * 3 + 1] },
        strips.positions[i * 3 + 2],
      )
      relative[i * 3] = mercator.x - origin[0]
      relative[i * 3 + 1] = mercator.y - origin[1]
      relative[i * 3 + 2] = mercator.z ?? 0
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, relative, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, shapeBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, strips.shapes.subarray(0, strips.count * 2), gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
  }

  return {
    onAdd(_host, context) {
      if (typeof WebGL2RenderingContext === 'undefined' || !(context instanceof WebGL2RenderingContext)) return
      gl = context
      const compile = (type: number, source: string) => {
        const shader = gl!.createShader(type)!
        gl!.shaderSource(shader, source)
        gl!.compileShader(shader)
        return shader
      }
      const made = gl.createProgram()!
      const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER)
      const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
      gl.attachShader(made, vertex)
      gl.attachShader(made, fragment)
      gl.linkProgram(made)
      gl.deleteShader(vertex)
      gl.deleteShader(fragment)
      // Shadows are an extra: a program that will not link draws none, and the stand is unharmed.
      if (!gl.getProgramParameter(made, gl.LINK_STATUS)) {
        gl.deleteProgram(made)
        gl = null
        return
      }
      program = made
      vao = gl.createVertexArray()
      gl.bindVertexArray(vao)
      positionBuffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
      const position = gl.getAttribLocation(program, 'a_position')
      gl.enableVertexAttribArray(position)
      gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0)
      shapeBuffer = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, shapeBuffer)
      const shape = gl.getAttribLocation(program, 'a_shape')
      gl.enableVertexAttribArray(shape)
      gl.vertexAttribPointer(shape, 2, gl.FLOAT, false, 0, 0)
      gl.bindVertexArray(null)
      gl.bindBuffer(gl.ARRAY_BUFFER, null)
      if (pending) {
        upload(pending.trees, pending.sun, pending.elevation)
        pending = null
      }
    },

    onRemove() {
      if (!gl) return
      if (vao) gl.deleteVertexArray(vao)
      if (program) gl.deleteProgram(program)
      if (positionBuffer) gl.deleteBuffer(positionBuffer)
      if (shapeBuffer) gl.deleteBuffer(shapeBuffer)
      gl = null
      program = null
      vao = null
      positionBuffer = null
      shapeBuffer = null
      vertexCount = 0
    },

    render(_context, args) {
      if (!gl || !program || !vao || vertexCount === 0) return
      const matrix = args.defaultProjectionData?.mainMatrix ?? args.modelViewProjectionMatrix
      if (!matrix) return
      gl.useProgram(program)
      for (let i = 0; i < 16; i += 1) translated[i] = matrix[i]
      for (let row = 0; row < 4; row += 1)
        translated[12 + row] =
          matrix[row] * origin[0] + matrix[4 + row] * origin[1] + matrix[8 + row] * origin[2] + matrix[12 + row]
      gl.uniformMatrix4fv(gl.getUniformLocation(program, 'u_matrix'), false, translated)
      const eyeMercator = MercatorCoordinate.fromLngLat(eye)
      gl.uniform3f(gl.getUniformLocation(program, 'u_eye'), eyeMercator.x - origin[0], eyeMercator.y - origin[1], 0)
      gl.uniform1f(gl.getUniformLocation(program, 'u_meterScale'), meterScale)
      gl.uniform1f(gl.getUniformLocation(program, 'u_reach'), SHADOW_REACH_METERS)
      gl.uniform1f(gl.getUniformLocation(program, 'u_strength'), SHADOW_STRENGTH)
      // On the ground, behind anything nearer, and never in the way of what is drawn after: tested
      // against depth, written to none. Each shadow multiplies what is under it by its shade.
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      gl.depthMask(false)
      gl.disable(gl.CULL_FACE)
      gl.enable(gl.BLEND)
      gl.blendFuncSeparate(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE)
      gl.bindVertexArray(vao)
      gl.drawArrays(gl.TRIANGLES, 0, vertexCount)
      gl.bindVertexArray(null)
      gl.depthMask(true)
      gl.disable(gl.BLEND)
    },

    setTrees(trees, sun, elevation) {
      if (gl && positionBuffer) upload(trees, sun, elevation)
      else pending = { trees, sun, elevation }
    },

    setEye(value) {
      eye = value
    },

    get shadowCount() {
      return vertexCount / 12
    },
  }
}
