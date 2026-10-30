/**
 * Part 3 of the procedure: percent slope from a DEM, reclassified into three
 * categories and turned into polygons that can be intersected with volume
 * pieces — the Slope → Reclassify → Raster to Polygon chain, done on a BC
 * Albers grid so the class cells are exact squares in the same CRS as the
 * pieces. No DOM or network access.
 */
import { normalise, rectangle } from './geometry'
import type { BBox, MultiPolygonCoords, SlopeClass } from './types'

/** Elevation in metres at a BC Albers position, or NaN where the DEM has no data. */
export type AlbersElevation = (x: number, y: number) => number

/**
 * The SOP's documented boundary convention: `0 ≤ s < low` is class 1,
 * `low ≤ s ≤ high` class 2, `s > high` class 3. Percent rise, not degrees.
 */
export function classifySlope(percent: number, [low, high]: readonly [number, number]): SlopeClass {
  if (percent < low) return 1
  if (percent <= high) return 2
  return 3
}

export function slopeClassLabel(slopeClass: SlopeClass, [low, high]: readonly [number, number]): string {
  if (slopeClass === 1) return `<${low}%`
  if (slopeClass === 2) return `${low}–${high}%`
  return `>${high}%`
}

export type SlopeGrid = {
  minX: number
  minY: number
  cell: number
  cols: number
  rows: number
  /** Row 0 is the southern edge. */
  percent: Float32Array
  /** 0 where any of the 3×3 neighbourhood had no elevation. */
  classes: Uint8Array
}

/**
 * Horn's 3×3 slope over a grid snapped to multiples of `cell`, so neighbouring
 * blocks share cell edges and their class polygons line up.
 */
export function slopeGrid(
  bbox: BBox,
  cell: number,
  elevationAt: AlbersElevation,
  breaks: readonly [number, number],
): SlopeGrid {
  const minX = Math.floor(bbox[0] / cell) * cell
  const minY = Math.floor(bbox[1] / cell) * cell
  const cols = Math.max(1, Math.ceil((bbox[2] - minX) / cell))
  const rows = Math.max(1, Math.ceil((bbox[3] - minY) / cell))
  const nodeCols = cols + 2
  const nodes = new Float64Array(nodeCols * (rows + 2))
  for (let row = -1; row <= rows; row += 1) {
    const y = minY + (row + 0.5) * cell
    for (let col = -1; col <= cols; col += 1) {
      nodes[(row + 1) * nodeCols + col + 1] = elevationAt(minX + (col + 0.5) * cell, y)
    }
  }
  const percent = new Float32Array(cols * rows)
  const classes = new Uint8Array(cols * rows)
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const at = (dc: number, dr: number) => nodes[(row + 1 + dr) * nodeCols + col + 1 + dc]
      // a b c on the north row, g h i on the south; rows run south to north.
      const a = at(-1, 1),
        b = at(0, 1),
        c = at(1, 1)
      const d = at(-1, 0),
        f = at(1, 0)
      const g = at(-1, -1),
        h = at(0, -1),
        i = at(1, -1)
      const index = row * cols + col
      if (![a, b, c, d, f, g, h, i].every(Number.isFinite)) {
        percent[index] = NaN
        continue
      }
      const dzdx = (c + 2 * f + i - (a + 2 * d + g)) / (8 * cell)
      const dzdy = (a + 2 * b + c - (g + 2 * h + i)) / (8 * cell)
      const value = 100 * Math.hypot(dzdx, dzdy)
      percent[index] = value
      classes[index] = classifySlope(value, breaks)
    }
  }
  return { minX, minY, cell, cols, rows, percent, classes }
}

/**
 * One multipolygon per class. Runs of equal class along a row become
 * rectangles, identical runs in consecutive rows merge vertically, and each
 * class's rectangles are dissolved — the SOP's optional Dissolve on
 * Slope_Class, which keeps the three classes apart.
 */
export function slopeClassPolygons(grid: SlopeGrid): Record<SlopeClass, MultiPolygonCoords> {
  const rectangles: Record<SlopeClass, MultiPolygonCoords> = { 1: [], 2: [], 3: [] }
  let open = new Map<string, { slopeClass: SlopeClass; start: number; end: number; fromRow: number }>()
  const close = (run: { slopeClass: SlopeClass; start: number; end: number; fromRow: number }, toRow: number) => {
    rectangles[run.slopeClass].push(
      rectangle(
        grid.minX + run.start * grid.cell,
        grid.minY + run.fromRow * grid.cell,
        grid.minX + run.end * grid.cell,
        grid.minY + toRow * grid.cell,
      ),
    )
  }
  for (let row = 0; row <= grid.rows; row += 1) {
    const next = new Map<string, { slopeClass: SlopeClass; start: number; end: number; fromRow: number }>()
    if (row < grid.rows) {
      let col = 0
      while (col < grid.cols) {
        const value = grid.classes[row * grid.cols + col]
        let end = col + 1
        while (end < grid.cols && grid.classes[row * grid.cols + end] === value) end += 1
        if (value) {
          const key = `${value}:${col}:${end}`
          const continuing = open.get(key)
          next.set(key, continuing ?? { slopeClass: value as SlopeClass, start: col, end, fromRow: row })
          open.delete(key)
        }
        col = end
      }
    }
    for (const run of open.values()) close(run, row)
    open = next
  }
  return {
    1: normalise(rectangles[1]),
    2: normalise(rectangles[2]),
    3: normalise(rectangles[3]),
  }
}
