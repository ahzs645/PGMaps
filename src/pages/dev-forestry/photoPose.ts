/**
 * Where a street-level photo was taken from, which way it points, and how a
 * point on the ground lands in it.
 *
 * Handbook 3.3.4 checks a simulation against field photos: viewpoint
 * coordinates, view direction, focal length, and whether "the simulation will
 * drape over the photography seamlessly". This module is the geometry for
 * that: turn a photo's recorded pose into a camera, project the terrain's
 * skyline and a cutblock's outline into the photo, and let a reviewer nudge
 * the pose until the drawn skyline sits on the photographed one.
 *
 * Conventions follow OpenSfM, which Mapillary's computed poses come from: the
 * world frame is local east/north/up at the camera; camera axes are x right,
 * y down, z forward; a perspective camera's focal length is a fraction of the
 * image's longer side, with radial distortion `1 + k1 r² + k2 r⁴`.
 *
 * Free of DOM and network access, like the rest of the geometry here.
 */

import type { ElevationSource } from './terrain'
import { earthCurvatureDropMeters } from './visibility'

type Vec3 = [number, number, number]

const RAD = Math.PI / 180
const METRES_PER_DEGREE_LAT = 110574
const METRES_PER_DEGREE_LNG_AT_EQUATOR = 111320

export type PhotoPose = {
  lng: number
  lat: number
  /** Camera height above sea level, metres. */
  altitudeMeters: number
  /** Compass bearing of the optical axis, degrees clockwise from north. */
  bearing: number
  /** Degrees above the horizon; negative looks down. */
  pitch: number
  /** Degrees; positive when the camera's right side is raised. */
  roll: number
  width: number
  height: number
  /** Focal length in pixels. */
  focalPx: number
  k1: number
  k2: number
}

export function normalizeBearing(degrees: number): number {
  return ((degrees % 360) + 360) % 360
}

/** Rodrigues' formula: rotation matrix (rows) for an angle-axis vector. */
export function rotationMatrix(r: Vec3): [Vec3, Vec3, Vec3] {
  const theta = Math.hypot(r[0], r[1], r[2])
  if (theta < 1e-12)
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
  const [x, y, z] = [r[0] / theta, r[1] / theta, r[2] / theta]
  const c = Math.cos(theta),
    s = Math.sin(theta),
    t = 1 - c
  return [
    [c + x * x * t, x * y * t - z * s, x * z * t + y * s],
    [y * x * t + z * s, c + y * y * t, y * z * t - x * s],
    [z * x * t - y * s, z * y * t + x * s, c + z * z * t],
  ]
}

/**
 * Bearing, pitch and roll from an OpenSfM world-to-camera rotation. The
 * camera's forward, right and down axes in world coordinates are the rows of
 * the matrix.
 */
export function orientationFromRotation(r: Vec3): { bearing: number; pitch: number; roll: number } {
  const [right, down, forward] = rotationMatrix(r)
  const bearing = normalizeBearing(Math.atan2(forward[0], forward[1]) / RAD)
  const pitch = Math.asin(Math.max(-1, Math.min(1, forward[2]))) / RAD
  // Roll: the camera's right axis against the horizontal right of its bearing.
  const flatRight: Vec3 = [Math.cos(bearing * RAD), -Math.sin(bearing * RAD), 0]
  void down
  const roll = Math.atan2(right[2], dot(right, flatRight)) / RAD
  return { bearing, pitch, roll }
}

