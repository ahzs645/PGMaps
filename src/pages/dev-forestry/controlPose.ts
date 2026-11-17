/**
 * A photo's camera from points the reviewer pairs: a pixel in the photo and the same spot on the map. Heading then
 * comes from the ground the person recognised, not from the skyline, so it works on photos that look steeply down at
 * forest with one smooth ridge, where the skyline search is ambiguous.
 *
 * Provenance: written for PGMaps from published methods and PGMaps' own photo-matching bench (`solve.ts`). The
 * options follow a functional specification of the Pic2Map and QCALVIEW plugins written by a reviewer who read them
 * (route A, `docs/forestry-road-design/reference-repo-licensing-and-conversion.md`); their code was not opened here.
 * - Start: with the camera's position known (GPS, or picked), its rotation follows from two or more pairs in closed
 *   form: Horn, "Closed-form solution of absolute orientation using unit quaternions", JOSA A 4(4), 1987.
 * - Then Levenberg–Marquardt over east, north, height, heading, pitch, roll and field of view, each free, fixed, or
 *   held near a value within a tolerance (a prior), as in Produit et al., ISPRS Annals II-3, 2014.
 * - Each pair is then left out in turn and measured with the camera solved without it: the accuracy to report.
 *
 * Free of DOM and network access.
 */
import { cameraAxes, localOffset, projectToPhoto, type PhotoPose } from './photoPose'

const RAD = Math.PI / 180
type Vec3 = [number, number, number]

export interface ControlPair {
  id: string
  /** Pixel in the photo, in the frame of the pose solved for. */
  pixel: [number, number]
  lng: number
  lat: number
  /** Ground elevation at the map spot, metres above sea level. */
  elevation: number
}

export type Unknown = 'east' | 'north' | 'up' | 'heading' | 'pitch' | 'roll' | 'hfov'
export const UNKNOWNS: readonly Unknown[] = ['east', 'north', 'up', 'heading', 'pitch', 'roll', 'hfov']

/**
 * How one unknown is treated: solved freely, held at the starting value, or kept near `value` within `tolerance` (the
 * prior's standard deviation: metres for position, degrees otherwise). A heading prior from a flight track or a
 * landmark at ±30° is enough to separate skyline candidates 15° or more apart.
 */
export type UnknownSpec = { mode: 'free' } | { mode: 'fixed' } | { mode: 'prior'; value: number; tolerance: number }

export interface ControlSolveInput {
  /** The starting camera: position from GPS (or picked), lens from EXIF; its angles only start the search. */
  start: PhotoPose & { hfov: number }
  pairs: readonly ControlPair[]
  /** Per unknown; default: position near the start (±25 m across, ±30 m up), angles free, lens fixed. */
  unknowns?: Partial<Record<Unknown, UnknownSpec>>
  /** How exactly a person places a pixel, px: weights the pairs against the priors. */
  pixelSigma?: number
}

export interface PairResult {
  id: string
  /** Pixel distance between the clicked pixel and the map spot projected with the solved camera. */
  fittedPx: number
  /** The same with the camera solved without this pair; null when too few pairs remain to solve. */
  heldOutPx: number | null
  /** Metres across the view per pixel at this spot. */
  metresPerPx: number
}

export interface ControlSolveResult {
  pose: PhotoPose & { hfov: number }
  /** How the start was made. */
  start: 'closed-form' | 'given'
  /** Movement of the camera from its start, metres. */
  shift: { east: number; north: number; up: number }
  pairs: PairResult[]
  rmsPx: number
  /** Worst held-out error on the ground, metres; null without held-out results. */
  heldOutMetresMax: number | null
  /** Unknowns solved without a prior. */
  freeUnknowns: number
}

const DEFAULTS: Record<Unknown, UnknownSpec> = {
  east: { mode: 'prior', value: 0, tolerance: 25 },
  north: { mode: 'prior', value: 0, tolerance: 25 },
  up: { mode: 'prior', value: 0, tolerance: 30 },
  heading: { mode: 'free' },
  pitch: { mode: 'free' },
  roll: { mode: 'free' },
  hfov: { mode: 'fixed' },
}
const STEPS = [1, 1, 1, 0.01, 0.01, 0.01, 0.01]
const METRES_PER_DEGREE_LAT = 110574
const metresPerDegreeLng = (lat: number) => 111320 * Math.cos(lat * RAD)
const wrap180 = (d: number) => ((d + 540) % 360) - 180

/** Fewest pairs for the unknowns solved without a prior: two equations per pair, and at least two pairs. */
export function pairsNeeded(unknowns?: Partial<Record<Unknown, UnknownSpec>>): number {
  const spec = { ...DEFAULTS, ...unknowns }
  const free = UNKNOWNS.filter((u) => spec[u].mode === 'free').length
  return Math.max(2, Math.ceil(free / 2))
}

