/**
 * What a scene package (`scenePackage.ts`) says about the ground past the stems it lists: the crown closure under
 * each terrain post, and each opening's age and retention.
 *
 * Both are read from the inputs the road view grows its stems from, by `placeTrees`' own rules, so the canopy an
 * engine draws past the stems closes where the stems close and opens where they stop: a stand's VRI crown closure,
 * else the regional stand's, rising with height in regeneration the inventory gives none for; nothing on cleared
 * ground, water or non-treed VRI ground; a thinned block keeps its share of crowns at their full width.
 *
 * Also the natural ground cover under each post (`coverOnGrid`, the package's `terrain.cover`): VRI's BC Land Cover
 * Classification read as forest, sparse forest, shrub, herb, rock or water, bluffs from the grid's own slope, cut
 * ground, and the sea (`seaOnGrid`, `seaPolygons`: posts at or below 0 m that reach the grid's edge or are large,
 * traced by marching squares). Display only; DOM-free and network-free.
 */
import {
  CANOPY_CLOSES_AT_METERS,
  REGIONAL_STAND,
  type InventoryStand,
  type StandSpeciesShare,
  type Thinning,
} from './forest'
import type { GroundCover } from './forest'
import type { RegrowthStand } from './regrowth'
import type { TargetPolygon } from './types'
import {
  pointInPolygon,
  polygonInteriorPoint,
  preparePolygons,
  type PolygonGeometry,
  type PreparedPolygons,
} from './visibility'

type Box = [number, number, number, number]

/** What the canopy is read from: the road view's forest configuration, and its water. */
export type CanopyInputs = {
  stands: ReadonlyArray<PolygonGeometry>
  clearings: ReadonlyArray<PolygonGeometry>
  openings?: ReadonlyArray<PolygonGeometry>
  thinnings?: ReadonlyArray<Thinning>
  inventory?: ReadonlyArray<InventoryStand>
  water?: ReadonlyArray<PolygonGeometry>
  /** The stand height where nothing recorded says otherwise (`placeTrees`' `heightMeters`). */
  heightMeters?: number
}

/** A terrain grid in the package's frame, and how to place its posts on the ground. */
export type CanopyGrid = {
  west: number
  south: number
  spacing: number
  columns: number
  rows: number
  heights: ReadonlyArray<number | null>
}

/**
 * Many polygons answering many points inside one box: polygons bucketed on a grid over the box, and each bucket,
 * prepared on first use, holds only the parts that reach it (`preparePolygons`' `within`). Answers the index of the
 * first polygon (input order) holding the point, as `preparePolygons` does.
 */
export function boxedPolygonLookup(
  polygons: ReadonlyArray<PolygonGeometry>,
  box: Box,
  buckets = 48,
): (lng: number, lat: number) => number {
  if (polygons.length === 0) return () => -1
  const [west, south, east, north] = box
  const n = Math.max(1, Math.floor(buckets))
  const width = Math.max(1e-12, east - west) / n
  const height = Math.max(1e-12, north - south) / n
  const lists: number[][] = Array.from({ length: n * n }, () => [])
  const clampCell = (value: number) => Math.min(n - 1, Math.max(0, Math.floor(value)))
  polygons.forEach((geometry, index) => {
    let w = Infinity
    let s = Infinity
    let e = -Infinity
    let nn = -Infinity
    for (const rings of geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates)
      for (const [x, y] of rings[0] ?? []) {
        if (x < w) w = x
        if (x > e) e = x
        if (y < s) s = y
        if (y > nn) nn = y
      }
    if (!(w <= e && s <= nn) || e < west || w > east || nn < south || s > north) return
    const i0 = clampCell((w - west) / width)
    const i1 = clampCell((e - west) / width)
    const j0 = clampCell((s - south) / height)
    const j1 = clampCell((nn - south) / height)
    for (let j = j0; j <= j1; j += 1) for (let i = i0; i <= i1; i += 1) lists[j * n + i].push(index)
  })
  const prepared: Array<PreparedPolygons | null | undefined> = new Array(n * n)
  return (lng, lat) => {
    if (lng < west || lng > east || lat < south || lat > north) return -1
    const cell = clampCell((lat - south) / height) * n + clampCell((lng - west) / width)
    let bucket = prepared[cell]
    if (bucket === undefined) {
      const list = lists[cell]
      const i = cell % n
      const j = (cell - i) / n
      bucket = list.length
        ? preparePolygons(
            list.map((k) => polygons[k]),
            [west + i * width, south + j * height, west + (i + 1) * width, south + (j + 1) * height],
          )
        : null
      prepared[cell] = bucket
    }
    if (!bucket) return -1
    const k = bucket.indexAt(lng, lat)
    return k < 0 ? -1 : lists[cell][k]
  }
}

