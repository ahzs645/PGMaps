/**
 * Standing timber, as geometry.
 *
 * The map answers the question in percentages; this answers it the way a person
 * checks it, by standing on the road and looking. A cutblock read as a coloured
 * polygon on a hillside is an abstraction — a cutblock read as the gap where the
 * trees stop is the thing the objective is actually about.
 *
 * So the trees are not decoration. They are placed on the ground the stand
 * covers and removed from the ground the block takes, which makes the opening
 * visible as an opening. Where the province has surveyed the ground, they are
 * the species and height it recorded; elsewhere they fall back to a regional
 * mix, and the page says which. Everything here is our own geometry, drawn over
 * MapLibre's terrain.
 */

import { pointInPolygon, polygonBounds, type PolygonGeometry } from './visibility'

/** The species a BC interior stand is actually made of. */
export type TreeSpeciesId = 'pine' | 'spruce' | 'fir' | 'aspen'

export const TREE_SPECIES_IDS: TreeSpeciesId[] = ['pine', 'spruce', 'fir', 'aspen']

/** Drawn silhouettes per species, so a stand is not one tree repeated. */
export const VARIANTS_PER_SPECIES = 4

/**
 * Roughly a managed SBS/ESSF landscape west of Prince George: pine-leading,
 * spruce and subalpine fir through it, a little aspen on the better sites.
 * A drawn mix, not a cruise — it changes how the stand reads, not any number.
 */
export const DEFAULT_SPECIES_MIX: ReadonlyArray<{ species: TreeSpeciesId; share: number }> = [
  { species: 'pine', share: 0.42 },
  { species: 'spruce', share: 0.28 },
  { species: 'fir', share: 0.18 },
  { species: 'aspen', share: 0.12 },
]

/** Crown width over tree height, by species. Drives the solid-cone geometry. */
export const SPECIES_CROWN_RATIO: Record<TreeSpeciesId, number> = {
  pine: 0.3,
  spruce: 0.34,
  fir: 0.25,
  aspen: 0.44,
}

export type TreeInstance = {
  lng: number
  lat: number
  /** Ground elevation at the stem, in metres. Filled by the caller from the terrain. */
  elevationMeters: number
  heightMeters: number
  /** Crown width relative to height — a fir is narrow, an aspen broad. */
  slenderness: number
  /** 0–1, varies the crown colour so a stand does not read as one flat green. */
  tone: number
  species: TreeSpeciesId
  /** Which drawn silhouette of that species this stem uses. */
  variant: number
}

/**
 * BC inventory species codes, onto the four the page draws.
 *
 * The inventory records dozens of species and this draws four silhouettes, so
 * each code maps to the one it most resembles from a road: anything spire-like
 * and shade-tolerant reads as fir, the true firs and Douglas-fir included;
 * broadleaves read as aspen. A drawing decision, not a taxonomy.
 */
const SPECIES_CODE_MAP: Record<string, TreeSpeciesId> = {
  // Pines
  PL: 'pine',
  PLI: 'pine',
  P: 'pine',
  PY: 'pine',
  PW: 'pine',
  PA: 'pine',
  // Spruces
  S: 'spruce',
  SX: 'spruce',
  SE: 'spruce',
  SW: 'spruce',
  SB: 'spruce',
  SS: 'spruce',
  // Firs, true and Douglas, plus hemlock and cedar — narrow crowns from a road
  BL: 'fir',
  B: 'fir',
  BA: 'fir',
  BG: 'fir',
  FD: 'fir',
  FDI: 'fir',
  F: 'fir',
  HW: 'fir',
  H: 'fir',
  CW: 'fir',
  C: 'fir',
  // Broadleaves
  AT: 'aspen',
  AC: 'aspen',
  ACT: 'aspen',
  A: 'aspen',
  EP: 'aspen',
  E: 'aspen',
  MB: 'aspen',
  DR: 'aspen',
  W: 'aspen',
}

/** The drawn species for an inventory code, or null where it is not one we draw. */
export function speciesFromCode(code: string | null | undefined): TreeSpeciesId | null {
  if (!code) return null
  const key = code.trim().toUpperCase()
  // Codes carry a leading-species suffix in places (`PLI`, `FDI`); try the full
  // code, then the two-letter stem, then the genus letter.
  return SPECIES_CODE_MAP[key] ?? SPECIES_CODE_MAP[key.slice(0, 2)] ?? SPECIES_CODE_MAP[key.slice(0, 1)] ?? null
}

