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

import type { ForestMesh, TreeDrawingId, TreeInstance, ViewingGap } from './forest'
import { CONE_BASE_DIAMETER, SPECIES_CROWN_RATIO, crownColor, stemTurn, treeDrawing } from './forest'
import { BILLBOARD_ASPECT, CLUMP_WIDTH_FACTOR, atlasCell, drawingCrownRatio, type ImpostorAtlas } from './impostor'
import { coveragePreservingMips, type MipLevel } from './atlasMips'
import { SPRAY_ALPHA_CUT, SPRAY_COLUMNS, SPRAY_ROWS, buildSpraySheet } from './treeSprays'

/** The alpha below which a card's pixel is cut away, as the fragment shader cuts it. */
const CARD_ALPHA_CUT = 0.45
/**
 * How steeply the camera must look down (the sine of the angle below the horizon, 0.85 ≈ 58°) before a card lies
 * flat as the crown seen from above. The road view looks near level and the oblique renders 30° down, so neither
 * reaches it; only an overhead render does.
 */
const TOP_DOWN_SIN = '0.85'

/**
 * The atlas's mip chain with each crown's coverage kept, or null where the
 * canvas cannot be read back (then the GPU builds plain mipmaps).
 */
function atlasMipLevels(atlas: ImpostorAtlas): MipLevel[] | null {
  // A baked atlas is bytes already (`impostorBake.ts`); a drawn one is read back off its canvas.
  if (atlas.image) return coveragePreservingMips(atlas.image, atlas.columns, atlas.rows, CARD_ALPHA_CUT)
  const context = atlas.canvas?.getContext('2d')
  if (!context || !atlas.canvas) return null
  const image = context.getImageData(0, 0, atlas.canvas.width, atlas.canvas.height)
  return coveragePreservingMips(
    { width: image.width, height: image.height, data: image.data },
    atlas.columns,
    atlas.rows,
    CARD_ALPHA_CUT,
  )
}

/**
 * The light every stem stands in when no sun is given: late morning, as the page has always lit
 * its trees. Mercator frame: x east, y south, z up.
 */
export const FIXED_TREE_SUN: readonly [number, number, number] = [0.4767, -0.3575, 0.8027]

/**
 * A crown's light, shared by the detailed mesh and the baked card so the two shade alike: wrapped
 * diffuse, which lets light reach round a crown; light through the needles when the eye looks
 * toward the sun; the lower crown in its own shade. (Wrap and back-light after VistaWASM's tree
 * shader, re-implemented; crown-depth occlusion after OpenWorldGen-SDK and threejs-worldgen.)
 * Sharing one function is octahedral-impostor's rule that an impostor goes through its model's
 * own shading (`NOTICE-OCTAHEDRAL-IMPOSTOR.md`).
 */
const CROWN_LIGHT_GLSL = `
uniform vec3 u_sun;
vec3 crownLight(vec3 normal, float height, float bark, vec3 view) {
  float wrap = clamp((dot(normal, u_sun) + 0.45) / 1.45, 0.0, 1.0);
  // Crown depth darkens foliage low in the crown; a stem is only a little
  // darker in the shade of its own crown.
  float occlusion = mix(mix(0.55, 0.85, bark), 1.0, smoothstep(0.15, 0.95, height));
  float sky = 0.5 + 0.5 * normal.z;
  float back = pow(max(dot(normalize(view), u_sun), 0.0), 3.0) * 0.55 * (1.0 - bark);
  return vec3(0.3 + 0.2 * sky + 0.12 * bark) * occlusion + vec3(0.68 * wrap) * mix(occlusion, 1.0, 0.4) + back * vec3(0.9, 1.1, 0.55);
}`

/** What MapLibre v5 hands a custom layer's render method. */
type RenderArgs = {
  modelViewProjectionMatrix?: Float32Array | number[]
  defaultProjectionData?: { mainMatrix?: Float32Array | number[] }
}

/**
 * `baked` draws each stem as a card taken from its own detailed mesh, from the side the eye stands
 * on (`impostorBake.ts`); the others are the drawn silhouettes and the solid cones.
 */
export type TreeStyle = 'billboard' | 'solid' | 'hybrid' | 'baked'

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
/**
 * Which way the mesh's +x axis lies, radians counter-clockwise from east: a turn hashed from where
 * the stem stands, or the heading a felled stem lies along. Worked out once per stem, so it is the
 * same in every layer that draws it and a baked card shows the side its mesh would.
 */
in float a_turn;
/** Into the spray sheet where the vertex is a foliage card's; below 0 where it is not. */
in vec2 a_uv;
/** 1 where the layer colours stems from its drawing's own foliage and bark, as its card is. */
uniform float u_palette;
uniform vec3 u_foliage;
uniform vec3 u_barkColour;
/** Crown base: x the drawing's own, y this stem's (0–1 of height); y 0 keeps the drawing as made. */
in vec2 a_crownBase;
// Stretches the stem below the crown base and the crown above it so the live crown starts at this
// stem's own height rather than the species drawing's (trial: TASS crown bases). Identity at y 0.
float crownBaseHeight(float z, vec2 base) {
  if (base.y <= 0.0 || base.x <= 0.0 || base.x >= 1.0 || base.y >= 1.0) return z;
  return z < base.x ? z * base.y / base.x : base.y + (z - base.x) * (1.0 - base.y) / (1.0 - base.x);
}

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
out vec2 v_uv;