/** One stem's crown closure, percent, as `placeTrees` sizes its crown (clamped as `crownWidthForClosure` is). */
const stemClosure = (closurePercent: number) => Math.min(0.9, Math.max(0.05, closurePercent / 100))

/**
 * Crown closure, 0–1, of the stand `placeTrees` grows under an inventory stand and a thinning (either may be null).
 * Every stem's crown is sized for its own stand's closure at the full stem density, so the stems of each kind
 * (regenerated, retained, each recorded species' height) close `1 − (1 − c)^share` of the ground each, and crowns
 * falling at random combine as `1 − Π (1 − c)^share`. A thinning keeps its share of the stems at full width, which
 * raises the whole product to that power. Non-treed ground the inventory records — tall shrub included — is 0.
 */
export function standClosure(
  surveyed: InventoryStand | null,
  thinned: Thinning | null,
  heightMeters: number = REGIONAL_STAND.heightMeters,
): number {
  if (surveyed?.cover) return 0
  const regional = REGIONAL_STAND.crownClosurePercent
  const recorded =
    surveyed?.crownClosurePercent && surveyed.crownClosurePercent > 0 ? surveyed.crownClosurePercent : null
  const kinds: Array<{ share: number; height: number }> = []
  if (thinned?.heightMeters != null) kinds.push({ share: 1, height: thinned.heightMeters })
  else {
    const regenerated = surveyed?.regenerationFraction ?? 1
    const mix: ReadonlyArray<StandSpeciesShare> | null =
      surveyed?.speciesMix && surveyed.speciesMix.length > 0 ? surveyed.speciesMix : null
    const regeneratedHeight = surveyed?.heightMeters ?? heightMeters
    if (mix)
      for (const entry of mix)
        kinds.push({ share: regenerated * entry.share, height: entry.heightMeters ?? regeneratedHeight })
    else kinds.push({ share: regenerated, height: regeneratedHeight })
    if (regenerated < 1) kinds.push({ share: 1 - regenerated, height: heightMeters })
  }
  let open = 0
  for (const { share, height } of kinds) {
    if (!(share > 0) || !(height > 0)) continue
    const percent =
      recorded ?? (thinned?.heightMeters ? regional : regional * Math.min(1, height / CANOPY_CLOSES_AT_METERS))
    open += share * Math.log(1 - stemClosure(percent))
  }
  return 1 - Math.exp((thinned ? Math.max(0, Math.min(1, thinned.keepFraction)) : 1) * open)
}

/**
 * Crown closure at every post of a terrain grid, row-major like its heights, rounded to the hundredth: null where the
 * grid has no ground (the road view grows no stem there), 0 outside the stands, on cleared ground (openings, the road
 * clearing, natural masks, tree-free areas), on water and on non-treed VRI ground, else `standClosure`.
 * `toLngLat` places a post given its local metres. Polygon lookups are prepared per bucket of the grid's box, so a
 * 500 × 500 grid against a few thousand VRI polygons costs a fraction of a second.
 */
