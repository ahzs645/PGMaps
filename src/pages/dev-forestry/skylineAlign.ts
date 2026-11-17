/**
 * Drag-to-align, the hand fallback when no search settles a camera (PeakFinder and PeakVisor's way): the drawn skyline
 * is dragged by a cross at its centre and turned by handles at its sides, and the drag becomes heading, pitch and roll.
 * See docs/forestry-visual-quality-own-photo-redesign-2026-11-17.md, §2.2.
 *
 * The camera follows the drag exactly rather than by a degrees-per-pixel rule, which is wrong away from the centre and
 * once the camera rolls: the direction under the grabbed pixel is held, and heading and pitch are solved so that it
 * lands where the pointer let go (`alignPixel`). A turn is a roll about the optical axis, with heading and pitch then
 * solved to keep the cross where it was (`rollAbout`). Lens distortion is left out; the photos this is for carry none
 * worth a drag's precision, and the search refines the result.
 *
 * Free of DOM and network access.
 */
import { cameraAxes, normalizeBearing, type PhotoPose } from './photoPose'

const RAD = Math.PI / 180
type Vec3 = [number, number, number]
type Angles = { bearing: number; pitch: number; roll: number }

/** Pitch is held inside this, short of looking straight up or down, where heading stops meaning anything. */
const PITCH_LIMIT = 85

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** The world direction (east, north, up) a photo pixel looks along, for a camera with these angles. */
export function pixelRay(pose: Pick<PhotoPose, 'width' | 'height' | 'focalPx'>, angles: Angles, x: number, y: number) {
  const { right, down, forward } = cameraAxes(angles)
  const u = (x - pose.width / 2) / pose.focalPx,
    v = (y - pose.height / 2) / pose.focalPx
  const ray: Vec3 = [
    forward[0] + right[0] * u + down[0] * v,
    forward[1] + right[1] * u + down[1] * v,
    forward[2] + right[2] * u + down[2] * v,
  ]
  const length = Math.hypot(ray[0], ray[1], ray[2])
  return ray.map((value) => value / length) as Vec3
}

/** Where a world direction falls in the photo for a camera with these angles; null behind it. */
export function rayPixel(pose: Pick<PhotoPose, 'width' | 'height' | 'focalPx'>, angles: Angles, ray: Vec3) {
  const { right, down, forward } = cameraAxes(angles)
  const z = dot(ray, forward)
  if (z <= 1e-6) return null
  return {
    x: pose.width / 2 + (pose.focalPx * dot(ray, right)) / z,
    y: pose.height / 2 + (pose.focalPx * dot(ray, down)) / z,
  }
}

/**
 * Heading and pitch (roll kept) that put the direction `ray` at pixel `to`: Newton's method on the two angles with a
 * numerical Jacobian, from `start`. Null when it does not converge (a drag off the frame's sensible range).
 */
function solveAngles(
  pose: Pick<PhotoPose, 'width' | 'height' | 'focalPx'>,
  start: Angles,
  ray: Vec3,
  to: { x: number; y: number },
): Angles | null {
  let { bearing, pitch } = start
  const { roll } = start
  const h = 1e-4
  for (let i = 0; i < 30; i++) {
    const at = rayPixel(pose, { bearing, pitch, roll }, ray)
    if (!at) return null
    const ex = at.x - to.x,
      ey = at.y - to.y
    if (Math.hypot(ex, ey) < 1e-6) break
    const db = rayPixel(pose, { bearing: bearing + h, pitch, roll }, ray),
      dp = rayPixel(pose, { bearing, pitch: pitch + h, roll }, ray)
    if (!db || !dp) return null
    const a = (db.x - at.x) / h,
      b = (dp.x - at.x) / h,
      c = (db.y - at.y) / h,
      d = (dp.y - at.y) / h
    const det = a * d - b * c
    if (Math.abs(det) < 1e-12) return null
    bearing -= (d * ex - b * ey) / det
    pitch -= (-c * ex + a * ey) / det
    pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch))
  }
  const check = rayPixel(pose, { bearing, pitch, roll }, ray)
  if (!check || Math.hypot(check.x - to.x, check.y - to.y) > 0.5) return null
  return { bearing: normalizeBearing(bearing), pitch, roll }
}

/**
 * The camera that moves what is drawn at photo pixel `from` to pixel `to`, roll kept: dragging the skyline right
 * turns the camera left. Null when no camera does (the drag would need to look past straight up or down).
 */
export function alignPixel(
  pose: Pick<PhotoPose, 'width' | 'height' | 'focalPx' | 'bearing' | 'pitch' | 'roll'>,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Angles | null {
  const ray = pixelRay(pose, pose, from.x, from.y)
  return solveAngles(pose, pose, ray, to)
}

/**
 * An angle in (−180°, 180°]: a roll, or a turn dragged across the ±180° line. Unwrapped, a quarter turn back past it
 * reads as 358°, which the record refuses (`parsePhotoAcceptance` holds roll within ±180°).
 */
export function wrapSigned(degrees: number): number {
  const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180
  return wrapped === -180 ? 180 : wrapped
}

/** Screen angle of a point about a centre, degrees clockwise (photo y runs down). */
export const screenAngle = (centre: { x: number; y: number }, point: { x: number; y: number }) =>
  Math.atan2(point.y - centre.y, point.x - centre.x) / RAD

/**
 * The camera that turns what is drawn by `degrees` clockwise about photo pixel `centre`: a roll about the optical axis,
 * then heading and pitch solved so the direction at `centre` stays there. Turning the skyline clockwise raises the
 * camera's right side (`roll` positive, `photoPose.ts`). Null when no camera does.
 */
export function rollAbout(
  pose: Pick<PhotoPose, 'width' | 'height' | 'focalPx' | 'bearing' | 'pitch' | 'roll'>,
  centre: { x: number; y: number },
  degrees: number,
): Angles | null {
  const ray = pixelRay(pose, pose, centre.x, centre.y)
  const rolled = { bearing: pose.bearing, pitch: pose.pitch, roll: wrapSigned(pose.roll + wrapSigned(degrees)) }
  return solveAngles(pose, rolled, ray, centre)
}

/**
 * The handles for a drawn skyline: the cross at its middle column, and a handle at each side a fifth of the way in,
 * each on the skyline itself where it is drawn there (else level with the cross). Photo pixels.
 */
export function skylineHandles(
  skyline: ReadonlyArray<{ x: number; y: number } | null>,
  width: number,
  height: number,
): { centre: { x: number; y: number }; left: { x: number; y: number }; right: { x: number; y: number } } {
  const points = skyline.filter((point): point is { x: number; y: number } => !!point && Number.isFinite(point.y))
  const inFrame = points.filter((point) => point.y >= 0 && point.y <= height && point.x >= 0 && point.x <= width)
  const yAt = (x: number, fallback: number) => {
    let best: { x: number; y: number } | null = null
    for (const point of inFrame) if (!best || Math.abs(point.x - x) < Math.abs(best.x - x)) best = point
    return best && Math.abs(best.x - x) < width / 10 ? best.y : fallback
  }
  const middle = yAt(width / 2, height / 2)
  return {
    centre: { x: width / 2, y: middle },
    left: { x: width / 5, y: yAt(width / 5, middle) },
    right: { x: (width * 4) / 5, y: yAt((width * 4) / 5, middle) },
  }
}