function poseFrom(start: ControlSolveInput['start'], p: readonly number[]): PhotoPose & { hfov: number } {
  const hfov = p[6]
  return {
    ...start,
    lng: start.lng + p[0] / metresPerDegreeLng(start.lat),
    lat: start.lat + p[1] / METRES_PER_DEGREE_LAT,
    altitudeMeters: start.altitudeMeters + p[2],
    bearing: ((p[3] % 360) + 360) % 360,
    pitch: p[4],
    roll: p[5],
    hfov,
    focalPx: start.width / 2 / Math.tan((hfov * RAD) / 2),
  }
}

/** Largest-eigenvalue eigenvector of a symmetric matrix, by Jacobi rotations. */
function principalEigenvector(a: number[][]): number[] {
  const n = a.length
  const m = a.map((row) => [...row])
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += m[i][j] ** 2
    if (off < 1e-20) break
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(m[p][q]) < 1e-30) continue
        const theta = (m[q][q] - m[p][p]) / (2 * m[p][q])
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1),
          s = t * c
        for (let k = 0; k < n; k++) {
          const mkp = m[k][p],
            mkq = m[k][q]
          m[k][p] = c * mkp - s * mkq
          m[k][q] = s * mkp + c * mkq
        }
        for (let k = 0; k < n; k++) {
          const mpk = m[p][k],
            mqk = m[q][k]
          m[p][k] = c * mpk - s * mqk
          m[q][k] = s * mpk + c * mqk
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p],
            vkq = v[k][q]
          v[k][p] = c * vkp - s * vkq
          v[k][q] = s * vkp + c * vkq
        }
      }
  }
  let best = 0
  for (let i = 1; i < n; i++) if (m[i][i] > m[best][best]) best = i
  return v.map((row) => row[best])
}

/**
 * Heading, pitch and roll from pairs with the camera's position and lens known: the rotation that best turns each
 * pixel's ray (camera frame) onto the direction of its map spot (east/north/up), by Horn's unit-quaternion method.
 */
export function orientationFromPairs(
  camera: Pick<PhotoPose, 'lng' | 'lat' | 'altitudeMeters' | 'width' | 'height' | 'focalPx'>,
  pairs: readonly ControlPair[],
): { bearing: number; pitch: number; roll: number } | null {
  if (pairs.length < 2) return null
  const unit = (v: Vec3): Vec3 => {
    const l = Math.hypot(v[0], v[1], v[2])
    return [v[0] / l, v[1] / l, v[2] / l]
  }
  const S = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  for (const pair of pairs) {
    // Camera frame: x right, y down, z forward.
    const a = unit([
      (pair.pixel[0] - camera.width / 2) / camera.focalPx,
      (pair.pixel[1] - camera.height / 2) / camera.focalPx,
      1,
    ])
    const b = unit(localOffset(camera, pair.lng, pair.lat, pair.elevation) as Vec3)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S[i][j] += a[i] * b[j]
  }
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S
  const N = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ]
  const [w, x, y, z] = principalEigenvector(N)
  // Rotation taking camera-frame vectors to east/north/up; its columns are the camera's right, down and forward.
  const R = [
    [w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z],
  ]
  const forward: Vec3 = [R[0][2], R[1][2], R[2][2]]
  const right: Vec3 = [R[0][0], R[1][0], R[2][0]]
  const bearing = (((Math.atan2(forward[0], forward[1]) / RAD) % 360) + 360) % 360
  const pitch = Math.asin(Math.max(-1, Math.min(1, forward[2]))) / RAD
  const level = cameraAxes({ bearing, pitch, roll: 0 })
  const levelUp: Vec3 = [-level.down[0], -level.down[1], -level.down[2]]
  const dot = (p: Vec3, q: Vec3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2]
  const roll = Math.atan2(dot(right, levelUp), dot(right, level.right)) / RAD
  return { bearing, pitch, roll }
}

function gauss(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r
    ;[M[col], M[pivot]] = [M[pivot], M[col]]
    if (Math.abs(M[col][col]) < 1e-12) continue
    for (let r = 0; r < n; r++)
      if (r !== col) {
        const f = M[r][col] / M[col][col]
        for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k]
      }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]))
}

