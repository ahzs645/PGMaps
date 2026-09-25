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
import type { TargetPolygon } from './types'

/** The species a BC interior stand is actually made of. */
export type TreeSpeciesId = 'pine' | 'spruce' | 'fir' | 'aspen' | 'birch'

export const TREE_SPECIES_IDS: TreeSpeciesId[] = ['pine', 'spruce', 'fir', 'aspen', 'birch']

/** Broadleaves draw as a rounded crown on a pale stem rather than as tiers. */
export const isBroadleaf = (species: TreeSpeciesId) => species === 'aspen' || species === 'birch'

/** Drawn silhouettes per species, so a stand is not one tree repeated. */
export const VARIANTS_PER_SPECIES = 4

/**
 * Leading species of mature stands around Prince George, by area, from the
 * province's VRI (rank 1, treed, 60+ years and 15+ m, a 0.6° × 0.35° box on
 * the city, queried September 2026): interior spruce 37%, trembling aspen 19%
 * and cottonwood 4%, subalpine fir 17% and Douglas-fir 6%, paper birch 13%.
 * Lodgepole pine barely leads a mature stand here any more — the beetle took
 * it — so it is kept only as a trace. A drawn mix, not a cruise: it changes how
 * the stand reads, not any number.
 */
export const DEFAULT_SPECIES_MIX: ReadonlyArray<{ species: TreeSpeciesId; share: number }> = [
  { species: 'spruce', share: 0.37 },
  { species: 'fir', share: 0.23 },
  { species: 'aspen', share: 0.21 },
  { species: 'birch', share: 0.13 },
  { species: 'pine', share: 0.06 },
]

/**
 * A mature stand around Prince George when the inventory says nothing about
 * the ground under a stem. Medians of the same VRI query: 426 live stems/ha
 * region-wide, 548 beside the sample valley road and 664 on Tabor Mountain's
 * west face; crown closure 45–50%; height 21–26 m. 550 stems/ha, 45% and 25 m
 * sit inside all three.
 */
export const REGIONAL_STAND = { stemsPerHa: 550, crownClosurePercent: 45, heightMeters: 25 } as const

/**
 * Crown width over tree height, by species, as drawn in a silhouette. A stem's
 * actual crown width is set by its stand's crown closure (see `placeTrees`);
 * these say how the species differ from each other within it, and are drawn
 * near what that closure gives — 45% at 550 stems/ha is a 3.7 m crown on a
 * 25 m stand, 0.15 — so a near card is not squeezed into a column.
 */
export const SPECIES_CROWN_RATIO: Record<TreeSpeciesId, number> = {
  pine: 0.14,
  spruce: 0.17,
  fir: 0.12,
  aspen: 0.22,
  birch: 0.2,
}

/** The share-weighted mean crown ratio of a mix, so its species' widths average to the stand's. */
function meanCrownRatio(mix: ReadonlyArray<{ species: TreeSpeciesId; share: number }>): number {
  const total = mix.reduce((sum, entry) => sum + Math.max(0, entry.share), 0)
  if (!(total > 0)) return SPECIES_CROWN_RATIO.spruce
  return mix.reduce((sum, entry) => sum + Math.max(0, entry.share) * SPECIES_CROWN_RATIO[entry.species], 0) / total
}

/**
 * Stems are drawn at `standHeight × U(0.55, 1.3)` and a crown scales with its
 * stem, so crown area averages E[(0.55 + 0.75U)²] = 0.9025 of the stand-height
 * crown's. Widening by 1/√0.9025 puts the mean area back where closure wants it.
 */
const HEIGHT_SPREAD_WIDTH = 1 / Math.sqrt(0.9025)

/**
 * `crownWidthForClosure` assumes crowns fall at random. Drawn stems sit on a
 * jittered grid and overlap less, so the same crowns close more of the ground:
 * measured on a 0.5 m raster, 45% asked for drew as 53%. This shrinks crown
 * area until the drawn closure is the one asked for (see the raster test in
 * `forest.test.ts`).
 */
export const GRID_CROWN_AREA = 0.8

/**
 * A stand closes its canopy as it grows. Regeneration the inventory gives no
 * closure for is not drawn at a mature stand's, which would give 1.5 m
 * seedlings 3.6 m crowns: closure is taken to rise with height to the
 * regional value at this height.
 */
const CANOPY_CLOSES_AT_METERS = 12

/**
 * A drawn crown is at most this many times its tree's height wide. Past it a
 * card stops reading as vegetation: without the cap, a coarse far band of
 * young stems drew 100 m strips a metre tall.
 */
const MAX_CROWN_TO_HEIGHT = 4

/**
 * Crown diameter that gives a stand its recorded crown closure, drawn at a
 * given stem density. Crowns placed at random overlap, so closure follows
 * 1 − exp(−N·a) (N stems per m², a one crown's area) rather than N·a: 45%
 * closure at 550 stems/ha is a 3.7 m crown, which is what a 25 m interior
 * spruce carries. At a coarse far spacing the same closure needs a crown far
 * wider than a tree — one drawn stem there stands for a clump.
 */
