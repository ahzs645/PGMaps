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
  /**
   * Row-major, rows running south (y decreasing). NaN = missing. With `tiles`, only the held
   * tiles' cells are stored, still in row-major order of the full grid (see {@link GridTiles}).
   */
  values: Float64Array
  /** Present when only some square tiles of the `width` × `height` grid are held. */
  tiles?: GridTiles
}

/**
 * A sparse layout of a {@link SurfaceGrid}: the grid is cut into square tiles of `side` cells and
 * only the held tiles are stored. Within a row of tiles the held tiles are stored row by row, so
 * cell indices follow the full grid's row-major order: any scan over the stored cells meets them
 * in the order a dense scan would, which keeps heap and queue ties, sums and IDs the same as a
 * dense run. Cells of a held tile past the grid's right or bottom edge are stored as NaN and are
 * never anyone's neighbour. A cell outside every held tile has no index (−1), like a cell off a
 * dense grid.
 */
export interface GridTiles {
  /** Tile side in cells, `1 << shift`. */
  side: number
  shift: number
  /** Tiles across and down the full grid. */
  across: number
  down: number
  /**
   * For each tile, row-major over tiles: its position among the held tiles of its tile row, else
   * {@link TILE_NOT_SAMPLED} (outside the sampled area) or {@link TILE_NO_GROUND} (sampled, no ground).
   */
  position: Int32Array
  /** Held tiles in each tile row. */
  held: Int32Array
  /** First stored cell of each tile row, `down + 1` entries. */
  rowBase: Int32Array
  /** Tile column of each held tile, tile rows in order. */
  columns: Int32Array
  /** First entry of each tile row in `columns`, `down + 1` entries. */
  columnStart: Int32Array
  /** Tile row of each stored block of `side²` cells. */
  rowOfBlock: Int32Array
}
/** A tile outside the area sampled: its cells are beyond the grid's edge, as off a dense grid. */
export const TILE_NOT_SAMPLED = -1
/** A tile sampled and dropped because none of its cells had ground and the road does not reach it. */
export const TILE_NO_GROUND = -2

/** D8 neighbour order: E, SE, S, SW, W, NW, N, NE (rows run south). */
export const D8_ROW = [0, 1, 1, 1, 0, -1, -1, -1]
export const D8_COL = [1, 1, 0, -1, -1, -1, 0, 1]

/** Index of the cell at (row, col), or −1 off the grid or in a tile that is not held. */
export function gridCellIndex(grid: Pick<SurfaceGrid, 'width' | 'height' | 'tiles'>, row: number, col: number): number {
  if (!(row >= 0 && col >= 0 && row < grid.height && col < grid.width)) return -1
  const t = grid.tiles
  if (!t) return row * grid.width + col
  const tileRow = row >> t.shift,
    pos = t.position[tileRow * t.across + (col >> t.shift)]
  if (pos < 0) return -1
  const mask = t.side - 1
  return t.rowBase[tileRow] + ((row & mask) * t.held[tileRow] + pos) * t.side + (col & mask)
}

/** Row and column of cell `i` in the full grid (past the edge for a held tile's padding). */
export function cellRowCol(grid: Pick<SurfaceGrid, 'width' | 'tiles'>, i: number): [number, number] {
  const t = grid.tiles
  if (!t) {
    const row = Math.floor(i / grid.width)
    return [row, i - row * grid.width]
  }
  const tileRow = t.rowOfBlock[i >> (2 * t.shift)],
    local = i - t.rowBase[tileRow],
    stride = t.held[tileRow] * t.side,
    rr = Math.floor(local / stride),
    rem = local - rr * stride
  return [
    (tileRow << t.shift) + rr,
    (t.columns[t.columnStart[tileRow] + (rem >> t.shift)] << t.shift) + (rem & (t.side - 1)),
  ]
}

/**
 * Fill `out` with the eight D8 neighbours of cell `i` (−1 where there is none: off the grid,
 * in a tile not held, or `i` itself is a held tile's padding). Returns false for padding.
 */
export function neighbourCells(
  grid: Pick<SurfaceGrid, 'width' | 'height' | 'tiles'>,
  i: number,
  out: Int32Array,
): boolean {
  if (grid.tiles) return tiledNeighbourCells(grid, grid.tiles, i, out)
  const w = grid.width,
    h = grid.height,
    row = (i / w) | 0,
    col = i - row * w
  if (row > 0 && col > 0 && row < h - 1 && col < w - 1) {
    out[0] = i + 1
    out[1] = i + w + 1
    out[2] = i + w
    out[3] = i + w - 1
    out[4] = i - 1
    out[5] = i - w - 1
    out[6] = i - w
    out[7] = i - w + 1
    return true
  }
  for (let k = 0; k < 8; k++) {
    const r = row + D8_ROW[k],
      c = col + D8_COL[k]
    out[k] = r >= 0 && c >= 0 && r < h && c < w ? r * w + c : -1
  }
  return true
}

