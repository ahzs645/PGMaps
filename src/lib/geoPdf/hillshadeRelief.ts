/**
 * Ground between a sheet's contours, read from the same sheet set's hillshade.
 *
 * A hillshade pixel is one measurement: the cosine of the angle between the ground's normal and the
 * sun, cos Z − sin Z (p sx + q sy) over √(1 + p² + q²) for ground rising p to the east and q to the
 * north. That is one equation for two slopes, so a hillshade alone gives no surface. Tied to the
 * contours it does: the labelled lines fix the heights, and between two lines the shading says how
 * the ground gets from one to the other. The surface is the one that reproduces the hillshade,
 * passes through the contours, stays smooth where neither speaks, and stays within one contour
 * interval of the plain contour surface, which is all the contours allow.
 *
 * Solved as a least-squares problem by Gauss–Newton, each step by LSQR (Paige and Saunders 1982)
 * without forming a matrix, coarse cells first so the long shapes settle before the detail. The
 * idea is shape from shading (Horn 1970; Horn and Brooks 1989) with known boundary heights.
 *
 * It is an estimate between contours, never a survey: `docs/forestry-road-design/source-pdf-import.md`,
 * **Relief between contours from the hillshade**, has what was measured. No DOM or network access.
 */
import { applyMatrix, invertMatrix } from './classGrid'
import { projectedEpsg } from './georeference'
import type { PdfImageMosaic } from './types'

export const RELIEF = {
  /** Weight of a hillshade residual (shade is 0–1): a grey level or two of noise is expected. */
  shadeWeight: 40,
  /** Weight of a contour height, per metre: the lines are drawn to a fraction of a metre. */
  anchorWeight: 4,
  /** Weight of curvature, per unit of slope change a cell: only enough to quiet single-cell noise. */
  smoothWeight: 2,
  /** Weight of the plain contour surface, per metre: it only stops ground the shading does not pin from wandering. */
  priorWeight: 0.02,
  /** Levenberg damping of each step. */
  damping: 0.05,
  /** Cell sizes solved, as multiples of the grid's, coarse to fine. */
  levels: [4, 2, 1],
  /** Gauss–Newton steps and LSQR iterations a level. */
  steps: [6, 4, 3],
  iterations: [160, 110, 80],
  /** A step moving no cell this far, metres, ends a level early. */
  settledM: 0.02,
  /** Clamped or saturated shade says little about slope. */
  dimShade: 0.03,
  brightShade: 0.985,
  /** The refinement fades out over this many cells at the edge of the hillshade. */
  taperCells: 10,
  /** Smoothing of the contour surface before its slopes are compared with the hillshade, cells. */
  fitSmoothingCells: 3,
  /** Least correlation between the hillshade and the contour surface's own shading. */
  minFitCorrelation: 0.6,
  /** Cells of near-level ground needed to read the sun's height from them. */
  minFlatCells: 500,
  flatSlope: 0.03,
  /**
   * A plain hillshade's level-ground value is the sine of the sun's height and its change with
   * slope toward the sun is the cosine. A contrast stretch or a gamma curve breaks that pair: the
   * fitted strength may sit this far above the cosine, or this far below (noise in the contour
   * surface's slopes weakens the fit, so the lower side is looser).
   */
  strengthAbove: 0.08,
  strengthBelow: 0.15,
  /** Sun heights a plain hillshade is drawn at, degrees. */
  altitudeRange: [20, 80],
} as const

export interface HillshadeLighting {
  /** Where the sun is, clockwise from the grid's north, degrees. */
  azimuthDeg: number
  /** How high it is, degrees. */
  altitudeDeg: number
  /** Median grey of near-level ground, 0–255; 180 for a 45° sun. */
  flatGrey: number
  /** Correlation between the hillshade and the smoothed contour surface's shading under this sun. */
  correlation: number
}

export interface ReliefInput {
  width: number
  height: number
  cellM: number
  /** The plain contour surface, metres; NaN where it has no ground. Rows run south. */
  prior: Float32Array
  /** The hillshade on the same cells, 0–1; NaN where the sheet has none. */
  shade: Float32Array
  /** Points along the labelled contours: column, row (fractions of a cell, cell centres at whole numbers) and height. */
  anchors: Float32Array
  /** The contour interval, metres: the refined ground stays within it of the contour surface. */
  intervalM: number
}