export function canopyOnGrid(
  grid: CanopyGrid,
  toLngLat: (x: number, y: number) => [number, number],
  inputs: CanopyInputs,
): Array<number | null> {
  const { west, south, spacing, columns, rows, heights } = grid
  const [w, s] = toLngLat(west, south)
  const [e, n] = toLngLat(west + (columns - 1) * spacing, south + (rows - 1) * spacing)
  const box: Box = [Math.min(w, e), Math.min(s, n), Math.max(w, e), Math.max(s, n)]
  const buckets = Math.min(64, Math.max(1, Math.round(Math.max(columns, rows) / 8)))
  const lookup = (polygons: ReadonlyArray<PolygonGeometry> | undefined) =>
    boxedPolygonLookup(polygons ?? [], box, buckets)
  const standAt = inputs.stands.length > 0 ? lookup(inputs.stands) : null
  const cleared = [lookup(inputs.clearings), lookup(inputs.openings), lookup(inputs.water)]
  const inventory = inputs.inventory ?? []
  const thinnings = inputs.thinnings ?? []
  const surveyedAt = lookup(inventory.map((stand) => stand.geometry))
  const thinnedAt = lookup(thinnings.map((thinning) => thinning.geometry))
  const closures = new Map<number, number>()
  const canopy: Array<number | null> = new Array(columns * rows)
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column
      if (heights[index] == null) {
        canopy[index] = null
        continue
      }
      const [lng, lat] = toLngLat(west + column * spacing, south + row * spacing)
      if ((standAt && standAt(lng, lat) < 0) || cleared.some((at) => at(lng, lat) >= 0)) {
        canopy[index] = 0
        continue
      }
      const stand = surveyedAt(lng, lat)
      const thinning = thinnedAt(lng, lat)
      // Many posts share a stand: one figure per (stand, thinning) pair.
      const key = (stand + 1) * (thinnings.length + 1) + (thinning + 1)
      let closure = closures.get(key)
      if (closure === undefined) {
        closure =
          Math.round(standClosure(inventory[stand] ?? null, thinnings[thinning] ?? null, inputs.heightMeters) * 100) /
          100
        closures.set(key, closure)
      }
      canopy[index] = closure
    }
  }
  return canopy
}

/** What an opening's age and retention are read from: the scene's own targets. */
export type OpeningTarget = Pick<
  TargetPolygon,
  'role' | 'geometry' | 'harvestYear' | 'clearcutPercent' | 'siteDisturbance' | 'harvestSystem'
>

export type SceneOpening = { geometry: PolygonGeometry; ageYears: number | null; retainedShare: number | null }

const age = (harvestYear: number | null | undefined, year: number) =>
  harvestYear != null && Number.isFinite(harvestYear) ? Math.max(0, year - harvestYear) : null

/**
 * Cut ground as the road view draws it, each with its age and the share of the stand left standing in it:
 *
 * - `openings` (cleared ground: a block after harvest, site disturbance still counting), each matched to the scene
 *   target it was cut from by an interior point (blocks first). A block is as old as its recorded harvest year, else
 *   0 (just cut, the "after harvest" view); it is a clearcut (`harvestSystem` absent or `clearcut`: 0 retained). Other
 *   targets age from their harvest year (null without one) and keep `100 − clearcutPercent`, null where RESULTS
 *   records 0 % (retention recorded without its split).
 * - `thinnings` (retention and partial-cut blocks after harvest): the share of stems the road view keeps standing.
 * - Existing harvest openings the road view regrows (`buildRegrowthStands`' "harvest estimate" stands, from the
 *   scene's harvested targets and RESULTS/consolidated cutblocks): aged from the record's year while younger than
 *   `greenUpAgeYears`, retaining the share drawn at mature height. One recorded at 0 % clearcut is drawn as the
 *   whole stand and is left out; so is one already covered by an opening above or a newer record.
 *
 * Reserves and wildlife tree patches are cut out of `openings` and `thinnings` before they reach here
 * (`assessmentAlterationClipper`), so their stems stand and they are not cut ground.
 */
