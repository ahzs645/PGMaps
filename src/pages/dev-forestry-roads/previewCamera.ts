import type { TerrainVertex } from './terrainMesh'

/** Zoom range of the 3D preview, relative to the fit of the whole display window. */
export const PREVIEW_MIN_ZOOM = 0.35
export const PREVIEW_MAX_ZOOM = 16
/** Below this zoom the whole-window mesh is fine enough; above it a finer window is meshed around the focus. */
export const PREVIEW_DETAIL_ZOOM = 2

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))

export const clampPreviewZoom = (zoom: number) => clamp(zoom, PREVIEW_MIN_ZOOM, PREVIEW_MAX_ZOOM)

/**
 * The point the camera orbits and zooms about, and where it is drawn, as a fraction of the pane. The
 * fit places the window's centre by its projected outline, which moves as the view turns; a focus
 * keeps the screen position it had when the first gesture took it, so a turn never moves it.
 */
export type CameraFocus = TerrainVertex & { screen?: { x: number; y: number } }

/**
 * Orbit camera for the 3D preview. Orbit, zoom and pan all work around one focus point on the ground,
 * which stays at a fixed place on screen: zoom changes the scale about it, rotation turns the scene
 * about it and panning moves it. Without a focus it is the fit target, so the default view fits
 * both terrain and design elevations, including roads far above or below ground.
 */
export function previewCamera({
  bounds,
  low,
  high,
  target,
  targetZ,
  angle,
  tilt,
  exaggeration,
  width,
  height,
  zoom,
  focus: requestedFocus,
}: {
  bounds: number[]
  low: number
  high: number
  target: number[]
  targetZ: number
  angle: number
  tilt: number
  exaggeration: number
  width: number
  height: number
  zoom: number
  /** World point the camera orbits and zooms about. Defaults to the fit target. */
  focus?: CameraFocus | null
}) {
  const span = Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1], 30)
  // Keep the entire box in front of the perspective plane, at every camera angle.
  const radius = Math.hypot(
    Math.max(Math.abs(bounds[0] - target[0]), Math.abs(bounds[2] - target[0])),
    Math.max(Math.abs(bounds[1] - target[1]), Math.abs(bounds[3] - target[1])),
    Math.max(Math.abs(low - targetZ), Math.abs(high - targetZ)) * exaggeration,
  )
  // Any focus inside the box is at most 2 × radius from every box point, so the box stays in front.
  const cameraDistance = Math.max(span, radius) * 2.5
  const cos = Math.cos(angle),
    sin = Math.sin(angle)
  const tiltCos = Math.cos(tilt),
    tiltSin = Math.sin(tilt)
  const cameraPoint = (vertex: TerrainVertex, origin: TerrainVertex) => {
    const x = vertex.x - origin.x,
      y = vertex.y - origin.y,
      z = (vertex.z - origin.z) * exaggeration
    const across = x * cos - y * sin
    const ahead = x * sin + y * cos
    const depth = ahead * tiltCos - z * tiltSin
    const vertical = ahead * tiltSin + z * tiltCos
    const perspective = cameraDistance / (cameraDistance + depth)
    return { x: across * perspective, y: -vertical * perspective, depth }
  }
  const fitOrigin = { x: target[0], y: target[1], z: targetZ }
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity
  for (const x of [bounds[0], bounds[2]])
    for (const y of [bounds[1], bounds[3]])
      for (const z of [low, high]) {
        const point = cameraPoint({ x, y, z }, fitOrigin)
        left = Math.min(left, point.x)
        right = Math.max(right, point.x)
        top = Math.min(top, point.y)
        bottom = Math.max(bottom, point.y)
      }
  const fitScale = Math.max(
    0.0001,
    Math.min((width - 24) / Math.max(1, right - left), (height - 24) / Math.max(1, bottom - top)),
  )
  const scale = zoom * fitScale
  // Where the fit target sits on screen at the fit, unless the focus carries its own place.
  const screen = requestedFocus?.screen
  const anchorX = screen ? screen.x * width : width / 2 - ((left + right) / 2) * fitScale,
    anchorY = screen ? screen.y * height : height / 2 - ((top + bottom) / 2) * fitScale
  const focusScreen = { x: anchorX / Math.max(1, width), y: anchorY / Math.max(1, height) }
  const focus: CameraFocus & { screen: { x: number; y: number } } = requestedFocus
    ? {
        x: clamp(requestedFocus.x, bounds[0], bounds[2]),
        y: clamp(requestedFocus.y, bounds[1], bounds[3]),
        z: clamp(requestedFocus.z, Math.min(low, high), Math.max(low, high)),
        screen: focusScreen,
      }
    : { ...fitOrigin, screen: focusScreen }
  const project = (vertex: TerrainVertex) => {
    const point = cameraPoint(vertex, focus)
    return { x: anchorX + point.x * scale, y: anchorY + point.y * scale, depth: point.depth }
  }
  /**
   * The point on the level plane at elevation `z` drawn at screen position (sx, sy), or null where that
   * screen position looks above the plane's horizon.
   */
  const unproject = (sx: number, sy: number, z: number): { x: number; y: number } | null => {
    const X = (sx - anchorX) / scale,
      Y = (sy - anchorY) / scale
    const raised = (z - focus.z) * exaggeration
    // Zero when the ray runs parallel to the plane; a plane above the eye is still met from below.
    const denominator = tiltSin + (Y * tiltCos) / cameraDistance
    if (Math.abs(denominator) <= 1e-9) return null
    const ahead = (-Y - raised * tiltCos + (Y * raised * tiltSin) / cameraDistance) / denominator
    const k = (cameraDistance + ahead * tiltCos - raised * tiltSin) / cameraDistance
    // The ray meets the plane behind the camera, e.g. looking above the horizon.
    if (k <= 1e-6) return null
    const across = X * k
    return { x: focus.x + across * cos + ahead * sin, y: focus.y - across * sin + ahead * cos }
  }
  return {
    scale,
    cameraDistance,
    focus,
    anchor: { x: anchorX, y: anchorY },
    bounds,
    low: Math.min(low, high),
    high: Math.max(low, high),
    project,
    unproject,
  }
}

