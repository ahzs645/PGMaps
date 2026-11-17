/**
 * What is drawn over an own photo, in the photo's own pixels: mapped features laid on the terrain and projected
 * through the camera, split into the parts the camera sees and the parts nearer ground hides, and the reading aids
 * (a level line, bearing ticks, distance contours). See docs/forestry-visual-quality-own-photo-redesign-2026-11-17.md,
 * section 2.3.
 *
 * Drawing happens here rather than through MapLibre because the map cannot stand at an aircraft, forces roll 0 and has
 * no lens distortion; `projectToPhoto` has all three. Occlusion is read from the hit buffer (`photoHitBuffer.ts`): a
 * point is in sight when it is no farther along its ray than the ground the ray first meets there (`inSight`).
 *
 * Every line and ring is densified before it is projected, so a long edge follows the hills between its vertices
 * instead of cutting through them, and so a part that goes behind a ridge is split where it goes.
 *
 * Free of DOM and network access: terrain, features and the hit buffer are passed in.
 */
import type { ElevationSource } from '@/lib/forestry/terrain/terrain'
import type { Point } from '@/lib/mapSheet/drawOps'

import { cameraDistance, inSight, type HitBuffer } from './photoHitBuffer'
import { normalizeBearing, projectToPhoto, type PhotoPose } from './photoPose'

const RAD = Math.PI / 180
// The same constants as `localOffset`, so a point built here projects exactly where it was meant to.
const METRES_PER_DEGREE_LAT = 110574
const metresPerDegreeLng = (lat: number) => 111320 * Math.cos(lat * RAD)

/** A mapped feature to draw on the photo. Coordinates are WGS84; any Z is ignored and the terrain read instead. */
export type PhotoFeature = {
  /** A photo layer id (`photoLayers.ts`). */
  layer: string
  id?: string | number
  label?: string
  properties?: Record<string, unknown>
  geometry: GeoJSON.Geometry
}

/** A point feature's marker, in photo pixels. */
export type PhotoMarker = { x: number; y: number; visible: boolean }

/** One feature as drawn: its in-sight and hidden runs as SVG path data and as point lists, in photo pixels. */
export type PhotoFeaturePaths = {
  layer: string
  id?: string | number
  label?: string
  /** SVG path data, one per run the camera sees. */
  visible: string[]
  /** SVG path data, one per run hidden by nearer ground: drawn dotted. */
  hidden: string[]
  /** The same runs as points, for the shared symbol drawing (`lineSymbolOps`). */
  visibleParts: Point[][]
  hiddenParts: Point[][]
  /** Point features: each point in frame. */
  markers: PhotoMarker[]
  /** Middle of the longest run in sight, or the first marker in sight; null when nothing is seen. */
  labelAnchor: { x: number; y: number } | null
}

export type PhotoOverlayOptions = {
  /** The terrain the hit buffer was cast on: features are laid on it. */
  ground: ElevationSource
  /**
   * Metres a feature is lifted off the ground before it is projected. Ground drawn exactly on the surface would be
   * hidden by its own pixel at a grazing angle half the time.
   */
  liftMeters?: number
  /** Longest step between densified vertices, metres. */
  maxStepMeters?: number
  /** Shortest step, metres: a finer step only re-reads the same terrain cell. */
  minStepMeters?: number
  /** Photo pixels between densified vertices: the step grows with distance so far features cost no more than near. */
  stepPixels?: number
}

export const PHOTO_OVERLAY_DEFAULTS = {
  liftMeters: 1,
  maxStepMeters: 60,
  minStepMeters: 5,
  stepPixels: 3,
} as const

/** Most vertices one feature is densified to; past it the step widens. Keeps one long stream from stalling the draw. */
export const MAX_OVERLAY_VERTICES_PER_FEATURE = 20_000

type Projected = { x: number; y: number; range: number }

const fmt = (value: number) => (Math.round(value * 10) / 10).toString()

/** SVG path data for an open polyline. */
export function pathData(points: readonly Point[]): string {
  return points.map(([x, y], index) => `${index ? 'L' : 'M'}${fmt(x)} ${fmt(y)}`).join('')
}

function project(pose: PhotoPose, lng: number, lat: number, altitude: number): Projected | null {
  const q = projectToPhoto(pose, lng, lat, altitude)
  return q ? { x: q.x, y: q.y, range: cameraDistance(pose, lng, lat, altitude) } : null
}

