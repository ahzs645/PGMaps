import { describe, expect, it } from 'vitest'

import { DriveController, type DriveMap, type DriveOptions, type DrivePose } from './driveController'
import { HAZE_VISIBILITY_METERS, MAX_WALK_METERS, hazeRings, roadPath, walkStep } from './driveMath'
import type { ElevationSource } from './terrain'

/** A structural map that records where the camera was put. */
function fakeMap() {
  const placed: Array<{ lng: number; lat: number; altitude: number; bearing: number }> = []
  const gesture = { isEnabled: () => true, disable: () => undefined, enable: () => undefined }
  const map: DriveMap = {
    getCenter: () => ({ lng: -122.7, lat: 54.5 }),
    getZoom: () => 10,
    getBearing: () => 0,
    getPitch: () => 0,
    getMaxPitch: () => 85,
    setMaxPitch: () => undefined,
    getCenterClampedToGround: () => true,
    setCenterClampedToGround: () => undefined,
    getTerrain: () => ({}),
    queryTerrainElevation: () => 0,
    calculateCameraOptionsFromCameraLngLatAltRotation: (point, altitude, bearing, pitch, roll) => {
      placed.push({ lng: point.lng, lat: point.lat, altitude, bearing })
      return { center: [point.lng, point.lat], zoom: 16, bearing, pitch, roll, elevation: altitude }
    },
    jumpTo: () => undefined,
    stop: () => undefined,
    dragPan: gesture,
  }
  return { map, placed }
}

const ROAD = roadPath([
  [-122.7, 54.5],
  [-122.7, 54.51],
])
/** Flat ground at 600 m, loaded only west of -122.69. */
const GROUND: ElevationSource = { elevationAt: (lng) => (lng < -122.69 ? 600 : NaN) }

function options(extra: Partial<DriveOptions> = {}): DriveOptions & { poses: DrivePose[] } {
  const poses: DrivePose[] = []
  return {
    playing: false,
    speedMetersPerSecond: 10,
    eyeHeightMeters: 1.6,
    lookAt: null,
    spotBearing: 0,
    yaw: 0,
    tilt: 0,
    onPosition: (pose) => poses.push(pose),
    poses,
    ...extra,
  }
}

describe('walking off the road', () => {
  it('stands the eye at the offset, on the same ground', () => {
    const { map, placed } = fakeMap()
    const controller = new DriveController(map, ROAD, [], GROUND)
    controller.start(0)
    const o = options({ walk: { east: 200, north: 0 } })
    controller.tick(0, o)
    const last = placed[placed.length - 1]
    expect(last.lng).toBeGreaterThan(-122.7)
    expect(last.altitude).toBeCloseTo(601.6, 5)
    expect(o.poses[0].offRoadMeters).toBeCloseTo(200, 5)
  })

  it('refuses ground that is not loaded', () => {
    const { map } = fakeMap()
    const controller = new DriveController(map, ROAD, [], GROUND)
    controller.start(0)
    expect(controller.canStand({ east: 200, north: 0 })).toBe(true)
    // About 1.3 km east is past -122.69, where the mosaic has no ground.
    expect(controller.canStand({ east: 1300, north: 0 })).toBe(false)
  })

  it('drops the offset while playing', () => {
    const { map, placed } = fakeMap()
    const controller = new DriveController(map, ROAD, [], GROUND)
    controller.start(0)
    controller.tick(0, options({ playing: true, walk: { east: 200, north: 0 } }))
    expect(placed[placed.length - 1].lng).toBeCloseTo(-122.7, 9)
  })

  it('steps along the view and across it, and stops at the walking limit', () => {
    const forward = walkStep({ east: 0, north: 0 }, 90, 10, 0)
    expect(forward.east).toBeCloseTo(10, 9)
    expect(forward.north).toBeCloseTo(0, 9)
    const right = walkStep({ east: 0, north: 0 }, 0, 0, 5)
    expect(right.east).toBeCloseTo(5, 9)
    const far = walkStep({ east: 0, north: 0 }, 0, MAX_WALK_METERS * 3, 0)
    expect(Math.hypot(far.east, far.north)).toBeCloseTo(MAX_WALK_METERS, 6)
  })
})

describe('a surveyed eye elevation', () => {
  it('stands the eye there near its point, and on the ground + eye height once walked away', () => {
    const { map, placed } = fakeMap()
    const controller = new DriveController(map, ROAD, [], GROUND)
    controller.start(0)
    const surveyedEye = { elevationMeters: 590.5, lng: -122.7, lat: 54.5 }
    const here = options({ surveyedEye })
    controller.tick(0, here)
    expect(placed[placed.length - 1].altitude).toBeCloseTo(590.5, 9)
    expect(here.poses[0]).toMatchObject({ eyeElevationMeters: 590.5, eyeSurveyed: true, groundElevationMeters: 600 })
    const away = options({ surveyedEye, walk: { east: 200, north: 0 } })
    controller.tick(200, away)
    expect(placed[placed.length - 1].altitude).toBeCloseTo(601.6, 5)
    expect(away.poses[0].eyeSurveyed).toBeUndefined()
  })
})

describe('resizing the road view', () => {
  it('places the camera again at the same station when the canvas changes size', () => {
    const { map } = fakeMap()
    const canvas = { clientWidth: 600, clientHeight: 400 }
    let jumps = 0
    map.getCanvas = () => canvas
    map.jumpTo = () => {
      jumps++
    }
    const controller = new DriveController(map, ROAD, [], GROUND)
    controller.start(0)
    const o = options()
    controller.tick(0, o)
    controller.tick(16, o)
    expect(jumps).toBe(1)
    // Fullscreen: same station, same view, taller canvas.
    canvas.clientWidth = 1280
    canvas.clientHeight = 957
    controller.tick(32, o)
    expect(jumps).toBe(2)
  })
})

describe('distance haze', () => {
  it('fades by Koschmieder: about 28% at 5 km and 48% at 10 km on a 60 km day', () => {
    const rings = hazeRings({ lng: -122.7, lat: 54.5 })
    const at = (metres: number) =>
      rings.features.find((f) => f.properties!.innerMeters <= metres && metres < f.properties!.outerMeters)!.properties!
        .opacity as number
    expect(HAZE_VISIBILITY_METERS).toBe(60_000)
    expect(at(5000)).toBeGreaterThan(0.22)
    expect(at(5000)).toBeLessThan(0.34)
    expect(at(10_000)).toBeGreaterThan(0.42)
    expect(at(10_000)).toBeLessThan(0.55)
    // Nearer is always clearer.
    const opacities = rings.features.map((f) => f.properties!.opacity as number)
    expect([...opacities].sort((a, b) => a - b)).toEqual(opacities)
    expect(opacities[0]).toBeLessThan(0.05)
  })

  it('tiles the ground once: each ring starts where the last ended', () => {
    const rings = hazeRings({ lng: -122.7, lat: 54.5 })
    for (let i = 1; i < rings.features.length; i += 1)
      expect(rings.features[i].properties!.innerMeters).toBeCloseTo(rings.features[i - 1].properties!.outerMeters, 6)
  })
})
