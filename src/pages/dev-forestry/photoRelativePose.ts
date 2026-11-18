/** Calibrated two-view orientation when the shared features cannot be located reliably on the terrain. */
import { determinant, Matrix, SingularValueDecomposition, solve } from 'ml-matrix'
import { linearEpipolar, type Coefficients } from './photoFeatureGeometry'
import type { ImageMatch, OverlapCamera } from './photoOverlap'
import { cameraAxes, localOffset, normalizeBearing, rotationMatrix } from './photoPose'

type Vec = [number, number, number]
type Rotation = [Vec, Vec, Vec]
type Rays = { a: Vec; b: Vec; region: number }
type Motion = { rotation: Rotation; shift: Vec }
export type RelativePose = { pose: OverlapCamera; medianPx: number; p90Px: number; controls: number }

const RAD = Math.PI / 180
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = ([x, y, z]: Vec, [u, v, w]: Vec): Vec => [y * w - z * v, z * u - x * w, x * v - y * u]
const unit = (v: Vec) => v.map((value) => value / Math.hypot(...v)) as Vec
const transpose = (m: Rotation) => m.map((_, i) => m.map((row) => row[i])) as Rotation
const apply = (m: Rotation, v: Vec) => m.map((row) => dot(row, v)) as Vec
const multiply = (a: Rotation, b: Rotation) => transpose(transpose(b).map((column) => apply(a, column)) as Rotation)
const angle = (a: Vec, b: Vec) => Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b))))) / RAD
const axes = (pose: OverlapCamera): Rotation => {
  const { right, down, forward } = cameraAxes(pose)
  return [right, down, forward]
}

function calibrate(pose: OverlapCamera, [x, y]: ImageMatch[number]): Vec {
  return [(x - pose.width / 2) / pose.focalPx, (y - pose.height / 2) / pose.focalPx, 1]
}

function signedResidual({ a, b }: Rays, { rotation, shift }: Motion): number {
  const ea = cross(shift, apply(rotation, a))
  const etb = apply(transpose(rotation), cross(b, shift))
  const denominator = Math.hypot(ea[0], ea[1], etb[0], etb[1])
  return denominator > 1e-8 ? dot(b, ea) / denominator : 1
}

function positiveDepth({ a, b }: Rays, { rotation, shift }: Motion): boolean {
  const u = apply(rotation, a)
  const uu = dot(u, u)
  const vv = dot(b, b)
  const uv = dot(u, b)
  const det = uu * vv - uv ** 2
  if (det / (uu * vv) < 0.00002) return false
  const rhsA = -dot(u, shift)
  const rhsB = dot(b, shift)
  return rhsA * vv + uv * rhsB > 0 && uu * rhsB + uv * rhsA > 0
}

function perturb(motion: Motion, step: number[], baseline: Vec | null): Motion {
  const rotation = multiply(rotationMatrix([step[0], step[1], step[2]]), motion.rotation)
  if (baseline) return { rotation, shift: apply(rotation, baseline) }

  const t = motion.shift
  const u = unit(cross(t, Math.abs(t[2]) > 0.8 ? [0, 1, 0] : [0, 0, 1]))
  const v = cross(t, u)
  const shift = unit(t.map((value, i) => value + step[3] * u[i] + step[4] * v[i]) as Vec)
  return { rotation, shift }
}

function improveMotion(initial: Motion, rays: Rays[], scale: number, baseline: Vec | null): Motion {
  let motion = baseline ? { rotation: initial.rotation, shift: apply(initial.rotation, baseline) } : initial
  const cutoff = 4 / scale
  const eps = 0.00001
  const dof = baseline ? 3 : 5
  const cost = (errors: number[]) =>
    errors.reduce((sum, error) => {
      const abs = Math.abs(error)
      return sum + (abs <= cutoff ? abs ** 2 : cutoff * (2 * abs - cutoff))
    }, 0)
  let errors = rays.map((ray) => signedResidual(ray, motion))
  let loss = cost(errors)
  let damping = 0.001
  for (let iteration = 0; iteration < 30; iteration++) {
    const shifts = Array.from({ length: dof }, (_, index) =>
      perturb(
        motion,
        Array.from({ length: dof }, (_, j) => (index === j ? eps : 0)),
        baseline,
      ),
    )
    const normal = Matrix.zeros(dof, dof)
    const rhs = Matrix.zeros(dof, 1)
    for (const [i, ray] of rays.entries()) {
      const error = errors[i]
      const weight = Math.min(1, cutoff / Math.max(Math.abs(error), 1e-9))
      const deriv = shifts.map((next) => (signedResidual(ray, next) - error) / eps)
      for (let j = 0; j < dof; j++) {
        rhs.set(j, 0, rhs.get(j, 0) - weight * deriv[j] * error)
        for (let k = 0; k <= j; k++) normal.set(j, k, normal.get(j, k) + weight * deriv[j] * deriv[k])
      }
    }
    for (let j = 0; j < dof; j++) {
      normal.set(j, j, normal.get(j, j) + damping)
      for (let k = 0; k < j; k++) normal.set(k, j, normal.get(j, k))
    }
    const step = solve(normal, rhs).getColumn(0)
    if (Math.hypot(...step) < 1e-6) break
    const next = perturb(motion, step, baseline)
    const residuals = rays.map((ray) => signedResidual(ray, next))
    const candidateLoss = cost(residuals)
    if (candidateLoss < loss) {
      motion = next
      errors = residuals
      loss = candidateLoss
      damping *= 0.4
    } else damping *= 4
  }
  return motion
}