/** Liang–Barsky: the part of segment a→b inside [0, w] × [0, h], as parameters along it, or null. */
function clipSegment(a: Projected, b: Projected, w: number, h: number): [number, number] | null {
  let t0 = 0,
    t1 = 1
  const dx = b.x - a.x,
    dy = b.y - a.y
  const edges: Array<[number, number]> = [
    [-dx, a.x],
    [dx, w - a.x],
    [-dy, a.y],
    [dy, h - a.y],
  ]
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null
      continue
    }
    const r = q / p
    if (p < 0) {
      if (r > t1) return null
      if (r > t0) t0 = r
    } else {
      if (r < t0) return null
      if (r < t1) t1 = r
    }
  }
  return t0 <= t1 ? [t0, t1] : null
}

const lerp = (a: Projected, b: Projected, t: number): Projected => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  range: a.range + (b.range - a.range) * t,
})

/** Whether the ground the photo shows at a projected point is that point, from the hit buffer. */
function seen(buf: HitBuffer, p: Projected): boolean {
  // A point on the frame's far edge reads the last pixel, not one past it.
  const x = Math.min(Math.max(p.x, 0), buf.photoWidth * (1 - 1e-9))
  const y = Math.min(Math.max(p.y, 0), buf.photoHeight * (1 - 1e-9))
  return inSight(buf, x, y, p.range)
}

/** Builds runs of one state from pieces; a piece that starts where the open run ends continues it. */
class Runs {
  visible: Point[][] = []
  hidden: Point[][] = []
  private open: { visible: boolean; points: Point[] } | null = null

  add(a: Projected, b: Projected, visible: boolean) {
    const last = this.open?.points[this.open.points.length - 1]
    if (this.open && this.open.visible === visible && last && last[0] === a.x && last[1] === a.y) {
      this.open.points.push([b.x, b.y])
      return
    }
    this.close()
    this.open = {
      visible,
      points: [
        [a.x, a.y],
        [b.x, b.y],
      ],
    }
  }

  close() {
    if (this.open) (this.open.visible ? this.visible : this.hidden).push(this.open.points)
    this.open = null
  }
}

/** Projects a densified line and adds its clipped, occlusion-split pieces to `runs`. */
function addLine(buf: HitBuffer, points: ReadonlyArray<Projected | null>, runs: Runs) {
  const w = buf.photoWidth,
    h = buf.photoHeight
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i]
    if (!a || !b) {
      runs.close()
      continue
    }
    const clip = clipSegment(a, b, w, h)
    if (!clip) {
      runs.close()
      continue
    }
    // Keep the original vertices where they are in frame, so consecutive pieces join exactly.
    const p0 = clip[0] === 0 ? a : lerp(a, b, clip[0])
    const p1 = clip[1] === 1 ? b : lerp(a, b, clip[1])
    if (clip[0] > 0) runs.close()
    const s0 = seen(buf, p0),
      s1 = seen(buf, p1)
    if (s0 === s1) runs.add(p0, p1, s0)
    else {
      // Find where it goes behind (or comes out from behind) the ground, by halving.
      let low = 0,
        high = 1
      for (let k = 0; k < 10; k++) {
        const mid = (low + high) / 2
        if (seen(buf, lerp(p0, p1, mid)) === s0) low = mid
        else high = mid
      }
      const m = lerp(p0, p1, (low + high) / 2)
      runs.add(p0, m, s0)
      runs.add(m, p1, s1)
    }
    if (clip[1] < 1) runs.close()
  }
  runs.close()
}

type Ring = ReadonlyArray<GeoJSON.Position>

/** Lines and rings of a geometry; rings are flagged so their first and last runs can be joined. */
function linesOf(geometry: GeoJSON.Geometry): Array<{ coordinates: Ring; ring: boolean }> {
  switch (geometry.type) {
    case 'LineString':
      return [{ coordinates: geometry.coordinates, ring: false }]
    case 'MultiLineString':
      return geometry.coordinates.map((coordinates) => ({ coordinates, ring: false }))
    case 'Polygon':
      return geometry.coordinates.map((coordinates) => ({ coordinates, ring: true }))
    case 'MultiPolygon':
      return geometry.coordinates.flatMap((polygon) => polygon.map((coordinates) => ({ coordinates, ring: true })))
    case 'GeometryCollection':
      return geometry.geometries.flatMap(linesOf)
    default:
      return []
  }
}