/** Picks a species from a mix, given a value in [0, 1). */
export function speciesFromMix(
  value: number,
  mix: ReadonlyArray<{ species: TreeSpeciesId; share: number }> = DEFAULT_SPECIES_MIX,
): TreeSpeciesId {
  const total = mix.reduce((sum, entry) => sum + Math.max(0, entry.share), 0)
  if (total <= 0) return 'pine'
  let running = 0
  const target = Math.max(0, Math.min(0.999999, value)) * total
  for (const entry of mix) {
    running += Math.max(0, entry.share)
    if (target < running) return entry.species
  }
  return mix[mix.length - 1].species
}

/** Deck.gl's plain-object mesh form, which carries indices through. */
export type ForestMesh = {
  attributes: {
    positions: { size: 3; value: Float32Array }
    normals: { size: 3; value: Float32Array }
    bark?: { size: 1; value: Float32Array }
  }
  indices: { size: 1; value: Uint16Array }
}

/** Deterministic noise, so a stand does not shimmer as the camera moves. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A stable seed for a position, so the same ground grows the same trees. */
function seedForCell(x: number, y: number, seed: number): number {
  return (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ seed) >>> 0
}

export type ConiferOptions = {
  /** Cones stacked up the stem. Three reads as a conifer; one reads as a traffic cone. */
  whorls?: number
  /** Sides per cone. Seven is enough at the distance a tree is ever seen from. */
  radialSegments?: number
}

/**
 * A unit conifer: 1 m tall, standing on z = 0, with +z up.
 *
 * Instances scale it to their own height, so the mesh is built once and drawn
 * tens of thousands of times.
 */
export function coniferMesh({ whorls = 3, radialSegments = 7 }: ConiferOptions = {}): ForestMesh {
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []

  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    positions.push(x, y, z)
    normals.push(nx, ny, nz)
    return positions.length / 3 - 1
  }

  // Trunk: a short prism below the lowest branches. Bare stem is most of what
  // you see of a mature stand from underneath.
  const trunkRadius = 0.012
  const trunkTop = 0.22
  const trunkBase: number[] = []
  const trunkCap: number[] = []
  for (let segment = 0; segment < radialSegments; segment += 1) {
    const angle = (segment / radialSegments) * Math.PI * 2
    const nx = Math.cos(angle)
    const ny = Math.sin(angle)
    trunkBase.push(push(nx * trunkRadius, ny * trunkRadius, 0, nx, ny, 0))
    trunkCap.push(push(nx * trunkRadius, ny * trunkRadius, trunkTop, nx, ny, 0))
  }
  for (let segment = 0; segment < radialSegments; segment += 1) {
    const next = (segment + 1) % radialSegments
    indices.push(trunkBase[segment], trunkBase[next], trunkCap[segment])
    indices.push(trunkCap[segment], trunkBase[next], trunkCap[next])
  }

  // Crown: overlapping cones, each narrower and shorter than the one below, so
  // the silhouette tapers the way a conifer does rather than in one straight line.
  const crownBottom = 0.16
  const crownSpan = 1 - crownBottom
  for (let whorl = 0; whorl < whorls; whorl += 1) {
    const t = whorl / whorls
    const base = crownBottom + crownSpan * t
    // Each cone runs well past the start of the one above it, which is what
    // gives the stepped edge a conifer reads by.
    const apex = Math.min(1, base + (crownSpan / whorls) * 2.1)
    const radius = 0.5 * (1 - t) ** 1.25 + 0.06
    const height = apex - base

    for (let segment = 0; segment < radialSegments; segment += 1) {
      const angleFrom = (segment / radialSegments) * Math.PI * 2
      const angleTo = ((segment + 1) / radialSegments) * Math.PI * 2

      // A cone's outward normal leans back by the ratio of radius to height.
      const normalAt = (angle: number): [number, number, number] => {
        const length = Math.hypot(height, radius)
        return [(Math.cos(angle) * height) / length, (Math.sin(angle) * height) / length, radius / length]
      }
      const [ax, ay, az] = normalAt((angleFrom + angleTo) / 2)
      const [fx, fy, fz] = normalAt(angleFrom)
      const [tx, ty, tz] = normalAt(angleTo)

      indices.push(
        push(0, 0, apex, ax, ay, az),
        push(Math.cos(angleFrom) * radius, Math.sin(angleFrom) * radius, base, fx, fy, fz),
        push(Math.cos(angleTo) * radius, Math.sin(angleTo) * radius, base, tx, ty, tz),
      )
    }
  }

  return {
    attributes: {
      positions: { size: 3, value: new Float32Array(positions) },
      normals: { size: 3, value: new Float32Array(normals) },
    },
    indices: { size: 1, value: new Uint16Array(indices) },
  }
}

