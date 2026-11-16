/**
 * A block's stand as individual trees, for a stand prescription.
 *
 * The trees are the stems the road view draws in its nearest band (`placeTrees`, 4 m grid, seed 1),
 * read back with their grid cell as an identity: the prescription chooses among exactly the stems
 * the view shows before harvest, and a tree it keeps is drawn after harvest where it stood, at its
 * own height and crown (WinSVS keeps a stem's identity across cycles the same way, its manual's
 * "location tracking"). Placement, species, heights and crowns come from `placeTrees`' rules, so the
 * stand keeps its VRI crown closure; this adds only what a prescription needs and the drawing does
 * not: a diameter and how many recorded stems each drawn one stands for.
 *
 * Diameters are a drawing assumption, stated as such: a height–diameter curve (`DBH_CURVE`) scaled
 * so the stand's quadratic mean diameter is VRI's (`QUAD_DIAM_125`, else from `BASAL_AREA` and live
 * stems) where it recorded one. Nothing here reaches the run.
 *
 * DOM-free and network-free, like `forest.ts`.
 */

import {
  REGIONAL_STAND,
  mulberry32,
  placeTrees,
  seedForCell,
  stemCell,
  speciesFromMix,
  stemCellKey,
  stemGridSteps,
  type InventoryStand,
  type TreeSpeciesId,
} from '../forest'
import { metersPerDegree, preparePolygons, type PolygonGeometry } from '../visibility'

/** The road view's nearest band: the grid a prescription's trees are read from (`forestBands`). */
export const STAND_SPACING_METERS = 4
/** That band's seed (`growForestPatch`: band index + 1). */
export const STAND_SEED = 1
/**
 * Most grid cells a block's stand is read over (its bounding box at 4 m): about 640 ha of box.
 * Past it the prescription says the block is too large rather than freezing the page.
 */
export const STAND_MAX_CELLS = 400_000
/** Most stems one drawn stem may stand for before the stand says its diameters are coarse. */
export const STAND_MAX_EXPANSION = 4

/**
 * Breast-height diameter from height, before scaling to the stand: dbh = a·(h − 1.3)^b, cm.
 * The shape is a common power form for interior conifers; `a` is replaced per stand wherever VRI
 * gives a quadratic mean diameter, so only `b` (how fast diameter grows with height) is assumed
 * there. With no VRI size, 25 m stems come out about 30 cm. Seeded spread: about ±12%.
 */
export const DBH_CURVE = { a: 0.92, b: 1.1, spread: 0.12 } as const

/** Drawing grid limit on stems per hectare at 4 m: a cell holds at most 0.94 of a stem (`placeTrees`). */
const DRAWN_MAX_STEMS_PER_HA = (0.94 * 10_000) / (STAND_SPACING_METERS * STAND_SPACING_METERS)

export type StandTree = {
  /** `stemCellKey` of its grid cell: the same tree before and after harvest. */
  key: number
  /** Printable identity for tables and exports (`c<cellX>_<cellY>`). */
  id: string
  lng: number
  lat: number
  /** Metres east and north of the stand's origin (its bounding box's south-west corner). */
  x: number
  y: number
  species: TreeSpeciesId
  heightMeters: number
  crownWidthMeters: number
  /** Diameter at breast height, cm (a drawing assumption: `DBH_CURVE`). */
  dbhCm: number
  /** Recorded stems this drawn stem stands for, ≥ 1: VRI's stems per hectare over what the 4 m grid can draw. */
  expansion: number
  /** Height to the live crown's base, metres, where an imported list gives one (trial: TASS). Display only. */
  crownBaseMeters?: number
}

export type StandBuildInput = {
  /** The block, with wildlife tree patches already cut out. */
  geometry: PolygonGeometry
  /** As the road view grows its stems: `TreePlacementOptions`. */
  stands: PolygonGeometry[]
  clearings: PolygonGeometry[]
  inventory: ReadonlyArray<InventoryStand>
  heightMeters?: number
  anchorLatitude: number
}

