/**
 * The road view's scene as a renderer-neutral file.
 *
 * The visual tools trial (`docs/forestry-visual-tools-trial-2026-11-12.md`)
 * tries other forest renderers — threejs-worldgen, Nanite Forest, VistaWASM —
 * against our own data. None of them should be a dependency of this page, so
 * the page writes the scene out once and each renderer gets a small adapter
 * that reads it. Swapping or comparing renderers then costs an adapter, and
 * every one of them draws the same evidence.
 *
 * What goes in is exactly what the road view draws:
 *
 * - **Trees**: the same stems, from the same patches and seeds as
 *   `ForestOverlay` (`forestPatches`, `growForestPatch`): position, species,
 *   height and crown width. The fine band to its far edge less the overlap,
 *   then the next band, so no stem is written twice.
 * - **Terrain**: the drawn ground (the road view's elevation source) on a
 *   regular grid, wider than the trees so the skyline is there, with the crown
 *   closure the stems are grown to at each post (`sceneCover.ts`).
 * - **Openings, slash and road scars** as the road view draws them, each
 *   opening with its age and the share of the stand left in it.
 * - **Water**: the basemap's lakes and rivers within the terrain, each with
 *   the water level a renderer should draw it at.
 * - **The camera**: where the eye stands, which way it looks, its lens.
 *
 * Coordinates are local metres east (`x`), north (`y`) and up (`z`) from an
 * origin on the ground under the eye, so a renderer never sees longitude and
 * latitude. Heights are absolute metres (the terrain's own datum). Display
 * only: nothing here is an analysis input. DOM-free and network-free.
 */

import polygonClipping, { type MultiPolygon as ClipMultiPolygon } from 'polygon-clipping'
import { PACKAGE_SPECIES_IDS, packageSpecies, type PackageSpeciesId, type TreeInstance } from './forest'
import { CONE_BASE_DIAMETER, SPECIES_CROWN_RATIO } from './forest'
import { forestBands, forestPatches, growForestPatch } from './forestPatches'
import type { ForestConfiguration } from './ForestOverlay'
import { placeDebris, type RoadScarStrip } from './harvestedGround'
import { TREE_SPECIES_DRAWING } from './impostor'
import {
  canopyOnGrid,
  coverOnGrid,
  SCENE_COVER,
  sceneOpenings,
  seaOnGrid,
  seaPolygons,
  type OpeningTarget,
  type SceneCoverSource,
  type SceneFire,
} from './sceneCover'
import { detailedTreeMesh } from './treeGeometry'
// A capture's package (`engineCapture.ts`) also carries `farTerrain`, a coarse grid to 15 km, `skylineTerrain` past it
// out to the frames' farthest skyline, and stems out past the assessed landform; the road view's own package keeps
// 3 km of terrain and 600 m of stems.
import type { ElevationSource } from '@/lib/forestry/terrain/terrain'
import { curvatureDrop, EARTH_RADIUS_M, STANDARD_REFRACTION } from './skylineReach'
import { metersPerDegree, polygonBounds, type PolygonGeometry } from './visibility'
import type { EngineEnvironment } from './externalRenderers'
import { checkSceneCamera, scenePerspective, type SceneCamera, type SceneViewport } from './sceneCamera'
import { SCENE_TREE_FIELDS, treeComponents } from './sceneComponents'
import { standOnGrid, validStandGrid, type SceneStandGrid } from './sceneStand'

export const SCENE_PACKAGE_FORMAT = 'pgmaps-forest-scene'
export const SCENE_PACKAGE_VERSION = 1

/** Fields of one tree record in `trees.data`, in order. `species` is an index into `trees.species`. */
export { SCENE_TREE_FIELDS } from './sceneComponents'
/** Fields of one debris pile in `debris.data`: base position and footprint across, metres. */
export const SCENE_DEBRIS_FIELDS = ['x', 'y', 'z', 'footprint'] as const
/**
 * Fields of one treated stem in `treated.data` (a stand prescription's stumps, felled trees, logs and
 * snags): base position, metres; `kind` an index into `treated.kinds`; length along the stem and its
 * diameter, metres; `heading` the way a lying stem points, degrees from north (0 for a standing one).
 */
export const SCENE_TREATED_FIELDS = ['x', 'y', 'z', 'kind', 'length', 'diameter', 'heading'] as const
export const SCENE_TREATED_KINDS = ['stump', 'felled', 'log', 'snag'] as const

