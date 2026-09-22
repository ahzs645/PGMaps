/** Camera lifecycle, independent of React. Tested with a deterministic clock and a structural map adapter. */
import type { ElevationSource } from './terrain'
import {
  nearestStation,
  roadPlacement,
  roadLookAhead,
  smoothAngle,
  viewRotation,
  type DriveLookAt,
  type DriveStation,
  type RoadVertex,
} from './driveMath'
export type DrivePose = {
  distanceMeters: number
  stationIndex: number
  lng: number
  lat: number
  groundElevationMeters: number
  eyeElevationMeters: number
  bearing: number
  pitch: number
}
export type DriveStatus = 'waiting-for-terrain' | 'ready' | 'invalid-camera'
export type DriveOptions = {
  playing: boolean
  speedMetersPerSecond: number
  eyeHeightMeters: number
  lookAt: DriveLookAt | null
  spotBearing: number
  yaw: number
  tilt: number
  onPosition: (pose: DrivePose) => void
  onReachEnd?: () => void
  onStatus?: (status: DriveStatus) => void
}
type Gesture = { isEnabled(): boolean; disable(): unknown; enable(): unknown }
export type CameraOptions = {
  center?: { lng: number; lat: number } | [number, number]
  zoom?: number
  bearing?: number
  pitch?: number
  roll?: number
  elevation?: number
  padding?: unknown
}
export type DriveMap = {
  getCenter(): { lng: number; lat: number }
  getZoom(): number
  getBearing(): number
  getPitch(): number
  getRoll?(): number
  getElevation?(): number
  getCenterElevation?(): number
  getCameraTargetElevation?(): number
  getPadding?(): unknown
  getMaxPitch(): number
  setMaxPitch(value: number): unknown
  getCenterClampedToGround(): boolean
  setCenterClampedToGround(value: boolean): unknown
  getTerrain(): unknown
  queryTerrainElevation(point: [number, number]): number | null
  calculateCameraOptionsFromTo?(
    from: { lng: number; lat: number },
    altitudeFrom: number,
    to: { lng: number; lat: number },
    altitudeTo: number,
  ): CameraOptions
  calculateCameraOptionsFromCameraLngLatAltRotation(
    point: { lng: number; lat: number },
    altitude: number,
    bearing: number,
    pitch: number,
    roll: number,
  ): CameraOptions
  jumpTo(options: CameraOptions): unknown
  stop(): unknown
  dragPan?: Gesture
  dragRotate?: Gesture
  scrollZoom?: Gesture
  boxZoom?: Gesture
  doubleClickZoom?: Gesture
  keyboard?: Gesture
  touchZoomRotate?: Gesture
  touchPitch?: Gesture
}
const gestureNames = [
  'dragPan',
  'dragRotate',
  'scrollZoom',
  'boxZoom',
  'doubleClickZoom',
  'keyboard',
  'touchZoomRotate',
  'touchPitch',
] as const
export function finiteCamera(camera: CameraOptions): boolean {
  const center = camera.center,
    xy = Array.isArray(center) ? center : center ? [center.lng, center.lat] : []
  return (
    xy.length === 2 &&
    xy.every(Number.isFinite) &&
    [camera.zoom, camera.bearing, camera.pitch, camera.roll, camera.elevation ?? 0].every(Number.isFinite)
  )
}
export class DriveController {
  private distance = 0
  private lastTime: number | null = null
  private lastReport = -Infinity
  private lastPoseKey = ''
  private rotation: { bearing: number; pitch: number } | null = null
  private ended = false
  private started = false
  private status: DriveStatus | null = null
  private snapshot: CameraOptions | null = null
  private maxPitch = 85
  private clamped = true
  private enabled = new Map<Gesture, boolean>()
  constructor(
    private map: DriveMap,
    private path: RoadVertex[],
    private stations: DriveStation[],
    private elevation?: ElevationSource | null,
  ) {}
  start(distance: number) {
    if (this.started) return
    this.started = true
    const center = this.map.getCenter()
    this.snapshot = {
      center: [center.lng, center.lat],
      zoom: this.map.getZoom(),
      bearing: this.map.getBearing(),
      pitch: this.map.getPitch(),
      roll: this.map.getRoll?.() ?? 0,
    }
    const elevation =
      this.map.getCenterElevation?.() ?? this.map.getElevation?.() ?? this.map.getCameraTargetElevation?.() ?? 0
    if (Number.isFinite(elevation)) this.snapshot.elevation = elevation
    const padding = this.map.getPadding?.()
    if (padding) this.snapshot.padding = padding
    this.maxPitch = this.map.getMaxPitch()
    this.clamped = this.map.getCenterClampedToGround()
    this.map.stop()
    this.map.setCenterClampedToGround(false)
    this.map.setMaxPitch(110)
    for (const name of gestureNames) {
      const handler = this.map[name]
      if (handler) {
        this.enabled.set(handler, handler.isEnabled())
        handler.disable()
      }
    }
    this.seek(distance)
  }
  seek(distance: number) {
    this.distance = Math.max(
      0,
      Math.min(this.path[this.path.length - 1]?.distanceAlongMeters ?? 0, Number.isFinite(distance) ? distance : 0),
    )
    this.lastTime = null
    this.rotation = null
    this.lastPoseKey = ''
    this.lastReport = -Infinity
    this.ended = false
  }
  private setStatus(status: DriveStatus, options: DriveOptions) {
    if (status !== this.status) {
      this.status = status
      options.onStatus?.(status)
    }
  }
  tick(now: number, options: DriveOptions): void {
    if (!this.started || !Number.isFinite(now)) return
    const gap = this.lastTime === null ? 0 : Math.max(0, (now - this.lastTime) / 1000)
    // Preserve real travel speed at low frame rates. A long browser stall or
    // unavailable terrain holds position rather than accumulating a leap.
    const elapsed = this.status === 'ready' && gap <= 0.5 ? gap : 0
    this.lastTime = now
    const total = this.path[this.path.length - 1]?.distanceAlongMeters ?? 0
    const next = Math.max(
      0,
      Math.min(total, this.distance + (options.playing ? Math.max(0, options.speedMetersPerSecond) * elapsed : 0)),
    )
    const placement = roadPlacement(this.path, next)
    if (!placement) return
    const terrainAt = (point: { lng: number; lat: number }) =>
      this.elevation === undefined
        ? this.map.queryTerrainElevation([point.lng, point.lat])
        : (this.elevation?.elevationAt(point.lng, point.lat) ?? null)
    // MapLibre can return 0 (not null) for an unloaded camera tile. A fixed
    // decoded mosaic avoids a false sea-level camera and terrain-LOD bobbing.
    const ground = this.map.getTerrain() ? terrainAt(placement) : null
    // No sea-level fallback, no accumulated jump while terrain is loading.
    if (ground === null || !Number.isFinite(ground)) {
      this.setStatus('waiting-for-terrain', options)
      return
    }
    if (!Number.isFinite(options.eyeHeightMeters) || options.eyeHeightMeters <= 0) {
      this.setStatus('invalid-camera', options)
      return
    }
    const eye = ground + options.eyeHeightMeters
    const ahead = roadLookAhead(this.path, next, Math.max(15, options.speedMetersPerSecond * 1.5))
    const beforeGround = ahead ? terrainAt(ahead.before) : null
    const afterGround = ahead ? terrainAt(ahead.after) : null
    const grade =
      ahead &&
      ahead.span > 1 &&
      beforeGround !== null &&
      afterGround !== null &&
      Number.isFinite(beforeGround) &&
      Number.isFinite(afterGround)
        ? (Math.atan2(afterGround - beforeGround, ahead.span) * 180) / Math.PI
        : 0
    const desired = viewRotation(
      placement,
      eye,
      options.lookAt,
      this.path.length > 1 ? (ahead?.bearing ?? placement.travelBearing) : options.spotBearing,
      options.yaw,
      options.tilt + (options.lookAt ? 0 : grade),
    )
    // Damping the direction preserves the actual road position and eye clearance.
    // Paused look controls stay immediate; seek resets the filter completely.
    const amount = 1 - Math.exp(-elapsed / 0.18)
    const rotation =
      this.rotation && options.playing
        ? {
            bearing: smoothAngle(this.rotation.bearing, desired.bearing, amount),
            pitch: this.rotation.pitch + (desired.pitch - this.rotation.pitch) * amount,
          }
        : desired
    this.rotation = rotation
    const key = [placement.lng, placement.lat, eye, rotation.bearing, rotation.pitch].join('|')
    if (key !== this.lastPoseKey) {
      // Keep the map target close to the eye. The rotation-only helper targets
      // kilometres away near the horizon, giving a near clip plane hundreds of
      // metres out: it clips the road and all the detailed roadside trees.
      const metres = 40,
        radians = (rotation.bearing * Math.PI) / 180
      const target = {
        lng: placement.lng + (Math.sin(radians) * metres) / (111320 * Math.cos((placement.lat * Math.PI) / 180)),
        lat: placement.lat + (Math.cos(radians) * metres) / 111320,
      }
      const targetElevation = eye + Math.tan(((rotation.pitch - 90) * Math.PI) / 180) * metres
      const camera = this.map.calculateCameraOptionsFromTo
        ? { ...this.map.calculateCameraOptionsFromTo(placement, eye, target, targetElevation), roll: 0 }
        : this.map.calculateCameraOptionsFromCameraLngLatAltRotation(
            placement,
            eye,
            rotation.bearing,
            rotation.pitch,
            0,
          )
      if (!finiteCamera(camera)) {
        this.setStatus('invalid-camera', options)
        return
      }
      this.map.jumpTo(camera)
      this.lastPoseKey = key
    }
    this.distance = next
    this.setStatus('ready', options)
    if (now - this.lastReport > 100) {
      this.lastReport = now
      options.onPosition({
        distanceMeters: next,
        stationIndex: nearestStation(this.stations, next),
        lng: placement.lng,
        lat: placement.lat,
        groundElevationMeters: ground,
        eyeElevationMeters: eye,
        ...rotation,
      })
    }
    if (options.playing && next === total && total > 0 && !this.ended) {
      this.ended = true
      options.onReachEnd?.()
    }
    if (!options.playing && next < total) this.ended = false
  }
  stop() {
    if (!this.started) return
    this.started = false
    this.map.stop()
    // Restore in an order that does not clamp the eye-level view before restoring its centre.
    if (this.snapshot) this.map.jumpTo(this.snapshot)
    this.map.setMaxPitch(this.maxPitch)
    this.map.setCenterClampedToGround(this.clamped)
    for (const [handler, wasEnabled] of this.enabled) if (wasEnabled) handler.enable()
    this.enabled.clear()
    this.lastTime = null
  }
}