void main() {
  // Each stem turned about its own axis, so a stand of one mesh does not have
  // every branch pointing the same way. Fixed per stem: the tree does not spin
  // as the camera moves.
  float turn = a_turn;
  mat2 spin = mat2(cos(turn), sin(turn), -sin(turn), cos(turn));
  vec2 across = spin * a_position.xy;
  vec2 normalAcross = spin * a_normal.xy;
  // Mercator y runs south, so north-facing geometry flips.
  float up = crownBaseHeight(a_position.z, a_crownBase);
  vec3 metres = vec3(across.x * a_scale.x, -across.y * a_scale.x, up * a_scale.y);
  v_distance = length(a_offset.xy - u_eye.xy) / u_meterScale;
  v_fade = fade(v_distance);
  bool shown = v_fade.x > 0.0 && v_fade.y < 1.0 && v_distance >= u_nearCut && !inGap(a_offset.xy, v_distance);
  gl_Position = shown ? u_matrix * vec4(a_offset + metres * u_meterScale, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);

  if (u_palette > 0.5) {
    // The stem's colour is a tint of its drawing's, as on a card; a treatment colour comes as
    // tint + 2 and takes the foliage at its own brightness.
    const vec3 luma = vec3(0.299, 0.587, 0.114);
    bool treated = a_color.r >= 2.0;
    vec3 leaf = treated ? (a_color - 2.0) * (0.45 + 1.1 * dot(u_foliage, luma)) : u_foliage * a_color;
    vec3 wood = treated ? mix(u_barkColour, (a_color - 2.0) * (0.45 + 1.1 * dot(u_barkColour, luma)), 0.6) : u_barkColour;
    v_color = mix(leaf, wood, a_bark);
  } else {
    v_color = mix(a_color, vec3(0.29, 0.23, 0.17), a_bark);
  }
  v_uv = a_uv;
  v_bark = a_bark;
  v_height = up;
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
in vec2 v_uv;
uniform float u_lit;
uniform vec3 u_view;
uniform float u_palette;
uniform sampler2D u_sprays;
out vec4 fragColor;
void clipCoverage() {
  float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (noise >= v_fade.x || noise < v_fade.y) discard;
}
${CROWN_LIGHT_GLSL}

void main() {
  clipCoverage();
  vec3 colour = v_color;
  // A foliage card is cut out by its bough's picture and shaded by it (treeSprays.ts).
  if (v_uv.x >= 0.0) {
    vec4 bough = texture(u_sprays, v_uv);
    if (bough.a < ${SPRAY_ALPHA_CUT}) discard;
    colour *= 0.66 + 0.5 * bough.r / max(bough.a, 0.001);
  }
  vec3 normal = normalize(v_normal);
  if (u_lit < 0.5) {
    float lambert = max(dot(normal, u_sun), 0.0);
    // A little sky fill from above, so north faces are shaded rather than black.
    float sky = 0.5 + 0.5 * normal.z;
    fragColor = vec4(colour * (0.30 + 0.24 * sky + 0.62 * lambert), 1.0);
    return;
  }
  // Lit: foliage is a translucent volume, not a set of hard facets.
  // Without a palette, interior bark reads grey-brown in daylight, not near-black.
  vec3 albedo = u_palette > 0.5 ? colour : mix(colour, vec3(0.42, 0.36, 0.3), v_bark);
  fragColor = vec4(albedo * crownLight(normal, v_height, v_bark, u_view), 1.0);
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
/** The stem's own turn, radians counter-clockwise from east: the same its detailed mesh stands at. */
in float a_turn;
/** Views round each tree in a baked atlas (impostorBake.ts); 0 on a drawn one. */
uniform float u_views;
/** The two baked views either side of where the eye stands, as columns from the stem's cell, and how far toward the second it has gone (a hard step at the stem's own angle, softened a little either side). */
flat out vec3 v_views;
/**
 * Far stems: the ground's rise per metre east and north under the stem, how much of its canopy
 * tile's half-side it may use (0 lays none) and its stand's crown closure (0 to 1).
 */
in vec4 a_ground;
/** The side of the canopy tile a far stem lays over its ground, metres; 0 where the layer lays none. */
uniform float u_tile;
/** Where canopy tiles begin and where they are fully drawn, metres from the eye. */
uniform vec2 u_tileFade;
/** How far a card runs on below its stem's foot, metres. */
uniform float u_skirt;
/** 1 where the layer's stems are lit by the hill they stand on. */
uniform float u_hill;
/** 1 where u_eye carries the eye's own height. */
uniform float u_eyeKnown;
uniform vec3 u_sun;
/** 1 on a canopy tile, 0 on a standing card. */
out float v_tile;
/** A canopy tile's place on the ground, metres east and north: the same for every tile, so crowns run on across them. */
out vec2 v_tileMetres;
/** A canopy tile's crown closure, how far it has faded in, and how squarely the eye sees it (1 from straight above). */
out vec3 v_canopy;
/** The hill's light on a far stem, against level ground's. */
out float v_hillLight;
/**
 * How much wider this stem is drawn than the tree its card was taken from. A baked normal is right
 * for that tree; on a stem stretched wider the same surface faces more upward, as the mesh's does.
 */
flat out float v_stretch;
/** Crown base: x the drawing's own, y this stem's (0–1 of height); y 0 keeps the drawing as made. */
in vec2 a_crownBase;
flat out vec2 v_crownBase;

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

/** The top-left of the stem's cell; the place within it is worked out a pixel at a time from v_card. */
flat out vec2 v_cell;
out vec3 v_tint;
/** Position on the card: x across 0–1, y up 0–1, below 0 on the run of card under the stem's foot. */
out vec2 v_card;
/** The card's horizontal across direction and the way it faces, mercator frame. */
out vec3 v_across;
out vec3 v_facing;
/** Which way the camera looks, mercator frame. */
out vec3 v_view;
/** 1 where the card lies flat as the crown seen from above (an overhead view), else 0. */
out float v_top;
/** The middle of this tree's crown picture, the colour a crown seen from above falls back to. */
out vec2 v_core;
/** A crown's width over its card's, for the crown seen from above: a clump card is wider than the crown it stands for. */
uniform float u_topCrown;

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
  // From steeply above, a standing card is edge-on and draws nothing, which left an overhead render bare ground.
  // Looking down more than TOP_DOWN_SIN, the card lies flat at crown height instead, one crown-wide square cut
  // round in the fragment shader: the crown seen from above. The road view and the obliques look down far less,
  // so what they draw, and what a tree covers there, is unchanged.
  v_top = -normalize(view).z > ${TOP_DOWN_SIN} ? 1.0 : 0.0;
  if (v_top > 0.5) {
    vec2 along = vec2(-across.y, across.x);
    metres = vec3((across * a_corner.x + along * (a_corner.y - 0.5)) * a_scale.x * u_topCrown, a_scale.y * 0.75);
  }
  v_distance = length(a_offset.xy - u_eye.xy) / u_meterScale;
  v_fade = fade(v_distance);
  // A far card runs on below its stem's foot. Where the ground is drawn as it was measured the run
  // is under it and never seen; where a far crest is drawn lower than it stands, coarse ground
  // under fine feet, it fills what would be sky between the hill and its own trees.
  float below = v_top < 0.5 && a_corner.z < 0.5 && a_corner.y < 0.5 ? u_skirt : 0.0;
  metres.z -= below;
  // The ground under a far stem: its normal, and from it the hill's light against level ground's.
  vec3 ground = normalize(vec3(-a_ground.x, a_ground.y, 1.0));
  float hill = (dot(ground, u_sun) + 0.35) / (u_sun.z + 0.35);
  v_hillLight = mix(1.0, clamp(hill, 0.5, 1.45), u_hill * smoothstep(600.0, 1500.0, v_distance));
  // The canopy tile: the second plane of a far stem, laid over its own ground at crown height and
  // tilted with the slope, so the hillside between the standing cards is canopy and not floor.
  v_tile = u_tile > 0.0 && a_corner.z > 0.5 ? 1.0 : 0.0;
  v_tileMetres = vec2(0.0);
  v_canopy = vec3(0.0);
  if (v_tile > 0.5) {
    float side = 0.5 * u_tile * a_ground.z;
    vec2 local = vec2(a_corner.x, a_corner.y - 0.5) * 2.0 * side;
    // Under the tops: the upper third of every card stands clear of the canopy, so a hillside of
    // conifers is a carpet with spires through it and not a sheet.
    float crown = a_scale.y * 0.62;
    metres = vec3(local.x, -local.y, crown + dot(local, a_ground.xy));
    v_tileMetres = vec2(a_offset.x, -a_offset.y) / u_meterScale + local;
    // From the tile to the eye; without the eye's height, as if it stood level with the crown.
    vec3 toEye = vec3(u_eye.xy - a_offset.xy, 0.0) / u_meterScale;
    toEye.z = u_eyeKnown > 0.5 ? (u_eye.z - a_offset.z) / u_meterScale - crown : 0.0;
    v_canopy = vec3(a_ground.w, smoothstep(u_tileFade.x, u_tileFade.y, v_distance), dot(normalize(toEye), ground));
  }
  v_views = vec3(0.0);
  v_stretch = 1.0;
  if (u_views > 0.5) {
    v_stretch = max(0.05, a_scale.x / a_scale.y / ${BILLBOARD_ASPECT});
    // Where the eye stands round this stem, in the stem's own frame. Mercator y runs south.
    vec2 toEye = u_eye.xy - a_offset.xy;
    float bearing = atan(-toEye.y, toEye.x) - a_turn;
    float view = fract(bearing / 6.28318530718) * u_views;
    float first = floor(view);
    // Each stem changes view at its own point between the two, so a stand never changes at once
    // and the share showing each view is the share of the way round: cover stays the views' mean.
    float own = 0.15 + 0.7 * fract(a_turn * 7.3137);
    v_views = vec3(mod(first, u_views), mod(first + 1.0, u_views), smoothstep(own - 0.08, own + 0.08, view - first));
  }
  // A lying crown is one card: crossed foreground planes would stack copies of it.
  bool shown = v_fade.x > 0.0 && v_fade.y < 1.0 && v_distance >= u_nearCut && !inGap(a_offset.xy, v_distance) &&
    !(v_top > 0.5 && a_corner.z > 0.5) &&
    !(v_tile > 0.5 && (a_ground.z <= 0.0 || v_distance < u_tileFade.x));
  gl_Position = shown ? u_matrix * vec4(a_offset + metres * u_meterScale, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);

  // The atlas is drawn y-down from the top of the cell. A crown from above takes the crown picture's average
  // colour, read from a coarse mip at the middle of the crown.
  v_core = a_cell + vec2(0.5, 1.0 - 0.6) * u_cellSize;
  v_cell = a_cell;
  v_tint = a_tint;
  v_crownBase = a_crownBase;
  v_card = vec2(a_corner.x + 0.5, below > 0.0 ? -below / a_scale.y : a_corner.y);
  v_across = vec3(across, 0.0);
  // The card's face, turned toward the camera whichever side it is seen from.
  vec3 facing = vec3(-across.y, across.x, 0.0);
  v_facing = dot(facing, view) > 0.0 ? -facing : facing;
  v_view = view;
}`

const BILLBOARD_FRAGMENT_SHADER = `#version 300 es
precision highp float;

flat in vec2 v_cell;
in vec3 v_tint;
in vec2 v_card;
in float v_tile;
in vec2 v_tileMetres;
in vec3 v_canopy;
in float v_hillLight;
in vec3 v_across;
in vec3 v_facing;
in vec3 v_view;
in float v_top;
in vec2 v_core;
flat in vec2 v_crownBase;
uniform sampler2D u_atlas;
/** A baked atlas's second sheet: normal, foliage or bark, depth. */
uniform sampler2D u_surface;
/** 1 where the atlas is baked from the detailed meshes and carries u_surface. */
uniform float u_baked;
uniform vec2 u_cellSize;
flat in vec3 v_views;
flat in float v_stretch;
uniform float u_lit;
in vec2 v_fade;
in float v_distance;
out vec4 fragColor;
${CROWN_LIGHT_GLSL}
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
  float wrap = clamp((dot(normal, u_sun) + 0.45) / 1.45, 0.0, 1.0);
  float shade = smoothstep(0.12, 0.9, v_card.y);
  float occlusion = mix(0.62, 1.0, shade);
  float back = pow(max(dot(normalize(v_view), u_sun), 0.0), 3.0) * 0.5 * foliage;
  vec3 light = vec3(0.34 * occlusion + 0.78 * wrap * mix(occlusion, 1.0, 0.5)) + back * vec3(0.9, 1.1, 0.55);
  // Per-tree variety beyond the warm/cool tint: brightness ±10% and
  // saturation ±15%, keyed to the same stable tint so it never flickers.
  float vary = v_tint.r >= 2.0 ? 0.0 : (v_tint.r - 0.99) / 0.13;
  vec3 lit = colour * light * (1.0 + 0.1 * vary);
  float grey = dot(lit, vec3(0.299, 0.587, 0.114));
  return mix(vec3(grey), lit, 1.0 + 0.15 * vary * foliage);
}