export type TreePlacementOptions = {
  /** Ground trees may stand on. Empty means the whole patch is forested. */
  stands: PolygonGeometry[]
  /** Ground with no trees on it — the block, and anything already harvested. */
  clearings: PolygonGeometry[]
  /** Centre of the patch to grow, usually where the camera is. */
  centre: { lng: number; lat: number }
  radiusMeters: number
  /**
   * Leaves the middle empty, so a coarse far patch can be laid around a fine
   * near one without the two overlapping.
   */
  innerRadiusMeters?: number
  /** Mean distance between stems. About 3 m is a stocked interior stand. */
  spacingMeters?: number
  /** Mean height of the stand, in metres. */
  heightMeters?: number
  /** Hard ceiling, so a wide patch cannot stall the frame. */
  maxTrees?: number
  /** Species composition of the stand. Defaults to a BC interior mix. */
  speciesMix?: ReadonlyArray<{ species: TreeSpeciesId; share: number }>
  /**
   * Stands the inventory actually recorded. Where one covers a stem, its
   * species and height are used in place of the mix and the default height —
   * so the drawn stand is the stand on the ground wherever the province has
   * surveyed it, and a regional guess only where it has not.
   */
  inventory?: ReadonlyArray<InventoryStand>
  seed?: number
  /** Fixed for a preview, including when it crosses a latitude band. */
  anchorLatitude?: number
}

/** A surveyed stand, reduced to what the drawing needs. */
export type InventoryStand = {
  geometry: PolygonGeometry
  species: TreeSpeciesId | null
  heightMeters: number | null
  /** Fraction regenerated in a partial harvest; remaining stems use the regional mature height. */
  regenerationFraction?: number
}

const METERS_PER_DEGREE_LAT = 111_320

/**
 * Grows a patch of forest around a point.
 *
 * Stems sit on a jittered grid rather than at random: true randomness clumps,
 * and a clumped stand has holes you can see a cutblock through that are not
 * really there. Each cell's jitter is seeded from its own coordinates, so the
 * patch is identical every time it is regenerated and the forest does not
 * crawl as the camera moves through it.
 */
export function placeTrees({
  stands,
  clearings,
  centre,
  radiusMeters,
  innerRadiusMeters = 0,
  spacingMeters = 3.2,
  heightMeters = 28,
  maxTrees = 60_000,
  speciesMix = DEFAULT_SPECIES_MIX,
  inventory = [],
  seed = 1,
  anchorLatitude,
}: TreePlacementOptions): TreeInstance[] {
  if (radiusMeters <= 0 || spacingMeters <= 0) return []

  // How many metres a degree of longitude is worth sets the grid spacing, and
  // it varies with latitude — so taken from the camera it would rescale the
  // whole grid every time the camera moved north, and the forest would crawl.
  // Quantising to a quarter degree pins it: about 28 km of driving on one grid,
  // for a spacing error under half a percent.
  const anchorLat = anchorLatitude ?? Math.round(centre.lat * 4) / 4
  const latScale = Math.max(0.05, Math.cos((anchorLat * Math.PI) / 180))
  const metersPerDegreeLng = METERS_PER_DEGREE_LAT * latScale

  // Widen the spacing rather than truncate the patch: a thinner forest over the
  // whole view reads better than a dense one that stops in mid-air.
  const cellsAcross = (radiusMeters * 2) / spacingMeters
  const spacing = cellsAcross * cellsAcross > maxTrees ? (radiusMeters * 2) / Math.sqrt(maxTrees) : spacingMeters

  const stepLat = spacing / METERS_PER_DEGREE_LAT
  const stepLng = spacing / metersPerDegreeLng
  const halfLat = radiusMeters / METERS_PER_DEGREE_LAT
  const halfLng = radiusMeters / metersPerDegreeLng

  // Anchor the grid to absolute coordinates, not to the centre, so a moving
  // camera regenerates the same stems in the ground it already covered.
  const firstCellX = Math.floor((centre.lng - halfLng) / stepLng)
  const lastCellX = Math.ceil((centre.lng + halfLng) / stepLng)
  const firstCellY = Math.floor((centre.lat - halfLat) / stepLat)
  const lastCellY = Math.ceil((centre.lat + halfLat) / stepLat)

  // Bounding boxes first: a point-in-polygon test per stem per polygon is the
  // one thing here that gets expensive.
  const standBoxes = stands.map((stand) => polygonBounds(stand))
  const clearingBoxes = clearings.map((clearing) => polygonBounds(clearing))
  const inventoryBoxes = inventory.map((stand) => polygonBounds(stand.geometry))
  const surveyedAt = (lng: number, lat: number): InventoryStand | null => {
    for (let index = 0; index < inventory.length; index += 1) {
      const box = inventoryBoxes[index]
      if (lng < box[0] || lng > box[2] || lat < box[1] || lat > box[3]) continue
      if (pointInPolygon(inventory[index].geometry, lng, lat)) return inventory[index]
    }
    return null
  }
  const inside = (
    polygons: PolygonGeometry[],
    boxes: Array<[number, number, number, number]>,
    lng: number,
    lat: number,
  ) =>
    polygons.some((polygon, index) => {
      const box = boxes[index]
      if (lng < box[0] || lng > box[2] || lat < box[1] || lat > box[3]) return false
      return pointInPolygon(polygon, lng, lat)
    })

  const trees: TreeInstance[] = []
  const radiusLatSquared = halfLat * halfLat
  const innerLat = Math.max(0, innerRadiusMeters) / METERS_PER_DEGREE_LAT
  const innerLatSquared = innerLat * innerLat

  for (let cellY = firstCellY; cellY <= lastCellY; cellY += 1) {
    for (let cellX = firstCellX; cellX <= lastCellX; cellX += 1) {
      const random = mulberry32(seedForCell(cellX, cellY, seed))
      const lng = (cellX + 0.5 + (random() - 0.5) * 0.85) * stepLng
      const lat = (cellY + 0.5 + (random() - 0.5) * 0.85) * stepLat

      // Round rather than square, so the forest fades out at an even distance
      // instead of reaching further at the corners of the view.
      const deltaLat = lat - centre.lat
      const deltaLng = ((lng - centre.lng) * metersPerDegreeLng) / METERS_PER_DEGREE_LAT
      const distanceSquared = deltaLat * deltaLat + deltaLng * deltaLng
      if (distanceSquared > radiusLatSquared || distanceSquared < innerLatSquared) continue

      if (stands.length > 0 && !inside(stands, standBoxes, lng, lat)) continue
      if (inside(clearings, clearingBoxes, lng, lat)) continue

      // A gap in a real stand is a blowdown or a wet spot, not a lawn.
      if (random() < 0.06) continue

      // Where the province has surveyed this ground, draw what it recorded.
      const surveyed = inventory.length > 0 ? surveyedAt(lng, lat) : null
      const species = surveyed?.species ?? speciesFromMix(random(), speciesMix)
      const fraction = surveyed?.regenerationFraction ?? 1
      const retained = fraction < 1 && random() >= fraction
      const standHeight = retained ? heightMeters : surveyed?.heightMeters ?? heightMeters
      if (standHeight <= 0) continue
      trees.push({
        lng,
        lat,
        elevationMeters: 0,
        heightMeters: standHeight * (0.55 + random() * 0.75),
        // Species sets the crown, with a little spread inside it — no two trees
        // in a stand are the same shape.
        slenderness: SPECIES_CROWN_RATIO[species] * (0.85 + random() * 0.3),
        tone: random(),
        species,
        variant: Math.floor(random() * VARIANTS_PER_SPECIES) % VARIANTS_PER_SPECIES,
      })
      if (trees.length >= maxTrees) return trees
    }
  }

  return trees
}

