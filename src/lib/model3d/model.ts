/**
 * A small mesh model that the 3D writers (`glb.ts`, `obj.ts`, `stl.ts`) encode: named parts of
 * triangles in local metres, Z up, with an origin that places the model back in the world and notes
 * that say what was left out. The builders (the road designer's design surfaces, the visual quality
 * scene) fill it; the writers never decide what goes in.
 *
 * Local metres, not world coordinates: the formats store single-precision floats, which hold a
 * BC Albers easting (about 1,200,000 m) only to the nearest 0.1 m, and modelling tools work badly
 * that far from their origin. Subtracting an origin keeps millimetres across a road or a scene.
 *
 * No DOM or network access.
 */

/** sRGB colour, 0–1 per channel: what a colour picker or a hex code gives. */
export type Rgb = readonly [number, number, number]

/** Values a part carries into glTF `extras` and OBJ comments. */
export type ModelAttributes = Record<string, string | number | boolean | null>

export interface MeshPart {
  /** The object's name in the modelling tool. */
  name: string
  /** x, y, z per vertex: local metres, x east, y north, z up. */
  positions: ArrayLike<number>
  /** Three vertex indices (zero-based) per triangle, counter-clockwise seen from the side the face shows. */
  indices: ArrayLike<number>
  /**
   * Unit normals, x, y, z per vertex, when the part is smooth-shaded. Absent, every reader shades
   * the part flat (glTF requires it of a reader; STL is always flat).
   */
  normals?: ArrayLike<number>
  color: Rgb
  /** Drawn from both sides (glTF `doubleSided`): an open surface a viewer may look at from below. */
  doubleSided?: boolean
  attributes?: ModelAttributes
}

/** Where the local (0, 0, 0) is in the world. Local x, y, z are world coordinates less these. */
export type ModelOrigin =
  | {
      kind: 'grid'
      /** The projected CRS whose grid metres the local frame was cut from: true shape, no rotation or scale. */
      epsg: number
      easting: number
      northing: number
      elevation: number
      verticalDatum?: string
    }
  | {
      kind: 'lonlat'
      /** A plane tangent at this point: local x is metres east of it, y metres north. */
      longitude: number
      latitude: number
      elevation: number
      verticalDatum?: string
    }

export interface Model3d {
  name: string
  parts: MeshPart[]
  origin: ModelOrigin
  /** What the model is and is not: printed in every file that has room for text. */
  notes: string[]
  /** More JSON for the glTF root (`extras`): a builder's own record, such as the scene's camera. */
  extras?: Record<string, unknown>
}

export type ModelFormat = 'glb' | 'obj' | 'stl'

/** A `#rrggbb` (or `#rgb`) colour as sRGB 0–1. */
export function hexColor(hex: string): Rgb {
  const text = hex.replace(/^#/, '')
  const full =
    text.length === 3
      ? text
          .split('')
          .map((c) => c + c)
          .join('')
      : text
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw Error(`Not a colour: ${hex}`)
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as unknown as Rgb
}

/** sRGB to linear light, the space glTF's material factors are in. */
export function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

/**
 * Z-up to the Y-up frame glTF requires and OBJ readers assume: x stays east, up becomes y, north
 * becomes −z. A rotation, so winding (and with it which side a face shows) is unchanged.
 */
export function yUp(x: number, y: number, z: number): [number, number, number] {
  // `0 - y`, not `-y`: north 0 stays +0 rather than −0, which JSON bounds would print as 0 and miss.
  return [x, z, 0 - y]
}

export function triangleCount(model: Pick<Model3d, 'parts'>): number {
  return model.parts.reduce((sum, part) => sum + Math.floor(part.indices.length / 3), 0)
}

/** Parts a writer can encode: at least one triangle. The rest are named in the writer's notes. */
export function drawableParts(model: Pick<Model3d, 'parts'>): { parts: MeshPart[]; empty: string[] } {
  const parts: MeshPart[] = [],
    empty: string[] = []
  for (const part of model.parts)
    if (part.indices.length >= 3) parts.push(part)
    else empty.push(part.name)
  return { parts, empty }
}

/**
 * Refuses a part a reader would choke on rather than writing a broken file: a builder bug, never the
 * person's data, so it throws.
 */
export function checkPart(part: MeshPart): void {
  const vertices = part.positions.length / 3
  if (!Number.isInteger(vertices)) throw Error(`${part.name}: positions are not x, y, z triples.`)
  if (part.indices.length % 3) throw Error(`${part.name}: indices are not triangles.`)
  if (part.normals && part.normals.length !== part.positions.length)
    throw Error(`${part.name}: normals do not match the positions.`)
  for (let i = 0; i < part.positions.length; i++)
    if (!Number.isFinite(part.positions[i])) throw Error(`${part.name}: a position is not a number.`)
  for (let i = 0; i < part.indices.length; i++) {
    const index = part.indices[i]
    if (!Number.isInteger(index) || index < 0 || index >= vertices)
      throw Error(`${part.name}: index ${index} is outside its ${vertices} vertices.`)
  }
}

/** A triangle's unit normal (right-hand rule, counter-clockwise); [0, 0, 0] when it has no area. */
export function faceNormal(p: ArrayLike<number>, a: number, b: number, c: number): [number, number, number] {
  const ux = p[b * 3] - p[a * 3],
    uy = p[b * 3 + 1] - p[a * 3 + 1],
    uz = p[b * 3 + 2] - p[a * 3 + 2]
  const vx = p[c * 3] - p[a * 3],
    vy = p[c * 3 + 1] - p[a * 3 + 1],
    vz = p[c * 3 + 2] - p[a * 3 + 2]
  const nx = uy * vz - uz * vy,
    ny = uz * vx - ux * vz,
    nz = ux * vy - uy * vx
  const length = Math.hypot(nx, ny, nz)
  return length > 0 ? [nx / length, ny / length, nz / length] : [0, 0, 0]
}

const fmt = (value: number, digits: number) => {
  const text = value.toFixed(digits)
  return Number(text) === 0 ? '0' : text
}

/** One sentence placing the local frame back in the world, for notes, comments and headers. */
export function originDescription(origin: ModelOrigin): string {
  const datum = origin.verticalDatum ? ` (${origin.verticalDatum})` : ''
  if (origin.kind === 'grid')
    return (
      `Local (0, 0, 0) is EPSG:${origin.epsg} easting ${fmt(origin.easting, 3)}, northing ${fmt(origin.northing, 3)}, ` +
      `elevation ${fmt(origin.elevation, 3)} m${datum}: add them back to local x (east), y (north) and z (up); ` +
      'true shape, no rotation or scale.'
    )
  return (
    `Local (0, 0, 0) is longitude ${fmt(origin.longitude, 7)}, latitude ${fmt(origin.latitude, 7)}, ` +
    `elevation ${fmt(origin.elevation, 3)} m${datum}: local x is metres east and y metres north on a plane tangent ` +
    'there, z metres above that elevation.'
  )
}

/** The origin and frame as JSON, for glTF `extras`. */
export function originExtras(model: Pick<Model3d, 'origin'>): Record<string, unknown> {
  return {
    origin: { ...model.origin },
    units: 'metres',
    frame: 'glTF Y up: x east, y up, z south (−north); the source frame is x east, y north, z up',
    placement: originDescription(model.origin),
  }
}

/** A name safe as a file's base: no path separators or characters filesystems refuse. */
export function fileBaseName(name: string): string {
  const base = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return base || 'model'
}
