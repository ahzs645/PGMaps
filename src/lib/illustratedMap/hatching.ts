/**
 * Authored contour bands and short cubic strokes, not vectorized reference pixels.
 * Marks follow a band's local normal with a small independent bend. Anchors are
 * spaced along the contour, avoiding the slanted density corridors produced by
 * fixed x-columns and an unrelated lean field. Row-specific offsets and varied
 * endpoints keep the seams imperfect without removing their local organization.
 *
 * Research: https://www.tylerxhobbs.com/words/flow-fields and Jobard/Lefer's
 * evenly spaced streamlines. No external drawing code or source marks are used.
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
  strokeWidth: 1.55,
  curvature: 8,
})

const MAX_STROKES = 30_000
const MAX_DIMENSION = 4096
const HORIZONTAL_PADDING = 70

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

/** Counter-based randomness keeps existing marks stable when an artboard grows. */
function randomAt(seed: number, row: number, column: number, channel: number): number {
  let h = seed ^ Math.imul(row, 0x9e3779b1) ^ Math.imul(column, 0x85ebca77)
  h ^= Math.imul(channel + 1, 0xc2b2ae3d)
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  return ((h ^ (h >>> 16)) >>> 0) / 0x1_0000_0000
}

function n(value: number): string {
  return String(Math.round(value * 100) / 100 || 0)
}

type Point = { x: number; y: number }
type CubicStroke = { start: Point; c1: Point; c2: Point; end: Point }
type FieldSample = { value: number; dx: number; dv: number }

