/** Robust two-view epipolar consensus before matching pixels are used as terrain controls. */
import { EigenvalueDecomposition, Matrix, SingularValueDecomposition } from 'ml-matrix'
import type { ImageMatch } from './photoOverlap'

type Frame = { width: number; height: number }
export type FeatureOverlap = { matches: ImageMatch[]; reciprocal: number; hullShare: number }
export type Coefficients = [number, number, number, number, number, number, number, number, number]
type Point = ImageMatch[number]
const MIN_INLIERS = 22
const MIN_AREA = 0.045
const INLIER_ERROR = (2.5 / 1050) ** 2

function epipolarRows(matches: ImageMatch[], a: Frame, b: Frame) {
  return matches.map(([[u, v], [p, q]]): Coefficients => {
    const x = u / a.width - 0.5
    const y = (v - a.height / 2) / a.width
    const s = p / b.width - 0.5
    const t = (q - b.height / 2) / b.width
    return [s * x, s * y, s, t * x, t * y, t, x, y, 1]
  })
}

export function linearEpipolar(rows: Coefficients[], indices: number[], refine: boolean): Coefficients | null {
  const normal = Matrix.zeros(9, 9)
  for (const index of indices) {
    const row = rows[index]
    for (let i = 0; i < 9; i++) for (let j = 0; j <= i; j++) normal.set(i, j, normal.get(i, j) + row[i] * row[j])
  }
  for (let i = 0; i < 9; i++) for (let j = 0; j < i; j++) normal.set(j, i, normal.get(i, j))
  const { eigenvectorMatrix, realEigenvalues } = new EigenvalueDecomposition(normal, { assumeSymmetric: true })
  if (realEigenvalues[1] < 1e-12 || !Number.isFinite(realEigenvalues[0])) return null
  const vector = eigenvectorMatrix.getColumn(0) as Coefficients
  if (!refine) return vector
  // The normalized eight-point least-squares solution must have rank two.
  const svd = new SingularValueDecomposition(Matrix.from1DArray(3, 3, vector))
  return vector.map(
    (value, i) =>
      value -
      svd.diagonal[2] * svd.leftSingularVectors.get(Math.floor(i / 3), 2) * svd.rightSingularVectors.get(i % 3, 2),
  ) as Coefficients
}

/** A projective transform covers zooms and rotations with very little parallax. */
function homography(rows: Coefficients[], indices: number[]): Coefficients | null {
  const normal = Matrix.zeros(9, 9)
  for (const index of indices) {
    const [sx, sy, s, tx, ty, t, x, y] = rows[index]
    const first = [x, y, 1, 0, 0, 0, -sx, -sy, -s]
    const second = [0, 0, 0, x, y, 1, -tx, -ty, -t]
    for (let i = 0; i < 9; i++)
      for (let j = 0; j <= i; j++) normal.set(i, j, normal.get(i, j) + first[i] * first[j] + second[i] * second[j])
  }
  for (let i = 0; i < 9; i++) for (let j = 0; j < i; j++) normal.set(j, i, normal.get(i, j))
  const { eigenvectorMatrix, realEigenvalues } = new EigenvalueDecomposition(normal, { assumeSymmetric: true })
  return realEigenvalues[1] >= 1e-12 ? (eigenvectorMatrix.getColumn(0) as Coefficients) : null
}

function homographyError(row: Coefficients, h: Coefficients): number {
  const [, , s, , , t, x, y] = row
  const depth = h[6] * x + h[7] * y + h[8]
  if (Math.abs(depth) < 1e-8) return Infinity
  return ((h[0] * x + h[1] * y + h[2]) / depth - s) ** 2 + ((h[3] * x + h[4] * y + h[5]) / depth - t) ** 2
}

function modelError(row: Coefficients, f: Coefficients): number {
  const [, , s, , , t, x, y] = row
  const a = f[0] * x + f[1] * y + f[2]
  const b = f[3] * x + f[4] * y + f[5]
  const u = f[0] * s + f[3] * t + f[6]
  const v = f[1] * s + f[4] * t + f[7]
  const scale = a * a + b * b + u * u + v * v
  return scale > 1e-12 ? (s * a + t * b + f[6] * x + f[7] * y + f[8]) ** 2 / scale : Infinity
}

function hullArea(points: Point[]): number {
  const direction = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const half = (order: Point[]) => {
    const stack: Point[] = []
    for (const point of order) {
      while (stack.length >= 2 && direction(stack[stack.length - 2], stack[stack.length - 1], point) <= 0) stack.pop()
      stack.push(point)
    }
    return stack.slice(0, -1)
  }
  const hull = [...half(sorted), ...half(sorted.reverse())]
  let twice = 0
  for (let i = 0; i < hull.length; i++) {
    const [x, y] = hull[i]
    const [u, v] = hull[(i + 1) % hull.length]
    twice += x * v - y * u
  }
  return Math.abs(twice) / 2
}

export const overlapStrength = (overlap: FeatureOverlap) => overlap.matches.length * overlap.hullShare ** 0.35

/** Inputs are in each working image's pixels, strongest descriptor matches first. */
export function verifyFeatureOverlap(matches: ImageMatch[], a: Frame, b: Frame): FeatureOverlap {
  const empty = { matches: [], reciprocal: matches.length, hullShare: 0 }
  if (matches.length < MIN_INLIERS) return empty
  const rows = epipolarRows(matches, a, b)
  const minimum = Math.max(
    MIN_INLIERS,
    Math.min(Math.ceil(rows.length * 0.26), Math.max(65, Math.ceil(rows.length * 0.14))),
  )
  const robust = (projective: boolean) => {
    let random = 1337
    const draw = (limit: number) => {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0
      return Math.floor((random / 2 ** 32) * limit)
    }
    const model = projective ? homography : linearEpipolar
    const distance = projective ? homographyError : modelError
    const threshold = projective ? (3.5 / 1050) ** 2 : INLIER_ERROR
    const inliers = (fit: Coefficients) => {
      const found: number[] = []
      for (const [i, row] of rows.entries()) if (distance(row, fit) <= threshold) found.push(i)
      return found
    }
    let best: number[] = []
    let confirmed: number[] = []
    const trials = projective ? 560 : 1280
    for (let trial = 0; trial < trials; trial++) {
      const limit = Math.min(rows.length, 32 + Math.floor((rows.length * trial) / (trials * 0.7)))
      const sample = new Set<number>()
      while (sample.size < (projective ? 4 : 8)) sample.add(draw(limit))
      const fit = model(rows, [...sample], false)
      if (!fit) continue
      const found = inliers(fit)
      if (found.length <= best.length) continue
      best = found
      // Keep the best valid fit from any promising hypothesis. In a mostly planar scene,
      // refitting only the largest raw epipolar hypothesis can pick a degenerate matrix.
      if (found.length >= minimum) {
        const refined = model(rows, found, true)
        const valid = refined ? inliers(refined) : []
        if (valid.length > confirmed.length) confirmed = valid
      }
      if (confirmed.length >= rows.length * 0.7 && trial >= 90) break
    }
    if (confirmed.length < minimum) return empty
    const points = confirmed.map((index) => matches[index])
    const hullShare = Math.min(
      hullArea(points.map(([point]) => point)) / (a.width * a.height),
      hullArea(points.map(([, point]) => point)) / (b.width * b.height),
    )
    return hullShare >= MIN_AREA ? { matches: points, hullShare, reciprocal: matches.length } : empty
  }
  const epipolar = robust(false)
  const projective = robust(true)
  return overlapStrength(projective) > overlapStrength(epipolar) ? projective : epipolar
}
