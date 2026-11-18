import { cameraAxes, localOffset, type PhotoPose } from './photoPose'
import type { SkylineRay } from './skylineReach'
import { castGroundRay } from './photoViews'
import type { ElevationSource } from '@/lib/forestry/terrain/terrain'
import { polygonAreaMeters, type PolygonGeometry } from './visibility'

export type Projection = 'pinhole' | 'cylindrical' | 'equirectangular'
export type ReferenceCamera = Pick<PhotoPose, 'lng' | 'lat' | 'altitudeMeters' | 'bearing' | 'pitch' | 'roll'> & {
  projection: Projection
  span: number
  left: number
  top: number
  width: number
  height: number
}
export type Pixel = [number, number]
export type RegistrationPoint = { pixel: Pixel; lng: number; lat: number; elevation: number; heldOut: boolean }
const rad = Math.PI / 180
function focal(c: ReferenceCamera) {
  return c.projection === 'pinhole' ? c.width / (2 * Math.tan((c.span * rad) / 2)) : c.width / (c.span * rad)
}
export function imageRay(c: ReferenceCamera, [u, v]: Pixel) {
  const x = (u - c.left - c.width / 2) / focal(c),
    y = (v - c.top - c.height / 2) / focal(c)
  const [r, d, f] =
    c.projection === 'pinhole'
      ? [x, y, 1]
      : c.projection === 'cylindrical'
        ? [Math.sin(x), y, Math.cos(x)]
        : [Math.sin(x) * Math.cos(y), Math.sin(y), Math.cos(x) * Math.cos(y)]
  const axes = cameraAxes(c),
    n = Math.hypot(r, d, f)
  return axes.forward.map((a, i) => (r * axes.right[i] + d * axes.down[i] + f * a) / n)
}
export function imagePixel(c: ReferenceCamera, p: Pick<RegistrationPoint, 'lng' | 'lat' | 'elevation'>): Pixel | null {
  return directionPixel(c, localOffset(c, p.lng, p.lat, p.elevation))
}
function directionPixel(c: ReferenceCamera, delta: number[]): Pixel | null {
  const axes = cameraAxes(c)
  const dot = (v: number[]) => v.reduce((s, a, i) => s + a * delta[i], 0)
  const r = dot(axes.right),
    d = dot(axes.down),
    f = dot(axes.forward),
    horizontal = Math.hypot(r, f)
  if (horizontal < 0.001 || (c.projection === 'pinhole' && f <= 0)) return null
  const x = c.projection === 'pinhole' ? r / f : Math.atan2(r, f)
  const y =
    c.projection === 'pinhole' ? d / f : c.projection === 'cylindrical' ? d / horizontal : Math.atan2(d, horizontal)
  return [c.left + c.width / 2 + x * focal(c), c.top + c.height / 2 + y * focal(c)]
}
export function skylinePixel(camera: ReferenceCamera, ray: SkylineRay) {
  if (ray.elevationAngleDegrees == null) return null
  const a = ray.bearingDegrees * rad,
    h = ray.elevationAngleDegrees * rad
  return directionPixel(camera, [Math.sin(a) * Math.cos(h), Math.cos(a) * Math.cos(h), Math.sin(h)])
}
export function pixelError(c: ReferenceCamera, p: RegistrationPoint) {
  const pixel = imagePixel(c, p)
  return pixel ? Math.hypot(pixel[0] - p.pixel[0], pixel[1] - p.pixel[1]) : null
}
/** Refine two angular parameters at the supplied station. Held-out points never enter the fit. */
export function refineAim(
  camera: ReferenceCamera,
  points: RegistrationPoint[],
  skyline?: { rays: SkylineRay[]; marks: Pixel[] },
) {
  const fit = points.filter((p) => !p.heldOut)
  if (fit.length < 2 || !fit.some((p) => Math.hypot(p.pixel[0] - fit[0].pixel[0], p.pixel[1] - fit[0].pixel[1]) > 1))
    throw Error('Use at least two distinct fit points.')
  // The overlay is sampled at each integer bearing. Omit partially covered bearings from the fit.
  const angles = new Map(
    skyline?.rays
      .filter((r) => r.unknownMeters === 0 && r.elevationAngleDegrees !== null)
      .map((r) => [r.bearingDegrees, r.elevationAngleDegrees!]),
  )
  const cost = (c: ReferenceCamera) => {
    let total = fit.reduce((s, p) => s + (pixelError(c, p) ?? 1e8) ** 2, 0)
    for (const mark of skyline?.marks ?? []) {
      const [east, north, up] = imageRay(c, mark)
      const bearing = (Math.atan2(east, north) / rad + 360) % 360
      const i = Math.floor(bearing),
        a = angles.get(i),
        b = angles.get((i + 1) % 360)
      if (a === undefined || b === undefined) return Infinity
      const elevation = a + (b - a) * (bearing - i)
      total += ((Math.asin(Math.max(-1, Math.min(1, up))) - elevation * rad) * focal(c)) ** 2
    }
    return total
  }
  let best = camera,
    score = cost(camera)
  for (const step of [8, 4, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02]) {
    for (let pass = 0; pass < 24; pass++) {
      const prev = best
      for (const dx of [-step, 0, step])
        for (const dy of [-step, 0, step]) {
          const candidate = {
            ...prev,
            bearing: (prev.bearing + dx + 360) % 360,
            pitch: Math.max(-89, Math.min(89, prev.pitch + dy)),
          }
          const error = cost(candidate)
          if (error < score) {
            best = candidate
            score = error
          }
        }
      if (best === prev) break
    }
  }
  if (!Number.isFinite(score))
    throw Error('The marked skyline extends beyond complete terrain coverage. Remove those marks or load more terrain.')
  return best
}
/** Subdivide edges in image space. A missing ray or a large change of range breaks the outline. */
export function projectTrace(c: ReferenceCamera, pixels: Pixel[], ground: ElevationSource, ridgeJump: number) {
  if (pixels.length < 3 || pixels.length > 160 || !(ridgeJump > 0))
    throw Error('Use 3–160 trace vertices and a positive ridge-gap tolerance.')
  const samples: Pixel[] = []
  pixels.forEach((a, i) => {
    const b = pixels[(i + 1) % pixels.length]
    const n = Math.max(1, Math.ceil(Math.hypot(a[0] - b[0], a[1] - b[1]) / Math.max(1, c.width / 96)))
    if (samples.length + n > 1024) throw Error('Use a shorter trace or a larger image crop.')
    for (let j = 0; j < n; j++) samples.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n])
  })
  const hits = samples.map((p) => castGroundRay(c, ground, imageRay(c, p)))
  const gaps = samples.filter((_, i) => {
    const h = hits[i],
      next = hits[(i + 1) % hits.length]
    return !h || !next || Math.abs(h.distanceMeters - next.distanceMeters) > ridgeJump
  })
  const ring = hits.flatMap((h) => (h ? [[h.lng, h.lat]] : []))
  const geometry: PolygonGeometry | null = gaps.length ? null : { type: 'Polygon', coordinates: [[...ring, ring[0]]] }
  if (geometry && polygonAreaMeters(geometry) <= 0) throw Error('Trace three distinct points enclosing an area.')
  return { gaps, geometry }
}

