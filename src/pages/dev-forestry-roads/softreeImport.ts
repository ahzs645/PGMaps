/**
 * Softree's ASCII files brought into the road designer: a terrain ASCII file as the project's terrain
 * and a location ASCII coordinate file as a road. The files are read by `softreeAscii.ts`; this module
 * turns what it read into PGMaps' terrain and road.
 *
 * - **Placement.** Neither file states its units or coordinate system, and nothing here guesses
 *   either: the caller passes `unitM` (metres per file unit) and where the metres go, a projected CRS
 *   (`{ epsg }`) or the open project's flat plane (`{ plane }`, file metres = plane metres + offset).
 * - **Terrain.** The terrain ASCII format has no TIN and no flag saying which features are ground, so
 *   the ground is a TIN of every levelled point (`buildTin`, then `rasterizeTin` at half the TIN's
 *   median edge, {@link SOFTREE_TERRAIN_MIN_CELL_M} at finest, triangles longer than eight cells left
 *   missing). A feature whose every level is 0 is a drawn feature with no level (PGMaps' own RoadEng
 *   export writes them so) and is left out of the ground. Drawn features do not become layers; a
 *   RoadEng terrain (`.terx`) brings those.
 * - **Road.** The location file's centreline (`softreeLocationCentreline`, the subgrade's `CL` point)
 *   is fitted as RoadEng designs whose PIs do not rebuild are (`fitPolylineAlignment` within
 *   {@link SOFTREE_LOCATION_FIT_DEVIATION_M}, no minimum radius). The subgrade levels become the
 *   profile, thinned like a RoadEng design's station levels (from {@link SOFTREE_PROFILE_TOLERANCE_M},
 *   doubled until at most {@link SOFTREE_MAX_PVIS} PVIs), and the ground (`OG`) levels the road's
 *   design-file ground.
 *
 * Checked by `softreeImport.test.ts`. Pure: no DOM or network access.
 */
import type { LocalRaster } from '../dev-forestry/types'
import { placedAlignmentRoad, type XY } from './landXmlImport'
import { LOCAL_PLANE_EPSG, type LocalPlacement } from './localPlane'
import { fitPolylineAlignment, MAX_FIT_SOURCE_POINTS } from './polylineFit'
import {
  parseSoftreeLocationAscii,
  parseSoftreeTerrainAscii,
  softreeLocationCentreline,
  type SoftreeLocationAscii,
  type SoftreeTerrainAscii,
} from './softreeAscii'
import { buildTin, rasterizeTin } from './tinSurface'
import type { Alignment, Coordinate, RoadTemplate, TerrainMetadata } from './types'

/** The finest terrain cell made from a terrain ASCII file's TIN, m. */
export const SOFTREE_TERRAIN_MIN_CELL_M = 1
/** Deviation allowed when a location file's centreline is fitted as a road, m. */
export const SOFTREE_LOCATION_FIT_DEVIATION_M = 0.1
/** Profile tolerance a location file's levels are thinned to first, m. */
export const SOFTREE_PROFILE_TOLERANCE_M = 0.01
/** PVIs a road takes at most between its ends (the engine's limit less its two ends). */
export const SOFTREE_MAX_PVIS = 498
/** Design-file ground pairs a road keeps at most (the project's limit). */
const MAX_FILE_GROUND = 10_000

/** Where a file's metres go: a projected CRS, or the open project's flat plane. */
export type SoftreePlacement =
  | { epsg: number; toLonLat: (xyM: XY) => Coordinate }
  | { plane: LocalPlacement; toLonLat: (xyM: XY) => Coordinate }

const planeOf = (placement: SoftreePlacement) => ('plane' in placement ? placement.plane : null)

/** A file's extent in its own units, [minX, minY, maxX, maxY], for the CRS question. */
export function softreeExtent(points: readonly XY[]): [number, number, number, number] {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const [x, y] of points) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return [minX, minY, maxX, maxY]
}

/** A terrain ASCII file's extent in its own units. */
export function softreeTerrainExtent(file: SoftreeTerrainAscii): [number, number, number, number] {
  const [x0, x1, y0, y1] = file.bbox
  return [x0, y0, x1, y1]
}