function pointsOf(geometry: GeoJSON.Geometry): GeoJSON.Position[] {
  if (geometry.type === 'Point') return [geometry.coordinates]
  if (geometry.type === 'MultiPoint') return geometry.coordinates
  if (geometry.type === 'GeometryCollection') return geometry.geometries.flatMap(pointsOf)
  return []
}

/**
 * Densifies one line in local metres: the step is about `stepPixels` of photo at the vertex's distance, kept between
 * the minimum and maximum step, and widened when the line would pass the vertex limit.
 */
function densify(
  pose: PhotoPose,
  coordinates: Ring,
  options: Required<Omit<PhotoOverlayOptions, 'ground'>>,
): Array<[number, number]> {
  const mx = metresPerDegreeLng(pose.lat)
  const xy = coordinates
    .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map((c) => [(c[0] - pose.lng) * mx, (c[1] - pose.lat) * METRES_PER_DEGREE_LAT] as const)
  if (xy.length < 2) return xy.map(([e, n]) => [pose.lng + e / mx, pose.lat + n / METRES_PER_DEGREE_LAT])
  let length = 0
  for (let i = 1; i < xy.length; i++) length += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1])
  const floor = Math.max(options.minStepMeters, length / MAX_OVERLAY_VERTICES_PER_FEATURE)
  const ceiling = Math.max(options.maxStepMeters, floor)
  const radiansPerStep = options.stepPixels / pose.focalPx
  const out: Array<[number, number]> = [[xy[0][0], xy[0][1]]]
  for (let i = 1; i < xy.length; i++) {
    const [e0, n0] = xy[i - 1],
      [e1, n1] = xy[i]
    const segment = Math.hypot(e1 - e0, n1 - n0)
    let t = 0
    while (segment > 0) {
      const e = e0 + (e1 - e0) * t,
        n = n0 + (n1 - n0) * t
      const step = Math.min(ceiling, Math.max(floor, Math.hypot(e, n) * radiansPerStep))
      t += step / segment
      if (t >= 1) break
      out.push([e0 + (e1 - e0) * t, n0 + (n1 - n0) * t])
    }
    out.push([e1, n1])
  }
  return out.map(([e, n]) => [pose.lng + e / mx, pose.lat + n / METRES_PER_DEGREE_LAT])
}

/** Whether no raw vertex comes near the frame: then the feature is skipped before it is densified. */
function clearlyOutOfView(pose: PhotoPose, geometry: GeoJSON.Geometry, ground: ElevationSource, lift: number) {
  const vertices = [...linesOf(geometry).flatMap((line) => line.coordinates), ...pointsOf(geometry)]
  if (!vertices.length) return true
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity
  for (const [lng, lat] of vertices) {
    const z = ground.elevationAt(lng, lat)
    // A vertex off the terrain or behind the camera says nothing about where the line between runs.
    if (!Number.isFinite(z)) return false
    const q = projectToPhoto(pose, lng, lat, z + lift)
    if (!q) return false
    minX = Math.min(minX, q.x)
    maxX = Math.max(maxX, q.x)
    minY = Math.min(minY, q.y)
    maxY = Math.max(maxY, q.y)
  }
  const marginX = pose.width * 0.1,
    marginY = pose.height * 0.1
  return maxX < -marginX || minX > pose.width + marginX || maxY < -marginY || minY > pose.height + marginY
}

function midpointOf(points: Point[]): { x: number; y: number; length: number } {
  let length = 0
  for (let i = 1; i < points.length; i++)
    length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  let walked = 0
  for (let i = 1; i < points.length; i++) {
    const step = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
    if (walked + step >= length / 2 && step > 0) {
      const t = (length / 2 - walked) / step
      return {
        x: points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t,
        y: points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t,
        length,
      }
    }
    walked += step
  }
  return { x: points[0][0], y: points[0][1], length }
}

/** A ring split at its start vertex leaves its first and last runs as two halves of one: join them. */
function joinRingEnds(parts: Point[][], before: number) {
  if (parts.length - before < 2) return
  const first = parts[before],
    last = parts[parts.length - 1]
  const [fx, fy] = first[0],
    [lx, ly] = last[last.length - 1]
  if (fx !== lx || fy !== ly) return
  parts[before] = [...last, ...first.slice(1)]
  parts.pop()
}

/**
 * Every feature drawn over the photo: the parts in sight and the parts hidden by nearer ground, clipped at the frame,
 * in the pose's photo pixels. A feature wholly out of the frame comes back with no runs.
 */
