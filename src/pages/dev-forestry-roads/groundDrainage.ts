/**
 * Existing-ground drainage before the first peg: route flow over the terrain inside an analysis
 * area (drawn, imported or a block's boundary) and an optional upslope margin, with no road. The
 * routing is the road check's own (`hydrology.ts`: D8 conditioning, flow accumulation, streams;
 * `drainageCatchments.ts`: watersheds and the catchment above an outlet); only the ground differs.
 *
 * The grid is the drainage run's tiled layout (`GridTiles`, 32-cell tiles): only the tiles that
 * touch the area or its margin are sampled, and the routed-cell budget (`MAX_DRAINAGE_ROUTED_CELLS`)
 * counts those tiles, never the box. Every cell is one of three zones: outside (never sampled,
 * stored as NaN, an outlet like the grid's edge), the area, or the margin. A cell in the area or
 * margin without ground stays missing: a gap is never filled.
 *
 * Sampling reads the terrain through `elevationAt`, which cannot cross to a worker, so it is a
 * generator the page drives in slices (`cooperative.ts`); routing and outlets take only the grid
 * and run in `groundDrainage.worker.ts`. Pure: projection is passed in, no DOM or network access.
 */
import { CORRIDOR_CELL_GROWTH, CORRIDOR_TILE_SHIFT } from './corridorGrid'
import {
  catchmentPolygon,
  DEFAULT_POUR_POINT_SNAP_M,
  MAX_POUR_POINT_SNAP_M,
  delineateWatersheds,
  gridCellNumber,
  snapPourPoint,
  upstreamMask,
  type CatchmentProperties,
} from './drainageCatchments'
import { parseDepressionPolicy, parseSnapPolicy, type DepressionPolicy, type SnapPolicy } from './drainagePolicies'
import { MAX_DRAINAGE_ROUTED_CELLS } from './drainageRun'
import {
  conditionDrainageSurface,
  downstreamCells,
  extractStreams,
  flowAccumulation,
  MISSING,
  type ConditioningDiagnostics,
  type StreamCollection,
} from './hydrology'
import {
  absentCellKind,
  cellCentre,
  cellRowCol,
  gridCellIndex,
  TILE_NO_GROUND,
  TILE_NOT_SAMPLED,
  type GridTiles,
  type SurfaceGrid,
  type ToGrid,
  type ToLonLat,
} from './surfaceGrid'
import type { Coordinate, TerrainSource } from './types'

/** The widest upslope margin sampled around an analysis area, m (the road check's buffer limit). */
export const MAX_GROUND_DRAINAGE_MARGIN_M = 2_000
/** The most vertices an analysis area may have, as an imported spatial file. */
export const MAX_GROUND_DRAINAGE_AREA_VERTICES = 50_000
/** The widest snap radius around a requested outlet, m (`snapPourPoint`'s limit). */
export const MAX_GROUND_DRAINAGE_SNAP_M = MAX_POUR_POINT_SNAP_M

/** Zone of each stored cell. */
export const ZONE_OUTSIDE = 0
export const ZONE_AREA = 1
export const ZONE_MARGIN = 2

export type GroundDrainageAreaSource = 'drawn' | 'imported' | 'block'
export interface GroundDrainageArea {
  source: GroundDrainageAreaSource
  name: string
  /** The block's context feature, when the area was taken from one. A copy: editing the block does not move it. */
  contextId?: string
  /** The file an imported area was read from. */
  fileName?: string
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
}
export interface GroundDrainageSettings {
  /** Contributing area at which a flow line is drawn as a stream, ha. */
  streamThresholdHa: number
  /** Ground sampled beyond the area's boundary, so catchments draining into it are not cut off, m. */
  marginM: number
  /** Optional coarser working grid; never finer than the source or the 1 m sampling floor. */
  workingResolutionM?: number
  /** Omitted is the full Priority-Flood conditioning, as the road check's default. */
  depressionPolicy?: DepressionPolicy
  /** Omitted draws no watersheds. */
  watershedMinAreaHa?: number
  /** Pour-point snap radius, m. Not a routing setting: changing it reuses the routed grid. */
  snapRadiusM: number
  snapPolicy?: SnapPolicy
}
export const DEFAULT_GROUND_DRAINAGE_SETTINGS: GroundDrainageSettings = {
  streamThresholdHa: 1,
  marginM: 0,
  snapRadiusM: DEFAULT_POUR_POINT_SNAP_M,
}
/** Saved with the project: the inputs only. Results are recomputed from the terrain. */
export interface GroundDrainageState {
  area?: GroundDrainageArea
  settings: GroundDrainageSettings
  /** The requested outlet, lon/lat. */
  outlet?: Coordinate
}

