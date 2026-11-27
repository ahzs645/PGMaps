import type { ElevationSource } from '@/lib/forestry/terrain/terrain'
import { PACKAGE_SPECIES_IDS, packageSpecies } from './forest'
import { forestBands, forestPatches, growForestPatch } from './forestPatches'
import { SCENE_TREE_FIELDS, treeComponents } from './sceneComponents'
import type { ScenePackage, ScenePackageInput } from './scenePackage'
import { metersPerDegree } from './visibility'

export const TREE_TILE_CAPABILITY = 'live-tree-tiles-v1'
export const TREE_TILE_METERS = 256
export const TREE_TILE_INTERVAL_MS = 120
const DETAIL_METERS = 625
const RETAIN_METERS = 850
const SHADOW_GUARD_METERS = 220
const HEAD_TURN_GUARD = 20
const MAX_RESIDENT = 48
const MAX_PATCH_CACHE = 96

type Point = { lng: number; lat: number }
type Cell = { x: number; y: number }
const cellKey = ({ x, y }: Cell) => `${x}/${y}`
type Tile = Cell & { data: Float64Array }

export function roadTreeArea(route: ReadonlyArray<readonly number[]>, fallback: Point) {
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity
  for (const [lng, lat] of route) {
    west = Math.min(west, lng)
    south = Math.min(south, lat)
    east = Math.max(east, lng)
    north = Math.max(north, lat)
  }
  const origin = route.length ? { lng: (west + east) / 2, lat: (south + north) / 2 } : fallback
  const scale = metersPerDegree(origin.lat)
  const half = route.length ? Math.max((east - west) * scale.lng, (north - south) * scale.lat) / 2 : 0
  const offset = Math.max(
    Math.abs(fallback.lng - origin.lng) * scale.lng,
    Math.abs(fallback.lat - origin.lat) * scale.lat,
  )
  const coversRoute = half <= 9000 && offset <= half + 1500
  const radius = coversRoute ? Math.max(3000, Math.ceil((half + 3000) / 256) * 256) : 6000
  return { origin: coversRoute ? origin : fallback, radius, spacing: Math.max(15, Math.ceil(radius / 320)) }
}

export function treeTileCandidates(
  eye: readonly [number, number, number],
  bearing: number,
  horizontalFov: number,
  resident: ReadonlySet<string>,
  heightAt: (x: number, y: number) => number | null,
  terrainRadius: number,
): Cell[] {
  const cells: Array<Cell & { priority: number; distance: number }> = []
  const [ex, ey, ez] = eye
  const half = TREE_TILE_METERS / 2
  const radians = Math.PI / 180
  const east = Math.sin(bearing * radians),
    north = Math.cos(bearing * radians)
  for (
    let y = Math.floor((ey - RETAIN_METERS) / TREE_TILE_METERS);
    y <= Math.floor((ey + RETAIN_METERS) / TREE_TILE_METERS);
    y++
  ) {
    for (
      let x = Math.floor((ex - RETAIN_METERS) / TREE_TILE_METERS);
      x <= Math.floor((ex + RETAIN_METERS) / TREE_TILE_METERS);
      x++
    ) {
      const tx = x * TREE_TILE_METERS + half,
        ty = y * TREE_TILE_METERS + half
      if (Math.max(Math.abs(tx), Math.abs(ty)) + half > terrainRadius) continue
      const dx = tx - ex,
        dy = ty - ey
      const distance = Math.hypot(Math.max(0, Math.abs(dx) - half), Math.max(0, Math.abs(dy) - half))
      const kept = resident.has(cellKey({ x, y }))
      if (distance > (kept ? RETAIN_METERS : DETAIL_METERS)) continue
      const angle = Math.atan2(Math.abs(dx * north - dy * east), dx * east + dy * north)
      const inView =
        angle <= (horizontalFov / 2 + HEAD_TURN_GUARD) * radians + Math.atan2(Math.SQRT2 * half, Math.hypot(dx, dy))
      if (!kept && !inView && distance > SHADOW_GUARD_METERS) continue
      // A sampled ridge can lower priority only. Uncertain terrain or a change of view still gets its tiles.
      const top = heightAt(tx, ty)
      const ridge =
        distance > SHADOW_GUARD_METERS &&
        inView &&
        top !== null &&
        [0.25, 0.5, 0.75].some((t) => {
          const h = heightAt(ex + dx * t, ey + dy * t)
          return h !== null && h > ez + (top + 65 - ez) * t + 20
        })
      const priority = distance <= SHADOW_GUARD_METERS ? 0 : inView && !ridge ? 1 : 2
      cells.push({ x, y, distance, priority })
    }
  }
  return cells
    .sort((a, b) => a.priority - b.priority || a.distance - b.distance || a.y - b.y || a.x - b.x)
    .slice(0, MAX_RESIDENT)
}

