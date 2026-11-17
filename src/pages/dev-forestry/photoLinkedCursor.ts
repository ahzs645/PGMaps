/**
 * The linked cursor between the plan and a docked photo (doc proposal §2.4): where the ground under the plan's cursor
 * falls in the photo. Hover only: it takes no clicks, so it needs nothing from `PlanClickToMove`.
 *
 * Kept free of DOM and network access.
 */
import { cameraDistance, inSight, type HitBuffer } from './photoHitBuffer'
import { projectToPhoto, type PhotoPose } from './photoPose'

const RAD = Math.PI / 180

/** A hit-buffer cell stands for the ground under the cursor only within this distance of it, metres. */
export const LINKED_CURSOR_NEAREST_METERS = 75

/**
 * The ground's elevation at a point from the hit buffer: the nearest cell whose ray met the ground, when one lies
 * within `LINKED_CURSOR_NEAREST_METERS`. Ground no ray reached (hidden, or out of frame) has none here.
 */
export function hitBufferElevation(buf: HitBuffer, lng: number, lat: number): number | null {
  const mx = 111_320 * Math.cos(lat * RAD),
    my = 110_574
  let best = LINKED_CURSOR_NEAREST_METERS ** 2,
    elevation: number | null = null
  for (let i = 0; i < buf.lng.length; i++) {
    const cellLng = buf.lng[i]
    if (Number.isNaN(cellLng)) continue
    const dx = (cellLng - lng) * mx,
      dy = (buf.lat[i] - lat) * my
    const d = dx * dx + dy * dy
    if (d < best) {
      best = d
      elevation = buf.elevation[i]
    }
  }
  return elevation
}

/**
 * Where a ground point falls in the photo, in its pixels, and whether nearer terrain hides it (`inSight`, read from
 * the hit buffer; true when no buffer is given for this camera). The ground's elevation comes from `ground` when it
 * has one there, else from the hit buffer (`hitBufferElevation`). Null when the point is behind the camera, outside
 * the frame, or has no elevation to stand it on.
 */
export function planPointToPhoto(
  pose: PhotoPose,
  lng: number,
  lat: number,
  ground: { elevationAt(lng: number, lat: number): number } | null,
  buf: HitBuffer | null,
): { x: number; y: number; inSight: boolean } | null {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  const fromGround = ground?.elevationAt(lng, lat)
  const elevation =
    fromGround !== undefined && Number.isFinite(fromGround)
      ? fromGround
      : buf
        ? hitBufferElevation(buf, lng, lat)
        : null
  if (elevation === null || !Number.isFinite(elevation)) return null
  const projected = projectToPhoto(pose, lng, lat, elevation)
  if (!projected) return null
  const { x, y } = projected
  if (!(x >= 0 && y >= 0 && x < pose.width && y < pose.height)) return null
  return { x, y, inSight: buf ? inSight(buf, x, y, cameraDistance(pose, lng, lat, elevation)) : true }
}
