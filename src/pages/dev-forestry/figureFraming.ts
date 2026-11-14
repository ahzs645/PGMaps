/**
 * Frames a landform for an analysis-sheet capture the way the reference sheets crop it (docs 03, 22,
 * 23): the landform's visible vertical extent mid-frame, sky above the skyline about 15–25 % of the
 * height, ground or water below the landform's base at most about 15 %, small side margins. The
 * lens is a 50 mm full-frame equivalent (39.6° across) unless a field photo gives another; a
 * landform wider than one frame is covered by several frames side by side across its bearings, as
 * the consultants' 60–141° panoramas are.
 *
 * Two steps, both pure: `landformAngularExtent` reads, from the eye over the DEM, the bearings and
 * elevation angles of the landform ground the eye can see (a running horizon along rays, earth
 * curvature and refraction as the run's sightlines); `planFraming` turns that extent into cameras.
 * Ported from the VIA figure-style prototype's `framing.ts` (November 2026). No DOM or network access.
 */
import type { ElevationSource } from './terrain'
import {
  earthCurvatureDropMeters,
  metersPerDegree,
  pointInPolygon,
  polygonBounds,
  type PolygonGeometry,
} from './visibility'

const DEG = Math.PI / 180

/** Horizontal field of a 50 mm lens on a 36 mm frame, degrees. */
export const HFOV_50_MM = (2 * Math.atan(18 / 50)) / DEG
/** Full-frame equivalent focal length of a horizontal field, mm. */
export const focalForHfov = (hfovDeg: number) => 18 / Math.tan((hfovDeg * DEG) / 2)

/** What the eye sees of the landform: bearings clockwise from north, elevation angles above level. */
export type AngularExtent = {
  /** Left and right bearings; `azRightDeg` may exceed 360 across north. */
  azLeftDeg: number
  azRightDeg: number
  elTopDeg: number
  elBottomDeg: number
  /** Range bins of landform the eye sees. */
  visibleBins: number
}

export type ExtentOptions = {
  /** Angle between rays, degrees. */
  rayStepDegrees?: number
  binMeters?: number
  maxDistanceMeters?: number
  /** Share trimmed off each end of the bearing and elevation distributions, so a stray bin does not widen the frame. */
  trim?: number
}

const wrap360 = (deg: number) => ((deg % 360) + 360) % 360

/** The landform's bearings seen from the eye, as one arc: [start, span]. */
function bearingArc(eye: { lng: number; lat: number }, landform: PolygonGeometry): [number, number] {
  const scale = metersPerDegree(eye.lat)
  const rings = landform.type === 'Polygon' ? [landform.coordinates[0]] : landform.coordinates.map((p) => p[0])
  const bearings = rings
    .flat()
    .map(([lng, lat]) =>
      wrap360((Math.atan2((lng - eye.lng) * scale.lng, (lat - eye.lat) * scale.lat) * 180) / Math.PI),
    )
    .sort((a, b) => a - b)
  if (pointInPolygon(landform, eye.lng, eye.lat) || bearings.length < 2) return [0, 360]
  // The smallest arc holding every vertex starts after the widest gap.
  let gap = -1,
    start = 0
  for (let i = 0; i < bearings.length; i++) {
    const next = i + 1 < bearings.length ? bearings[i + 1] : bearings[0] + 360
    if (next - bearings[i] > gap) {
      gap = next - bearings[i]
      start = wrap360(next)
    }
  }
  return [start, 360 - gap]
}

/**
 * The bearings and elevation angles of the landform ground the eye sees, or null when none of it
 * is in view. `eye.elevation` is the eye's height above sea level.
 */
