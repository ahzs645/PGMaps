/**
 * A regular elevation grid in projected metres, the common raster for the design surface and the
 * hydrology run. Rows run south from the top-left cell centre, like a GeoTIFF with negative y pixel
 * size. Missing cells are NaN and stay missing: sampling never invents ground the source lacks.
 * Pure: projection is passed in as `toGrid`/`toLonLat`, no DOM or network access.
 */
import { offsetCoordinate } from './engine'
import type { Coordinate, RoadAnalysis, TerrainSource } from './types'

export interface SurfaceGrid {
  /** Centre of the top-left cell, projected metres. */
  origin: [number, number]
  cellM: number
  width: number
  height: number
  /** Row-major, rows running south (y decreasing). NaN = missing. */
  values: Float64Array
}
export type GridBounds = [minX: number, minY: number, maxX: number, maxY: number]
export type ToGrid = (lonLat: Coordinate) => [number, number]
export type ToLonLat = (xy: [number, number]) => Coordinate

export const cellX = (grid: SurfaceGrid, col: number) => grid.origin[0] + col * grid.cellM
export const cellY = (grid: SurfaceGrid, row: number) => grid.origin[1] - row * grid.cellM
/** Projected centre of cell `index`. */
export function cellCentre(grid: SurfaceGrid, index: number): [number, number] {
  const row = Math.floor(index / grid.width)
  return [cellX(grid, index - row * grid.width), cellY(grid, row)]
}
/** Index of the cell containing (x, y), or -1 outside the grid. */
export function cellIndexAt(grid: SurfaceGrid, x: number, y: number): number {
  const col = Math.round((x - grid.origin[0]) / grid.cellM),
    row = Math.round((grid.origin[1] - y) / grid.cellM)
  if (!(col >= 0 && row >= 0 && col < grid.width && row < grid.height)) return -1
  return row * grid.width + col
}

/** Bilinear between cell centres; NaN when outside or when any of the four neighbours is missing. */
export function sampleBilinear(grid: SurfaceGrid, x: number, y: number): number {
  const fx = (x - grid.origin[0]) / grid.cellM,
    fy = (grid.origin[1] - y) / grid.cellM
  if (!(fx >= 0 && fy >= 0 && fx <= grid.width - 1 && fy <= grid.height - 1)) return NaN
  const c0 = Math.min(Math.max(0, grid.width - 2), Math.floor(fx)),
    r0 = Math.min(Math.max(0, grid.height - 2), Math.floor(fy))
  const c1 = Math.min(grid.width - 1, c0 + 1),
    r1 = Math.min(grid.height - 1, r0 + 1)
  const tx = fx - c0,
    ty = fy - r0,
    v = grid.values,
    w = grid.width
  const top = v[r0 * w + c0] * (1 - tx) + v[r0 * w + c1] * tx,
    bottom = v[r1 * w + c0] * (1 - tx) + v[r1 * w + c1] * tx
  // NaN propagates through the products, so a missing neighbour always yields NaN.
  return top * (1 - ty) + bottom * ty
}

export function cloneSurfaceGrid(grid: SurfaceGrid, values = new Float64Array(grid.values)): SurfaceGrid {
  return { origin: [grid.origin[0], grid.origin[1]], cellM: grid.cellM, width: grid.width, height: grid.height, values }
}

/**
 * Sample `terrain` at every cell centre inside `bounds`, starting at `cellM` and growing the cell
 * ×1.25 until the grid fits in `maxCells`. Each cell costs one `toLonLat` and one `elevationAt`.
 */
export function sampleSurfaceGrid(
  terrain: TerrainSource,
  bounds: GridBounds,
  toLonLat: ToLonLat,
  { cellM = 1, maxCells = 4_194_304 }: { cellM?: number; maxCells?: number } = {},
): SurfaceGrid {
  const [minX, minY, maxX, maxY] = bounds
  const spanX = maxX - minX,
    spanY = maxY - minY
  if (!(spanX > 0 && spanY > 0)) throw Error('The sampling extent has no area.')
  let cell = Math.max(0.1, cellM)
  while ((Math.floor(spanX / cell) + 1) * (Math.floor(spanY / cell) + 1) > maxCells) cell *= 1.25
  const width = Math.floor(spanX / cell) + 1,
    height = Math.floor(spanY / cell) + 1
  const values = new Float64Array(width * height)
  const origin: [number, number] = [minX + cell / 2, maxY - cell / 2]
  const xy: [number, number] = [0, 0]
  for (let row = 0; row < height; row++) {
    xy[1] = origin[1] - row * cell
    for (let col = 0; col < width; col++) {
      xy[0] = origin[0] + col * cell
      const [lon, lat] = toLonLat(xy)
      const z = terrain.elevationAt(lon, lat)
      values[row * width + col] = Number.isFinite(z) ? z : NaN
    }
  }
  return { origin, cellM: cell, width, height, values }
}

/**
 * Projected bbox of the centreline and both daylight (catch) points of every station, plus
 * `bufferM`. An unresolved daylight falls back to the outermost sampled section offset.
 */
export function corridorBounds(analysis: RoadAnalysis, toGrid: ToGrid, bufferM: number): GridBounds {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  const add = ([x, y]: [number, number]) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  for (const c of analysis.centerline) add(toGrid(c))
  for (const s of analysis.stations) {
    const [x0, y0] = toGrid(s.coordinate)
    add([x0, y0])
    const reach = Math.max(1, ...s.section.map((p) => Math.abs(p.offset)))
    const right = toGrid(offsetCoordinate(s.coordinate, s.bearing + 90, reach))
    const ux = (right[0] - x0) / reach,
      uy = (right[1] - y0) / reach
    const left = Math.abs(s.leftDaylightM ?? reach),
      rightD = Math.abs(s.rightDaylightM ?? reach)
    add([x0 - ux * left, y0 - uy * left])
    add([x0 + ux * rightD, y0 + uy * rightD])
  }
  if (!Number.isFinite(minX)) throw Error('The road has no stations to bound.')
  return [minX - bufferM, minY - bufferM, maxX + bufferM, maxY + bufferM]
}