export type ScenePackage = {
  format: typeof SCENE_PACKAGE_FORMAT
  version: typeof SCENE_PACKAGE_VERSION
  createdAt: string
  /** The local frame's origin: the ground under the eye. */
  origin: { lng: number; lat: number; elevationMeters: number }
  frame: 'local metres: x east, y north, z up; heights absolute'
  terrain: {
    /** South-west corner of the grid, local metres. */
    west: number
    south: number
    spacing: number
    columns: number
    rows: number
    /** Row-major from the south row, west to east; null where the source has no value. */
    heights: Array<number | null>
    /**
     * Crown closure at each post, 0–1, row-major like `heights`: the share of the ground under tree crowns, from
     * the stand the post falls in (VRI crown closure, else the regional stand), 0 on cut, non-treed and water
     * ground, null where unknown. Lets an engine draw the forest as a closed canopy past the stems it draws one by
     * one, and open ground as open. Absent from older packages.
     */
    canopy?: Array<number | null>
    /** Resolved stand height/composition and source, including beyond the explicit stem radius. */
    stand?: SceneStandGrid
    /**
     * Natural ground cover at each post, row-major like `heights` (`SCENE_COVER`): what the ground is where the
     * forest is not closed, from VRI's BC Land Cover Classification and the slope, so bluffs, rock, grass and shrub
     * openings read as they do in the reference renders. 0 forest, 1 sparse forest (open canopy over grass/rock),
     * 2 shrub, 3 herb/grass, 4 rock or exposed soil (VRI non-vegetated, a bluff steeper than about 45°, or rock
     * showing through a stand: see below), 5 water, 6 cut ground (an opening), 7 burnt (a recent wildfire: standing
     * dead snags over herb and shrub regrowth, the fire's year in `burntYear`); null unknown. Absent from older
     * packages; 7 is absent from packages written before it.
     *
     * Read in this order (`coverOnGrid`): no height → null; the sea (posts at or below 0 m reaching the grid's edge
     * or 3 ha or more) and the basemap's water → 5; an entry in `openings` → 6 (its age in `openings[].ageYears`);
     * VRI water → 5; the grid's own slope past 45° → 4, under any VRI polygon (a bluff in a treed polygon); else the
     * VRI rank-1 polygon's BCLCS (treed: 1 at level 5 `SP` or crown closure under 26 %, else 0; non-vegetated land:
     * 4; vegetated non-treed: 2 at level 4 `ST`/`SL`, else 3); a coastal treed polygon whose non-vegetated cover
     * components (`NON_VEG_COVER_TYPE_n`) record 10 % or more of bedrock, talus or blockfield → 4 over the whole
     * polygon, with its stand still standing (`canopy` keeps the stand's closure: draw pale rock ground between the
     * crowns, as the reference renders do; VRI does not say where in the polygon the rock lies); ground the inventory
     * read reached with no open-ground polygon → 0; ground it did not reach → null, never forest. Last, a post that
     * came out 0 or 1 inside a BC Wildfire Service perimeter from the 20 seasons up to the assessment year → 7 (a
     * perimeter's unburnt islands are not mapped, so this is an upper bound). Slope is read at the grid's own spacing, so a
     * coarse grid (60 m and wider) smooths most bluffs below 45°. Stems in `trees` are not thinned by slope, rock or
     * fire: the road view grows them on a bluff and in a burn, and `canopy` keeps their closure there (on burnt
     * posts, the pre-fire stand's: a guide to snag density). `notes` says where the inventory and fire reads stopped.
     */
    cover?: Array<number | null>
    /**
     * The fire season at each burnt post (cover 7), row-major like `heights`, null elsewhere; `fires` gives each
     * season's years since the fire at the scene's assessment year. An engine draws snags thinning and regrowth
     * rising with those years (herb and shrub in the first years, young conifers by 10–20). Present only when some
     * post on the grid burnt.
     */
    burntYear?: Array<number | null>
  }
  /**
   * Optional coarser terrain past `terrain`, out to the skyline (a capture's scene), the same layout. Engines draw it
   * where `terrain` has no posts, in place of ground of their own invention; null posts are unknown there too.
   */
  farTerrain?: ScenePackage['terrain']
  /**
   * Optional coarsest terrain past `farTerrain`, out to the farthest skyline the capture's frames show (a capture's
   * scene, when that skyline stands past `farTerrain`; at most 60 km, `captureTerrain`). The same layout, one square
   * grid centred on the origin covering the inner grids too. Engines draw it where neither `terrain` nor
   * `farTerrain` has posts, in place of ground of their own invention. Unlike the inner grids its heights already
   * carry the earth's curvature for an eye at the origin: each post is `z − d² / (2R) × (1 − k)`, with `d` its
   * horizontal distance from the origin and `R` and `k` in `earthCurvature`, so an engine drawing a flat frame shows
   * a ridge 30 km off about 60 m lower, as it stands from the eye. Draw it as given; do not drop it again, and do
   * not drop `terrain` or `farTerrain` (the step this leaves at `farTerrain`'s edge is the drop there, about 15 m at
   * 15 km). The camera's far plane must reach its corners (the half-width × √2).
   */
  skylineTerrain?: ScenePackage['terrain'] & { earthCurvature: { earthRadiusMeters: number; refraction: number } }
  trees: {
    fields: readonly string[]
    species: PackageSpeciesId[]
    count: number
    data: number[]
    ids?: string[]
  }
  /** How each species is drawn here, so a renderer can build a matching model. */
  species: Record<string, { label: string; crownRatio: number; crownBase: number; broadleaf: boolean }>
  /**
   * Each species' own detailed model (`detailedTreeMesh`), the one the road view draws when it stops, so another
   * renderer can draw the same trees and not only the same positions. Unit height and unit crown width: scale x
   * and y (across) by a stem's crown width and z by its height. Non-indexed triangles in the package frame (z up);
   * `bark` is 1 on wood, 0 on foliage. Our own geometry: no third-party asset to license.
   */
  models?: Record<string, { positions: number[]; normals: number[]; bark: number[] }>
  /**
   * Cut ground. `ageYears`: years from harvest to the assessment (or view) date, null when the record has no date;
   * an engine greens the ground up with age (slash and soil at 0–2, shrubs and seedlings by 5, a young stand by
   * 15–20). `retainedShare`: the share of the stand left standing in it as dispersed trees, 0–1 (the stems are in
   * `trees` already; this says how thick to expect them). Reserves and wildlife tree patches inside a block are not
   * cut ground: their stems stand, and they are cut out of these rings.
   */
  openings: Array<{
    kind: 'harvested'
    rings: Array<Array<[number, number]>>
    ageYears?: number | null
    retainedShare?: number | null
  }>
  debris: { fields: typeof SCENE_DEBRIS_FIELDS; count: number; data: number[] }
  /**
   * What stand prescriptions leave of the trees they take, within the tree radius: stumps, felled trees
   * with their crowns, limbed logs and snags (`stand/prescribedCells.ts`). Absent when no block has a
   * prescription, and from packages written before prescriptions; an engine that ignores it still
   * draws the right standing trees, which are in `trees`.
   */
  treated?: {
    fields: typeof SCENE_TREATED_FIELDS
    kinds: typeof SCENE_TREATED_KINDS
    count: number
    data: number[]
  }
  roadScars: Array<{ kind: 'cut' | 'fill'; ring: Array<[number, number]> }>
  /**
   * Lakes and rivers cut to the terrain grid, one entry per polygon: the outer ring first, then holes. The surface
   * is drawn at `elevationMeters`, the lowest ground under the outer ring (null where the terrain has none there).
   * Absent from packages written before water was added.
   *
   * Entries with `sea: true` are the sea, which the basemap's water leaves out: the posts at or below 0 m that reach
   * the grid's edge or cover 3 ha (`seaOnGrid`), outlined by marching squares at 0 m and simplified to half a post
   * spacing, at `elevationMeters` 0. Those from `terrain` lie on it; those from `farTerrain` lie on it outside
   * `terrain`'s square, so the two never overlap. Land drawn above 0 m hides the sea's edge, so the outline may run
   * a little under the shore. `skylineTerrain` adds none (its heights carry the curvature drop, which a flat sea
   * cannot): its sea is its posts with `cover` 5.
   */
  water?: Array<{ rings: Array<Array<[number, number]>>; elevationMeters: number | null; sea?: true }>
  camera: SceneCamera
  /** Resolved site clock and UTC instant, frozen when written; absent in older packages. */
  environment?: EngineEnvironment
  /**
   * The wildfires behind cover 7 on any grid (BC Wildfire Service perimeters), latest first: the fire number, season
   * (`terrain.burntYear`'s value), years from it to the assessment year (0 for this season's fire), and size in
   * hectares. Absent when no post burnt.
   */
  fires?: Array<{ fireNumber: string | null; year: number; yearsSinceFire: number; sizeHectares: number | null }>
  /** How far out the trees go, metres; the terrain reaches further. */
  treeRadiusMeters: number
  /** Live previews use an overlapping window of tree tiles in this package's fixed coordinate frame. */
  liveTreeTiles?: { generation: number; size: number }
  notes: string[]
}