export function landformAngularExtent(
  source: Pick<ElevationSource, 'elevationAt'>,
  eye: { lng: number; lat: number; elevation: number },
  landform: PolygonGeometry,
  options: ExtentOptions = {},
): AngularExtent | null {
  const step = options.rayStepDegrees ?? 0.25
  const bin = options.binMeters ?? 25
  const trim = options.trim ?? 0.01
  const scale = metersPerDegree(eye.lat)
  const [w, s, e, n] = polygonBounds(landform)
  const corners = [
    [w, s],
    [e, s],
    [w, n],
    [e, n],
  ].map(([lng, lat]) => Math.hypot((lng - eye.lng) * scale.lng, (lat - eye.lat) * scale.lat))
  const reach = Math.min(options.maxDistanceMeters ?? 30_000, Math.max(...corners) + bin)
  const [start, span] = bearingArc(eye, landform)
  const rays = Math.max(2, Math.min(1440, Math.ceil(span / step) + 1))
  const rayStep = span / (rays - 1)
  const bins = Math.max(2, Math.min(2000, Math.ceil(reach / bin)))
  const azimuths: number[] = []
  const elevations: number[] = []
  for (let k = 0; k < rays; k++) {
    const az = start + k * rayStep
    const sin = Math.sin(az * DEG),
      cos = Math.cos(az * DEG)
    let horizon = -Infinity
    for (let j = 1; j < bins; j++) {
      const d = j * bin
      const lng = eye.lng + (d * sin) / scale.lng,
        lat = eye.lat + (d * cos) / scale.lat
      const z = source.elevationAt(lng, lat)
      if (!Number.isFinite(z)) continue
      const tangent = (z - earthCurvatureDropMeters(d) - eye.elevation) / d
      const visible = tangent >= horizon - 1e-9
      if (tangent > horizon) horizon = tangent
      if (!visible || !pointInPolygon(landform, lng, lat)) continue
      azimuths.push(az)
      elevations.push(Math.atan(tangent) / DEG)
    }
  }
  if (!azimuths.length) return null
  azimuths.sort((a, b) => a - b)
  elevations.sort((a, b) => a - b)
  const q = (values: number[], t: number) =>
    values[Math.min(values.length - 1, Math.max(0, Math.floor(t * values.length)))]
  return {
    azLeftDeg: q(azimuths, trim),
    azRightDeg: q(azimuths, 1 - trim),
    elBottomDeg: q(elevations, trim * 2),
    elTopDeg: q(elevations, 1 - trim * 2),
    visibleBins: azimuths.length,
  }
}

export type FramingRule = {
  /** Horizontal field of one frame, degrees: the lens. */
  lensHfovDeg?: number
  /**
   * Widest the whole capture may be, width / height: a long, low landform makes a strip (the
   * reference sheets' run to about 3.3:1), never a frame mostly of sky.
   */
  maxAspect?: number
  /** Sky share above the skyline. */
  skyShare?: number
  /** Most ground or water below the landform's base. */
  groundShareMax?: number
  /** Margin each side of the landform, as a share of its bearing span. */
  sideMargin?: number
  /** Most frames joined across a wide landform. */
  maxFrames?: number
}

export const FRAMING_DEFAULTS = {
  lensHfovDeg: HFOV_50_MM,
  maxAspect: 4,
  skyShare: 0.2,
  groundShareMax: 0.12,
  sideMargin: 0.05,
  maxFrames: 4,
} as const

/** One camera of the capture: where it looks and how much it takes in. */
export type FrameCamera = {
  bearingDeg: number
  /** Elevation angle of the frame's centre above level, degrees: a map pitch of 90 + this. */
  pitchDeg: number
  hfovDeg: number
  vfovDeg: number
}

export type FramingPlan = {
  frames: FrameCamera[]
  /** Bearing span of all frames together, degrees. */
  totalHfovDeg: number
  vfovDeg: number
  /** Sky above the skyline and ground below the landform's base, shares of the height. */
  shares: { sky: number; ground: number }
  /** The lens and coverage, for the sheet's caption. */
  label: string
}

/**
 * Cameras that frame `extent`: one frame of the lens when the landform fits it, else up to
 * `maxFrames` frames of the lens side by side across the landform's bearings (a landform wider
 * than that is cropped to the frames round its centre). The vertical window keeps about `skyShare`
 * above the skyline and at most `groundShareMax` below the landform.
 */
