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

import type { ForestMesh, TreeInstance, ViewingGap } from './forest'
import { CONE_BASE_DIAMETER, SPECIES_CROWN_RATIO, crownColor } from './forest'
import { BILLBOARD_ASPECT, CLUMP_WIDTH_FACTOR, atlasCell, type ImpostorAtlas } from './impostor'
import { coveragePreservingMips, type MipLevel } from './atlasMips'

/** The alpha below which a card's pixel is cut away, as the fragment shader cuts it. */
const CARD_ALPHA_CUT = 0.45

/**
 * The atlas's mip chain with each crown's coverage kept, or null where the
 * canvas cannot be read back (then the GPU builds plain mipmaps).
 */
function atlasMipLevels(atlas: ImpostorAtlas): MipLevel[] | null {
  const context = atlas.canvas.getContext('2d')
  if (!context) return null
  const image = context.getImageData(0, 0, atlas.canvas.width, atlas.canvas.height)
  return coveragePreservingMips(
    { width: image.width, height: image.height, data: image.data },
    atlas.columns,
    atlas.rows,
    CARD_ALPHA_CUT,
  )
}

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
/** Stems nearer the eye than this, in metres, are left to another layer. */
uniform float u_nearCut;
out vec2 v_fade;
out float v_distance;
/** Height up the tree, 0 at the ground and 1 at the leader. */
out float v_height;
// Fading in and fading out as separate amounts, so the fragment can dither
// them against complementary halves of the same noise: where one band fades out
// the next fades in over exactly the pixels it leaves.
vec2 fade(float d) {
  return vec2(smoothstep(u_range.x, u_range.y, d), smoothstep(u_range.z, u_range.w, d));
}
// A viewing gap: unit direction (mercator frame), length in metres, cosine of
// its half-angle. Length 0 is no gap. Stems inside it are not drawn.
uniform vec4 u_gap;
bool inGap(vec2 offset, float metres) {
  if (u_gap.z <= 0.0 || metres > u_gap.z || metres < 0.5) return false;
  return dot(normalize(offset - u_eye.xy), u_gap.xy) > u_gap.w;
}
/** One metre, in mercator units at this latitude. */
uniform float u_meterScale;

out vec3 v_color;
out vec3 v_normal;
out float v_bark;

void main() {
  // Each stem turned about its own axis by a hash of where it stands, so a
  // stand of one mesh does not have every branch pointing the same way. Fixed
  // per stem: the tree does not spin as the camera moves.
  float turn = fract(sin(dot(a_offset.xy * 1.0e6, vec2(12.9898, 78.233))) * 43758.5453) * 6.28318530718;
  mat2 spin = mat2(cos(turn), sin(turn), -sin(turn), cos(turn));
  vec2 across = spin * a_position.xy;
  vec2 normalAcross = spin * a_normal.xy;
  // Mercator y runs south, so north-facing geometry flips.
  vec3 metres = vec3(across.x * a_scale.x, -across.y * a_scale.x, a_position.z * a_scale.y);
  v_distance = length(a_offset.xy - u_eye.xy) / u_meterScale;
  v_fade = fade(v_distance);
  bool shown = v_fade.x > 0.0 && v_fade.y < 1.0 && v_distance >= u_nearCut && !inGap(a_offset.xy, v_distance);
  gl_Position = shown ? u_matrix * vec4(a_offset + metres * u_meterScale, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);

  v_color = mix(a_color, vec3(0.29, 0.23, 0.17), a_bark);
  v_bark = a_bark;
  v_height = a_position.z;
  // Non-uniform scaling skews a normal, so divide by the scale rather than
  // carrying the mesh normal through unchanged.
  v_normal = normalize(vec3(normalAcross.x / a_scale.x, -normalAcross.y / a_scale.x, a_normal.z / a_scale.y));
}`

const SOLID_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 v_color;
in vec3 v_normal;
in vec2 v_fade;
in float v_distance;
in float v_height;
in float v_bark;
uniform float u_lit;
uniform vec3 u_view;
out vec4 fragColor;
void clipCoverage() {
  float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (noise >= v_fade.x || noise < v_fade.y) discard;
}

/** A late-morning sun from the south-east, which is how BC hillshades are lit. */
const vec3 SUN = vec3(0.4767, -0.3575, 0.8027);

void main() {
  clipCoverage();
  vec3 normal = normalize(v_normal);
  if (u_lit < 0.5) {
    float lambert = max(dot(normal, SUN), 0.0);
    // A little sky fill from above, so north faces are shaded rather than black.
    float sky = 0.5 + 0.5 * normal.z;
    fragColor = vec4(v_color * (0.30 + 0.24 * sky + 0.62 * lambert), 1.0);
    return;
  }
  // Lit: foliage is a translucent volume, not a set of hard facets. Wrapped
  // diffuse lets light reach round the crown; light through the needles shows
  // when the eye looks toward the sun; the lower crown sits in its own shade.
  // (Wrap and back-light after VistaWASM's tree shader, re-implemented;
  // crown-depth occlusion after OpenWorldGen-SDK and threejs-worldgen.)
  float wrap = clamp((dot(normal, SUN) + 0.45) / 1.45, 0.0, 1.0);
  // Crown depth darkens foliage low in the crown; a stem is only a little
  // darker in the shade of its own crown.
  float occlusion = mix(mix(0.55, 0.85, v_bark), 1.0, smoothstep(0.15, 0.95, v_height));
  float sky = 0.5 + 0.5 * normal.z;
  float back = pow(max(dot(normalize(u_view), SUN), 0.0), 3.0) * 0.55 * (1.0 - v_bark);
  // Interior bark reads grey-brown in daylight, not near-black.
  vec3 albedo = mix(v_color, vec3(0.42, 0.36, 0.3), v_bark);
  vec3 light = vec3(0.3 + 0.2 * sky + 0.12 * v_bark) * occlusion + vec3(0.68 * wrap) * mix(occlusion, 1.0, 0.4) + back * vec3(0.9, 1.1, 0.55);
  fragColor = vec4(albedo * light, 1.0);
}`