export type ScenePackageInput = {
  /** Where the eye stands. */
  eye: { lng: number; lat: number }
  eyeHeightMeters: number
  /** The drive's exact eye elevation, when available; avoids re-seating it on a different ground sample. */
  eyeElevationMeters?: number
  bearingDegrees: number
  pitchDegrees: number
  verticalFovDegrees: number
  viewport?: SceneViewport
  environment?: EngineEnvironment
  /** The road view's forest configuration, as `ForestOverlay` receives it. */
  forest: Pick<
    ForestConfiguration,
    'anchorLatitude' | 'stands' | 'clearings' | 'openings' | 'thinnings' | 'inventory' | 'standHeightMeters' | 'treated'
  >
  elevation: ElevationSource
  roadScars?: ReadonlyArray<RoadScarStrip>
  /** Lakes and rivers (the basemap's water); what lies on the terrain grid goes in, cut to it. */
  water?: ReadonlyArray<PolygonGeometry>
  /**
   * The inventory reads `terrain.cover` is drawn from (`SceneCoverSource`: the run's VRI read, a capture's
   * open-ground read over its terrain, with the wildfire perimeters it read). Without one, cover comes only from
   * slope, water, the sea and cut ground.
   */
  cover?: ReadonlyArray<SceneCoverSource>
  /**
   * The scene's targets, which `forest.openings` and `forest.thinnings` were cut from: each opening's harvest year,
   * system and clearcut share (`openings[].ageYears`, `retainedShare`; `sceneOpenings`). Without them both are null.
   */
  targets?: ReadonlyArray<OpeningTarget>
  /** The year openings are aged to: the scene's assessment year (default the year of `createdAt`). */
  assessmentYear?: number
  /** Existing openings this old are stands, not openings (the scene's green-up age; default 20). */
  greenUpAgeYears?: number
  /** Trees out to here (default 600 m: the two bands drawn stem by stem or nearly). */
  treeRadiusMeters?: number
  /** Terrain and inventory only for the live tiled road view. */
  liveTreeTiles?: ScenePackage['liveTreeTiles']
  /** Terrain out to here (default 3 km), at `terrainSpacingMeters` (default 15 m). */
  terrainRadiusMeters?: number
  terrainSpacingMeters?: number
  /** Coarser terrain out to here (`farTerrain`), at `farTerrainSpacingMeters`; none unless past the terrain. */
  farTerrainRadiusMeters?: number
  farTerrainSpacingMeters?: number
  /** Coarsest terrain out to here (`skylineTerrain`, curvature dropped); none unless past `farTerrain`. */
  skylineTerrainRadiusMeters?: number
  skylineTerrainSpacingMeters?: number
  notes?: string[]
  createdAt?: Date
  /** Include each species' detailed model (default true; about 1.5 MB). */
  includeModels?: boolean
}