export function photoOverlay(
  pose: PhotoPose,
  buf: HitBuffer,
  features: readonly PhotoFeature[],
  options: PhotoOverlayOptions,
): PhotoFeaturePaths[] {
  const { ground } = options
  const settings = {
    liftMeters: options.liftMeters ?? PHOTO_OVERLAY_DEFAULTS.liftMeters,
    maxStepMeters: options.maxStepMeters ?? PHOTO_OVERLAY_DEFAULTS.maxStepMeters,
    minStepMeters: options.minStepMeters ?? PHOTO_OVERLAY_DEFAULTS.minStepMeters,
    stepPixels: options.stepPixels ?? PHOTO_OVERLAY_DEFAULTS.stepPixels,
  }
  const lift = settings.liftMeters
  const place = (lng: number, lat: number): Projected | null => {
    const z = ground.elevationAt(lng, lat)
    return Number.isFinite(z) ? project(pose, lng, lat, z + lift) : null
  }
  return features.map((feature) => {
    const runs = new Runs()
    const markers: PhotoMarker[] = []
    if (!clearlyOutOfView(pose, feature.geometry, ground, lift)) {
      for (const line of linesOf(feature.geometry)) {
        const beforeVisible = runs.visible.length,
          beforeHidden = runs.hidden.length
        addLine(
          buf,
          densify(pose, line.coordinates, settings).map(([lng, lat]) => place(lng, lat)),
          runs,
        )
        if (line.ring) {
          joinRingEnds(runs.visible, beforeVisible)
          joinRingEnds(runs.hidden, beforeHidden)
        }
      }
      for (const [lng, lat] of pointsOf(feature.geometry)) {
        const p = place(lng, lat)
        if (!p || p.x < 0 || p.y < 0 || p.x >= pose.width || p.y >= pose.height) continue
        markers.push({ x: p.x, y: p.y, visible: seen(buf, p) })
      }
    }
    const longest = runs.visible.map(midpointOf).sort((a, b) => b.length - a.length)[0]
    const marker = markers.find((entry) => entry.visible)
    return {
      layer: feature.layer,
      ...(feature.id !== undefined ? { id: feature.id } : {}),
      ...(feature.label !== undefined ? { label: feature.label } : {}),
      visible: runs.visible.map(pathData),
      hidden: runs.hidden.map(pathData),
      visibleParts: runs.visible,
      hiddenParts: runs.hidden,
      markers,
      labelAnchor: longest ? { x: longest.x, y: longest.y } : marker ? { x: marker.x, y: marker.y } : null,
    }
  })
}

// ---------------------------------------------------------------- reading aids

/** Distance the level line is drawn at by default: ground this far away at the eye's own height lies on it. */
export const LEVEL_LINE_METERS = 10_000

/** A point `meters` away along compass `bearing` at `altitude`, projected; null behind the camera. */
function projectAlong(pose: PhotoPose, bearing: number, meters: number, altitude: number) {
  const east = Math.sin(bearing * RAD) * meters,
    north = Math.cos(bearing * RAD) * meters
  return projectToPhoto(
    pose,
    pose.lng + east / metresPerDegreeLng(pose.lat),
    pose.lat + north / METRES_PER_DEGREE_LAT,
    altitude,
  )
}

/** A polyline clipped to the frame, as point lists. */
function clipPolyline(points: ReadonlyArray<{ x: number; y: number } | null>, w: number, h: number): Point[][] {
  const runs = new Runs()
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i]
    if (!a || !b) {
      runs.close()
      continue
    }
    const pa = { ...a, range: 0 },
      pb = { ...b, range: 0 }
    const clip = clipSegment(pa, pb, w, h)
    if (!clip) {
      runs.close()
      continue
    }
    if (clip[0] > 0) runs.close()
    runs.add(clip[0] === 0 ? pa : lerp(pa, pb, clip[0]), clip[1] === 1 ? pb : lerp(pa, pb, clip[1]), true)
    if (clip[1] < 1) runs.close()
  }
  runs.close()
  return runs.visible
}

/** Half the angle the frame spans across its diagonal, degrees. */
const halfDiagonalDegrees = (pose: PhotoPose) => Math.atan(Math.hypot(pose.width, pose.height) / 2 / pose.focalPx) / RAD