export type PreviewCamera = ReturnType<typeof previewCamera>

/**
 * Focus that keeps the ground under screen point (sx, sy) in place when `next` replaces `current`
 * (a zoom about the cursor, or a pan from where the drag started). Returns null when the point looks
 * above the horizon in either camera.
 */
export function focusHoldingPoint(
  current: PreviewCamera,
  next: PreviewCamera,
  from: { x: number; y: number },
  to: { x: number; y: number } = from,
  /** Elevation of the held point; the ground under the pointer holds exactly. */
  z = current.focus.z,
): CameraFocus | null {
  const before = current.unproject(from.x, from.y, z)
  const after = next.unproject(to.x, to.y, z)
  if (!before || !after) return null
  return { ...next.focus, x: next.focus.x + before.x - after.x, y: next.focus.y + before.y - after.y }
}

/**
 * The ground drawn at screen point (sx, sy): the level-plane read-back refined against the terrain a few
 * times. Null above the horizon or off the terrain.
 */
export function groundUnder(
  camera: PreviewCamera,
  point: { x: number; y: number },
  elevation: (x: number, y: number) => number,
): TerrainVertex | null {
  // Solve ground(z) = z along the pointer's ray. A secant step converges on steep, exaggerated
  // slopes seen obliquely, where repeated substitution oscillates.
  const residual = (z: number) => {
    const hit = camera.unproject(point.x, point.y, z)
    if (!hit) return null
    const ground = elevation(hit.x, hit.y)
    return Number.isFinite(ground) ? { hit, value: ground - z } : null
  }
  let z0 = camera.focus.z
  let r0 = residual(z0)
  if (!r0) return null
  let z1 = z0 + r0.value
  for (let i = 0; i < 16; i++) {
    if (Math.abs(r0.value) < 0.01) return { x: r0.hit.x, y: r0.hit.y, z: z0 }
    const r1 = residual(z1)
    if (!r1) return null
    const slope = r1.value - r0.value
    const z2 = Math.abs(slope) < 1e-12 ? z1 + r1.value : z1 - (r1.value * (z1 - z0)) / slope
    z0 = z1
    r0 = r1
    z1 = z2
  }
  return Math.abs(r0.value) < 0.05 ? { x: r0.hit.x, y: r0.hit.y, z: z0 } : null
}