export function crownWidthForClosure(crownClosurePercent: number, stemsPerSquareMeter: number): number {
  const closure = Math.min(0.9, Math.max(0.05, crownClosurePercent / 100))
  if (!(stemsPerSquareMeter > 0)) return 0
  return 2 * Math.sqrt(-Math.log(1 - closure) / (Math.PI * stemsPerSquareMeter))
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
  EP: 'birch',
  EA: 'birch',
  E: 'birch',
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

/**
 * The unit cone's widest diameter: its lowest whorl has radius 0.5 + 0.06.
 * The tree layer divides by it so a solid crown is as wide as its stem's
 * `slenderness` says, the same as a billboard's.
 */
export const CONE_BASE_DIAMETER = 1.12

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
  /** Live stems per hectare where no surveyed stand says otherwise. */
  stemsPerHa?: number
  /** Crown closure, percent, where no surveyed stand says otherwise. */
  crownClosurePercent?: number
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
  /**
   * Blocks cut but not cleared: dispersed retention and partial cuts. A stem
   * in one survives with probability `keepFraction`, and a partial cut's
   * residual trees stand at the height recorded for them.
   */
  thinnings?: ReadonlyArray<Thinning>
  seed?: number
  /** Fixed for a preview, including when it crosses a latitude band. */
  anchorLatitude?: number
}

export type Thinning = { geometry: PolygonGeometry; keepFraction: number; heightMeters?: number | null }

/** Share of a partial cut drawn standing when its volume removed is not recorded yet. */
const UNRECORDED_PARTIAL_KEEP = 0.5

/**
 * How a block's harvest is drawn, or null for a clearcut. Retention keeps its
 * recorded share of stems at the stand's own height. A partial cut keeps the
 * volume it did not remove, drawn as that share of stems (volume and stem
 * count are not the same thing, but the view cannot tell them apart), at the
 * residual height the reviewer entered.
 */
export function blockThinning(
  block: Pick<TargetPolygon, 'geometry' | 'harvestSystem' | 'retentionPercent' | 'volumeRemovedPercent' | 'residualHeightMeters'>,
): Thinning | null {
  if (block.harvestSystem === 'retention') {
    const keep = (block.retentionPercent ?? 0) / 100
    return keep > 0 ? { geometry: block.geometry, keepFraction: Math.min(1, keep) } : null
  }
  if (block.harvestSystem === 'partial') {
    const keep = block.volumeRemovedPercent != null ? 1 - block.volumeRemovedPercent / 100 : UNRECORDED_PARTIAL_KEEP
    return { geometry: block.geometry, keepFraction: Math.max(0, Math.min(1, keep)), heightMeters: block.residualHeightMeters ?? null }
  }
  return null
}