function makeStrokeField(options: HatchOptions) {
  const { seed, curvature, bandHeight } = options
  const rand = (row: number, column: number, channel: number) => randomAt(seed, row, column, channel)
  const strength = (1.5 * curvature) / (4 + curvature)
  const verticalScale = Math.max(1, strength)
  const rowStrength = Math.min(1, strength) * 0.22
  const detailStrength = Math.min(curvature, 16) / 8

  function noise(x: number, y: number, channel: number): FieldSample {
    const ix = Math.floor(x)
    const iy = Math.floor(y)
    const tx = x - ix
    const ty = y - iy
    const wx = tx * tx * (3 - 2 * tx)
    const wy = ty * ty * (3 - 2 * ty)
    const a = rand(iy, ix, channel)
    const b = rand(iy, ix + 1, channel)
    const c = rand(iy + 1, ix, channel)
    const d = rand(iy + 1, ix + 1, channel)
    const top = a + (b - a) * wx
    const bottom = c + (d - c) * wx
    return {
      value: 2 * (top + (bottom - top) * wy) - 1,
      dx: 2 * ((b - a) * (1 - wy) + (d - c) * wy) * 6 * tx * (1 - tx),
      dv: 2 * (bottom - top) * 6 * ty * (1 - ty),
    }
  }

  function field(lx: number, lv: number, angle: number, channel: number) {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    return (x: number, v: number): FieldSample => {
      // Rotating each lattice prevents derivative-zero rails at shared x knots.
      const sample = noise(
        (cos * x) / lx + (sin * v) / lv + channel * 0.276,
        (-sin * x) / lx + (cos * v) / lv + channel * 0.183,
        channel,
      )
      return {
        value: sample.value,
        dx: (cos * sample.dx - sin * sample.dv) / lx,
        dv: (sin * sample.dx + cos * sample.dv) / lv,
      }
    }
  }

  const fine = field(24, 60 * verticalScale, 0.41, 40)
  const finer = field(12, 45 * verticalScale, -0.63, 41)
  const broad = field(85, 400 * verticalScale, 0.76, 43)
  const leanField = field(30, 28, 0.83, 55)
  const bendField = field(21, 35, -0.38, 56)

  function rowOffset(x: number, row: number) {
    const pitch = 30 + rand(row, 0, 71) * 28
    const position = x / pitch + rand(row, 0, 70) * 10
    const cell = Math.floor(position)
    const t = position - cell
    const a = rand(row, cell, 72)
    const b = rand(row, cell + 1, 72)
    return {
      value: 2 * (a + (b - a) * t * t * (3 - 2 * t)) - 1,
      dx: (2 * (b - a) * 6 * t * (1 - t)) / pitch,
    }
  }

  function surface(x: number, v: number) {
    const p = fine(x, v)
    const q = finer(x, v)
    const m = broad(x, v)
    const row = Math.floor(v / bandHeight)
    const t = v / bandHeight - row
    const a = rowOffset(x, row)
    const b = rowOffset(x, row + 1)
    return {
      y:
        v +
        strength * (3 * p.value + 1.5 * q.value + 14 * m.value) +
        bandHeight * rowStrength * (a.value * (1 - t) + b.value * t),
      dx: strength * (3 * p.dx + 1.5 * q.dx + 14 * m.dx) + bandHeight * rowStrength * (a.dx * (1 - t) + b.dx * t),
      dv: 1 + strength * (3 * p.dv + 1.5 * q.dv + 14 * m.dv) + rowStrength * (b.value - a.value),
    }
  }

  // The rotated value-noise derivative bounds give surface.dv > 0.07 for
  // every permitted setting and seed. Increasing strong curvature also extends
  // its vertical wavelengths, so the contour bands cannot exchange order.
  function velocity(x: number, v: number): number {
    const { dx, dv } = surface(x, v)
    return (-dx * dv) / (1 + dx * dx)
  }

  function integrate(x: number, v: number, distance: number): number {
    const steps = Math.max(1, Math.ceil(Math.abs(distance) / 3))
    const step = distance / steps
    for (let i = 0; i < steps; i += 1) {
      const a = velocity(x, v)
      const b = velocity(x + (a * step) / 2, v + step / 2)
      const c = velocity(x + (b * step) / 2, v + step / 2)
      const d = velocity(x + c * step, v + step)
      x += (step * (a + 2 * b + 2 * c + d)) / 6
      v += step
    }
    return x
  }

  function stroke(row: number, column: number, x: number): CubicStroke {
    const middle = (row + 0.5) * bandHeight
    const v0 = (row + 0.095 * (0.4 + 1.2 * rand(row, column, 4))) * bandHeight
    const v3 = (row + 1 - 0.095 * (0.4 + 1.2 * rand(row, column, 5))) * bandHeight
    const lean = leanField(x, middle).value * 2.2 * detailStrength
    const bend = bendField(x, middle).value * 2 * detailStrength
    const pointsAt = (amount: number): Point[] =>
      [0, 1 / 3, 2 / 3, 1].map((t) => {
        const v = v0 + (v3 - v0) * t
        const xx = integrate(x, middle, v - middle) + amount * (lean * (t - 0.5) + bend * 4 * t * (1 - t))
        return { x: xx, y: surface(xx, v).y }
      })
    let amount = 1
    let points = pointsAt(amount)
    while (points[3].y - points[0].y < bandHeight * 0.03 && amount > 0.03) {
      amount *= 0.5
      points = pointsAt(amount)
    }
    if (points[3].y <= points[0].y) points = pointsAt(0)
    const [start, p1, p2, end] = points
    const c1 = {
      x: (54 * p1.x - 27 * p2.x - 15 * start.x + 6 * end.x) / 18,
      y: (54 * p1.y - 27 * p2.y - 15 * start.y + 6 * end.y) / 18,
    }
    const c2 = {
      x: (54 * p2.x - 27 * p1.x + 6 * start.x - 15 * end.x) / 18,
      y: (54 * p2.y - 27 * p1.y + 6 * start.y - 15 * end.y) / 18,
    }
    // At extreme settings a fitted cubic can overshoot its sampled trajectory.
    // Ordered y-controls preserve a simple, downward-moving editable stroke.
    const height = end.y - start.y
    c1.y = bounded(c1.y, start.y + height / 3, start.y + height * 0.03, start.y + height * 0.48)
    c2.y = bounded(c2.y, start.y + (2 * height) / 3, start.y + height * 0.52, end.y - height * 0.03)
    return { start, c1, c2, end }
  }

  function advance(x: number, row: number, column: number, spacing: number): number {
    const v = (row + 0.5) * bandHeight
    const arcLength = spacing * (0.83 + 0.34 * rand(row, column, 7))
    const first = arcLength / Math.hypot(1, surface(x, v).dx)
    return arcLength / Math.hypot(1, surface(x + first / 2, v).dx)
  }

  return { stroke, advance, verticalPadding: bandHeight * (1 + rowStrength) + 18.5 * strength + 2 }
}