function medianEdge(coords: Float64Array, triangles: Uint32Array) {
  const count = triangles.length / 3,
    step = Math.max(1, Math.floor(count / 20_000))
  const edges: number[] = []
  for (let t = 0; t < count; t += step) {
    const a = triangles[t * 3],
      b = triangles[t * 3 + 1]
    edges.push(Math.hypot(coords[a * 2] - coords[b * 2], coords[a * 2 + 1] - coords[b * 2 + 1]))
  }
  edges.sort((x, y) => x - y)
  return edges[Math.floor(edges.length / 2)] ?? SOFTREE_TERRAIN_MIN_CELL_M
}

/** A terrain ASCII file as the project's terrain: a grid from the TIN of its levelled points. */
export function softreeTerrainAsciiGround(
  text: string,
  options: {
    fileName: string
    unitM: number
    placement: SoftreePlacement
    verticalReference: string
    sha256: string
  },
): { metadata: TerrainMetadata; notes: string[] } {
  const { unitM, placement } = options
  if (!(unitM > 0 && Number.isFinite(unitM))) throw Error('Choose the unit the terrain file is in.')
  const file = parseSoftreeTerrainAscii(text)
  const plane = planeOf(placement)
  const offset = plane ? plane.offsetM : [0, 0]
  let count = 0
  const levelled = file.features.filter((f) => {
    for (let i = 2; i < f.points.length; i += 3) if (f.points[i] !== 0) return true
    return false
  })
  for (const f of levelled) count += f.points.length / 3
  const x = new Float64Array(count),
    y = new Float64Array(count),
    z = new Float64Array(count)
  let k = 0
  for (const f of levelled)
    for (let i = 0; i < f.points.length; i += 3, k++) {
      x[k] = f.points[i] * unitM - offset[0]
      y[k] = f.points[i + 1] * unitM - offset[1]
      z[k] = f.points[i + 2] * unitM
    }
  if (count < 3) throw Error(`${options.fileName} has fewer than three levelled points to make ground from.`)
  const tin = buildTin({ x, y, z })
  const ground = rasterizeTin(tin, {
    cellM: Math.max(SOFTREE_TERRAIN_MIN_CELL_M, medianEdge(tin.coords, tin.triangles) / 2),
  })
  const verticalReference = options.verticalReference.trim() || 'Not stated'
  const epsg = plane ? LOCAL_PLANE_EPSG : (placement as { epsg: number }).epsg
  const raster: LocalRaster = {
    id: `terrain-${options.sha256.slice(0, 16)}`,
    name: `${options.fileName} (Softree terrain ASCII TIN)`.slice(0, 200),
    kind: 'terrain',
    epsg,
    origin: ground.origin,
    pixelSize: ground.pixelSize,
    width: ground.width,
    height: ground.height,
    values: ground.values,
    acquired: '',
    verticalReference,
    sha256: options.sha256,
  }
  const notes = [
    `Its ground is a TIN of ${tin.cloudPoints.toLocaleString('en-CA')} of its ${count.toLocaleString('en-CA')} levelled points, on ${ground.cellM.toFixed(2)} m cells.`,
  ]
  const unlevelled = file.features.length - levelled.length
  if (unlevelled)
    notes.push(
      `${unlevelled.toLocaleString('en-CA')} feature${unlevelled === 1 ? ' has' : 's have'} no levels (all 0) and ${unlevelled === 1 ? 'is' : 'are'} left out of the ground.`,
    )
  notes.push(...file.warnings)
  return {
    metadata: {
      kind: 'geotiff',
      name: raster.name,
      resolutionM: ground.cellM,
      verticalReference,
      epsg,
      sha256: options.sha256,
      raster,
      ...(plane ? { localPlane: plane } : {}),
    },
    notes,
  }
}

/** A location ASCII file's centreline extent in its own units, for the CRS question. */
export function softreeLocationExtent(file: SoftreeLocationAscii): [number, number, number, number] {
  return softreeExtent(softreeLocationCentreline(file).map((r) => [r.x, r.y]))
}

/** Levels at stations as straight grades, thinned (Douglas–Peucker) to within `toleranceM`. */
function thinLevels(points: readonly { station: number; z: number }[], toleranceM: number) {
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const grade = (points[b].z - points[a].z) / (points[b].station - points[a].station)
    let worst = -1,
      far = toleranceM
    for (let k = a + 1; k < b; k++) {
      const off = Math.abs(points[a].z + grade * (points[k].station - points[a].station) - points[k].z)
      if (off > far) {
        far = off
        worst = k
      }
    }
    if (worst < 0) continue
    keep[worst] = 1
    stack.push([a, worst], [worst, b])
  }
  return points.filter((_, k) => keep[k])
}