export interface ReliefResult {
  values: Float32Array
  lighting: HillshadeLighting
  /** Cells with ground, and how many of them the hillshade refined. */
  cells: number
  refinedCells: number
  /** How far the refined cells moved from the contour surface, metres: median and 99th percentile of the absolute change. */
  medianChangeM: number
  p99ChangeM: number
  /** Share of refined cells held at one interval from the contour surface, 0–1. */
  boundedShare: number
  /** How closely the result reproduces the hillshade, in grey levels of 255 (root mean square). */
  shadeResidualGrey: number
}

/** Three passes of a box mean, close to a Gaussian, over the cells that have a value. */
function smooth(values: Float32Array, width: number, height: number, radius: number): Float32Array {
  let a = Float64Array.from(values, (v) => (Number.isFinite(v) ? v : 0)),
    w = Float64Array.from(values, (v) => (Number.isFinite(v) ? 1 : 0))
  const pass = (src: Float64Array, horizontal: boolean) => {
    const out = new Float64Array(src.length)
    const lines = horizontal ? height : width,
      length = horizontal ? width : height,
      stride = horizontal ? 1 : width
    for (let line = 0; line < lines; line++) {
      const base = horizontal ? line * width : line
      let sum = 0
      for (let i = 0; i <= Math.min(radius, length - 1); i++) sum += src[base + i * stride]
      for (let i = 0; i < length; i++) {
        out[base + i * stride] = sum
        const add = i + radius + 1,
          drop = i - radius
        if (add < length) sum += src[base + add * stride]
        if (drop >= 0) sum -= src[base + drop * stride]
      }
    }
    return out
  }
  for (let k = 0; k < 3; k++) {
    a = pass(pass(a, true), false)
    w = pass(pass(w, true), false)
  }
  const full = (2 * radius + 1) ** 6
  const out = new Float32Array(values.length)
  for (let i = 0; i < out.length; i++) out[i] = w[i] > 0.3 * full ? a[i] / w[i] : NaN
  return out
}

/**
 * Reads the sun from the hillshade and the contour surface together, and refuses a picture that is
 * not a plain hillshade. Over ground the contours give a slope for, shade × √(1 + slope²) is linear
 * in the two slopes: its constant is the sine of the sun's height and its slope terms point at the
 * sun. A stretched, gamma-corrected or many-sun rendering breaks that relation, and is refused.
 */
