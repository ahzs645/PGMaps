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
 *   regular grid, wider than the trees so the skyline is there.
 * - **Openings, slash and road scars** as the road view draws them.
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
import { TREE_SPECIES_IDS, type TreeInstance, type TreeSpeciesId } from './forest'
import { CONE_BASE_DIAMETER, SPECIES_CROWN_RATIO } from './forest'
import { forestBands, forestPatches, growForestPatch } from './forestPatches'
import type { ForestConfiguration } from './ForestOverlay'
import { placeDebris, type RoadScarStrip } from './harvestedGround'
import { TREE_SPECIES_DRAWING } from './impostor'
import { detailedTreeMesh } from './treeGeometry'
import type { ElevationSource } from './terrain'
import { metersPerDegree, type PolygonGeometry } from './visibility'

export const SCENE_PACKAGE_FORMAT = 'pgmaps-forest-scene'
export const SCENE_PACKAGE_VERSION = 1

/** Fields of one tree record in `trees.data`, in order. `species` is an index into `trees.species`. */
export const SCENE_TREE_FIELDS = ['x', 'y', 'z', 'species', 'height', 'crownWidth', 'tone'] as const
/** Fields of one debris pile in `debris.data`: base position and footprint across, metres. */
export const SCENE_DEBRIS_FIELDS = ['x', 'y', 'z', 'footprint'] as const

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
  }
  trees: {
    fields: typeof SCENE_TREE_FIELDS
    species: TreeSpeciesId[]
    count: number
    data: number[]
  }
  /** How each species is drawn here, so a renderer can build a matching model. */
  species: Record<TreeSpeciesId, { label: string; crownRatio: number; crownBase: number; broadleaf: boolean }>
  /**
   * Each species' own detailed model (`detailedTreeMesh`), the one the road view draws when it stops, so another
   * renderer can draw the same trees and not only the same positions. Unit height and unit crown width: scale x
   * and y (across) by a stem's crown width and z by its height. Non-indexed triangles in the package frame (z up);
   * `bark` is 1 on wood, 0 on foliage. Our own geometry: no third-party asset to license.
   */
  models?: Record<TreeSpeciesId, { positions: number[]; normals: number[]; bark: number[] }>
  openings: Array<{ kind: 'harvested'; rings: Array<Array<[number, number]>> }>
  debris: { fields: typeof SCENE_DEBRIS_FIELDS; count: number; data: number[] }
  roadScars: Array<{ kind: 'cut' | 'fill'; ring: Array<[number, number]> }>
  /**
   * Lakes and rivers cut to the terrain grid, one entry per polygon: the outer ring first, then holes. The surface
   * is drawn at `elevationMeters`, the lowest ground under the outer ring (null where the terrain has none there).
   * Absent from packages written before water was added.
   */
  water?: Array<{ rings: Array<Array<[number, number]>>; elevationMeters: number | null }>
  camera: {
    /** Eye position, local metres. */
    position: [number, number, number]
    /** Compass bearing the camera faces, degrees clockwise from north. */
    bearingDegrees: number
    /** Up from level, degrees. */
    pitchDegrees: number
    verticalFovDegrees: number
  }
  /** How far out the trees go, metres; the terrain reaches further. */
  treeRadiusMeters: number
  notes: string[]
}

export type ScenePackageInput = {
  /** Where the eye stands. */
  eye: { lng: number; lat: number }
  eyeHeightMeters: number
  bearingDegrees: number
  pitchDegrees: number
  verticalFovDegrees: number
  /** The road view's forest configuration, as `ForestOverlay` receives it. */
  forest: Pick<
    ForestConfiguration,
    'anchorLatitude' | 'stands' | 'clearings' | 'openings' | 'thinnings' | 'inventory' | 'standHeightMeters'
  >
  elevation: ElevationSource
  roadScars?: ReadonlyArray<RoadScarStrip>
  /** Lakes and rivers (the basemap's water); what lies on the terrain grid goes in, cut to it. */
  water?: ReadonlyArray<PolygonGeometry>
  /** Trees out to here (default 600 m: the two bands drawn stem by stem or nearly). */
  treeRadiusMeters?: number
  /** Terrain out to here (default 3 km), at `terrainSpacingMeters` (default 15 m). */
  terrainRadiusMeters?: number
  terrainSpacingMeters?: number
  notes?: string[]
  createdAt?: Date
  /** Include each species' detailed model (default true; about 1.5 MB). */
  includeModels?: boolean
}

/** A species' detailed mesh, unrolled to triangles at unit height and unit crown width. */
function packageModel(species: TreeSpeciesId) {
  const mesh = detailedTreeMesh(species, TREE_SPECIES_IDS.indexOf(species) + 1)
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
  const patches = forestPatches(eye, bands, anchorLatitude)
  const species = [...TREE_SPECIES_IDS]
  const treeData: number[] = []
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
        species.indexOf(tree.species),
        round(tree.heightMeters),
        // A stem's crown width is its height × slenderness (`placeTrees`).
        round(tree.heightMeters * tree.slenderness),
        round(tree.tone, 3),
      )
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

  // The drawn ground on a square grid round the eye.
  const half = Math.ceil(terrainRadiusMeters / terrainSpacingMeters)
  const columns = half * 2 + 1
  const heights: Array<number | null> = []
  for (let row = 0; row < columns; row += 1) {
    const y = (row - half) * terrainSpacingMeters
    for (let column = 0; column < columns; column += 1) {
      const x = (column - half) * terrainSpacingMeters
      const z = elevation.elevationAt(eye.lng + x / scale.lng, eye.lat + y / scale.lat)
      heights.push(Number.isFinite(z) ? round(z) : null)
    }
  }

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

  return {
    format: SCENE_PACKAGE_FORMAT,
    version: SCENE_PACKAGE_VERSION,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
    origin: { lng: eye.lng, lat: eye.lat, elevationMeters: round(originElevation) },
    frame: 'local metres: x east, y north, z up; heights absolute',
    terrain: {
      west: -half * terrainSpacingMeters,
      south: -half * terrainSpacingMeters,
      spacing: terrainSpacingMeters,
      columns,
      rows: columns,
      heights,
    },
    trees: { fields: SCENE_TREE_FIELDS, species, count: treeData.length / SCENE_TREE_FIELDS.length, data: treeData },
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
    openings: openings.map((geometry) => ({ kind: 'harvested' as const, rings: polygonRings(geometry) })),
    debris: { fields: SCENE_DEBRIS_FIELDS, count: debrisData.length / SCENE_DEBRIS_FIELDS.length, data: debrisData },
    roadScars: (input.roadScars ?? []).map((strip) => ({
      kind: strip.kind,
      ring: ring(strip.geometry.coordinates[0]),
    })),
    water,
    camera: {
      position: [0, 0, round(originElevation + input.eyeHeightMeters)],
      bearingDegrees: round(((input.bearingDegrees % 360) + 360) % 360, 1),
      pitchDegrees: round(input.pitchDegrees, 1),
      verticalFovDegrees: round(input.verticalFovDegrees, 1),
    },
    treeRadiusMeters,
    notes: input.notes ?? [],
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
  if (!trees || trees.data?.length !== trees.count * SCENE_TREE_FIELDS.length)
    throw new Error('The scene package tree list does not match its count.')
  if (!value.camera || value.camera.position?.length !== 3) throw new Error('The scene package has no camera.')
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