/**
 * Put the focus on the ground under it without changing the picture: the focus slides along the line
 * of sight onto the ground, and the zoom is corrected for the shorter or longer view so the ground at
 * the centre keeps its size. Orbiting then turns about the ground at the centre, not a point in the air.
 * Null when that ground is missing, outside the window or out of the zoom range.
 */
export function focusOnGround(
  camera: PreviewCamera,
  zoom: number,
  elevation: (x: number, y: number) => number,
): { focus: CameraFocus; zoom: number } | null {
  const ground = groundUnder(camera, camera.anchor, elevation)
  if (!ground) return null
  const { bounds } = camera
  if (ground.x < bounds[0] || ground.x > bounds[2] || ground.y < bounds[1] || ground.y > bounds[3]) return null
  if (ground.z < camera.low || ground.z > camera.high) return null
  const depth = camera.project(ground).depth
  if (camera.cameraDistance + depth <= 0) return null
  const next = (zoom * camera.cameraDistance) / (camera.cameraDistance + depth)
  return next === clampPreviewZoom(next) ? { focus: { ...ground, screen: camera.focus.screen }, zoom: next } : null
}

/** Screen distance of one metre across the view at the focus, for the scale bar. */
export function pixelsPerMetreAtFocus(camera: PreviewCamera, angle: number) {
  const { focus } = camera
  const a = camera.project(focus),
    b = camera.project({ x: focus.x + Math.cos(angle) * 10, y: focus.y - Math.sin(angle) * 10, z: focus.z })
  return Math.hypot(b.x - a.x, b.y - a.y) / 10
}

/** The longest 1–2–5 length that draws no wider than `maxPixels`. */
export function scaleBarLength(pixelsPerMetre: number, maxPixels = 96) {
  if (!(pixelsPerMetre > 0) || !Number.isFinite(pixelsPerMetre)) return null
  const limit = maxPixels / pixelsPerMetre
  const power = 10 ** Math.floor(Math.log10(limit))
  const metres = [5, 2, 1].map((n) => n * power).find((n) => n <= limit) ?? power
  return { metres, pixels: metres * pixelsPerMetre }
}

/**
 * Window meshed at finer spacing when zoomed in, around the focus. It is snapped to the coarse mesh's
 * cells, so coarse cells are either wholly inside it (and replaced) or wholly outside, and to a grid of
 * half its size, so a pan rebuilds it only after crossing a step. Null when the whole window is enough.
 */
export function previewDetailWindow(
  bounds: number[],
  zoom: number,
  focus: { x: number; y: number },
  coarseSpacing: number,
): number[] | null {
  if (!(zoom >= PREVIEW_DETAIL_ZOOM) || !(coarseSpacing > 0)) return null
  const span = Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1])
  const level = 2 ** Math.floor(Math.log2(Math.min(zoom, PREVIEW_MAX_ZOOM)))
  // Twice the visible width, so a short pan or a tilted view stays on the fine mesh.
  const half = (0.75 * span) / level
  const step = Math.max(coarseSpacing, Math.round(half / 2 / coarseSpacing) * coarseSpacing)
  const cx = Math.round(focus.x / step) * step,
    cy = Math.round(focus.y / step) * step
  const snapDown = (value: number) => Math.floor(value / coarseSpacing) * coarseSpacing
  const snapUp = (value: number) => Math.ceil(value / coarseSpacing) * coarseSpacing
  const window = [
    Math.max(snapDown(bounds[0]), snapDown(cx - half)),
    Math.max(snapDown(bounds[1]), snapDown(cy - half)),
    Math.min(snapUp(bounds[2]), snapUp(cx + half)),
    Math.min(snapUp(bounds[3]), snapUp(cy + half)),
  ]
  if (window[2] <= window[0] || window[3] <= window[1]) return null
  const area = (window[2] - window[0]) * (window[3] - window[1])
  const whole = (snapUp(bounds[2]) - snapDown(bounds[0])) * (snapUp(bounds[3]) - snapDown(bounds[1]))
  return area >= whole * 0.7 ? null : window
}

/**
 * Vertical exaggeration that makes the relief read: the smallest of 1, 2 and 4 that draws the ground's
 * height range at least a tenth of the window's width.
 */
export function autoPreviewExaggeration(relief: number, span: number) {
  if (!(relief > 0) || !(span > 0)) return 1
  return [1, 2, 4].find((factor) => (relief * factor) / span >= 0.1) ?? 4
}