/** Field of view in degrees, from an OpenSfM normalised focal length. */
export function fieldOfView(focal: number, width: number, height: number): { horizontal: number; vertical: number } {
  const focalPx = focal * Math.max(width, height)
  return {
    horizontal: (2 * Math.atan(width / 2 / focalPx)) / RAD,
    vertical: (2 * Math.atan(height / 2 / focalPx)) / RAD,
  }
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/** The camera's right, down and forward axes in east/north/up. */
export function cameraAxes(pose: Pick<PhotoPose, 'bearing' | 'pitch' | 'roll'>): {
  right: Vec3
  down: Vec3
  forward: Vec3
} {
  const b = pose.bearing * RAD,
    p = pose.pitch * RAD,
    q = pose.roll * RAD
  const forward: Vec3 = [Math.sin(b) * Math.cos(p), Math.cos(b) * Math.cos(p), Math.sin(p)]
  const levelRight: Vec3 = [Math.cos(b), -Math.sin(b), 0]
  const levelUp = cross(levelRight, forward)
  // Roll turns right and up about the optical axis; positive raises the right.
  const right: Vec3 = [
    levelRight[0] * Math.cos(q) + levelUp[0] * Math.sin(q),
    levelRight[1] * Math.cos(q) + levelUp[1] * Math.sin(q),
    levelRight[2] * Math.cos(q) + levelUp[2] * Math.sin(q),
  ]
  const up: Vec3 = [
    levelUp[0] * Math.cos(q) - levelRight[0] * Math.sin(q),
    levelUp[1] * Math.cos(q) - levelRight[1] * Math.sin(q),
    levelUp[2] * Math.cos(q) - levelRight[2] * Math.sin(q),
  ]
  return { right, down: [-up[0], -up[1], -up[2]], forward }
}

/** East/north/up metres from the camera, with the drop of the earth's curve. */
function localOffset(
  pose: Pick<PhotoPose, 'lng' | 'lat' | 'altitudeMeters'>,
  lng: number,
  lat: number,
  altitude: number,
): Vec3 {
  const east = (lng - pose.lng) * METRES_PER_DEGREE_LNG_AT_EQUATOR * Math.cos(pose.lat * RAD)
  const north = (lat - pose.lat) * METRES_PER_DEGREE_LAT
  const distance = Math.hypot(east, north)
  return [east, north, altitude - pose.altitudeMeters - earthCurvatureDropMeters(distance)]
}

/**
 * Pixel position of a point in the photo, or null when it is behind the
 * camera. Points outside the frame still come back, so an outline can be
 * clipped by whatever draws it.
 */
export function projectToPhoto(
  pose: PhotoPose,
  lng: number,
  lat: number,
  altitude: number,
): { x: number; y: number; depth: number } | null {
  const { right, down, forward } = cameraAxes(pose)
  const v = localOffset(pose, lng, lat, altitude)
  const z = dot(v, forward)
  if (z <= 0.5) return null
  const x = dot(v, right) / z
  const y = dot(v, down) / z
  const r2 = x * x + y * y
  const d = 1 + pose.k1 * r2 + pose.k2 * r2 * r2
  return { x: pose.width / 2 + pose.focalPx * d * x, y: pose.height / 2 + pose.focalPx * d * y, depth: z }
}

/**
 * The terrain's skyline as it would appear in the photo: for each of `columns`
 * image columns, the highest ground along that line of sight out to
 * `maxDistanceMeters`, projected back into the frame. Where the elevation
 * source has no data the march stops, so a short mosaic draws a low skyline
 * rather than an invented one; `reach` says how far each column got.
 */
export function terrainSkyline(
  pose: PhotoPose,
  source: ElevationSource,
  {
    columns = 96,
    maxDistanceMeters = 20000,
    nearMeters = 60,
  }: { columns?: number; maxDistanceMeters?: number; nearMeters?: number } = {},
): Array<{ x: number; y: number; reachMeters: number }> {
  const { right, forward } = cameraAxes(pose)
  const out: Array<{ x: number; y: number; reachMeters: number }> = []
  const lngPerMetre = 1 / (METRES_PER_DEGREE_LNG_AT_EQUATOR * Math.cos(pose.lat * RAD))
  for (let column = 0; column < columns; column += 1) {
    const u = ((column + 0.5) / columns) * pose.width
    const nx = (u - pose.width / 2) / pose.focalPx
    // Horizontal direction of this column's ray (distortion is small at the
    // horizon line and ignored for choosing the azimuth).
    const ray: Vec3 = [forward[0] + nx * right[0], forward[1] + nx * right[1], 0]
    const length = Math.hypot(ray[0], ray[1])
    if (length < 1e-9) continue
    const east = ray[0] / length,
      north = ray[1] / length
    let best = -Infinity,
      bestPoint: { lng: number; lat: number; altitude: number } | null = null,
      reach = 0
    for (let distance = nearMeters; distance <= maxDistanceMeters; distance *= 1.015) {
      const lng = pose.lng + east * distance * lngPerMetre
      const lat = pose.lat + (north * distance) / METRES_PER_DEGREE_LAT
      const ground = source.elevationAt(lng, lat)
      if (!Number.isFinite(ground)) break
      reach = distance
      const angle = Math.atan2(ground - pose.altitudeMeters - earthCurvatureDropMeters(distance), distance)
      if (angle > best) {
        best = angle
        bestPoint = { lng, lat, altitude: ground }
      }
    }
    if (!bestPoint) continue
    const projected = projectToPhoto(pose, bestPoint.lng, bestPoint.lat, bestPoint.altitude)
    if (projected) out.push({ x: projected.x, y: projected.y, reachMeters: reach })
  }
  return out
}

export type PanoView = { bearing: number; pitch: number; verticalFovDegrees: number; width: number; height: number }

/**
 * A perspective view cut from an equirectangular (360°) photo, looking along
 * `view.bearing` and `view.pitch`, as RGBA pixels.
 *
 * `rotation` is the panorama camera's OpenSfM world-to-camera rotation, whose
 * forward axis is the centre column; with none, the compass bearing is taken
 * as the centre and the camera as level. The sphere maps longitude
 * atan2(x, z) across and latitude atan2(−y, √(x² + z²)) down, OpenSfM's
 * convention for spherical cameras.
 */
export function reprojectEquirect(
  source: { width: number; height: number; data: Uint8ClampedArray | Uint8Array },
  camera: { rotation: Vec3 | null; bearing: number },
  view: PanoView,
): Uint8ClampedArray {
  const rows = camera.rotation
    ? rotationMatrix(camera.rotation)
    : (() => {
        const { right, down, forward } = cameraAxes({ bearing: camera.bearing, pitch: 0, roll: 0 })
        return [right, down, forward] as [Vec3, Vec3, Vec3]
      })()
  const { right, down, forward } = cameraAxes({ bearing: view.bearing, pitch: view.pitch, roll: 0 })
  const focal = view.height / 2 / Math.tan((view.verticalFovDegrees * RAD) / 2)
  const out = new Uint8ClampedArray(view.width * view.height * 4)
  const W = source.width, H = source.height
  for (let v = 0; v < view.height; v += 1) {
    const y = (v + 0.5 - view.height / 2) / focal
    for (let u = 0; u < view.width; u += 1) {
      const x = (u + 0.5 - view.width / 2) / focal
      const d: Vec3 = [forward[0] + x * right[0] + y * down[0], forward[1] + x * right[1] + y * down[1], forward[2] + x * right[2] + y * down[2]]
      const cx = dot(d, rows[0]), cy = dot(d, rows[1]), cz = dot(d, rows[2])
      const lon = Math.atan2(cx, cz)
      const lat = Math.atan2(-cy, Math.hypot(cx, cz))
      const su = Math.min(W - 1, Math.max(0, Math.floor((0.5 + lon / (2 * Math.PI)) * W)))
      const sv = Math.min(H - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * H)))
      const from = (sv * W + su) * 4, to = (v * view.width + u) * 4
      out[to] = source.data[from]
      out[to + 1] = source.data[from + 1]
      out[to + 2] = source.data[from + 2]
      out[to + 3] = 255
    }
  }
  return out
}

/** A pinhole camera for a view cut from a panorama, so the skyline and outline draw onto it. */
export function panoViewPose(at: { lng: number; lat: number; altitudeMeters: number }, view: PanoView): PhotoPose {
  return {
    lng: at.lng,
    lat: at.lat,
    altitudeMeters: at.altitudeMeters,
    bearing: view.bearing,
    pitch: view.pitch,
    roll: 0,
    width: view.width,
    height: view.height,
    focalPx: view.height / 2 / Math.tan((view.verticalFovDegrees * RAD) / 2),
    k1: 0,
    k2: 0,
  }
}