export type Stand = {
  trees: StandTree[]
  /** Block area, hectares (planar, from its own latitude). */
  areaHa: number
  origin: { lng: number; lat: number }
  anchorLatitude: number
  spacingMeters: number
  seed: number
  /**
   * Where the trees came from: the road view's drawn stems, or an imported tree list (LiDAR-detected
   * trees, a stem map), which the road view then draws in their place (`PrescribedCells.replace`).
   */
  source: 'drawn' | 'imported'
  /** How the diameters were sized: from VRI's size, the curve alone, or the imported file's own. */
  diameterSource: 'vri' | 'curve' | 'file'
  /** Largest expansion any stem carries: above 1 the stand is denser than the grid draws. */
  maxExpansion: number
}

export type StandBuild = { stand: Stand; error: null } | { stand: null; error: string }

function bbox(geometry: PolygonGeometry): [number, number, number, number] {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  for (const polygon of polygons)
    for (const ring of polygon)
      for (const [lng, lat] of ring) {
        if (lng < west) west = lng
        if (lng > east) east = lng
        if (lat < south) south = lat
        if (lat > north) north = lat
      }
  return [west, south, east, north]
}

/** Planar area of a polygon, hectares, measured at its own latitude. */
export function polygonAreaHa(geometry: PolygonGeometry): number {
  const [, south, , north] = bbox(geometry)
  if (!Number.isFinite(south)) return 0
  const scale = metersPerDegree((south + north) / 2)
  const ringArea = (ring: number[][]) => {
    let sum = 0
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      sum += ring[j][0] * scale.lng * (ring[i][1] * scale.lat) - ring[i][0] * scale.lng * (ring[j][1] * scale.lat)
    }
    return Math.abs(sum) / 2
  }
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  let area = 0
  for (const polygon of polygons) {
    polygon.forEach((ring, index) => {
      area += index === 0 ? ringArea(ring) : -ringArea(ring)
    })
  }
  return Math.max(0, area) / 10_000
}

/** Quadratic mean diameter VRI implies for a stand, cm, or null where it recorded neither size. */
export function recordedQuadMeanDiameter(stand: InventoryStand | null | undefined): number | null {
  if (!stand) return null
  if (stand.quadMeanDiameterCm && stand.quadMeanDiameterCm > 0) return stand.quadMeanDiameterCm
  if (stand.basalAreaM2PerHa && stand.basalAreaM2PerHa > 0 && stand.stemsPerHa && stand.stemsPerHa > 0)
    return Math.sqrt((stand.basalAreaM2PerHa * 40_000) / (Math.PI * stand.stemsPerHa))
  return null
}

/**
 * Reads a block's stand. Returns an error, never a partial stand, when the block is too large to read
 * stem for stem or grows no stems at all.
 */