export function sceneOpenings({
  openings = [],
  thinnings = [],
  inventory = [],
  targets,
  year,
  greenUpAgeYears = 20,
}: {
  openings?: ReadonlyArray<PolygonGeometry>
  thinnings?: ReadonlyArray<Thinning>
  inventory?: ReadonlyArray<InventoryStand>
  targets?: ReadonlyArray<OpeningTarget>
  year: number
  greenUpAgeYears?: number
}): SceneOpening[] {
  const candidates = [
    ...(targets ?? []).filter((target) => target.role === 'block'),
    ...(targets ?? []).filter((target) => target.role === 'harvested'),
  ]
  const covered: PolygonGeometry[] = []
  const sourceOf = (geometry: PolygonGeometry): OpeningTarget | null => {
    const point = polygonInteriorPoint(geometry)
    if (!point) return null
    return candidates.find((target) => pointInPolygon(target.geometry, point.lng, point.lat)) ?? null
  }
  const result: SceneOpening[] = []
  for (const geometry of openings) {
    const target = sourceOf(geometry)
    covered.push(geometry, ...(target ? [target.geometry] : []))
    if (!target) {
      result.push({ geometry, ageYears: null, retainedShare: null })
      continue
    }
    if (target.role === 'block') {
      const clearcut = target.harvestSystem == null || target.harvestSystem === 'clearcut'
      result.push({ geometry, ageYears: age(target.harvestYear, year) ?? 0, retainedShare: clearcut ? 0 : null })
      continue
    }
    const share =
      target.clearcutPercent != null && target.clearcutPercent > 0
        ? Math.round((1 - Math.min(100, target.clearcutPercent) / 100) * 1000) / 1000
        : null
    result.push({ geometry, ageYears: age(target.harvestYear, year), retainedShare: share })
  }
  for (const thinning of thinnings) {
    const target = sourceOf(thinning.geometry)
    covered.push(thinning.geometry, ...(target ? [target.geometry] : []))
    result.push({
      geometry: thinning.geometry,
      ageYears: target ? (age(target.harvestYear, year) ?? (target.role === 'block' ? 0 : null)) : null,
      retainedShare: Math.round(Math.max(0, Math.min(1, thinning.keepFraction)) * 1000) / 1000,
    })
  }
  // `buildRegrowthStands` lists newer records first, and the drawing takes the first stand holding a stem.
  for (const stand of inventory as ReadonlyArray<InventoryStand & Partial<RegrowthStand>>) {
    if (stand.basis !== 'harvest estimate' || stand.referenceYear == null) continue
    const years = year - stand.referenceYear
    const regenerated = stand.regenerationFraction ?? 1
    if (years < 0 || years >= greenUpAgeYears || !(regenerated > 0)) continue
    const point = polygonInteriorPoint(stand.geometry)
    if (!point || covered.some((geometry) => pointInPolygon(geometry, point.lng, point.lat))) continue
    covered.push(stand.geometry)
    result.push({
      geometry: stand.geometry,
      ageYears: years,
      retainedShare: Math.round((1 - Math.min(1, regenerated)) * 1000) / 1000,
    })
  }
  return result
}

/** `terrain.cover` codes (`scenePackage.ts`). */
export const SCENE_COVER = { forest: 0, sparse: 1, shrub: 2, herb: 3, rock: 4, water: 5, cut: 6 } as const
export type SceneCoverCode = (typeof SCENE_COVER)[keyof typeof SCENE_COVER]

/**
 * Treed ground below this crown closure, percent, is sparse forest: BCLCS level 5 `SP` is 10–25 %, `OP` (open) starts
 * at 26 %.
 */
export const SPARSE_CROWN_CLOSURE_PERCENT = 26
/** A post steeper than this, degrees, is a bluff: rock, whatever the inventory polygon over it says. */
export const BLUFF_SLOPE_DEGREES = 45
/** Ground at or below 0 m that does not reach the grid's edge is sea only from this size, square metres (3 ha). */
export const SEA_MIN_AREA_M2 = 30_000

const WATER_LEVEL_5 = new Set(['LA', 'RI', 'RE', 'OC', 'LL', 'RS'])
const SHRUB_LEVEL_4 = new Set(['ST', 'SL'])

/**
 * A VRI rank-1 polygon's BCLCS levels 1–5 and crown closure as a `terrain.cover` code: treed (level 2 `T`) is forest,
 * or sparse forest at level 5 `SP` or a recorded closure under `SPARSE_CROWN_CLOSURE_PERCENT` (a recorded 0 is a gap
 * in the record, as `placeTrees` reads it); water (level 2 `W`, or a level 5 water code) is water; other
 * non-vegetated land (level 1 `N`: rock, rubble, talus, exposed soil, ice) is rock; vegetated non-treed ground is
 * shrub at level 4 `ST`/`SL`, else herb (herb, bryoid, and non-treed wetland). Null where the record does not say.
 */
