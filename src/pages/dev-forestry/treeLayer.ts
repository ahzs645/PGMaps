/**
 * A MapLibre custom layer that draws the stand, instanced.
 *
 * Two ways to draw a tree, both here:
 *
 * - **Billboards** (the default) put the tree in a texture and stand each stem
 *   up as two triangles turned to face the camera. It is what forest visualisers
 *   do, because a stand you can see a cutblock across is tens of thousands of
 *   stems and modelled geometry at that count buys detail nobody can resolve.
 * - **Solid** cones carry real geometry and real normals. They light correctly
 *   from any angle and read honestly from above, at about fifteen times the
 *   triangle count and without ever quite looking like a tree.
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
 * MIT throughout: MapLibre for the map, our own geometry, silhouettes and shaders.
 */

import { MercatorCoordinate } from 'maplibre-gl'

import type { ForestMesh, TreeInstance } from './forest'
import { crownColor } from './forest'
import { BILLBOARD_ASPECT, atlasCell, type ImpostorAtlas } from './impostor'

/** What MapLibre v5 hands a custom layer's render method. */
type RenderArgs = {
  modelViewProjectionMatrix?: Float32Array | number[]
  defaultProjectionData?: { mainMatrix?: Float32Array | number[] }
}

export type TreeStyle = 'billboard' | 'solid' | 'hybrid'

const SOLID_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec3 a_position;
in vec3 a_normal;
in float a_bark;
/** Mercator position of the stem base. */
in vec3 a_offset;
/** Crown width and tree height, in metres. */
in vec2 a_scale;
in vec3 a_color;

uniform mat4 u_matrix;
uniform vec3 u_eye;
uniform vec4 u_range;
out float v_coverage;
out float v_distance;
float coverage(float d) {
  return smoothstep(u_range.x, u_range.y, d) * (1.0 - smoothstep(u_range.z, u_range.w, d));
}
/** One metre, in mercator units at this latitude. */
uniform float u_meterScale;

out vec3 v_color;
out vec3 v_normal;

void main() {
  // Mercator y runs south, so north-facing geometry flips.
  vec3 metres = vec3(a_position.x * a_scale.x, -a_position.y * a_scale.x, a_position.z * a_scale.y);
  v_distance = length(a_offset.xy - u_eye.xy) / u_meterScale;
  v_coverage = coverage(v_distance);
  gl_Position = v_coverage > 0.0 ? u_matrix * vec4(a_offset + metres * u_meterScale, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);

  v_color = mix(a_color, vec3(0.29, 0.23, 0.17), a_bark);
  // Non-uniform scaling skews a normal, so divide by the scale rather than
  // carrying the mesh normal through unchanged.
  v_normal = normalize(vec3(a_normal.x / a_scale.x, -a_normal.y / a_scale.x, a_normal.z / a_scale.y));
}`

const SOLID_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 v_color;
in vec3 v_normal;
in float v_coverage;
in float v_distance;
out vec4 fragColor;
void clipCoverage() {
  float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (noise >= v_coverage) discard;
}

/** A late-morning sun from the south-east, which is how BC hillshades are lit. */
const vec3 SUN = vec3(0.4767, -0.3575, 0.8027);

void main() {
  clipCoverage();
  vec3 normal = normalize(v_normal);
  float lambert = max(dot(normal, SUN), 0.0);
  // A little sky fill from above, so north faces are shaded rather than black.
  float sky = 0.5 + 0.5 * normal.z;
  fragColor = vec4(v_color * (0.30 + 0.24 * sky + 0.62 * lambert), 1.0);
}`