export function planFraming(extent: AngularExtent, rule: FramingRule = {}): FramingPlan {
  const r = { ...FRAMING_DEFAULTS, ...rule }
  const span = Math.min(170, Math.max(0.5, extent.azRightDeg - extent.azLeftDeg))
  const centre = wrap360(extent.azLeftDeg + span / 2)
  const needed = span * (1 + 2 * r.sideMargin)
  const count = Math.max(1, Math.min(r.maxFrames, Math.ceil(needed / r.lensHfovDeg - 1e-9)))
  const delta = Math.max(0.3, extent.elTopDeg - extent.elBottomDeg)
  // Every frame is one lens wide; the window is as tall as the landform needs with its sky and
  // ground, and never so short that the capture is wider than `maxAspect`.
  const lens = r.lensHfovDeg
  const total = count * lens
  const vfov = Math.min(90, Math.max(delta / (1 - r.skyShare - r.groundShareMax), total / r.maxAspect))
  const spare = vfov - delta
  const ground = Math.min(r.groundShareMax * vfov, Math.max(0, spare * 0.4))
  const bottom = extent.elBottomDeg - ground
  const pitch = bottom + vfov / 2
  const left = centre - total / 2
  const frames = Array.from({ length: count }, (_, i) => ({
    bearingDeg: wrap360(left + lens * (i + 0.5)),
    pitchDeg: pitch,
    hfovDeg: lens,
    vfovDeg: vfov,
  }))
  const shares = { sky: (bottom + vfov - extent.elTopDeg) / vfov, ground: ground / vfov }
  const focal = Math.round(focalForHfov(lens))
  const label =
    count === 1
      ? `${focal} mm full-frame equivalent, ${lens.toFixed(1)}° across, facing ${Math.round(frames[0].bearingDeg)}°`
      : `${count} frames of ${focal} mm (${lens.toFixed(1)}° each), ${total.toFixed(0)}° from ${Math.round(wrap360(left))}° to ${Math.round(wrap360(left + total))}°`
  return { frames, totalHfovDeg: total, vfovDeg: vfov, shares, label }
}

/**
 * A fixed frame for the analysis sheet, as a reference VIA's panorama was taken: its centre bearing and horizontal
 * span, and, when known (a fitted camera), its centre pitch and vertical field.
 */
export type FigureFrame = { bearingDeg: number; spanDeg: number; pitchDeg?: number; vfovDeg?: number }

/** Widest single frame of a fixed framing; wider spans are tiled, which approximates a cylindrical panorama. */
export const FIXED_FRAME_MAX_HFOV = 40

export function parseFigureFrame(raw: unknown): FigureFrame | null {
  const value = raw as Partial<FigureFrame> | null
  if (!value || typeof value !== 'object') return null
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
  if (!finite(value.bearingDeg) || !finite(value.spanDeg) || value.spanDeg <= 0 || value.spanDeg > 170) return null
  return {
    bearingDeg: wrap360(value.bearingDeg),
    spanDeg: value.spanDeg,
    ...(finite(value.pitchDeg) && Math.abs(value.pitchDeg) < 45 ? { pitchDeg: value.pitchDeg } : {}),
    ...(finite(value.vfovDeg) && value.vfovDeg > 1 && value.vfovDeg < 90 ? { vfovDeg: value.vfovDeg } : {}),
  }
}

/**
 * Frames covering a fixed bearing span exactly: as few frames as keep each at most `FIXED_FRAME_MAX_HFOV` across,
 * side by side. The pitch and vertical field are the frame's own when given; else the vertical window comes from the
 * landform's extent with room for the water and ground below it, as reference panoramas keep them.
 */
export function planFixedFraming(frame: FigureFrame, extent: AngularExtent | null): FramingPlan {
  const count = Math.max(1, Math.ceil(frame.spanDeg / FIXED_FRAME_MAX_HFOV - 1e-9))
  const lens = frame.spanDeg / count
  const delta = extent ? Math.max(0.3, extent.elTopDeg - extent.elBottomDeg) : 4
  const vfov = frame.vfovDeg ?? Math.min(60, Math.max(delta / 0.45, frame.spanDeg / 3))
  const pitch = frame.pitchDeg ?? (extent ? extent.elBottomDeg - vfov * 0.3 + vfov / 2 : 0)
  const left = frame.bearingDeg - frame.spanDeg / 2
  const frames = Array.from({ length: count }, (_, i) => ({
    bearingDeg: wrap360(left + lens * (i + 0.5)),
    pitchDeg: pitch,
    hfovDeg: lens,
    vfovDeg: vfov,
  }))
  const top = pitch + vfov / 2
  const bottom = pitch - vfov / 2
  const shares = extent
    ? { sky: Math.max(0, (top - extent.elTopDeg) / vfov), ground: Math.max(0, (extent.elBottomDeg - bottom) / vfov) }
    : { sky: 0.3, ground: 0.3 }
  const focal = Math.round(focalForHfov(lens))
  const label = `fixed frame: ${count} frame${count === 1 ? '' : 's'} of ${focal} mm (${lens.toFixed(1)}° each), ${frame.spanDeg.toFixed(0)}° from ${Math.round(wrap360(left))}° to ${Math.round(wrap360(left + frame.spanDeg))}°`
  return { frames, totalHfovDeg: frame.spanDeg, vfovDeg: vfov, shares, label }
}

