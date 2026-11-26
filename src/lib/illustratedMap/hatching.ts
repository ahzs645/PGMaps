/**
 * An authored ribbon lattice, not a vectorization of the reference pixels.
 * A smooth, orientation-preserving warp bends short upright strokes between
 * neighboring row boundaries. Randomness is keyed to each row and column, so
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
  spacing: 3.1,
  bandHeight: 16,
  strokeWidth: 1.2,
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

type PointWithTangent = { x: number; y: number; dx: number; dy: number }

function makeWarp(curvature: number, seed: number) {
  const phases = [0, 1, 2, 3].map((channel) => randomAt(seed, 0, 0, channel) * 100)
  const noise = (position: number, channel: number) => {
    const cell = Math.floor(position)
    const t = position - cell
    const smooth = t * t * (3 - 2 * t)
    const a = randomAt(seed, 0, cell, channel)
    const b = randomAt(seed, 0, cell + 1, channel)
    return {
      value: a + (b - a) * smooth - 0.5,
      derivative: (b - a) * 6 * t * (1 - t),
    }
  }
  return (u: number, v: number): PointWithTangent => {
    // Seeded, smoothly varying phases and amplitudes keep broad flowing bands
    // without the visibly repeated cycles of an unmodulated sine-wave grid.
    const verticalPhase = noise(v / 250 + phases[2], 20)
    const fineVerticalPhase = noise(v / 180 + phases[0], 21)
    const amplitude = 1 + 0.35 * noise(u / 200 + phases[3], 22).value
    const firstWave =
      u / 20 + 2.5 * noise(u / 75 + phases[1], 23).value + v / 70 + 0.5 * verticalPhase.value + phases[0]
    const secondWave =
      u / 9.5 + 1.3 * noise(u / 50 + phases[3], 24).value - v / 40 + 0.3 * fineVerticalPhase.value + phases[1]
    const y = v + curvature * (amplitude * Math.sin(firstWave) + 0.45 * Math.sin(secondWave))
    // Each noise derivative is bounded by 1.5; dy/dv remains above 0.21.
    const dy =
      1 +
      curvature *
        (amplitude * Math.cos(firstWave) * (1 / 70 + (0.5 * verticalPhase.derivative) / 250) +
          0.45 * Math.cos(secondWave) * (-1 / 40 + (0.3 * fineVerticalPhase.derivative) / 180))
    const leanPhase = noise(y / 100 + phases[0], 25)
    const fineLeanPhase = noise(y / 150 + phases[2], 26)
    const firstLean = u / 35 + y / 21 + phases[2] + 1.2 * noise(u / 200 + phases[1], 27).value + 1.2 * leanPhase.value
    const secondLean = u / 70 + y / 24 + phases[3] + 1.1 * fineLeanPhase.value
    const x = u + curvature * (0.8 * Math.sin(firstLean) + 0.14 * Math.sin(secondLean))
    // At fixed y, dx/du remains above 0.23. The composition preserves order.
    const dx =
      curvature *
      (0.8 * Math.cos(firstLean) * (1 / 21 + (1.2 * leanPhase.derivative) / 100) +
        0.14 * Math.cos(secondLean) * (1 / 24 + (1.1 * fineLeanPhase.derivative) / 150)) *
      dy
    return { x, y, dx, dy }
  }
}

/**
 * Returns explicit cubic strokes in a color-inheriting SVG group.
 * The caller clips this field to the forest and subtracts label/illustration
 * keepouts. Width and height are artboard extents from the same global (0,0).
 * Non-positive/non-finite extents return an empty group; large finite extents
 * are capped at 4096. If a requested field exceeds the stroke budget, column
 * spacing is increased, reported in data-effective-spacing/data-budget-limited.
 */