export function createLiveTreeTiles(
  scene: ScenePackage,
  forest: ScenePackageInput['forest'],
  elevation: ElevationSource,
) {
  const scale = metersPerDegree(scene.origin.lat)
  const anchor = forest.anchorLatitude ?? scene.origin.lat
  const [band] = forestBands(DETAIL_METERS)
  const cache = new Map<string, ReturnType<typeof growForestPatch>>()
  const tiles = new Map<string, Tile>()
  const sent = new Set<string>()
  const toPlace = (x: number, y: number) => ({
    lng: scene.origin.lng + x / scale.lng,
    lat: scene.origin.lat + y / scale.lat,
  })
  const grid = scene.terrain
  const radius = Math.min(
    -grid.west,
    -grid.south,
    grid.west + (grid.columns - 1) * grid.spacing,
    grid.south + (grid.rows - 1) * grid.spacing,
  )
  const heightAt = (x: number, y: number) => {
    const col = Math.round((x - grid.west) / grid.spacing),
      row = Math.round((y - grid.south) / grid.spacing)
    if (col < 0 || row < 0 || col >= grid.columns || row >= grid.rows) return null
    return grid.heights[row * grid.columns + col] ?? null
  }
  const grow = (cell: Cell): Tile => {
    const key = cellKey(cell)
    const kept = tiles.get(key)
    if (kept) {
      tiles.delete(key)
      tiles.set(key, kept)
      return kept
    }
    const west = cell.x * TREE_TILE_METERS,
      south = cell.y * TREE_TILE_METERS
    const from = toPlace(west, south),
      to = toPlace(west + TREE_TILE_METERS, south + TREE_TILE_METERS)
    const half = TREE_TILE_METERS / 2
    const data: number[] = []
    for (const patch of forestPatches(toPlace(west + half, south + half), [{ ...band, far: 100 }], anchor)) {
      const [w, s, e, n] = patch.bounds
      if (w >= to.lng || e <= from.lng || s >= to.lat || n <= from.lat) continue
      let stems = cache.get(patch.key)
      if (!stems) {
        stems = growForestPatch(patch, band, { ...forest, heightMeters: forest.standHeightMeters }, elevation, anchor)
        cache.set(patch.key, stems)
        if (cache.size > MAX_PATCH_CACHE) cache.delete(cache.keys().next().value!)
      }
      for (const tree of stems) {
        const x = (tree.lng - scene.origin.lng) * scale.lng,
          y = (tree.lat - scene.origin.lat) * scale.lat
        if (Math.floor(x / TREE_TILE_METERS) !== cell.x || Math.floor(y / TREE_TILE_METERS) !== cell.y) continue
        data.push(
          x,
          y,
          tree.elevationMeters,
          PACKAGE_SPECIES_IDS.indexOf(packageSpecies(tree.species)),
          tree.heightMeters,
          tree.heightMeters * tree.slenderness,
          tree.tone,
          ...treeComponents(tree),
        )
      }
    }
    const tile = { ...cell, data: new Float64Array(data) }
    tiles.set(key, tile)
    if (tiles.size > MAX_PATCH_CACHE) tiles.delete(tiles.keys().next().value!)
    return tile
  }
  return {
    outside(place: Point) {
      return (
        Math.max(
          Math.abs(place.lng - scene.origin.lng) * scale.lng,
          Math.abs(place.lat - scene.origin.lat) * scale.lat,
        ) >
        radius - 1500
      )
    },
    next(eye: readonly [number, number, number], bearing: number, fov: number) {
      const wanted = treeTileCandidates(eye, bearing, fov, sent, heightAt, radius)
      const keys = new Set(wanted.map(cellKey))
      const remove = [...sent].filter((key) => !keys.has(key))
      const add = wanted
        .filter((cell) => !sent.has(cellKey(cell)))
        .slice(0, 2)
        .map(grow)
      const transfer = add.map(({ data }) => data.slice())
      return add.length || remove.length
        ? {
            message: {
              type: 'pgmaps-tree-tiles',
              generation: scene.liveTreeTiles?.generation,
              fields: SCENE_TREE_FIELDS,
              species: PACKAGE_SPECIES_IDS,
              remove,
              add: add.map(({ x, y }, i) => ({ x, y, data: transfer[i] })),
            },
            transfer: transfer.map((data) => data.buffer),
            commit() {
              for (const key of remove) sent.delete(key)
              for (const cell of add) sent.add(cellKey(cell))
            },
          }
        : null
    },
  }
}