/** A crown across, on a canopy tile, metres: about a mature interior stand's. */
const float CROWN_METRES = 5.0;

vec2 crownAt(vec2 cell) {
  vec2 p = vec2(dot(cell, vec2(127.1, 311.7)), dot(cell, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

/** Smooth noise over the ground, 0 to 1, the same wherever two tiles meet. */
float groundNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(crownAt(i).x, crownAt(i + vec2(1.0, 0.0)).x, f.x),
    mix(crownAt(i + vec2(0.0, 1.0)).x, crownAt(i + vec2(1.0, 1.0)).x, f.x),
    f.y
  );
}

/**
 * Distance takes colour out of a stand and puts the sky's in: a hillside across a valley is
 * greyer and bluer than the trees beside the road. Koschmieder's law, as the haze rings on the
 * ground are faded by, at a clear day's reach, and never past two thirds.
 */
vec3 withDistance(vec3 colour, float metres) {
  float air = min(0.65, 1.0 - exp(-metres / 14000.0));
  float grey = dot(colour, vec3(0.299, 0.587, 0.114));
  return mix(mix(colour, vec3(grey), 0.45 * air), vec3(0.68, 0.76, 0.79), air);
}

/** The stem's tint of a colour: its own warmth, or a treatment colour carried as tint + 2. */
vec3 tinted(vec3 colour, float foliage) {
  if (v_tint.r >= 2.0) {
    float luma = dot(colour, vec3(0.299, 0.587, 0.114));
    return mix(colour, (v_tint - 2.0) * (0.45 + 1.1 * luma), max(foliage, 0.6));
  }
  return colour * mix(vec3(1.0), v_tint, foliage);
}

/**
 * A far stem's canopy tile: crowns seen from above, cut out to the stand's closure as the eye
 * sees it. Along a slanted sight line the gaps between crowns close up: the share of sky seen
 * through a canopy is its share straight down to the power of the path's length through it
 * (Beer–Lambert), so a stand half closed from above is all but closed from across a valley and
 * open again from a hill above it.
 */
void canopyTile(float pixel) {
  // From underneath a canopy is not a sheet: only its top is drawn.
  if (v_canopy.z <= 0.02) discard;
  // A ragged edge, a different one along every metre of it, so neighbouring tiles lock into each
  // other and none reads as a square. Tiles overlap by more than this takes off.
  float edge = min(min(v_card.x, 1.0 - v_card.x), min(v_card.y, 1.0 - v_card.y)) * 2.0;
  if (edge < 0.2 * groundNoise(v_tileMetres / 7.0)) discard;
  float fadeNoise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.0431, 0.0817))));
  if (fadeNoise >= v_canopy.y) discard;
  // Turning edge-on to the eye, as over a crest, a tile is a slab against the sky: it thins out
  // there and leaves the skyline to the standing cards.
  float edgeOn = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.0613, 0.0359))));
  if (v_canopy.z < 0.14 * edgeOn) discard;
  float closure = clamp(v_canopy.x, 0.05, 0.97);
  float cover = min(0.985, 1.0 - pow(1.0 - closure, 1.0 / clamp(v_canopy.z, 0.12, 1.0)));
  // Crowns while a crown is more than a few pixels across; past that, groups of them twice the
  // size at each step, so the gaps in a far canopy are gaps between clumps and never a speckle of
  // single pixels. The cover is the same at every size.
  float size = exp2(clamp(floor(log2(max(pixel, 0.0001) / 0.3)) + 1.0, 0.0, 4.0));
  vec2 at = v_tileMetres / (CROWN_METRES * size);
  vec2 cell = floor(at);
  float nearest = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = cell + vec2(float(i), float(j));
      nearest = min(nearest, length(c + crownAt(c) - at));
    }
  }
  // Crowns scattered one to a cell cover 1 − exp(−π r²) of the ground at radius r.
  float radius = sqrt(-log(1.0 - cover) / 3.14159265);
  if (nearest >= radius) discard;
  // The stem's own crown colour: the middle of its picture, from a coarse level of the atlas.
  vec4 core = textureLod(u_atlas, v_core, 3.0);
  vec3 colour = tinted(core.a > 0.02 ? core.rgb / core.a : vec3(0.2, 0.32, 0.17), 1.0);
  // One stem's colour stands here for a clump's: taken part of the way to a stand's own green, or
  // a hillside is a quilt of one square a species.
  colour = mix(colour, vec3(0.17, 0.27, 0.17), 0.45);
  // Lighter on a crown's top than down its side, where the eye looks into the gap beside it, and
  // over that the light and dark of whole groups of crowns, at two sizes.
  float across = nearest / max(radius, 0.001);
  float groups = 0.6 * groundNoise(v_tileMetres / 16.0) + 0.4 * groundNoise(v_tileMetres / 55.0);
  colour *= (1.06 - 0.4 * across * across) * (0.74 + 0.36 * groups);
  if (u_lit > 0.5) colour *= v_hillLight;
  fragColor = vec4(withDistance(colour, v_distance), 1.0);
}