const BILLBOARD_VERTEX_SHADER = `#version 300 es
precision highp float;

/** Card corner: x across in [-0.5, 0.5], y up in [0, 1]. */
in vec3 a_corner;
uniform float u_cardPlanes;
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
out vec2 v_fade;
out float v_distance;
// Fading in and fading out as separate amounts, so the fragment can dither
// them against complementary halves of the same noise: where one band fades out
// the next fades in over exactly the pixels it leaves.
vec2 fade(float d) {
  return vec2(smoothstep(u_range.x, u_range.y, d), smoothstep(u_range.z, u_range.w, d));
}
// A viewing gap: unit direction (mercator frame), length in metres, cosine of
// its half-angle. Length 0 is no gap. Stems inside it are not drawn.
uniform vec4 u_gap;
bool inGap(vec2 offset, float metres) {
  if (u_gap.z <= 0.0 || metres > u_gap.z || metres < 0.5) return false;
  return dot(normalize(offset - u_eye.xy), u_gap.xy) > u_gap.w;
}
uniform float u_meterScale;
uniform vec2 u_cellSize;
/** Stems nearer the eye than this, in metres, are left to another layer. */
uniform float u_nearCut;

out vec2 v_uv;
out vec3 v_tint;
/** Position on the card: x across 0–1, y up 0–1. */
out vec2 v_card;
/** The card's horizontal across direction and the way it faces, mercator frame. */
out vec3 v_across;
out vec3 v_facing;
/** Which way the camera looks, mercator frame. */
out vec3 v_view;

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
  // Foreground cards stand in fixed planes through the SAME stem. Their
  // orientation depends only on the stem's stable tint, never the camera.
  if (u_cardPlanes > 1.0) {
    float angle = a_tint.r * 47.0 + a_corner.z * 3.14159265359 / u_cardPlanes;
    across = vec2(cos(angle), sin(angle));
  }

  vec3 metres = vec3(across * (a_corner.x * a_scale.x), a_corner.y * a_scale.y);
  v_distance = length(a_offset.xy - u_eye.xy) / u_meterScale;
  v_fade = fade(v_distance);
  bool shown = v_fade.x > 0.0 && v_fade.y < 1.0 && v_distance >= u_nearCut && !inGap(a_offset.xy, v_distance);
  gl_Position = shown ? u_matrix * vec4(a_offset + metres * u_meterScale, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);

  // The atlas is drawn y-down from the top of the cell.
  v_uv = a_cell + vec2(a_corner.x + 0.5, 1.0 - a_corner.y) * u_cellSize;
  v_tint = a_tint;
  v_card = vec2(a_corner.x + 0.5, a_corner.y);
  v_across = vec3(across, 0.0);
  // The card's face, turned toward the camera whichever side it is seen from.
  vec3 facing = vec3(-across.y, across.x, 0.0);
  v_facing = dot(facing, view) > 0.0 ? -facing : facing;
  v_view = view;
}`

const BILLBOARD_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
in vec3 v_tint;
in vec2 v_card;
in vec3 v_across;
in vec3 v_facing;
in vec3 v_view;
uniform sampler2D u_atlas;
uniform float u_lit;
in vec2 v_fade;
in float v_distance;
out vec4 fragColor;
/** A late-morning sun from the south-east, as the solid stems are lit. */
const vec3 SUN = vec3(0.4767, -0.3575, 0.8027);
void clipCoverage() {
  float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (noise >= v_fade.x || noise < v_fade.y) discard;
}

