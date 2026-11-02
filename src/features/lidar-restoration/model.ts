/** SCRIP-inspired restoration metrics. Pure, bounded grids; every accepted return is counted. */
import type { PemStructureRasters } from './pemStructure'
export const MAX_GRID_CELLS = 4_194_304
export const MAX_INPUT_BYTES = 768 * 1024 * 1024
export const MAX_SOURCE_POINTS = 150_000_000
export const SCRIP_SOURCE =
  'https://github.com/bcgov/SCRIP-LiDAR-Road-Restoration/tree/7a6d042221d4953de5f97311171297dcf9d1b107'

export interface Grid {
  /** Outer west/north corner, projected metres, rows south. */
  west: number
  north: number
  cellM: number
  width: number
  height: number
}
export interface Raster extends Grid {
  values: Float32Array
}
export interface RestorationOptions {
  terrainCellM: number
  densityCellM: number
  meanCellM: number
  structureCellM: number
}
export const DEFAULT_OPTIONS: RestorationOptions = {
  terrainCellM: 1,
  densityCellM: 2,
  meanCellM: 10,
  structureCellM: 5,
}
export interface ReturnPoint {
  x: number
  y: number
  z: number
  classification: number
  first: boolean
  withheld: boolean
}
export const PRODUCTS = {
  terrain: {
    label: 'Ground elevation',
    unit: 'm',
    description: 'Class 2 ground cell mean; up to three short gap passes.',
  },
  slope: { label: 'Slope', unit: '%', description: 'Horn slope on the ground grid; complete 3 × 3 support required.' },
  meanHeight: {
    label: 'Mean first-return height',
    unit: 'm',
    description: 'Mean normalized height of first returns, including low returns.',
  },
  vegetation: {
    label: 'Vegetation return density',
    unit: 'returns/m²',
    description: 'Returns above 0.5 m divided by full cell area.',
  },
  canopy: {
    label: 'Canopy return cover',
    unit: '%',
    description: 'Returns above 0.5 m divided by all normalized returns.',
  },
  understory: {
    label: 'Understory',
    unit: '%',
    description: 'Returns above 0.5 m and at or below 2 m / all normalized returns.',
  },
  midstory: {
    label: 'Midstory',
    unit: '%',
    description: 'Returns above 2 m and at or below 10 m / all normalized returns.',
  },
  overstory: { label: 'Overstory', unit: '%', description: 'Returns above 10 m / all normalized returns.' },
  ground: {
    label: 'Ground return density',
    unit: 'returns/m²',
    description: 'Class 2 returns divided by full cell area; observed zero stays zero.',
  },
  support: {
    label: 'Normalized return support',
    unit: '%',
    description: 'Returns with usable ground / accepted returns in the cell.',
  },
} as const
export type Product = keyof typeof PRODUCTS
export interface RestorationResult {
  epsg: number
  verticalEpsg: number | null
  options: RestorationOptions
  sources: Array<{ name: string; bytes: number; points: number }>
  rasters: Record<Product, Raster> & PemStructureRasters
  counts: { read: number; accepted: number; excluded: number; normalized: number; ground: number; filled: number }
}

export function makeGrid(bounds: [number, number, number, number], cellM: number): Grid {
  if (!Number.isFinite(cellM) || cellM < 0.5 || cellM > 100) throw Error('Cell sizes must be between 0.5 and 100 m.')
  const [x0, y0, x1, y1] = bounds
  if (!bounds.every(Number.isFinite) || x1 <= x0 || y1 <= y0) throw Error('The cloud needs a finite horizontal extent.')
  const west = Math.floor(x0 / cellM) * cellM
  const north = (Math.floor(y1 / cellM) + 1) * cellM
  const width = Math.floor(x1 / cellM) - Math.floor(x0 / cellM) + 1
  const height = Math.floor(y1 / cellM) - Math.floor(y0 / cellM) + 1
  if (width * height > MAX_GRID_CELLS)
    throw Error(`Grid exceeds ${MAX_GRID_CELLS.toLocaleString()} cells. Increase cell size or crop the source in GIS.`)
  return { west, north, cellM, width, height }
}
export function indexAt(g: Grid, x: number, y: number): number {
  const c = Math.floor((x - g.west) / g.cellM),
    r = Math.floor((g.north - y) / g.cellM)
  return c >= 0 && c < g.width && r >= 0 && r < g.height ? r * g.width + c : -1
}
export function accepted(p: ReturnPoint) {
  return (
    !p.withheld &&
    p.classification !== 7 &&
    p.classification !== 18 &&
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    Number.isFinite(p.z)
  )
}

export function groundAccumulator(grid: Grid) {
  const sum = new Float64Array(grid.width * grid.height),
    count = new Uint32Array(sum.length)
  return {
    add(p: ReturnPoint) {
      if (!accepted(p) || p.classification !== 2) return
      const i = indexAt(grid, p.x, p.y)
      if (i >= 0) {
        sum[i] += p.z
        count[i]++
      }
    },
    finish() {
      if (!count.some((n) => n > 0))
        throw Error('No class 2 ground returns. Classify the cloud in GIS before importing it.')
      let values = Float32Array.from(count, (n, i) => (n ? sum[i] / n : NaN)),
        filled = 0
      // Simultaneous passes: a large hole never fills in one traversal.
      for (let pass = 0; pass < 3; pass++) {
        const next = values.slice()
        for (let r = 0; r < grid.height; r++)
          for (let c = 0; c < grid.width; c++) {
            const i = r * grid.width + c
            if (Number.isFinite(values[i])) continue
            let n = 0,
              total = 0
            for (let dr = -1; dr <= 1; dr++)
              for (let dc = -1; dc <= 1; dc++) {
                if ((!dr && !dc) || r + dr < 0 || r + dr >= grid.height || c + dc < 0 || c + dc >= grid.width) continue
                const z = values[(r + dr) * grid.width + c + dc]
                if (Number.isFinite(z)) {
                  total += z
                  n++
                }
              }
            if (n >= 3) {
              next[i] = total / n
              filled++
            }
          }
        values = next
      }
      return { terrain: { ...grid, values }, filled }
    },
  }
}