void main() {
  // Rates of change are taken here, before any pixel is dropped or any branch taken: after one they
  // are not defined on every GPU.
  vec2 tileWidth = fwidth(v_tileMetres / CROWN_METRES);
  vec2 unfolded = v_cell + vec2(v_card.x, 1.0 - v_card.y) * u_cellSize;
  vec2 dx = dFdx(unfolded);
  vec2 dy = dFdy(unfolded);
  // Below the stem's foot the card runs on as more of its own crowns: the middle of its picture,
  // back and forth. It is seen only where the drawn ground falls short of the ground the stem was
  // stood on, and there it should read as the trees it stands among, not as a dark block.
  float cardY = v_card.y < 0.0 ? 0.34 + 0.3 * abs(fract(-v_card.y * 1.6) * 2.0 - 1.0) : v_card.y;
  // A stem with its own crown base reads the picture at the height it stands for (the inverse of the
  // solid path's stretch): below the stem's crown base, the drawing's bole; above, its crown.
  vec2 base = v_crownBase;
  if (v_top < 0.5 && v_card.y >= 0.0 && base.y > 0.0 && base.x > 0.0 && base.x < 1.0 && base.y < 1.0) {
    cardY = cardY < base.y ? cardY * base.x / base.y : base.x + (cardY - base.y) * (1.0 - base.x) / (1.0 - base.y);
  }
  vec2 within = v_cell + vec2(v_card.x, 1.0 - cardY) * u_cellSize;
  clipCoverage();
  if (v_tile > 0.5) {
    canopyTile(max(tileWidth.x, tileWidth.y));
    return;
  }
  // A crown seen from above is round, darker toward its rim where the eye looks into its side.
  float rim = v_top > 0.5 ? length(v_card - 0.5) * 2.0 : 0.0;
  if (rim > 1.0) discard;
  // A baked stem shows one of the two views it stands between: this pixel's, by a dither across
  // the few degrees where the stem changes over. One view a pixel, never a blend of two outlines,
  // which would ghost every branch. The gradients are the card's own, taken before the step, or
  // the jump between cells would read as a far-off texture and blur the changeover.
  float viewNoise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.02761, 0.09137))));
  vec2 uv = within + vec2((viewNoise < v_views.z ? v_views.y : v_views.x) * u_cellSize.x, 0.0);
  vec4 texel = v_top > 0.5 ? textureLod(u_atlas, v_core, 3.0) : textureGrad(u_atlas, uv, dx, dy);
  // From above the disc is the crown: never cut by the side picture's outline.
  if (v_top > 0.5) texel = texel.a > 0.02 ? vec4(texel.rgb / texel.a, 1.0) : vec4(0.2, 0.32, 0.17, 1.0);
  // Cut out rather than blend: blended foliage needs back-to-front sorting, and
  // a stand has no back to front. A hard edge costs some aliasing and keeps the
  // depth buffer honest, so trees behind a ridge stay behind it.
  if (texel.a < ${CARD_ALPHA_CUT}) discard;
  // Filtering mixes in the transparent pixels around a crown, which are black;
  // dividing by coverage takes that dark fringe back out.
  vec3 colour = texel.rgb / max(texel.a, 0.001);
  // Tint the foliage only: bark is not green, and a tinted birch stem went pink. A baked card says
  // which is which; a drawn one is read by its green.
  vec4 surface = u_baked > 0.5 ? textureGrad(u_surface, uv, dx, dy) : vec4(0.5, 0.5, 1.0, 0.0);
  float foliage = u_baked > 0.5 ? surface.b : clamp((colour.g - max(colour.r, colour.b)) * 12.0, 0.0, 1.0);
  // A treatment colour (*Tree colours: by treatment*) takes the foliage at its own brightness. A
  // colour only; the cut-out above is unchanged.
  colour = tinted(colour, foliage);
  if (v_top > 0.5) colour *= 1.12 - 0.45 * rim * rim;
  else if (u_lit > 0.5 && u_baked > 0.5) {
    // The mesh's own normal, turned from the view it was taken in to the way this card faces.
    vec2 lean = surface.rg * 2.0 - 1.0;
    vec3 level = v_across * lean.x + v_facing * sqrt(max(0.0, 1.0 - dot(lean, lean)));
    vec3 normal = normalize(level / v_stretch + vec3(0.0, 0.0, lean.y));
    colour *= crownLight(normal, v_card.y, 1.0 - foliage, v_view);
  } else if (u_lit > 0.5) colour = litCard(colour, foliage);
  if (u_lit > 0.5 && v_top < 0.5) colour *= v_hillLight;
  // In the shade of the stand above it.
  if (v_card.y < 0.0) colour *= 0.72;

  fragColor = vec4(withDistance(colour, v_distance), 1.0);
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