/**
 * A flat card shaded as if it were the crown it pictures (after Sylva's
 * canopy cards, MIT, re-implemented here): a normal bent outward from the
 * card's centre line, so the sunny side of the crown is lit and the far side
 * is not; the lower crown in its own shade; light through the needles when
 * the eye looks toward the sun. Normalised so a stand under flat light keeps
 * about the brightness the flat look gives it — this changes how a crown
 * reads, not how much of the view it covers.
 */
vec3 litCard(vec3 colour, float foliage) {
  float across = (v_card.x - 0.5) * 2.0;
  float depth = max(0.15, 1.0 - abs(across));
  vec3 normal = normalize(v_across * across * 1.2 + vec3(0.0, 0.0, 1.0) * (v_card.y - 0.55) * 1.2 + v_facing * depth * 2.0);
  float wrap = clamp((dot(normal, SUN) + 0.45) / 1.45, 0.0, 1.0);
  float shade = smoothstep(0.12, 0.9, v_card.y);
  float occlusion = mix(0.62, 1.0, shade);
  float back = pow(max(dot(normalize(v_view), SUN), 0.0), 3.0) * 0.5 * foliage;
  vec3 light = vec3(0.34 * occlusion + 0.78 * wrap * mix(occlusion, 1.0, 0.5)) + back * vec3(0.9, 1.1, 0.55);
  // Per-tree variety beyond the warm/cool tint: brightness ±10% and
  // saturation ±15%, keyed to the same stable tint so it never flickers.
  float vary = (v_tint.r - 0.99) / 0.13;
  vec3 lit = colour * light * (1.0 + 0.1 * vary);
  float grey = dot(lit, vec3(0.299, 0.587, 0.114));
  return mix(vec3(grey), lit, 1.0 + 0.15 * vary * foliage);
}

void main() {
  clipCoverage();
  vec4 texel = texture(u_atlas, v_uv);
  // Cut out rather than blend: blended foliage needs back-to-front sorting, and
  // a stand has no back to front. A hard edge costs some aliasing and keeps the
  // depth buffer honest, so trees behind a ridge stay behind it.
  if (texel.a < ${CARD_ALPHA_CUT}) discard;
  // Filtering mixes in the transparent pixels around a crown, which are black;
  // dividing by coverage takes that dark fringe back out.
  vec3 colour = texel.rgb / max(texel.a, 0.001);
  // Tint the foliage only: bark is not green, and a tinted birch stem went pink.
  float foliage = clamp((colour.g - max(colour.r, colour.b)) * 12.0, 0.0, 1.0);
  colour *= mix(vec3(1.0), v_tint, foliage);
  if (u_lit > 0.5) colour = litCard(colour, foliage);
  fragColor = vec4(mix(colour, vec3(0.68, 0.76, 0.79), min(0.65, v_distance / 22000.0)), 1.0);
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
  crossedCards?: 2 | 3
  style: TreeStyle
  /** Required for `solid`. */
  mesh?: ForestMesh
  /** Required for `billboard`. */
  atlas?: ImpostorAtlas
  range?: [number, number, number, number]
  widthScale?: number
  /** Cards are clumps (`impostorClumpShapes`): as wide as the stand's share, not one crown. */
  clumps?: boolean
  /**
   * How the stems are shaded. `flat` is the original: the drawing's own
   * colours, solids lit by plain Lambert. `lit` shades each card as a crown
   * volume with wrapped light, back-light and crown self-shading. Lighting
   * only: neither changes which pixels a tree covers.
   */
  look?: TreeLook
}