const BILLBOARD_VERTEX_SHADER = `#version 300 es
precision highp float;

/** Card corner: x across in [-0.5, 0.5], y up in [0, 1]. */
in vec2 a_corner;
/** Mercator position of the stem base. */
in vec3 a_offset;
/** Card width and height, in metres. */
in vec2 a_scale;
/** Top-left of this tree's cell in the atlas. */
in vec2 a_cell;
/** Per-stem tint, so a stand is not one drawing repeated in one colour. */
in vec3 a_tint;

uniform mat4 u_matrix;
uniform vec3 u_eye;
uniform vec4 u_range;
out float v_coverage;
out float v_distance;
float coverage(float d) {
  return smoothstep(u_range.x, u_range.y, d) * (1.0 - smoothstep(u_range.z, u_range.w, d));
}
uniform float u_meterScale;
uniform vec2 u_cellSize;

out vec2 v_uv;
out vec3 v_tint;

void main() {
  // Which way the camera looks, read off the matrix it handed us. The row that
  // produces clip w measures distance from the camera along the view axis, so
  // its gradient is the view direction — no camera position needed, which is
  // just as well, because MapLibre does not publish one.
  vec3 view = vec3(u_matrix[0][3], u_matrix[1][3], u_matrix[2][3]);

  // Cylindrical billboard: the card turns about the stem but never tips, so a
  // tree seen from above reads as standing rather than fallen. Screen-aligned
  // rather than aimed at a point, which keeps a stand from fanning out.
  vec3 right = cross(view, vec3(0.0, 0.0, 1.0));
  float span = length(right);
  vec2 across = span > 1e-12 ? right.xy / span : vec2(1.0, 0.0);

  vec3 metres = vec3(across * (a_corner.x * a_scale.x), a_corner.y * a_scale.y);
  v_distance = length(a_offset.xy - u_eye.xy) / u_meterScale;
  v_coverage = coverage(v_distance);
  gl_Position = v_coverage > 0.0 ? u_matrix * vec4(a_offset + metres * u_meterScale, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);

  // The atlas is drawn y-down from the top of the cell.
  v_uv = a_cell + vec2(a_corner.x + 0.5, 1.0 - a_corner.y) * u_cellSize;
  v_tint = a_tint;
}`

const BILLBOARD_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
in vec3 v_tint;
uniform sampler2D u_atlas;
in float v_coverage;
in float v_distance;
out vec4 fragColor;
void clipCoverage() {
  float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (noise >= v_coverage) discard;
}

void main() {
  clipCoverage();
  vec4 texel = texture(u_atlas, v_uv);
  // Cut out rather than blend: blended foliage needs back-to-front sorting, and
  // a stand has no back to front. A hard edge costs some aliasing and keeps the
  // depth buffer honest, so trees behind a ridge stay behind it.
  if (texel.a < 0.45) discard;
  fragColor = vec4(mix(texel.rgb * v_tint, vec3(0.68, 0.76, 0.79), min(0.65, v_distance / 22000.0)), 1.0);
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

function link(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const program = gl.createProgram()!
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource)
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'link failed')
  }
  return program
}

export type TreeLayerOptions = {
  style: TreeStyle
  /** Required for `solid`. */
  mesh?: ForestMesh
  /** Required for `billboard`. */
  atlas?: ImpostorAtlas
  range?: [number, number, number, number]
  widthScale?: number
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
  setEye: (eye: { lng: number; lat: number }) => void
  /** How many stems the layer last drew — for tests and diagnostics. */
  readonly treeCount: number
  /** Triangles per stem, which is the whole point of the billboard path. */
  readonly trianglesPerTree: number
  /** Set when the layer could not start, so a caller can say why. */
  readonly error: string | null
}

/**
 * Builds the layer. The card or mesh is uploaded once; each regrow only
 * rewrites the per-instance buffers.
 */
