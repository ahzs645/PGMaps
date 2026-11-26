/**
 * An authored ribbon lattice, not a vectorization of the reference pixels.
 * Aperiodic shared boundaries hold short strokes with locally varying lean and
 * curvature. Randomness is keyed to each row and column, so
 * changing the ordinary artboard size keeps the existing marks in place.
 *
 * Research references: Tyler Hobbs, https://www.tylerxhobbs.com/words/flow-fields
 * and Jobard/Lefer's evenly spaced streamline work. This implementation uses
 * analytic curves and a regular warped lattice, not either author's code.
 */
export type HatchOptions = {
  seed: number
  spacing: number
  bandHeight: number
  strokeWidth: number
  curvature: number
}

export const DEFAULT_HATCH_OPTIONS: Readonly<HatchOptions> = Object.freeze({
  seed: 8,
  spacing: 3,
  bandHeight: 14,
  strokeWidth: 1.4,
  curvature: 8,
})

const MAX_STROKES = 30_000
const MAX_DIMENSION = 4096

function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
}

function readOptions(input: Partial<HatchOptions>): HatchOptions {
  return {
    seed: Math.trunc(bounded(input.seed, DEFAULT_HATCH_OPTIONS.seed, 0, 999_999)),
    spacing: bounded(input.spacing, DEFAULT_HATCH_OPTIONS.spacing, 1.5, 12),
    bandHeight: bounded(input.bandHeight, DEFAULT_HATCH_OPTIONS.bandHeight, 8, 40),
    strokeWidth: bounded(input.strokeWidth, DEFAULT_HATCH_OPTIONS.strokeWidth, 0.3, 2.4),
    curvature: bounded(input.curvature, DEFAULT_HATCH_OPTIONS.curvature, 0, 24),
  }
}

/** A counter-based hash: extending a row never consumes another row's random stream. */
function randomAt(seed: number, row: number, column: number, channel: number): number {
  let h = seed ^ Math.imul(row, 0x9e3779b1) ^ Math.imul(column, 0x85ebca77)
  h ^= Math.imul(channel + 1, 0xc2b2ae3d)
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  return ((h ^ (h >>> 16)) >>> 0) / 0x1_0000_0000
}

function n(value: number): string {
  // Avoid negative zero in exported files and keep the editable SVG compact.
  return String(Math.round(value * 100) / 100 || 0)
}

type Point = { x: number; y: number }
type CubicStroke = { start: Point; c1: Point; c2: Point; end: Point }

function makeStrokeField(options: HatchOptions) {
  const { seed, curvature, bandHeight } = options
  const rand = (row: number, column: number, channel: number) => randomAt(seed, row, column, channel)
  const smooth = (t: number) => t * t * (3 - 2 * t)
  const noise = (row: number, x: number, pitch: number, channel: number): number => {
    const position = x / pitch + rand(row, 0, channel + 30) * 30
    const cell = Math.floor(position)
    const weight = smooth(position - cell)
    return 2 * (rand(row, cell, channel) * (1 - weight) + rand(row, cell + 1, channel) * weight) - 1
  }
  const field = (x: number, y: number, channel: number): number => {
    const ix = Math.floor(x)
    const iy = Math.floor(y)
    const wx = smooth(x - ix)
    const wy = smooth(y - iy)
    const top = rand(iy, ix, channel) * (1 - wx) + rand(iy, ix + 1, channel) * wx
    const bottom = rand(iy + 1, ix, channel) * (1 - wx) + rand(iy + 1, ix + 1, channel) * wx
    return 2 * (top * (1 - wy) + bottom * wy) - 1
  }
  const boundary = (row: number, x: number): number => {
    const pitch = 34 + rand(row, 0, 10) * 38
    return (
      bandHeight *
      (row +
        0.18 * noise(row, x, pitch, 11) +
        0.06 * noise(row, x, 17 + rand(row, 0, 12) * 15, 13) +
        0.08 * (2 * rand(row, 0, 14) - 1))
    )
  }
  // Shared aperiodic displacement gives adjacent seams related contours.
  // There are no repeating trigonometric waves. Its bounded vertical
  // derivative stays positive at the strongest permitted curvature.
  const amplitude = curvature <= 8 ? curvature : 8 + (curvature - 8) * 0.4
  const warpY = (x: number, y: number): number =>
    y + amplitude * (2 * field(x / 60 + 13.2, y / 140 + 10.8, 40) + 0.6 * field(x / 22 + 6.1, y / 100 + 4.2, 41))

  return (row: number, column: number, pitch: number): CubicStroke => {
    const u = (column + (rand(row, 0, 5) - 0.5) * 0.9 + (rand(row, column, 6) - 0.5) * 0.36) * pitch
    const leanPitch = 32 + rand(row, 0, 20) * 42
    const leanField = 0.83 * field(u / 50 + 9.3, row * 0.65 + 7.5, 51) + 0.17 * noise(row, u, leanPitch, 21)
    // Most marks stay near upright, with occasional stronger local groups.
    // The earlier globally shared lean made long visible currents.
    let lean = Math.min(curvature, 9) * 2.05 * Math.sign(leanField) * Math.abs(leanField) ** 1.5
    const bend = curvature * 0.2 * noise(row, u, 40 + rand(row, 0, 22) * 40, 23)
    const topInset = bandHeight * (0.035 + 0.06 * rand(row, column, 7))
    const bottomInset = bandHeight * (0.035 + 0.06 * rand(row, column, 8))
    const endpoints = (): { start: Point; end: Point } => {
      const x0 = u - lean / 2
      const x3 = u + lean / 2
      return {
        start: { x: x0, y: warpY(x0, boundary(row, x0) + topInset) },
        end: { x: x3, y: warpY(x3, boundary(row + 1, x3) - bottomInset) },
      }
    }
    let points = endpoints()
    // A strongly tilted mark can reach a pinched part of a neighboring seam.
    // Shorten its horizontal excursion rather than folding the stroke upward.
    for (let attempt = 0; points.end.y - points.start.y < bandHeight * 0.12 && attempt < 8; attempt += 1) {
      lean *= 0.5
      points = endpoints()
    }
    if (points.end.y <= points.start.y) {
      lean = 0
      points = endpoints()
    }
    const { start, end } = points
    const third = (end.y - start.y) / 3
    return {
      start,
      c1: { x: start.x + lean / 3 + bend, y: start.y + third },
      c2: { x: start.x + (lean * 2) / 3 + bend, y: end.y - third },
      end,
    }
  }
}