/** A species' detailed mesh, unrolled to triangles at unit height and unit crown width. */
function packageModel(species: PackageSpeciesId) {
  // The solid build: another renderer has no spray sheet to cut bough cards out with.
  const mesh = detailedTreeMesh(species, PACKAGE_SPECIES_IDS.indexOf(species) + 1)
  const p = mesh.attributes.positions.value
  const n = mesh.attributes.normals.value
  const b = mesh.attributes.bark?.value
  let widest = 0
  for (let i = 0; i < p.length; i += 3) widest = Math.max(widest, Math.hypot(p[i], p[i + 1]))
  const across = widest > 0 ? 1 / (2 * widest) : 1
  const positions: number[] = []
  const normals: number[] = []
  const bark: number[] = []
  for (const index of mesh.indices.value) {
    positions.push(round(p[index * 3] * across, 4), round(p[index * 3 + 1] * across, 4), round(p[index * 3 + 2], 4))
    normals.push(round(n[index * 3], 3), round(n[index * 3 + 1], 3), round(n[index * 3 + 2], 3))
    bark.push(b ? b[index] : 0)
  }
  return { positions, normals, bark }
}

const round = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places

/** `terrain.cover` codes (`sceneCover.ts`). */
export { SCENE_COVER }

/** The scene the road view draws, as a package. */
export function buildScenePackage(input: ScenePackageInput): ScenePackage {
  const {
    eye,
    elevation,
    forest,
    treeRadiusMeters = 600,
    terrainRadiusMeters = 3000,
    terrainSpacingMeters = 15,
  } = input
  const scale = metersPerDegree(eye.lat)
  const toLocal = (lng: number, lat: number): [number, number] => [
    (lng - eye.lng) * scale.lng,
    (lat - eye.lat) * scale.lat,
  ]
  const ground = elevation.elevationAt(eye.lng, eye.lat)
  const originElevation = Number.isFinite(ground) ? ground : 0

  // The same patches and seeds the road view grows. Band 0 is stem for stem;
  // where bands overlap the road view cross-fades, so the package takes each
  // band up to the middle of its overlap with the next.
  const anchorLatitude = forest.anchorLatitude ?? eye.lat
  const bands = forestBands(treeRadiusMeters)
  const patches = input.liveTreeTiles ? [] : forestPatches(eye, bands, anchorLatitude)
  // Component-aware consumers keep the native species; sceneForEngine negotiates old six-species consumers.
  const species = [...PACKAGE_SPECIES_IDS]
  const treeData: number[] = []
  const treeIds: string[] = []
  const debrisData: number[] = []
  const openings = forest.openings ?? []
  for (const patch of patches) {
    const band = bands[patch.band]
    if (band.near > treeRadiusMeters) continue
    const next = bands[patch.band + 1]
    const inner = patch.band === 0 ? 0 : (band.near + bands[patch.band - 1].far) / 2
    const outer = next ? Math.min(treeRadiusMeters, (next.near + band.far) / 2) : treeRadiusMeters
    const grown: TreeInstance[] = growForestPatch(
      patch,
      band,
      {
        stands: forest.stands,
        clearings: forest.clearings,
        openings,
        thinnings: forest.thinnings,
        inventory: forest.inventory,
        heightMeters: forest.standHeightMeters,
      },
      elevation,
      anchorLatitude,
    )
    for (const tree of grown) {
      const [x, y] = toLocal(tree.lng, tree.lat)
      const distance = Math.hypot(x, y)
      if (distance < inner || distance >= outer) continue
      treeData.push(
        round(x),
        round(y),
        round(tree.elevationMeters),
        species.indexOf(packageSpecies(tree.species)),
        round(tree.heightMeters),
        // A stem's crown width is its height × slenderness (`placeTrees`).
        round(tree.heightMeters * tree.slenderness),
        round(tree.tone, 3),
        ...treeComponents(tree),
      )
      treeIds.push(tree.id ?? `p:${tree.lng}:${tree.lat}:${tree.species}`)
    }
    // Slash where the road view draws it: the nearer bands only.
    if (openings.length && band.near < treeRadiusMeters && patch.band <= 1) {
      for (const pile of placeDebris(openings, patch.bounds, 12, patch.band + 1)) {
        const [x, y] = toLocal(pile.lng, pile.lat)
        const distance = Math.hypot(x, y)
        if (distance < inner || distance >= outer) continue
        const z = elevation.elevationAt(pile.lng, pile.lat)
        if (!Number.isFinite(z)) continue
        // `placeDebris` carries the footprint in its slenderness (see there).
        debrisData.push(round(x), round(y), round(z), round(pile.slenderness / CONE_BASE_DIAMETER))
      }
    }
  }

  // The streamed background seats the road's slash once, using the opening bounds to limit the sampling work.
  if (input.liveTreeTiles && openings.length) {
    const boxes = openings.map(polygonBounds)
    const extentLng = terrainRadiusMeters / scale.lng,
      extentLat = terrainRadiusMeters / scale.lat
    const bounds: [number, number, number, number] = [
      Math.max(eye.lng - extentLng, Math.min(...boxes.map((box) => box[0]))),
      Math.max(eye.lat - extentLat, Math.min(...boxes.map((box) => box[1]))),
      Math.min(eye.lng + extentLng, Math.max(...boxes.map((box) => box[2]))),
      Math.min(eye.lat + extentLat, Math.max(...boxes.map((box) => box[3]))),
    ]
    const area = (bounds[2] - bounds[0]) * scale.lng * (bounds[3] - bounds[1]) * scale.lat
    if (bounds[2] > bounds[0] && bounds[3] > bounds[1]) {
      const spacing = Math.max(12, Math.sqrt(area / 30000))
      for (const pile of placeDebris(openings, bounds, spacing)) {
        const [x, y] = toLocal(pile.lng, pile.lat)
        const z = elevation.elevationAt(pile.lng, pile.lat)
        if (Number.isFinite(z))
          debrisData.push(round(x), round(y), round(z), round(pile.slenderness / CONE_BASE_DIAMETER))
      }
    }
  }

  // A prescription's stumps, felled trees, logs and snags near enough to be drawn as stems.
  const treatedData: number[] = []
  if (forest.treated) {
    SCENE_TREATED_KINDS.forEach((kind, kindIndex) => {
      for (const stem of forest.treated?.[kind] ?? []) {
        const [x, y] = toLocal(stem.lng, stem.lat)
        if (
          input.liveTreeTiles
            ? Math.max(Math.abs(x), Math.abs(y)) >= terrainRadiusMeters
            : Math.hypot(x, y) >= treeRadiusMeters
        )
          continue
        const z = elevation.elevationAt(stem.lng, stem.lat)
        if (!Number.isFinite(z)) continue
        // The solid layer's width scale is height × slenderness / cone base (`treatedStems`): a standing
        // stem's diameter, a lying stem's length (its height there is its diameter).
        const across = (stem.heightMeters * stem.slenderness) / CONE_BASE_DIAMETER
        const lying = kind === 'felled' || kind === 'log'
        treatedData.push(
          round(x),
          round(y),
          round(z),
          kindIndex,
          round(lying ? across : stem.heightMeters),
          round(lying ? stem.heightMeters : across, 3),
          round(stem.headingDegrees ?? 0, 1),
        )
      }
    })
  }

  // The drawn ground on a square grid round the eye.
  const grid = (radius: number, spacing: number, curved = false): ScenePackage['terrain'] => {
    const half = Math.ceil(radius / spacing)
    const columns = half * 2 + 1
    const heights: Array<number | null> = []
    for (let row = 0; row < columns; row += 1) {
      const y = (row - half) * spacing
      for (let column = 0; column < columns; column += 1) {
        const x = (column - half) * spacing
        const z = elevation.elevationAt(eye.lng + x / scale.lng, eye.lat + y / scale.lat)
        heights.push(Number.isFinite(z) ? round(curved ? z - curvatureDrop(Math.hypot(x, y)) : z) : null)
      }
    }
    return { west: -half * spacing, south: -half * spacing, spacing, columns, rows: columns, heights }
  }
  const terrain = grid(terrainRadiusMeters, terrainSpacingMeters)
  const half = (terrain.columns - 1) / 2
  const farRadius = input.farTerrainRadiusMeters ?? 0
  const farTerrain =
    farRadius > terrainRadiusMeters
      ? grid(farRadius, Math.max(terrainSpacingMeters, input.farTerrainSpacingMeters ?? farRadius / 250))
      : null
  const skylineRadius = input.skylineTerrainRadiusMeters ?? 0
  // Never finer than the grid inside it.
  const skylineSpacing = Math.max(
    farTerrain?.spacing ?? terrainSpacingMeters,
    input.skylineTerrainSpacingMeters ?? skylineRadius / 250,
  )
  const skylineTerrain: ScenePackage['skylineTerrain'] | null =
    skylineRadius > Math.max(terrainRadiusMeters, farTerrain ? farRadius : 0)
      ? {
          ...grid(skylineRadius, skylineSpacing, true),
          earthCurvature: { earthRadiusMeters: EARTH_RADIUS_M, refraction: STANDARD_REFRACTION },
        }
      : null

  const ring = (coordinates: ReadonlyArray<ReadonlyArray<number>>) =>
    coordinates.map(([lng, lat]) => toLocal(lng, lat).map((value) => round(value)) as [number, number])
  const polygonRings = (geometry: PolygonGeometry) =>
    (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates).flatMap((polygon) =>
      polygon.map(ring),
    )

  // Water cut to the terrain grid, one entry per polygon, at the lowest ground round its shore. The basemap's
  // water can be a whole river system tens of kilometres across (the Fraser and Nechako: 45 km, 884 vertices at
  // the roadside demo), which an engine would otherwise build in full.
  const extent = half * terrainSpacingMeters
  const box: ClipMultiPolygon = [
    [
      [
        [eye.lng - extent / scale.lng, eye.lat - extent / scale.lat],
        [eye.lng + extent / scale.lng, eye.lat - extent / scale.lat],
        [eye.lng + extent / scale.lng, eye.lat + extent / scale.lat],
        [eye.lng - extent / scale.lng, eye.lat + extent / scale.lat],
        [eye.lng - extent / scale.lng, eye.lat - extent / scale.lat],
      ],
    ],
  ]
  const water = (input.water ?? []).flatMap((geometry) => {
    let pieces: ClipMultiPolygon
    try {
      const polygons = (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates) as ClipMultiPolygon
      pieces = polygonClipping.intersection(polygons, box)
    } catch {
      return []
    }
    return pieces.map((polygon) => {
      let level = Infinity
      for (const [lng, lat] of polygon[0]) {
        const z = elevation.elevationAt(lng, lat)
        if (Number.isFinite(z)) level = Math.min(level, z)
      }
      return { rings: polygon.map(ring), elevationMeters: Number.isFinite(level) ? round(level) : null }
    })
  })

  // Crown closure under every post, by the rules the stems are grown by (`sceneCover.ts`), and each opening's age and
  // retention from the targets it was cut from.
  const canopyInputs = {
    stands: forest.stands,
    clearings: forest.clearings,
    openings,
    thinnings: forest.thinnings,
    inventory: forest.inventory,
    water: input.water,
    heightMeters: forest.standHeightMeters,
  }
  const postAt = (x: number, y: number): [number, number] => [eye.lng + x / scale.lng, eye.lat + y / scale.lat]
  for (const posts of [terrain, farTerrain, skylineTerrain])
    if (posts) posts.canopy = canopyOnGrid(posts, postAt, canopyInputs)
  const openingDetails = sceneOpenings({
    openings,
    thinnings: forest.thinnings,
    inventory: forest.inventory,
    targets: input.targets,
    year: input.assessmentYear ?? (input.createdAt ?? new Date()).getUTCFullYear(),
    greenUpAgeYears: input.greenUpAgeYears,
  })

  // Ground cover under every post (`coverOnGrid`), and the sea the basemap's water leaves out. Where the cover says
  // the road view would grow no stand (water, VRI shrub, herb, rock), the canopy is 0 too, as it is near the eye.
  const cutGround = openingDetails.map((opening) => opening.geometry)
  const assessmentYear = input.assessmentYear ?? (input.createdAt ?? new Date()).getUTCFullYear()
  const burntFires = new Set<SceneFire>()
  const sea: Array<{ rings: Array<Array<[number, number]>>; elevationMeters: number; sea: true }> = []
  for (const posts of [terrain, farTerrain, skylineTerrain]) {
    if (!posts) continue
    const seaPosts = seaOnGrid(posts)
    const {
      cover,
      treeless,
      burntYear,
      burntFires: burntHere,
    } = coverOnGrid(posts, postAt, {
      sources: input.cover,
      openings: cutGround,
      water: input.water,
      sea: seaPosts,
      assessmentYear,
    })
    posts.cover = cover
    if (burntYear) posts.burntYear = burntYear
    for (const fire of burntHere) burntFires.add(fire)
    if (posts.canopy) for (let i = 0; i < treeless.length; i += 1) if (treeless[i]) posts.canopy[i] = 0
    posts.stand = standOnGrid(posts, postAt, canopyInputs)
    if (posts === skylineTerrain) continue
    let outlines: ClipMultiPolygon = seaPolygons(posts, seaPosts)
    if (posts === farTerrain && outlines.length) {
      const inner: ClipMultiPolygon = [
        [
          [
            [-extent, -extent],
            [extent, -extent],
            [extent, extent],
            [-extent, extent],
            [-extent, -extent],
          ],
        ],
      ]
      try {
        outlines = polygonClipping.difference(outlines, inner)
      } catch {
        outlines = []
      }
    }
    for (const polygon of outlines)
      sea.push({
        rings: polygon.map((r) => r.map(([x, y]) => [round(x), round(y)] as [number, number])),
        elevationMeters: 0,
        sea: true,
      })
  }
  const coverNotes = (input.cover ?? []).flatMap((source) => (source.note ? [source.note] : []))

  return {
    format: SCENE_PACKAGE_FORMAT,
    version: SCENE_PACKAGE_VERSION,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
    origin: { lng: eye.lng, lat: eye.lat, elevationMeters: round(originElevation) },
    frame: 'local metres: x east, y north, z up; heights absolute',
    terrain,
    ...(farTerrain ? { farTerrain } : {}),
    ...(skylineTerrain ? { skylineTerrain } : {}),
    trees: {
      fields: SCENE_TREE_FIELDS,
      species,
      count: treeData.length / SCENE_TREE_FIELDS.length,
      data: treeData,
      ids: treeIds,
    },
    species: Object.fromEntries(
      species.map((id) => [
        id,
        {
          label: TREE_SPECIES_DRAWING[id].label,
          crownRatio: SPECIES_CROWN_RATIO[id],
          crownBase: TREE_SPECIES_DRAWING[id].crownBase,
          broadleaf: Boolean(TREE_SPECIES_DRAWING[id].broadleaf),
        },
      ]),
    ) as ScenePackage['species'],
    ...(input.includeModels === false
      ? {}
      : {
          models: Object.fromEntries(species.map((id) => [id, packageModel(id)])) as NonNullable<
            ScenePackage['models']
          >,
        }),
    openings: openingDetails.map(({ geometry, ageYears, retainedShare }) => ({
      kind: 'harvested' as const,
      rings: polygonRings(geometry),
      ageYears,
      retainedShare,
    })),
    debris: { fields: SCENE_DEBRIS_FIELDS, count: debrisData.length / SCENE_DEBRIS_FIELDS.length, data: debrisData },
    ...(treatedData.length
      ? {
          treated: {
            fields: SCENE_TREATED_FIELDS,
            kinds: SCENE_TREATED_KINDS,
            count: treatedData.length / SCENE_TREATED_FIELDS.length,
            data: treatedData,
          },
        }
      : {}),
    roadScars: (input.roadScars ?? []).map((strip) => ({
      kind: strip.kind,
      ring: ring(strip.geometry.coordinates[0]),
    })),
    water: [...water, ...sea],
    camera: {
      position: [0, 0, input.eyeElevationMeters ?? round(originElevation + input.eyeHeightMeters)],
      bearingDegrees: ((input.bearingDegrees % 360) + 360) % 360,
      pitchDegrees: input.pitchDegrees,
      verticalFovDegrees: input.verticalFovDegrees,
      rollDegrees: 0,
      ...(input.viewport ? { projection: scenePerspective(input.verticalFovDegrees, input.viewport) } : {}),
    },
    ...(input.environment ? { environment: { ...input.environment } } : {}),
    ...(burntFires.size
      ? {
          fires: [...burntFires]
            .sort((a, b) => b.year - a.year)
            .map((fire) => ({
              fireNumber: fire.fireNumber ?? null,
              year: fire.year,
              yearsSinceFire: assessmentYear - fire.year,
              sizeHectares: fire.sizeHectares ?? null,
            })),
        }
      : {}),
    treeRadiusMeters,
    ...(input.liveTreeTiles ? { liveTreeTiles: input.liveTreeTiles } : {}),
    notes: [
      ...(input.notes ?? []),
      ...(input.cover?.length
        ? coverNotes
        : ['Ground cover: no inventory read; cover is slope, water, sea and cut only.']),
      ...(sea.length ? [`Sea: ${sea.length} polygon${sea.length === 1 ? '' : 's'} from terrain at or below 0 m.`] : []),
    ],
  }
}

