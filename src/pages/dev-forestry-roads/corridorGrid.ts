/**
 * The ground a drainage run routes: the cells of the corridor's grid that lie within the upslope
 * buffer of the road, held as square tiles (see `GridTiles` in `surfaceGrid.ts`) instead of the
 * whole box around the road. A long, winding road's box is mostly ground the buffer never asks
 * for (LongRoad: 9.2 × 17.5 km around a 27.7 km road), so a cell budget spent on the box coarsened
 * the cells; spent on the tiles it keeps the terrain's own resolution.
 *
 * The grid is the one `sampleSurfaceGrid` lays over `corridorBounds` (same origin, cell centres and
 * row-major order), so wherever the box holds no ground outside the tiles a run over the tiles is
 * the dense run, cell for cell. A tile is sampled when any of it may lie within the buffer of the
 * road's reach (a capsule around each pair of stations); a sampled tile is kept when it holds
 * ground or the road can reach it, so a gap in the ground stays a gap and the prism and culvert
 * channels always have cells to burn into.
 *
 * Pure: the terrain is an ElevationSource and the projection is passed in. No DOM or network access.
 */
import { offsetCoordinate } from './engine'
import {
  corridorBounds,
  TILE_NO_GROUND,
  TILE_NOT_SAMPLED,
  type SurfaceGrid,
  type ToGrid,
  type ToLonLat,
} from './surfaceGrid'
import type { RoadAnalysis, TerrainSource } from './types'

/** Tile side, as a power of two: 32 cells. */
export const CORRIDOR_TILE_SHIFT = 5
/** The cell grows by this factor until the held cells fit the budget, as `sampleSurfaceGrid` does. */
export const CORRIDOR_CELL_GROWTH = 1.25

export interface CorridorGrid {
  grid: SurfaceGrid & { tiles: NonNullable<SurfaceGrid['tiles']> }
  /** Cells of the box `corridorBounds` gives, at this cell: what a dense run would hold. */
  boxCells: number
  /** Cells inside the grid of every tile sampled. */
  sampledCells: number
  /** Cells inside the grid of every tile held (routed). */
  heldCells: number
  /** Cells stored, padding of tiles past the grid's edge included: what the budget limits. */
  storedCells: number
  /** Held cells with ground. */
  groundCells: number
}

interface Capsule {
  ax: number
  ay: number
  bx: number
  by: number
  /** The road's own reach, m: catch points and culvert channels. */
  road: number
}

/** The farthest catch point (or sampled section offset) either side of a station, m. */
function stationReach(s: RoadAnalysis['stations'][number]): number {
  const reach = Math.max(1, ...s.section.map((p) => Math.abs(p.offset)))
  return Math.max(Math.abs(s.leftDaylightM ?? reach), Math.abs(s.rightDaylightM ?? reach))
}

const segmentDistance = (px: number, py: number, c: Capsule) => {
  const dx = c.bx - c.ax,
    dy = c.by - c.ay,
    len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - c.ax) * dx + (py - c.ay) * dy) / len2)) : 0
  return Math.hypot(px - (c.ax + dx * t), py - (c.ay + dy * t))
}

/**
 * Sample the corridor's tiles, starting at `cellM` and growing the cell ×1.25 until the held
 * tiles fit in `maxCells` stored cells. `extraRoadReachM` widens the road's own reach (culvert
 * barrels and aprons beyond the catch points), whose tiles are always held.
 */