/** A numerical run may use an accepted source station when the current image, pose and controls still match it. */
export function acceptedReferenceStation(values: import('./referenceMeasurements').ReferenceValues) {
  try {
    const [image, c, controls, marks] = JSON.parse(values.acceptedCamera ?? '')
    if (!image || image !== values.referenceImage || !c || values.projection !== c.projection) return null
    const keys = {
      longitude: 'lng',
      latitude: 'lat',
      eyeAltitude: 'altitudeMeters',
      heading: 'bearing',
      pitch: 'pitch',
      roll: 'roll',
      span: 'span',
      cropLeft: 'left',
      cropTop: 'top',
      cropWidth: 'width',
      cropHeight: 'height',
    } as const
    for (const [field, key] of Object.entries(keys)) {
      const text = values[field as keyof typeof keys]
      if (!Number.isFinite(c[key]) || (text?.trim() && Number(text) !== c[key])) return null
      if (!text?.trim() && ['longitude', 'latitude', 'eyeAltitude', 'heading', 'span'].includes(field)) return null
      if (!text?.trim() && ['pitch', 'roll', 'cropLeft', 'cropTop'].includes(field) && c[key] !== 0) return null
    }
    if (
      JSON.stringify(controls) !== JSON.stringify(JSON.parse(values.controls || '[]')) ||
      JSON.stringify(marks ?? []) !== JSON.stringify(JSON.parse(values.skylineTrace || '[]'))
    )
      return null
    if (Math.abs(c.lng) > 180 || Math.abs(c.lat) >= 85 || c.altitudeMeters < -500 || c.altitudeMeters > 9000)
      return null
    return { lng: Number(c.lng), lat: Number(c.lat), elevationMeters: Number(c.altitudeMeters) }
  } catch {
    return null
  }
}
