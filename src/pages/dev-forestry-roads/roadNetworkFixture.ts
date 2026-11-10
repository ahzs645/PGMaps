/**
 * Synthetic bare-earth fixture for the multi-road tests: rough, hummocky ground (pseudo-noise of
 * 0.06 m, so it scores near the floor for road-likeness) crossed by graded road beds 8 m wide,
 * raised 0.6 m on 2H:1V fill batters. Where two roads meet their beds merge, as at a real junction.
 * Generated in the tests with deterministic pseudo-noise; no binary is committed. Test support
 * only: nothing in the app imports it.
 */
import { cellNoise } from './roadBenchFixture'
import { cumulativeLength, pointAlong, type XY } from './roadGrid'
import type { SurfaceGrid } from './surfaceGrid'

export const NET_X0 = 600_000
export const NET_Y0 = 6_001_000
/** Half the bed width and the fill height, m. */
const HALF_BED_M = 4
const FILL_M = 0.6
/** Horizontal run per unit rise of the fill batters. */
const BATTER_RUN = 2

export interface NetworkTerrainOptions {
  /** Window size, m (1 m cells). */
  size?: number
  /** Roughness of the natural ground, standard deviation in m. */
  groundSd?: number
}

/** Terrain over `roads` (true centrelines, projected metres inside the window from NET_X0, NET_Y0 − size). */
export function networkTerrain(roads: readonly XY[][], { size = 700, groundSd = 0.06 }: NetworkTerrainOptions = {}) {
  const width = size,
    height = size
  const origin: [number, number] = [NET_X0 + 0.5, NET_Y0 - 0.5]
  const dist = new Float64Array(width * height).fill(Infinity)
  const reach = HALF_BED_M + FILL_M * BATTER_RUN + 1
  for (const road of roads)
    for (let i = 1; i < road.length; i++) {
      const a = road[i - 1],
        b = road[i]
      const c0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - reach - origin[0])),
        c1 = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0]) + reach - origin[0]))
      const r0 = Math.max(0, Math.floor(origin[1] - Math.max(a[1], b[1]) - reach)),
        r1 = Math.min(height - 1, Math.ceil(origin[1] - Math.min(a[1], b[1]) + reach))
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        l2 = dx * dx + dy * dy || 1
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const x = origin[0] + c,
            y = origin[1] - r
          const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2))
          const d = Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy)
          const k = r * width + c
          if (d < dist[k]) dist[k] = d
        }
    }
  const values = new Float64Array(width * height)
  for (let r = 0; r < height; r++)
    for (let c = 0; c < width; c++) {
      const k = r * width + c
      const ground = 700 + cellNoise(c, r, groundSd)
      const d = dist[k]
      const bed = 700 + FILL_M
      values[k] =
        d <= HALF_BED_M ? bed + cellNoise(c + 7, r + 3, 0.01) : Math.max(ground, bed - (d - HALF_BED_M) / BATTER_RUN)
    }
  const grid: SurfaceGrid = { origin, cellM: 1, width, height, values }
  return grid
}

/** A straight line from `a` to `b` with a vertex every `stepM`. */
export function straight(a: XY, b: XY, stepM = 10): XY[] {
  const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / stepM))
  return Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as XY)
}

/** A circle of `radius` about `centre`, starting and ending at the angle `start` (radians), counter-clockwise. */
export function circle(centre: XY, radius: number, start: number, vertices = 72): XY[] {
  return Array.from({ length: vertices + 1 }, (_, i) => {
    const t = start + (2 * Math.PI * i) / vertices
    return [centre[0] + radius * Math.cos(t), centre[1] + radius * Math.sin(t)] as XY
  })
}

/**
 * A mapped record of `line`: moved by `shift`, with a wobble of `wobbleM` across it that is zero at
 * both ends, so records that met still meet exactly.
 */
export function mappedRecord(line: readonly XY[], shift: XY, wobbleM = 2): XY[] {
  const cum = cumulativeLength(line)
  const total = cum.at(-1) ?? 0
  return line.map((p, i) => {
    const { dir } = pointAlong(line, cum, cum[i])
    const w = wobbleM * Math.sin((Math.PI * cum[i]) / total) * Math.sin((6 * cum[i]) / Math.max(total, 1))
    return [p[0] + shift[0] - dir[1] * w, p[1] + shift[1] + dir[0] * w] as XY
  })
}