export function sampleCorridorGrid(
  terrain: TerrainSource,
  analysis: RoadAnalysis,
  toGrid: ToGrid,
  toLonLat: ToLonLat,
  {
    bufferM,
    cellM = 1,
    maxCells = 4_194_304,
    extraRoadReachM = 0,
  }: { bufferM: number; cellM?: number; maxCells?: number; extraRoadReachM?: number },
): CorridorGrid {
  const [minX, minY, maxX, maxY] = corridorBounds(analysis, toGrid, bufferM)
  const spanX = maxX - minX,
    spanY = maxY - minY
  if (!(spanX > 0 && spanY > 0)) throw Error('The sampling extent has no area.')
  const capsules: Capsule[] = []
  let previous: { x: number; y: number; reach: number } | null = null
  for (const s of analysis.stations) {
    const [x, y] = toGrid(s.coordinate)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    // The reach is measured along the projected perpendicular, as `corridorBounds` measures it.
    const reach = stationReach(s)
    const right = toGrid(offsetCoordinate(s.coordinate, s.bearing + 90, 1))
    const scale = Math.hypot(right[0] - x, right[1] - y) || 1
    const here = { x, y, reach: reach * scale + extraRoadReachM }
    const from = previous ?? here
    capsules.push({ ax: from.x, ay: from.y, bx: x, by: y, road: Math.max(from.reach, here.reach) })
    previous = here
  }
  let shift = CORRIDOR_TILE_SHIFT
  while (shift > 0 && 4 << (2 * shift) > maxCells) shift--
  const side = 1 << shift,
    tileCells = side * side
  let cell = Math.max(0.1, cellM)
  for (;;) {
    const width = Math.floor(spanX / cell) + 1,
      height = Math.floor(spanY / cell) + 1
    const origin: [number, number] = [minX + cell / 2, maxY - cell / 2]
    const across = Math.ceil(width / side),
      down = Math.ceil(height / side)
    // 0 not sampled, 1 within the buffer, 2 within the road's own reach.
    const wanted = new Uint8Array(across * down)
    const tileSpan = side * cell,
      halfDiagonal = (tileSpan * Math.SQRT2) / 2,
      // Cell centres lie half a cell inside the box; the margin keeps a tile whose edge cells are in reach.
      margin = halfDiagonal + cell
    for (const c of capsules) {
      const outer = c.road + bufferM + margin
      const tx0 = Math.max(0, Math.floor((Math.min(c.ax, c.bx) - outer - origin[0]) / tileSpan)),
        tx1 = Math.min(across - 1, Math.floor((Math.max(c.ax, c.bx) + outer - origin[0]) / tileSpan)),
        ty0 = Math.max(0, Math.floor((origin[1] - Math.max(c.ay, c.by) - outer) / tileSpan)),
        ty1 = Math.min(down - 1, Math.floor((origin[1] - Math.min(c.ay, c.by) + outer) / tileSpan))
      for (let ty = ty0; ty <= ty1; ty++)
        for (let tx = tx0; tx <= tx1; tx++) {
          const t = ty * across + tx
          if (wanted[t] === 2) continue
          const cx = origin[0] + (tx * side + (side - 1) / 2) * cell,
            cy = origin[1] - (ty * side + (side - 1) / 2) * cell
          const d = segmentDistance(cx, cy, c)
          if (d <= c.road + margin) wanted[t] = 2
          else if (d <= outer) wanted[t] = 1
        }
    }
    let roadTiles = 0
    for (const v of wanted) if (v === 2) roadTiles++
    if (roadTiles * tileCells > maxCells) {
      cell *= CORRIDOR_CELL_GROWTH
      continue
    }
    const position = new Int32Array(across * down).fill(TILE_NOT_SAMPLED),
      held = new Int32Array(down),
      rowBase = new Int32Array(down + 1),
      columnStart = new Int32Array(down + 1)
    const columns: number[] = [],
      blocks: Float64Array[][] = []
    const scratch = new Float64Array(tileCells)
    const xy: [number, number] = [0, 0]
    let stored = 0,
      sampledCells = 0,
      heldCells = 0,
      groundCells = 0,
      fits = true
    for (let ty = 0; ty < down && fits; ty++) {
      const rowTiles: Float64Array[] = []
      columnStart[ty] = columns.length
      const rows = Math.min(side, height - ty * side)
      for (let tx = 0; tx < across; tx++) {
        const t = ty * across + tx
        if (!wanted[t]) continue
        const cols = Math.min(side, width - tx * side)
        scratch.fill(NaN)
        let ground = 0
        for (let rr = 0; rr < rows; rr++) {
          const row = ty * side + rr
          xy[1] = origin[1] - row * cell
          for (let cc = 0; cc < cols; cc++) {
            xy[0] = origin[0] + (tx * side + cc) * cell
            const [lon, lat] = toLonLat(xy)
            const z = terrain.elevationAt(lon, lat)
            if (Number.isFinite(z)) {
              scratch[rr * side + cc] = z
              ground++
            }
          }
        }
        sampledCells += rows * cols
        if (!ground && wanted[t] !== 2) {
          position[t] = TILE_NO_GROUND
          continue
        }
        stored += tileCells
        if (stored > maxCells) {
          fits = false
          break
        }
        position[t] = rowTiles.length
        rowTiles.push(Float64Array.from(scratch))
        columns.push(tx)
        heldCells += rows * cols
        groundCells += ground
      }
      held[ty] = rowTiles.length
      blocks.push(rowTiles)
    }
    if (!fits) {
      cell *= CORRIDOR_CELL_GROWTH
      continue
    }
    columnStart[down] = columns.length
    const values = new Float64Array(stored),
      rowOfBlock = new Int32Array(stored / tileCells)
    let block = 0
    for (let ty = 0; ty < down; ty++) {
      rowBase[ty] = block * tileCells
      const tiles = blocks[ty],
        stride = tiles.length * side
      tiles.forEach((data, pos) => {
        for (let rr = 0; rr < side; rr++)
          values.set(data.subarray(rr * side, rr * side + side), rowBase[ty] + rr * stride + pos * side)
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
        values,
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
      boxCells: width * height,
      sampledCells,
      heldCells,
      storedCells: stored,
      groundCells,
    }
  }
}