export type TreeLook = 'flat' | 'lit'

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
  /** Leaves the stems in a wedge from the eye undrawn; null draws them all. */
  setGap: (gap: ViewingGap | null) => void
  /** Leaves stems nearer the eye than this many metres to another layer; 0 draws them all. */
  setNearCut: (meters: number) => void
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
  let crossedLocation: WebGLUniformLocation | null = null
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
  let gapLocation: WebGLUniformLocation | null = null
  let gap: ViewingGap | null = null
  let rangeLocation: WebGLUniformLocation | null = null
  let nearCutLocation: WebGLUniformLocation | null = null
  let litLocation: WebGLUniformLocation | null = null
  let viewLocation: WebGLUniformLocation | null = null
  let nearCut = 0
  const translated = new Float32Array(16)

  const atlas = options.atlas
  const mesh = options.mesh
  const cardPlanes = options.crossedCards ?? 1
  const indexCount = billboard ? cardPlanes * 6 : (mesh?.indices.value.length ?? 0)

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

      // A card is drawn at one aspect with the species' crown filling
      // `SPECIES_CROWN_RATIO` of the tree's height; stretching it by the stem's
      // own ratio over that gives the crown the width its stand's closure set.
      scales[index * 2] =
        tree.heightMeters *
        (billboard
          ? options.clumps
            ? tree.slenderness * CLUMP_WIDTH_FACTOR * (options.widthScale ?? 1)
            : BILLBOARD_ASPECT * (tree.slenderness / SPECIES_CROWN_RATIO[tree.species]) * (options.widthScale ?? 1)
          : tree.slenderness / CONE_BASE_DIAMETER)
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
      gapLocation = gl.getUniformLocation(program, 'u_gap')
      rangeLocation = gl.getUniformLocation(program, 'u_range')
      meterScaleLocation = gl.getUniformLocation(program, 'u_meterScale')
      cellSizeLocation = gl.getUniformLocation(program, 'u_cellSize')
      atlasLocation = gl.getUniformLocation(program, 'u_atlas')
      crossedLocation = gl.getUniformLocation(program, 'u_cardPlanes')
      nearCutLocation = gl.getUniformLocation(program, 'u_nearCut')
      litLocation = gl.getUniformLocation(program, 'u_lit')
      viewLocation = gl.getUniformLocation(program, 'u_view')

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
        // One distant camera-facing card, or fixed foreground planes through the stem.
        const plane = [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]
        const corners = new Float32Array(
          Array.from({ length: cardPlanes }, (_, p) => plane.map((v, i) => (i % 3 === 2 ? p : v))).flat(),
        )
        staticBuffer(corners, attribute('a_corner'), 3)
        offsetBuffer = perInstance(attribute('a_offset'), 3)
        scaleBuffer = perInstance(attribute('a_scale'), 2)
        thirdBuffer = perInstance(attribute('a_cell'), 2)
        tintBuffer = perInstance(attribute('a_tint'), 3)

        const indexBuffer = gl.createBuffer()
        instanceBuffers.push(indexBuffer!)
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
        gl.bufferData(
          gl.ELEMENT_ARRAY_BUFFER,
          new Uint16Array(
            Array.from({ length: cardPlanes }, (_, p) => [0, 1, 2, 0, 2, 3].map((i) => i + p * 4)).flat(),
          ),
          gl.STATIC_DRAW,
        )
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
        // Premultiplied, so filtering and mipmapping blend a crown's edge with
        // the transparent texels around it correctly; the shader divides back
        // by coverage. Unpremultiplied, the edge went dark, and dividing it
        // then left a pale halo.
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
        // Mipmaps are what stop the far shell from crawling as the camera
        // moves. Built here rather than by the GPU so each level keeps the
        // share of each crown its cut-out covers (`atlasMips.ts`): a GPU box
        // filter thins a ragged crown with distance, and a thinner far canopy
        // would screen less of a block than the stand it stands for.
        const levels = atlasMipLevels(atlas)
        if (levels) {
          levels.forEach((level, index) =>
            gl!.texImage2D(
              gl!.TEXTURE_2D,
              index,
              gl!.RGBA,
              level.width,
              level.height,
              0,
              gl!.RGBA,
              gl!.UNSIGNED_BYTE,
              new Uint8Array(level.data.buffer, level.data.byteOffset, level.data.byteLength),
            ),
          )
        } else {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas)
          gl.generateMipmap(gl.TEXTURE_2D)
        }
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
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
      if (gap) {
        // Mercator y runs south, so north is −y.
        const bearing = (gap.bearingDegrees * Math.PI) / 180
        gl.uniform4f(
          gapLocation,
          Math.sin(bearing),
          -Math.cos(bearing),
          gap.lengthMeters,
          Math.cos((gap.halfAngleDegrees * Math.PI) / 180),
        )
      } else gl.uniform4f(gapLocation, 0, 0, 0, 1)
      gl.uniform4fv(rangeLocation, options.range ?? [-2, -1, 99000, 100000])
      gl.uniform1f(meterScaleLocation, meterScale)
      gl.uniform1f(nearCutLocation, nearCut)
      gl.uniform1f(litLocation, options.look === 'lit' ? 1 : 0)
      // The view direction, read off the matrix as the vertex shader does.
      gl.uniform3f(viewLocation, translated[3], translated[7], translated[11])

      if (billboard && atlas) {
        gl.uniform1f(crossedLocation, cardPlanes)
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

    setGap(value) {
      gap = value
    },

    setNearCut(meters) {
      nearCut = Math.max(0, meters)
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