export function fitHillshadeLighting(
  prior: Float32Array,
  shade: Float32Array,
  width: number,
  height: number,
  cellM: number,
): HillshadeLighting {
  // Both smoothed alike: the contours hold only the long shapes, so the comparison is of those.
  const z = smooth(prior, width, height, RELIEF.fitSmoothingCells),
    light = smooth(shade, width, height, RELIEF.fitSmoothingCells)
  // Normal equations of y = a + b p + c q.
  let n = 0,
    sp = 0,
    sq = 0,
    sy = 0,
    spp = 0,
    spq = 0,
    sqq = 0,
    spy = 0,
    sqy = 0,
    syy = 0
  const flat = new Uint32Array(256)
  let flatCells = 0
  for (let row = 1; row < height - 1; row++)
    for (let col = 1; col < width - 1; col++) {
      const i = row * width + col,
        I = light[i]
      if (!(I > RELIEF.dimShade && I < 0.97)) continue
      const p = (z[i + 1] - z[i - 1]) / (2 * cellM),
        q = (z[i - width] - z[i + width]) / (2 * cellM)
      if (!Number.isFinite(p) || !Number.isFinite(q)) continue
      const m = Math.hypot(p, q)
      // Level ground is read from the picture's own pixels: smoothing mixes in the slopes beside it.
      if (m < RELIEF.flatSlope && Number.isFinite(shade[i])) {
        flat[Math.min(255, Math.round(shade[i] * 255))]++
        flatCells++
      }
      if (m < 0.05 || m > 0.9) continue
      const y = I * Math.sqrt(1 + m * m)
      n++
      sp += p
      sq += q
      sy += y
      spp += p * p
      spq += p * q
      sqq += q * q
      spy += p * y
      sqy += q * y
      syy += y * y
    }
  if (n < 1000) throw Error('too little of the hillshade lies over ground the contours give a slope for')
  // Centred 2 × 2 solve.
  const mp = sp / n,
    mq = sq / n,
    my = sy / n
  const cpp = spp / n - mp * mp,
    cqq = sqq / n - mq * mq,
    cpq = spq / n - mp * mq,
    cpy = spy / n - mp * my,
    cqy = sqy / n - mq * my,
    cyy = syy / n - my * my
  const det = cpp * cqq - cpq * cpq
  if (!(det > 1e-12) || !(cyy > 1e-12))
    throw Error('the ground under the hillshade is too uniform to read the sun from')
  const b = (cpy * cqq - cqy * cpq) / det,
    c = (cqy * cpp - cpy * cpq) / det,
    a = my - b * mp - c * mq
  const correlation = Math.sqrt(Math.max(0, (b * cpy + c * cqy) / cyy))
  let flatGrey = NaN
  if (flatCells >= RELIEF.minFlatCells) {
    let seen = 0
    for (let g = 0; g < 256; g++) {
      seen += flat[g]
      if (seen * 2 >= flatCells) {
        flatGrey = g
        break
      }
    }
  }
  // Level ground reads sin(altitude) exactly; the regression's constant is the fallback.
  const sinAltitude = Number.isFinite(flatGrey) ? flatGrey / 255 : a
  const altitudeDeg = (Math.asin(Math.min(1, Math.max(0, sinAltitude))) * 180) / Math.PI
  const strength = Math.hypot(b, c)
  if (correlation < RELIEF.minFitCorrelation)
    throw Error(
      `it does not follow the contours' own shading (correlation ${correlation.toFixed(2)}): it may be another surface, or lit from several directions`,
    )
  if (!(altitudeDeg >= RELIEF.altitudeRange[0] && altitudeDeg <= RELIEF.altitudeRange[1]))
    throw Error(`level ground reads ${Math.round(sinAltitude * 255)} of 255, outside a plain hillshade's range`)
  const expected = Math.cos((altitudeDeg * Math.PI) / 180)
  if (
    strength > expected + RELIEF.strengthAbove ||
    strength < expected - RELIEF.strengthBelow ||
    Math.abs(a - sinAltitude) > 0.08
  )
    throw Error('its greys are stretched or gamma-corrected, so they cannot be read as slopes')
  return {
    azimuthDeg: ((Math.atan2(-b, -c) * 180) / Math.PI + 360) % 360,
    altitudeDeg,
    flatGrey: Number.isFinite(flatGrey) ? flatGrey : Math.round(sinAltitude * 255),
    correlation,
  }
}

/** A grid at `factor` times the cell size: the mean of each block's cells, NaN where under half have a value. */
function coarsen(values: Float32Array, width: number, height: number, factor: number) {
  const w = Math.ceil(width / factor),
    h = Math.ceil(height / factor)
  const out = new Float32Array(w * h)
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      let sum = 0,
        count = 0,
        cells = 0
      for (let y = r * factor; y < Math.min(height, (r + 1) * factor); y++)
        for (let x = c * factor; x < Math.min(width, (c + 1) * factor); x++) {
          cells++
          const v = values[y * width + x]
          if (Number.isFinite(v)) {
            sum += v
            count++
          }
        }
      out[r * w + c] = count * 2 >= cells ? sum / count : NaN
    }
  return { values: out, width: w, height: h }
}

