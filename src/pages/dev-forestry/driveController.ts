/** Camera lifecycle, independent of React. Tested with a deterministic clock and a structural map adapter. */
import { nearestStation, roadPlacement, viewRotation, type DriveLookAt, type DriveStation, type RoadVertex } from './driveMath'
export type DrivePose = { distanceMeters: number; stationIndex: number; lng: number; lat: number; groundElevationMeters: number; eyeElevationMeters: number; bearing: number; pitch: number }
export type DriveStatus = 'waiting-for-terrain' | 'ready' | 'invalid-camera'
export type DriveOptions = { playing: boolean; speedMetersPerSecond: number; eyeHeightMeters: number; lookAt: DriveLookAt | null; spotBearing: number; yaw: number; tilt: number; onPosition: (pose: DrivePose) => void; onReachEnd?: () => void; onStatus?: (status: DriveStatus) => void }
type Gesture = { isEnabled(): boolean; disable(): unknown; enable(): unknown }
export type CameraOptions = { center?: { lng: number; lat: number } | [number, number]; zoom?: number; bearing?: number; pitch?: number; roll?: number; elevation?: number; padding?: unknown }
export type DriveMap = {
  getCenter(): { lng: number; lat: number }; getZoom(): number; getBearing(): number; getPitch(): number
  getRoll?(): number; getElevation?(): number; getCenterElevation?(): number; getCameraTargetElevation?(): number; getPadding?(): unknown
  getMaxPitch(): number; setMaxPitch(value: number): unknown
  getCenterClampedToGround(): boolean; setCenterClampedToGround(value: boolean): unknown
  getTerrain(): unknown; queryTerrainElevation(point: [number, number]): number | null
  calculateCameraOptionsFromCameraLngLatAltRotation(point: { lng: number; lat: number }, altitude: number, bearing: number, pitch: number, roll: number): CameraOptions
  jumpTo(options: CameraOptions): unknown; stop(): unknown
  dragPan?: Gesture; dragRotate?: Gesture; scrollZoom?: Gesture; boxZoom?: Gesture; doubleClickZoom?: Gesture; keyboard?: Gesture; touchZoomRotate?: Gesture; touchPitch?: Gesture
}
const gestureNames = ['dragPan', 'dragRotate', 'scrollZoom', 'boxZoom', 'doubleClickZoom', 'keyboard', 'touchZoomRotate', 'touchPitch'] as const
export function finiteCamera(camera: CameraOptions): boolean {
  const center = camera.center, xy = Array.isArray(center) ? center : center ? [center.lng, center.lat] : []
  return xy.length === 2 && xy.every(Number.isFinite) && [camera.zoom, camera.bearing, camera.pitch, camera.roll, camera.elevation ?? 0].every(Number.isFinite)
}
export class DriveController {
  private distance = 0
  private lastTime: number | null = null
  private lastReport = -Infinity
  private lastPoseKey = ''
  private ended = false
  private started = false
  private status: DriveStatus | null = null
  private snapshot: CameraOptions | null = null
  private maxPitch = 85
  private clamped = true
  private enabled = new Map<Gesture, boolean>()
  constructor(private map: DriveMap, private path: RoadVertex[], private stations: DriveStation[]) {}
  start(distance: number) {
    if (this.started) return
    this.started = true
    const center = this.map.getCenter()
    this.snapshot = { center: [center.lng, center.lat], zoom: this.map.getZoom(), bearing: this.map.getBearing(), pitch: this.map.getPitch(), roll: this.map.getRoll?.() ?? 0 }
    const elevation = this.map.getCenterElevation?.() ?? this.map.getElevation?.() ?? this.map.getCameraTargetElevation?.() ?? 0
    if (Number.isFinite(elevation)) this.snapshot.elevation = elevation
    const padding = this.map.getPadding?.(); if (padding) this.snapshot.padding = padding
    this.maxPitch = this.map.getMaxPitch(); this.clamped = this.map.getCenterClampedToGround()
    this.map.stop(); this.map.setCenterClampedToGround(false); this.map.setMaxPitch(110)
    for (const name of gestureNames) { const handler = this.map[name]; if (handler) { this.enabled.set(handler, handler.isEnabled()); handler.disable() } }
    this.seek(distance)
  }
  seek(distance: number) { this.distance = Math.max(0, Math.min(this.path[this.path.length - 1]?.distanceAlongMeters ?? 0, Number.isFinite(distance) ? distance : 0)); this.lastTime = null; this.lastPoseKey = ''; this.lastReport = -Infinity; this.ended = false }
  private setStatus(status: DriveStatus, options: DriveOptions) { if (status !== this.status) { this.status = status; options.onStatus?.(status) } }
  tick(now: number, options: DriveOptions): void {
    if (!this.started || !Number.isFinite(now)) return
    const elapsed = this.lastTime === null ? 0 : Math.max(0, Math.min(0.1, (now - this.lastTime) / 1000))
    this.lastTime = now
    const total = this.path[this.path.length - 1]?.distanceAlongMeters ?? 0
    const next = Math.max(0, Math.min(total, this.distance + (options.playing ? Math.max(0, options.speedMetersPerSecond) * elapsed : 0)))
    const placement = roadPlacement(this.path, next)
    if (!placement) return
    const ground = this.map.getTerrain() ? this.map.queryTerrainElevation([placement.lng, placement.lat]) : null
    // No sea-level fallback, no accumulated jump while terrain is loading.
    if (ground === null || !Number.isFinite(ground)) { this.setStatus('waiting-for-terrain', options); return }
    if (!Number.isFinite(options.eyeHeightMeters) || options.eyeHeightMeters <= 0) { this.setStatus('invalid-camera', options); return }
    const eye = ground + options.eyeHeightMeters
    const rotation = viewRotation(placement, eye, options.lookAt, this.path.length > 1 ? placement.travelBearing : options.spotBearing, options.yaw, options.tilt)
    const key = [placement.lng, placement.lat, eye, rotation.bearing, rotation.pitch].join('|')
    if (key !== this.lastPoseKey) {
      const camera = this.map.calculateCameraOptionsFromCameraLngLatAltRotation(placement, eye, rotation.bearing, rotation.pitch, 0)
      if (!finiteCamera(camera)) { this.setStatus('invalid-camera', options); return }
      this.map.jumpTo(camera); this.lastPoseKey = key
    }
    this.distance = next
    this.setStatus('ready', options)
    if (now - this.lastReport > 100) {
      this.lastReport = now
      options.onPosition({ distanceMeters: next, stationIndex: nearestStation(this.stations, next), lng: placement.lng, lat: placement.lat, groundElevationMeters: ground, eyeElevationMeters: eye, ...rotation })
    }
    if (options.playing && next === total && total > 0 && !this.ended) { this.ended = true; options.onReachEnd?.() }
    if (!options.playing && next < total) this.ended = false
  }
  stop() {
    if (!this.started) return
    this.started = false; this.map.stop()
    // Restore in an order that does not clamp the eye-level view before restoring its centre.
    if (this.snapshot) this.map.jumpTo(this.snapshot)
    this.map.setMaxPitch(this.maxPitch); this.map.setCenterClampedToGround(this.clamped)
    for (const [handler, wasEnabled] of this.enabled) if (wasEnabled) handler.enable()
    this.enabled.clear(); this.lastTime = null
  }
}