export function buildStand(input: StandBuildInput): StandBuild {
  const [west, south, east, north] = bbox(input.geometry)
  if (!Number.isFinite(west)) return { stand: null, error: 'The block has no shape.' }
  const steps = stemGridSteps(STAND_SPACING_METERS, input.anchorLatitude)
  const cells = Math.ceil((east - west) / steps.lng + 2) * Math.ceil((north - south) / steps.lat + 2)
  if (cells > STAND_MAX_CELLS)
    return {
      stand: null,
      error: `The block is too large to prescribe tree by tree (${Math.round(cells / 1000)}k grid cells; at most ${STAND_MAX_CELLS / 1000}k).`,
    }
  const scale = metersPerDegree((south + north) / 2)
  const centre = { lng: (west + east) / 2, lat: (south + north) / 2 }
  const halfWidth = ((east - west) / 2) * scale.lng
  const halfHeight = ((north - south) / 2) * scale.lat
  // `placeTrees` measures its circle with the anchor latitude's scale, a little off the block's own:
  // the margin keeps every corner of the box inside it.
  const radiusMeters = Math.hypot(halfWidth, halfHeight) * 1.15 + STAND_SPACING_METERS
  const placed = placeTrees({
    stands: input.stands,
    clearings: input.clearings,
    inventory: input.inventory,
    heightMeters: input.heightMeters,
    centre,
    radiusMeters,
    spacingMeters: STAND_SPACING_METERS,
    // Never widened: the stand must be the grid the near band draws.
    maxTrees: Number.MAX_SAFE_INTEGER,
    seed: STAND_SEED,
    anchorLatitude: input.anchorLatitude,
    bounds: [west, south, east + steps.lng, north + steps.lat],
  })
  const inside = preparePolygons([input.geometry], [west, south, east, north])
  const inventoryAt = preparePolygons(
    input.inventory.map((stand) => stand.geometry),
    [west, south, east, north],
  )

  type Raw = { tree: StandTree; stand: InventoryStand | null; shape: number }
  const raw: Raw[] = []
  for (const stem of placed) {
    if (!inside.contains(stem.lng, stem.lat)) continue
    const [cellX, cellY] = stemCell(stem.lng, stem.lat, steps)
    const surveyed = input.inventory[inventoryAt.indexAt(stem.lng, stem.lat)] ?? null
    const stems = surveyed?.stemsPerHa && surveyed.stemsPerHa > 0 ? surveyed.stemsPerHa : REGIONAL_STAND.stemsPerHa
    const random = mulberry32(seedForCell(cellX, cellY, STAND_SEED + 31_337))
    // Box–Muller from the cell's own draws: a stem's spread never depends on its neighbours.
    const u = Math.max(1e-12, random())
    const v = random()
    const normal = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    const shape = Math.pow(Math.max(0.1, stem.heightMeters - 1.3), DBH_CURVE.b) * Math.exp(normal * DBH_CURVE.spread)
    raw.push({
      tree: {
        key: stemCellKey(cellX, cellY),
        id: `c${cellX}_${cellY}`,
        lng: stem.lng,
        lat: stem.lat,
        x: (stem.lng - west) * scale.lng,
        y: (stem.lat - south) * scale.lat,
        species: stem.species,
        heightMeters: stem.heightMeters,
        crownWidthMeters: stem.heightMeters * stem.slenderness,
        dbhCm: 0,
        expansion: Math.max(1, stems / DRAWN_MAX_STEMS_PER_HA),
      },
      stand: surveyed,
      shape,
    })
  }
  if (raw.length === 0) return { stand: null, error: 'No standing stems grow in the block.' }

  // Each recorded stand's diameters scaled so its drawn stems carry VRI's quadratic mean diameter.
  const byStand = new Map<InventoryStand | null, Raw[]>()
  for (const entry of raw) {
    const group = byStand.get(entry.stand) ?? []
    group.push(entry)
    byStand.set(entry.stand, group)
  }
  let recorded = 0
  for (const [stand, group] of byStand) {
    const qmd = recordedQuadMeanDiameter(stand)
    let a: number = DBH_CURVE.a
    if (qmd) {
      let weight = 0
      let squares = 0
      for (const entry of group) {
        weight += entry.tree.expansion
        squares += entry.tree.expansion * entry.shape * entry.shape
      }
      if (squares > 0) a = qmd / Math.sqrt(squares / weight)
      recorded += group.length
    }
    for (const entry of group) entry.tree.dbhCm = Math.max(1, a * entry.shape)
  }

  const trees = raw.map((entry) => entry.tree)
  return {
    stand: {
      trees,
      areaHa: polygonAreaHa(input.geometry),
      origin: { lng: west, lat: south },
      anchorLatitude: input.anchorLatitude,
      spacingMeters: STAND_SPACING_METERS,
      seed: STAND_SEED,
      source: 'drawn',
      diameterSource: recorded >= raw.length / 2 ? 'vri' : 'curve',
      maxExpansion: trees.reduce((max, tree) => Math.max(max, tree.expansion), 1),
    },
    error: null,
  }
}

/** One tree of an imported tree list, as `treeListImport.ts` converts it: WGS 84, metres, centimetres. */
export type StandImportTree = {
  id: string
  lng: number
  lat: number
  heightMeters: number
  crownWidthMeters: number | null
  dbhCm: number | null
  species: TreeSpeciesId | null
  crownBaseMeters?: number | null
}

/**
 * A crown width for an imported tree that gives none: the stand's own closure at the imported
 * density (`crownWidthForClosure`), so a stem list without crowns still draws the recorded canopy.
 */
const IMPORT_FALLBACK_CROWN_TO_HEIGHT = 0.16

/**
 * A block's stand from an imported tree list: each tree as measured, inside the block (wildlife tree
 * patches already cut out). Trees keep their own identity (`key` −1, −2, … in file order, so they
 * never meet a grid key); a tree with no species takes the recorded stand's mix at its place, drawn
 * from its own seed; a tree with no diameter takes the height–diameter curve scaled to VRI's size, as
 * drawn stems do. Each tree is one tree (`expansion` 1): LiDAR's tree approximate objects can hide
 * co-dominant and understory stems, and the stand table says so.
 */