/** A coarse level's change carried to a finer grid by bilinear weights; 0 where the coarse level had no ground. */
function carryChange(
  change: Float64Array,
  from: { width: number; height: number; factor: number },
  to: { width: number; height: number; factor: number },
): Float64Array {
  const out = new Float64Array(to.width * to.height)
  const ratio = to.factor / from.factor
  for (let r = 0; r < to.height; r++) {
    // Cell centres: fine (r + 0.5) × fine cell = coarse (fr + 0.5) × coarse cell.
    const fr = Math.min(from.height - 1, Math.max(0, (r + 0.5) * ratio - 0.5)),
      r0 = Math.min(from.height - 2 < 0 ? 0 : from.height - 2, Math.floor(fr)),
      ty = from.height > 1 ? fr - r0 : 0
    for (let c = 0; c < to.width; c++) {
      const fc = Math.min(from.width - 1, Math.max(0, (c + 0.5) * ratio - 0.5)),
        c0 = Math.min(from.width - 2 < 0 ? 0 : from.width - 2, Math.floor(fc)),
        tx = from.width > 1 ? fc - c0 : 0
      const r1 = Math.min(from.height - 1, r0 + 1),
        c1 = Math.min(from.width - 1, c0 + 1)
      out[r * to.width + c] =
        change[r0 * from.width + c0] * (1 - tx) * (1 - ty) +
        change[r0 * from.width + c1] * tx * (1 - ty) +
        change[r1 * from.width + c0] * (1 - tx) * ty +
        change[r1 * from.width + c1] * tx * ty
    }
  }
  return out
}

interface Level {
  width: number
  height: number
  cellM: number
  /** Unknown number of each cell, −1 where there is no ground. */
  index: Int32Array
  unknowns: number
  prior: Float64Array
  /** Interior cells (all four neighbours have ground): the unknowns of the cell and its neighbours. */
  centre: Int32Array
  east: Int32Array
  west: Int32Array
  north: Int32Array
  south: Int32Array
  shade: Float32Array
  shadeWeight: Float32Array
  /** Four unknowns and weights a contour point, and its height. */
  anchorCells: Int32Array
  anchorWeights: Float32Array
  anchorHeights: Float32Array
}