/**
 * A polygon the width of a road, along a road.
 *
 * Without it the camera stands inside the timber and the drive shows nothing but
 * the trunk in front of it — which is not what standing on a road looks like.
 * The offset is taken per vertex along the bisector of the two segments meeting
 * there, which is exact on a straight run and close enough on the curves a
 * forest road actually has.
 */
export function bufferLine(
  line: ReadonlyArray<readonly [number, number]>,
  halfWidthMeters: number,
): GeoJSON.Polygon | null {
  if (line.length < 2 || halfWidthMeters <= 0) return null

  const latScale = Math.max(0.05, Math.cos((line[0][1] * Math.PI) / 180))
  const halfLat = halfWidthMeters / METERS_PER_DEGREE_LAT
  const halfLng = halfLat / latScale

  const left: Array<[number, number]> = []
  const right: Array<[number, number]> = []

  for (let index = 0; index < line.length; index += 1) {
    const previous = line[Math.max(0, index - 1)]
    const next = line[Math.min(line.length - 1, index + 1)]
    // Work in a locally isotropic frame so the perpendicular is square to the
    // road on the ground rather than square in degrees.
    const dx = (next[0] - previous[0]) * latScale
    const dy = next[1] - previous[1]
    const length = Math.hypot(dx, dy)
    if (length === 0) continue

    const normalLng = (-dy / length) * halfLng
    const normalLat = (dx / length) * halfLat
    left.push([line[index][0] + normalLng, line[index][1] + normalLat])
    right.push([line[index][0] - normalLng, line[index][1] - normalLat])
  }
  if (left.length < 2) return null

  const ring = [...left, ...right.reverse()]
  ring.push([...ring[0]] as [number, number])
  return { type: 'Polygon', coordinates: [ring] }
}

/** Crown colour, from a dull blue-green to a warm one. */
export function crownColor(tone: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, tone))
  return [Math.round(28 + t * 46), Math.round(68 + t * 54), Math.round(44 + t * 28)]
}
