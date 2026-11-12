/**
 * A regular lng/lat grid with metric cell size, for plan-view analysis of a landform (sub-landform
 * splits, ridges and draws). Cells are addressed row-major from the south-west. No DOM, no network.
 * Ported from the VIA figure-style prototype (November 2026).
 */
import { metersPerDegree } from './visibility'

export interface PlanGrid {
  nx: number
  ny: number
  west: number
  south: number
  dLng: number
  dLat: number
  cellMeters: number
  centre(i: number, j: number): [number, number]
  cellOf(lng: number, lat: number): [number, number] | null
}

export function planGrid(
  bounds: readonly [number, number, number, number],
  cellMeters: number,
  maxCells = 2_000_000,
): PlanGrid {
  const midLat = (bounds[1] + bounds[3]) / 2
  const m = metersPerDegree(midLat)
  let cell = cellMeters
  let nx = 0,
    ny = 0
  for (;;) {
    nx = Math.max(2, Math.ceil(((bounds[2] - bounds[0]) * m.lng) / cell))
    ny = Math.max(2, Math.ceil(((bounds[3] - bounds[1]) * m.lat) / cell))
    if (nx * ny <= maxCells) break
    cell *= 1.25
  }
  const dLng = cell / m.lng,
    dLat = cell / m.lat
  return {
    nx,
    ny,
    west: bounds[0],
    south: bounds[1],
    dLng,
    dLat,
    cellMeters: cell,
    centre: (i, j) => [bounds[0] + (i + 0.5) * dLng, bounds[1] + (j + 0.5) * dLat],
    cellOf: (lng, lat) => {
      const i = Math.floor((lng - bounds[0]) / dLng),
        j = Math.floor((lat - bounds[1]) / dLat)
      return i < 0 || j < 0 || i >= nx || j >= ny ? null : [i, j]
    },
  }
}

/** Cells a line crosses, 8-connected (Bresenham over cell indices), so a 4-connected flood cannot leak across it. */
export function rasteriseLine(
  grid: PlanGrid,
  line: readonly (readonly [number, number])[],
  visit: (i: number, j: number) => void,
) {
  for (let s = 1; s < line.length; s++) {
    const a = grid.cellOf(line[s - 1][0], line[s - 1][1]) ?? clampCell(grid, line[s - 1])
    const b = grid.cellOf(line[s][0], line[s][1]) ?? clampCell(grid, line[s])
    let [x0, y0] = a
    const [x1, y1] = b
    const dx = Math.abs(x1 - x0),
      dy = -Math.abs(y1 - y0),
      sx = x0 < x1 ? 1 : -1,
      sy = y0 < y1 ? 1 : -1
    let err = dx + dy
    for (let guard = 0; guard < 100000; guard++) {
      if (x0 >= 0 && y0 >= 0 && x0 < grid.nx && y0 < grid.ny) visit(x0, y0)
      if (x0 === x1 && y0 === y1) break
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x0 += sx
      }
      if (e2 <= dx) {
        err += dx
        y0 += sy
      }
    }
  }
}
function clampCell(grid: PlanGrid, p: readonly [number, number]): [number, number] {
  return [Math.floor((p[0] - grid.west) / grid.dLng), Math.floor((p[1] - grid.south) / grid.dLat)]
}

/** A Lookup over a labelled grid: label − 1, or −1 for 0. */
export function gridLookup(grid: PlanGrid, labels: Uint8Array | Int32Array) {
  return {
    indexAt(lng: number, lat: number) {
      const c = grid.cellOf(lng, lat)
      return c ? labels[c[1] * grid.nx + c[0]] - 1 : -1
    },
  }
}