function buildLevel(input: ReliefInput, factor: number): Level & { priorGrid: Float32Array; factor: number } {
  const grid =
    factor === 1
      ? { values: input.prior, width: input.width, height: input.height }
      : coarsen(input.prior, input.width, input.height, factor)
  const shadeGrid = factor === 1 ? { values: input.shade } : coarsen(input.shade, input.width, input.height, factor)
  const { width, height } = grid
  const index = new Int32Array(width * height).fill(-1)
  let unknowns = 0
  for (let i = 0; i < index.length; i++) if (Number.isFinite(grid.values[i])) index[i] = unknowns++
  const prior = new Float64Array(unknowns)
  for (let i = 0; i < index.length; i++) if (index[i] >= 0) prior[index[i]] = grid.values[i]
  const centre: number[] = [],
    east: number[] = [],
    west: number[] = [],
    north: number[] = [],
    south: number[] = [],
    shade: number[] = [],
    weight: number[] = []
  for (let row = 1; row < height - 1; row++)
    for (let col = 1; col < width - 1; col++) {
      const i = row * width + col
      if (index[i] < 0 || index[i + 1] < 0 || index[i - 1] < 0 || index[i - width] < 0 || index[i + width] < 0) continue
      centre.push(index[i])
      east.push(index[i + 1])
      west.push(index[i - 1])
      north.push(index[i - width])
      south.push(index[i + width])
      const I = shadeGrid.values[i]
      shade.push(Number.isFinite(I) ? I : 0)
      weight.push(
        Number.isFinite(I) ? (I < RELIEF.dimShade || I > RELIEF.brightShade ? 0.2 : 1) * RELIEF.shadeWeight : 0,
      )
    }
  const cells: number[] = [],
    weights: number[] = [],
    heights: number[] = []
  for (let k = 0; k < input.anchors.length; k += 3) {
    // Cell centres sit at whole numbers on the fine grid: (col + 0.5) / factor − 0.5 on this one.
    const fc = (input.anchors[k] + 0.5) / factor - 0.5,
      fr = (input.anchors[k + 1] + 0.5) / factor - 0.5
    const c0 = Math.floor(fc),
      r0 = Math.floor(fr)
    if (c0 < 0 || r0 < 0 || c0 >= width - 1 || r0 >= height - 1) continue
    const a = index[r0 * width + c0],
      b = index[r0 * width + c0 + 1],
      c = index[(r0 + 1) * width + c0],
      d = index[(r0 + 1) * width + c0 + 1]
    if (a < 0 || b < 0 || c < 0 || d < 0) continue
    const tx = fc - c0,
      ty = fr - r0
    cells.push(a, b, c, d)
    weights.push((1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty)
    heights.push(input.anchors[k + 2])
  }
  return {
    width,
    height,
    factor,
    cellM: input.cellM * factor,
    index,
    unknowns,
    prior,
    priorGrid: grid.values,
    centre: Int32Array.from(centre),
    east: Int32Array.from(east),
    west: Int32Array.from(west),
    north: Int32Array.from(north),
    south: Int32Array.from(south),
    shade: Float32Array.from(shade),
    shadeWeight: Float32Array.from(weight),
    anchorCells: Int32Array.from(cells),
    anchorWeights: Float32Array.from(weights),
    anchorHeights: Float32Array.from(heights),
  }
}

/**
 * One level, to convergence or its step limit. `z` holds the unknowns and is changed in place;
 * yields after every block of LSQR iterations so a caller can report progress and stop.
 */
function* solveLevel(
  level: Level,
  z: Float64Array,
  lighting: HillshadeLighting,
  steps: number,
  iterations: number,
): Generator<number, number> {
  const { centre, east, west, north, south, shade, shadeWeight, anchorCells, anchorWeights, anchorHeights } = level
  const k = centre.length,
    ka = anchorHeights.length,
    n = level.unknowns,
    h = level.cellM
  const zenith = ((90 - lighting.altitudeDeg) * Math.PI) / 180,
    azimuth = (lighting.azimuthDeg * Math.PI) / 180
  const cosZ = Math.cos(zenith),
    sinZ = Math.sin(zenith),
    sx = Math.sin(azimuth),
    sy = Math.cos(azimuth)
  const wl = RELIEF.smoothWeight / h,
    wa = RELIEF.anchorWeight,
    wp = RELIEF.priorWeight
  // Rows: shading (k), contour points (ka), curvature (k), contour surface (n).
  const rows = k + ka + k + n
  const gp = new Float64Array(k),
    gq = new Float64Array(k)
  const rhs = new Float64Array(rows),
    u = new Float64Array(rows),
    v = new Float64Array(n),
    w = new Float64Array(n),
    step = new Float64Array(n),
    scratch = new Float64Array(rows),
    scratchN = new Float64Array(n)
  /** out = M x */
  const forward = (x: Float64Array, out: Float64Array) => {
    for (let i = 0; i < k; i++) {
      const e = x[east[i]],
        wv = x[west[i]],
        no = x[north[i]],
        so = x[south[i]]
      out[i] = gp[i] * (e - wv) + gq[i] * (no - so)
      out[k + ka + i] = wl * (e + wv + no + so - 4 * x[centre[i]])
    }
    for (let j = 0; j < ka; j++) {
      const o = j * 4
      out[k + j] =
        wa *
        (anchorWeights[o] * x[anchorCells[o]] +
          anchorWeights[o + 1] * x[anchorCells[o + 1]] +
          anchorWeights[o + 2] * x[anchorCells[o + 2]] +
          anchorWeights[o + 3] * x[anchorCells[o + 3]])
    }
    const base = k + ka + k
    for (let i = 0; i < n; i++) out[base + i] = wp * x[i]
  }
  /** out = Mᵀ y */
  const transpose = (y: Float64Array, out: Float64Array) => {
    const base = k + ka + k
    for (let i = 0; i < n; i++) out[i] = wp * y[base + i]
    for (let i = 0; i < k; i++) {
      const a = gp[i] * y[i],
        b = gq[i] * y[i],
        l = wl * y[k + ka + i]
      out[east[i]] += a + l
      out[west[i]] += l - a
      out[north[i]] += b + l
      out[south[i]] += l - b
      out[centre[i]] -= 4 * l
    }
    for (let j = 0; j < ka; j++) {
      const o = j * 4,
        value = wa * y[k + j]
      out[anchorCells[o]] += anchorWeights[o] * value
      out[anchorCells[o + 1]] += anchorWeights[o + 1] * value
      out[anchorCells[o + 2]] += anchorWeights[o + 2] * value
      out[anchorCells[o + 3]] += anchorWeights[o + 3] * value
    }
  }
  const norm = (a: Float64Array) => {
    let sum = 0
    for (let i = 0; i < a.length; i++) sum += a[i] * a[i]
    return Math.sqrt(sum)
  }
  let residualGrey = 0
  for (let outer = 0; outer < steps; outer++) {
    // Linearize the shading about the surface as it stands.
    let shadeSquares = 0,
      shadeRows = 0
    for (let i = 0; i < k; i++) {
      const p = (z[east[i]] - z[west[i]]) / (2 * h),
        q = (z[north[i]] - z[south[i]]) / (2 * h)
      const length2 = 1 + p * p + q * q,
        length = Math.sqrt(length2),
        lit = cosZ - sinZ * (p * sx + q * sy)
      const I = lit / length
      const ws = shadeWeight[i]
      gp[i] = (ws * (-sinZ * sx * length2 - lit * p)) / (length2 * length) / (2 * h)
      gq[i] = (ws * (-sinZ * sy * length2 - lit * q)) / (length2 * length) / (2 * h)
      const miss = I - shade[i]
      rhs[i] = -ws * miss
      if (ws > 0) {
        shadeSquares += miss * miss
        shadeRows++
      }
      rhs[k + ka + i] = -wl * (z[east[i]] + z[west[i]] + z[north[i]] + z[south[i]] - 4 * z[centre[i]])
    }
    residualGrey = shadeRows ? Math.sqrt(shadeSquares / shadeRows) * 255 : 0
    for (let j = 0; j < ka; j++) {
      const o = j * 4
      rhs[k + j] =
        -wa *
        (anchorWeights[o] * z[anchorCells[o]] +
          anchorWeights[o + 1] * z[anchorCells[o + 1]] +
          anchorWeights[o + 2] * z[anchorCells[o + 2]] +
          anchorWeights[o + 3] * z[anchorCells[o + 3]] -
          anchorHeights[j])
    }
    const base = k + ka + k
    for (let i = 0; i < n; i++) rhs[base + i] = -wp * (z[i] - level.prior[i])
    // LSQR with damping.
    u.set(rhs)
    let beta = norm(u)
    if (!(beta > 0)) break
    for (let i = 0; i < rows; i++) u[i] /= beta
    transpose(u, v)
    let alpha = norm(v)
    if (!(alpha > 0)) break
    for (let i = 0; i < n; i++) v[i] /= alpha
    w.set(v)
    step.fill(0)
    let phiBar = beta,
      rhoBar = alpha
    const first = alpha * beta
    for (let inner = 0; inner < iterations; inner++) {
      forward(v, scratch)
      for (let i = 0; i < rows; i++) u[i] = scratch[i] - alpha * u[i]
      beta = norm(u)
      if (beta > 0) for (let i = 0; i < rows; i++) u[i] /= beta
      transpose(u, scratchN)
      for (let i = 0; i < n; i++) v[i] = scratchN[i] - beta * v[i]
      alpha = norm(v)
      if (alpha > 0) for (let i = 0; i < n; i++) v[i] /= alpha
      const rhoBar1 = Math.hypot(rhoBar, RELIEF.damping),
        c1 = rhoBar / rhoBar1
      phiBar = c1 * phiBar
      const rho = Math.hypot(rhoBar1, beta),
        cs = rhoBar1 / rho,
        sn = beta / rho,
        theta = sn * alpha
      rhoBar = -cs * alpha
      const phi = cs * phiBar
      phiBar = sn * phiBar
      const t1 = phi / rho,
        t2 = -theta / rho
      for (let i = 0; i < n; i++) {
        step[i] += t1 * w[i]
        w[i] = v[i] + t2 * w[i]
      }
      if ((inner + 1) % 20 === 0) yield (outer + (inner + 1) / iterations) / steps
      // The gradient of the damped problem has fallen far enough.
      if (Math.abs(phiBar * alpha * cs) < 1e-4 * first) break
    }
    let largest = 0
    for (let i = 0; i < n; i++) {
      z[i] += step[i]
      const moved = Math.abs(step[i])
      if (moved > largest) largest = moved
    }
    yield (outer + 1) / steps
    if (largest < RELIEF.settledM) break
  }
  return residualGrey
}

/** How many cells each cell is from the nearest one without shade, up to `limit`. */
function depthIntoShade(shade: Float32Array, width: number, height: number, limit: number): Uint8Array {
  const depth = new Uint8Array(width * height)
  for (let i = 0; i < depth.length; i++) depth[i] = Number.isFinite(shade[i]) ? limit : 0
  // Two chamfer passes, city-block distance: enough for a fade.
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const i = row * width + col
      if (!depth[i]) continue
      const up = row ? depth[i - width] : 0,
        left = col ? depth[i - 1] : 0
      depth[i] = Math.min(depth[i], Math.min(up, left) + 1)
    }
  for (let row = height - 1; row >= 0; row--)
    for (let col = width - 1; col >= 0; col--) {
      const i = row * width + col
      if (!depth[i]) continue
      const down = row < height - 1 ? depth[i + width] : 0,
        right = col < width - 1 ? depth[i + 1] : 0
      depth[i] = Math.min(depth[i], Math.min(down, right) + 1)
    }
  return depth
}