function tiledNeighbourCells(
  grid: Pick<SurfaceGrid, 'width' | 'height' | 'tiles'>,
  t: GridTiles,
  i: number,
  out: Int32Array,
): boolean {
  const w = grid.width,
    h = grid.height,
    side = t.side,
    mask = side - 1,
    tileRow = t.rowOfBlock[i >> (2 * t.shift)],
    local = i - t.rowBase[tileRow],
    stride = t.held[tileRow] * side,
    rr = (local / stride) | 0,
    rem = local - rr * stride,
    cc = rem & mask,
    row = (tileRow << t.shift) + rr,
    col = (t.columns[t.columnStart[tileRow] + (rem >> t.shift)] << t.shift) + cc
  if (row >= h || col >= w) {
    out.fill(-1)
    return false
  }
  if (rr > 0 && cc > 0 && rr < side - 1 && cc < side - 1 && row < h - 1 && col < w - 1) {
    out[0] = i + 1
    out[1] = i + stride + 1
    out[2] = i + stride
    out[3] = i + stride - 1
    out[4] = i - 1
    out[5] = i - stride - 1
    out[6] = i - stride
    out[7] = i - stride + 1
    return true
  }
  for (let k = 0; k < 8; k++) {
    const dr = D8_ROW[k],
      dc = D8_COL[k],
      r = row + dr,
      c = col + dc
    if (r < 0 || c < 0 || r >= h || c >= w) out[k] = -1
    else if (rr + dr >= 0 && rr + dr < side && cc + dc >= 0 && cc + dc < side) out[k] = i + dr * stride + dc
    else out[k] = gridCellIndex(grid, r, c)
  }
  return true
}

/** Why a cell next to the stored cells has no index: 'edge' off the sampled area, 'nodata' in a dropped tile. */
export function absentCellKind(grid: Pick<SurfaceGrid, 'width' | 'height' | 'tiles'>, row: number, col: number) {
  if (!(row >= 0 && col >= 0 && row < grid.height && col < grid.width)) return 'edge'
  const t = grid.tiles
  if (!t) return 'nodata'
  return t.position[(row >> t.shift) * t.across + (col >> t.shift)] === TILE_NO_GROUND ? 'nodata' : 'edge'
}
export type GridBounds = [minX: number, minY: number, maxX: number, maxY: number]
export type ToGrid = (lonLat: Coordinate) => [number, number]
export type ToLonLat = (xy: [number, number]) => Coordinate

export const cellX = (grid: SurfaceGrid, col: number) => grid.origin[0] + col * grid.cellM
export const cellY = (grid: SurfaceGrid, row: number) => grid.origin[1] - row * grid.cellM
/** Projected centre of cell `index`. */
export function cellCentre(
  grid: Pick<SurfaceGrid, 'origin' | 'cellM' | 'width' | 'tiles'>,
  index: number,
): [number, number] {
  const [row, col] = cellRowCol(grid, index)
  return [grid.origin[0] + col * grid.cellM, grid.origin[1] - row * grid.cellM]
}
/** Index of the cell containing (x, y), or -1 outside the grid or its held tiles. */
export function cellIndexAt(
  grid: Pick<SurfaceGrid, 'origin' | 'cellM' | 'width' | 'height' | 'tiles'>,
  x: number,
  y: number,
): number {
  const col = Math.round((x - grid.origin[0]) / grid.cellM),
    row = Math.round((grid.origin[1] - y) / grid.cellM)
  return gridCellIndex(grid, row, col)
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
  const at = grid.tiles
    ? (r: number, c: number) => {
        const i = gridCellIndex(grid, r, c)
        return i < 0 ? NaN : v[i]
      }
    : (r: number, c: number) => v[r * w + c]
  const top = at(r0, c0) * (1 - tx) + at(r0, c1) * tx,
    bottom = at(r1, c0) * (1 - tx) + at(r1, c1) * tx
  // NaN propagates through the products, so a missing neighbour always yields NaN.
  return top * (1 - ty) + bottom * ty
}

export function cloneSurfaceGrid(grid: SurfaceGrid, values = new Float64Array(grid.values)): SurfaceGrid {
  return {
    origin: [grid.origin[0], grid.origin[1]],
    cellM: grid.cellM,
    width: grid.width,
    height: grid.height,
    values,
    ...(grid.tiles ? { tiles: grid.tiles } : {}),
  }
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
