import { describe, expect, it } from 'vitest'
import {
  FIXED_LOOK_MIN_PITCH,
  bearingBetween,
  distanceAlongRoad,
  fixedLookRotation,
  mapRollForPhoto,
  pointAlongBearing,
  roadPath,
} from './driveMath'
import { cameraAxes } from './photoPose'

describe('distance along the road', () => {
  // An L: 0.01° east, then 0.01° north, at 54° N.
  const path = roadPath([
    [-122, 54],
    [-121.99, 54],
    [-121.99, 54.01],
  ])
  const corner = path[1].distanceAlongMeters

  it('projects a click beside the road onto the nearest stretch', () => {
    expect(distanceAlongRoad(path, { lng: -121.995, lat: 54.0003 })).toBeCloseTo(corner / 2, -1)
    expect(distanceAlongRoad(path, { lng: -121.9897, lat: 54.005 })).toBeCloseTo(
      (corner + path[2].distanceAlongMeters) / 2,
      -1,
    )
  })
  it('clamps to the ends and refuses nothing to measure', () => {
    expect(distanceAlongRoad(path, { lng: -122.01, lat: 53.99 })).toBe(0)
    expect(distanceAlongRoad(path, { lng: -121.99, lat: 54.05 })).toBeCloseTo(path[2].distanceAlongMeters, 6)
    expect(distanceAlongRoad([], { lng: 0, lat: 0 })).toBeNull()
  })
})

describe('plan handles: bearings and points along them', () => {
  const eye = { lng: -122.5, lat: 53.9 }

  it('reads compass bearings clockwise from north', () => {
    expect(bearingBetween(eye, { lng: eye.lng, lat: eye.lat + 0.01 })).toBeCloseTo(0, 6)
    expect(bearingBetween(eye, { lng: eye.lng + 0.01, lat: eye.lat })).toBeCloseTo(90, 6)
    expect(bearingBetween(eye, { lng: eye.lng, lat: eye.lat - 0.01 })).toBeCloseTo(180, 6)
    expect(bearingBetween(eye, { lng: eye.lng - 0.01, lat: eye.lat })).toBeCloseTo(270, 6)
  })

  it('puts a point out along a bearing that reads back as the same bearing and distance', () => {
    for (const bearing of [0, 37, 135, 251, 359]) {
      const tip = pointAlongBearing(eye, bearing, 1500)
      expect(bearingBetween(eye, tip)).toBeCloseTo(bearing, 6)
      const east = (tip.lng - eye.lng) * 111_320 * Math.cos((eye.lat * Math.PI) / 180)
      const north = (tip.lat - eye.lat) * 110_574
      expect(Math.hypot(east, north)).toBeCloseTo(1500, 6)
    }
  })
})

describe('a fixed look (a photo viewpoint)', () => {
  it('looks further down than a road look, stopping short of straight down', () => {
    // 60° down from the air: a road look stops at 50° below the horizon (map pitch 40).
    expect(fixedLookRotation({ bearing: 10, pitch: -60 }, 0, 0).pitch).toBeCloseTo(30, 9)
    expect(fixedLookRotation({ bearing: 10, pitch: -95 }, 0, 0).pitch).toBe(FIXED_LOOK_MIN_PITCH)
    expect(fixedLookRotation({ bearing: 10, pitch: 40 }, 0, 0).pitch).toBe(110)
    // The reviewer's yaw and tilt still go on top.
    const nudged = fixedLookRotation({ bearing: 350, pitch: -6 }, 15, -2)
    expect(nudged.bearing).toBeCloseTo(5, 9)
    expect(nudged.pitch).toBeCloseTo(82, 9)
  })

  it('turns a photo roll into MapLibre’s, opposite in sign', () => {
    expect(fixedLookRotation({ bearing: 0, pitch: -6, roll: 3 }, 0, 0).roll).toBe(-3)
    expect(fixedLookRotation({ bearing: 0, pitch: -6 }, 0, 0).roll).toBe(0)
    expect(Object.is(mapRollForPhoto(0), -0)).toBe(false)
    expect(mapRollForPhoto(Number.NaN)).toBe(0)
  })

  it('agrees with the photo camera on which way the horizon tilts', () => {
    // Level, facing north, right side raised 8°: a point due east on the horizon drops in the photo.
    const roll = 8
    const { down } = cameraAxes({ bearing: 0, pitch: 0, roll })
    const east: [number, number, number] = [1, 0, 0]
    const photoDown = east[0] * down[0] + east[1] * down[1] + east[2] * down[2]
    // MapLibre's matrix turns camera space by −roll (x right, y down), then flips y up: a point on the right rises
    // by sin(roll) of its offset. Facing north level, due east is on the right.
    const mapRoll = fixedLookRotation({ bearing: 0, pitch: 0, roll }, 0, 0).roll
    const mapDown = -Math.sin((mapRoll * Math.PI) / 180)
    expect(photoDown).toBeGreaterThan(0)
    expect(mapDown).toBeCloseTo(photoDown, 9)
  })
})