/** A surveyed stand, reduced to what the drawing needs. */
export type InventoryStand = {
  geometry: PolygonGeometry
  species: TreeSpeciesId | null
  heightMeters: number | null
  /** Fraction regenerated in a partial harvest; remaining stems use the regional mature height. */
  regenerationFraction?: number
  /** VRI's live stems per hectare and crown closure, where it recorded them. */
  stemsPerHa?: number | null
  crownClosurePercent?: number | null
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
  heightMeters = REGIONAL_STAND.heightMeters,
  stemsPerHa = REGIONAL_STAND.stemsPerHa,
  crownClosurePercent = REGIONAL_STAND.crownClosurePercent,
  maxTrees = 60_000,
  speciesMix = DEFAULT_SPECIES_MIX,
  inventory = [],
  thinnings = [],
  seed = 1,
  anchorLatitude,
}: TreePlacementOptions): TreeInstance[] {
  if (radiusMeters <= 0 || spacingMeters <= 0) return []
  const mixRatio = meanCrownRatio(speciesMix)

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
  const thinningBoxes = thinnings.map((thinning) => polygonBounds(thinning.geometry))
  const thinnedAt = (lng: number, lat: number): Thinning | null => {
    for (let index = 0; index < thinnings.length; index += 1) {
      const box = thinningBoxes[index]
      if (lng < box[0] || lng > box[2] || lat < box[1] || lat > box[3]) continue
      if (pointInPolygon(thinnings[index].geometry, lng, lat)) return thinnings[index]
    }
    return null
  }
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

      // Where the province has surveyed this ground, draw what it recorded.
      const surveyed = inventory.length > 0 ? surveyedAt(lng, lat) : null

      // Each cell holds a stem with the chance that gives the stand its stem
      // count at this spacing. A coarse band cannot hold them all, so it keeps
      // every cell but a few gaps (a blowdown, a wet spot) and widens the
      // crowns below to close the canopy the same amount.
      // A recorded 0 on ground the inventory calls treed is a gap in the
      // record, not a bare stand, so it falls back like a missing value.
      const standStems = surveyed?.stemsPerHa && surveyed.stemsPerHa > 0 ? surveyed.stemsPerHa : stemsPerHa
      const keep = Math.min(0.94, (standStems * spacing * spacing) / 10_000)
      if (random() >= keep) continue
      const recordedClosure = surveyed?.crownClosurePercent && surveyed.crownClosurePercent > 0 ? surveyed.crownClosurePercent : null

      // Its own draw, so thinning one block leaves every other stem in place.
      const thinned = thinnings.length > 0 ? thinnedAt(lng, lat) : null
      if (thinned && mulberry32(seedForCell(cellX, cellY, seed + 7919))() >= thinned.keepFraction) continue

      const species = surveyed?.species ?? speciesFromMix(random(), speciesMix)
      const fraction = surveyed?.regenerationFraction ?? 1
      const retained = fraction < 1 && random() >= fraction
      const standHeight = thinned?.heightMeters ?? (retained ? heightMeters : surveyed?.heightMeters ?? heightMeters)
      if (standHeight <= 0) continue
      // A partial cut's residuals are mature trees, only shorter: they keep the stand's closure.
      const standClosure =
        recordedClosure ??
        (thinned?.heightMeters ? crownClosurePercent : crownClosurePercent * Math.min(1, standHeight / CANOPY_CLOSES_AT_METERS))
      // The crown the stand's closure calls for at the density drawn here —
      // before any thinning, which opens the canopy rather than shrinking it.
      const crownWidth =
        crownWidthForClosure(standClosure, keep / (spacing * spacing)) * HEIGHT_SPREAD_WIDTH * Math.sqrt(GRID_CROWN_AREA)
      // Species shares the stand's width out: relative to the mix's own mean
      // where the mix chose it, and not at all where a surveyed stand is one
      // species throughout — its crowns are the stand's crowns.
      const speciesShare = surveyed?.species ? 1 : SPECIES_CROWN_RATIO[species] / mixRatio
      trees.push({
        lng,
        lat,
        elevationMeters: 0,
        heightMeters: standHeight * (0.55 + random() * 0.75),
        // Width over height, so a tall stem in the stand carries a wide crown.
        // Species shares it out, with a little spread — no two trees in a stand
        // are the same shape.
        slenderness: Math.min(MAX_CROWN_TO_HEIGHT, (crownWidth / standHeight) * speciesShare * (0.85 + random() * 0.3)),
        tone: random(),
        species,
        variant: Math.floor(random() * VARIANTS_PER_SPECIES) % VARIANTS_PER_SPECIES,
      })
      if (trees.length >= maxTrees) return trees
    }
  }

  return trees
}

export type ViewingGap = {
  /** Bearing from the eye to the middle of the block, degrees clockwise from north. */
  bearingDegrees: number
  /** Half the gap's angle: wide enough to take in the whole block, degrees. */
  halfAngleDegrees: number
  /** How far out from the eye the timber is left out, metres. */
  lengthMeters: number
}

/**
 * The wedge of drawn timber to leave out so a block can be seen from the eye:
 * from the eye toward the block, as wide as the block looks, stopping short
 * of it so the block's own edge trees still stand. Null when the eye is in or
 * right at the block. The trees are illustrative; a real viewpoint is a
 * pullout or a gap in the roadside timber, which this stands in for.
 */
export function viewingGapToward(
  eye: { lng: number; lat: number },
  block: PolygonGeometry,
  { maxLengthMeters = 1500, marginDegrees = 3, edgeMeters = 30 } = {},
): ViewingGap | null {
  if (pointInPolygon(block, eye.lng, eye.lat)) return null
  const rings = block.type === 'Polygon' ? [block.coordinates[0]] : block.coordinates.map((polygon) => polygon[0])
  const latScale = Math.cos((eye.lat * Math.PI) / 180)
  // Each ring without its closing vertex, which would count its first point twice.
  const toEye = rings.flatMap((ring) => ring.slice(0, -1)).map(([lng, lat]) => {
    const east = (lng - eye.lng) * METERS_PER_DEGREE_LAT * latScale
    const north = (lat - eye.lat) * METERS_PER_DEGREE_LAT
    return { east, north, distance: Math.hypot(east, north) }
  })
  if (!toEye.length) return null
  const east = toEye.reduce((sum, p) => sum + p.east, 0) / toEye.length
  const north = toEye.reduce((sum, p) => sum + p.north, 0) / toEye.length
  const nearest = Math.min(...toEye.map((p) => p.distance))
  if (nearest < edgeMeters * 2 || Math.hypot(east, north) < 1) return null
  const bearing = (Math.atan2(east, north) * 180) / Math.PI
  const spread = Math.max(
    ...toEye.map((p) => Math.abs(((((Math.atan2(p.east, p.north) * 180) / Math.PI - bearing) % 360) + 540) % 360 - 180)),
  )
  return {
    bearingDegrees: (bearing + 360) % 360,
    halfAngleDegrees: Math.min(35, Math.max(5, spread + marginDegrees)),
    lengthMeters: Math.min(maxLengthMeters, nearest - edgeMeters),
  }
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
