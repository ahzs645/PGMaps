/**
 * Lines that stay readable over a photograph: a leader is split into runs by the brightness of what
 * lies under it, dark over light sky or ground and white over dark forest, as a licensee's
 * perspective render draws its block leaders. The brightness comes in as a sampler, so the caller
 * decides what "under" means (the captured frame with the figure's fills over it). A change of colour
 * needs the ground to cross a band, not a single threshold, and to stay across it for a few samples,
 * so tree texture does not make the line flicker. No DOM or network access.
 */
import type { Point } from './drawOps'

/** Brightness under a page point, 0 black to 1 white; null where it is unknown (off the image). */
export type LuminanceSampler = (x: number, y: number) => number | null

/** A line's colour over its background: dark over light ground, light (white) over dark ground. */
export type Ink = 'dark' | 'light'

export const INK_COLOR: Record<Ink, string> = { dark: '#111111', light: '#ffffff' }

export interface ContrastOptions {
  /** A dark line turns white where the ground is darker than this. */
  toLight: number
  /** A white line turns dark again where the ground is lighter than this. */
  toDark: number
  /** Consecutive samples a change must hold for before the colour switches. */
  hold: number
  /** Spacing of the samples along the line, points. */
  step: number
}

export const CONTRAST: ContrastOptions = { toLight: 0.36, toDark: 0.5, hold: 3, step: 2 }

/** The ink that reads over ground of brightness `l`, with no history: the middle of the band decides. */
export const inkOver = (l: number, options: ContrastOptions = CONTRAST): Ink =>
  l < (options.toLight + options.toDark) / 2 ? 'light' : 'dark'

/**
 * The ink at each sample along a line. The first known sample sets it; it switches only where the
 * ground crosses the far side of the band and stays there for `hold` samples, and the switch is
 * back-dated to the first of them. Unknown samples neither start nor break a switch's streak.
 */
export function inkStates(samples: ReadonlyArray<number | null>, options: ContrastOptions = CONTRAST): Ink[] {
  const first = samples.find((l): l is number => l !== null)
  let ink: Ink = first === undefined ? 'dark' : inkOver(first, options)
  const out: Ink[] = []
  let streak = -1
  for (let i = 0; i < samples.length; i++) {
    out.push(ink)
    const l = samples[i]
    if (l === null) continue
    const wants = ink === 'dark' ? l < options.toLight : l > options.toDark
    if (!wants) {
      streak = -1
      continue
    }
    if (streak < 0) streak = i
    if (i - streak + 1 >= Math.max(1, options.hold)) {
      ink = ink === 'dark' ? 'light' : 'dark'
      for (let k = streak; k <= i; k++) out[k] = ink
      streak = -1
    }
  }
  return out
}

/** Cumulative lengths along a polyline. */
function cumulative(line: readonly Point[]) {
  const d = [0]
  for (let i = 1; i < line.length; i++)
    d.push(d[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]))
  return d
}

function pointAt(line: readonly Point[], d: readonly number[], at: number): Point {
  let i = 1
  while (i < d.length - 1 && d[i] < at) i++
  const span = d[i] - d[i - 1] || 1
  const t = Math.max(0, Math.min(1, (at - d[i - 1]) / span))
  return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t]
}

/** The part of a polyline from distance `from` to `to` along it, keeping its corners. */
function slice(line: readonly Point[], d: readonly number[], from: number, to: number): Point[] {
  const out: Point[] = [pointAt(line, d, from)]
  for (let i = 1; i < line.length - 1; i++) if (d[i] > from && d[i] < to) out.push(line[i])
  out.push(pointAt(line, d, to))
  return out
}

/**
 * A polyline split into runs of one ink each, by the brightness `sample` reads every `step` points
 * along it (`inkStates`). Runs meet half-way between the samples where the ink changes, so together
 * they cover the line exactly. Without a sampler the whole line is one dark run.
 */
export function contrastRuns(
  line: readonly Point[],
  sample: LuminanceSampler | null | undefined,
  options: ContrastOptions = CONTRAST,
): Array<{ ink: Ink; parts: Point[] }> {
  if (line.length < 2) return []
  const d = cumulative(line)
  const total = d[d.length - 1]
  if (!sample || !(total > 0)) return [{ ink: 'dark', parts: [...line] }]
  const count = Math.max(2, Math.ceil(total / Math.max(0.25, options.step)) + 1)
  const at = Array.from({ length: count }, (_, i) => (total * i) / (count - 1))
  const inks = inkStates(
    at.map((distance) => {
      const [x, y] = pointAt(line, d, distance)
      const l = sample(x, y)
      return l === null || !Number.isFinite(l) ? null : l
    }),
    options,
  )
  const runs: Array<{ ink: Ink; parts: Point[] }> = []
  let start = 0
  for (let i = 1; i <= count; i++) {
    if (i < count && inks[i] === inks[i - 1]) continue
    const from = start,
      to = i < count ? (at[i - 1] + at[i]) / 2 : total
    runs.push({ ink: inks[i - 1], parts: slice(line, d, from, to) })
    start = to
  }
  return runs
}

/** Mean and spread (standard deviation) of the brightness over a box, on a grid of `nx` × `ny` samples. */
export function boxLuminance(
  sample: LuminanceSampler,
  box: { x: number; y: number; w: number; h: number },
  nx = 8,
  ny = 3,
): { mean: number; spread: number } | null {
  const values: number[] = []
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const l = sample(box.x + (box.w * (i + 0.5)) / nx, box.y + (box.h * (j + 0.5)) / ny)
      if (l !== null && Number.isFinite(l)) values.push(l)
    }
  if (!values.length) return null
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const spread = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length)
  return { mean, spread }
}