function fit(
  input: ControlSolveInput,
  pairs: readonly ControlPair[],
  p0: number[],
): { p: number[]; pose: PhotoPose & { hfov: number } } {
  const spec = { ...DEFAULTS, ...input.unknowns }
  const sigma = input.pixelSigma ?? 2
  const fixed = new Set(UNKNOWNS.flatMap((u, i) => (spec[u].mode === 'fixed' ? [i] : [])))
  const residuals = (p: number[]) => {
    const pose = poseFrom(input.start, p)
    const r: number[] = []
    for (const pair of pairs) {
      const q = projectToPhoto(pose, pair.lng, pair.lat, pair.elevation)
      if (!q) r.push(500 / sigma, 500 / sigma)
      else r.push((q.x - pair.pixel[0]) / sigma, (q.y - pair.pixel[1]) / sigma)
    }
    UNKNOWNS.forEach((u, i) => {
      const s = spec[u]
      if (s.mode !== 'prior') return
      const d = u === 'heading' ? wrap180(p[i] - s.value) : p[i] - s.value
      r.push(d / Math.max(1e-6, s.tolerance))
    })
    return r
  }
  let p = [...p0]
  let r = residuals(p)
  let cost = r.reduce((sum, v) => sum + v * v, 0)
  let lambda = 1e-2
  for (let iteration = 0; iteration < 60; iteration++) {
    const J = STEPS.map((h, j) => {
      if (fixed.has(j)) return r.map(() => 0)
      const q = [...p]
      q[j] += h
      return residuals(q).map((v, i) => (v - r[i]) / h)
    })
    const n = p.length
    const A = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => J[i].reduce((sum, v, k) => sum + v * J[j][k], 0)),
    )
    const b = Array.from({ length: n }, (_, i) => -J[i].reduce((sum, v, k) => sum + v * r[k], 0))
    for (const j of fixed) {
      A[j] = A[j].map((_, k) => (k === j ? 1 : 0))
      b[j] = 0
    }
    let improved = false
    for (let tries = 0; tries < 8 && !improved; tries++) {
      const dx = gauss(
        A.map((row, i) => row.map((v, j) => v + (i === j ? lambda * (A[i][i] + 1e-6) : 0))),
        b,
      )
      const q = p.map((v, i) => v + dx[i])
      const rq = residuals(q)
      const cq = rq.reduce((sum, v) => sum + v * v, 0)
      if (cq < cost) {
        const gain = cost - cq
        p = q
        r = rq
        cost = cq
        lambda /= 3
        improved = true
        if (gain < 1e-10 * (1 + cost)) iteration = Infinity
      } else lambda *= 4
    }
    if (!improved) break
  }
  return { p, pose: poseFrom(input.start, p) }
}

/** Solves the camera from paired points; null when there are fewer pairs than the free unknowns need. */
export function solveFromControls(input: ControlSolveInput): ControlSolveResult | null {
  const { start, pairs } = input
  const needed = pairsNeeded(input.unknowns)
  if (pairs.length < needed) return null
  const spec = { ...DEFAULTS, ...input.unknowns }
  // Closed-form angles when the start's angles are not to be kept; a fixed angle keeps its starting value.
  const closed = orientationFromPairs(start, pairs)
  const angles = closed ?? { bearing: start.bearing, pitch: start.pitch, roll: start.roll }
  const p0 = [
    0,
    0,
    0,
    spec.heading.mode === 'fixed' ? start.bearing : angles.bearing,
    spec.pitch.mode === 'fixed' ? start.pitch : angles.pitch,
    spec.roll.mode === 'fixed' ? start.roll : angles.roll,
    start.hfov,
  ]
  const solved = fit(input, pairs, p0)
  const error = (pose: PhotoPose, pair: ControlPair) => {
    const q = projectToPhoto(pose, pair.lng, pair.lat, pair.elevation)
    return q ? Math.hypot(q.x - pair.pixel[0], q.y - pair.pixel[1]) : Infinity
  }
  const results: PairResult[] = pairs.map((pair) => {
    const others = pairs.filter((other) => other !== pair)
    const heldOutPx = others.length >= needed ? error(fit(input, others, solved.p).pose, pair) : null
    const offset = localOffset(solved.pose, pair.lng, pair.lat, pair.elevation)
    return {
      id: pair.id,
      fittedPx: error(solved.pose, pair),
      heldOutPx,
      metresPerPx: Math.hypot(offset[0], offset[1], offset[2]) / solved.pose.focalPx,
    }
  })
  const heldOut = results.filter((row) => row.heldOutPx !== null && Number.isFinite(row.heldOutPx))
  return {
    pose: solved.pose,
    start: closed ? 'closed-form' : 'given',
    shift: { east: solved.p[0], north: solved.p[1], up: solved.p[2] },
    pairs: results,
    rmsPx: Math.sqrt(results.reduce((sum, row) => sum + row.fittedPx ** 2, 0) / results.length),
    heldOutMetresMax: heldOut.length
      ? Math.max(...heldOut.map((row) => (row.heldOutPx as number) * row.metresPerPx))
      : null,
    freeUnknowns: UNKNOWNS.filter((u) => spec[u].mode === 'free').length,
  }
}

/**
 * A landmark at the photo's centre, picked on the map: the heading and pitch it implies for a camera at `camera`
 * (one map click; QCALVIEW's calibration by a centre point). Used as a prior on the skyline search or the solve.
 */
export function landmarkAngles(
  camera: Pick<PhotoPose, 'lng' | 'lat' | 'altitudeMeters'>,
  landmark: { lng: number; lat: number; elevation: number },
): { bearing: number; pitch: number; distanceMeters: number } {
  const [east, north, up] = localOffset(camera, landmark.lng, landmark.lat, landmark.elevation)
  const ground = Math.hypot(east, north)
  return {
    bearing: (((Math.atan2(east, north) / RAD) % 360) + 360) % 360,
    pitch: Math.atan2(up, ground) / RAD,
    distanceMeters: Math.hypot(ground, up),
  }
}