/** Bilinear centres, clamped only within the edge half-cell; missing weighted support stays missing. */
export function groundAt(g: Raster, x: number, y: number) {
  if (indexAt(g, x, y) < 0) return NaN
  const fx = Math.max(0, Math.min(g.width - 1, (x - g.west) / g.cellM - 0.5))
  const fy = Math.max(0, Math.min(g.height - 1, (g.north - y) / g.cellM - 0.5))
  const c = Math.floor(fx),
    r = Math.floor(fy),
    tx = fx - c,
    ty = fy - r
  let value = 0
  for (let dy = 0; dy <= 1; dy++)
    for (let dx = 0; dx <= 1; dx++) {
      const weight = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty)
      if (!weight) continue
      const z = g.values[Math.min(g.height - 1, r + dy) * g.width + Math.min(g.width - 1, c + dx)]
      if (!Number.isFinite(z)) return NaN
      value += weight * z
    }
  return value
}

export function slopeRaster(g: Raster): Raster {
  const values = new Float32Array(g.values.length).fill(NaN),
    w = g.width,
    z = g.values
  for (let r = 1; r < g.height - 1; r++)
    for (let c = 1; c < w - 1; c++) {
      const i = r * w + c
      if (
        ![z[i - w - 1], z[i - w], z[i - w + 1], z[i - 1], z[i], z[i + 1], z[i + w - 1], z[i + w], z[i + w + 1]].every(
          Number.isFinite,
        )
      )
        continue
      const dx =
        (z[i - w + 1] + 2 * z[i + 1] + z[i + w + 1] - z[i - w - 1] - 2 * z[i - 1] - z[i + w - 1]) / (8 * g.cellM)
      const dy =
        (z[i + w - 1] + 2 * z[i + w] + z[i + w + 1] - z[i - w - 1] - 2 * z[i - w] - z[i - w + 1]) / (8 * g.cellM)
      values[i] = Math.hypot(dx, dy) * 100
    }
  return { ...g, values }
}

export function metricsAccumulator(terrain: Raster, grid: Grid, meanGrid: Grid) {
  const n = grid.width * grid.height,
    m = meanGrid.width * meanGrid.height
  const raw = new Uint32Array(n),
    normalized = new Uint32Array(n),
    ground = new Uint32Array(n)
  const under = new Uint32Array(n),
    mid = new Uint32Array(n),
    over = new Uint32Array(n)
  const first = new Uint32Array(m),
    firstNormalized = new Uint32Array(m),
    heightSum = new Float64Array(m)
  const counts = { read: 0, accepted: 0, excluded: 0, normalized: 0, ground: 0 }
  return {
    counts,
    add(p: ReturnPoint): number {
      counts.read++
      if (!accepted(p)) {
        counts.excluded++
        return NaN
      }
      const i = indexAt(grid, p.x, p.y),
        j = indexAt(meanGrid, p.x, p.y)
      if (i < 0 || j < 0) throw Error('A return lies outside the declared cloud bounds.')
      counts.accepted++
      raw[i]++
      if (p.first) first[j]++
      if (p.classification === 2) {
        ground[i]++
        counts.ground++
      }
      const h = p.z - groundAt(terrain, p.x, p.y)
      if (!Number.isFinite(h)) return NaN
      counts.normalized++
      normalized[i]++
      if (p.first) {
        firstNormalized[j]++
        heightSum[j] += h
      }
      if (h > 10) over[i]++
      else if (h > 2) mid[i]++
      else if (h > 0.5) under[i]++
      return h
    },
    finish(): Record<Exclude<Product, 'terrain' | 'slope'>, Raster> {
      const raster = (fn: (i: number) => number): Raster => ({
        ...grid,
        values: Float32Array.from(raw, (_, i) => fn(i)),
      })
      const percent = (a: Uint32Array) =>
        raster((i) => (raw[i] && normalized[i] === raw[i] ? (100 * a[i]) / raw[i] : NaN))
      return {
        meanHeight: {
          ...meanGrid,
          values: Float32Array.from(first, (n, i) => (n && firstNormalized[i] === n ? heightSum[i] / n : NaN)),
        },
        vegetation: raster((i) =>
          raw[i] && normalized[i] === raw[i] ? (under[i] + mid[i] + over[i]) / grid.cellM ** 2 : NaN,
        ),
        canopy: raster((i) =>
          raw[i] && normalized[i] === raw[i] ? (100 * (under[i] + mid[i] + over[i])) / raw[i] : NaN,
        ),
        understory: percent(under),
        midstory: percent(mid),
        overstory: percent(over),
        ground: raster((i) => (raw[i] ? ground[i] / grid.cellM ** 2 : NaN)),
        support: raster((i) => (raw[i] ? (100 * normalized[i]) / raw[i] : NaN)),
      }
    },
  }
}