/**
 * The part of a canvas showing `frame` when the map is drawn at its `hfovDeg` across: the map's
 * vertical field to set, and the centred crop (shares of width and height) that leaves the frame's
 * own window. Never stretched: the canvas covers at least the frame both ways.
 */
export function canvasWindow(frame: FrameCamera, canvasAspect: number) {
  const tanH = Math.tan((frame.hfovDeg * DEG) / 2),
    tanV = Math.tan((frame.vfovDeg * DEG) / 2)
  // The map's vertical field when the canvas is exactly as wide as the frame.
  const canvasTanV = tanH / canvasAspect
  const mapTanV = Math.max(canvasTanV, tanV)
  return {
    verticalFovDeg: (2 * Math.atan(mapTanV)) / DEG,
    crop: { width: Math.min(1, tanH / (mapTanV * canvasAspect)), height: Math.min(1, tanV / mapTanV) },
  }
}

/**
 * Where a ground point lands in a captured frame `width` × `height` pixels, by a pinhole camera at
 * the eye looking along the frame's bearing and pitch: the same projection MapLibre draws the
 * frame with, without earth curvature, which the map's terrain does not have. Null behind the
 * camera or outside the frame. Pure, so callouts can be placed after the map's camera is restored.
 */
export function projectToFrame(
  frame: FrameCamera,
  eye: { lng: number; lat: number; elevation: number },
  size: { width: number; height: number },
): (lng: number, lat: number, elevation: number) => [number, number] | null {
  const scale = metersPerDegree(eye.lat)
  const b = frame.bearingDeg * DEG,
    p = frame.pitchDeg * DEG
  const forward = [Math.sin(b) * Math.cos(p), Math.cos(b) * Math.cos(p), Math.sin(p)]
  const right = [Math.cos(b), -Math.sin(b), 0]
  const up = [-Math.sin(b) * Math.sin(p), -Math.cos(b) * Math.sin(p), Math.cos(p)]
  const tanH = Math.tan((frame.hfovDeg * DEG) / 2),
    tanV = Math.tan((frame.vfovDeg * DEG) / 2)
  return (lng, lat, elevation) => {
    const d = [(lng - eye.lng) * scale.lng, (lat - eye.lat) * scale.lat, elevation - eye.elevation]
    const dot = (v: number[]) => v[0] * d[0] + v[1] * d[1] + v[2] * d[2]
    const z = dot(forward)
    if (z <= 1e-6) return null
    const x = size.width / 2 + (dot(right) / z / tanH) * (size.width / 2)
    const y = size.height / 2 - (dot(up) / z / tanV) * (size.height / 2)
    return x >= 0 && y >= 0 && x <= size.width && y <= size.height ? [x, y] : null
  }
}

/**
 * The projector for frames joined side by side, each `frameWidth` pixels wide: a point is
 * projected into the first frame that holds it, shifted by that frame's offset.
 */
export function projectToFrames(
  frames: readonly FrameCamera[],
  eye: { lng: number; lat: number; elevation: number },
  size: { frameWidth: number; height: number },
): (lng: number, lat: number, elevation: number) => [number, number] | null {
  const each = frames.map((frame) => projectToFrame(frame, eye, { width: size.frameWidth, height: size.height }))
  return (lng, lat, elevation) => {
    for (let i = 0; i < each.length; i++) {
      const p = each[i](lng, lat, elevation)
      if (p) return [p[0] + i * size.frameWidth, p[1]]
    }
    return null
  }
}