export function buildHatchPaths(width: number, height: number, input: Partial<HatchOptions> = {}): string {
  const options = readOptions(input)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '<g data-generator="ribbon-hatch-v1" data-stroke-count="0"/>'
  }
  const w = Math.min(width, MAX_DIMENSION)
  const h = Math.min(height, MAX_DIMENSION)
  const margin = options.curvature * 1.5 + options.bandHeight + 2
  const firstRow = Math.floor(-margin / options.bandHeight)
  const lastRow = Math.ceil((h + margin) / options.bandHeight)
  // Estimate visible marks, not off-artboard padding. The latter made a normal
  // map's texture too sparse. A bounded pass below checks the actual count.
  let spacing = Math.max(options.spacing, (w * h) / (options.bandHeight * (MAX_STROKES - 256)))
  const warp = makeWarp(options.curvature, options.seed)
  const rand = (row: number, column: number, channel: number) => randomAt(options.seed, row, column, channel)

  const boundary = (row: number, u: number): number => {
    // Each boundary has its own smoothly varying profile. Both adjoining rows
    // share that same boundary, so their white seam stays narrow and ordered.
    const noise = (pitch: number, channel: number): number => {
      const position = u / pitch
      const cell = Math.floor(position)
      const t = position - cell
      const smooth = t * t * (3 - 2 * t)
      return 2 * (rand(row, cell, channel) * (1 - smooth) + rand(row, cell + 1, channel) * smooth) - 1
    }
    const broad = noise(45 + 30 * rand(row, 0, 10), 11)
    const fine = noise(18 + 10 * rand(row, 0, 12), 13)
    return options.bandHeight * (row + 0.24 * broad + 0.06 * fine)
  }

  const draw = (pitch: number): string[] => {
    const paths: string[] = []
    const firstColumn = Math.floor(-margin / pitch) - 1
    const lastColumn = Math.ceil((w + margin) / pitch) + 1
    // At high curvature the warped columns can converge. Limit very wide pens
    // relative to column spacing so those regions do not turn into solid fills.
    const safeWidth = Math.min(options.strokeWidth, pitch * (0.68 - options.curvature * 0.01))
    for (let row = firstRow; row <= lastRow; row += 1) {
      const rowOffset = (rand(row, 0, 5) - 0.5) * pitch * 0.7
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const u = column * pitch + rowOffset + (rand(row, column, 6) - 0.5) * pitch * 0.12
        const topInset = options.bandHeight * (0.04 + rand(row, column, 7) * 0.06)
        const bottomInset = options.bandHeight * (0.04 + rand(row, column, 8) * 0.06)
        const v0 = boundary(row, u) + topInset
        const v1 = boundary(row + 1, u) - bottomInset
        const start = warp(u, v0)
        const end = warp(u, v1)
        const third = (v1 - v0) / 3
        const c1 = { x: start.x + third * start.dx, y: start.y + third * start.dy }
        const c2 = { x: end.x - third * end.dx, y: end.y - third * end.dy }
        const strokeWidth = safeWidth * (0.92 + rand(row, column, 9) * 0.16)
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
    `<g data-generator="ribbon-hatch-v1" data-seed="${options.seed}" data-stroke-count="${paths.length}" ` +
    `data-effective-spacing="${n(spacing)}" data-budget-limited="${spacing > options.spacing}" ` +
    `fill="none" stroke="currentColor" stroke-linecap="round">\n${paths.join('\n')}\n</g>`
  )
}

/** A standalone, fully vector 600 x 360 sample in the brand's Lush Moss color. */
export function buildHatchSwatchSvg(options: Partial<HatchOptions> = {}): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="360" viewBox="0 0 600 360" color="#B0BD36">' +
    '<title>Procedural forest hatching</title>' +
    '<desc>Short cubic strokes in a seeded, smoothly warped ribbon lattice. Authored geometry, not a raster trace.</desc>' +
    '<rect width="600" height="360" fill="white"/>' +
    buildHatchPaths(600, 360, options) +
    '</svg>'
  )
}
