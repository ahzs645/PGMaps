/**
 * Lining a photo up by its skyline, without a person nudging it.
 *
 * The photo's recorded heading and pitch are usually a few degrees out; the
 * terrain's skyline is not. So: find where the sky ends in each column of the
 * photo, compute the terrain's skyline as an angular profile once, and search
 * heading and pitch for the pose that lays one on the other.
 *
 * Two facts shape the score. Trees can stand above the terrain's skyline, so a
 * photo skyline above the terrain line is allowed (the column simply does not
 * count). But sky cannot show below the terrain, so a photo skyline below the
 * line is evidence against the pose and is penalised.
 *
 * Free of DOM and network access: pixels come in as plain RGBA arrays.
 */

import { cameraAxes, type PhotoPose } from './photoPose'
import type { ElevationSource } from './terrain'
import { earthCurvatureDropMeters } from './visibility'

const RAD = Math.PI / 180

export type Pixels = { width: number; height: number; data: Uint8ClampedArray | Uint8Array }

function isSky(data: Pixels['data'], index: number): boolean {
  const r = data[index], g = data[index + 1], b = data[index + 2]
  const light = (r + g + b) / 3
  const spread = Math.max(r, g, b) - Math.min(r, g, b)
  // Blue sky, from pale at the horizon to deep overhead.
  if (b >= r + 12 && b >= g - 6 && light > 95) return true
  // Cloud and overcast: bright and nearly colourless.
  return light > 185 && spread < 45
}

function isCloud(data: Pixels['data'], index: number): boolean {
  const r = data[index], g = data[index + 1], b = data[index + 2]
  return (r + g + b) / 3 > 185 && Math.max(r, g, b) - Math.min(r, g, b) < 45
}

/**
 * Where the sky ends, per column, in the pixels' own coordinates. A column
 * with no sky in its top third (a tree, a sign) gives null.
 *
 * Distant ridges are hazed toward the sky's own blue, so colour alone calls
 * them sky. The scan also stops at a sudden step away from the sky just above
 * (sky shades smoothly; a mountain's edge does not) unless the step is into
 * cloud, which is still sky.
 */
export function photoSkyline(pixels: Pixels, columns = 200, stepThreshold = 30): Array<{ x: number; y: number } | null> {
  const { width, height, data } = pixels
  const out: Array<{ x: number; y: number } | null> = []
  for (let c = 0; c < columns; c += 1) {
    const x = Math.min(width - 1, Math.floor(((c + 0.5) / columns) * width))
    const at = (y: number) => (y * width + x) * 4
    // Dashboard and roof cameras put a visor or roof edge across the top of
    // the frame: start at the first run of sky in the top third instead.
    let start = -1
    for (let y = 0; y < Math.floor(height / 3) && start < 0; y += 1) {
      let run = 0
      while (run < 5 && y + run < height && isSky(data, at(y + run))) run += 1
      if (run === 5) start = y
    }
    if (start < 0) {
      out.push(null)
      continue
    }
    // Running colour of the blue sky just above, to see a step against; unset
    // while the column is still in cloud.
    let sr = Number.NaN, sg = Number.NaN, sb = Number.NaN
    const differs = (y: number) => {
      const i = at(y)
      if (!isSky(data, i)) return true
      if (isCloud(data, i) || Number.isNaN(sr)) return false
      return Math.hypot(data[i] - sr, data[i + 1] - sg, data[i + 2] - sb) > stepThreshold
    }
    // A real skyline has ground below it. An edge with sky just under it that
    // is at least as blue and bright as the sky above is a cloud, a windscreen
    // reflection or a visor's lower edge: scan on. A hazed ridge is sky-coloured
    // too, but always darker and greyer than the sky over it.
    const skyBelow = (y: number) => {
      const depth = Math.max(8, Math.round(height * 0.08))
      let sky = 0, seen = 0, r = 0, g = 0, b = 0
      for (let k = 3; k < depth && y + k < height; k += 1) {
        const i = at(y + k)
        seen += 1
        if (!isSky(data, i)) continue
        sky += 1
        r += data[i]; g += data[i + 1]; b += data[i + 2]
      }
      if (!seen || sky / seen <= 0.5) return false
      if (Number.isNaN(sr)) return true
      r /= sky; g /= sky; b /= sky
      return b - r >= sb - sr - 10 && (r + g + b) / 3 >= (sr + sg + sb) / 3 - 25
    }
    let edge: number | null = null
    for (let y = start + 1; y < height - 3; y += 1) {
      if (differs(y) && differs(y + 1) && differs(y + 2)) {
        if (skyBelow(y)) {
          sr = Number.NaN
          continue
        }
        edge = y
        break
      }
      const i = at(y)
      if (isCloud(data, i)) continue
      if (Number.isNaN(sr)) { sr = data[i]; sg = data[i + 1]; sb = data[i + 2]; continue }
      sr = sr * 0.7 + data[i] * 0.3
      sg = sg * 0.7 + data[i + 1] * 0.3
      sb = sb * 0.7 + data[i + 2] * 0.3
    }
    out.push(edge === null ? null : { x: x + 0.5, y: edge })
  }
  return out
}