/** A location ASCII file's centreline as a new road, with its subgrade profile and recorded ground. */
export function softreeLocationRoad(
  text: string,
  options: {
    fileName: string
    unitM: number
    placement: SoftreePlacement
    id: string
    color: string
    template: RoadTemplate
  },
): { alignment: Alignment; notes: string[] } {
  const { unitM, placement } = options
  if (!(unitM > 0 && Number.isFinite(unitM))) throw Error('Choose the unit the coordinate file is in.')
  const file = parseSoftreeLocationAscii(text)
  const rows = softreeLocationCentreline(file)
  // One row per station, in station order where the file gives stations.
  const stationed = rows.every((r) => r.station !== null)
  const ordered = stationed ? [...rows].sort((a, b) => a.station! - b.station!) : rows
  const distinct = ordered.filter(
    (r, k) => k === 0 || Math.hypot(r.x - ordered[k - 1].x, r.y - ordered[k - 1].y) * unitM > 1e-3,
  )
  if (distinct.length < 2) throw Error(`${options.fileName} has fewer than two centreline (CL) points.`)
  const step = Math.ceil(distinct.length / MAX_FIT_SOURCE_POINTS)
  const used = distinct.filter((_, k) => k % step === 0 || k === distinct.length - 1)
  const fit = fitPolylineAlignment(
    used.map((r) => placement.toLonLat([r.x * unitM, r.y * unitM])),
    { maxDeviationM: SOFTREE_LOCATION_FIT_DEVIATION_M, minRadiusM: 0 },
  )
  // Stations in metres; without stations, the distance along the file's centreline.
  let along = 0
  const stations = distinct.map((r, k) => {
    if (k > 0) along += Math.hypot(r.x - distinct[k - 1].x, r.y - distinct[k - 1].y) * unitM
    return stationed ? r.station! * unitM : along
  })
  const startStation = stations[0]
  const levels = (flag: 'SG' | 'OG') =>
    distinct
      .map((r, k) => ({ station: stations[k], z: r.z[flag] }))
      .filter((p): p is { station: number; z: number } => p.z !== undefined)
      .map((p) => ({ station: p.station, z: p.z * unitM }))
      .filter((p, k, all) => k === 0 || p.station - all[k - 1].station > 1e-6)
  const subgrade = levels('SG')
  let profile: { station: number; z: number }[] = []
  let toleranceM = SOFTREE_PROFILE_TOLERANCE_M
  if (subgrade.length >= 2)
    for (; ; toleranceM *= 2) {
      profile = thinLevels(subgrade, toleranceM)
      if (profile.length <= SOFTREE_MAX_PVIS + 2) break
    }
  const road = placedAlignmentRoad(
    {
      name: options.fileName.replace(/\.[^.]+$/, '').slice(0, 200) || 'Softree location',
      points: fit.points.map((p) => ({ coordinate: p.coordinate, radiusM: p.radiusM, spiralM: 0 })),
      profile: profile.map((p) => ({ station: p.station, elevation: Math.round(p.z * 1000) / 1000, curveLength: 0 })),
      startStation,
      fileLengthM: stations[stations.length - 1] - startStation,
    },
    { id: options.id, color: options.color, template: options.template },
  )
  const ground = levels('OG')
  const groundStep = Math.ceil(ground.length / MAX_FILE_GROUND)
  const fileGround = ground
    .filter((_, k) => k % groundStep === 0 || k === ground.length - 1)
    .map((p): [number, number] => [
      Math.round((p.station - startStation) * road.stationScale * 1000) / 1000,
      Math.round(p.z * 1000) / 1000,
    ])
  const notes = [
    `${options.fileName}: ${distinct.length.toLocaleString('en-CA')} centreline stations fitted within ${fit.maxDeviationM.toFixed(2)} m (${fit.curves} curve${fit.curves === 1 ? '' : 's'}).`,
    profile.length
      ? `Its profile is the subgrade levels within ${toleranceM.toFixed(2)} m (${profile.length} PVIs).`
      : 'It has no subgrade levels, so the road has no profile.',
    ...(stationed
      ? [
          `Stations ${startStation.toFixed(3)} to ${stations[stations.length - 1].toFixed(3)} m (the road's own chainage starts at 0).`,
        ]
      : []),
    ...road.warnings,
    ...file.warnings,
  ]
  return {
    alignment: {
      ...road.alignment,
      ...(fileGround.length >= 2
        ? { fileGround: { source: `${options.fileName} OG levels`.slice(0, 200), points: fileGround } }
        : {}),
    },
    notes,
  }
}