/**
 * Reads a package back, refusing anything that is not one: the adapters read
 * through this, so a malformed file fails with a reason rather than a blank
 * render.
 */
export function parseScenePackage(raw: unknown): ScenePackage {
  const value = raw as Partial<ScenePackage> | null
  if (!value || value.format !== SCENE_PACKAGE_FORMAT) throw new Error('Not a PGMaps forest scene package.')
  if (value.version !== SCENE_PACKAGE_VERSION)
    throw new Error(`Scene package version ${String(value.version)}; this reader knows ${SCENE_PACKAGE_VERSION}.`)
  const terrain = value.terrain
  if (!terrain || terrain.heights?.length !== terrain.columns * terrain.rows)
    throw new Error('The scene package terrain grid does not match its size.')
  const trees = value.trees
  if (
    !trees ||
    !Array.isArray(trees.fields) ||
    trees.fields.length < 7 ||
    !['x', 'y', 'z', 'species', 'height', 'crownWidth', 'tone'].every((field, i) => trees.fields[i] === field) ||
    trees.data?.length !== trees.count * trees.fields.length ||
    (trees.ids !== undefined &&
      (!Array.isArray(trees.ids) || trees.ids.length !== trees.count || trees.ids.some((id) => typeof id !== 'string')))
  )
    throw new Error('The scene package tree list does not match its count.')
  for (const grid of [value.terrain, value.farTerrain, value.skylineTerrain]) {
    if (!grid?.stand) continue
    if (!validStandGrid(grid.stand, grid.columns * grid.rows))
      throw new Error('The scene package stand grid does not match its palette.')
  }
  if (!value.camera || value.camera.position?.length !== 3) throw new Error('The scene package has no camera.')
  checkSceneCamera(value.camera)
  return value as ScenePackage
}

/** A package's terrain height at a local position, bilinear; NaN outside the grid or on a gap. */
export function packageHeightAt(scene: Pick<ScenePackage, 'terrain'>, x: number, y: number): number {
  const { west, south, spacing, columns, rows, heights } = scene.terrain
  const gx = (x - west) / spacing
  const gy = (y - south) / spacing
  if (gx < 0 || gy < 0 || gx > columns - 1 || gy > rows - 1) return NaN
  const x0 = Math.min(columns - 2, Math.floor(gx))
  const y0 = Math.min(rows - 2, Math.floor(gy))
  const fx = gx - x0
  const fy = gy - y0
  const at = (cx: number, cy: number) => heights[cy * columns + cx] ?? NaN
  return (
    at(x0, y0) * (1 - fx) * (1 - fy) +
    at(x0 + 1, y0) * fx * (1 - fy) +
    at(x0, y0 + 1) * (1 - fx) * fy +
    at(x0 + 1, y0 + 1) * fx * fy
  )
}