export type ProfilePoint = { azimuth: number; elevation: number; distanceMeters: number }

/**
 * The terrain skyline as angles: for each azimuth, the highest elevation angle
 * of ground out to `maxDistanceMeters`, curvature included.
 */
export function terrainProfile(
  eye: { lng: number; lat: number; altitudeMeters: number },
  source: ElevationSource,
  { from, to, step = 0.1, maxDistanceMeters = 25000, nearMeters = 60 }: { from: number; to: number; step?: number; maxDistanceMeters?: number; nearMeters?: number },
): ProfilePoint[] {
  const out: ProfilePoint[] = []
  const metresLng = 111320 * Math.cos(eye.lat * RAD)
  for (let azimuth = from; azimuth <= to + 1e-9; azimuth += step) {
    const east = Math.sin(azimuth * RAD), north = Math.cos(azimuth * RAD)
    let best = -Infinity, bestDistance = 0
    for (let distance = nearMeters; distance <= maxDistanceMeters; distance *= 1.015) {
      const z = source.elevationAt(eye.lng + (east * distance) / metresLng, eye.lat + (north * distance) / 110574)
      if (!Number.isFinite(z)) break
      const angle = Math.atan2(z - eye.altitudeMeters - earthCurvatureDropMeters(distance), distance)
      if (angle > best) { best = angle; bestDistance = distance }
    }
    if (Number.isFinite(best)) out.push({ azimuth, elevation: best / RAD, distanceMeters: bestDistance })
  }
  return out
}

/** Pixel position of a direction (azimuth, elevation in degrees) in the photo. */
export function projectDirection(pose: PhotoPose, azimuth: number, elevation: number): { x: number; y: number } | null {
  const { right, down, forward } = cameraAxes(pose)
  const d: [number, number, number] = [
    Math.sin(azimuth * RAD) * Math.cos(elevation * RAD),
    Math.cos(azimuth * RAD) * Math.cos(elevation * RAD),
    Math.sin(elevation * RAD),
  ]
  const z = d[0] * forward[0] + d[1] * forward[1] + d[2] * forward[2]
  if (z <= 0.05) return null
  const x = (d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) / z
  const y = (d[0] * down[0] + d[1] * down[1] + d[2] * down[2]) / z
  const r2 = x * x + y * y
  const k = 1 + pose.k1 * r2 + pose.k2 * r2 * r2
  return { x: pose.width / 2 + pose.focalPx * k * x, y: pose.height / 2 + pose.focalPx * k * y }
}

/**
 * The skyline under each photo column for one pose: the bare-ground line, and
 * the same ridges raised by a canopy `canopyMeters` tall at their own distance.
 */
function terrainLinesAt(pose: PhotoPose, profile: readonly ProfilePoint[], xs: readonly number[], canopyMeters: number) {
  const project = (lift: (point: ProfilePoint) => number) =>
    profile
      .map((point) => {
        const p = projectDirection(pose, point.azimuth, point.elevation + lift(point))
        return p ? { ...p, distance: point.distanceMeters } : null
      })
      .filter((point): point is { x: number; y: number; distance: number } => point !== null)
      .sort((a, b) => a.x - b.x)
  const interpolate = (projected: Array<{ x: number; y: number; distance: number }>, x: number) => {
    const hi = projected.findIndex((point) => point.x >= x)
    if (hi < 0) return null
    if (hi === 0) return projected[0].x - x < 1 ? { y: projected[0].y, distance: projected[0].distance } : null
    const a = projected[hi - 1], b = projected[hi]
    return { y: a.y + ((b.y - a.y) * (x - a.x)) / Math.max(1e-9, b.x - a.x), distance: Math.min(a.distance, b.distance) }
  }
  const bare = project(() => 0)
  const canopy = project((point) => (Math.atan2(canopyMeters, Math.max(1, point.distanceMeters)) * 180) / Math.PI)
  return xs.map((x) => {
    const b = interpolate(bare, x), c = interpolate(canopy, x)
    return { bare: b?.y ?? null, canopy: c?.y ?? null, distance: b?.distance ?? 0 }
  })
}