/**
 * The level line: where ground at the eye's own height `meters` away would sit, with the drop of the earth's curve
 * at that distance. Terrain drawn above it at that distance stands higher than the camera. SVG path data in photo
 * pixels, or null when the line is out of frame (an air photo looking well down).
 */
export function horizonLine(pose: PhotoPose, meters = LEVEL_LINE_METERS): string | null {
  const half = Math.min(179, halfDiagonalDegrees(pose) + 5)
  const steps = 180
  const points = Array.from({ length: steps + 1 }, (_, i) =>
    projectAlong(pose, pose.bearing - half + (2 * half * i) / steps, meters, pose.altitudeMeters),
  )
  const parts = clipPolyline(points, pose.width, pose.height)
  return parts.length ? parts.map(pathData).join('') : null
}

export type BearingTick = {
  /** Compass bearing, degrees clockwise from north. */
  bearing: number
  /** "N", "E", "S", "W", else the bearing as "035°". */
  label: string
  x: number
  y: number
  /** Unit vector in the photo pointing up the vertical through this bearing (towards the sky). */
  up: [number, number]
  /** The level line is out of frame here, so the tick sits on the frame's edge nearest it. */
  onEdge: boolean
}

const CARDINALS: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }

/**
 * Compass ticks every `stepDegrees`, on the level line where it is in frame, else on the frame's edge nearest it along
 * that bearing's vertical (an air photo looking down still shows which way is which).
 */
export function bearingTicks(pose: PhotoPose, stepDegrees = 5, meters = LEVEL_LINE_METERS): BearingTick[] {
  if (!(stepDegrees > 0)) return []
  const w = pose.width,
    h = pose.height
  const inFrame = (p: { x: number; y: number } | null) => !!p && p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h
  const ticks: BearingTick[] = []
  for (let bearing = 0; bearing < 360 - 1e-9; bearing += stepDegrees) {
    const b = Math.round(bearing * 1000) / 1000
    const level = projectAlong(pose, b, meters, pose.altitudeMeters)
    // The bearing's vertical: directions from 85° below to 85° above level, 1 km out.
    const vertical = Array.from({ length: 171 }, (_, i) => {
      const elevation = (-85 + i) * RAD
      return projectAlong(pose, b, 1000 * Math.cos(elevation), pose.altitudeMeters + 1000 * Math.sin(elevation))
    })
    let at: { x: number; y: number } | null = null
    let onEdge = false
    if (level && inFrame(level)) at = level
    else {
      const parts = clipPolyline(vertical, w, h)
      if (!parts.length) continue
      // The clipped end nearest the level, by elevation: the vertical runs from below to above.
      const ends = parts.flatMap((part) => [part[0], part[part.length - 1]])
      const target = level ?? vertical[85]
      const nearest = target
        ? ends.reduce((best, p) =>
            Math.hypot(p[0] - target.x, p[1] - target.y) < Math.hypot(best[0] - target.x, best[1] - target.y)
              ? p
              : best,
          )
        : ends[0]
      at = { x: nearest[0], y: nearest[1] }
      onEdge = true
    }
    // Up: from just below the level to just above it along the bearing.
    const below = projectAlong(pose, b, 1000, pose.altitudeMeters - 17),
      above = projectAlong(pose, b, 1000, pose.altitudeMeters + 17)
    let up: [number, number] = [0, -1]
    if (below && above) {
      const dx = above.x - below.x,
        dy = above.y - below.y
      const length = Math.hypot(dx, dy)
      if (length > 0) up = [dx / length, dy / length]
    }
    const rounded = normalizeBearing(Math.round(b))
    ticks.push({
      bearing: b,
      label:
        CARDINALS[rounded] && Math.abs(rounded - b) < 1e-9
          ? CARDINALS[rounded]
          : `${String(rounded).padStart(3, '0')}°`,
      x: at.x,
      y: at.y,
      up,
      onEdge,
    })
  }
  return ticks
}

/** Distances the contours are drawn at by default, metres. Not called fore-, middle- or background on purpose. */
export const DISTANCE_CONTOUR_METERS = [1000, 2000, 5000, 10000] as const

export type DistanceContour = {
  meters: number
  /** SVG path data in photo pixels; empty when the level is not in the photo. */
  d: string
  parts: Point[][]
  /** Middle of the longest piece, for its label. */
  labelAnchor: { x: number; y: number } | null
}

/**
 * Lines of equal distance from the camera, traced by marching squares over the hit buffer's distance field. Sky and
 * missing terrain are holes: no contour runs along the skyline because the sky is "far".
 */