function linearMotion(rays: Rays[], rows: Coefficients[], count: number): Motion | null {
  const essential = linearEpipolar(
    rows,
    Array.from({ length: count }, (_, i) => i),
    false,
  )
  if (!essential) return null
  const { leftSingularVectors: u, rightSingularVectors: v } = new SingularValueDecomposition(
    Matrix.from1DArray(3, 3, essential),
  )
  const w = new Matrix([
    [0, -1, 0],
    [1, 0, 0],
    [0, 0, 1],
  ])
  const motions = [w, w.transpose()].flatMap((factor) => {
    const r = u.mmul(factor).mmul(v.transpose())
    const rotation = r.mul(determinant(r) < 0 ? -1 : 1).to2DArray() as Rotation
    const shift = u.getColumn(2) as Vec
    return [
      { rotation, shift },
      { rotation, shift: shift.map((value) => -value) as Vec },
    ]
  })
  const ranked = motions.map((motion) => ({ motion, count: rays.filter((ray) => positiveDepth(ray, motion)).length }))
  const best = ranked.sort((a, b) => b.count - a.count)[0]
  return best.count >= rays.length * 0.4 ? best.motion : null
}

function estimateMotion(rays: Rays[], baseline: Vec, scale: number): Motion | null {
  const rows = rays.map(({ a: [x, y], b: [u, v] }): Coefficients => [u * x, u * y, u, v * x, v * y, v, x, y, 1])
  let best: { motion: Motion; score: number } | null = null
  const distance = Math.hypot(...baseline)
  // The target-camera translation is the negative of its displacement in the reference frame, rotated into view.
  const displacement = distance >= 60 ? (unit(baseline).map((value) => -value) as Vec) : null
  // Try the full consensus and its highest-confidence subsets, using training points only.
  const counts = new Set([rays.length, Math.max(20, Math.round(rays.length * 0.5)), Math.min(32, rays.length)])
  for (const count of counts) {
    const start = linearMotion(rays, rows, count)
    if (!start) continue
    for (const fixed of [null, ...(displacement ? [displacement] : [])]) {
      const fitted = improveMotion(start, rays, scale, fixed)
      const front = rays.filter((ray) => positiveDepth(ray, fitted)).length
      const motion = front >= rays.length / 2 ? fitted : { ...fitted, shift: fitted.shift.map((v) => -v) as Vec }
      const visible = Math.max(front, rays.filter((ray) => positiveDepth(ray, motion)).length)
      if (visible < rays.length * 0.58) continue
      const direction = apply(transpose(motion.rotation), motion.shift).map((value) => -value) as Vec
      if (distance >= 60 && angle(direction, baseline) > 65) continue
      const errors = rays.map((ray) => Math.abs(signedResidual(ray, motion)) * scale)
      const clippedError = errors.reduce((sum, error) => sum + Math.min(error, 18), 0) / errors.length
      const score = clippedError + 2 * (1 - visible / rays.length)
      if (!best || score < best.score) best = { motion, score }
    }
  }
  return best?.motion ?? null
}

function quantile(values: number[], q: number) {
  return values.sort((a, b) => a - b)[Math.ceil(q * values.length) - 1]
}

function toCamera(reference: OverlapCamera, start: OverlapCamera, motion: Motion): OverlapCamera {
  const [right, , forward] = multiply(motion.rotation, axes(reference))
  const bearing = Math.atan2(forward[0], forward[1])
  const pitch = Math.asin(Math.max(-1, Math.min(1, forward[2]))) / RAD
  const flatRight: Vec = [Math.cos(bearing), -Math.sin(bearing), 0]
  const roll = Math.atan2(dot(right, cross(flatRight, forward)), dot(right, flatRight)) / RAD
  return { ...start, bearing: normalizeBearing(bearing / RAD), pitch, roll }
}

/** Fits orientation in camera coordinates, leaving out an entire region at a time. Target GPS/lens stay fixed. */
export function relativePhotoPose(
  reference: OverlapCamera,
  target: OverlapCamera,
  matches: readonly ImageMatch[],
): RelativePose | null {
  if (matches.length < 28) return null
  const midX = quantile(
    matches.map(([, [x]]) => x),
    0.5,
  )
  const midY = quantile(
    matches.map(([, [, y]]) => y),
    0.5,
  )
  const rays = matches.map(
    ([a, b]): Rays => ({
      a: calibrate(reference, a),
      b: calibrate(target, b),
      region: Number(b[0] >= midX) + 2 * Number(b[1] >= midY),
    }),
  )
  const baseline = apply(axes(reference), localOffset(reference, target.lng, target.lat, target.altitudeMeters))
  const scale = 1050 * Math.min(reference.focalPx / reference.width, target.focalPx / target.width)
  const motion = estimateMotion(rays, baseline, scale)
  if (!motion) return null
  const errors: number[] = []
  for (let region = 0; region < 4; region++) {
    const held = rays.filter((ray) => ray.region === region)
    if (held.length < 4) return null
    const fit = estimateMotion(
      rays.filter((ray) => ray.region !== region),
      baseline,
      scale,
    )
    if (!fit || motion.rotation.some((row, i) => angle(row, fit.rotation[i]) > 10)) return null
    for (const ray of held) errors.push(Math.abs(signedResidual(ray, fit)) * scale)
  }
  const medianPx = quantile(errors, 0.5)
  const p90Px = quantile(errors, 0.9)
  if (medianPx > 6 || p90Px > 20) return null
  return { pose: toCamera(reference, target, motion), controls: matches.length, medianPx, p90Px }
}