export function sceneCoverFromBclcs(
  level1: string | null | undefined,
  level2: string | null | undefined,
  level4: string | null | undefined,
  level5: string | null | undefined,
  crownClosurePercent?: number | null,
): SceneCoverCode | null {
  const l1 = level1?.trim().toUpperCase() ?? ''
  const l2 = level2?.trim().toUpperCase() ?? ''
  const l4 = level4?.trim().toUpperCase() ?? ''
  const l5 = level5?.trim().toUpperCase() ?? ''
  if (l2 === 'T') {
    const closure = crownClosurePercent ?? null
    const sparse = l5 === 'SP' || (closure !== null && closure > 0 && closure < SPARSE_CROWN_CLOSURE_PERCENT)
    return sparse ? SCENE_COVER.sparse : SCENE_COVER.forest
  }
  if (l2 === 'W' || WATER_LEVEL_5.has(l5)) return SCENE_COVER.water
  if (l1 === 'N' || l2 === 'L') return SCENE_COVER.rock
  if (l2 === 'N') return SHRUB_LEVEL_4.has(l4) ? SCENE_COVER.shrub : SCENE_COVER.herb
  return null
}

/** The road view's own ground cover (`groundCoverFromBclcs`) as a `terrain.cover` code; null where it does not say. */
export function sceneCoverFromGround(cover: GroundCover | null | undefined): SceneCoverCode | null {
  switch (cover) {
    case 'water':
      return SCENE_COVER.water
    case 'rock':
      return SCENE_COVER.rock
    case 'shrubLow':
    case 'shrubTall':
      return SCENE_COVER.shrub
    case 'herb':
    case 'wetland':
      return SCENE_COVER.herb
    default:
      return null
  }
}

/** One inventory polygon and the cover it records (null: the record does not say). */
export type SceneCoverPolygon = { geometry: PolygonGeometry; cover: SceneCoverCode | null }

/**
 * One read of the inventory for `terrain.cover`: its polygons, and the boxes ([w, s, e, n], degrees) it read
 * completely. Inside a complete box a post no polygon holds is forest, so a read may leave closed forest out (the
 * capture's read asks only for open ground); outside every box, a post no polygon holds is unknown.
 */
export type SceneCoverSource = {
  polygons: ReadonlyArray<SceneCoverPolygon>
  complete: ReadonlyArray<Box>
  /** What the read left out, for the package's notes; absent when it is whole. */
  note?: string
}

/**
 * An inventory read as a cover source: each stand's BCLCS through `sceneCoverFromBclcs`. `keepForest` false drops
 * stands that read as closed forest, which a complete box already says.
 */
export function coverSourceFromVri(
  stands: ReadonlyArray<{
    geometry: PolygonGeometry
    nonVegetated?: boolean
    landCover?: { level2: string | null; level4: string | null; level5: string | null } | null
    crownClosurePercent: number | null
  }>,
  complete: ReadonlyArray<Box>,
  { keepForest = false, note }: { keepForest?: boolean; note?: string } = {},
): SceneCoverSource {
  const polygons: SceneCoverPolygon[] = []
  for (const stand of stands) {
    const land = stand.landCover
    const level2 = land?.level2 ?? null
    const cover = sceneCoverFromBclcs(
      stand.nonVegetated ? 'N' : level2 ? 'V' : null,
      level2,
      land?.level4,
      land?.level5,
      stand.crownClosurePercent,
    )
    if (cover === SCENE_COVER.forest && !keepForest) continue
    polygons.push({ geometry: stand.geometry, cover })
  }
  return { polygons, complete: [...complete], ...(note ? { note } : {}) }
}

/**
 * Slope at each post of a grid, degrees, from its own heights: central differences, one-sided beside a gap or the
 * edge; NaN where a post or both its neighbours on an axis have no height.
 */