export function distanceContours(
  buf: HitBuffer,
  levels: readonly number[] = DISTANCE_CONTOUR_METERS,
): DistanceContour[] {
  const { width, height, distance } = buf
  // Working pixel centres in photo pixels, as `buildHitBuffer` cast them: one scale for both axes.
  const scale = buf.photoWidth / width
  const px = (col: number) => (col + 0.5) * scale
  const py = (row: number) => (row + 0.5) * scale
  const horizontalEdges = width * height
  return levels.map((level) => {
    // Segment ends are keyed by the cell edge they lie on: horizontal edge (col, row)→(col+1, row) is row*width+col,
    // vertical edge (col, row)→(col, row+1) is that plus `horizontalEdges`. Two cells share each edge.
    const points = new Map<number, Point>()
    const segments: Array<[number, number]> = []
    const crossing = (key: number, value0: number, value1: number, x0: number, y0: number, x1: number, y1: number) => {
      if (!points.has(key)) {
        const t = (level - value0) / (value1 - value0)
        points.set(key, [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t])
      }
      return key
    }
    for (let row = 0; row + 1 < height; row++)
      for (let col = 0; col + 1 < width; col++) {
        const tl = distance[row * width + col],
          tr = distance[row * width + col + 1],
          br = distance[(row + 1) * width + col + 1],
          bl = distance[(row + 1) * width + col]
        if (!(Number.isFinite(tl) && Number.isFinite(tr) && Number.isFinite(br) && Number.isFinite(bl))) continue
        const code = (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) | (br >= level ? 2 : 0) | (bl >= level ? 1 : 0)
        if (code === 0 || code === 15) continue
        const x0 = px(col),
          x1 = px(col + 1),
          y0 = py(row),
          y1 = py(row + 1)
        const top = () => crossing(row * width + col, tl, tr, x0, y0, x1, y0)
        const bottom = () => crossing((row + 1) * width + col, bl, br, x0, y1, x1, y1)
        const left = () => crossing(horizontalEdges + row * width + col, tl, bl, x0, y0, x0, y1)
        const right = () => crossing(horizontalEdges + row * width + col + 1, tr, br, x1, y0, x1, y1)
        const centre = (tl + tr + br + bl) / 4 >= level
        switch (code) {
          case 1:
          case 14:
            segments.push([left(), bottom()])
            break
          case 2:
          case 13:
            segments.push([bottom(), right()])
            break
          case 3:
          case 12:
            segments.push([left(), right()])
            break
          case 4:
          case 11:
            segments.push([top(), right()])
            break
          case 6:
          case 9:
            segments.push([top(), bottom()])
            break
          case 7:
          case 8:
            segments.push([left(), top()])
            break
          case 5: // tr and bl high
            if (centre) segments.push([left(), top()], [bottom(), right()])
            else segments.push([left(), bottom()], [top(), right()])
            break
          case 10: // tl and br high
            if (centre) segments.push([top(), right()], [left(), bottom()])
            else segments.push([left(), top()], [bottom(), right()])
            break
        }
      }
    const parts = joinSegments(segments).map((keys) => keys.map((key) => points.get(key)!))
    const longest = parts.map(midpointOf).sort((a, b) => b.length - a.length)[0]
    return {
      meters: level,
      d: parts.map(pathData).join(''),
      parts,
      labelAnchor: longest ? { x: longest.x, y: longest.y } : null,
    }
  })
}

/** Chains segments that share an end into polylines (each end key is shared by at most two segments). */
function joinSegments(segments: ReadonlyArray<[number, number]>): number[][] {
  const byKey = new Map<number, number[]>()
  segments.forEach(([a, b], index) => {
    for (const key of [a, b]) {
      const list = byKey.get(key)
      if (list) list.push(index)
      else byKey.set(key, [index])
    }
  })
  const used = new Uint8Array(segments.length)
  const next = (key: number) => byKey.get(key)?.find((index) => !used[index])
  const extend = (chain: number[]) => {
    for (;;) {
      const end = chain[chain.length - 1]
      const index = next(end)
      if (index === undefined) return
      used[index] = 1
      const [a, b] = segments[index]
      chain.push(a === end ? b : a)
    }
  }
  const chains: number[][] = []
  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue
    used[start] = 1
    const chain = [...segments[start]]
    extend(chain)
    chain.reverse()
    extend(chain)
    chains.push(chain)
  }
  return chains
}