/**
 * Returns explicit cubic strokes in a color-inheriting SVG group.
 * The caller clips this field to the intersection of land and forest, and
 * applies any illustration clearances. Labels can use independent halos.
 * Width and height are artboard extents from the same global (0,0).
 * Non-positive/non-finite extents return an empty group; large finite extents
 * are capped at 4096. If a requested field exceeds the stroke budget, column
 * spacing is increased, reported in data-effective-spacing/data-budget-limited.
 */
export function buildHatchPaths(width: number, height: number, input: Partial<HatchOptions> = {}): string {
  const options = readOptions(input)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '<g data-generator="ribbon-hatch-v2" data-stroke-count="0"/>'
  }
  const w = Math.min(width, MAX_DIMENSION)
  const h = Math.min(height, MAX_DIMENSION)
  const margin = options.curvature * 1.5 + options.bandHeight + 2
  const firstRow = Math.floor(-margin / options.bandHeight)
  const lastRow = Math.ceil((h + margin) / options.bandHeight)
  // Estimate visible marks, not off-artboard padding. The latter made a normal
  // map's texture too sparse. A bounded pass below checks the actual count.
  let spacing = Math.max(options.spacing, (w * h) / (options.bandHeight * (MAX_STROKES - 256)))
  const strokeAt = makeStrokeField(options)
  const rand = (row: number, column: number, channel: number) => randomAt(options.seed, row, column, channel)

  const draw = (pitch: number): string[] => {
    const paths: string[] = []
    const firstColumn = Math.floor(-margin / pitch) - 1
    const lastColumn = Math.ceil((w + margin) / pitch) + 1
    // At high curvature the warped columns can converge. Limit very wide pens
    // relative to column spacing so those regions do not turn into solid fills.
    const safeWidth = Math.min(options.strokeWidth, pitch * (0.68 - options.curvature * 0.01))
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const { start, c1, c2, end } = strokeAt(row, column, pitch)
        const strokeWidth = safeWidth * (0.78 + rand(row, column, 9) * 0.44)
        const halfWidth = strokeWidth / 2
        // A cubic stays within the convex hull of its controls. This only drops
        // wholly invisible marks; boundary marks are left for the caller's clip.
        if (
          Math.max(start.x, c1.x, c2.x, end.x) + halfWidth < 0 ||
          Math.min(start.x, c1.x, c2.x, end.x) - halfWidth > w ||
          Math.max(start.y, c1.y, c2.y, end.y) + halfWidth < 0 ||
          Math.min(start.y, c1.y, c2.y, end.y) - halfWidth > h
        ) {
          continue
        }
        paths.push(
          `<path d="M${n(start.x)} ${n(start.y)}C${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(end.x)} ${n(end.y)}" stroke-width="${n(strokeWidth)}"/>`,
        )
        if (paths.length > MAX_STROKES) return paths
      }
    }
    return paths
  }
  let paths = draw(spacing)
  // If the warped boundary adds more marks than the estimate allows, coarsen
  // the whole field and restart. Never truncate the lower rows of the output.
  while (paths.length > MAX_STROKES) {
    spacing *= 1.1
    paths = draw(spacing)
  }
  return (
    `<g data-generator="ribbon-hatch-v2" data-seed="${options.seed}" data-stroke-count="${paths.length}" ` +
    `data-effective-spacing="${n(spacing)}" data-budget-limited="${spacing > options.spacing}" ` +
    `fill="none" stroke="currentColor" stroke-linecap="round">\n${paths.join('\n')}\n</g>`
  )
}

/** A standalone 600 x 360 vector sample in the map's source-reproduction color. */
export function buildHatchSwatchSvg(options: Partial<HatchOptions> = {}): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="360" viewBox="0 0 600 360" color="#BCC454">' +
    '<title>Procedural forest hatching</title>' +
    '<desc>Short cubic strokes with aperiodic shared seams and locally varied lean. Authored geometry, not a raster trace.</desc>' +
    '<rect width="600" height="360" fill="white"/>' +
    buildHatchPaths(600, 360, options) +
    '</svg>'
  )
}