/**
 * The contour surface with the ground between its contours read from the hillshade. A generator:
 * it yields its progress (0–1) so a caller can report it and stop; the result is the surface, the
 * sun it read, and how far the ground moved. Throws when the picture is not a plain hillshade.
 */
export function* refineWithHillshade(input: ReliefInput): Generator<number, ReliefResult> {
  const { width, height } = input
  if (input.prior.length !== width * height || input.shade.length !== width * height)
    throw Error('The contour surface and the hillshade are on different grids.')
  if (!(input.intervalM > 0)) throw Error('The contour interval is not known.')
  if (input.anchors.length < 9) throw Error('The contour surface carries no contour points to hold the heights.')
  const lighting = fitHillshadeLighting(input.prior, input.shade, width, height, input.cellM)
  yield 0.02
  const work = RELIEF.levels.map((factor) => {
    // A level too coarse to hold interior cells is skipped.
    return Math.min(width, height) / factor >= 8 || factor === 1 ? factor : 0
  })
  let previous: { level: ReturnType<typeof buildLevel>; z: Float64Array } | null = null
  let residualGrey = 0
  const share = [0.1, 0.25, 0.65]
  let done = 0.02
  for (const [at, factor] of work.entries()) {
    const portion = share[at] * 0.96
    if (!factor) {
      done += portion
      continue
    }
    const level = buildLevel(input, factor)
    const z = Float64Array.from(level.prior)
    if (previous) {
      // The coarser level's change, carried down as the start.
      const from = previous.level
      const change = new Float64Array(from.width * from.height)
      for (let i = 0; i < from.index.length; i++)
        if (from.index[i] >= 0) change[i] = previous.z[from.index[i]] - from.prior[from.index[i]]
      const carried = carryChange(change, from, level)
      for (let i = 0; i < level.index.length; i++) if (level.index[i] >= 0) z[level.index[i]] += carried[i]
    }
    const steps = solveLevel(level, z, lighting, RELIEF.steps[at], RELIEF.iterations[at])
    let next = steps.next()
    while (!next.done) {
      yield done + portion * next.value
      next = steps.next()
    }
    residualGrey = next.value
    done += portion
    previous = { level, z }
  }
  const { level, z } = previous!
  const depth = depthIntoShade(input.shade, width, height, RELIEF.taperCells)
  const values = new Float32Array(width * height).fill(NaN)
  const changes: number[] = []
  let cells = 0,
    refinedCells = 0,
    bounded = 0
  for (let i = 0; i < values.length; i++) {
    const unknown = level.index[i]
    if (unknown < 0) continue
    cells++
    const prior = input.prior[i]
    if (!depth[i]) {
      values[i] = prior
      continue
    }
    // Fade in from the hillshade's edge, and never further than one interval from the contour surface.
    let change = (z[unknown] - prior) * (depth[i] / RELIEF.taperCells)
    if (Math.abs(change) > input.intervalM) {
      change = Math.sign(change) * input.intervalM
      bounded++
    }
    values[i] = prior + change
    refinedCells++
    if (refinedCells % 7 === 0) changes.push(Math.abs(change))
  }
  changes.sort((a, b) => a - b)
  const at = (f: number) => (changes.length ? changes[Math.min(changes.length - 1, Math.floor(f * changes.length))] : 0)
  return {
    values,
    lighting,
    cells,
    refinedCells,
    medianChangeM: at(0.5),
    p99ChangeM: at(0.99),
    boundedShare: refinedCells ? bounded / refinedCells : 0,
    shadeResidualGrey: residualGrey,
  }
}

