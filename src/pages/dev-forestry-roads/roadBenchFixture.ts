/**
 * Synthetic bare-earth fixture for the road finding tests: a 30 % sidehill rising east, cut by a
 * 6 m road bench on an S-curve that falls 3 % along its length, with 1.5H:1V batters until they
 * meet the ground. Generated in the tests with deterministic pseudo-noise; no binary is committed.
 * Test support only: nothing in the app imports it.
 */
import type { XY } from './roadGrid'
import type { SurfaceGrid } from './surfaceGrid'

export const BENCH_X0 = 500_000
export const BENCH_Y0 = 6_000_600
const COLS = 500,
  ROWS = 600

/** The true centreline: 601 points running south 560 m with a 25 m east–west S. */
export function benchCentreline(): XY[] {
  return Array.from({ length: 601 }, (_, i) => {
    const t = i / 600
    return [BENCH_X0 + 250 + 25 * Math.sin(2 * Math.PI * t), BENCH_Y0 - 20 - t * 560] as XY
  })
}

/** Uniform pseudo-noise with standard deviation `sd`, repeatable per cell. */
export function cellNoise(col: number, row: number, sd: number) {
  const v = Math.sin(col * 127.1 + row * 311.7) * 43758.5453
  return (v - Math.floor(v) - 0.5) * (sd / 0.288675)
}

export interface BenchOptions {
  bench?: boolean
  /** Cross slope of the hill, rise per metre east. */
  crossSlope?: number
  noiseSd?: number
}

export function benchTerrain({ bench = true, crossSlope = 0.3, noiseSd = 0.01 }: BenchOptions = {}): SurfaceGrid {
  const line = benchCentreline()
  const cum = [0]
  for (let i = 1; i < line.length; i++)
    cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]))
  const values = new Float64Array(COLS * ROWS)
  const origin: [number, number] = [BENCH_X0 + 0.5, BENCH_Y0 - 0.5]
  const zc0 = 800 + crossSlope * (line[0][0] - BENCH_X0)
  for (let r = 0; r < ROWS; r++) {
    const y = origin[1] - r
    const guess = Math.round(((BENCH_Y0 - 20 - y) / 560) * 600)
    const lo = Math.max(0, Math.min(599, guess - 60)),
      hi = Math.max(1, Math.min(600, guess + 60))
    for (let c = 0; c < COLS; c++) {
      const x = origin[0] + c
      const ground = 800 + crossSlope * (x - BENCH_X0)
      let z = ground
      if (bench) {
        let best = Infinity,
          chainage = 0
        for (let i = lo; i < hi; i++) {
          const a = line[i],
            b = line[i + 1]
          const dx = b[0] - a[0],
            dy = b[1] - a[1],
            l2 = dx * dx + dy * dy
          const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2))
          const d = Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy)
          if (d < best) {
            best = d
            chainage = cum[i] + t * Math.sqrt(l2)
          }
        }
        const form = zc0 - 0.03 * chainage
        if (best <= 3) z = form
        else {
          const gd = ground - form
          const batter = form + Math.sign(gd) * ((best - 3) / 1.5)
          if (Math.abs(batter - form) < Math.abs(gd)) z = batter
        }
      }
      values[r * COLS + c] = z + cellNoise(c, r, noiseSd)
    }
  }
  return { origin, cellM: 1, width: COLS, height: ROWS, values }
}

/** The mapped line: every 20th true point, moved `offsetM` east, plus a 3 m east–west wobble. */
export function benchMappedLine(offsetM: number): XY[] {
  const line = benchCentreline().filter((_, i) => i % 20 === 0)
  return line.map((p, i) => [p[0] + offsetM + 3 * Math.sin((9 * i) / (line.length - 1)), p[1]] as XY)
}