/**
 * What every tree layer on one map shares: the two compiled programs and the spray sheet. A stand
 * is a dozen layers and the stopped view some thirty more (a detailed mesh per drawing and
 * variant); compiling a program and uploading a sheet for each was most of a second of the map's
 * time for nothing, since they are the same two programs throughout.
 */
type SharedTreeResources = {
  users: number
  programs: Map<'billboard' | 'solid', WebGLProgram>
  sprays: WebGLTexture | null
}
const sharedResources = new WeakMap<WebGL2RenderingContext, SharedTreeResources>()

function acquireShared(gl: WebGL2RenderingContext): SharedTreeResources {
  let shared = sharedResources.get(gl)
  if (!shared) {
    shared = { users: 0, programs: new Map(), sprays: null }
    sharedResources.set(gl, shared)
  }
  shared.users += 1
  return shared
}

function releaseShared(gl: WebGL2RenderingContext) {
  const shared = sharedResources.get(gl)
  if (!shared) return
  shared.users -= 1
  if (shared.users > 0) return
  for (const program of shared.programs.values()) gl.deleteProgram(program)
  if (shared.sprays) gl.deleteTexture(shared.sprays)
  sharedResources.delete(gl)
}

function sharedProgram(gl: WebGL2RenderingContext, shared: SharedTreeResources, kind: 'billboard' | 'solid') {
  let program = shared.programs.get(kind)
  if (!program) {
    program =
      kind === 'billboard'
        ? link(gl, BILLBOARD_VERTEX_SHADER, BILLBOARD_FRAGMENT_SHADER)
        : link(gl, SOLID_VERTEX_SHADER, SOLID_FRAGMENT_SHADER)
    shared.programs.set(kind, program)
  }
  return program
}