export function buildStandFromImport(input: {
  geometry: PolygonGeometry
  trees: ReadonlyArray<StandImportTree>
  inventory: ReadonlyArray<InventoryStand>
  anchorLatitude: number
}): StandBuild {
  const [west, south, east, north] = bbox(input.geometry)
  if (!Number.isFinite(west)) return { stand: null, error: 'The block has no shape.' }
  const inside = preparePolygons([input.geometry], [west, south, east, north])
  const inventoryAt = preparePolygons(
    input.inventory.map((stand) => stand.geometry),
    [west, south, east, north],
  )
  const scale = metersPerDegree((south + north) / 2)
  type Raw = { tree: StandTree; stand: InventoryStand | null; shape: number; fileDbh: boolean }
  const raw: Raw[] = []
  input.trees.forEach((imported, index) => {
    if (!inside.contains(imported.lng, imported.lat)) return
    const surveyed = input.inventory[inventoryAt.indexAt(imported.lng, imported.lat)] ?? null
    const random = mulberry32(seedForCell(index, 0x5eed, STAND_SEED + 77_777))
    const mix = surveyed?.speciesMix && surveyed.speciesMix.length ? surveyed.speciesMix : null
    const species =
      imported.species ?? (mix ? speciesFromMix(random(), mix) : (surveyed?.species ?? speciesFromMix(random())))
    const u = Math.max(1e-12, random())
    const normal = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random())
    raw.push({
      tree: {
        key: -(index + 1),
        id: imported.id || `t${index + 1}`,
        lng: imported.lng,
        lat: imported.lat,
        x: (imported.lng - west) * scale.lng,
        y: (imported.lat - south) * scale.lat,
        species,
        heightMeters: imported.heightMeters,
        crownWidthMeters: imported.crownWidthMeters ?? imported.heightMeters * IMPORT_FALLBACK_CROWN_TO_HEIGHT,
        dbhCm: imported.dbhCm ?? 0,
        expansion: 1,
        ...(imported.crownBaseMeters != null && imported.crownBaseMeters < imported.heightMeters
          ? { crownBaseMeters: imported.crownBaseMeters }
          : {}),
      },
      stand: surveyed,
      shape: Math.pow(Math.max(0.1, imported.heightMeters - 1.3), DBH_CURVE.b) * Math.exp(normal * DBH_CURVE.spread),
      fileDbh: imported.dbhCm != null && imported.dbhCm > 0,
    })
  })
  if (raw.length === 0) return { stand: null, error: 'No imported tree stands inside the block.' }

  // Diameters the file did not give: the curve, scaled per recorded stand to VRI's size.
  const byStand = new Map<InventoryStand | null, Raw[]>()
  for (const entry of raw) {
    if (entry.fileDbh) continue
    const group = byStand.get(entry.stand) ?? []
    group.push(entry)
    byStand.set(entry.stand, group)
  }
  let fromVri = 0
  for (const [stand, group] of byStand) {
    const qmd = recordedQuadMeanDiameter(stand)
    let a: number = DBH_CURVE.a
    if (qmd) {
      const squares = group.reduce((sum, entry) => sum + entry.shape * entry.shape, 0)
      if (squares > 0) a = qmd / Math.sqrt(squares / group.length)
      fromVri += group.length
    }
    for (const entry of group) entry.tree.dbhCm = Math.max(1, a * entry.shape)
  }
  const fromFile = raw.filter((entry) => entry.fileDbh).length
  return {
    stand: {
      trees: raw.map((entry) => entry.tree),
      areaHa: polygonAreaHa(input.geometry),
      origin: { lng: west, lat: south },
      anchorLatitude: input.anchorLatitude,
      spacingMeters: STAND_SPACING_METERS,
      seed: STAND_SEED,
      source: 'imported',
      diameterSource: fromFile >= raw.length / 2 ? 'file' : fromVri >= raw.length / 2 ? 'vri' : 'curve',
      maxExpansion: 1,
    },
    error: null,
  }
}