export function slopeOnGrid(grid: CanopyGrid): Float32Array {
  const { spacing, columns, rows, heights } = grid
  const slope = new Float32Array(columns * rows).fill(Number.NaN)
  const at = (column: number, row: number) =>
    column < 0 || row < 0 || column >= columns || row >= rows ? null : heights[row * columns + column]
  const derivative = (before: number | null, here: number, after: number | null) =>
    before != null && after != null
      ? (after - before) / (2 * spacing)
      : after != null
        ? (after - here) / spacing
        : before != null
          ? (here - before) / spacing
          : Number.NaN
  for (let row = 0; row < rows; row += 1)
    for (let column = 0; column < columns; column += 1) {
      const here = at(column, row)
      if (here == null) continue
      const dx = derivative(at(column - 1, row), here, at(column + 1, row))
      const dy = derivative(at(column, row - 1), here, at(column, row + 1))
      slope[row * columns + column] = (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI
    }
  return slope
}

/**
 * The sea on a grid: posts at or below 0 m (Terrarium carries bathymetry) joined edge to edge to the grid's border,
 * or in a patch of at least `minAreaM2`. A small hollow below 0 m inland is not sea. 1 on sea posts.
 */
export function seaOnGrid(grid: CanopyGrid, minAreaM2 = SEA_MIN_AREA_M2): Uint8Array {
  const { spacing, columns, rows, heights } = grid
  const low = (index: number) => {
    const z = heights[index]
    return z != null && z <= 0
  }
  const sea = new Uint8Array(columns * rows)
  const seen = new Uint8Array(columns * rows)
  const minPosts = minAreaM2 / (spacing * spacing)
  const stack: number[] = []
  const patch: number[] = []
  for (let start = 0; start < columns * rows; start += 1) {
    if (seen[start] || !low(start)) continue
    seen[start] = 1
    stack.push(start)
    patch.length = 0
    let edge = false
    while (stack.length) {
      const index = stack.pop()!
      patch.push(index)
      const column = index % columns
      const row = (index - column) / columns
      if (column === 0 || row === 0 || column === columns - 1 || row === rows - 1) edge = true
      const next = [
        column > 0 ? index - 1 : -1,
        column < columns - 1 ? index + 1 : -1,
        row > 0 ? index - columns : -1,
        row < rows - 1 ? index + columns : -1,
      ]
      for (const neighbour of next)
        if (neighbour >= 0 && !seen[neighbour] && low(neighbour)) {
          seen[neighbour] = 1
          stack.push(neighbour)
        }
    }
    if (edge || patch.length >= minPosts) for (const index of patch) sea[index] = 1
  }
  return sea
}

type Ring = Array<[number, number]>

const ringArea = (ring: Ring) => {
  let area = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1)
    area += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1])
  return area / 2
}

const inRing = (ring: Ring, x: number, y: number) => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Douglas–Peucker on an open polyline, keeping both ends. */
function simplifyLine(points: Ring, tolerance: number): Ring {
  if (points.length < 3) return points
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const spans: Array<[number, number]> = [[0, points.length - 1]]
  while (spans.length) {
    const [a, b] = spans.pop()!
    const [ax, ay] = points[a]
    const [bx, by] = points[b]
    const length = Math.hypot(bx - ax, by - ay)
    let farthest = -1
    let distance = tolerance
    for (let i = a + 1; i < b; i += 1) {
      const [px, py] = points[i]
      const d =
        length > 0 ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length : Math.hypot(px - ax, py - ay)
      if (d > distance) {
        distance = d
        farthest = i
      }
    }
    if (farthest > 0) {
      keep[farthest] = 1
      spans.push([a, farthest], [farthest, b])
    }
  }
  return points.filter((_, i) => keep[i])
}

/** Douglas–Peucker on a closed ring (first point not repeated), split at the vertex farthest from the first. */
function simplifyRing(ring: Ring, tolerance: number): Ring {
  if (ring.length < 4) return ring
  let split = 1
  let farthest = -1
  for (let i = 1; i < ring.length; i += 1) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1])
    if (d > farthest) {
      farthest = d
      split = i
    }
  }
  const first = simplifyLine(ring.slice(0, split + 1), tolerance)
  const second = simplifyLine([...ring.slice(split), ring[0]], tolerance)
  return [...first, ...second.slice(1, -1)]
}

/**
 * The sea's outline on a grid (`seaOnGrid`'s posts), in the grid's own frame: marching squares at 0 m over the
 * heights, the sea held below and everything else (land, a hollow too small to be sea, a post with no height, the
 * ground past the border) held above, so each shoreline falls where the ground crosses 0 m between a sea post and its
 * neighbour. Rings are simplified by Douglas–Peucker to `toleranceMeters` (default half the spacing), clamped to the
 * grid, closed, outer ring first (counter-clockwise) then its islands (clockwise); rings under one post's area go.
 */