/**
 * The bough pictures foliage cards are cut out by, with each picture's cover kept down the mip
 * chain as the tree atlas's is.
 */
function sharedSprays(gl: WebGL2RenderingContext, shared: SharedTreeResources): WebGLTexture | null {
  if (shared.sprays) return shared.sprays
  const sheet = buildSpraySheet()
  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
  coveragePreservingMips(sheet, SPRAY_COLUMNS, SPRAY_ROWS, SPRAY_ALPHA_CUT).forEach((level, index) =>
    gl.texImage2D(
      gl.TEXTURE_2D,
      index,
      gl.RGBA,
      level.width,
      level.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(level.data.buffer, level.data.byteOffset, level.data.byteLength),
    ),
  )
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.bindTexture(gl.TEXTURE_2D, null)
  shared.sprays = texture
  return texture
}

export type TreeLayerOptions = {
  crossedCards?: 2 | 3
  /** How this layer draws: cards from an atlas (drawn or baked), or a mesh. */
  style: 'billboard' | 'solid'
  /** Required for `solid`. */
  mesh?: ForestMesh
  /** Required for `billboard`. */
  atlas?: ImpostorAtlas
  range?: [number, number, number, number]
  widthScale?: number
  /** Cards are clumps (`impostorClumpShapes`): as wide as the stand's share, not one crown. */
  clumps?: boolean
  /**
   * Far bands: each stem also lays a canopy tile this many metres square over its own ground
   * (`TreeInstance.canopy`), fading in between the two distances of `tileFade`. Cards only, one
   * plane a stem.
   */
  canopyTileMeters?: number
  tileFade?: [number, number]
  /**
   * Far bands: each card runs on this far below its stem's foot, metres, so a crest MapLibre draws
   * lower than the stem was stood on shows no sky under its trees.
   */
  skirtMeters?: number
  /** Far bands: stems are lit by the hill they stand on (`TreeInstance.slope`) as well as as crowns. */
  hillLight?: boolean
  /**
   * How the stems are shaded. `flat` is the original: the drawing's own
   * colours, solids lit by plain Lambert. `lit` shades each card as a crown
   * volume with wrapped light, back-light and crown self-shading. Lighting
   * only: neither changes which pixels a tree covers.
   */
  look?: TreeLook
  /**
   * Solid only: each stem lies along its `headingDegrees` instead of a turn hashed from where it
   * stands (felled trees and logs, `stand/prescribedCells.ts`).
   */
  headings?: boolean
  /**
   * Solid only: the drawing's own foliage and bark (0–1), so a detailed mesh is coloured as its
   * card is and each stem's colour is the card's tint of it. Absent, a stem takes `crownColor`.
   */
  palette?: { foliage: readonly [number, number, number]; bark: readonly [number, number, number] }
  /**
   * The crown base, 0–1 of height, this layer's drawing of each tree was made with: a drawn card's
   * silhouette's, or a mesh's and its baked card's. With it, a stem carrying its own `crownBase`
   * (trial: TASS) is stretched to start its crown there; without it, or for a stem without one, the
   * drawing is used as made.
   */
  crownBaseOf?: (drawing: TreeDrawingId) => number
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
  /** Where the eye stands; with `altitudeMeters`, canopy tiles know when they are seen from above. */
  setEye: (eye: { lng: number; lat: number; altitudeMeters?: number }) => void
  /** Leaves the stems in a wedge from the eye undrawn; null draws them all. */
  setGap: (gap: ViewingGap | null) => void
  /** Leaves stems nearer the eye than this many metres to another layer; 0 draws them all. */
  setNearCut: (meters: number) => void
  /** Where the light comes from, a unit vector in the mercator frame (x east, y south, z up); null the fixed light. */
  setSun: (direction: readonly [number, number, number] | null) => void
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
  let turnBuffer: WebGLBuffer | null = null
  let surfaceTexture: WebGLTexture | null = null
  let sprayTexture: WebGLTexture | null = null
  let sun: readonly [number, number, number] = FIXED_TREE_SUN
  // Looked up once each: a name's place in the program does not change.
  const uniforms = new Map<string, WebGLUniformLocation | null>()
  const uniform = (name: string) => {
    if (!uniforms.has(name)) uniforms.set(name, gl && program ? gl.getUniformLocation(program, name) : null)
    return uniforms.get(name) ?? null
  }
  let crownBaseBuffer: WebGLBuffer | null = null

  let pending: TreeInstance[] | null = null
  let instanceCount = 0
  let meterScale = 1
  let error: string | null = null
  let origin = [0, 0, 0]
  let eye: { lng: number; lat: number; altitudeMeters?: number } = { lng: 0, lat: 0 }
  let groundBuffer: WebGLBuffer | null = null
  let eyeLocation: WebGLUniformLocation | null = null
  let gapLocation: WebGLUniformLocation | null = null
  let gap: ViewingGap | null = null
  let rangeLocation: WebGLUniformLocation | null = null
  let nearCutLocation: WebGLUniformLocation | null = null
  let litLocation: WebGLUniformLocation | null = null
  let topCrownLocation: WebGLUniformLocation | null = null
  let viewLocation: WebGLUniformLocation | null = null
  let nearCut = 0
  const translated = new Float32Array(16)

  const atlas = options.atlas
  const mesh = options.mesh
  const cardPlanes = options.crossedCards ?? 1
  // A far stem's canopy tile is a second plane of its card; a crossed card has no room for one.
  const tile = billboard && cardPlanes === 1 ? (options.canopyTileMeters ?? 0) : 0
  const planes = cardPlanes + (tile > 0 ? 1 : 0)
  const indexCount = billboard ? planes * 6 : (mesh?.indices.value.length ?? 0)

  const upload = (trees: TreeInstance[]) => {
    if (!gl || !offsetBuffer || !scaleBuffer || !thirdBuffer) return

    const offsets = new Float32Array(trees.length * 3)
    const scales = new Float32Array(trees.length * 2)
    // Billboards carry the atlas cell here; solid trees carry a crown colour.
    const third = new Float32Array(trees.length * (billboard ? 2 : 3))
    const tints = billboard ? new Float32Array(trees.length * 3) : null
    const turns = new Float32Array(trees.length)
    const grounds = billboard ? new Float32Array(trees.length * 4) : null
    // The card's tint of its drawing: warmer or cooler, so a stand is not one tree stamped out. A
    // treatment colour goes as itself + 2.
    const tintOf = (tree: TreeInstance): [number, number, number] =>
      tree.tint
        ? [tree.tint[0] + 2, tree.tint[1] + 2, tree.tint[2] + 2]
        : [0.86 + tree.tone * 0.26, 0.9 + (1 - tree.tone) * 0.18, 0.84 + tree.tone * 0.2]

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

      // A card is drawn at one aspect with the drawing's crown filling its
      // crown ratio of the tree's height; stretching it by the stem's own
      // ratio over that gives the crown the width its stand's closure set.
      const drawing = treeDrawing(tree.species, tree.form)
      scales[index * 2] =
        tree.heightMeters *
        (billboard
          ? options.clumps
            ? tree.slenderness * CLUMP_WIDTH_FACTOR * (options.widthScale ?? 1)
            : BILLBOARD_ASPECT * (tree.slenderness / drawingCrownRatio(drawing)) * (options.widthScale ?? 1)
          : tree.slenderness / CONE_BASE_DIAMETER)
      scales[index * 2 + 1] = tree.heightMeters
      // A felled stem lies along its heading (clockwise from north); a standing one takes the turn
      // its place gives it, the same in every layer that draws it.
      turns[index] =
        options.headings && tree.headingDegrees !== undefined
          ? ((90 - tree.headingDegrees) * Math.PI) / 180
          : stemTurn(tree.lng, tree.lat)

      if (grounds) {
        grounds[index * 4] = tree.slope?.[0] ?? 0
        grounds[index * 4 + 1] = tree.slope?.[1] ?? 0
        grounds[index * 4 + 2] = tree.canopy?.reach ?? 0
        grounds[index * 4 + 3] = tree.canopy?.cover ?? 0
      }
      if (billboard && atlas && tints) {
        const [u, v] = atlasCell(atlas, drawing, tree.variant)
        third[index * 2] = u
        third[index * 2 + 1] = v
        // The drawing already carries its colour; this only shifts it a little.
        tints.set(tintOf(tree), index * 3)
      } else if (options.palette) {
        third.set(tintOf(tree), index * 3)
      } else {
        const [red, green, blue] = tree.tint ? tree.tint.map((value) => value * 255) : crownColor(tree.tone)
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
    if (turnBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, turnBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, turns, gl.DYNAMIC_DRAW)
    }
    if (groundBuffer && grounds) {
      gl.bindBuffer(gl.ARRAY_BUFFER, groundBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, grounds, gl.DYNAMIC_DRAW)
    }
    if (tints && tintBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, tintBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, tints, gl.DYNAMIC_DRAW)
    }
    if (crownBaseBuffer) {
      // Zeros draw every stem as made; only a stem with its own crown base, in a layer that knows
      // its drawing's, is stretched.
      const crownBases = new Float32Array(trees.length * 2)
      if (options.crownBaseOf)
        trees.forEach((tree, index) => {
          if (tree.crownBase === undefined || !(tree.crownBase > 0 && tree.crownBase < 1)) return
          crownBases[index * 2] = options.crownBaseOf!(treeDrawing(tree.species, tree.form))
          crownBases[index * 2 + 1] = tree.crownBase
        })
      gl.bindBuffer(gl.ARRAY_BUFFER, crownBaseBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, crownBases, gl.DYNAMIC_DRAW)
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

      const shared = acquireShared(gl)
      try {
        program = sharedProgram(gl, shared, billboard ? 'billboard' : 'solid')
      } catch (linkError) {
        error = linkError instanceof Error ? linkError.message : String(linkError)
        program = null
        releaseShared(gl)
        gl = null
        return
      }
      uniforms.clear()

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
      topCrownLocation = gl.getUniformLocation(program, 'u_topCrown')
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

      // A shader compiler may drop an attribute it finds unused; enabling location −1 is a GL error.
      const crownBaseAttribute = () => {
        const location = attribute('a_crownBase')
        return location >= 0 ? perInstance(location, 2) : null
      }

      if (billboard) {
        // One distant camera-facing card, or fixed foreground planes through the stem.
        const plane = [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]
        const corners = new Float32Array(
          Array.from({ length: planes }, (_, p) => plane.map((v, i) => (i % 3 === 2 ? p : v))).flat(),
        )
        staticBuffer(corners, attribute('a_corner'), 3)
        offsetBuffer = perInstance(attribute('a_offset'), 3)
        scaleBuffer = perInstance(attribute('a_scale'), 2)
        thirdBuffer = perInstance(attribute('a_cell'), 2)
        tintBuffer = perInstance(attribute('a_tint'), 3)
        // Unused on a drawn atlas, where the compiler drops it.
        const turnLocation = attribute('a_turn')
        if (turnLocation >= 0) turnBuffer = perInstance(turnLocation, 1)
        const groundLocation = attribute('a_ground')
        if (groundLocation >= 0) groundBuffer = perInstance(groundLocation, 4)
        crownBaseBuffer = crownBaseAttribute()

        const indexBuffer = gl.createBuffer()
        instanceBuffers.push(indexBuffer!)
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
        gl.bufferData(
          gl.ELEMENT_ARRAY_BUFFER,
          new Uint16Array(Array.from({ length: planes }, (_, p) => [0, 1, 2, 0, 2, 3].map((i) => i + p * 4)).flat()),
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
        turnBuffer = perInstance(attribute('a_turn'), 1)
        // A mesh without foliage cards reads −1 everywhere: no vertex is textured.
        const vertexCount = mesh!.attributes.positions.value.length / 3
        staticBuffer(mesh!.attributes.uvs?.value ?? new Float32Array(vertexCount * 2).fill(-1), attribute('a_uv'), 2)
        crownBaseBuffer = crownBaseAttribute()

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
        } else if (atlas.canvas) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas)
          gl.generateMipmap(gl.TEXTURE_2D)
        }
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        // Clamp, or a crown wraps into the cell on the far side of the atlas.
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        if (atlas.surface) {
          // Normals and the foliage mask are data, not colour: uploaded as they are, never
          // premultiplied, and filtered plainly.
          surfaceTexture = gl.createTexture()
          gl.bindTexture(gl.TEXTURE_2D, surfaceTexture)
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            atlas.surface.width,
            atlas.surface.height,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            new Uint8Array(atlas.surface.data.buffer, atlas.surface.data.byteOffset, atlas.surface.data.byteLength),
          )
          gl.generateMipmap(gl.TEXTURE_2D)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        }
        gl.bindTexture(gl.TEXTURE_2D, null)
      }

      if (!billboard && mesh?.attributes.uvs) sprayTexture = sharedSprays(gl, shared)

      if (pending) {
        upload(pending)
        pending = null
      }
    },

    onRemove() {
      if (!gl) return
      if (vao) gl.deleteVertexArray(vao)
      if (texture) gl.deleteTexture(texture)
      if (surfaceTexture) gl.deleteTexture(surfaceTexture)
      // The program and the spray sheet belong to every tree layer on this map.
      releaseShared(gl)
      uniforms.clear()
      for (const buffer of instanceBuffers) gl.deleteBuffer(buffer)
      instanceBuffers.length = 0
      gl = null
      program = null
      vao = null
      texture = null
      surfaceTexture = null
      sprayTexture = null
      turnBuffer = null
      groundBuffer = null
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
      // The eye's own height rides in z where it is known (one metre is `meterScale` there too).
      const eyeKnown = eye.altitudeMeters !== undefined && Number.isFinite(eye.altitudeMeters)
      gl.uniform3f(
        eyeLocation,
        eyeMercator.x - origin[0],
        eyeMercator.y - origin[1],
        eyeKnown ? (eye.altitudeMeters as number) * meterScale : 0,
      )
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
      gl.uniform3f(uniform('u_sun'), sun[0], sun[1], sun[2])
      // A single tree's card is `BILLBOARD_ASPECT` of its height at the species' crown ratio (a spruce's taken for
      // all); a clump's is `CLUMP_WIDTH_FACTOR` × the crown width it stands for.
      gl.uniform1f(
        topCrownLocation,
        options.clumps ? 1 / CLUMP_WIDTH_FACTOR : SPECIES_CROWN_RATIO.spruce / BILLBOARD_ASPECT,
      )
      // The view direction, read off the matrix as the vertex shader does.
      gl.uniform3f(viewLocation, translated[3], translated[7], translated[11])

      if (billboard && atlas) {
        gl.uniform1f(crossedLocation, cardPlanes)
        gl.uniform2f(cellSizeLocation, 1 / atlas.columns, 1 / atlas.rows)
        gl.uniform1f(uniform('u_views'), atlas.azimuths ?? 0)
        gl.uniform1f(uniform('u_eyeKnown'), eyeKnown ? 1 : 0)
        gl.uniform1f(uniform('u_tile'), tile)
        gl.uniform2fv(uniform('u_tileFade'), options.tileFade ?? [0, 1])
        gl.uniform1f(uniform('u_skirt'), options.skirtMeters ?? 0)
        gl.uniform1f(uniform('u_hill'), options.hillLight ? 1 : 0)
        gl.uniform1f(uniform('u_baked'), surfaceTexture ? 1 : 0)
        gl.activeTexture(gl.TEXTURE1)
        // Bound either way: a sampler left on unit 0 beside the atlas is the same texture, which is harmless.
        gl.bindTexture(gl.TEXTURE_2D, surfaceTexture ?? texture)
        gl.uniform1i(uniform('u_surface'), 1)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.uniform1i(atlasLocation, 0)
      } else if (!billboard) {
        const palette = options.palette
        gl.uniform1f(uniform('u_palette'), palette ? 1 : 0)
        if (palette) {
          gl.uniform3f(uniform('u_foliage'), ...palette.foliage)
          gl.uniform3f(uniform('u_barkColour'), ...palette.bark)
        }
        if (sprayTexture) {
          gl.activeTexture(gl.TEXTURE0)
          gl.bindTexture(gl.TEXTURE_2D, sprayTexture)
          gl.uniform1i(uniform('u_sprays'), 0)
        }
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

    setSun(direction) {
      sun = direction ?? FIXED_TREE_SUN
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