export function createTreeLayer(id: string, options: TreeLayerOptions): TreeLayer {
  const billboard = options.style === 'billboard'

  let gl: WebGL2RenderingContext | null = null
  let program: WebGLProgram | null = null
  let vao: WebGLVertexArrayObject | null = null
  let texture: WebGLTexture | null = null

  let matrixLocation: WebGLUniformLocation | null = null
  let meterScaleLocation: WebGLUniformLocation | null = null
  let cellSizeLocation: WebGLUniformLocation | null = null
  let atlasLocation: WebGLUniformLocation | null = null

  const instanceBuffers: WebGLBuffer[] = []
  let offsetBuffer: WebGLBuffer | null = null
  let scaleBuffer: WebGLBuffer | null = null
  let thirdBuffer: WebGLBuffer | null = null
  let tintBuffer: WebGLBuffer | null = null

  let pending: TreeInstance[] | null = null
  let instanceCount = 0
  let meterScale = 1
  let error: string | null = null
  let origin = [0, 0, 0]
  let eye = { lng: 0, lat: 0 }
  let eyeLocation: WebGLUniformLocation | null = null
  let rangeLocation: WebGLUniformLocation | null = null
  const translated = new Float32Array(16)

  const atlas = options.atlas
  const mesh = options.mesh
  const indexCount = billboard ? 6 : (mesh?.indices.value.length ?? 0)

  const upload = (trees: TreeInstance[]) => {
    if (!gl || !offsetBuffer || !scaleBuffer || !thirdBuffer) return

    const offsets = new Float32Array(trees.length * 3)
    const scales = new Float32Array(trees.length * 2)
    // Billboards carry the atlas cell here; solid trees carry a crown colour.
    const third = new Float32Array(trees.length * (billboard ? 2 : 3))
    const tints = billboard ? new Float32Array(trees.length * 3) : null

    if (trees.length > 0) {
      // One metre is worth the same in mercator units across a patch this size,
      // so the conversion is taken once at its centre rather than per stem.
      const sample = MercatorCoordinate.fromLngLat({ lng: trees[0].lng, lat: trees[0].lat }, 0)
      meterScale = sample.meterInMercatorCoordinateUnits()
      origin = [sample.x, sample.y, 0]
    }

    trees.forEach((tree, index) => {
      const mercator = MercatorCoordinate.fromLngLat({ lng: tree.lng, lat: tree.lat }, tree.elevationMeters)
      offsets[index * 3] = mercator.x - origin[0]
      offsets[index * 3 + 1] = mercator.y - origin[1]
      offsets[index * 3 + 2] = mercator.z ?? 0

      // A card is drawn at one aspect and the species fills as much of it as its
      // crown needs, so every card is the same shape in the world.
      scales[index * 2] =
        tree.heightMeters * (billboard ? BILLBOARD_ASPECT * (options.widthScale ?? 1) : tree.slenderness)
      scales[index * 2 + 1] = tree.heightMeters

      if (billboard && atlas && tints) {
        const [u, v] = atlasCell(atlas, tree.species, tree.variant)
        third[index * 2] = u
        third[index * 2 + 1] = v
        // The drawing already carries its colour; this only shifts it a little,
        // warmer or cooler, so a stand is not one tree stamped out.
        const warmth = 0.86 + tree.tone * 0.26
        tints[index * 3] = warmth
        tints[index * 3 + 1] = 0.9 + (1 - tree.tone) * 0.18
        tints[index * 3 + 2] = 0.84 + tree.tone * 0.2
      } else {
        const [red, green, blue] = crownColor(tree.tone)
        third[index * 3] = red / 255
        third[index * 3 + 1] = green / 255
        third[index * 3 + 2] = blue / 255
      }
    })

    gl.bindBuffer(gl.ARRAY_BUFFER, offsetBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, offsets, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, scaleBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, scales, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, thirdBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, third, gl.DYNAMIC_DRAW)
    if (tints && tintBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, tintBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, tints, gl.DYNAMIC_DRAW)
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null)

    instanceCount = trees.length
  }

  const layer: TreeLayer = {
    id,
    type: 'custom',
    renderingMode: '3d',

    onAdd(_host, context) {
      if (typeof WebGL2RenderingContext === 'undefined' || !(context instanceof WebGL2RenderingContext)) {
        error = 'The 3D stand needs WebGL 2, which this browser did not give the map.'
        return
      }
      if (billboard && !atlas) {
        error = 'The 3D stand has no tree atlas to draw from.'
        return
      }
      if (!billboard && !mesh) {
        error = 'The 3D stand has no tree mesh to draw from.'
        return
      }
      gl = context

      try {
        program = billboard
          ? link(gl, BILLBOARD_VERTEX_SHADER, BILLBOARD_FRAGMENT_SHADER)
          : link(gl, SOLID_VERTEX_SHADER, SOLID_FRAGMENT_SHADER)
      } catch (linkError) {
        error = linkError instanceof Error ? linkError.message : String(linkError)
        program = null
        return
      }

      matrixLocation = gl.getUniformLocation(program, 'u_matrix')
      eyeLocation = gl.getUniformLocation(program, 'u_eye')
      rangeLocation = gl.getUniformLocation(program, 'u_range')
      meterScaleLocation = gl.getUniformLocation(program, 'u_meterScale')
      cellSizeLocation = gl.getUniformLocation(program, 'u_cellSize')
      atlasLocation = gl.getUniformLocation(program, 'u_atlas')

      vao = gl.createVertexArray()
      gl.bindVertexArray(vao)

      const attribute = (name: string) => gl!.getAttribLocation(program!, name)
      const staticBuffer = (data: ArrayBufferView, location: number, size: number) => {
        const buffer = gl!.createBuffer()
        gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer)
        gl!.bufferData(gl!.ARRAY_BUFFER, data, gl!.STATIC_DRAW)
        gl!.enableVertexAttribArray(location)
        gl!.vertexAttribPointer(location, size, gl!.FLOAT, false, 0, 0)
        instanceBuffers.push(buffer!)
        return buffer
      }
      const perInstance = (location: number, size: number) => {
        const buffer = gl!.createBuffer()
        gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer)
        gl!.enableVertexAttribArray(location)
        gl!.vertexAttribPointer(location, size, gl!.FLOAT, false, 0, 0)
        gl!.vertexAttribDivisor(location, 1)
        instanceBuffers.push(buffer!)
        return buffer
      }

      if (billboard) {
        // One quad, standing on the ground, centred on the stem.
        const corners = new Float32Array([-0.5, 0, 0.5, 0, 0.5, 1, -0.5, 1])
        staticBuffer(corners, attribute('a_corner'), 2)
        offsetBuffer = perInstance(attribute('a_offset'), 3)
        scaleBuffer = perInstance(attribute('a_scale'), 2)
        thirdBuffer = perInstance(attribute('a_cell'), 2)
        tintBuffer = perInstance(attribute('a_tint'), 3)

        const indexBuffer = gl.createBuffer()
        instanceBuffers.push(indexBuffer!)
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW)
      } else {
        staticBuffer(mesh!.attributes.positions.value, attribute('a_position'), 3)
        staticBuffer(mesh!.attributes.normals.value, attribute('a_normal'), 3)
        staticBuffer(
          mesh!.attributes.bark?.value ?? new Float32Array(mesh!.attributes.positions.value.length / 3),
          attribute('a_bark'),
          1,
        )
        offsetBuffer = perInstance(attribute('a_offset'), 3)
        scaleBuffer = perInstance(attribute('a_scale'), 2)
        thirdBuffer = perInstance(attribute('a_color'), 3)

        const indexBuffer = gl.createBuffer()
        instanceBuffers.push(indexBuffer!)
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh!.indices.value, gl.STATIC_DRAW)
      }

      gl.bindVertexArray(null)
      gl.bindBuffer(gl.ARRAY_BUFFER, null)

      if (billboard && atlas) {
        texture = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas)
        // Mipmaps are what stop the far shell from crawling as the camera moves.
        gl.generateMipmap(gl.TEXTURE_2D)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        // Clamp, or a crown wraps into the cell on the far side of the atlas.
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.bindTexture(gl.TEXTURE_2D, null)
      }

      if (pending) {
        upload(pending)
        pending = null
      }
    },

    onRemove() {
      if (!gl) return
      if (vao) gl.deleteVertexArray(vao)
      if (program) gl.deleteProgram(program)
      if (texture) gl.deleteTexture(texture)
      for (const buffer of instanceBuffers) gl.deleteBuffer(buffer)
      instanceBuffers.length = 0
      gl = null
      program = null
      vao = null
      texture = null
      offsetBuffer = null
      scaleBuffer = null
      thirdBuffer = null
      tintBuffer = null
      instanceCount = 0
    },

    render(_context, args) {
      if (!gl || !program || !vao || instanceCount === 0) return

      // v5 hands over a mercator-to-clip matrix under either name depending on
      // the projection; both are the matrix the ground was just drawn with.
      const matrix = args.defaultProjectionData?.mainMatrix ?? args.modelViewProjectionMatrix
      if (!matrix) return

      gl.useProgram(program)
      // Translate in JS double precision before uploading to the GPU. Absolute
      // float Mercator coordinates otherwise make nearby trunks jitter by metres.
      for (let i = 0; i < 16; i++) translated[i] = matrix[i]
      for (let row = 0; row < 4; row++)
        translated[12 + row] =
          matrix[row] * origin[0] + matrix[4 + row] * origin[1] + matrix[8 + row] * origin[2] + matrix[12 + row]
      gl.uniformMatrix4fv(matrixLocation, false, translated)
      const eyeMercator = MercatorCoordinate.fromLngLat(eye)
      gl.uniform3f(eyeLocation, eyeMercator.x - origin[0], eyeMercator.y - origin[1], 0)
      gl.uniform4fv(rangeLocation, options.range ?? [-2, -1, 99000, 100000])
      gl.uniform1f(meterScaleLocation, meterScale)

      if (billboard && atlas) {
        gl.uniform2f(cellSizeLocation, 1 / atlas.columns, 1 / atlas.rows)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.uniform1i(atlasLocation, 0)
      }

      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      gl.depthMask(true)
      gl.disable(gl.BLEND)
      // Cards are seen from both sides, and cone sides are single triangles whose
      // winding varies, so nothing is culled either way.
      gl.disable(gl.CULL_FACE)

      gl.bindVertexArray(vao)
      gl.drawElementsInstanced(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0, instanceCount)
      gl.bindVertexArray(null)
    },

    setEye(value) {
      eye = value
    },

    setTrees(trees) {
      if (gl && offsetBuffer) upload(trees)
      else pending = trees
    },

    get treeCount() {
      return instanceCount
    },

    get trianglesPerTree() {
      return indexCount / 3
    },

    get error() {
      return error
    },
  }

  return layer
}