/** `refineWithHillshade` run to its end, for tests and scripts. */
export function refineWithHillshadeNow(input: ReliefInput): ReliefResult {
  const steps = refineWithHillshade(input)
  let next = steps.next()
  while (!next.done) next = steps.next()
  return next.value
}

/**
 * A hillshade image layer on a contour surface's cells: each cell the mean grey of the sheet's
 * pixels under it, 0–1, NaN where no tile covers it. `pixels` are the layer's decoded tiles in
 * `mosaic.tiles` order, one grey byte or four RGBA bytes a pixel, null for one that did not decode.
 * Throws when the two sheets are in different projections.
 */
export function hillshadeOnGrid(
  mosaic: PdfImageMosaic,
  pixels: readonly (ArrayLike<number> | null)[],
  grid: {
    epsg: number
    origin: readonly [number, number] | readonly number[]
    cellM: number
    width: number
    height: number
  },
): Float32Array {
  if (projectedEpsg(mosaic.wkt) !== grid.epsg)
    throw Error('The hillshade sheet and the contour sheet are in different projections.')
  // The whole picture as one grey plane, 0 where no tile decoded, with what is covered beside it.
  const grey = new Uint8Array(mosaic.width * mosaic.height),
    covered = new Uint8Array(mosaic.width * mosaic.height)
  mosaic.tiles.forEach((tile, t) => {
    const data = pixels[t]
    if (!data) return
    const colour = data.length !== tile.width * tile.height
    for (let row = 0; row < tile.height; row++) {
      const to = (tile.row + row) * mosaic.width + tile.col,
        from = row * tile.width
      for (let col = 0; col < tile.width; col++) {
        const i = from + col
        grey[to + col] = colour
          ? Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2])
          : data[i]
        covered[to + col] = 1
      }
    }
  })
  const inverse = invertMatrix(mosaic.transform)
  const pixelM = Math.sqrt(
    Math.abs(mosaic.transform[0] * mosaic.transform[3] - mosaic.transform[1] * mosaic.transform[2]),
  )
  const reach = Math.max(0.5, grid.cellM / (2 * pixelM))
  const out = new Float32Array(grid.width * grid.height).fill(NaN)
  for (let row = 0; row < grid.height; row++)
    for (let col = 0; col < grid.width; col++) {
      // Pixel centres sit at half-pixels: the pixel under a point is the floor of its pixel coordinate.
      const [px, py] = applyMatrix(inverse, [grid.origin[0] + col * grid.cellM, grid.origin[1] - row * grid.cellM])
      // Pixel k spans k to k + 1: the footprint a to b takes pixels floor(a) to ceil(b) − 1.
      const c0 = Math.floor(px - reach),
        c1 = Math.ceil(px + reach) - 1,
        r0 = Math.floor(py - reach),
        r1 = Math.ceil(py + reach) - 1
      if (c0 < 0 || r0 < 0 || c1 >= mosaic.width || r1 >= mosaic.height) continue
      let sum = 0,
        count = 0
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          if (!covered[r * mosaic.width + c]) continue
          sum += grey[r * mosaic.width + c]
          count++
        }
      if (count === (c1 - c0 + 1) * (r1 - r0 + 1)) out[row * grid.width + col] = sum / count / 255
    }
  return out
}