export type SkylineFit = {
  /** Degrees to add to the photo's heading and pitch. */
  nudge: { bearing: number; pitch: number }
  /**
   * Of the columns that could be judged (sky over a skyline at least a
   * kilometre out, not hidden by something nearer), the share that agree.
   */
  agreement: number
  /** Columns that agree. */
  agreeing: number
  /** Share of the frame's width the agreeing columns span. */
  span: number
  /** Median distance of those columns from the nearer of the bare and canopy lines, in photo pixels. */
  medianErrorPx: number
  columns: number
  /** Enough agreeing columns, spread widely enough, to fix heading and pitch. */
  trustworthy: boolean
}

/** Ridges nearer than this are mostly trees in a photo, and say little about the pose. */
const MIN_SKYLINE_DISTANCE_METERS = 1000

/**
 * A column agrees when the photo's skyline lies between the bare ridge and the
 * ridge with its canopy on. Above the canopy (a roadside tree, a pole) it says
 * nothing; below the bare ridge it is sky where the terrain says ground, which
 * counts against the pose.
 */
function score(pose: PhotoPose, profile: readonly ProfilePoint[], skyline: ReadonlyArray<{ x: number; y: number }>, tolerance: number, canopyMeters: number) {
  const lines = terrainLinesAt(pose, profile, skyline.map((point) => point.x), canopyMeters)
  let on = 0, below = 0, minX = Infinity, maxX = -Infinity
  const errors: number[] = []
  skyline.forEach((point, i) => {
    const { bare, canopy, distance } = lines[i]
    if (bare === null || canopy === null || distance < MIN_SKYLINE_DISTANCE_METERS) return
    if (point.y > bare + tolerance) below += 1
    else if (point.y >= canopy - tolerance) {
      on += 1
      minX = Math.min(minX, point.x)
      maxX = Math.max(maxX, point.x)
      // How closely it follows one line or the other: open ground sits on the
      // bare ridge, forest on the canopy. Inside the band every pose would
      // otherwise score the same.
      errors.push(Math.min(Math.abs(point.y - bare), Math.abs(point.y - canopy)))
    }
  })
  errors.sort((a, b) => a - b)
  const mean = errors.length ? errors.reduce((sum, e) => sum + e, 0) / errors.length : Infinity
  return {
    value: on - 3 * below,
    on,
    below,
    span: on ? (maxX - minX) / pose.width : 0,
    median: errors.length ? errors[Math.floor(errors.length / 2)] : Infinity,
    mean,
  }
}

/**
 * The heading and pitch nudge that best lays the photo's skyline on the
 * terrain's, searched coarse then fine within ±`bearingRange` and
 * ±`pitchRange` degrees. Null when too few columns show sky to judge by.
 */
export function fitSkyline(
  pose: PhotoPose,
  profile: readonly ProfilePoint[],
  skyline: ReadonlyArray<{ x: number; y: number } | null>,
  {
    bearingRange = 3,
    pitchRange = 2,
    tolerance = Math.max(3, pose.height * 0.004),
    canopyMeters = 25,
  }: { bearingRange?: number; pitchRange?: number; tolerance?: number; canopyMeters?: number } = {},
): SkylineFit | null {
  const usable = skyline.filter((point): point is { x: number; y: number } => point !== null)
  if (usable.length < 12 || profile.length < 2) return null
  let best = { bearing: 0, pitch: 0, ...score(pose, profile, usable, tolerance, canopyMeters) }
  const search = (bearingStep: number, pitchStep: number, around: { bearing: number; pitch: number }, bearingSpan: number, pitchSpan: number) => {
    for (let db = -bearingSpan; db <= bearingSpan + 1e-9; db += bearingStep) {
      for (let dp = -pitchSpan; dp <= pitchSpan + 1e-9; dp += pitchStep) {
        const bearing = around.bearing + db, pitch = around.pitch + dp
        const result = score({ ...pose, bearing: pose.bearing + bearing, pitch: pose.pitch + pitch }, profile, usable, tolerance, canopyMeters)
        if (result.value > best.value || (result.value === best.value && result.mean < best.mean)) best = { bearing, pitch, ...result }
      }
    }
  }
  search(0.25, 0.1, { bearing: 0, pitch: 0 }, bearingRange, pitchRange)
  search(0.05, 0.02, { bearing: best.bearing, pitch: best.pitch }, 0.3, 0.12)
  const judged = best.on + best.below
  const agreement = judged ? best.on / judged : 0
  return {
    nudge: { bearing: Math.round(best.bearing * 100) / 100, pitch: Math.round(best.pitch * 100) / 100 },
    agreement,
    agreeing: best.on,
    span: best.span,
    medianErrorPx: best.median,
    columns: usable.length,
    trustworthy: best.on >= 20 && best.span >= 0.15 && agreement >= 0.8,
  }
}