/**
 * Returns explicit cubic strokes in a color-inheriting SVG group.
 * The caller clips to land intersected with forest and applies any illustration
 * clearances. Labels can use independent halos. Coordinates share origin (0,0).
 * Non-positive/non-finite extents return an empty group; finite extents cap at
 * 4096. Excessive requests increase spacing throughout the field, reported in
 * data-effective-spacing/data-budget-limited, without truncating bottom rows.
 */
export function buildHatchPaths(width: number, height: number, input: Partial<HatchOptions> = {}): string {
  const options = readOptions(input)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '<g data-generator="contour-hatch-v3" data-stroke-count="0"/>'
  }
  const w = Math.min(width, MAX_DIMENSION)
  const h = Math.min(height, MAX_DIMENSION)
  const field = makeStrokeField(options)
  const firstRow = Math.floor(-field.verticalPadding / options.bandHeight)
  const lastRow = Math.ceil((h + field.verticalPadding) / options.bandHeight)
  let spacing = Math.max(options.spacing, (w * h) / (options.bandHeight * (MAX_STROKES - 256)))
  const rand = (row: number, column: number, channel: number) => randomAt(options.seed, row, column, channel)

  function draw(pitch: number): string[] {
    const paths: string[] = []
    const safeWidth = Math.min(options.strokeWidth, pitch * (0.68 - options.curvature * 0.01))
    for (let row = firstRow; row <= lastRow; row += 1) {
      let column = 0
      let x = -HORIZONTAL_PADDING + rand(row, 0, 3) * pitch
      while (x < w + HORIZONTAL_PADDING) {
        const { start, c1, c2, end } = field.stroke(row, column, x)
        const strokeWidth = safeWidth * (0.78 + rand(row, column, 6) * 0.44)
        const halfWidth = strokeWidth / 2
        if (
          Math.max(start.x, c1.x, c2.x, end.x) + halfWidth >= 0 &&
          Math.min(start.x, c1.x, c2.x, end.x) - halfWidth <= w &&
          Math.max(start.y, c1.y, c2.y, end.y) + halfWidth >= 0 &&
          Math.min(start.y, c1.y, c2.y, end.y) - halfWidth <= h
        ) {
          paths.push(
            `<path d="M${n(start.x)} ${n(start.y)}C${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(end.x)} ${n(end.y)}" stroke-width="${n(strokeWidth)}"/>`,
          )
          if (paths.length > MAX_STROKES) return paths
        }
        x += field.advance(x, row, column, pitch)
        column += 1
      }
    }
    return paths
  }

  let paths = draw(spacing)
  while (paths.length > MAX_STROKES) {
    spacing *= 1.1
    paths = draw(spacing)
  }
  return (
    `<g data-generator="contour-hatch-v3" data-seed="${options.seed}" data-stroke-count="${paths.length}" ` +
    `data-effective-spacing="${n(spacing)}" data-budget-limited="${spacing > options.spacing}" ` +
    `fill="none" stroke="currentColor" stroke-linecap="round">\n${paths.join('\n')}\n</g>`
  )
}

/** A standalone 600 x 360 vector sample in the map's source-reproduction color. */
export function buildHatchSwatchSvg(options: Partial<HatchOptions> = {}): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="360" viewBox="0 0 600 360" color="#BCC454">' +
    '<title>Procedural forest hatching</title>' +
    '<desc>Short cubic strokes follow locally varying contour bands with arc-length spacing and staggered endpoints. Authored geometry, not a raster trace.</desc>' +
    '<rect width="600" height="360" fill="white"/>' +
    buildHatchPaths(600, 360, options) +
    '</svg>'
  )
}