export function seaPolygons(
  grid: CanopyGrid,
  sea: Uint8Array,
  toleranceMeters = grid.spacing / 2,
): Array<Array<Array<[number, number]>>> {
  const { west, south, spacing, columns, rows, heights } = grid
  if (!sea.some((value) => value)) return []
  // Padded by one post of land all round, so every ring closes inside the padded grid.
  const width = columns + 2
  const height = rows + 2
  const value = new Float64Array(width * height).fill(1)
  for (let row = 0; row < rows; row += 1)
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column
      const z = heights[index]
      value[(row + 1) * width + column + 1] = sea[index] ? Math.min(z ?? 0, -0.05) : z != null && z > 0.05 ? z : 0.05
    }
  const east = west + (columns - 1) * spacing
  const north = south + (rows - 1) * spacing
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  // Edge ids: 2 × post index for the edge east of a post, + 1 for the edge north of it.
  const point = (edge: number): [number, number] => {
    const post = edge >> 1
    const i = post % width
    const j = (post - i) / width
    const other = edge & 1 ? post + width : post + 1
    const va = value[post]
    const t = va / (va - value[other])
    const x = west + (i - 1 + (edge & 1 ? 0 : t)) * spacing
    const y = south + (j - 1 + (edge & 1 ? t : 0)) * spacing
    return [Math.round(clamp(x, west, east) * 100) / 100, Math.round(clamp(y, south, north) * 100) / 100]
  }
  const next = new Map<number, number>()
  for (let j = 0; j < height - 1; j += 1)
    for (let i = 0; i < width - 1; i += 1) {
      const bl = j * width + i
      const corners = [bl, bl + 1, bl + 1 + width, bl + width]
      const inside = corners.map((c) => value[c] < 0)
      if (inside.every((v) => v) || inside.every((v) => !v)) continue
      // The cell's edges counter-clockwise from its bottom: corner k to corner k + 1.
      const edges = [bl * 2, (bl + 1) * 2 + 1, (bl + width) * 2, bl * 2 + 1]
      const crossings: Array<{ edge: number; leaving: boolean }> = []
      for (let k = 0; k < 4; k += 1)
        if (inside[k] !== inside[(k + 1) % 4]) crossings.push({ edge: edges[k], leaving: inside[k] })
      // Sea on the left: leave at an in→out crossing, come back at an out→in one. A saddle joins through the
      // centre when the centre is sea, else cuts each sea corner off.
      const centreSea = (value[corners[0]] + value[corners[1]] + value[corners[2]] + value[corners[3]]) / 4 < 0
      crossings.forEach((crossing, k) => {
        if (!crossing.leaving) return
        const n = crossings.length
        const to = crossings[centreSea ? (k + 1) % n : (k + n - 1) % n]
        next.set(crossing.edge, to.edge)
      })
    }
  const rings: Ring[] = []
  const used = new Set<number>()
  for (const start of next.keys()) {
    if (used.has(start)) continue
    const ring: Ring = []
    let edge: number | undefined = start
    while (edge !== undefined && !used.has(edge)) {
      used.add(edge)
      ring.push(point(edge))
      edge = next.get(edge)
    }
    // Drop repeated points (clamping can stack them on the border).
    const clean = ring.filter((p, k) => {
      const q = ring[(k + ring.length - 1) % ring.length]
      return p[0] !== q[0] || p[1] !== q[1]
    })
    const simplified = simplifyRing(clean, toleranceMeters)
    if (simplified.length >= 3 && Math.abs(ringArea(simplified)) >= spacing * spacing) rings.push(simplified)
  }
  const outers = rings
    .filter((ring) => ringArea(ring) > 0)
    .map((ring) => ({ ring, area: ringArea(ring), holes: [] as Ring[] }))
  for (const hole of rings.filter((ring) => ringArea(ring) < 0)) {
    const [x, y] = hole[0]
    let owner: (typeof outers)[number] | null = null
    for (const outer of outers) if ((!owner || outer.area < owner.area) && inRing(outer.ring, x, y)) owner = outer
    owner?.holes.push(hole)
  }
  const close = (ring: Ring) => [...ring, ring[0]]
  return outers.map(({ ring, holes }) => [close(ring), ...holes.map(close)])
}