const object = (value: unknown, label: string) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${label} must be an object.`)
  return value as Record<string, unknown>
}
const number = (value: unknown, min: number, max: number, label: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw Error(`${label} must be a number from ${min} to ${max.toLocaleString('en-CA')}.`)
  return value
}
const coordinate = (value: unknown, label: string): Coordinate => {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    !Number.isFinite(value[0]) ||
    !Number.isFinite(value[1]) ||
    Math.abs(value[0] as number) > 180 ||
    Math.abs(value[1] as number) > 90
  )
    throw Error(`${label} must be a longitude and latitude.`)
  return [value[0] as number, value[1] as number]
}

function parseRings(value: unknown, label: string, count: { vertices: number }): Coordinate[][] {
  if (!Array.isArray(value) || !value.length) throw Error(`${label} needs at least one ring.`)
  return value.map((ring) => {
    if (!Array.isArray(ring) || ring.length < 4) throw Error(`${label} rings need at least three corners.`)
    count.vertices += ring.length
    if (count.vertices > MAX_GROUND_DRAINAGE_AREA_VERTICES)
      throw Error(
        `The analysis area has more than ${MAX_GROUND_DRAINAGE_AREA_VERTICES.toLocaleString('en-CA')} vertices. Simplify it first.`,
      )
    const points = ring.map((p) => coordinate(p, label))
    const [first, last] = [points[0], points[points.length - 1]]
    if (first[0] !== last[0] || first[1] !== last[1]) points.push([...first])
    return points
  })
}

export function parseGroundDrainageArea(value: unknown): GroundDrainageArea {
  const r = object(value, 'Analysis area')
  if (r.source !== 'drawn' && r.source !== 'imported' && r.source !== 'block')
    throw Error('An analysis area is drawn, imported or taken from a block.')
  if (typeof r.name !== 'string' || !r.name.trim() || r.name.length > 200)
    throw Error('An analysis area needs a name of at most 200 characters.')
  const g = object(r.geometry, 'Analysis area geometry')
  const count = { vertices: 0 }
  const geometry: GroundDrainageArea['geometry'] =
    g.type === 'Polygon'
      ? { type: 'Polygon', coordinates: parseRings(g.coordinates, 'Analysis area', count) }
      : g.type === 'MultiPolygon' && Array.isArray(g.coordinates) && g.coordinates.length
        ? {
            type: 'MultiPolygon',
            coordinates: g.coordinates.map((polygon) => parseRings(polygon, 'Analysis area', count)),
          }
        : (() => {
            throw Error('An analysis area must be a polygon or multipolygon.')
          })()
  return {
    source: r.source,
    name: r.name.trim(),
    ...(typeof r.contextId === 'string' && r.contextId ? { contextId: r.contextId } : {}),
    ...(typeof r.fileName === 'string' && r.fileName ? { fileName: r.fileName.slice(0, 260) } : {}),
    geometry,
  }
}

export function parseGroundDrainageSettings(value?: unknown): GroundDrainageSettings {
  const r = value === undefined ? DEFAULT_GROUND_DRAINAGE_SETTINGS : object(value, 'Existing-ground drainage settings')
  return {
    streamThresholdHa: number(r.streamThresholdHa, 0.05, 500, 'Stream threshold'),
    marginM: number(r.marginM, 0, MAX_GROUND_DRAINAGE_MARGIN_M, 'Upslope buffer'),
    ...(r.workingResolutionM === undefined
      ? {}
      : { workingResolutionM: number(r.workingResolutionM, 1, 100_000, 'Working grid resolution') }),
    ...(r.depressionPolicy === undefined ? {} : { depressionPolicy: parseDepressionPolicy(r.depressionPolicy) }),
    ...(r.watershedMinAreaHa === undefined
      ? {}
      : { watershedMinAreaHa: number(r.watershedMinAreaHa, 0, 100_000, 'Minimum watershed area') }),
    snapRadiusM: number(r.snapRadiusM, 0, MAX_GROUND_DRAINAGE_SNAP_M, 'Pour-point snap radius'),
    ...(r.snapPolicy === undefined ? {} : { snapPolicy: parseSnapPolicy(r.snapPolicy) }),
  }
}

export function parseGroundDrainage(value: unknown): GroundDrainageState {
  const r = object(value, 'Existing-ground drainage')
  return {
    ...(r.area === undefined ? {} : { area: parseGroundDrainageArea(r.area) }),
    settings: parseGroundDrainageSettings(r.settings),
    ...(r.outlet === undefined ? {} : { outlet: coordinate(r.outlet, 'The drainage outlet') }),
  }
}

/**
 * What the routed overlay depends on: the terrain, the area and the routing settings. The road
 * is not part of it, so pegging or moving a road never stales the overlay; the outlet and its
 * snap are not either, because an outlet is answered from the routed grid.
 */
export function groundDrainageKey({
  terrainFingerprint,
  area,
  settings,
}: {
  terrainFingerprint: string
  area: GroundDrainageArea
  settings: GroundDrainageSettings
}): string {
  const routing = {
    streamThresholdHa: settings.streamThresholdHa,
    marginM: settings.marginM,
    workingResolutionM: settings.workingResolutionM ?? null,
    depressionPolicy: parseDepressionPolicy(settings.depressionPolicy),
    watershedMinAreaHa: settings.watershedMinAreaHa ?? null,
  }
  const text = JSON.stringify([area.geometry, routing])
  let a = 2166136261,
    b = 2246822519
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619)
    b = Math.imul(b ^ text.charCodeAt(i), 3266489917)
  }
  return `${terrainFingerprint}|ground-drainage-v1-${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`
}

/** Planar area of the analysis area in the projected frame, holes taken out, m². */
export function areaSquareMetres(geometry: GroundDrainageArea['geometry'], toGrid: ToGrid): number {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  let total = 0
  for (const polygon of polygons)
    polygon.forEach((ring, k) => {
      const xy = ring.map((c) => toGrid(c as Coordinate))
      let twice = 0
      for (let i = 1; i < xy.length; i++) twice += xy[i - 1][0] * xy[i][1] - xy[i][0] * xy[i - 1][1]
      total += (k === 0 ? 1 : -1) * Math.abs(twice / 2)
    })
  return Math.max(0, total)
}

type Ring = [number, number][]

/** Union of [start, end] intervals, sorted. */
function mergeIntervals(values: number[]): number[] {
  const pairs: [number, number][] = []
  for (let i = 0; i < values.length; i += 2) pairs.push([values[i], values[i + 1]])
  pairs.sort((a, b) => a[0] - b[0])
  const out: number[] = []
  for (const [s, e] of pairs) {
    if (out.length && s <= out[out.length - 1]) out[out.length - 1] = Math.max(out[out.length - 1], e)
    else out.push(s, e)
  }
  return out
}

/** Where the line y = `y` crosses the capsule of radius `r` round segment a–b: one interval, or null. */
export function capsuleSpan(a: [number, number], b: [number, number], r: number, y: number): [number, number] | null {
  let lo = Infinity,
    hi = -Infinity
  for (const p of [a, b]) {
    const dy = y - p[1]
    if (Math.abs(dy) <= r) {
      const s = Math.sqrt(r * r - dy * dy)
      lo = Math.min(lo, p[0] - s)
      hi = Math.max(hi, p[0] + s)
    }
  }
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (len > 0 && r > 0) {
    const nx = (-(b[1] - a[1]) / len) * r,
      ny = ((b[0] - a[0]) / len) * r
    const corners: [number, number][] = [
      [a[0] + nx, a[1] + ny],
      [b[0] + nx, b[1] + ny],
      [b[0] - nx, b[1] - ny],
      [a[0] - nx, a[1] - ny],
    ]
    for (let i = 0; i < 4; i++) {
      const p = corners[i],
        q = corners[(i + 1) % 4]
      if ((p[1] - y) * (q[1] - y) > 0 || p[1] === q[1]) continue
      const x = p[0] + ((y - p[1]) * (q[0] - p[0])) / (q[1] - p[1])
      lo = Math.min(lo, x)
      hi = Math.max(hi, x)
    }
  }
  return lo <= hi ? [lo, hi] : null
}

/** Inside spans of one polygon (outer ring and holes, even-odd) along the line y = `y`. */
function polygonSpans(rings: Ring[], y: number, out: number[]) {
  const xs: number[] = []
  for (const ring of rings)
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1],
        b = ring[i]
      if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]))
    }
  xs.sort((p, q) => p - q)
  for (let i = 0; i + 1 < xs.length; i += 2) out.push(xs[i], xs[i + 1])
}

/** Column ranges [start, end] (inclusive) of the cells whose centres lie in `spans`, clipped to the grid. */
function columnRanges(spans: number[], originX: number, cellM: number, width: number): Int32Array {
  const out: number[] = []
  for (let i = 0; i < spans.length; i += 2) {
    const c0 = Math.max(0, Math.ceil((spans[i] - originX) / cellM - 1e-9)),
      c1 = Math.min(width - 1, Math.floor((spans[i + 1] - originX) / cellM + 1e-9))
    if (c1 >= c0) {
      if (out.length && c0 <= out[out.length - 1] + 1) out[out.length - 1] = Math.max(out[out.length - 1], c1)
      else out.push(c0, c1)
    }
  }
  return Int32Array.from(out)
}

interface RowZones {
  /** Column ranges of the area, per grid row. */
  area: Int32Array[]
  /** Column ranges of the area and margin together, per grid row. */
  zone: Int32Array[]
}

function rowZones(
  polygons: Ring[][],
  marginM: number,
  origin: [number, number],
  cellM: number,
  width: number,
  height: number,
): RowZones {
  const rowOf = (y: number) => (origin[1] - y) / cellM
  // Bucket each polygon's rows, and each edge's capsule rows, so a row reads only what crosses it.
  const polygonRows: number[][] = Array.from({ length: height }, () => [])
  const edgeRows: number[][] = Array.from({ length: height }, () => [])
  const edges: [[number, number], [number, number]][] = []
  polygons.forEach((polygon, k) => {
    let minY = Infinity,
      maxY = -Infinity
    for (const ring of polygon)
      for (let i = 0; i < ring.length; i++) {
        minY = Math.min(minY, ring[i][1])
        maxY = Math.max(maxY, ring[i][1])
        if (marginM > 0 && i > 0) {
          const a = ring[i - 1],
            b = ring[i],
            e = edges.length
          edges.push([a, b])
          const r0 = Math.max(0, Math.ceil(rowOf(Math.max(a[1], b[1]) + marginM))),
            r1 = Math.min(height - 1, Math.floor(rowOf(Math.min(a[1], b[1]) - marginM)))
          for (let r = r0; r <= r1; r++) edgeRows[r].push(e)
        }
      }
    const r0 = Math.max(0, Math.ceil(rowOf(maxY))),
      r1 = Math.min(height - 1, Math.floor(rowOf(minY)))
    for (let r = r0; r <= r1; r++) polygonRows[r].push(k)
  })
  const area: Int32Array[] = [],
    zone: Int32Array[] = []
  for (let r = 0; r < height; r++) {
    const y = origin[1] - r * cellM
    const spans: number[] = []
    for (const k of polygonRows[r]) polygonSpans(polygons[k], y, spans)
    const inside = mergeIntervals(spans)
    area.push(columnRanges(inside, origin[0], cellM, width))
    if (marginM > 0) {
      const all = [...inside]
      for (const e of edgeRows[r]) {
        const span = capsuleSpan(edges[e][0], edges[e][1], marginM, y)
        if (span) all.push(span[0], span[1])
      }
      zone.push(columnRanges(mergeIntervals(all), origin[0], cellM, width))
    } else zone.push(area[r])
  }
  return { area, zone }
}

const rangesTouch = (ranges: Int32Array, c0: number, c1: number) => {
  for (let i = 0; i < ranges.length; i += 2) if (ranges[i] <= c1 && ranges[i + 1] >= c0) return true
  return false
}

export interface AreaGrid {
  grid: SurfaceGrid & { tiles: GridTiles }
  /** Zone of each stored cell (`ZONE_OUTSIDE`, `ZONE_AREA`, `ZONE_MARGIN`), in the grid's own order. */
  zone: Uint8Array
  summary: AreaGridSummary
}
export interface AreaGridSummary {
  cellM: number
  /** The terrain's own spacing, m. */
  sourceM: number
  requestedM?: number
  /** The finest cell allowed: source, request and the 1 m floor. */
  minimumM: number
  coarsenedForBudget: boolean
  maxCells: number
  /** The grid's box, m, and its cells at this cell size. */
  extentM: [number, number]
  boxCells: number
  /** Cells held in tiles (padding past the grid's edge excluded): what is routed. */
  heldCells: number
  areaCells: number
  marginCells: number
  /** Area and margin cells with ground. */
  groundCells: number
  /** Area and margin cells without ground: gaps, never filled. */
  missingAreaCells: number
  missingMarginCells: number
  tileCells: number
}
export interface AreaSampleProgress {
  done: number
  total: number
}

/**
 * Sample the area and its margin into the drainage grid's tiled layout, starting at the finest
 * cell allowed and growing it ×1.25 until the tiles that touch the area fit the routed-cell budget.
 * Yields after each tile; drive it with `runCooperatively` (or `runToCompletion` in tests).
 */
export function* sampleAreaGridSteps(
  terrain: TerrainSource,
  area: GroundDrainageArea['geometry'],
  toGrid: ToGrid,
  {
    sourceM,
    marginM = 0,
    workingResolutionM,
    maxCells = MAX_DRAINAGE_ROUTED_CELLS,
    toLonLat,
  }: {
    sourceM: number
    marginM?: number
    workingResolutionM?: number
    maxCells?: number
    toLonLat: ToLonLat
  },
): Generator<AreaSampleProgress, AreaGrid> {
  if (!Number.isFinite(sourceM) || sourceM <= 0 || sourceM > 100_000)
    throw Error('The source resolution must be greater than zero and at most 100,000 m.')
  if (!Number.isFinite(marginM) || marginM < 0 || marginM > MAX_GROUND_DRAINAGE_MARGIN_M)
    throw Error(`The upslope margin must be from 0 to ${MAX_GROUND_DRAINAGE_MARGIN_M.toLocaleString('en-CA')} m.`)
  if (!Number.isInteger(maxCells) || maxCells < 1 || maxCells > MAX_DRAINAGE_ROUTED_CELLS)
    throw Error('The drainage cell budget must be from 1 to 4,194,304 routed cells.')
  const polygons: Ring[][] = (area.type === 'Polygon' ? [area.coordinates] : area.coordinates).map((polygon) =>
    polygon.map((ring) => ring.map((c) => toGrid(c as Coordinate))),
  )
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const polygon of polygons)
    for (const [x, y] of polygon[0]) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw Error('The analysis area does not project onto the map.')
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  ;[minX, minY, maxX, maxY] = [minX - marginM, minY - marginM, maxX + marginM, maxY + marginM]
  const spanX = maxX - minX,
    spanY = maxY - minY
  if (!(spanX > 0 && spanY > 0)) throw Error('The analysis area has no extent.')
  const minimumM = Math.max(1, sourceM, workingResolutionM ?? 0)
  let shift = CORRIDOR_TILE_SHIFT
  while (shift > 0 && 4 << (2 * shift) > maxCells) shift--
  const side = 1 << shift,
    tileCells = side * side
  let cell = minimumM
  let width = 0,
    height = 0,
    across = 0,
    down = 0,
    origin: [number, number] = [0, 0],
    zones: RowZones = { area: [], zone: [] },
    wanted = new Uint8Array(0)
  for (;;) {
    width = Math.floor(spanX / cell) + 1
    height = Math.floor(spanY / cell) + 1
    origin = [minX + cell / 2, maxY - cell / 2]
    across = Math.ceil(width / side)
    down = Math.ceil(height / side)
    // The row ranges alone are `height` small arrays; a box too large for them is coarsened first.
    if (height > 200_000 || width > 200_000) {
      cell *= CORRIDOR_CELL_GROWTH
      continue
    }
    zones = rowZones(polygons, marginM, origin, cell, width, height)
    wanted = new Uint8Array(across * down)
    let count = 0
    for (let ty = 0; ty < down; ty++)
      for (let tx = 0; tx < across; tx++) {
        const c0 = tx * side,
          c1 = Math.min(width - 1, c0 + side - 1)
        for (let r = ty * side; r < Math.min(height, ty * side + side); r++)
          if (rangesTouch(zones.zone[r], c0, c1)) {
            wanted[ty * across + tx] = 1
            count++
            break
          }
      }
    if (!count) throw Error('The analysis area is smaller than one cell of the working grid.')
    if (count * tileCells <= maxCells) break
    cell *= CORRIDOR_CELL_GROWTH
  }
  let wantedCount = 0
  for (const v of wanted) wantedCount += v
  const position = new Int32Array(across * down).fill(TILE_NOT_SAMPLED),
    held = new Int32Array(down),
    rowBase = new Int32Array(down + 1),
    columnStart = new Int32Array(down + 1)
  const columns: number[] = [],
    blocks: { values: Float64Array; zone: Uint8Array }[][] = []
  const values = new Float64Array(tileCells),
    zone = new Uint8Array(tileCells)
  const xy: [number, number] = [0, 0]
  let heldCells = 0,
    areaCells = 0,
    marginCells = 0,
    groundCells = 0,
    missingAreaCells = 0,
    missingMarginCells = 0,
    done = 0
  for (let ty = 0; ty < down; ty++) {
    const rowTiles: { values: Float64Array; zone: Uint8Array }[] = []
    columnStart[ty] = columns.length
    const rows = Math.min(side, height - ty * side)
    for (let tx = 0; tx < across; tx++) {
      const t = ty * across + tx
      if (!wanted[t]) continue
      const cols = Math.min(side, width - tx * side)
      values.fill(NaN)
      zone.fill(ZONE_OUTSIDE)
      let ground = 0,
        inZone = 0,
        inArea = 0,
        missingArea = 0,
        missingMargin = 0
      for (let rr = 0; rr < rows; rr++) {
        const row = ty * side + rr
        xy[1] = origin[1] - row * cell
        const areaRanges = zones.area[row],
          zoneRanges = zones.zone[row]
        for (let k = 0; k < zoneRanges.length; k += 2) {
          const c0 = Math.max(zoneRanges[k], tx * side),
            c1 = Math.min(zoneRanges[k + 1], tx * side + cols - 1)
          for (let col = c0; col <= c1; col++) {
            const isArea = rangesTouch(areaRanges, col, col)
            const at = rr * side + (col - tx * side)
            zone[at] = isArea ? ZONE_AREA : ZONE_MARGIN
            inZone++
            if (isArea) inArea++
            xy[0] = origin[0] + col * cell
            const [lon, lat] = toLonLat(xy)
            const z = terrain.elevationAt(lon, lat)
            if (Number.isFinite(z)) {
              values[at] = z
              ground++
            } else if (isArea) missingArea++
            else missingMargin++
          }
        }
      }
      areaCells += inArea
      marginCells += inZone - inArea
      missingAreaCells += missingArea
      missingMarginCells += missingMargin
      done++
      if (!inZone) {
        yield { done, total: wantedCount }
        continue
      }
      if (!ground) {
        // Sampled and empty: a terrain gap, which `absentCellKind` reads as no data, not the edge.
        position[t] = TILE_NO_GROUND
        yield { done, total: wantedCount }
        continue
      }
      position[t] = rowTiles.length
      rowTiles.push({ values: Float64Array.from(values), zone: Uint8Array.from(zone) })
      columns.push(tx)
      heldCells += rows * cols
      groundCells += ground
      yield { done, total: wantedCount }
    }
    held[ty] = rowTiles.length
    blocks.push(rowTiles)
  }
  columnStart[down] = columns.length
  const stored = columns.length * tileCells
  if (!stored) throw Error('The terrain has no ground inside the analysis area or its margin.')
  const allValues = new Float64Array(stored),
    allZones = new Uint8Array(stored),
    rowOfBlock = new Int32Array(columns.length)
  let block = 0
  for (let ty = 0; ty < down; ty++) {
    rowBase[ty] = block * tileCells
    const tiles = blocks[ty],
      stride = tiles.length * side
    tiles.forEach((data, pos) => {
      for (let rr = 0; rr < side; rr++) {
        const at = rowBase[ty] + rr * stride + pos * side
        allValues.set(data.values.subarray(rr * side, rr * side + side), at)
        allZones.set(data.zone.subarray(rr * side, rr * side + side), at)
      }
    })
    for (let k = 0; k < tiles.length; k++) rowOfBlock[block++] = ty
  }
  rowBase[down] = block * tileCells
  return {
    grid: {
      origin,
      cellM: cell,
      width,
      height,
      values: allValues,
      tiles: {
        side,
        shift,
        across,
        down,
        position,
        held,
        rowBase,
        columns: Int32Array.from(columns),
        columnStart,
        rowOfBlock,
      },
    },
    zone: allZones,
    summary: {
      cellM: cell,
      sourceM,
      ...(workingResolutionM === undefined ? {} : { requestedM: workingResolutionM }),
      minimumM,
      coarsenedForBudget: cell > minimumM,
      maxCells,
      extentM: [spanX, spanY],
      boxCells: width * height,
      heldCells,
      areaCells,
      marginCells,
      groundCells,
      missingAreaCells,
      missingMarginCells,
      tileCells: side,
    },
  }
}

/** The routed grid kept for outlets: its directions, accumulation and zones. Never serialized. */
export interface AreaRouting {
  grid: AreaGrid['grid']
  zone: Uint8Array
  directions: Int8Array
  accumulation: Float64Array
  streams: StreamCollection
  watersheds?: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, CatchmentProperties>
  conditioning: ConditioningDiagnostics
}

/** Condition, route and extract streams (and, when asked, watersheds) over a sampled area. */
export function routeAreaGrid(
  area: Pick<AreaGrid, 'grid' | 'zone'>,
  settings: Pick<GroundDrainageSettings, 'streamThresholdHa' | 'depressionPolicy' | 'watershedMinAreaHa'>,
  toLonLat: ToLonLat,
): AreaRouting {
  const { grid, zone } = area
  if (zone.length !== grid.values.length) throw Error('The area zones do not match the drainage grid.')
  const { directions, diagnostics } = conditionDrainageSurface(grid, settings.depressionPolicy)
  const next = downstreamCells(directions, grid)
  const accumulation = flowAccumulation(directions, grid, next)
  const streams = extractStreams(accumulation, directions, grid, toLonLat, {
    thresholdM2: settings.streamThresholdHa * 10_000,
    idPrefix: 'ground-stream',
    next,
  })
  const watersheds =
    settings.watershedMinAreaHa === undefined
      ? undefined
      : delineateWatersheds(grid, directions, toLonLat, {
          minAreaHa: settings.watershedMinAreaHa,
          surface: 'existing',
        })
  return { grid, zone, directions, accumulation, streams, watersheds, conditioning: diagnostics }
}

export interface AreaOutletResult {
  requested: [number, number]
  snapped: [number, number]
  snappedDistanceM: number
  /** Row-major number of the outlet in the full grid. */
  outletCell: number
  snapPolicy: SnapPolicy
  areaHa: number
  /** The share of the catchment inside the analysis area and in the margin, ha. */
  inAreaHa: number
  inMarginHa: number
  cells: number
  /** The catchment reaches the edge of what was sampled: its area may continue past it. */
  touchesBoundary: boolean
  /** The catchment reaches a cell without ground inside the area or margin. */
  touchesMissingGround: boolean
  catchment: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, CatchmentProperties>
}

/**
 * The catchment above an outlet, snapped within `snapRadiusM` on the routed grid. A cell next to
 * the catchment that is off the sampled tiles or outside the area and margin is the boundary; one
 * inside them without ground (or in a sampled tile with none) is missing ground.
 */
export function areaOutlet(
  routing: Pick<AreaRouting, 'grid' | 'zone' | 'directions' | 'accumulation'>,
  requested: [number, number],
  { snapRadiusM, snapPolicy }: Pick<GroundDrainageSettings, 'snapRadiusM' | 'snapPolicy'>,
  toLonLat: ToLonLat,
): AreaOutletResult {
  const { grid, zone, directions } = routing
  const snapped = snapPourPoint(grid, directions, routing.accumulation, requested, snapRadiusM, {
    policy: snapPolicy,
    elevations: grid.values,
  })
  const mask = upstreamMask(grid, directions, snapped.cell)
  const catchment = catchmentPolygon(grid, directions, mask, snapped.cell, toLonLat, {
    id: 'ground-catchment',
    surface: 'existing',
  })
  let inArea = 0,
    inMargin = 0,
    touchesBoundary = false,
    touchesMissingGround = false
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    if (zone[i] === ZONE_AREA) inArea++
    else inMargin++
    if (touchesBoundary && touchesMissingGround) continue
    const [r, c] = cellRowCol(grid, i)
    for (let rr = r - 1; rr <= r + 1; rr++)
      for (let cc = c - 1; cc <= c + 1; cc++) {
        if (rr === r && cc === c) continue
        const j = gridCellIndex(grid, rr, cc)
        if (j < 0) {
          if (absentCellKind(grid, rr, cc) === 'edge') touchesBoundary = true
          else touchesMissingGround = true
        } else if (directions[j] === MISSING) {
          if (zone[j] === ZONE_OUTSIDE) touchesBoundary = true
          else touchesMissingGround = true
        }
      }
  }
  const cellHa = grid.cellM ** 2 / 10_000
  return {
    requested,
    snapped: cellCentre(grid, snapped.cell),
    snappedDistanceM: snapped.distanceM,
    outletCell: gridCellNumber(grid, snapped.cell),
    snapPolicy: snapped.snapPolicy,
    areaHa: (inArea + inMargin) * cellHa,
    inAreaHa: inArea * cellHa,
    inMarginHa: inMargin * cellHa,
    cells: inArea + inMargin,
    touchesBoundary,
    touchesMissingGround,
    catchment,
  }
}

/** Every coordinate of a geometry through `map`, for results routed in projected metres. */
export function mapGeometry<G extends GeoJSON.Geometry>(geometry: G, map: (xy: [number, number]) => Coordinate): G {
  const walk = (value: unknown): unknown =>
    Array.isArray(value) && typeof value[0] === 'number'
      ? map([value[0], value[1] as number])
      : Array.isArray(value)
        ? value.map(walk)
        : value
  if (geometry.type === 'GeometryCollection')
    return { ...geometry, geometries: geometry.geometries.map((g) => mapGeometry(g, map)) }
  return { ...geometry, coordinates: walk((geometry as GeoJSON.Point).coordinates) } as G
}

/** Roles the plan draws (`PlanView`'s `groundDrainage` prop). */
export type GroundDrainageRole =
  | 'ground-area'
  | 'ground-stream'
  | 'ground-watershed'
  | 'ground-catchment'
  | 'ground-outlet-requested'
  | 'ground-outlet'
  | 'ground-outlet-snap'

/**
 * The plan's features, lon/lat: the area outline always, the routed results only when given
 * (the page passes them only while they are current).
 */
export function groundDrainagePlan(
  area: GroundDrainageArea | undefined,
  routed?: {
    streams: StreamCollection
    watersheds?: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, CatchmentProperties>
    outlet?: { requested: Coordinate; snapped: Coordinate; result: AreaOutletResult } | null
  },
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  if (area)
    features.push({ type: 'Feature', geometry: area.geometry, properties: { role: 'ground-area', name: area.name } })
  if (routed) {
    for (const f of routed.watersheds?.features ?? [])
      features.push({ ...f, properties: { ...f.properties, role: 'ground-watershed' } })
    if (routed.outlet)
      features.push({
        ...routed.outlet.result.catchment,
        properties: { ...routed.outlet.result.catchment.properties, role: 'ground-catchment' },
      })
    for (const f of routed.streams.features)
      features.push({ ...f, properties: { ...f.properties, role: 'ground-stream' } })
    if (routed.outlet) {
      const { requested, snapped, result } = routed.outlet
      if (result.snappedDistanceM > 0)
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [requested, snapped] },
          properties: { role: 'ground-outlet-snap', snappedDistanceM: result.snappedDistanceM },
        })
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: requested },
        properties: { role: 'ground-outlet-requested' },
      })
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: snapped },
        properties: { role: 'ground-outlet', areaHa: result.areaHa },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}