/** What `coverOnGrid` reads, beside the grid. */
export type CoverInputs = {
  /** Inventory reads, first polygon holding a post (in source order) wins. */
  sources?: ReadonlyArray<SceneCoverSource>
  /** Cut ground (the package's openings). */
  openings?: ReadonlyArray<PolygonGeometry>
  /** Lakes and rivers (the basemap's water). */
  water?: ReadonlyArray<PolygonGeometry>
  /** The grid's sea posts (`seaOnGrid`). */
  sea?: Uint8Array | null
  bluffSlopeDegrees?: number
}

/**
 * Ground cover at every post of a terrain grid (`SCENE_COVER`), row-major like its heights:
 *
 * 1. null where the grid has no ground;
 * 2. water on the sea and the basemap's water;
 * 3. cut ground in an opening;
 * 4. water where the inventory records water;
 * 5. rock where the grid's own slope (`slopeOnGrid`) passes `bluffSlopeDegrees`, under any inventory polygon (a bluff
 *    in a treed polygon is still a bluff);
 * 6. the inventory's cover (`sceneCoverFromBclcs`; null where its record does not say);
 * 7. forest inside a box a source read completely, else null: ground no read reached is unknown, not forest.
 *
 * `treeless` marks the posts that grow no stand by the road view's own rules (water, and inventory shrub, herb and
 * rock), where the package's canopy is 0; slope alone does not, because the road view still grows stems on a bluff.
 */
export function coverOnGrid(
  grid: CanopyGrid,
  toLngLat: (x: number, y: number) => [number, number],
  inputs: CoverInputs,
): { cover: Array<SceneCoverCode | null>; treeless: Uint8Array } {
  const { west, south, spacing, columns, rows, heights } = grid
  const [w, s] = toLngLat(west, south)
  const [e, n] = toLngLat(west + (columns - 1) * spacing, south + (rows - 1) * spacing)
  const box: Box = [Math.min(w, e), Math.min(s, n), Math.max(w, e), Math.max(s, n)]
  const buckets = Math.min(64, Math.max(1, Math.round(Math.max(columns, rows) / 8)))
  const sources = inputs.sources ?? []
  const polygons = sources.flatMap((source) => source.polygons)
  const recordedAt = boxedPolygonLookup(
    polygons.map((polygon) => polygon.geometry),
    box,
    buckets,
  )
  const waterAt = boxedPolygonLookup(inputs.water ?? [], box, buckets)
  const cutAt = boxedPolygonLookup(inputs.openings ?? [], box, buckets)
  const complete = sources
    .flatMap((source) => source.complete)
    .filter(([cw, cs, ce, cn]) => ce >= box[0] && cw <= box[2] && cn >= box[1] && cs <= box[3])
  const slope = slopeOnGrid(grid)
  const bluff = inputs.bluffSlopeDegrees ?? BLUFF_SLOPE_DEGREES
  const sea = inputs.sea
  const cover: Array<SceneCoverCode | null> = new Array(columns * rows)
  const treeless = new Uint8Array(columns * rows)
  for (let row = 0; row < rows; row += 1)
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column
      if (heights[index] == null) {
        cover[index] = null
        continue
      }
      const [lng, lat] = toLngLat(west + column * spacing, south + row * spacing)
      if (sea?.[index] || waterAt(lng, lat) >= 0) {
        cover[index] = SCENE_COVER.water
        treeless[index] = 1
        continue
      }
      if (cutAt(lng, lat) >= 0) {
        cover[index] = SCENE_COVER.cut
        continue
      }
      const hit = recordedAt(lng, lat)
      const recorded = hit >= 0 ? polygons[hit].cover : undefined
      if (recorded === SCENE_COVER.water) {
        cover[index] = SCENE_COVER.water
        treeless[index] = 1
        continue
      }
      if (recorded === SCENE_COVER.shrub || recorded === SCENE_COVER.herb || recorded === SCENE_COVER.rock)
        treeless[index] = 1
      if (slope[index] > bluff) {
        cover[index] = SCENE_COVER.rock
        continue
      }
      if (recorded !== undefined) {
        cover[index] = recorded
        continue
      }
      cover[index] = complete.some(([cw, cs, ce, cn]) => lng >= cw && lng <= ce && lat >= cs && lat <= cn)
        ? SCENE_COVER.forest
        : null
    }
  return { cover, treeless }
}
